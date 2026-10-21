import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here (this project's tests run in plain Node): the divider runs on the minimal hook runtime, the element tree it returns is inspected and its
// handlers are called with the few members of a pointer event it reads, as `pane-divider.flow.test.tsx` has it.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { PaneDivider, endSelectionInColumn, type PaneDividerProps } from "./pane-divider";

// P11-45, the manager's addition (C P11-46's measurement; ruling §1h.148's aim): a drag-select that starts in the paper's text and is released over a
// separator ends the selection where the pointer is, at the line's end, not at the separator's place in the document.
//
// Measured at 1280 x 720 on the invented paper (the column is 552 px, the centre's padding 12 px, the separator 12 px): a release 12, 16 and 23 px past a line's end
// is over the margin's separator and the selection ended at the end of the paper (36,977 characters, no buttons offered: far over the cap); a release the same
// distance before a line's start is over the left separator and it ended at the end of the left pane (19,467). At 1440 the column is capped and the gutter
// blank: the release is over the centre's own box and the selection was right. The notes tab's cure (`pointer-events: none` while a pointer is held and the
// element is not the one pressed) was tried on the separators and measured: the pointer then falls through to the shell's grid, which holds no text there, and
// the selection ended at the same place. So the separator keeps the pointer and puts the selection's end right: while a press made elsewhere is held over it,
// and at its release, the selection that began in the column ends at the column's nearest edge at the pointer's height, once per animation frame.
//
// Held here: the decision (`endSelectionInColumn`), the separator's handlers (a held press over it, its release, the frame they wait for), and what must not
// change - the separator's own drag, its keys, its hit area (the markup states no pointer-events rule).

type Handler = (event: unknown) => void;
type Props = Record<string, unknown> & { ref: { current: unknown } };

const COLUMN = { left: 100, right: 652 };
/** The paper's text column, the node a selection began in, and a node of the left pane. */
const inColumn = { inColumn: true, name: "text in the paper" };
const inPane = { inColumn: false, name: "text in the left pane" };

interface SelectionStub {
  rangeCount: number;
  isCollapsed: boolean;
  anchorNode: unknown;
  extend: ReturnType<typeof vi.fn>;
}

let selection: SelectionStub;
let caret: ReturnType<typeof vi.fn>;
let frames: Array<() => void>;
const runFrames = () => frames.splice(0).forEach((frame) => frame());

function column() {
  return {
    getBoundingClientRect: () => ({ left: COLUMN.left, right: COLUMN.right, top: 0, bottom: 10000, width: COLUMN.right - COLUMN.left }),
    contains: (node: unknown) => (node as { inColumn?: boolean } | null)?.inColumn === true,
  };
}
const gridOf = (col: unknown = column()) => ({
  style: { setProperty: vi.fn() },
  querySelector: (selector: string) => (selector === "[data-reader-centre-inner]" ? col : null),
});

/** The separator, rendered once, with its element handed to the ref as a browser would. */
async function stand(over: Partial<PaneDividerProps> = {}) {
  const element = {
    dataset: {} as Record<string, string>,
    focus: vi.fn(),
    setAttribute: vi.fn(),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  };
  const commits: number[] = [];
  const grid = gridOf();
  const props: PaneDividerProps = {
    pane: "margin",
    value: 360,
    room: { viewport: 1280, other: 320 },
    target: { current: grid as unknown as HTMLElement },
    variable: "--margin-w",
    label: "Resize margin",
    controls: "reader-margin",
    onCommit: (width) => commits.push(width),
    ...over,
  };
  const mounted = await hookRuntime.mount(() => PaneDivider(props));
  const root = mounted.value as unknown as ReactElement<Props>;
  root.props.ref.current = element;
  const on = (name: string): Handler => root.props[name] as Handler;
  return { root, on, element, commits, grid, mounted };
}

/** A mouse event as the separator reads it. */
const mouse = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  pointerType: "mouse",
  pointerId: 1,
  isPrimary: true,
  button: type === "pointermove" ? -1 : 0,
  buttons: type === "pointerup" ? 0 : 1,
  clientX: COLUMN.right + 16,
  clientY: 300,
  currentTarget: null,
  preventDefault: vi.fn(),
  ...over,
});

