// P12-47 (B P12-39 M2 / M3 / M4 / M5 / M8): what a figure's region takes in and where its picture ends. Every PDF
// is invented and built here with `figurePdf`; the owner's papers are never a fixture. The rules, one block each:
//   R2a  sub-floor satellites join an accepted, captioned region (the floors themselves do not move)
//   R3a  short figure-text lines within 6 pt join it too (a body paragraph's last line does not)
//   R5a  the padded clip stops at a caption that sits inside the padding
//   R8a  a caption ends at a pitch jump
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { barChart, figurePdf, pngInfo, type FigurePage, type Shape, type TextRun } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

const options = { maxPages: 24, maxFigures: 12 };
const figuresOf = async (page: FigurePage, extra: Record<string, unknown> = {}) =>
  (await extractPdfFigures(figurePdf([page]), { ...options, measureOnly: true, ...extra })).figures;
const boxesOf = async (page: FigurePage) => (await figuresOf(page)).map((figure) => figure.box);

// ── R2a: satellites ──────────────────────────────────────────────────────

describe("P12-47 R2a: sub-floor satellites join an accepted, captioned region", () => {
  // A long caption line, so it sits under the panel beside the raster as well.
  const CAPTION = "Figure 1. An invented raster with a thin strip above it and a small panel beside it, all one figure.";
  /** The figure: a raster 240 x 180 pt, over the 120 / 120 / 20,000 floors. */
  const HOST: Shape = { kind: "image", x: 60, top: 150, w: 240, h: 180 };
  /** A raster strip 70 pt tall (under the 120 pt floor), 4 pt above the figure. */
  const STRIP: Shape = { kind: "image", x: 60, top: 76, w: 240, h: 70 };
  /** A vector cluster 100 x 120 pt = 12,000 pt2: under the 120 pt width floor, over half the floors. */
  const SIDE_PANEL: Shape = { kind: "rect", x: 330, top: 190, w: 100, h: 120 };
  const page = (...shapes: Shape[]): FigurePage => ({ text: [[CAPTION, 60, 345, 9]], shapes: [HOST, ...shapes] });

  it("takes the raster strip above it and the vector cluster beside it", async () => {
    expect(await boxesOf(page())).toEqual([[60, 150, 300, 330]]);
    expect(await boxesOf(page(STRIP, SIDE_PANEL))).toEqual([[60, 76, 430, 330]]);
  });

  it("takes each satellite alone", async () => {
    expect(await boxesOf(page(STRIP))).toEqual([[60, 76, 300, 330]]);
    expect(await boxesOf(page(SIDE_PANEL))).toEqual([[60, 150, 430, 330]]);
  });

  it("repeats until stable: a strip that touches only the first strip joins after it", async () => {
    const second: Shape = { kind: "image", x: 60, top: 30, w: 240, h: 42 };
    expect(await boxesOf(page(STRIP, second))).toEqual([[60, 30, 300, 330]]);
  });

  it("makes no figure of a sub-floor raster or cluster of its own, with a caption or without", async () => {
    const alone: Shape[] = [{ kind: "image", x: 60, top: 150, w: 240, h: 70 }, SIDE_PANEL];
    for (const text of [[], [[CAPTION, 60, 345, 9]]] as FigurePage["text"][]) {
      const result = await extractPdfFigures(figurePdf([{ text, shapes: alone }]), options);
      expect(result.figures).toEqual([]);
      expect(result.reason).not.toBeNull();
    }
  });

  it("takes a raster at a gap of 8 pt and leaves one at 8.5 pt", async () => {
    expect(await boxesOf(page({ kind: "image", x: 60, top: 72, w: 240, h: 70 }))).toEqual([[60, 72, 300, 330]]);
    expect(await boxesOf(page({ kind: "image", x: 60, top: 71.5, w: 240, h: 70 }))).toEqual([[60, 150, 300, 330]]);
  });

  it("leaves a raster that shares less than half of its width with the region", async () => {
    // 100 pt wide, 20 pt of it above the region: 20 < 50.
    expect(await boxesOf(page({ kind: "image", x: 280, top: 76, w: 100, h: 70 }))).toEqual([[60, 150, 300, 330]]);
  });

  it("leaves a vector cluster under half the floors, and one that shares under half of the region's height", async () => {
    // 55 x 100 = 5,500 pt2: under 60 pt wide and under 10,000 pt2, though it shares 100 of the 180 pt.
    expect(await boxesOf(page({ kind: "rect", x: 330, top: 190, w: 55, h: 100 }))).toEqual([[60, 150, 300, 330]]);
    // 170 x 60 = 10,200 pt2 is big enough in area, but shares 60 of the region's 180 pt (half is 90).
    expect(await boxesOf(page({ kind: "rect", x: 330, top: 200, w: 170, h: 60 }))).toEqual([[60, 150, 300, 330]]);
  });

  it("leaves a vector cluster whose own nearest caption is another line", async () => {
    // A table caption directly under the panel is the panel's nearest typed line, and a table is no figure.
    const withTable: FigurePage = { text: [[CAPTION, 60, 345, 9], ["Table 1. Invented rows.", 340, 322, 9]], shapes: [HOST, STRIP, SIDE_PANEL] };
    expect(await boxesOf(withTable)).toEqual([[60, 76, 300, 330]]);
  });

  it("never grows across a caption", async () => {
    // 2 pt under the region and 40 pt tall: it would cover the caption's first line.
    expect(await boxesOf(page({ kind: "image", x: 60, top: 332, w: 240, h: 40 }))).toEqual([[60, 150, 300, 330]]);
  });

  it("never grows across another captioned region", async () => {
    const twoRasters: FigurePage = {
      text: [["Figure 1. Left raster.", 60, 315, 9], ["Figure 2. Right raster.", 240, 315, 9]],
      shapes: [
        { kind: "image", x: 60, top: 150, w: 180, h: 150 },
        { kind: "image", x: 240, top: 150, w: 180, h: 150 },
        // 4 pt above both, 70 pt of its 100 over the left one: it qualifies for the left raster, but joining
        // it would put 30 pt of the right raster inside the left one.
        { kind: "image", x: 170, top: 100, w: 100, h: 46 },
      ],
    };
    expect(await boxesOf(twoRasters)).toEqual([[60, 150, 240, 300], [240, 150, 420, 300]]);
  });
});

