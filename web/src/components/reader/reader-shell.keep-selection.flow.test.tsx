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
  focusNode: unknown;
  focusOffset: number;
  extend: ReturnType<typeof vi.fn>;
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
  selection = { rangeCount: 1, isCollapsed: false, anchorNode: text, focusNode: null, focusOffset: 0, extend: vi.fn() };
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
    expect(inX[1]).toBeLessThan(HEIGHT - 29);
    selection.extend.mockClear();
    dragTo(COLUMN.right + 80, HEIGHT + 60);
    expect(endedAt()![0]).toBe(COLUMN.right - 1);
    expect(endedAt()![1]).toBeLessThan(HEIGHT - 29);
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
