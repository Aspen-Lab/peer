import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here (this project's tests run in plain Node): the shell runs on the staged hook runtime with `useSyncExternalStore` as a state and a subscription, as
// `reader-shell.rail.test.tsx` has it; the document records the listeners the shell's hook puts on it, and the test dispatches pointer events to them in the capture order
// a browser would.
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
import { ReaderShell } from "./reader-shell";

// P11-45b (the manager's follow-up to P11-45; ruling §1h.148's aim): a drag-select that starts in the paper's text column and is released anywhere outside it ends at
// the column's nearest edge, at the pointer's height — through the real shell, with the hook's one call (`keep-selection.ts`). The place of each release is one of the
// manager's list: over the margin, over a card, over the left pane, over a separator, beyond the window's edge, below the window's foot — and the masthead.
//
// Measured in the browser on the base (1280 x 720, invented paper), the same releases, in characters (the toolbar offers its buttons up to 1,200): margin 12 and 23 px past
// the line's end (the separator, P11-45's clamp) 72; 40, 100, 300 px 36,977; over a sticky note in the margin 36,786 to 36,794; 40 and 120 px before the line's start (the
// left pane) 20,285; below the foot and past the column 36,610; over the masthead 20,668.

type Handler = (event: unknown) => void;
type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
const props = { left: { fixed: mark("FIXED"), scroll: mark("SCROLL") }, centre: mark("CENTRE") };

const COLUMN = { left: 356, right: 908 };
const HEIGHT = 720;

/** A target as the page finds it: a node of the paper's column (with or without a control around it) or of something else. */
const text = { inColumn: true, closest: () => null };
const control = { inColumn: true, closest: () => ({ inColumn: true }) };
const elsewhere = (name: string) => ({ inColumn: false, name, closest: () => null });

interface Selection {
  rangeCount: number;
  isCollapsed: boolean;
  anchorNode: unknown;
  anchorOffset: number;
  focusNode: unknown;
  focusOffset: number;
  extend: ReturnType<typeof vi.fn>;
  collapse: ReturnType<typeof vi.fn>;
}

let listeners: Record<string, Array<{ run: Handler; capture: unknown }>>;
let frames: Array<(() => void) | null>;
let selection: Selection;
let caret: ReturnType<typeof vi.fn>;

const column = {
  getBoundingClientRect: () => ({ left: COLUMN.left, right: COLUMN.right, width: COLUMN.right - COLUMN.left, top: 0, bottom: 20000, height: 20000 }),
  contains: (node: unknown) => (node as { inColumn?: boolean } | null)?.inColumn === true,
  ownerDocument: { querySelector: () => null },
};

function browser() {
  listeners = {};
  frames = [];
  selection = { rangeCount: 1, isCollapsed: false, anchorNode: text, anchorOffset: 0, focusNode: null, focusOffset: 0, extend: vi.fn(), collapse: vi.fn() };
  caret = vi.fn((x: number, y: number) => {
    if (y < 48) return { offsetNode: elsewhere("masthead"), offset: 0 };
    if (y > HEIGHT - 29) return { offsetNode: elsewhere("legend"), offset: 0 };
    if (x < COLUMN.left || x > COLUMN.right) return { offsetNode: elsewhere("aside, a card or the left pane"), offset: 0 };
    return { offsetNode: { inColumn: true, at: [x, y] }, offset: 0 };
  });
  const win = {
    innerWidth: 1280,
    innerHeight: HEIGHT,
    scrollY: 8000,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    getSelection: () => selection,
  };
  const doc = {
    body: { style: { userSelect: "", cursor: "" } },
    activeElement: null,
    documentElement: { clientHeight: HEIGHT, scrollHeight: 25000 },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    caretPositionFromPoint: caret,
    addEventListener: (type: string, run: Handler, capture?: unknown) => {
      (listeners[type] ??= []).push({ run, capture });
    },
    removeEventListener: (type: string, run: Handler) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l.run !== run);
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run) - 1);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id] = null;
  });
}

