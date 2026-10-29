// P12-84 (B P12-80 K3): where a figure's region and its clip end. Every PDF is invented and built here with
// `figurePdf`; the owner's papers are never a fixture. Two rules, one block each:
//   R3-C  furniture (a running head, its rule: a line or a box of 20 pt and more wholly in the page's top band)
//         never joins a figure, and the clip stops a point under it instead of taking it in with its padding
//   R3-B  a figure's own edge labels join it: lines up to 24 pt past a side, small vector marks within 6 pt, and
//         neither crosses into the next figure or the body text
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { barChart, figurePdf, type FigurePage, type Shape, type TextRun } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

const options = { maxPages: 24, maxFigures: 12 };
const SCALE = 2.8;
/** Helvetica's line box: from `ASCENT` above the baseline to `DESCENT` below it, per point of size (as in the R3a tests). */
const ASCENT = 1.0744;
const DESCENT = 0.2989;

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
/** Is there any colour (a channel under 200) in these rows (from, to) and columns (from, to) of the picture? */
const inkIn = (rows: number[][][], [r0, r1]: [number, number], [c0, c1]: [number, number]) =>
  rows.slice(r0, r1).some((row) => row.slice(c0, c1).some((pixel) => pixel.some((channel) => channel < 200)));
const near = (actual: number, expected: number, tolerance = 1) => expect(Math.abs(actual - expected), `${actual} against ${expected}`).toBeLessThanOrEqual(tolerance);

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

  it("takes a box only from 20 pt wide", async () => {
    // A rule of 19 pt and one of 21 pt at 44.8, over a raster at 52: only the second is furniture and ends the clip at 45.8.
    const full = await heightOf(page(52, [HEAD]));
    near(await heightOf(page(52, [HEAD], [rule(44.8, 100, 119)])), full, 0);
    near(await heightOf(page(52, [HEAD], [rule(44.8, 100, 121)])), full - 3.8 * SCALE);
  });

  it("takes a line only from 20 pt wide: \"Hea\" (16.5 pt) joins the chart under it, \"Head\" (21.5 pt) does not", async () => {
    // The chart is drawn over [110, 40, 380, 200]; each line's box ends at 36.4.
    const under = async (text: string) => {
      const figures = await measured({ text: [[text, 110, 24 + ASCENT * 9, 9], ["Figure 1. An invented bar chart under a short line.", 110, 225, 9]], shapes: barChart(110, 50) });
      expect(figures).toHaveLength(1);
      return figures[0].box!;
    };
    closeTo(await under("Hea"), [110, 24, 380, 200]);
    closeTo(await under("Head"), [110, 40, 380, 200]);
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

// ── R3-B: a figure's own edge labels and marks ───────────────────────────

describe("P12-84 R3-B: rotated edge labels, tick labels and legend marks join their figure", () => {
  const n = (value: number) => (Math.round(value * 100) / 100).toString();
  /** A run of 5.5 pt text turned a quarter turn counter-clockwise (it reads upward), as raw operators: `x` is its
   *  baseline, `bottom` the top-down y of its start. Its box is `x - 1.0744 * 5.5` to `x + 0.2989 * 5.5` wide (7.55 pt). */
  const rotated = (text: string, x: number, bottom: number, size = 5.5) => `BT /F1 ${size} Tf 0 1 -1 0 ${n(x)} ${n(792 - bottom)} Tm (${text}) Tj ET`;
  const square = (x: number, top: number, w = 10, h = 11, fill: [number, number, number] = [0.1, 0.1, 0.5]): Shape => ({ kind: "rect", x, top, w, h, fill });
  const boxOf = async (target: FigurePage, index = 0) => {
    const figures = await measured(target);
    expect(figures.length).toBeGreaterThan(index);
    return figures[index].box!;
  };

  // A raster [150, 100, 450, 400], its caption under it, rotated row labels whose boxes are [139.65, 147.9] wide (2.1 pt
  // from the raster: the label's near edge is within 6 pt, its far edge 10.4 pt out), and legend squares left of them.
  const HEAT = "Figure 1. An invented heat map with its row labels and legend at the left.";
  const labels = [150, 200, 250, 300].map((bottom, i) => rotated(`Row group ${i + 1}`, 146, bottom, 6));
  const heatMap = (parts: { labels?: boolean; squareAt?: number | null } = {}): FigurePage => {
    const { labels: withLabels = true, squareAt = 124 } = parts;
    return {
      text: [[HEAT, 150, 418, 9]],
      shapes: [{ kind: "image", x: 150, top: 100, w: 300, h: 300 }, ...(squareAt === null ? [] : [square(squareAt, 130), square(squareAt, 200, 10, 11, [0.5, 0.1, 0.1])])],
      drawingOps: withLabels ? labels : [],
    };
  };

  it("takes rotated row labels whose far edge is 10 pt out, and a legend square beyond them", async () => {
    // Before P12-84 the raster alone: [150, 100, 450, 400]. The labels are 8.2 pt wide at 6 pt: 2.2 pt from the raster,
    // 10.4 pt out, past the old 6 pt bound; then each square, 5.5 pt from the labels, is within reach of the grown region.
    closeTo(await boxOf(heatMap({ squareAt: null })), [139.55, 100, 450, 400]);
    closeTo(await boxOf(heatMap()), [124, 100, 450, 400]);
  });

  it("draws the whole strip: the labels and the squares are in the picture", async () => {
    const figure = await rendered(heatMap());
    // The clip is [114, 90, 460, 407.8] at 2.8 (the raster is square, so it is not stretched): the caption's box starts at
    // 408.3, inside the 10 pt under the raster, so the clip stops 0.5 pt short of it.
    near(figure.width, (460 - 114) * SCALE);
    near(figure.height, (407.8 - 90) * SCALE);
    const rows = pngRows(figure.png);
    // The first square, x 124 to 134 and y 130 to 141: columns 28 to 56, rows 112 to 143.
    expect(inkIn(rows, [112, 143], [28, 56])).toBe(true);
    // The first label, x 139.55 to 147.8 and y 120 to 150: columns 72 to 95, rows 84 to 168.
    expect(inkIn(rows, [84, 168], [72, 95])).toBe(true);
    // Left of the squares (x 114 to 123.5) the page is white.
    expect(inkIn(rows, [0, rows.length], [0, 26])).toBe(false);
  });

  it("takes a legend square within 6 pt of the region, and leaves one at 16 pt that no label leads to", async () => {
    closeTo(await boxOf(heatMap({ labels: false, squareAt: 136 })), [136, 100, 450, 400]);
    closeTo(await boxOf(heatMap({ labels: false, squareAt: 124 })), [150, 100, 450, 400]);
  });

  // barChart(110, 76) is drawn over [110, 66, 380, 226]. "Panel B" is a line over it, 4 pt up and 12 pt wider than its
  // left edge: it joins only since the reach is 24 pt, and a running head 4 pt over that line, wholly in the band, is
  // what the chain of lines would have reached next. R3-C comes first: the reach alone would take the head in.
  it("does not follow a chain of lines up into the running head", async () => {
    const page: FigurePage = {
      text: [
        ["Invented Running Head", 98, 44 - DESCENT * 9, 9],
        ["Panel B", 98, 62 - DESCENT * 10, 10],
        ["Figure 1. An invented bar chart with a panel letter over it.", 110, 245, 9],
      ],
      shapes: barChart(110, 76),
    };
    const [figure] = await measured(page);
    // The label box is [48.26, 62]: the region's top is the label's, not the head's (about 31).
    closeTo(figure.box, [98, 48.26, 380, 226]);
    // The clip starts under the head's box, at 45, and stops 0.5 pt short of the caption, at 234.8: the label's first
    // row is (48.26 - 45) * 2.8 = 9 down.
    near(figure.height, (234.8 - 45) * SCALE);
    const picture = await rendered(page);
    const rows = pngRows(picture.png);
    expect(inkIn(rows, [0, 8], [0, rows[0].length])).toBe(false);
    expect(inkIn(rows, [9, 36], [0, 120])).toBe(true);
  });

  it("takes a small mark in the band that is under 20 pt wide, and leaves one of 20 pt and more", async () => {
    const raster: Shape = { kind: "image", x: 100, top: 44, w: 250, h: 250 };
    const caption: TextRun = ["Figure 1. An invented picture with a mark over its corner.", 100, 310, 9];
    // Marks 2 pt over the raster, wholly in the band (their bottoms are at 42).
    closeTo(await boxOf({ text: [caption], shapes: [raster, square(120, 36, 10, 6)] }), [100, 36, 350, 294]);
    closeTo(await boxOf({ text: [caption], shapes: [raster, square(120, 36, 30, 6)] }), [100, 44, 350, 294]);
  });

  it("takes no rule: a rule has no height, so it is no cluster and no mark", async () => {
    // Drawn 4 pt over a raster that starts at 60, below the band.
    const page: FigurePage = {
      text: [["Figure 1. An invented picture with a rule over it.", 100, 326, 9]],
      shapes: [{ kind: "line", x1: 100, top1: 56, x2: 300, top2: 56 }, { kind: "image", x: 100, top: 60, w: 250, h: 250 }],
    };
    expect(await boxOf(page)).toEqual([100, 60, 350, 310]);
  });

  it("takes at most 64 marks for a figure", async () => {
    // A raster [20, 100, 170, 250] and 70 marks of 4 x 11 pt in a row, 3.5 pt apart, the first 4 pt from it.
    const marks = Array.from({ length: 70 }, (_, i) => square(174 + i * 7.5, 150, 4, 11));
    const [figure] = await measured({ size: [900, 792], text: [["Figure 1. An invented picture with a long row of marks.", 20, 268, 9]], shapes: [{ kind: "image", x: 20, top: 100, w: 150, h: 150 }, ...marks] });
    closeTo(figure.box, [20, 100, 174 + 63 * 7.5 + 4, 250]);
  });

  describe("the reach does not cross into another column", () => {
    const BODY = "The invented body paragraph of the right column runs on for sixty-six characters.";
    /** A left-column raster [40, 100, 290, 300] and, from x 310, a right column of body lines with a short heading and an inline diagram. */
    const twoColumns = (...extra: Shape[]): FigurePage => ({
      text: [
        ["Figure 1. An invented left-column picture.", 40, 316, 9],
        ...Array.from({ length: 20 }, (_, i): TextRun => [BODY, 310, 104 + i * 11, 8]),
        ["2. Methods", 310, 330, 9],
      ],
      shapes: [{ kind: "image", x: 40, top: 100, w: 250, h: 200 }, ...extra],
    });

    it("takes nothing of the right column: its text and its small diagram are 20 pt away", async () => {
      closeTo(await boxOf(twoColumns()), [40, 100, 290, 300]);
      closeTo(await boxOf(twoColumns(square(312, 160, 40, 40, [0.2, 0.6, 0.2]))), [40, 100, 290, 300]);
    });

    it("leaves a body line that the mark would take in: a mark 4 pt over the figure, over a line of the paragraph above", async () => {
      const page = (withBody: boolean): FigurePage => ({
        text: [["Figure 1. An invented left-column picture.", 40, 316, 9], ...(withBody ? [["The invented body paragraph line runs on well past seventy characters so it is body-like.", 40, 91, 10] as TextRun] : [])],
        shapes: [{ kind: "image", x: 40, top: 100, w: 250, h: 200 }, square(270, 90, 26, 6)],
      });
      closeTo(await boxOf(page(false)), [40, 90, 296, 300]);
      closeTo(await boxOf(page(true)), [40, 100, 290, 300]);
    });

    /** Two rasters 10 pt apart: [40, 100, 290, 300] and [300, 100, 550, 300], each with its caption under it. */
    const sideBySide = (extra: Shape[] = [], ops: string[] = []): FigurePage => ({
      text: [["Figure 1. Left picture.", 40, 316, 9], ["Figure 2. Right picture.", 300, 316, 9]],
      shapes: [{ kind: "image", x: 40, top: 100, w: 250, h: 200 }, { kind: "image", x: 300, top: 100, w: 250, h: 200 }, ...extra],
      drawingOps: ops,
    });

    it("gives a mark in the gutter to the nearer figure, not the one that is read first", async () => {
      // [294.5, 299]: 4.5 pt from the left raster and 1 pt from the right one.
      const boxes = [await boxOf(sideBySide([square(294.5, 150, 4.5, 11)]), 0), await boxOf(sideBySide([square(294.5, 150, 4.5, 11)]), 1)];
      closeTo(boxes[0], [40, 100, 290, 300]);
      closeTo(boxes[1], [294.5, 100, 550, 300]);
    });

    it("gives a rotated label in the gutter to the nearer figure too", async () => {
      // The label's box is [291.95, 299.5]: 2 pt from the left raster (9.5 pt out of it) and 0.5 pt from the right one.
      const page = sideBySide([], [rotated("Row one", 297.86, 200)]);
      closeTo(await boxOf(page, 0), [40, 100, 290, 300]);
      closeTo(await boxOf(page, 1), [291.95, 100, 550, 300]);
    });

    it("leaves a mark that lies across both figures to neither", async () => {
      const page = sideBySide([square(286, 150, 18, 12)]);
      closeTo(await boxOf(page, 0), [40, 100, 290, 300]);
      closeTo(await boxOf(page, 1), [300, 100, 550, 300]);
    });
  });
});
