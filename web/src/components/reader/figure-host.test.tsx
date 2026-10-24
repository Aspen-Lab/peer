import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-15 rule 2 (owner item 1; B P11-05 §2.3, §2.4, §4; ruling §1h.113 (c) D2, D4, D5): the host of the open figure. It listens to the figure
// store and puts the figure in the margin's stack as a card — or, where there is no margin, in today's lightbox overlay. Escape closes the front
// figure card wherever the focus is; the X does the same; a window narrowed below the margin's width closes the card; the host closes the figure
// when it unmounts (the page keys it by the paper). The host runs on the staged hook runtime (no DOM in this suite): the stores are read the way
// React reads them (`useSyncExternalStore` is stood in for below), `document` is a recorder, and the element tree it returns is inspected. The
// card and the stack's row component are tested where they stand (`figure-card.test.tsx`; the row is `figureRowOf`, pure, here). Invented text.
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

import type { ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { closeFigure, getOpenFigure, openFigure, type FigureRef } from "@/lib/reader/figure-viewer";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { STACK_Z_BASE, useWindows, type FloatingWindow } from "@/lib/reader/windows";
import { FIGURE_WINDOW_ID, FigureCard } from "./figure-card";
import { FigureViewer } from "./figure-lightbox";
import {
  FigureHost,
  FigureOverlay,
  FigureStack,
  dismissFigure,
  figureCardElement,
  figureIsFront,
  figureRowOf,
  raiseFigure,
  takeEscape,
} from "./figure-host";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const HOST = read("src/components/reader/figure-host.tsx");
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

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
let modal: unknown;
let active: { focus: ReturnType<typeof vi.fn>; isConnected: boolean; closest: () => null } | null;
let body: object;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((one) => one(event));

function stubDocument() {
  listeners = new Map();
  modal = null;
  active = null;
  body = {};
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
    querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? modal : null),
    get activeElement() {
      return active ?? body;
    },
    body,
  });
}

function escape(over: Record<string, unknown> = {}) {
  return { key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over };
}

function settle() {
  // A render-phase update and a layout effect's update each render again before the paint; the staged runtime renders once per event.
  for (let i = 0; i < 4; i += 1) stagedRuntime.event(() => {});
}

function mountHost() {
  const mounted = stagedRuntime.mount(() => FigureHost());
  // The first commit's passive effects (the subscriptions, the key listener) run as a task of their own.
  stagedRuntime.flush();
  settle();
  return {
    get tree(): ReactElement | null {
      return mounted.value as ReactElement | null;
    },
    /** A discrete event: the handler, then React's renders. */
    act(handler: () => void) {
      stagedRuntime.event(handler);
      settle();
    },
    unmount: () => mounted.unmount(),
  };
}

const windows = () => useWindows.getState().windows;
const figureWindow = () => windows().find((w) => w.id === FIGURE_WINDOW_ID);

beforeEach(() => {
  stubDocument();
  closeFigure();
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  closeFigure();
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
});

describe("opening: a press puts the figure in the margin's stack, in front", () => {
  it("draws nothing and opens nothing until a figure is pressed", () => {
    const host = mountHost();
    expect(host.tree).toBeNull();
    expect(windows()).toEqual([]);
  });

  it("opens a window of kind figure titled by the label, and shows the stack with the figure and the margin's rect", () => {
    const host = mountHost();
    const three = ref("Figure 3");
    host.act(() => openFigure(three));
    // P12-04 RE-AIM: the page-session store now declares its sole composition share.
    expect(windows()).toEqual([{ id: "figure", kind: "figure", title: "Figure 3", order: 1, share: 1 }]);
    expect(host.tree?.type).toBe(FigureStack);
    expect(host.tree?.props).toMatchObject({ figure: getOpenFigure(), frame: MARGIN });
    expect((host.tree?.props as { figure: FigureRef }).figure).toMatchObject({ key: "Figure 3:3", label: "Figure 3" });
  });

  it("brings the card forward on every press, the open figure again too", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" });
    expect(figureIsFront(windows())).toBe(false);
    // Pressed again: the same key, a new ref.
    const before = host.tree?.props as { figure: FigureRef };
    host.act(() => openFigure(ref("Figure 3")));
    expect(figureIsFront(windows())).toBe(true);
    expect(windows()).toHaveLength(2);
    expect((host.tree?.props as { figure: FigureRef }).figure).not.toBe(before.figure);
    expect((host.tree?.props as { figure: FigureRef }).figure.key).toBe("Figure 3:3");
  });

  it("replaces the first figure with a second: one window, retitled, the new figure on show", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    host.act(() => openFigure(ref("Figure 4")));
    expect(windows()).toHaveLength(1);
    expect(figureWindow()).toMatchObject({ kind: "figure", title: "Figure 4" });
    expect((host.tree?.props as { figure: FigureRef }).figure.key).toBe("Figure 4:4");
  });

  it("keeps the same card for the same figure and makes a new one for another (the zoom is kept, or reset to fit)", () => {
    const frame = MARGIN;
    const row = { id: "figure", top: 48, height: 812, front: true, z: STACK_Z_BASE };
    const a = figureCardElement(ref("Figure 3"), frame, row);
    const again = figureCardElement(ref("Figure 3"), frame, row);
    const other = figureCardElement(ref("Figure 4"), frame, row);
    expect(a.type).toBe(FigureCard);
    expect(a.key).toBe("Figure 3:3");
    expect(again.key).toBe(a.key);
    expect(other.key).not.toBe(a.key);
    expect(a.props).toMatchObject({ frame, front: true, top: 48, height: 812, z: STACK_Z_BASE, onClose: dismissFigure, onRaise: raiseFigure });
  });

  it("leaves the page alone: nothing reserved, nothing scrolled, nothing stored", () => {
    const c = code(HOST);
    expect(c).not.toMatch(/holdInPlace|reserveDock|scrollBy|scrollTo|setProperty|localStorage|sessionStorage|fetch\(|console\./);
  });
});