/** One page open: the shell, its grid holding the column, the first commit's effects flushed. */
function open() {
  browser();
  const grid = { style: { setProperty: vi.fn() }, querySelector: (selector: string) => (selector === "[data-reader-centre-inner]" ? column : null) };
  const aside = { getBoundingClientRect: () => ({ left: 920, width: 360 }), parentElement: null, ownerDocument: undefined };
  const focus = { focus: vi.fn() };
  const mounted = stagedRuntime.mount(
    () => ReaderShell(props) as ReactElement<Props>,
    (output) => {
      for (const element of elements(output as ReactNode)) {
        const ref = element.props.ref as { current: unknown } | undefined;
        if (!ref || typeof ref !== "object") continue;
        const cls = String(element.props.className ?? "");
        if (element.type === "aside") ref.current = aside;
        else if (cls.includes("reader-rail-button") || cls.includes("reader-pin-button")) ref.current = focus;
        else if (cls.includes("reader-left-cell") || (cls.includes("reader-left") && element.props["data-reader-left"] !== undefined)) ref.current = { contains: () => false };
        else if (cls.includes("reader-shell")) ref.current = grid;
      }
    },
  );
  stagedRuntime.flush();
  return mounted;
}

/** A pointer event, dispatched to the document's capture listeners of that type. */
function dispatch(type: string, over: Record<string, unknown> = {}) {
  const event = { type, pointerType: "mouse", pointerId: 1, isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: 600, clientY: 300, target: text, ...over };
  (listeners[type] ?? []).filter((l) => l.capture === true).forEach((l) => l.run(event));
}
const runFrames = () => frames.splice(0).forEach((run) => run?.());

/** A drag from the line's start in the paper's text to (x, y), released there. */
function dragTo(x: number, y: number, over: Record<string, unknown> = {}) {
  dispatch("pointerdown", { clientX: COLUMN.left + 3, clientY: y, ...over });
  for (const step of [0.25, 0.5, 0.75, 1]) dispatch("pointermove", { clientX: COLUMN.left + 3 + (x - COLUMN.left - 3) * step, clientY: y, target: elsewhere("under the pointer") });
  runFrames();
  dispatch("pointerup", { clientX: x, clientY: y, target: elsewhere("under the pointer") });
  runFrames();
}
const endedAt = () => (selection.extend.mock.calls.at(-1)?.[0] as { at: number[] } | undefined)?.at ?? null;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});

describe("a drag-select that began in the paper's text, released outside the column", () => {
  it.each([
    ["over a separator (12 px past the line's end)", COLUMN.right + 12, 300, [COLUMN.right - 1, 300]],
    ["over the margin's aside (40 px past)", COLUMN.right + 40, 300, [COLUMN.right - 1, 300]],
    ["over a card in the margin (100 px past)", COLUMN.right + 100, 392, [COLUMN.right - 1, 392]],
    ["far over the margin (300 px past)", COLUMN.right + 300, 472, [COLUMN.right - 1, 472]],
    ["over a separator before the line's start (12 px)", COLUMN.left - 12, 360, [COLUMN.left + 1, 360]],
    ["over the left pane (40 px before the line's start)", COLUMN.left - 40, 360, [COLUMN.left + 1, 360]],
    ["over the left pane (120 px before)", COLUMN.left - 120, 541, [COLUMN.left + 1, 541]],
    ["beyond the window's right edge", 1400, 300, [COLUMN.right - 1, 300]],
    ["beyond the window's left edge", -30, 300, [COLUMN.left + 1, 300]],
  ])("%s: the selection ends at the column's edge, at the pointer's height", (_name, x, y, expected) => {
    open();
    dragTo(x as number, y as number);
    expect(endedAt()).toEqual(expected);
  });

  it("below the window's foot, in the column's x or past it: the last visible line, above the legend that covers the foot", () => {
    open();
    dragTo(700, HEIGHT + 60);
    const inX = endedAt()!;
    expect(inX[0]).toBe(700);
    // Re-aimed by P11-62: was `toBeLessThan(HEIGHT - 29)` (the call stood at 689, six rows' search up from `innerHeight - 1`); the last visible row is now the one above the legend's top edge, exactly.
    expect(inX[1]).toBe(HEIGHT - 29);
    selection.extend.mockClear();
    dragTo(COLUMN.right + 80, HEIGHT + 60);
    expect(endedAt()![0]).toBe(COLUMN.right - 1);
    expect(endedAt()![1]).toBe(HEIGHT - 29); // re-aimed by P11-62 as above: was toBeLessThan
  });

  it("over the masthead: the first line under its foot", () => {
    open();
    dragTo(700, 20);
    expect(endedAt()![1]).toBeGreaterThanOrEqual(49);
  });

  it("makes the correction in a frame, after the browser's own move of the end: nothing is extended in the event, and four moves in a frame make one", () => {
    open();
    dispatch("pointerdown", { clientX: COLUMN.left + 3 });
    for (const x of [930, 960, 990, 1020]) dispatch("pointermove", { clientX: x, target: elsewhere("margin") });
    expect(selection.extend).not.toHaveBeenCalled();
    runFrames();
    expect(selection.extend).toHaveBeenCalledTimes(1);
  });

  it("over the column the browser is right: a drag that stays inside the column is not touched", () => {
    open();
    dragTo(COLUMN.right - 30, 300);
    expect(selection.extend).not.toHaveBeenCalled();
  });
});

