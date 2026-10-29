import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here (this project's tests run in plain Node): the shell runs on the staged hook runtime, with `useSyncExternalStore` as a state
// and a subscription, the element tree it returns is inspected, and its handlers are called with the few members of an event they read.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  const runtime = stagedRuntime.hooks;
  const storeShim = <T,>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T => {
    const [value, setValue] = runtime.useState<T>(getSnapshot);
    runtime.useEffect(() => {
      setValue(getSnapshot());
      return subscribe(() => setValue(getSnapshot()));
    }, [subscribe]);
    return value;
  };
  return { ...actual, ...runtime, useSyncExternalStore: storeShim };
});

import { createElement, type ReactElement, type ReactNode } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { useMarginStore } from "@/lib/reader/margin";
import { useReaderPanesStore } from "@/store/reader-panes";
import { useReadingPrefsStore } from "@/store/reading-prefs";
import { PaneDivider } from "./pane-divider";
import { fitPanes, paneRange, readingCentreDragMinimum, stepPane, type PaneName, type PaneRoom } from "./pane-layout";
import { PEEK_CLOSE_MS, PEEK_OPEN_MS, ReaderShell } from "./reader-shell";

// P11-10 rule 3 (B P11-01 §2.3, §2.6, §6; ruling §1h.113 (a), D6): the left pane's three states — pinned, rail, peek — and what moves
// between them: a hover that rests 150 ms, 250 ms after the pointer leaves, Escape, a press that pins; the first visit; the window that is
// too narrow for the remembered widths; the margin that registers its rect. Every block is a marker.

type Props = Record<string, unknown> & { children?: ReactNode };
type Handler = (event?: unknown) => void;

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