// ── R3a: figure text ─────────────────────────────────────────────────────

describe("P12-47 R3a: short figure-text lines within 6 pt join the region", () => {
  // barChart(110, 250): its drawn extent is [110, 240, 380, 400] (the curve's control point sits 10 pt above the axis).
  const CHART = barChart(110, 250);
  const CAPTION = "Figure 1. An invented bar chart with its axis title, and a paragraph above it.";
  /** Helvetica's line box: from `ascent` above the baseline to `descent` below it, per point of size. */
  const ASCENT = 1.0744;
  const DESCENT = 0.2989;
  /** The width of "Time (s)" at 9 pt in Helvetica: T 0.611, i 0.222, m 0.833, e 0.556, space 0.278, ( 0.333, s 0.5, ) 0.333. */
  const TIME_WIDTH = (0.611 + 0.222 + 0.833 + 0.556 + 0.278 + 0.333 + 0.5 + 0.333) * 9;
  /** A text run whose line box starts `gap` below (or ends `gap` above) the chart's edge: baselines worked out here. */
  const belowChart = (text: string, gap: number, x: number, size = 9): TextRun => [text, x, 400 + gap + ASCENT * size, size];
  const aboveChart = (text: string, gap: number, x: number, size = 10): TextRun => [text, x, 240 - gap - DESCENT * size, size];
  const page = (...text: TextRun[]): FigurePage => ({ text: [[CAPTION, 110, 445, 9], ...text], shapes: CHART });
  const closeTo = (actual: number[], expected: number[], tolerance = 0.15) => {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, i) => expect(Math.abs(actual[i] - value), `side ${i} of ${actual}`).toBeLessThanOrEqual(tolerance));
  };
  const boxOf = async (...text: TextRun[]) => {
    const figures = await figuresOf(page(...text));
    expect(figures).toHaveLength(1);
    return figures[0].box!;
  };
  /** A paragraph's lines, over sixty characters each but the last, 13 pt apart, ending `gap` above the chart. */
  const paragraph = (gap: number, last: string): TextRun[] => {
    const lastRun = aboveChart(last, gap, 110);
    return [
      ["The invented paragraph runs on for a long while, well past sixty characters in all.", 110, lastRun[2] - 26, 10],
      ["It carries on in the same way for one more line, which is also longer than sixty.", 110, lastRun[2] - 13, 10],
      lastRun,
    ];
  };

  it("takes an axis title 4 pt under the drawing, and not the last line of a body paragraph 5.5 pt over it", async () => {
    // The title is a block of one short line. The paragraph's block has two lines over 60 characters: body text.
    closeTo(await boxOf(), [110, 240, 380, 400]);
    closeTo(await boxOf(belowChart("Time (s)", 4, 215)), [110, 240, 380, 416.36]);
    closeTo(await boxOf(belowChart("Time (s)", 4, 215), ...paragraph(5.5, "which closes it.")), [110, 240, 380, 416.36]);
  });

  it("would have taken that last line had its block held no line over 60 characters", async () => {
    // The control for the test above: the same short line, in the same place, alone.
    closeTo(await boxOf(aboveChart("which closes it.", 5.5, 110)), [110, 240 - 5.5 - 13.74, 380, 400]);
  });

  it("takes a line of 60 characters and leaves one of 61", async () => {
    const sixty = "Elapsed time since the run began, in seconds (log scale) abc".slice(0, 60);
    expect(sixty).toHaveLength(60);
    closeTo(await boxOf(belowChart(sixty, 4, 112, 8)), [110, 240, 380, 400 + 4 + (ASCENT + DESCENT) * 8]);
    closeTo(await boxOf(belowChart(`${sixty}d`, 4, 112, 8)), [110, 240, 380, 400]);
  });

  it("takes a line 6 pt away and leaves one 6.5 pt away", async () => {
    closeTo(await boxOf(belowChart("Time (s)", 6, 215)), [110, 240, 380, 400 + 6 + (ASCENT + DESCENT) * 9]);
    closeTo(await boxOf(belowChart("Time (s)", 6.5, 215)), [110, 240, 380, 400]);
  });

  it("repeats: a line within 6 pt of the first line it took joins too", async () => {
    // 4 pt under the drawing, then a second title 5 pt under that one.
    const first = 400 + 4 + (ASCENT + DESCENT) * 9;
    closeTo(await boxOf(belowChart("Time (s)", 4, 215), belowChart("Arbitrary units", first - 400 + 5, 215)), [110, 240, 380, first + 5 + (ASCENT + DESCENT) * 9]);
  });

  it("stays inside the region's width widened by 6 pt", async () => {
    // All 4 pt under the drawing. One starting 8 pt left of it, or ending 8 pt right of it, is out; one 5 pt left
    // is in, and the region grows to hold the whole line.
    const bottom = 400 + 4 + (ASCENT + DESCENT) * 9;
    closeTo(await boxOf(belowChart("Time (s)", 4, 102)), [110, 240, 380, 400]);
    closeTo(await boxOf(belowChart("Time (s)", 4, 105)), [105, 240, 380, bottom]);
    closeTo(await boxOf(belowChart("Time (s)", 4, 395 - TIME_WIDTH)), [110, 240, 380, 400]);
    closeTo(await boxOf(belowChart("Time (s)", 4, 385 - TIME_WIDTH)), [110, 240, 385, bottom]);
  });

  it("leaves a line level with the caption, and the caption's own line", async () => {
    // Beside the caption, 4 pt under the drawing: not above the caption.
    const page2: FigurePage = {
      text: [["Figure 1. Short.", 110, 400 + 4 + ASCENT * 9, 9], ["Panel note", 330, 400 + 4 + ASCENT * 9, 9]],
      shapes: CHART,
    };
    const figures = await figuresOf(page2);
    expect(figures).toHaveLength(1);
    closeTo(figures[0].box!, [110, 240, 380, 400]);
  });

  it("takes figure text under a drawing whose caption is above it", async () => {
    const above: FigurePage = { text: [[CAPTION, 110, 215, 9], belowChart("Time (s)", 4, 215)], shapes: CHART };
    const figures = await figuresOf(above);
    expect(figures).toHaveLength(1);
    closeTo(figures[0].box!, [110, 240, 380, 416.36]);
  });

  it("leaves a page's lines alone when no region has a typed caption", async () => {
    const result = await extractPdfFigures(figurePdf([{ text: [["No caption here.", 110, 215, 9], belowChart("Time (s)", 4, 215)], shapes: CHART }]), options);
    expect(result.figures).toEqual([]);
  });
});