beforeEach(() => {
  frames = [];
  caret = vi.fn((x: number, y: number) => ({ offsetNode: { inColumn: true, at: [x, y] }, offset: 7 }));
  selection = { rangeCount: 1, isCollapsed: false, anchorNode: inColumn, extend: vi.fn() };
  vi.stubGlobal("window", {
    getSelection: () => selection,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
  vi.stubGlobal("document", { body: { style: { userSelect: "", cursor: "" } }, caretPositionFromPoint: caret });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("a selection that began in the text, released over a separator", () => {
  it.each([12, 16, 23])("the margin's: a release %i px past the line's end ends the selection at the line's end", async (past) => {
    const s = await stand();
    s.on("onPointerUp")(mouse("pointerup", { clientX: COLUMN.right + past }));
    expect(selection.extend).not.toHaveBeenCalled(); // not before the frame: the browser's own move of the end comes first
    runFrames();
    expect(caret).toHaveBeenCalledWith(COLUMN.right - 1, 300);
    expect(selection.extend).toHaveBeenCalledTimes(1);
    expect(selection.extend).toHaveBeenCalledWith(expect.objectContaining({ inColumn: true }), 7);
  });

  it.each([12, 16, 23])("the left one's: a release %i px before the line's start ends the selection at the line's start", async (before) => {
    const s = await stand({ pane: "left", variable: "--left-pane-w", label: "Resize left panel", controls: "reader-left-pane", value: 320, room: { viewport: 1280, other: 360 } });
    s.on("onPointerUp")(mouse("pointerup", { clientX: COLUMN.left - before, clientY: 412 }));
    runFrames();
    expect(caret).toHaveBeenCalledWith(COLUMN.left + 1, 412);
    expect(selection.extend).toHaveBeenCalledTimes(1);
  });

  it("follows the pointer while the button is held over it: three moves in a frame make one correction, one per frame after", async () => {
    const s = await stand();
    for (const x of [670, 672, 674]) s.on("onPointerMove")(mouse("pointermove", { clientX: x }));
    runFrames();
    expect(selection.extend).toHaveBeenCalledTimes(1);
    expect(caret).toHaveBeenLastCalledWith(COLUMN.right - 1, 300);
    s.on("onPointerMove")(mouse("pointermove", { clientX: 668, clientY: 340 }));
    runFrames();
    expect(selection.extend).toHaveBeenCalledTimes(2);
    expect(caret).toHaveBeenLastCalledWith(COLUMN.right - 1, 340);
  });

  it("a move and the release in one frame make one correction, at the release's place", async () => {
    const s = await stand();
    s.on("onPointerMove")(mouse("pointermove", { clientX: 664, clientY: 300 }));
    s.on("onPointerUp")(mouse("pointerup", { clientX: 668, clientY: 310 }));
    runFrames();
    expect(selection.extend).toHaveBeenCalledTimes(1);
    expect(caret).toHaveBeenCalledWith(COLUMN.right - 1, 310);
  });

  it("falls back to caretRangeFromPoint where the standard call is not there", async () => {
    vi.stubGlobal("document", {
      body: { style: { userSelect: "", cursor: "" } },
      caretRangeFromPoint: vi.fn(() => ({ startContainer: { inColumn: true }, startOffset: 3 })),
    });
    const s = await stand();
    s.on("onPointerUp")(mouse("pointerup"));
    runFrames();
    expect(selection.extend).toHaveBeenCalledWith(expect.objectContaining({ inColumn: true }), 3);
  });
});

describe("what leaves the selection to the browser", () => {
  const released = async (over: Record<string, unknown> = {}) => {
    const s = await stand();
    s.on("onPointerUp")(mouse("pointerup", over));
    runFrames();
    return s;
  };

  it("a hover: no button held, no correction", async () => {
    const s = await stand();
    s.on("onPointerMove")(mouse("pointermove", { buttons: 0 }));
    expect(frames).toHaveLength(0);
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a pointer over the text: the browser is right there", async () => {
    await released({ clientX: COLUMN.left + 200 });
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a collapsed selection, no selection, and a selection that began outside the paper's column (the left pane's text)", async () => {
    selection.isCollapsed = true;
    await released();
    selection.isCollapsed = false;
    selection.rangeCount = 0;
    await released();
    selection.rangeCount = 1;
    selection.anchorNode = inPane;
    await released();
    selection.anchorNode = null;
    await released();
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a touch, a pen, a secondary button and a cancelled pointer", async () => {
    await released({ pointerType: "touch" });
    await released({ pointerType: "pen" });
    await released({ button: 2 });
    const s = await stand();
    s.on("onPointerCancel")(mouse("pointercancel"));
    s.on("onLostPointerCapture")(mouse("lostpointercapture"));
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a caret that is not in the column (no text at that height), and no caret call at all", async () => {
    caret.mockReturnValue({ offsetNode: inPane, offset: 0 });
    await released();
    caret.mockReturnValue(null);
    await released();
    vi.stubGlobal("document", { body: { style: { userSelect: "", cursor: "" } } });
    await released();
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("a shell with no column (below 1024 px), or no grid yet", async () => {
    expect(endSelectionInColumn(null, 700, 300)).toBe(false);
    expect(endSelectionInColumn({ querySelector: () => null }, 700, 300)).toBe(false);
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("does not wait for a frame where there is none to wait for", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const s = await stand();
    s.on("onPointerUp")(mouse("pointerup"));
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("goes with the separator: a frame that is waiting when it unmounts is cancelled", async () => {
    const s = await stand();
    s.on("onPointerUp")(mouse("pointerup"));
    expect(frames).toHaveLength(1);
    s.mounted.unmount();
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
  });
});

describe("what does not change: the separator's own drag, its keys, its hit area", () => {
  it("a press on the separator is its own drag: captured, nothing is done to the selection while it moves (out beside the column) or at the release, and the width is committed", async () => {
    const s = await stand({ pane: "left", variable: "--left-pane-w", value: 320, room: { viewport: 1280, other: 360 } });
    const down = mouse("pointerdown", { clientX: 700, currentTarget: s.element });
    s.on("onPointerDown")(down);
    expect(s.element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(down.preventDefault).toHaveBeenCalled();
    s.on("onPointerMove")(mouse("pointermove", { clientX: 740, currentTarget: s.element }));
    runFrames();
    s.on("onPointerUp")(mouse("pointerup", { clientX: 760, currentTarget: s.element }));
    runFrames();
    expect(s.commits).toEqual([360]);
    expect(selection.extend).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
  });

  it("its drag still writes the grid's width once a frame, and still leaves the selection alone", async () => {
    const s = await stand({ pane: "left", variable: "--left-pane-w", value: 320, room: { viewport: 1280, other: 360 } });
    s.on("onPointerDown")(mouse("pointerdown", { clientX: 700, currentTarget: s.element }));
    s.on("onPointerMove")(mouse("pointermove", { clientX: 740, currentTarget: s.element }));
    runFrames();
    expect(s.grid.style.setProperty).toHaveBeenCalledWith("--left-pane-w", "360px");
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("its keys: ArrowRight moves the boundary, End goes to the greatest width, and no key touches the selection", async () => {
    const s = await stand({ pane: "left", variable: "--left-pane-w", value: 320, room: { viewport: 1280, other: 360 } });
    const key = (name: string) => ({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn() });
    s.on("onKeyDown")(key("ArrowRight"));
    s.on("onKeyDown")(key("End"));
    expect(s.commits).toEqual([336, 456]);
    runFrames();
    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("keeps its hit area: the markup states no pointer-events rule, so the pointer is its own wherever it is (a fall-through to the grid was measured, and does not help)", async () => {
    const s = await stand();
    expect(String(s.root.props.className)).toBe("reader-divider");
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/pane-divider.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/pointer-events|pointerEvents/);
  });
});