describe("what is left as it was", () => {
  it.each([
    ["a card's own text", elsewhere("a card's own text")],
    ["the notes editor", elsewhere("the notes editor")],
    ["the left pane's title", elsewhere("the left pane's title")],
    ["the map", elsewhere("the map")],
    ["a separator (its own drag)", elsewhere("a separator")],
  ])("a press that begins in %s and ends over the column or beside it is not followed", (_name, target) => {
    open();
    selection.anchorNode = target; // the selection began there
    dragTo(COLUMN.right + 100, 300, { target });
    dragTo(COLUMN.left + 100, 300, { target });
    expect(selection.extend).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
  });

  it("a press on a control inside the column (a link, a button) is the control's", () => {
    open();
    dragTo(COLUMN.right + 100, 300, { target: control });
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a touch, a pen, the secondary button", () => {
    open();
    dragTo(COLUMN.right + 100, 300, { pointerType: "touch" });
    dragTo(COLUMN.right + 100, 300, { pointerType: "pen" });
    dragTo(COLUMN.right + 100, 300, { button: 2 });
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a selection that did not begin in the column is not moved even by a press that did", () => {
    open();
    selection.anchorNode = elsewhere("the left pane's title");
    dragTo(COLUMN.right + 100, 300);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a cancelled pointer ends the press", () => {
    open();
    dispatch("pointerdown");
    dispatch("pointermove", { clientX: 1100, target: elsewhere("margin") });
    dispatch("pointercancel");
    runFrames();
    dispatch("pointermove", { clientX: 1200, target: elsewhere("margin") });
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
  });
});