/** The window, with the resize listeners a test can fire, and a document that keeps its keydown listeners. */
function browser(innerWidth: number) {
  const listeners = new Set<() => void>();
  const keydown = new Set<(event: { key: string }) => void>();
  const pointerdown = new Set<(event: { target: unknown }) => void>();
  const win = {
    innerWidth,
    innerHeight: 900,
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  let active: unknown = null;
  const doc = {
    body: { style: { userSelect: "", cursor: "" } },
    querySelector: () => null,
    get activeElement() {
      return active;
    },
    addEventListener: (type: string, cb: (event: never) => void) => (type === "keydown" ? keydown : pointerdown).add(cb as never),
    removeEventListener: (type: string, cb: (event: never) => void) => (type === "keydown" ? keydown : pointerdown).delete(cb as never),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return {
    win,
    keydown,
    pointerdown,
    resizeTo: (width: number) => {
      win.innerWidth = width;
      stagedRuntime.event(() => listeners.forEach((cb) => cb()));
    },
    focusOn: (node: unknown) => {
      active = node;
    },
  };
}

/** What the shell's refs would be in a browser. */
function nodes() {
  const focus = { rail: vi.fn(), pin: vi.fn() };
  const aside = { getBoundingClientRect: () => ({ left: 1080, width: 360 }), parentElement: null, ownerDocument: undefined };
  return {
    focus,
    aside,
    pane: { contains: (node: unknown) => node === "inside-pane" },
    cell: { contains: (node: unknown) => node === "in-cell" || node === "inside-pane" },
    rail: { focus: focus.rail },
    pin: { focus: focus.pin },
  };
}

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
const props = { left: { fixed: mark("FIXED"), scroll: mark("SCROLL") }, centre: mark("CENTRE") };

/** Render the shell as one page open: refs attached on each commit, the first commit's effects flushed. */
function open() {
  const n = nodes();
  const refs = (output: unknown) => {
    for (const element of elements(output as ReactNode)) {
      const ref = element.props.ref as { current: unknown } | undefined;
      if (!ref || typeof ref !== "object") continue;
      const cls = String(element.props.className ?? "");
      if (element.type === "aside") ref.current = n.aside;
      else if (cls.includes("reader-rail-button")) ref.current = n.rail;
      else if (cls.includes("reader-pin-button")) ref.current = n.pin;
      else if (cls.includes("reader-left-cell")) ref.current = n.cell;
      else if (cls.includes("reader-left") && element.props["data-reader-left"] !== undefined) ref.current = n.pane;
      else if (cls.includes("reader-shell")) ref.current = { style: { setProperty: vi.fn() } };
    }
  };
  const mounted = stagedRuntime.mount(() => ReaderShell(props), refs);
  stagedRuntime.flush();
  const look = () => {
    const all = elements(mounted.value as ReactNode);
    const named = (attribute: string) => all.find((e) => e.props[attribute] !== undefined);
    const shell = named("data-reader-shell")!;
    const pane = named("data-reader-left")!;
    return {
      all,
      shell,
      pane,
      cell: named("data-reader-left-cell")!,
      rail: all.find((e) => e.props["data-reader-rail"] !== undefined)!,
      pin: all.find((e) => String(e.props.className ?? "").includes("reader-pin-button"))!,
      state: pane.props["data-state"] as string,
      vars: shell.props.style as Record<string, string>,
      dividers: all.filter((e) => e.type === PaneDivider),
    };
  };
  return { ...n, mounted, look };
}

const mouse = { pointerType: "mouse" };
const touch = { pointerType: "touch" };
/** A keydown as the shell reads it: the key, whether something has handled it, and what the shell does to it. */
function keyEvent(key: string, handled = false) {
  const event = {
    key,
    defaultPrevented: handled,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
}
const call = (handler: unknown, event: unknown = {}) => (handler as Handler)(event);
/** Time passes inside an event, so that the state a timer sets is rendered. */
const wait = (ms: number) => stagedRuntime.event(() => vi.advanceTimersByTime(ms));

let env: ReturnType<typeof browser>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  env = browser(1440);
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});

// Re-aimed (ruling §1h.115 item 4, amending D6): this describe was "the first visit (D6): pinned where the defaults fit, else the rail".
describe("the first visit (D6, amended by ruling §1h.115 item 4): pinned at every width from 1024", () => {
  it("is pinned at 1440, and at exactly 1144", () => {
    expect(open().look().state).toBe("pinned");
    env.win.innerWidth = 1144;
    expect(open().look().state).toBe("pinned");
  });

  // Re-aimed: was "is the rail below 1144, with the margin and the centre keeping their widths". The owner's laptop at 125 % is 1093
  // css px, where the rail hid the title, the commands and the map on arrival.
  // P12-07/197: comfort supersedes the old always-pinned1024 expectation.
  it("keeps 476px of text: pinned289/280 at1093 and a temporary rail at1024", () => {
    env.win.innerWidth = 1093;
    const at1093 = open().look();
    expect(at1093.state).toBe("pinned");
    expect(at1093.pane.props.inert).toBe(false);
    expect(at1093.rail.props.hidden).toBe(true);
    expect(at1093.vars).toMatchObject({ "--left-pane-w": "289px", "--margin-w": "280px" });
    expect(at1093.dividers.map((d) => d.props.pane)).toEqual(["left", "margin"]);

    env.win.innerWidth = 1024;
    const at1024 = open().look();
    expect(at1024.state).toBe("rail");
    expect(at1024.vars).toMatchObject({ "--left-pane-w": "320px", "--margin-w": "360px" });
    expect(at1024.dividers.map((d) => d.props.pane)).toEqual(["margin"]);
    // Nothing is written: the first visit's pin is the shell's answer, not a choice the reader made.
    expect(useReaderPanesStore.getState()).toMatchObject({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  });

  it("a reader's remembered fold still wins at 1024 and 1093: the rail, with the margin back at its width", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    for (const width of [1024, 1093]) {
      env.win.innerWidth = width;
      const page = open().look();
      expect(page.state).toBe("rail");
      expect(page.vars["--margin-w"]).toBe("360px");
      expect(page.dividers.map((d) => d.props.pane)).toEqual(["margin"]);
    }
  });

  it("a first visit keeps pin preference and temporarily reveals a rail at1024", () => {
    const page = open();
    for (const width of [1280, 1143, 1093, 1024]) {
      env.resizeTo(width);
      expect(page.look().state).toBe(width >= 1044 ? "pinned" : "rail");
    }
  });

  it("is the reader's choice once they have made one: a pin below 1144 keeps the pane, a fold above it keeps the rail", () => {
    env.win.innerWidth = 1100;
    useReaderPanesStore.setState({ leftPinned: true });
    expect(open().look().state).toBe("pinned");
    env.win.innerWidth = 1920;
    useReaderPanesStore.setState({ leftPinned: false });
    expect(open().look().state).toBe("rail");
  });
});

describe("a window too narrow for the remembered widths", () => {
  it("squeezes the panes and writes nothing back; a bigger window gives the remembered widths again", () => {
    useReaderPanesStore.setState({ leftPinned: true, leftWidth: 400, marginWidth: 450 });
    env.win.innerWidth = 1024;
    const page = open();
    expect(page.look().vars).toMatchObject({ "--left-pane-w": "400px", "--margin-w": "450px" });
    expect(useReaderPanesStore.getState()).toMatchObject({ leftWidth: 400, marginWidth: 450 });

    env.resizeTo(1920);
    expect(page.look().vars).toMatchObject({ "--left-pane-w": "400px", "--margin-w": "450px" });
    expect(useReaderPanesStore.getState()).toMatchObject({ leftWidth: 400, marginWidth: 450 });
  });

  // Re-aimed (P12-95 rule 2, the owner's O1; ruling §1h.484): was "hands each divider the scaled centre budget" - `centreMinimum: 500`, the
  // reading budget at the default step. A divider's range is what a reader may DRAG to, so its room is the drag floor, 434 at this step.
  it("hands each divider the scaled drag floor as well as the other pane", () => {
    useReaderPanesStore.setState({ leftPinned: true });
    const [left, margin] = open().look().dividers;
    expect(left.props.room).toEqual({ viewport: 1440, other: 360, centreMinimum: 434 });
    expect(margin.props.room).toEqual({ viewport: 1440, other: 320, centreMinimum: 434 });
  });

  // Re-aimed (P12-95 rule 2): the same, 500 to 434.
  it("the margin's room is the rail's 48 px when the left pane is the rail", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    const [margin] = open().look().dividers;
    expect(margin.props.room).toEqual({ viewport: 1440, other: 48, centreMinimum: 434 });
  });
});

// P12-95 rule 3 (the owner's O1; ruling §1h.484): what a first visit shows does not change, and a width the reader saved may take the
// centre down to the drag floor (434 px at the default step, 676 at the largest) instead of being given back to the reading budget.
describe("the reading budget and the drag floor, as the shell fits them (P12-95)", () => {
  afterEach(() => useReadingPrefsStore.setState({ scaleIndex: 2 }));

  it("853 at the default step: a first visit shows the margin at 281 (the text column 468); the reader's saved 347 is kept, and a saved left width alone changes nothing", () => {
    env.win.innerWidth = 853;
    expect(open().look().vars).toMatchObject({ "--margin-w": "281px" });
    useReaderPanesStore.setState({ marginWidth: 347 });
    expect(open().look().vars).toMatchObject({ "--margin-w": "347px" });
    useReaderPanesStore.setState({ marginWidth: undefined, leftWidth: 400 });
    expect(open().look().vars).toMatchObject({ "--margin-w": "281px" });
  });

  it("1366 at the largest step: a first visit has the left pane at 276 and the margin at 280; a saved margin of 390 is kept and the left pane keeps its 276", () => {
    useReadingPrefsStore.setState({ scaleIndex: 7 });
    env.win.innerWidth = 1366;
    expect(open().look().vars).toMatchObject({ "--left-pane-w": "276px", "--margin-w": "280px" });
    useReaderPanesStore.setState({ marginWidth: 390 });
    expect(open().look().vars).toMatchObject({ "--left-pane-w": "276px", "--margin-w": "390px" });
  });
});

// P12-95 rule 2: both dividers' ranges let the centre go down to the drag floor, never below - at the step the reader reads at.
describe("the dividers' ranges end at the drag floor (P12-95 rule 2)", () => {
  afterEach(() => useReadingPrefsStore.setState({ scaleIndex: 2 }));
  const rangeOf = (divider: { props: Record<string, unknown> }) => paneRange(divider.props.pane as PaneName, divider.props.room as PaneRoom);

  it("853 at the default step: the margin divider's range is 280 to 347 (it was 280 to 281), End reaches 347 and leaves the centre 434", () => {
    env.win.innerWidth = 853;
    const [margin] = open().look().dividers;
    expect(rangeOf(margin)).toEqual({ min: 280, max: 347 });
    const end = stepPane("margin", 281, "End", false, margin.props.room as PaneRoom);
    expect(end).toBe(347);
    expect(fitPanes({ viewport: 853, margin: end!, centreMinimum: 500, centreDragMinimum: 434 }).centre).toBe(434);
  });

  it("1366 at the largest step: the margin divider's range ends at 390 (the left pane at its 276), the left divider's at 386 (the margin at its 280): the centre 676 either way", () => {
    useReadingPrefsStore.setState({ scaleIndex: 7 });
    env.win.innerWidth = 1366;
    const [left, margin] = open().look().dividers;
    expect(left.props.pane).toBe("left");
    expect(rangeOf(margin)).toEqual({ min: 280, max: 390 });
    expect(rangeOf(left)).toEqual({ min: 240, max: 386 });
    expect(1366 - 24 - 276 - 390).toBe(readingCentreDragMinimum(1.6));
    expect(1366 - 24 - 386 - 280).toBe(readingCentreDragMinimum(1.6));
    expect(readingCentreDragMinimum(1.6)).toBe(676);
  });
});

describe("the dividers write the reader's choice, once", () => {
  it("the left divider's commit is the left pane's width in the store; the margin's is the margin's", () => {
    useReaderPanesStore.setState({ leftPinned: true });
    const [left, margin] = open().look().dividers;
    call(left.props.onCommit, 400);
    call(margin.props.onCommit, 450);
    expect(useReaderPanesStore.getState()).toMatchObject({ leftWidth: 400, marginWidth: 450 });
  });

  it("both dividers write to the grid element, by the custom property the grid reads", () => {
    useReaderPanesStore.setState({ leftPinned: true });
    const [left, margin] = open().look().dividers;
    expect([left.props.variable, margin.props.variable]).toEqual(["--left-pane-w", "--margin-w"]);
    expect(left.props.target).toBe(margin.props.target);
  });
});

describe("the peek (D6): hover rests 150 ms, 250 ms after leaving, Escape", () => {
  const railed = () => {
    useReaderPanesStore.setState({ leftPinned: false });
    return open();
  };

  it("opens after the pointer has rested on the rail for 150 ms, not before", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS - 1);
    expect(page.look().state).toBe("rail");
    wait(1);
    expect(page.look().state).toBe("peek");
    expect(page.look().pane.props.inert).toBe(false);
    expect(page.look().shell.props["data-left-state"]).toBe("peek");
    expect(PEEK_OPEN_MS).toBe(150);
  });

  it("does not open if the pointer leaves the rail first", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(100);
    stagedRuntime.event(() => call(page.look().cell.props.onPointerLeave, mouse));
    wait(500);
    expect(page.look().state).toBe("rail");
  });

  it("a touch does not rest on anything: no peek from hover", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, touch));
    wait(1000);
    expect(page.look().state).toBe("rail");
  });

  it("shows the pane over the centre without moving a track: the grid's left track stays the rail's", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    // The widths the grid is given do not change with the state; globals.css keys the left track on data-left-state.
    expect(page.look().vars).toMatchObject({ "--left-pane-w": "320px", "--margin-w": "360px" });
    expect(page.look().shell.props["data-left-state"]).toBe("peek");
  });

  it("closes 250 ms after the pointer leaves it, not before", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.event(() => call(page.look().cell.props.onPointerLeave, mouse));
    wait(PEEK_CLOSE_MS - 1);
    expect(page.look().state).toBe("peek");
    wait(1);
    expect(page.look().state).toBe("rail");
    expect(PEEK_CLOSE_MS).toBe(250);
  });

  it("stays open if the pointer comes back within the 250 ms", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.event(() => call(page.look().cell.props.onPointerLeave, mouse));
    wait(200);
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(1000);
    expect(page.look().state).toBe("peek");
  });

  it("stays open while focus is inside the pane, and closes once it leaves", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.event(() => call(page.look().pane.props.onFocus));
    stagedRuntime.event(() => call(page.look().cell.props.onPointerLeave, mouse));
    wait(1000);
    expect(page.look().state).toBe("peek");

    stagedRuntime.event(() => call(page.look().pane.props.onBlur, { relatedTarget: null }));
    wait(PEEK_CLOSE_MS);
    expect(page.look().state).toBe("rail");
  });

  it("a blur to something inside the pane is not leaving it", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.event(() => call(page.look().pane.props.onFocus));
    stagedRuntime.event(() => call(page.look().cell.props.onPointerLeave, mouse));
    stagedRuntime.event(() => call(page.look().pane.props.onBlur, { relatedTarget: "inside-pane" }));
    wait(1000);
    expect(page.look().state).toBe("peek");
  });

  it("closes on Escape at once, and gives the focus back to the rail if it was in the pane", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.flush();
    expect(env.keydown.size).toBe(1);

    env.focusOn("inside-pane");
    stagedRuntime.event(() => env.keydown.forEach((cb) => cb(keyEvent("Escape"))));
    expect(page.look().state).toBe("rail");
    expect(page.focus.rail).toHaveBeenCalled();
  });

  it("listens for Escape only while it peeks, and ignores every other key", () => {
    const page = railed();
    expect(env.keydown.size).toBe(0);
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.flush();
    stagedRuntime.event(() => env.keydown.forEach((cb) => cb(keyEvent("a"))));
    expect(page.look().state).toBe("peek");
    stagedRuntime.event(() => env.keydown.forEach((cb) => cb(keyEvent("Escape"))));
    stagedRuntime.flush();
    expect(env.keydown.size).toBe(0);
  });

  // P11-16 follow-up (ruling §1h.115, item 1): Escape closed a peek AND ran the page's own Escape — "back to the briefing" — so a reader who
  // opened the left pane and pressed Escape was taken off the paper (measured at 28 of 28 windows). `keyboard.tsx` listens on the WINDOW;
  // the shell listens on the document, which a key meets first, so a key the shell prevents and stops never reaches the page.
  describe("Escape in a peek goes no further", () => {
    /** The page's "back to the briefing": what `keyboard.tsx`'s window listener would do with the key. */
    const back = vi.fn();
    /** A key as the browser delivers it: the document's listeners first, then — unless one stopped it — the window's. */
    const press = (key: string, handled = false) => {
      const event = keyEvent(key, handled);
      stagedRuntime.event(() => {
        env.keydown.forEach((cb) => cb(event));
        if (!event.stopped) back(event);
      });
      return event;
    };
    const peeking = () => {
      back.mockClear();
      const page = railed();
      stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
      wait(PEEK_OPEN_MS);
      stagedRuntime.flush();
      expect(page.look().state).toBe("peek");
      return page;
    };

    it("closes the peek and the page's back does not run: the key is prevented and its propagation stopped", () => {
      const page = peeking();

      const event = press("Escape");

      expect(page.look().state).toBe("rail");
      expect(event.defaultPrevented).toBe(true);
      expect(event.stopped).toBe(true);
      expect(back).not.toHaveBeenCalled();
    });

    it("leaves a key something else has already handled: the peek stays, and the key is not taken again", () => {
      const page = peeking();

      const event = press("Escape", true);

      expect(page.look().state).toBe("peek");
      expect(event.stopped).toBe(false);
    });

    it("takes no other key: a letter reaches the page", () => {
      const page = peeking();

      const event = press("j");

      expect(page.look().state).toBe("peek");
      expect(event.defaultPrevented).toBe(false);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("takes no Escape with no peek open: the page's own Escape is the page's", () => {
      back.mockClear();
      railed();
      expect(env.keydown.size).toBe(0);

      press("Escape");

      expect(back).toHaveBeenCalledTimes(1);
    });

    it("rests on the page's own shape: `keyboard.tsx` handles Escape in a window listener, in the bubble phase, after the document's", () => {
      const keyboard = readFileSync(resolve(process.cwd(), "src/components/keyboard.tsx"), "utf8");

      expect(keyboard).toContain('window.addEventListener("keydown", handler);');
      expect(keyboard).not.toMatch(/window\.addEventListener\("keydown", handler, (?:true|\{)/);
      expect(keyboard).toContain('if (onPaperPage() && runReaderKey(e.key, e)) return;');
    });
  });

  it("closes at once when a press lands outside the pane (a touch screen has no pointer to leave it), and not when it lands inside", () => {
    const page = railed();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    stagedRuntime.flush();
    expect(env.pointerdown.size).toBe(1);

    // The cell is `contains`-checked through its ref; the fake cell holds only the string "in-cell".
    stagedRuntime.event(() => env.pointerdown.forEach((cb) => cb({ target: "in-cell" })));
    expect(page.look().state).toBe("peek");
    stagedRuntime.event(() => env.pointerdown.forEach((cb) => cb({ target: "in-the-centre" })));
    expect(page.look().state).toBe("rail");
    stagedRuntime.flush();
    expect(env.pointerdown.size).toBe(0);
  });

  it("a pointer resting on a pinned pane starts nothing", () => {
    const page = open();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(1000);
    expect(page.look().state).toBe("pinned");
  });
});

describe("a press pins it; the pin button folds it", () => {
  it("a press on the rail pins the left pane and remembers it", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    const page = open();
    stagedRuntime.event(() => call(page.look().rail.props.onPointerDown, mouse));
    stagedRuntime.event(() => call(page.look().rail.props.onClick));
    expect(useReaderPanesStore.getState().leftPinned).toBe(true);
    expect(page.look().state).toBe("pinned");
    // The focus follows the button that went out of sight: to the pane's own.
    stagedRuntime.flush();
    expect(page.focus.pin).toHaveBeenCalled();
  });

  it("pins from the keyboard too (a click with no pointer-down)", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    const page = open();
    stagedRuntime.event(() => call(page.look().rail.props.onClick));
    expect(page.look().state).toBe("pinned");
  });

  it("a press while it peeks pins it, and a pinned pane that is folded again does not peek", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    const page = open();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    expect(page.look().state).toBe("peek");
    expect(page.look().pin.props["aria-label"]).toBe("Pin sidebar");
    stagedRuntime.event(() => call(page.look().pin.props.onClick));
    expect(page.look().state).toBe("pinned");

    stagedRuntime.event(() => call(page.look().pin.props.onClick));
    expect(useReaderPanesStore.getState().leftPinned).toBe(false);
    expect(page.look().state).toBe("rail");
  });

  it("the pin button folds a pinned pane to the rail, remembers it, and hands the focus to the rail", () => {
    const page = open();
    expect(page.look().pin.props["aria-label"]).toBe("Collapse sidebar");
    stagedRuntime.event(() => call(page.look().pin.props.onClick));
    expect(useReaderPanesStore.getState().leftPinned).toBe(false);
    expect(page.look().state).toBe("rail");
    stagedRuntime.flush();
    expect(page.focus.rail).toHaveBeenCalled();
  });

  it("on a touch screen the press on the rail peeks (there is no hover to rest on), and a second press puts it away", () => {
    useReaderPanesStore.setState({ leftPinned: false });
    const page = open();
    stagedRuntime.event(() => call(page.look().rail.props.onPointerDown, touch));
    stagedRuntime.event(() => call(page.look().rail.props.onClick));
    expect(page.look().state).toBe("peek");
    expect(useReaderPanesStore.getState().leftPinned).toBe(false);
    stagedRuntime.event(() => call(page.look().rail.props.onClick));
    expect(page.look().state).toBe("rail");
  });
});