// ── R5a: the clip stops at a caption inside the padding ──────────────────

/** The pixels of an 8-bit RGB or RGBA PNG as rows of [r, g, b] (enough of a decoder for the engine's own output). */
function pngRows(png: Uint8Array): { width: number; height: number; rows: number[][][] } {
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
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => [0, 1, 2].map((c) => pixels[y * stride + x * channels + c])),
  );
  return { width, height, rows };
}
/** Is any pixel of these rows dark (every channel under 128)? The raster's own gradient has a blue channel of 128. */
const hasInk = (rows: number[][][]) => rows.some((row) => row.some((pixel) => pixel.every((channel) => channel < 128)));

describe("P12-47 R5a: the padded clip stops at a caption that sits inside the padding", () => {
  const SCALE = 2.8;
  /** The raster [100, 150, 300, 350] of the engine's own fixtures, and a caption line whose box starts `gap` below it. */
  const raster: Shape = { kind: "image", x: 100, top: 150, w: 200, h: 200 };
  const captionBelow = (gap: number, label = "Figure 1. A synthetic raster drawn into a box."): TextRun => [label, 100, 350 + gap + 1.0744 * 9, 9];
  const render = async (page: FigurePage) => {
    const result = await extractPdfFigures(figurePdf([page]), options);
    expect(result.figures).toHaveLength(1);
    const [figure] = result.figures;
    expect(pngInfo(figure.png)).toMatchObject({ signature: true, width: figure.width, height: figure.height });
    return figure;
  };
  const near = (actual: number, expected: number, tolerance = 1) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

  it("ends the clip 0.5 pt above a caption 5 pt under the picture, and shows none of its ink", async () => {
    const figure = await render({ text: [captionBelow(5)], shapes: [raster] });
    expect(figure.box).toEqual([100, 150, 300, 350]);
    // The clip is [90, 140, 310, 354.5] at 2.8 (and not 360, the box plus 10 pt: 616 px).
    near(figure.width, 220 * SCALE);
    near(figure.height, (354.5 - 140) * SCALE);
    // Everything under the picture's own edge (row 588) is white page.
    expect(hasInk(pngRows(figure.png).rows.slice(Math.round(210 * SCALE)))).toBe(false);
  });

  it("keeps the full 10 pt padding for a caption 12 pt away, and the ink check sees a mark in that band", async () => {
    const far = await render({ text: [captionBelow(12)], shapes: [raster] });
    near(far.height, 220 * SCALE);
    // Control for the ink check above: a rule 3 pt under the picture is inside the clip, so the same check finds it.
    const ruled = await render({ text: [captionBelow(5)], shapes: [raster, { kind: "line", x1: 100, top1: 353, x2: 300, top2: 353 }] });
    expect(hasInk(pngRows(ruled.png).rows.slice(Math.round(210 * SCALE)))).toBe(true);
  });

  it("ends the clip at the picture's own edge for a caption closer than 0.5 pt", async () => {
    const figure = await render({ text: [captionBelow(0.2)], shapes: [raster] });
    near(figure.height, 210 * SCALE);
  });

  it("ends the clip 0.5 pt under a caption above the picture, when it sits inside the padding", async () => {
    // The caption's box ends 5 pt over the picture: its descenders are inside a 10 pt padding.
    const above: FigurePage = { text: [["Figure 1. A synthetic raster drawn into a box.", 100, 145 - 0.2989 * 9, 9]], shapes: [raster] };
    const figure = await render(above);
    expect(figure.box).toEqual([100, 150, 300, 350]);
    near(figure.height, (360 - 145.5) * SCALE);
    // Rows over the picture's top edge (150): row (150 - 145.5) * 2.8 = 12.6 and above are white page.
    expect(hasInk(pngRows(figure.png).rows.slice(0, Math.floor(4.5 * SCALE)))).toBe(false);
  });

  it("stops at the nearest text line under a raster that has no typed caption", async () => {
    const figure = await render({ text: [captionBelow(5, "A line of text that is not a caption.")], shapes: [raster] });
    near(figure.height, (354.5 - 140) * SCALE);
  });

  it("keeps the 10 pt padding when the caption's first line is outside it", async () => {
    // 10.3 pt under the picture, as the engine's paper fixture has it.
    near((await render({ text: [captionBelow(10.3)], shapes: [raster] })).height, 220 * SCALE);
  });
});