// P11-57 (ruling §1h.165): a Shift+click outside the column, with a selection that began in it standing, ends that selection at the column's edge, as a drag's release does —
// through the real shell and the hook's one call. The browser's own extension has happened by the frame; what it left is what the test sets between the press and the frame.
//
// Measured in the browser on the base (`6b02956c`), 1280 x 720, a click on a word 60 px into a full line and a Shift+click, in characters: 12 to 23 px past the line's end
// (the margin's separator, whose own press is taken and which leaves the caret as it was) 0; 40, 100 and 300 px past (the margin's aside) 39,208 and no buttons; 40 and 120 px
// before the line's start (the left pane) 17,816 to 17,828.
describe("a Shift+click outside the column, with a selection that began in it standing", () => {
  /** What a click on a word leaves: a caret in the paper's text. */
  const caretInText = () => {
    selection.isCollapsed = true;
    selection.anchorNode = text;
    selection.anchorOffset = 11;
    selection.focusNode = text;
    selection.focusOffset = 11;
  };
  /** A Shift+press at (x, y), the frame after it, the release there and its frame. */
  function shiftClick(x: number, y: number, over: Record<string, unknown> = {}) {
    const at = { clientX: x, clientY: y, shiftKey: true, target: elsewhere("under the pointer"), ...over };
    dispatch("pointerdown", at);
    runFrames();
    dispatch("pointerup", at);
    runFrames();
  }

  it.each([
    ["over the margin's separator (12 px past the line's end)", COLUMN.right + 12, 300, [COLUMN.right - 1, 300]],
    ["over the margin's separator (23 px past)", COLUMN.right + 23, 300, [COLUMN.right - 1, 300]],
    ["over the margin's aside (40 px past)", COLUMN.right + 40, 300, [COLUMN.right - 1, 300]],
    ["over a card in the margin (100 px past)", COLUMN.right + 100, 392, [COLUMN.right - 1, 392]],
    ["far over the margin (300 px past)", COLUMN.right + 300, 472, [COLUMN.right - 1, 472]],
    ["over the left separator (12 px before the line's start)", COLUMN.left - 12, 360, [COLUMN.left + 1, 360]],
    ["over the left pane (40 px before)", COLUMN.left - 40, 360, [COLUMN.left + 1, 360]],
    ["over the left pane (120 px before)", COLUMN.left - 120, 541, [COLUMN.left + 1, 541]],
    ["beyond the window's right edge", 1400, 300, [COLUMN.right - 1, 300]],
    ["beyond the window's left edge", -30, 300, [COLUMN.left + 1, 300]],
  ])("%s: the selection ends at the column's edge, at the pointer's height", (_name, x, y, expected) => {
    open();
    caretInText();
    shiftClick(x as number, y as number);
    expect(endedAt()).toEqual(expected);
  });

  it("below the window's foot and over the masthead: the last visible line above the legend, the first under the masthead's foot", () => {
    open();
    caretInText();
    shiftClick(COLUMN.right + 80, HEIGHT + 60);
    expect(endedAt()![0]).toBe(COLUMN.right - 1);
    expect(endedAt()![1]).toBe(HEIGHT - 29); // re-aimed by P11-62 as above: was toBeLessThan
    selection.extend.mockClear();
    shiftClick(COLUMN.left - 80, 20);
    expect(endedAt()![1]).toBeGreaterThanOrEqual(49);
  });

  it("makes the correction in the frame after the press, after the browser's own extension: nothing in the event, and the moves of a click that was not quite still make one", () => {
    open();
    caretInText();
    dispatch("pointerdown", { clientX: COLUMN.right + 40, clientY: 300, shiftKey: true, target: elsewhere("margin") });
    expect(selection.extend).not.toHaveBeenCalled();
    for (const x of [COLUMN.right + 41, COLUMN.right + 42, COLUMN.right + 43]) dispatch("pointermove", { clientX: x, clientY: 300, shiftKey: true, target: elsewhere("margin") });
    runFrames();
    expect(selection.extend).toHaveBeenCalledTimes(1);
  });

  it("the browser collapsed the selection into the margin on the press: it is restored from the anchor read at the press, then ended at the edge", () => {
    open();
    caretInText();
    dispatch("pointerdown", { clientX: COLUMN.right + 40, clientY: 300, shiftKey: true, target: elsewhere("margin") });
    selection.isCollapsed = true;
    selection.anchorNode = elsewhere("the aside");
    selection.focusNode = elsewhere("the aside");
    runFrames();
    expect(selection.collapse).toHaveBeenCalledWith(text, 11);
    expect(endedAt()).toEqual([COLUMN.right - 1, 300]);
    expect(selection.collapse.mock.invocationCallOrder[0]).toBeLessThan(selection.extend.mock.invocationCallOrder[0]);
  });

  it("a range that stands (a line selected by a drag) is extended from its own anchor: nothing is restored", () => {
    open();
    selection.isCollapsed = false;
    selection.anchorNode = text;
    selection.focusNode = text;
    shiftClick(COLUMN.right + 100, 300);
    expect(endedAt()).toEqual([COLUMN.right - 1, 300]);
    expect(selection.collapse).not.toHaveBeenCalled();
  });

  it("a Shift+click inside the column is the browser's: its press is in the text, the pointer is over the column, nothing is touched", () => {
    open();
    caretInText();
    shiftClick(COLUMN.right - 30, 300, { target: text });
    expect(selection.extend).not.toHaveBeenCalled();
    expect(selection.collapse).not.toHaveBeenCalled();
  });

  it("a Shift+click on a control outside the column (the notes tab, a link of the map, a button of a card) is the control's", () => {
    open();
    caretInText();
    shiftClick(COLUMN.right + 100, 300, { target: { inColumn: false, closest: () => ({ name: "a control" }) } });
    expect(selection.extend).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
  });

  it.each([
    ["a card's own text", () => Object.assign(selection, { anchorNode: elsewhere("a card's own text") })],
    ["the notes editor", () => Object.assign(selection, { anchorNode: elsewhere("the notes editor") })],
    ["no selection", () => Object.assign(selection, { rangeCount: 0, anchorNode: null })],
  ])("with no selection that began in the column standing (%s): the browser's own, nothing is touched", (_name, set) => {
    open();
    caretInText();
    set();
    shiftClick(COLUMN.right + 100, 300);
    expect(selection.extend).not.toHaveBeenCalled();
    expect(selection.collapse).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
  });

  it("a text field's own caret (the question field has the focus) is not a selection of the paper: nothing is touched", () => {
    open();
    caretInText();
    (document as unknown as { activeElement: unknown }).activeElement = { matches: (selector: string) => selector.includes("textarea") };
    shiftClick(COLUMN.right + 100, 300);
    expect(selection.extend).not.toHaveBeenCalled();
    expect(selection.collapse).not.toHaveBeenCalled();
  });

  it("a press that puts a text field in focus (the notes window's text turns into its editor on a click) is the field's: nothing is touched at the frame after", () => {
    open();
    caretInText();
    dispatch("pointerdown", { clientX: COLUMN.right + 40, clientY: 300, shiftKey: true, target: elsewhere("the notes window's text") });
    (document as unknown as { activeElement: unknown }).activeElement = { matches: (selector: string) => selector.includes("[contenteditable]") };
    dispatch("pointerup", { clientX: COLUMN.right + 40, clientY: 300, shiftKey: true, target: elsewhere("the notes window's text") });
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
    expect(selection.collapse).not.toHaveBeenCalled();
  });

  it("a press outside the column without Shift is as before: not followed, whatever stands", () => {
    open();
    caretInText();
    shiftClick(COLUMN.right + 100, 300, { shiftKey: false });
    expect(selection.extend).not.toHaveBeenCalled();
    expect(selection.collapse).not.toHaveBeenCalled();
  });

  it("a touch, a pen, the secondary button", () => {
    open();
    caretInText();
    shiftClick(COLUMN.right + 100, 300, { pointerType: "touch" });
    shiftClick(COLUMN.right + 100, 300, { pointerType: "pen" });
    shiftClick(COLUMN.right + 100, 300, { button: 2 });
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a drag that began in the text, with Shift held, is the drag's: corrected as before, at its release", () => {
    open();
    selection.isCollapsed = false;
    dragTo(COLUMN.right + 100, 300, { shiftKey: true });
    expect(endedAt()).toEqual([COLUMN.right - 1, 300]);
  });
});

