// P12-47 (B P12-39 M2 / M3 / M4 / M5 / M8): what a figure's region takes in and where its picture ends. Every PDF
// is invented and built here with `figurePdf`; the owner's papers are never a fixture. The rules, one block each:
//   R2a  sub-floor satellites join an accepted, captioned region (the floors themselves do not move)
//   R3a  short figure-text lines within 6 pt join it too (a body paragraph's last line does not)
//   R5a  the padded clip stops at a caption that sits inside the padding
//   R8a  a caption ends at a pitch jump
import { describe, expect, it } from "vitest";
import { figurePdf, type FigurePage, type Shape } from "./figure-pdf.test-helper";
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