describe("the row the stack gives the card", () => {
  const frame = { top: 48, bottom: 860, minTop: 48 };
  const win = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });

  it("fills the whole margin when it is the only card", () => {
    expect(figureRowOf([win("figure", "figure", 1)], frame)).toMatchObject({ top: 48, height: 812, front: true });
  });

  it("P12-04: retains an equal visible panel in either opening order, independent of active order", () => {
    expect(figureRowOf([win("figure", "figure", 1), win("s", "sticky", 2)], frame)).toMatchObject({ top: 48, height: 400, front: true });
    expect(figureRowOf([win("s", "sticky", 1), win("figure", "figure", 2)], frame)).toMatchObject({ top: 460, height: 400, front: true });
  });

  it("is absent while the window is not in the stack", () => {
    expect(figureRowOf([win("s", "sticky", 1)], frame)).toBeUndefined();
    expect(figureRowOf([], frame)).toBeUndefined();
  });

  it("is in front only when it is the window raised last", () => {
    expect(figureIsFront([])).toBe(false);
    expect(figureIsFront([win("figure", "figure", 3), win("s", "sticky", 2)])).toBe(true);
    expect(figureIsFront([win("figure", "figure", 3), win("s", "sticky", 4)])).toBe(false);
    expect(figureIsFront([win("s", "sticky", 1)])).toBe(false);
  });
});