// P11-62 (ruling §1h.173; round 5, Theme B walk E-4): a release over the foot legend, in the column's x, ends the selection at the last visible line above the legend, as a
// release below the window does — through the real shell. The legend covers the window's last 28 rows (the caret stub above answers its words from y 692 down at 720 high).
//
// Measured in the browser on the base (`b6aa9c22`), 1024 x 768 to 1920 x 1080, light and dark, with and without a key: a drag released at any height over the legend, in the
// column's x, ran to the end of the paper (70,018 to 70,145 characters on the walk's paper) with no button offered; 1 px above the legend, or over the margin or the left pane at
// the same heights, it ended on the last visible line (128 to 445 and 102 to 761 characters, the buttons offered).
describe("a release over the foot legend", () => {
  const LAST = HEIGHT - 28 - 1;
  const caretInText = () => Object.assign(selection, { isCollapsed: true, anchorNode: text, anchorOffset: 11, focusNode: text, focusOffset: 11 });

  it.each([HEIGHT - 28, HEIGHT - 20, HEIGHT - 10, HEIGHT - 1])("at y %i, in the column's x: the selection ends at the last visible line above the legend, not where the browser put it", (y) => {
    open();
    dragTo(700, y);
    expect(endedAt()).toEqual([700, LAST]);
  });

  it("over the margin and over the left pane at the same heights: the column's edge, at the same last visible line", () => {
    open();
    dragTo(COLUMN.right + 160, HEIGHT - 20);
    expect(endedAt()).toEqual([COLUMN.right - 1, LAST]);
    dragTo(60, HEIGHT - 1);
    expect(endedAt()).toEqual([COLUMN.left + 1, LAST]);
  });

  it("below the window: the same last visible line", () => {
    open();
    dragTo(700, HEIGHT + 60);
    expect(endedAt()).toEqual([700, LAST]);
  });

  it("1 px above the legend, in the column's x: the browser's, nothing is touched", () => {
    open();
    dragTo(700, LAST);
    dragTo(700, 300);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a Shift+click over the legend in the column's x, with a caret in the text: the selection runs to the last visible line above the legend", () => {
    open();
    caretInText();
    const at = { clientX: 700, clientY: HEIGHT - 14, shiftKey: true, target: elsewhere("the legend") };
    dispatch("pointerdown", at);
    runFrames();
    dispatch("pointerup", at);
    runFrames();
    expect(endedAt()).toEqual([700, LAST]);
  });

  it("Fit scales the legend: at zoom 1.5 it is 42 px tall, the last visible line is 677 and a release over the scaled legend ends there; 1 px above it is the browser's", () => {
    open();
    (window as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({ getPropertyValue: (name: string) => (name === "--page-zoom" ? "1.5" : "") });
    dragTo(700, HEIGHT - 42 - 1);
    expect(selection.extend).not.toHaveBeenCalled();
    dragTo(700, HEIGHT - 42);
    expect(endedAt()).toEqual([700, HEIGHT - 42 - 1]);
    dragTo(700, HEIGHT - 1);
    expect(endedAt()).toEqual([700, HEIGHT - 42 - 1]);
  });
});

describe("the shell's hold on the document", () => {
  it("puts four capture listeners on the document and lets go of them when the shell goes", () => {
    const mounted = open();
    expect(Object.keys(listeners).sort()).toEqual(expect.arrayContaining(["pointercancel", "pointerdown", "pointermove", "pointerup"]));
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
      expect(listeners[type].filter((l) => l.capture === true)).toHaveLength(1);
    }
    mounted.unmount();
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) expect(listeners[type]).toHaveLength(0);
  });

  it("a shell with no column (the grid cannot find it) listens for nothing and fails nothing", () => {
    browser();
    const mounted = stagedRuntime.mount(
      () => ReaderShell(props) as ReactElement<Props>,
      (output) => {
        for (const element of elements(output as ReactNode)) {
          const ref = element.props.ref as { current: unknown } | undefined;
          if (ref && typeof ref === "object" && String(element.props.className ?? "").includes("reader-shell")) ref.current = { style: { setProperty: vi.fn() }, querySelector: () => null };
        }
      },
    );
    expect(() => stagedRuntime.flush()).not.toThrow();
    expect(listeners.pointerdown ?? []).toHaveLength(0);
    mounted.unmount();
  });
});

