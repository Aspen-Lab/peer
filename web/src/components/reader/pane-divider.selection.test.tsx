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
import { PaneDivider, type PaneDividerProps } from "./pane-divider";

// P11-45 gave the separators their own handlers for a drag-select released over them (a clamp of the selection's end to the column's edge, in a frame). P11-45b
// generalised the rule to the whole document - a release over the margin, a card, the left pane, beyond the window, a separator - and FOLDED the separators' handlers into
// it: `lib/reader/keep-selection.ts` is the one owner (`keep-selection.test.ts`, `reader-shell.keep-selection.flow.test.tsx`), and `pane-divider.tsx` is what it was before
// P11-45's addition, byte for byte. The 17 tests of the separators' handlers that stood here were re-aimed there (the checkpoint lists where each went); what stays here is
// what must not change on the separator: its own drag, its keys, its hit area - with the selection a press elsewhere left standing, which its drag still never touches.

type Handler = (event: unknown) => void;
type Props = Record<string, unknown> & { ref: { current: unknown } };

const COLUMN = { left: 100, right: 652 };
/** A node of the paper's text column: where a selection began. */
const inColumn = { inColumn: true, name: "text in the paper" };

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