describe("Escape closes the front figure card, wherever the focus is", () => {
  it("stands from the moment the host mounts, once, and goes with it", () => {
    const host = mountHost();
    expect(listeners.get("keydown")?.size).toBe(1);
    host.unmount();
    expect(listeners.get("keydown")?.size ?? 0).toBe(0);
  });

  it("closes the card and the figure, takes the key, and the page's back never sees it", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const event = escape();
    host.act(() => fire("keydown", event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
  });

  it("leaves a key that was handled already (defaultPrevented), a modal dialog over the page, and every other key", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    const handled = escape({ defaultPrevented: true });
    host.act(() => fire("keydown", handled));
    expect(handled.preventDefault).not.toHaveBeenCalled();
    expect(getOpenFigure()).not.toBeNull();
    modal = {};
    const underModal = escape();
    host.act(() => fire("keydown", underModal));
    expect(underModal.preventDefault).not.toHaveBeenCalled();
    expect(getOpenFigure()).not.toBeNull();
    modal = null;
    const other = escape({ key: "Enter" });
    host.act(() => fire("keydown", other));
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(getOpenFigure()).not.toBeNull();
    expect(figureWindow()).toBeDefined();
  });

  it("is not the key of a page with no figure open: it is not consumed", () => {
    const host = mountHost();
    const event = escape();
    host.act(() => fire("keydown", event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("closes only the card in front: one Escape, one card", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" });
    // A sticky was raised over the figure: Escape is not the figure's.
    const behind = escape();
    host.act(() => fire("keydown", behind));
    expect(behind.preventDefault).not.toHaveBeenCalled();
    expect(getOpenFigure()).not.toBeNull();
    expect(windows()).toHaveLength(2);
    // Raised by its header, it is.
    host.act(() => raiseFigure());
    const front = escape();
    host.act(() => fire("keydown", front));
    expect(front.preventDefault).toHaveBeenCalledTimes(1);
    expect(getOpenFigure()).toBeNull();
    expect(windows().map((w) => w.id)).toEqual(["sticky-1"]);
  });

  it("is first among the document's Escape listeners, so the explain card, opened later, finds the key handled", () => {
    const host = mountHost();
    const order: string[] = [];
    document.addEventListener("keydown", ((event: { defaultPrevented: boolean }) => order.push(event.defaultPrevented ? "explain: handled, leaves it" : "explain: takes it")) as never);
    host.act(() => openFigure(ref("Figure 3")));
    const event = {
      key: "Escape",
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation: vi.fn(),
    };
    host.act(() => fire("keydown", event));
    expect(order).toEqual(["explain: handled, leaves it"]);
    expect(getOpenFigure()).toBeNull();
  });

  it("is the pure takeEscape too: false for a key it leaves, true for the one it takes", () => {
    useWindows.getState().open({ id: FIGURE_WINDOW_ID, kind: "figure", title: "Figure 3" });
    const doc = { querySelector: () => null };
    expect(takeEscape(escape(), doc)).toBe(false); // no figure open in the store
    openFigure(ref("Figure 3"));
    expect(takeEscape(escape({ key: "a" }), doc)).toBe(false);
    expect(takeEscape(escape(), { querySelector: () => ({}) })).toBe(false);
    expect(takeEscape(escape(), doc)).toBe(true);
    expect(getOpenFigure()).toBeNull();
  });
});

describe("closing: the X, Escape, the paper changing", () => {
  it("the X closes the figure and its window", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    host.act(() => dismissFigure());
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree).toBeNull();
  });

  it("closes the figure and its window when the host unmounts: the key repeats across papers", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 1")));
    expect(getOpenFigure()).not.toBeNull();
    host.unmount();
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
  });

  it("gives the focus back to where the reader pressed, if it is still on the page and the reader has not moved it", () => {
    const host = mountHost();
    const pressed = { focus: vi.fn(), isConnected: true, closest: () => null };
    active = pressed;
    host.act(() => openFigure(ref("Figure 3")));
    // The card took the focus and went: nothing has it.
    active = null;
    host.act(() => dismissFigure());
    expect(pressed.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not take the focus from where the reader has put it, nor give it to a button that left the page", () => {
    const host = mountHost();
    const pressed = { focus: vi.fn(), isConnected: true, closest: () => null };
    active = pressed;
    host.act(() => openFigure(ref("Figure 3")));
    const elsewhere = { focus: vi.fn(), isConnected: true, closest: () => null };
    active = elsewhere;
    host.act(() => dismissFigure());
    expect(pressed.focus).not.toHaveBeenCalled();
    active = pressed;
    host.act(() => openFigure(ref("Figure 4")));
    pressed.isConnected = false;
    active = null;
    host.act(() => dismissFigure());
    expect(pressed.focus).not.toHaveBeenCalled();
  });
});

describe("below the margin's width", () => {
  it("shows today's lightbox overlay where there is no margin, with no window and nothing reserved", () => {
    useMarginStore.setState({ rect: null });
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    expect(host.tree?.type).toBe(FigureOverlay);
    expect((host.tree?.props as { figure: FigureRef }).figure.key).toBe("Figure 3:3");
    expect(windows()).toEqual([]);
    // The overlay closes through the store, and the host draws nothing again.
    host.act(() => closeFigure());
    expect(host.tree).toBeNull();
  });

  // P11-41 (ruling §1h.138 (d)) RE-AIMED: this was "closes an open card when the window narrows…" and ended on `host.tree` being null. The card is no longer
  // closed by the narrowing but PARKED (it comes back when the window widens: `figure-host.narrow.test.tsx`); what stays true, and is asserted as before, is
  // that nothing is open, the card's window is out of the stack, and it does not jump into an overlay. Nothing is drawn: the stack element is still there, hidden.
  it("takes an open card out of the margin when the window narrows below the margin's width (parked, not closed); it does not jump into an overlay", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    expect(host.tree?.type).toBe(FigureStack);
    host.act(() => useMarginStore.setState({ rect: null }));
    expect(getOpenFigure()).toBeNull();
    expect(windows()).toEqual([]);
    expect(host.tree?.type).not.toBe(FigureOverlay);
    expect((host.tree?.props as { parked?: boolean }).parked).toBe(true);
  });

  it("leaves an overlay that is open when the window widens", () => {
    useMarginStore.setState({ rect: null });
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    host.act(() => useMarginStore.setState({ rect: MARGIN }));
    expect(getOpenFigure()).not.toBeNull();
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(windows()).toEqual([]);
  });

  it("a figure pressed after the window narrowed is the overlay, and the card's window stays gone", () => {
    const host = mountHost();
    host.act(() => openFigure(ref("Figure 3")));
    host.act(() => useMarginStore.setState({ rect: null }));
    expect(windows()).toEqual([]);
    host.act(() => openFigure(ref("Figure 4")));
    expect(host.tree?.type).toBe(FigureOverlay);
    expect(windows()).toEqual([]);
    expect(getOpenFigure()?.key).toBe("Figure 4:4");
  });
});