describe("the sources", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("the shell imports the hook from lib/reader/keep-selection and calls it once, with the grid, beside the place's", () => {
    const shell = read("src/components/reader/reader-shell.tsx");
    expect(shell).toMatch(/import \{ useKeepSelection \} from "@\/lib\/reader\/keep-selection";/);
    expect(shell.match(/useKeepSelection\(/g)).toHaveLength(1);
    expect(shell).toMatch(/\n  useKeepSelection\(grid\);\n/);
    expect(shell.indexOf("useKeepSelection(grid)")).toBeGreaterThan(shell.indexOf("export function ReaderShell"));
    expect(shell.indexOf("useKeepSelection(grid)")).toBeLessThan(shell.indexOf("  return (\n    <div ref={grid}"));
  });

  it("the separators have no selection handling of their own: the document's one handler is the single owner of the rule (P11-45's clamp, folded in)", () => {
    const divider = read("src/components/reader/pane-divider.tsx");
    expect(divider).not.toMatch(/caretPositionFromPoint|caretRangeFromPoint|selection\.extend|endSelectionInColumn|COLUMN_SELECTOR|getSelection/);
    // and its own drag, keys and hit area are as they were: the pointer capture, the frame, the keys; no pointer-events rule
    expect(divider).toContain("setPointerCapture");
    expect(divider).toContain("requestAnimationFrame(() => {");
    expect(divider).not.toMatch(/pointer-events|pointerEvents/);
  });
});
