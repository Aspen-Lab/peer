import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-41 (round 2, Theme B (c); round 1's r3; ruling §1h.138 (d)): a figure card that is open in the margin when the window narrows below 1024 px comes back —
// the same figure, at the same zoom and pan, in the same stacking order — when the window is 1024 px or more again, as the Explain card and the sticky do. It
// was closed by the narrowing (`closeFigure`), so it was gone for good. Now the host PARKS it: the figure is held in memory (`parkFigure`, `figure-viewer.ts`),
// its window leaves the stack (nothing is drawn below 1024 and the other cards count no header for it) and its card stays MOUNTED but hidden, inside a hidden
// `Activity` (the zoom and pan live in the card's state, so keeping the card is what keeps them). Wide again, the window is opened in the place it left and
// the very same figure is open again. Below 1024 nothing changes: a figure pressed there is today's lightbox, a card that was open is not drawn, and a figure
// closed while the window was narrow stays closed. Memory only: nothing is stored. The host runs on the staged hook runtime (no DOM in this suite), the
// stores are read the way React reads them, `document` is a recorder, and the element tree it returns is inspected. Invented text.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  const hooks = stagedRuntime.hooks;
  return {
    ...actual,
    ...hooks,
    // The runtime has no useSyncExternalStore: the snapshot is read at render and a change renders again.
    useSyncExternalStore<T>(subscribe: (notify: () => void) => () => void, getSnapshot: () => T): T {
      const [, bump] = hooks.useState(0);
      hooks.useEffect(() => subscribe(() => bump((n: number) => n + 1)), [subscribe]);
      return getSnapshot();
    },
  };
});

// zustand is an external module that imports the real React, which has no dispatcher on this runtime: its stores are made again with the same state and the
// same API, and a hook that reads them through the stand-in `useSyncExternalStore` above (as `front-card.escape.flow.test.tsx` does).
vi.mock("zustand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand")>();
  const { useSyncExternalStore } = await import("react");
  const make = (initializer: never) => {
    const store = actual.createStore(initializer);
    const useBound = (selector: (state: unknown) => unknown = (state) => state) =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getInitialState()));
    return Object.assign(useBound, store);
  };
  return { ...actual, create: (initializer?: never) => (initializer ? make(initializer) : make) };
});

import { Activity, type ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { closeFigure, getOpenFigure, getParkedFigure, openFigure, openFigureKey, type FigureRef } from "@/lib/reader/figure-viewer";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { EXPLAIN_WINDOW_ID, NOTES_WINDOW_ID, STACK_Z_BASE, useWindows, type FloatingWindow } from "@/lib/reader/windows";
import { FIGURE_WINDOW_ID, FigureCard } from "./figure-card";
import { FigureHost, FigureOverlay, FigureStack, REJOIN_WAIT_MS, figurePlaceOf, stackAfterReturn, windowsToRejoin } from "./figure-host";

/** The margin a shell would register: 400 px wide at the right, the masthead's foot down to the legend's strip. */
const MARGIN: MarginRect = { left: 1000, width: 400, top: 48, bottom: 860 };

const ref = (label: string, ordinal = Number(label.replace(/\D/g, "")), over: Partial<FigureRef> = {}): FigureRef => ({
  key: `${label}:${ordinal}`,
  src: `/api/figure/p1/${ordinal}`,
  label,
  caption: `Invented caption for ${label}.`,
  natural: { width: 600, height: 400 },
  origin: null,
  ...over,
});

// ── The page the host stands on ────────────────────────────────────────────

type Listener = (event: unknown) => void;
let listeners: Map<string, Set<Listener>>;
let win: { innerWidth: number; innerHeight: number; addEventListener: () => void; removeEventListener: () => void };
let active: { focus: ReturnType<typeof vi.fn>; isConnected: boolean; closest: () => null } | null;
let body: object;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((one) => one(event));

function stubPage() {
  listeners = new Map();
  active = null;
  body = {};
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
    querySelector: () => null,
    get activeElement() {
      return active ?? body;
    },
    body,
  });
  // The window's width is what the stack's other cards read to know whether they stand in the margin (the Explain card: from 1024 px).
  win = { innerWidth: 1440, innerHeight: 900, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", win);
}

function escape(over: Record<string, unknown> = {}) {
  return { key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over };
}