describe("FigureOverlay: today's viewer, in a portal", () => {
  class Img {
    static last: Img | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    src = "";
    constructor() {
      Img.last = this;
    }
  }
  const overlay = (figure: FigureRef) => {
    const mounted = stagedRuntime.mount(() => FigureOverlay({ figure }));
    stagedRuntime.flush();
    stagedRuntime.event(() => {});
    return {
      get out() {
        return mounted.value as unknown as { children?: ReactElement } | null;
      },
      settle: () => {
        stagedRuntime.event(() => {});
        stagedRuntime.event(() => {});
      },
      unmount: mounted.unmount,
    };
  };

  beforeEach(() => {
    Img.last = null;
    vi.stubGlobal("Image", Img);
    vi.stubGlobal("document", { ...(document as object), body: { nodeType: 1 } });
  });

  it("mounts the lightbox's FigureViewer on the document's body with the figure's picture, caption and size, closed by the store", () => {
    const opened = overlay(ref("Figure 3"));
    const viewer = opened.out?.children as ReactElement<Record<string, unknown>>;
    expect(viewer.type).toBe(FigureViewer);
    expect(viewer.props).toMatchObject({ src: "/api/figure/p1/3", alt: "Invented caption for Figure 3.", caption: "Invented caption for Figure 3.", natural: { width: 600, height: 400 }, onClose: closeFigure });
    expect(Img.last).toBeNull();
  });

  it("reads the size from the picture when neither the loaded picture nor the record had one, then shows the viewer", () => {
    const opened = overlay(ref("Figure 3", 3, { natural: null }));
    expect(opened.out).toBeNull();
    expect(Img.last?.src).toBe("/api/figure/p1/3");
    Img.last!.naturalWidth = 800;
    Img.last!.naturalHeight = 500;
    stagedRuntime.event(() => Img.last!.onload!());
    opened.settle();
    expect((opened.out?.children as ReactElement<Record<string, unknown>>).props.natural).toEqual({ width: 800, height: 500 });
  });

  it("closes the figure when the picture cannot be read", () => {
    openFigure(ref("Figure 3", 3, { natural: null }));
    overlay(getOpenFigure()!);
    stagedRuntime.event(() => Img.last!.onerror!());
    expect(getOpenFigure()).toBeNull();
  });
});

describe("the host's source", () => {
  it("listens on the document in the bubble phase, leaves a modal dialog, and does not trap anything", () => {
    const c = code(HOST);
    expect(c).toContain('document.addEventListener("keydown", onKeyDown);');
    expect(c).not.toMatch(/addEventListener\("keydown", onKeyDown, true\)/);
    expect(c).toContain("MODAL_OVER_PAGE");
    expect(c).toContain("event.defaultPrevented");
    expect(c).not.toMatch(/aria-modal|"Tab"/);
  });

  it("takes the overlay's viewer from the lightbox and passes the store's close, a stable function", () => {
    const c = code(HOST);
    expect(c).toContain('import { FigureViewer } from "./figure-lightbox";');
    expect(c).toContain("onClose={closeFigure}");
  });
});

// P11-26 rule 2 (A P11-22 X-3; ruling §1h.122): the card in front of other cards is told so, and gives its caption a fifth of itself, not three tenths.
describe("the stack tells the card that it is stacked (P11-26 rule 2; X-3)", () => {
  // `FigureStack` reads the windows through the store's own hook (zustand's, which this suite's React stand-in does not reach), so the flag it
  // hands the card is pinned in its source, and the element it builds is built by the pure `figureCardElement` below.
  it("hands the card whether any other card stands with it: more than one window in the stack", () => {
    const source = code(HOST);
    const stack = source.slice(source.indexOf("export function FigureStack"), source.indexOf("export function FigureOverlay"));
    expect(stack).toContain("figureCardElement(figure, frame, row, windows.length > 1)");
  });

  it("builds its element with the flag, the same figure's card keeping its key", () => {
    const row = { id: "figure", top: 88, height: 600, front: true, z: STACK_Z_BASE + 1 };
    const stacked = figureCardElement(ref("Figure 3"), MARGIN, row, true);
    expect((stacked.props as Record<string, unknown>).stacked).toBe(true);
    expect(stacked.key).toBe(figureCardElement(ref("Figure 3"), MARGIN, row).key);
    expect((figureCardElement(ref("Figure 3"), MARGIN, row).props as Record<string, unknown>).stacked).toBeFalsy();
  });
});
