import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCK_BOTTOM_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { CARET_STEP_PX, domEnv, endSelectionInColumn, type Visible } from "./keep-selection";

// P11-62 (ruling §1h.173; round 5, Theme B walk E-4): a drag-select released over the foot legend ends at the last visible line above it, as a release over the margin or the
// left pane at the same height, or below the window's foot, does. Measured on the base (`b6aa9c22`), 1024 x 768 up to 1920 x 1080, light and dark, with and without a key, Fit on
// at 1280 and 1440: a release over the legend's rows (the window's last 28 px, `legendHeightPx(zoom)` under Fit) in the column's x ran the selection to the end of the paper
// (70,018 to 70,145 characters on the walk's paper), the legend's words highlighted, no button offered; 1 px above the legend, or over the margin or the left pane at the same
// heights, it was right. The cause: `domEnv.visible()` gave no end to the column's visible rows but the window's last, though the legend covers the last of them, so a pointer
// over the legend in the column's x was "over the column's visible box" and the browser's own end (in the legend's text, the document's last) was left alone.
//
// Held here: the legend's top edge as the real page reads it (`domEnv`: the window's height less `legendHeightPx` at the page's zoom), what a pointer at or below it is (beyond
// the visible box, in the column's x as beside it), and that nothing else moved: the row the last visible line is looked for from (the pointer's, or the window's last row) is
// as it was, so a release over the margin, the left pane or below the window ends where it did. The shell, with the hook's one call, is
// `reader-shell.keep-selection.flow.test.tsx`'s; the rest of the decision is `keep-selection.test.ts`'s.

const COLUMN = { left: 356, right: 908 };
const column = () => ({
  getBoundingClientRect: () => ({ left: COLUMN.left, right: COLUMN.right }),
  contains: (node: unknown) => (node as { inColumn?: boolean } | null)?.inColumn === true,
});
const inColumn = { inColumn: true };
const elsewhere = (name: string) => ({ inColumn: false, name });

/** A page `height` high with Fit's `zoom` (null: no zoom to read, Fit off), a legend as tall as the page computes it, and a selection that began in the column. */
function page(height: number, zoom: number | null = null) {
  const legendTop = height - legendHeightPx(zoom ?? 1);
  const extend = vi.fn();
  const collapse = vi.fn();
  const sel = { rangeCount: 1, isCollapsed: false, anchorNode: inColumn, anchorOffset: 0, focusNode: elsewhere("the legend"), focusOffset: 0, extend, collapse };
  /** The paper's text above the legend's top edge, the legend's words from it down: what the browser answers for a point. */
  const caret = vi.fn((_x: number, y: number) => (y < legendTop ? { offsetNode: { inColumn: true, at: y }, offset: 0 } : { offsetNode: elsewhere("the legend"), offset: 0 }));
  vi.stubGlobal("window", {
    innerHeight: height,
    getSelection: () => sel,
    getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === "--page-zoom" && zoom !== null ? String(zoom) : "") }),
  });
  vi.stubGlobal("document", { activeElement: null, querySelector: () => null, caretPositionFromPoint: caret });
  return { sel, extend, collapse, caret, legendTop };
}
const endedAt = (extend: ReturnType<typeof vi.fn>) => (extend.mock.calls.at(-1)?.[0] as { at: number } | undefined)?.at ?? null;
/** The row the last visible line is looked for at, from the pointer's own: up `CARET_STEP_PX` at a time until the legend is cleared (what the browser answers above). */
const rowFrom = (y: number, legendTop: number) => {
  let row = y;
  while (row >= legendTop) row -= CARET_STEP_PX;
  return row;
};

afterEach(() => vi.unstubAllGlobals());