function settle() {
  // A render-phase update and a layout effect's update each render again before the paint; the staged runtime renders once per event.
  for (let i = 0; i < 8; i += 1) stagedRuntime.event(() => {});
}

const hosts: Array<() => void> = [];

function mountHost() {
  const mounted = stagedRuntime.mount(() => FigureHost());
  hosts.push(mounted.unmount);
  stagedRuntime.flush();
  settle();
  return {
    get tree(): ReactElement | null {
      return mounted.value as ReactElement | null;
    },
    get props(): Record<string, unknown> {
      return (mounted.value as ReactElement<Record<string, unknown>> | null)?.props ?? {};
    },
    act(handler: () => void) {
      stagedRuntime.event(handler);
      settle();
    },
    unmount: () => mounted.unmount(),
  };
}
type Host = ReturnType<typeof mountHost>;

/** The window narrows below 1024: the width first (the Explain card undocks and leaves the stack — `leaving`), then the margin goes (the shell is not
 *  mounted); `leavingAfter` are the cards that leave only once the margin has gone. */
function narrow(host: Host, leaving: readonly string[] = [], leavingAfter: readonly string[] = []) {
  win.innerWidth = 900;
  for (const id of leaving) useWindows.getState().close(id);
  host.act(() => useMarginStore.setState({ rect: null }));
  for (const id of leavingAfter) useWindows.getState().close(id);
}
/** The window widens to 1024 or more: the width first (`joining`: the cards that dock at once and join the stack in front), then the margin is there, and
 *  then `joiningAfter` (the Explain card follows the width a frame later than the margin does, so in the page it joins after). */
function widen(
  host: Host,
  joining: ReadonlyArray<Pick<FloatingWindow, "id" | "kind" | "title">> = [],
  joiningAfter: ReadonlyArray<Pick<FloatingWindow, "id" | "kind" | "title">> = [],
) {
  win.innerWidth = 1440;
  for (const one of joining) useWindows.getState().open(one);
  host.act(() => useMarginStore.setState({ rect: MARGIN }));
  for (const one of joiningAfter) useWindows.getState().open(one);
}

const windows = () => useWindows.getState().windows;
const figureWindow = () => windows().find((w) => w.id === FIGURE_WINDOW_ID);
/** The ids of the stack, behind to front. */
const order = () => [...windows()].sort((a, b) => a.order - b.order).map((w) => w.id);
const sticky = (id: string) => useWindows.getState().open({ id, kind: "sticky", title: id });
const EXPLAIN = { id: EXPLAIN_WINDOW_ID, kind: "explain", title: "Explain" } as const;

beforeEach(() => {
  stubPage();
  closeFigure();
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  for (const unmount of hosts.splice(0)) unmount();
  closeFigure();
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
});

describe("the window narrows below 1024 px: the open card is parked, not closed", () => {
  it("holds the figure (not open: nothing is pressed, nothing to close), takes its window out of the stack, and draws nothing", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const open = getOpenFigure();
    expect(figureWindow()).toBeDefined();

    narrow(host);

    expect(getOpenFigure()).toBeNull();
    expect(openFigureKey()).toBeNull();
    expect(getParkedFigure()).toBe(open);
    expect(windows()).toEqual([]);
  });

  it("keeps the card MOUNTED, hidden — the same stack element, the same figure — so that its zoom and pan live on", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const open = getOpenFigure();
    expect(host.tree?.type).toBe(FigureStack);

    narrow(host);

    expect(host.tree?.type).toBe(FigureStack);
    expect(host.props).toMatchObject({ figure: open, parked: true });
  });

  it("is not the overlay: below the margin's width a card that was open is not drawn and does not jump into the lightbox", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    expect(host.tree?.type).not.toBe(FigureOverlay);
  });

  it("is not the open figure's Escape: with the card parked there is nothing to close, and the key is left alone", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    const event = escape();
    host.act(() => fire("keydown", event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(getParkedFigure()).not.toBeNull();
  });

  it("parks nothing for an overlay: a figure pressed below 1024 is today's lightbox and stays so", () => {
    useMarginStore.setState({ rect: null });
    win.innerWidth = 900;
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(getParkedFigure()).toBeNull();
    expect(windows()).toEqual([]);
  });
});

