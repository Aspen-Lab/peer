// P12-84 (B P12-80 K3): where a figure's region and its clip end. Every PDF is invented and built here with
// `figurePdf`; the owner's papers are never a fixture. Two rules, one block each:
//   R3-C  furniture (a running head, its rule: a line or a box of 20 pt and more wholly in the page's top band)
//         never joins a figure, and the clip stops a point under it instead of taking it in with its padding
//   R3-B  a figure's own edge labels join it: lines up to 24 pt past a side, small vector marks within 24 pt
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { barChart, figurePdf, type FigurePage, type Shape, type TextRun } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

const options = { maxPages: 24, maxFigures: 12 };
const SCALE = 2.8;
/** Helvetica's line box starts `ASCENT` above the baseline, per point of size (as in the R3a tests). */
const ASCENT = 1.0744;

const measured = async (page: FigurePage) => (await extractPdfFigures(figurePdf([page]), { ...options, measureOnly: true })).figures;
const rendered = async (page: FigurePage) => {
  const result = await extractPdfFigures(figurePdf([page]), options);
  expect(result.figures).toHaveLength(1);
  return result.figures[0];
};
const closeTo = (actual: number[] | undefined, expected: number[], tolerance = 0.15) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(Math.abs(actual![i] - value), `side ${i} of ${actual}`).toBeLessThanOrEqual(tolerance));
};

/** The pixels of an 8-bit RGB or RGBA PNG as rows of [r, g, b] (the decoder of the R5a tests, which keep theirs local). */
function pngRows(png: Uint8Array): number[][][] {
  const bytes = Buffer.from(png);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect(body[8]).toBe(8);
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      const predicted = [0, left, up, (left + up) >> 1, paeth()][filter];
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => [0, 1, 2].map((c) => pixels[y * stride + x * channels + c])));
}
/** Is any pixel of these rows dark (every channel under 128)? The raster's own gradient has a blue channel of 128. */
const hasInk = (rows: number[][][]) => rows.some((row) => row.some((pixel) => pixel.every((channel) => channel < 128)));

// ── R3-C: furniture ──────────────────────────────────────────────────────