describe("one DOM node: the pane's blocks stand in the same place in the tree in every state (nothing remounts)", () => {
  /** The child-index path from the root to the element carrying `marker`. */
  function pathTo(node: ReactNode, marker: string, path: number[] = []): number[] | null {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = pathTo(node[i], marker, [...path, i]);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const element = node as ReactElement<Props>;
    if (element.props["data-mark"] === marker) return path;
    return pathTo(element.props.children, marker, path);
  }

  it("FIXED, SCROLL and CENTRE keep their paths through pinned, rail and peek", () => {
    const page = open();
    const seen: Record<string, string[]> = { FIXED: [], SCROLL: [], CENTRE: [] };
    const sample = () => {
      for (const name of Object.keys(seen)) seen[name].push(JSON.stringify(pathTo(page.mounted.value as ReactNode, name)));
    };
    sample();
    stagedRuntime.event(() => call(page.look().pin.props.onClick));
    expect(page.look().state).toBe("rail");
    sample();
    stagedRuntime.event(() => call(page.look().cell.props.onPointerEnter, mouse));
    wait(PEEK_OPEN_MS);
    expect(page.look().state).toBe("peek");
    sample();
    stagedRuntime.event(() => call(page.look().pin.props.onClick));
    expect(page.look().state).toBe("pinned");
    sample();
    for (const name of Object.keys(seen)) {
      expect(new Set(seen[name]).size).toBe(1);
      expect(seen[name][0]).not.toBe("null");
    }
  });
});

describe("the margin's rect", () => {
  it("is registered when the shell has mounted: the aside's horizontal extent and the viewport's band", () => {
    expect(useMarginStore.getState().rect).toBeNull();
    open();
    expect(useMarginStore.getState().rect).toEqual({ left: 1080, width: 360, top: 48, bottom: 860 });
  });

  it("is given up when the shell goes", () => {
    const page = open();
    page.mounted.unmount();
    expect(useMarginStore.getState().rect).toBeNull();
  });
});