describe("the window is 1024 px or more again: the same figure comes back", () => {
  it("opens the very same figure again (the same ref, not a copy), puts its window back in the stack, and shows the stack, no longer hidden", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const open = getOpenFigure();
    narrow(host);

    widen(host);

    expect(getOpenFigure()).toBe(open);
    expect(openFigureKey()).toBe("Figure 3:3");
    expect(getParkedFigure()).toBeNull();
    expect(figureWindow()).toMatchObject({ kind: "figure", title: "Figure 3" });
    expect(host.tree?.type).toBe(FigureStack);
    expect(host.props).toMatchObject({ figure: open, frame: MARGIN });
    expect(host.props.parked).toBeFalsy();
  });

  it("stands where it can be closed again: the X and Escape close the returned card, and nothing comes back after", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    widen(host);
    const event = escape();
    host.act(() => fire("keydown", event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
    narrow(host);
    widen(host);
    expect(getOpenFigure()).toBeNull();
    expect(host.tree).toBeNull();
  });

  it("does it again, and again: narrow and back twice, the same figure each time", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const open = getOpenFigure();
    for (let i = 0; i < 3; i += 1) {
      narrow(host);
      expect(getParkedFigure()).toBe(open);
      widen(host);
      expect(getOpenFigure()).toBe(open);
      expect(figureWindow()).toBeDefined();
    }
  });

  it("does not bring a card back that was closed while the window was wide", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    host.act(() => closeFigure());
    narrow(host);
    widen(host);
    expect(getOpenFigure()).toBeNull();
    expect(getParkedFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
  });

  it("takes no focus anywhere when it returns: the focus goes back to the pressed figure when the card goes (as before), and a return is not a press", () => {
    const pressed = { focus: vi.fn(), isConnected: true, closest: () => null };
    const host = mountHost();
    active = pressed;
    host.act(() => openFigure(ref("Figure 3")));
    // The card took the focus, and went with the narrowing: nothing has it, and it goes back to where the reader pressed.
    active = null;
    narrow(host);
    expect(pressed.focus).toHaveBeenCalledTimes(1);
    pressed.focus.mockClear();
    widen(host);
    expect(pressed.focus).not.toHaveBeenCalled();
  });
});

