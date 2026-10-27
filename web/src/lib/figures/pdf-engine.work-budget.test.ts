import { describe, expect, it, vi } from "vitest";
import { figurePdf, type FigurePage } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

const LIMIT = 60_000;
const opts = { maxPages: 1, maxFigures: 1, onlyPage: 1, label: "Figure 1", measureOnly: true };
const pdf = (count: number, raster = false) => figurePdf([{
  text: [["Figure 1. Invented visible panel.", 90, 268, 9]],
  shapes: raster ? [{ kind: "image", x: 90, top: 100, w: 360, h: 150 }] : [],
  drawingOps: ["q 0 0 10 10 re W n", ...Array(count).fill("100 100 1 1 re f"), "Q", "90 542 360 150 re f"],
} as FigurePage]);

async function measured(bytes: Buffer) {
  const mupdf = await import("mupdf");
  const spy = vi.spyOn(mupdf.Path.prototype, "walk");
  try {
    const result = await extractPdfFigures(bytes, opts);
    return { result, walks: spy.mock.calls.length };
  } finally { spy.mockRestore(); }
}

describe("P12-28 drawing analysis work budget", () => {
  it.each([LIMIT - 2, LIMIT - 1])("accepts the later panel when %i clipped paths stay within the walk budget", async (count) => {
    const { result, walks } = await measured(pdf(count));
    expect(walks).toBe(count + 1);
    expect(result.figures.map((figure) => figure.box)).toEqual([[90, 100, 450, 250]]);
    expect(result.reason).toBeNull();
  }, 30_000);

  it("stops walking after 60000 clipped paths and reports the incomplete vector analysis", async () => {
    const { result, walks } = await measured(pdf(LIMIT));
    expect(walks).toBe(LIMIT);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 30_000);

  it("reports the work limit for retained paths before a later panel", async () => {
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: [...Array(LIMIT).fill("1 1 1 1 re f"), "90 542 360 150 re f"] }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(LIMIT);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 30_000);

  it("counts mixed fill and stroke work before clipping, including no-box operations", async () => {
    const operations = Array.from({ length: LIMIT }, (_, i) => i % 3 === 0 ? "100 100 1 1 re f" : i % 3 === 1 ? "100 100 m 101 101 l S" : "100 100 m S");
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: ["q 0 0 10 10 re W n", ...operations, "Q", "90 542 360 150 re f"] }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(LIMIT);
    expect(result.figures).toEqual([]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 30_000);

  it.each([11_999, 12_000])("keeps the independent cluster bound for %i retained tiny boxes and a later panel", async (count) => {
    const operations = Array.from({ length: count }, (_, i) => `${(1 + i * 0.002).toFixed(3)} 1 1 1 re f`);
    const bytes = figurePdf([{ text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: [...operations, "90 542 360 150 re f"] }]);
    const { result, walks } = await measured(bytes);
    expect(walks).toBe(count + 1);
    if (count === 11_999) {
      expect(result.figures.map((figure) => figure.box)).toEqual([[90, 100, 450, 250]]);
      expect(result.reason).toBeNull();
    } else {
      expect(result.figures).toEqual([]);
      expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
    }
  }, 30_000);

  it("still returns an independent raster and reports the vector analysis limit", async () => {
    const { result, walks } = await measured(pdf(LIMIT, true));
    expect(walks).toBe(LIMIT);
    expect(result.figures.map(({ box, kind }) => ({ box, kind }))).toEqual([{ box: [90, 100, 450, 250], kind: "image" }]);
    expect(result.reason).toMatch(/drawing.*limit|limit.*drawing/i);
  }, 30_000);
});
