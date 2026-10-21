import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCK_BOTTOM_PX, legendHeightPx } from "@/components/reader/explain-dock";
import { domEnv } from "./keep-selection";

// P11-62 (ruling §1h.173; round 5, Theme B walk E-4): a drag-select released over the foot legend ends at the last visible line above it, as a release below the window's
// foot does. Measured on the base (`b6aa9c22`), 1024 x 768 up to 1920 x 1080, light and dark, with and without a key, Fit on at 1280 and 1440: a release over the legend's rows
// (the window's last 28 px, `legendHeightPx(zoom)` under Fit) in the column's x ran the selection to the end of the paper (70,018 to 70,145 characters on the walk's
// paper), the legend's words highlighted, no button offered; 1 px above the legend, or over the margin or the left pane at the same heights, it was right. The cause:
// `domEnv.visible()` said the column's visible rows end at `innerHeight - 1`, "the window's last row", but the legend covers the last of them, so a pointer over the legend in
// the column's x was "over the column's visible box" and the browser's own end (in the legend's text, the document's last) was left alone.
//
// Held here: what the real page's `visible` is (the window's height less the legend's, at the page's zoom), through `domEnv.endAt`, for a drag's release and for a Shift+click's.
// The decision itself (`endSelectionInColumn`) is `keep-selection.test.ts`'s; the shell, with the hook's one call, is `reader-shell.keep-selection.flow.test.tsx`'s.

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

afterEach(() => vi.unstubAllGlobals());

describe("domEnv — the column's visible rows end above the foot legend", () => {
  it.each([692, 700, 710, 719])("a release at y %i, over the legend's rows (1280 x 720), in the column's x: the end goes to the last visible line above the legend", (y) => {
    const { extend, caret } = page(720);
    domEnv(column() as never).endAt(600, y);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBe(720 - DOCK_BOTTOM_PX - 1);
    expect(caret).toHaveBeenCalledWith(600, 691);
  });

  it("a release below the window, in the column's x or past it: the same last visible line", () => {
    const { extend } = page(720);
    domEnv(column() as never).endAt(600, 760);
    expect(endedAt(extend)).toBe(691);
    domEnv(column() as never).endAt(COLUMN.right + 80, 800);
    expect(endedAt(extend)).toBe(691);
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

  it("a release over the legend beside the column (the margin, the left pane): the same last visible line", () => {
    const { extend } = page(720);
    domEnv(column() as never).endAt(COLUMN.right + 160, 705);
    expect(endedAt(extend)).toBe(691);
    domEnv(column() as never).endAt(60, 719);
    expect(endedAt(extend)).toBe(691);
  });

  it("the masthead's side is as before: a release over it ends at the first line under its foot", () => {
    const { caret } = page(720);
    domEnv(column() as never).endAt(600, 20);
    expect(caret).toHaveBeenCalledWith(600, 49);
  });

  it.each([
    ["1366 x 768", 768, 739, 740],
    ["1440 x 900", 900, 871, 872],
    ["1920 x 1080", 1080, 1051, 1052],
    ["1093 x 614", 614, 585, 586],
  ])("%s, Fit off: the legend covers the window's last 28 rows: the row above it is the last visible, the first row of it is the legend's", (_name, height, last, first) => {
    const { extend, caret } = page(height);
    domEnv(column() as never).endAt(600, last);
    expect(extend).not.toHaveBeenCalled();
    domEnv(column() as never).endAt(600, first);
    expect(endedAt(extend)).toBe(last);
    expect(caret).toHaveBeenCalledWith(600, last);
  });

  it.each([
    ["1280 x 720, zoom 1", 720, 1, 691],
    ["1440 x 900, Fit zoom 1.142 (the legend is 31.98 px tall, its top edge at 868.02)", 900, 1.142, 868],
    ["1920 x 1080, Fit zoom 1.378 (the legend is 38.6 px tall)", 1080, 1.378, 1041],
  ])("Fit scales the legend: %s: the last visible row is the one above the scaled legend's top edge", (_name, height, zoom, last) => {
    const { extend, caret } = page(height, zoom);
    expect(legendHeightPx(zoom)).toBeCloseTo(DOCK_BOTTOM_PX * zoom, 6);
    // on the row above the legend: nothing is touched; on the next row down, it is the legend's
    domEnv(column() as never).endAt(600, last);
    expect(extend).not.toHaveBeenCalled();
    domEnv(column() as never).endAt(600, last + 1);
    expect(endedAt(extend)).toBe(last);
    domEnv(column() as never).endAt(600, height - 1);
    expect(endedAt(extend)).toBe(last);
    expect(caret).toHaveBeenLastCalledWith(600, last);
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

  it.each([700, 719])("a Shift+press over the legend (y %i) in the column's x, with a selection that began in the column standing: its end goes to the last visible line above the legend", (y) => {
    const { extend, caret, sel } = page(720);
    sel.isCollapsed = true;
    sel.focusNode = elsewhere("the legend");
    domEnv(column() as never).endAt(600, y, held);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(endedAt(extend)).toBe(691);
    expect(caret.mock.calls[0]).toEqual([600, 691]);
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

  it("the visible rows come from the page's own legend height (`legendHeightPx`, read at the page's zoom), not from a number of this file's", () => {
    const source = read("src/lib/reader/keep-selection.ts");
    expect(source).toMatch(/import \{[^}]*\blegendHeightPx\b[^}]*\} from "@\/components\/reader\/explain-dock";/);
    expect(source).toMatch(/legendHeightPx\(readPageZoom\(/);
    expect(source).not.toMatch(/innerHeight\s*-\s*1\b/);
  });
});