describe("P12-84 R3-C: a running head and its rule stay out of a figure", () => {
  /** A running head: a line of 9 pt text, its box about [26.3, 38.7] and 190 pt wide. */
  const HEAD: TextRun = ["Invented Journal of Studies, vol. 12 (2026)", 72, 36, 9];
  const rule = (top: number, x1 = 72, x2 = 540): Shape => ({ kind: "line", x1, top1: top, x2, top2: top });
  /** A square raster 250 pt on a side, `top` from the page's top, and its caption 16 pt under it. */
  const page = (top: number, text: TextRun[], shapes: Shape[] = [], x = 100): FigurePage => ({
    text: [...text, ["Figure 1. An invented picture under a running head.", x, top + 266, 9]],
    shapes: [...shapes, { kind: "image", x, top, w: 250, h: 250 }],
  });
  const heightOf = async (target: FigurePage) => {
    const figures = await measured(target);
    expect(figures).toHaveLength(1);
    return figures[0].height;
  };
  const near = (actual: number, expected: number, tolerance = 1) => expect(Math.abs(actual - expected), `${actual} against ${expected}`).toBeLessThanOrEqual(tolerance);

  it("starts the clip a point under a rule that the padding used to take in", async () => {
    // The raster starts at 52, so its clip started at 42, over the rule drawn at 44.8 (a stroke of 1 pt).
    const ruled = page(52, [HEAD], [rule(44.8)]);
    const unruled = page(52, [HEAD]);
    const figure = await rendered(ruled);
    expect(figure.box).toEqual([100, 52, 350, 302]);
    // The clip now starts at 45.8: 3.8 pt of the padding are gone. The stroke ends at 45.3 and the first row is at 45.7.
    near(await heightOf(unruled), await heightOf(ruled) + 3.8 * SCALE);
    // The picture's first 16 rows are white page, over the raster that starts at row (52 - 45.7) * 2.8 = 17.6.
    expect(hasInk(pngRows(figure.png).slice(0, 16))).toBe(false);
  });

  it("leaves a rule below the band in the padding, and the ink check sees it", async () => {
    // The control: the same rule at 49 is no furniture (its bottom is past 46.5), so the clip keeps its 42.
    const figure = await rendered(page(52, [HEAD], [rule(49)]));
    near(figure.height, await heightOf(page(52, [HEAD])), 0);
    // Rows (49 - 42) * 2.8 = 19.6 and a few more hold its stroke.
    expect(hasInk(pngRows(figure.png).slice(14, 26))).toBe(true);
  });

  it("keeps the text of a running head out of the padding too", async () => {
    // A raster at 44 and a head whose line box ends at 38.7: the clip started at 34 and took in the head's lower glyphs.
    const figure = await rendered(page(44, [HEAD]));
    expect(figure.box).toEqual([100, 44, 350, 294]);
    // It starts at 39.7 now, 4.3 pt over the raster: the first 11 rows are white.
    expect(hasInk(pngRows(figure.png).slice(0, 11))).toBe(false);
  });

  it("keeps a line of the same size in the padding where it is not in the band (the control of the check above)", async () => {
    // The same line, 16 pt lower: its box ends at 54.7, past 46.5. A raster at 60 has its clip start at 50, inside the line.
    const lower: TextRun = ["Invented Journal of Studies, vol. 12 (2026)", 72, 52, 9];
    const figure = await rendered(page(60, [lower]));
    expect(hasInk(pngRows(figure.png).slice(0, 6))).toBe(true);
  });

  it("does not take a running head 3.6 pt over a chart as its figure text", async () => {
    // barChart(110, 50) is drawn over [110, 40, 380, 200]; the head's box ends at 36.4. The head used to join: top 24.
    const head: TextRun = ["Invented Running Head", 110, 24 + ASCENT * 9, 9];
    const figures = await measured({ text: [head, ["Figure 1. An invented bar chart a few points under a running head.", 110, 225, 9]], shapes: barChart(110, 50) });
    expect(figures).toHaveLength(1);
    closeTo(figures[0].box, [110, 40, 380, 200]);
    // The clip starts a point under the head's box: 37.4, not 30.
    near(figures[0].height, (210 - 37.4) * SCALE);
  });

  it("takes the same line where it is not in the band (the control of the test above)", async () => {
    // barChart(110, 90) is drawn over [110, 80, 380, 240]; the line's box is [62, 74.4], 5.6 pt over it.
    const lower: TextRun = ["Invented Running Head", 110, 62 + ASCENT * 9, 9];
    const figures = await measured({ text: [lower, ["Figure 1. An invented bar chart under a line.", 110, 265, 9]], shapes: barChart(110, 90) });
    expect(figures).toHaveLength(1);
    closeTo(figures[0].box, [110, 62, 380, 240]);
  });

  it("takes a band line only from 20 pt wide, and a box only from 20 pt wide", async () => {
    // A rule of 19 pt and one of 21 pt at 44.8, over a raster at 52: only the second is furniture and ends the clip at 45.8.
    const full = await heightOf(page(52, [HEAD]));
    near(await heightOf(page(52, [HEAD], [rule(44.8, 100, 119)])), full, 0);
    near(await heightOf(page(52, [HEAD], [rule(44.8, 100, 121)])), full - 3.8 * SCALE);
  });

  it("takes the band as the top 46.5 pt: a rule at 46.4 is furniture and one at 46.7 is not", async () => {
    const full = await heightOf(page(52, [HEAD]));
    near(await heightOf(page(52, [HEAD], [rule(46.4)])), full - (47.4 - 42) * SCALE);
    near(await heightOf(page(52, [HEAD], [rule(46.7)])), full, 0);
  });

  it("changes nothing for ink that is not over the clip's columns", async () => {
    // A head and rule over the left margin only, 20 to 80 pt, and a raster at x 200: its clip starts at x 190.
    const side: TextRun = ["Short head", 20, 36, 9];
    near(await heightOf(page(52, [side], [rule(44.8, 20, 80)], 200)), await heightOf(page(52, [], [], 200)), 0);
  });

  it("changes nothing for ink that is not over the region, and nothing for a head the padding does not reach", async () => {
    // A rule at 44.8 inside a raster that starts at 40 is under the region's top, not over it.
    near(await heightOf(page(40, [], [rule(44.8)])), await heightOf(page(40, [])), 0);
    // A raster at 70 has its clip start at 60, 14 pt under the rule.
    near(await heightOf(page(70, [HEAD], [rule(44.8)])), await heightOf(page(70, [])), 0);
  });
});