describe("endSelectionInColumn — a pointer at or below the legend's top edge is beyond the visible box", () => {
  const VISIBLE: Visible = { top: 49, bottom: 719, legendTop: 692 };
  const doc = (legendTop: number) => ({ caretPositionFromPoint: (_x: number, y: number) => (y < legendTop ? { offsetNode: { inColumn: true, at: y }, offset: 0 } : { offsetNode: elsewhere("the legend"), offset: 0 }) });
  const run = (x: number, y: number, visible: Visible = VISIBLE) => {
    const extend = vi.fn();
    const sel = { rangeCount: 1, isCollapsed: false, anchorNode: inColumn, anchorOffset: 0, focusNode: elsewhere("the legend"), focusOffset: 0, extend, collapse: vi.fn() };
    const result = endSelectionInColumn(column(), x, y, visible, doc(692) as never, sel as never);
    return { result, extend };
  };

  it.each([692, 700, 710, 719])("y %i, over the legend, in the column's x: the end is put above the legend, from the pointer's row up", (y) => {
    const { result, extend } = run(600, y);
    expect(result).toBe(true);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBe(rowFrom(y, 692));
    expect(endedAt(extend)).toBeLessThan(692);
  });

  it("the row above the legend's top edge, in the column's x: the browser's, nothing is touched", () => {
    expect(run(600, 691).result).toBe(false);
    expect(run(600, 400).result).toBe(false);
  });

  it("a legend's top edge between two rows (Fit's zoom): the row above the edge is the column's, the row below it the legend's", () => {
    const fractional: Visible = { top: 49, bottom: 899, legendTop: 868.024 };
    expect(run(600, 868, fractional).result).toBe(false);
    const { result } = ((): { result: boolean } => {
      const extend = vi.fn();
      const sel = { rangeCount: 1, isCollapsed: false, anchorNode: inColumn, anchorOffset: 0, focusNode: elsewhere("the legend"), focusOffset: 0, extend, collapse: vi.fn() };
      return { result: endSelectionInColumn(column(), 600, 869, fractional, doc(868.024) as never, sel as never) };
    })();
    expect(result).toBe(true);
  });

  it("a legend's top edge that carries rounding noise (28 x zoom): the whole row is still the legend's", () => {
    expect(run(600, 692, { top: 49, bottom: 719, legendTop: 692.0000000000001 }).result).toBe(true);
  });

  it("no legend known (absent, null): the box is as it was", () => {
    expect(run(600, 719, { top: 49, bottom: 719 }).result).toBe(false);
    expect(run(600, 719, { top: 49, bottom: 719, legendTop: null }).result).toBe(false);
  });
});