describe("it returns in the same stacking order (the stack as it stood while the window was wide)", () => {
  it("in front of the cards that were behind it, behind the ones that were in front of it", () => {
    const host = mountHost();
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    sticky("sticky-2");
    expect(order()).toEqual(["sticky-1", "figure", "sticky-2"]);

    narrow(host);
    expect(order()).toEqual(["sticky-1", "sticky-2"]);
    widen(host);

    expect(order()).toEqual(["sticky-1", "figure", "sticky-2"]);
  });

  it("in front when it was in front", () => {
    const host = mountHost();
    sticky("sticky-1");
    sticky("sticky-2");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    widen(host);
    expect(order()).toEqual(["sticky-1", "sticky-2", "figure"]);
  });

  it("behind when it was behind", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    sticky("sticky-1");
    sticky("sticky-2");
    narrow(host);
    widen(host);
    expect(order()).toEqual(["figure", "sticky-1", "sticky-2"]);
  });

  it("alone in the stack when it was alone", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    widen(host);
    expect(order()).toEqual(["figure"]);
  });

  it("with the Explain card, which leaves the stack below 1024 and joins it in front when the width is back — opened Explain, sticky, figure", () => {
    const host = mountHost();
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "sticky-1", "figure"]);

    narrow(host, [EXPLAIN_WINDOW_ID]);
    expect(order()).toEqual(["sticky-1"]);
    widen(host, [EXPLAIN]);

    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "sticky-1", "figure"]);
  });

  it("with the Explain card — opened figure, Explain, sticky", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    expect(order()).toEqual(["figure", EXPLAIN_WINDOW_ID, "sticky-1"]);

    narrow(host, [EXPLAIN_WINDOW_ID]);
    widen(host, [EXPLAIN]);

    expect(order()).toEqual(["figure", EXPLAIN_WINDOW_ID, "sticky-1"]);
  });

  it("with the Explain card — opened sticky, figure, Explain (the Explain card in front)", () => {
    const host = mountHost();
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open(EXPLAIN);
    narrow(host, [EXPLAIN_WINDOW_ID]);
    widen(host, [EXPLAIN]);
    expect(order()).toEqual(["sticky-1", "figure", EXPLAIN_WINDOW_ID]);
  });

  // In the page the Explain card reads the width on the next animation frame, so it leaves the stack after the margin has gone and joins it again, in front,
  // after the margin is back: the figure comes back first, and the stack is put right when the Explain card joins.
  it("with the Explain card, which joins only after the margin is back (as in the page) — opened Explain, sticky, figure", () => {
    const host = mountHost();
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    expect(order()).toEqual(["sticky-1"]);

    widen(host, [], [EXPLAIN]);

    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "sticky-1", "figure"]);
  });

  it("with the Explain card, which joins only after the margin is back — opened figure, Explain, sticky", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    widen(host, [], [EXPLAIN]);
    expect(order()).toEqual(["figure", EXPLAIN_WINDOW_ID, "sticky-1"]);
  });

  it("with the Explain card, which joins only after the margin is back — opened sticky, figure, Explain (in front, where it joins)", () => {
    const host = mountHost();
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open(EXPLAIN);
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    widen(host, [], [EXPLAIN]);
    expect(order()).toEqual(["sticky-1", "figure", EXPLAIN_WINDOW_ID]);
  });

  it("puts the stack right again when the Explain card joins, keeping what the reader did meanwhile: a card raised after the figure came back stays in front of it", () => {
    const host = mountHost();
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    widen(host);
    expect(order()).toEqual(["sticky-1", "figure"]);
    useWindows.getState().raise("sticky-1");
    useWindows.getState().open(EXPLAIN);
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "figure", "sticky-1"]);
  });

  it("waits for a card only once and only for a moment: an Explain card opened later is in front, wherever the old one stood", () => {
    const host = mountHost();
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    widen(host, [], [EXPLAIN]);
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "sticky-1", "figure"]);
    // The reader closes it and asks again: a new card, in front.
    useWindows.getState().close(EXPLAIN_WINDOW_ID);
    useWindows.getState().open(EXPLAIN);
    expect(order()).toEqual(["sticky-1", "figure", EXPLAIN_WINDOW_ID]);
  });

  it("stops waiting after a moment for a card that does not come back (the reader closed it while the window was narrow): one that opens later is in front", () => {
    vi.useFakeTimers();
    try {
      const host = mountHost();
      useWindows.getState().open(EXPLAIN);
      sticky("sticky-1");
      host.act(() => openFigure(ref("Figure 3")));
      narrow(host, [EXPLAIN_WINDOW_ID]);
      widen(host);
      expect(order()).toEqual(["sticky-1", "figure"]);
      vi.advanceTimersByTime(REJOIN_WAIT_MS + 50);
      useWindows.getState().open(EXPLAIN);
      expect(order()).toEqual(["sticky-1", "figure", EXPLAIN_WINDOW_ID]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with the Explain card that leaves only after the margin has gone (the other order of the two): the same stack", () => {
    const host = mountHost();
    useWindows.getState().open(EXPLAIN);
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    widen(host, [EXPLAIN]);
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "sticky-1", "figure"]);
  });

  it("with the notes window, which stays in the stack all the while", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Notes" });
    narrow(host);
    widen(host);
    expect(order()).toEqual(["figure", NOTES_WINDOW_ID]);
  });

  it("a card opened while the window was narrow stands in front of it, and so does one the reader raised then", () => {
    const host = mountHost();
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    sticky("sticky-2");
    narrow(host);
    sticky("sticky-3"); // opened below 1024
    useWindows.getState().raise("sticky-1"); // raised below 1024
    widen(host);
    expect(order()).toEqual(["figure", "sticky-2", "sticky-3", "sticky-1"]);
  });

  it("is the front card again when it was the front: Escape closes it first", () => {
    const host = mountHost();
    sticky("sticky-1");
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    widen(host);
    const event = escape();
    host.act(() => fire("keydown", event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(getOpenFigure()).toBeNull();
    expect(order()).toEqual(["sticky-1"]);
  });
});

