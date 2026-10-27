import { describe, expect, it, vi } from "vitest";
import { figurePdf, type FigurePage } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

// The former walk ceiling: the first test below keeps its numbers, now well under the bound.
const LIMIT = 60_000;
// P12-55 (R11a): the ceilings the other tests pin, as pdf-engine.ts holds them — 400,000
// path walks on a page (was 60,000) and 80,000 distinct boxes to cluster (was 12,000).
const WALKS = 400_000;
const RECTS = 80_000;
// A page of this many operators is passed as one string: the helper pushes `drawingOps` with a
// spread, which overflows the stack past about 120,000 arguments. The content stream is the same.
const ops = (lines: string[]) => [lines.join("\n")];
const opts = { maxPages: 1, maxFigures: 1, onlyPage: 1, label: "Figure 1", measureOnly: true };
const pdf = (count: number, raster = false) => figurePdf([{
  text: [["Figure 1. Invented visible panel.", 90, 268, 9]],
  shapes: raster ? [{ kind: "image", x: 90, top: 100, w: 360, h: 150 }] : [],
  drawingOps: ops(["q 0 0 10 10 re W n", ...Array(count).fill("100 100 1 1 re f"), "Q", "90 542 360 150 re f"]),
} as FigurePage]);

async function measured(bytes: Buffer) {
  const mupdf = await import("mupdf");
  const spy = vi.spyOn(mupdf.Path.prototype, "walk");
  // P12-55: a page of 400,000 paths costs seconds of CPU, which a busy runner can stretch past the
  // engine's 25 s extraction clock and end the page before the work limit is reached. These tests
  // assert what is walked and reported, not how fast, so the clock is held still.
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    const result = await extractPdfFigures(bytes, opts);
    return { result, walks: spy.mock.calls.length };
  } finally { spy.mockRestore(); clock.mockRestore(); }
}

describe("P12-28 drawing analysis work budget", () => {
  it.each([LIMIT - 2, LIMIT - 1])("accepts the later panel when %i clipped paths stay within the walk budget", async (count) => {
    const { result, walks } = await measured(pdf(count));
    expect(walks).toBe(count + 1);
    expect(result.figures.map((figure) => figure.box)).toEqual([[90, 100, 450, 250]]);
    expect(result.reason).toBeNull();
  }, 30_000);

  it("stops walking after 400000 clipped paths and reports the incomplete vector analysis", async () => {
    const { result, walks } = await measured(pdf(WALKS));
    expect(walks).toBe(WALKS);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 120_000);

  it("reports the work limit for retained paths before a later panel", async () => {
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: ops([...Array(WALKS).fill("1 1 1 1 re f"), "90 542 360 150 re f"]) }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(WALKS);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 120_000);

  it("counts mixed fill and stroke work before clipping, including no-box operations", async () => {
    const operations = Array.from({ length: WALKS }, (_, i) => i % 3 === 0 ? "100 100 1 1 re f" : i % 3 === 1 ? "100 100 m 101 101 l S" : "100 100 m S");
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: ops(["q 0 0 10 10 re W n", ...operations, "Q", "90 542 360 150 re f"]) }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(WALKS);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 120_000);

  it.each([RECTS - 1, RECTS])("keeps the independent cluster bound for %i retained tiny boxes and a later panel", async (count) => {
    const operations = Array.from({ length: count }, (_, i) => `${(1 + i * 0.002).toFixed(3)} 1 1 1 re f`);
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: ops([...operations, "90 542 360 150 re f"]) }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(count + 1);
    if (count === RECTS - 1) {
      expect(result.figures.map((figure) => figure.box)).toEqual([[90, 100, 450, 250]]);
      expect(result.reason).toBeNull();
    } else {
      expect(result.figures).toEqual([]);
      expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
    }
  }, 120_000);

  it("still returns an independent raster and reports the vector analysis limit", async () => {
    const { result, walks } = await measured(pdf(WALKS, true));
    expect(walks).toBe(WALKS);
    expect(result.figures.map(({ box, kind }) => ({ box, kind }))).toEqual([{ box: [90, 100, 450, 250], kind: "image" }]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 120_000);
});