describe("domEnv — the legend's top edge, as the page reads it", () => {
  it.each([692, 700, 710, 719])("a release at y %i, over the legend's rows (1280 x 720), in the column's x: the end goes above the legend", (y) => {
    const { extend } = page(720);
    domEnv(column() as never).endAt(600, y);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBe(rowFrom(y, 692));
  });

  it("a release over the legend in the column's x ends where the same release over the margin or the left pane does", () => {
    for (const y of [692, 700, 710, 719]) {
      const inX = page(720);
      domEnv(column() as never).endAt(600, y);
      const margin = page(720);
      domEnv(column() as never).endAt(COLUMN.right + 160, y);
      const left = page(720);
      domEnv(column() as never).endAt(60, y);
      expect(endedAt(inX.extend)).toBe(endedAt(margin.extend));
      expect(endedAt(inX.extend)).toBe(endedAt(left.extend));
    }
  });

  it("a release 1 px above the legend, in the column's x: the browser is right there, nothing is touched", () => {
    const { extend, caret, collapse } = page(720);
    domEnv(column() as never).endAt(600, 691);
    domEnv(column() as never).endAt(600, 690);
    domEnv(column() as never).endAt(600, 300);
    expect(extend).not.toHaveBeenCalled();
    expect(collapse).not.toHaveBeenCalled();
    expect(caret).not.toHaveBeenCalled();
  });

  it("a release below the window and a release over the margin or the left pane: the last visible line is looked for from where it was (the window's last row, the pointer's), not from the legend's edge", () => {
    const below = page(720);
    domEnv(column() as never).endAt(600, 760);
    expect(endedAt(below.extend)).toBe(689);
    const beside = page(720);
    domEnv(column() as never).endAt(COLUMN.right + 160, 719);
    expect(endedAt(beside.extend)).toBe(689);
    domEnv(column() as never).endAt(60, 700);
    expect(endedAt(beside.extend)).toBe(688);
    expect(beside.caret).toHaveBeenCalledWith(COLUMN.right - 1, 719);
  });

  it("the masthead's side is as before: a release over it ends at the first line under its foot", () => {
    const { caret } = page(720);
    domEnv(column() as never).endAt(600, 20);
    expect(caret).toHaveBeenCalledWith(600, 49);
  });

  it.each([
    ["1366 x 768", 768],
    ["1440 x 900", 900],
    ["1920 x 1080", 1080],
    ["1093 x 614", 614],
  ])("%s, Fit off: the legend covers the window's last 28 rows: the row above it is the column's, the first row of it is the legend's", (_name, height) => {
    const { extend } = page(height);
    domEnv(column() as never).endAt(600, height - DOCK_BOTTOM_PX - 1);
    expect(extend).not.toHaveBeenCalled();
    domEnv(column() as never).endAt(600, height - DOCK_BOTTOM_PX);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBeLessThan(height - DOCK_BOTTOM_PX);
    domEnv(column() as never).endAt(600, height - 1);
    expect(endedAt(extend)).toBe(rowFrom(height - 1, height - DOCK_BOTTOM_PX));
  });

  it.each([
    ["1280 x 720, zoom 1", 720, 1],
    ["1440 x 900, Fit zoom 1.142 (the legend is 31.98 px tall, its top edge at 868.02)", 900, 1.142],
    ["1920 x 1080, Fit zoom 1.378 (the legend is 38.6 px tall, its top edge at 1041.4)", 1080, 1.378],
    ["2560 x 1440, Fit zoom 1.838 (the legend is 51.5 px tall)", 1440, 1.838],
  ])("Fit scales the legend: %s: the row above the scaled legend's top edge is the column's, the row below it the legend's, and the end is found above it", (_name, height, zoom) => {
    const { extend, legendTop } = page(height, zoom);
    expect(legendHeightPx(zoom)).toBeCloseTo(DOCK_BOTTOM_PX * zoom, 6);
    const above = Math.ceil(legendTop) - 1; // the last whole row above the edge
    domEnv(column() as never).endAt(600, above);
    expect(extend).not.toHaveBeenCalled();
    domEnv(column() as never).endAt(600, above + 1);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBeLessThan(legendTop);
    domEnv(column() as never).endAt(600, height - 1);
    expect(endedAt(extend)).toBeLessThan(legendTop);
  });

  it("a window whose height is not known: nothing is clamped below, the masthead's side still holds", () => {
    const { extend } = page(720);
    vi.stubGlobal("window", { getSelection: () => ({ rangeCount: 1, isCollapsed: false, anchorNode: inColumn, focusNode: null, focusOffset: 0, extend }), getComputedStyle: () => ({ getPropertyValue: () => "" }) });
    domEnv(column() as never).endAt(600, 2000);
    expect(extend).not.toHaveBeenCalled();
    domEnv(column() as never).endAt(600, 20);
    expect(extend).toHaveBeenCalledTimes(1);
  });
});

describe("domEnv — a Shift+click over the legend", () => {
  const held = { node: inColumn as unknown as Node, offset: 5 };

  it.each([700, 719])("a Shift+press over the legend (y %i) in the column's x, with a selection that began in the column standing: the end goes above the legend, as it did", (y) => {
    const { extend, caret, sel, legendTop } = page(720);
    sel.isCollapsed = true;
    domEnv(column() as never).endAt(600, y, held);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBe(rowFrom(y, legendTop));
    expect(caret.mock.calls[0]).toEqual([600, y]);
  });

  it("a Shift+press 1 px above the legend: the pointer's own caret, as before", () => {
    const { extend, caret, sel } = page(720);
    sel.isCollapsed = true;
    domEnv(column() as never).endAt(600, 691, held);
    expect(caret.mock.calls[0]).toEqual([600, 691]);
    expect(endedAt(extend)).toBe(691);
    caret.mockClear();
    domEnv(column() as never).endAt(600, 400, held);
    expect(caret.mock.calls[0]).toEqual([600, 400]);
  });
});

describe("the sources", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("the legend's top edge comes from the page's own legend height (`legendHeightPx`, read at the page's zoom), not from a number of this file's", () => {
    const source = read("src/lib/reader/keep-selection.ts");
    expect(source).toMatch(/import \{[^}]*\blegendHeightPx\b[^}]*\} from "@\/components\/reader\/explain-dock";/);
    expect(source).toMatch(/legendHeightPx\(readPageZoom\(column\)\)/);
    expect(source).not.toMatch(/\b28\b/);
  });
});