describe("the cascade stands where it stood (the stack's origin, level with the selection that opened its first card)", () => {
  const origin = () => useWindows.getState().origin;

  it("when the Explain card and the figure were all that stood: the stack forgets its origin when it is empty below 1024, and the figure's return puts it back", () => {
    const host = mountHost();
    useWindows.getState().open({ ...EXPLAIN, anchorTop: 217 });
    host.act(() => openFigure(ref("Figure 3")));
    expect(origin()).toBe(217);

    narrow(host, [], [EXPLAIN_WINDOW_ID]);
    expect(windows()).toEqual([]);
    expect(origin()).toBeNull();
    widen(host, [], [EXPLAIN]); // the figure first, the Explain card a frame later

    expect(origin()).toBe(217);
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "figure"]);
  });

  it("keeps what an Explain card that is back before the margin is has made of it: the cascade it follows (the figure joins a stack that has a card)", () => {
    const host = mountHost();
    useWindows.getState().open({ ...EXPLAIN, anchorTop: 217 });
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host, [EXPLAIN_WINDOW_ID]);
    win.innerWidth = 1440;
    useWindows.getState().open({ ...EXPLAIN, anchorTop: 190 }); // alone in the stack it is level with its selection, as it follows it (`follow`)
    host.act(() => useMarginStore.setState({ rect: MARGIN }));
    expect(order()).toEqual([EXPLAIN_WINDOW_ID, "figure"]);
    expect(origin()).toBe(190);
  });

  it("has nothing to put back for a figure that stood alone (its cascade starts at the margin's top)", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    expect(origin()).toBeNull();
    narrow(host);
    widen(host);
    expect(origin()).toBeNull();
  });

  it("leaves the origin of a stack that stayed (a sticky stands all the while) as it is", () => {
    const host = mountHost();
    useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "sticky-1", anchorTop: 300 });
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    expect(origin()).toBe(300);
    widen(host);
    expect(origin()).toBe(300);
  });
});

describe("the pure parts of the return", () => {
  const w = (id: string, order: number): FloatingWindow => ({ id, kind: id === "figure" ? "figure" : "sticky", title: id, order });

  it("has no place for a figure whose window was not in the stack", () => {
    expect(figurePlaceOf([w("a", 1)], new Set())).toBeNull();
    expect(figurePlaceOf([], new Set())).toBeNull();
  });

  it("keeps the cascade's origin with the place, null when it had none", () => {
    expect(figurePlaceOf([w("figure", 1)], new Set())).toMatchObject({ origin: null });
    expect(figurePlaceOf([w("figure", 1)], new Set(), 217)).toMatchObject({ origin: 217 });
  });

  it("puts the windows in the stack's old order, the figure among them, and the ones that came newer after", () => {
    const place = figurePlaceOf([w("a", 1), w("figure", 2), w("b", 3)], new Set());
    // The figure's window is open again (the newest); a and b stand as they did; c was opened meanwhile.
    expect(stackAfterReturn([w("a", 1), w("b", 3), w("c", 5), w("figure", 6)], place!)).toEqual({ order: ["a", "figure", "b", "c"], kept: ["a", "figure", "b"] });
  });

  it("counts a window that stood all the while and has another order now as touched: it goes after, in the order of its touch", () => {
    const place = figurePlaceOf([w("a", 1), w("figure", 2), w("b", 3)], new Set());
    expect(stackAfterReturn([w("a", 4), w("b", 3), w("figure", 5)], place!)).toEqual({ order: ["figure", "b", "a"], kept: ["figure", "b"] });
  });

  it("counts a window that left the stack while the window was narrow and is there again as rejoined, not touched (the Explain card)", () => {
    const place = figurePlaceOf([w("x", 1), w("figure", 2), w("b", 3)], new Set(["x"]));
    expect(stackAfterReturn([w("b", 3), w("x", 7), w("figure", 8)], place!)).toEqual({ order: ["x", "figure", "b"], kept: ["x", "figure", "b"] });
  });

  it("takes the orders the last call left as the ones nobody has touched (`settled`): a window raised since is newer, one that joins is put in its place", () => {
    const place = figurePlaceOf([w("x", 1), w("a", 2), w("figure", 3)], new Set(["x"]))!;
    // First call: x has not joined yet. a and figure stand as they did (settled at 8 and 9); the reader then raises a (10) and x joins (11).
    const settled = new Map([["a", 8], ["figure", 9]]);
    expect(stackAfterReturn([w("a", 10), w("figure", 9), w("x", 11)], place, settled)).toEqual({ order: ["x", "figure", "a"], kept: ["x", "figure"] });
  });

  it("names the windows to wait for: those that left while the window was narrow, were in the old stack, and are not in the stack now — never the figure", () => {
    const place = figurePlaceOf([w("x", 1), w("y", 2), w("figure", 3)], new Set(["x", "y", "figure", "z"]))!;
    expect(windowsToRejoin([w("y", 5), w("figure", 6)], place)).toEqual(["x"]);
    expect(windowsToRejoin([w("x", 5), w("y", 6), w("figure", 7)], place)).toEqual([]);
  });

  it("leaves out a window that is gone, and the ones in the old stack that are not in the stack now", () => {
    const place = figurePlaceOf([w("a", 1), w("figure", 2), w("b", 3)], new Set());
    expect(stackAfterReturn([w("b", 3), w("figure", 4)], place!)).toEqual({ order: ["figure", "b"], kept: ["figure", "b"] });
  });
});

describe("a figure closed while the window was narrow stays closed", () => {
  it("a close while parked forgets it", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    host.act(() => closeFigure());
    expect(getParkedFigure()).toBeNull();
    widen(host);
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
  });

  it("the same figure pressed below 1024 is the lightbox; closed, it is closed when the window is wide again", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    host.act(() => openFigure(ref("Figure 3")));
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(getParkedFigure()).toBeNull();
    host.act(() => closeFigure());
    expect(host.tree).toBeNull();
    widen(host);
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
  });

  it("another figure pressed below 1024 replaces it (D2): the first does not come back, whatever becomes of the second", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    host.act(() => openFigure(ref("Figure 4")));
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(getParkedFigure()).toBeNull();
    widen(host);
    // The lightbox that is open when the window widens stays (today's rule), and no card comes with it.
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(windows()).toEqual([]);
    host.act(() => closeFigure());
    expect(host.tree).toBeNull();
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
  });

  it("the paper changing (the host unmounting) forgets a parked figure: a card never follows the reader to the next paper", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    narrow(host);
    expect(getParkedFigure()).not.toBeNull();
    host.unmount();
    expect(getParkedFigure()).toBeNull();
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
  });
});

// ── The stack element: the card is kept, hidden, while it is parked ──────────────────────────────────────

describe("FigureStack keeps the card while it is parked", () => {
  const row = (over: Partial<FloatingWindow> = {}): FloatingWindow => ({ id: FIGURE_WINDOW_ID, kind: "figure", title: "Figure 3", order: 1, ...over });
  const stack = (props: { figure: FigureRef; frame: MarginRect | null; parked?: boolean }) => {
    const mounted = stagedRuntime.mount(() => FigureStack(props));
    stagedRuntime.flush();
    return mounted.value as unknown as ReactElement<{ mode: "visible" | "hidden"; children: ReactElement<Record<string, unknown>> }> | null;
  };
  const card = (tree: ReturnType<typeof stack>) => tree!.props.children;

  it("draws the card in a visible Activity, in front, in its row, while it stands in the margin", () => {
    useWindows.setState({ windows: [row()], clock: 1, origin: null });
    const tree = stack({ figure: ref("Figure 3"), frame: MARGIN });
    expect(tree?.type).toBe(Activity);
    expect(tree?.props.mode).toBe("visible");
    expect(card(tree).type).toBe(FigureCard);
    expect(card(tree).key).toBe("Figure 3:3");
    expect(card(tree).props).toMatchObject({ front: true, top: 48, height: 812, z: STACK_Z_BASE });
  });

  it("keeps the very same card — the same element type, the same key, in the same place — in a hidden Activity while it is parked, header only", () => {
    useWindows.setState({ windows: [row()], clock: 1, origin: null });
    const standing = stack({ figure: ref("Figure 3"), frame: MARGIN });
    useWindows.setState({ windows: [], clock: 1, origin: null }); // the window left the stack
    const parked = stack({ figure: ref("Figure 3"), frame: null, parked: true });
    expect(parked?.type).toBe(standing?.type);
    expect(parked?.props.mode).toBe("hidden");
    expect(card(parked).type).toBe(card(standing).type);
    expect(card(parked).key).toBe(card(standing).key);
    expect(card(parked).props).toMatchObject({ front: false, frame: null });
  });

  it("keeps it in a hidden Activity while its window is still in the stack too (the frame the margin goes)", () => {
    useWindows.setState({ windows: [row()], clock: 1, origin: null });
    const tree = stack({ figure: ref("Figure 3"), frame: null, parked: true });
    expect(tree?.props.mode).toBe("hidden");
    expect(card(tree).props).toMatchObject({ front: false });
  });

  it("draws nothing for the one frame before the host has opened the window, as it always did", () => {
    useWindows.setState({ windows: [], clock: 0, origin: null });
    expect(stack({ figure: ref("Figure 3"), frame: MARGIN })).toBeNull();
  });
});
