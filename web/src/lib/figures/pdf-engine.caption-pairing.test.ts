// P12-28: every PDF and caption is invented. Exercise the producing engine,
// including the one-region route shape, rather than a caption helper alone.
import { describe, expect, it } from "vitest";
import { figurePdf, panel, pngInfo, type FigurePage } from "./figure-pdf.test-helper";
import { extractPdfFigures, mergeCaptionLines } from "./pdf-engine";

const options = { maxPages: 24, maxFigures: 12 };
const boxes = async (page: FigurePage, label?: string) => {
  const result = await extractPdfFigures(figurePdf([page]), {
    ...options, ...(label ? { onlyPage: 1, label, maxFigures: 1 } : {}),
  });
  for (const figure of result.figures) {
    expect(pngInfo(figure.png)).toMatchObject({ signature: true, width: figure.width, height: figure.height });
  }
  return result.figures.map((figure) => figure.box);
};

describe("P12-28: defensible typed caption pairing", () => {
  const neighbors: FigurePage = {
    text: [["Table 1. Invented calibration rows.", 90, 268, 9], ["Figure 4. Invented colored chart.", 90, 448, 9]],
    shapes: [...panel(90, 100, 360, 150), ...panel(90, 280, 360, 150)],
  };

  it("a nearby Table caption vetoes borrowing the farther Figure caption in the whole pool", async () => {
    expect(await boxes(neighbors)).toEqual([[90, 280, 450, 430]]);
  });

  it("excludes a raster with a nearby Table caption rather than treating it as an uncaptioned image", async () => {
    const page: FigurePage = {
      text: [["Table 1. Invented raster rows.", 90, 268, 9], ["Figure 4. Invented chart.", 90, 448, 9]],
      shapes: [{ kind: "image", x: 90, top: 100, w: 360, h: 150 }, ...panel(90, 280, 360, 150)],
    };
    expect(await boxes(page)).toEqual([[90, 280, 450, 430]]);
  });

  it("the requested label with maxFigures 1 returns the chart, never the earlier table", async () => {
    expect(await boxes(neighbors, "Figure 4")).toEqual([[90, 280, 450, 430]]);
  });

  it("cross-column Table 3 cannot acquire Figure 5 when the actual diagram is below the unchanged floors", async () => {
    const page: FigurePage = {
      text: [["Table 3. Invented row values.", 40, 268, 9], ["Figure 5. Invented compact diagram.", 345, 258, 9]],
      shapes: [...panel(40, 100, 180, 150), { kind: "rect", x: 345, top: 160, w: 200, h: 70 }],
    };
    expect(await boxes(page)).toEqual([]);
    expect(await boxes(page, "Figure 5")).toEqual([]);
  });

  it("a drawing in the other column cannot borrow even a nearby explicit Figure caption", async () => {
    expect(await boxes({ text: [["Figure 5. A right-column caption.", 350, 268, 9]], shapes: panel(40, 100, 180, 150) }, "Figure 5")).toEqual([]);
  });

  it("competing same-label regions choose the nearer caption relation rather than page order", async () => {
    const page: FigurePage = {
      text: [["Figure 4. The lower chart has this caption.", 90, 448, 9]],
      shapes: [...panel(90, 100, 360, 150), ...panel(90, 280, 360, 150)],
    };
    expect(await boxes(page)).toEqual([[90, 280, 450, 430]]);
    expect(await boxes(page, "Figure 4")).toEqual([[90, 280, 450, 430]]);
  });

  it("equally supported disjoint same-label candidates are honestly absent", async () => {
    const page: FigurePage = {
      // P12-28 fixture correction: at 9pt the line ended before the right
      // region. At 12pt its actual bounds overlap BOTH regions, so the
      // equal vertical relation really is ambiguous (no assertion relaxed).
      text: [["Figure 4. Equal support leaves the region ambiguous.", 40, 268, 12]],
      shapes: [...panel(40, 100, 180, 150), ...panel(260, 100, 180, 150)],
    };
    expect(await boxes(page, "Figure 4")).toEqual([]);
  });

  it("preserves a caption above its figure and a full-width multipanel region", async () => {
    const page: FigurePage = {
      text: [["Figure 2. Invented panels share one frame.", 50, 90, 9]],
      shapes: [{ kind: "rect", x: 50, top: 110, w: 510, h: 150 }, ...panel(70, 120, 200, 130), ...panel(320, 120, 200, 130)],
    };
    expect(await boxes(page, "Figure 2")).toEqual([[50, 110, 560, 260]]);
  });

  // Re-aimed (P12-84 R3-B): the same page and the same two columns, one box per caption; only the right box's left edge
  // moves, from 340 to 310. `panel(40, ...)` draws its fourth square (44 x 44 pt, under the piece floor) at x 310 to 354,
  // past the panel's own frame, so it overlaps the raster's left edge: a small mark on a figure's edge now joins that figure
  // (the left panel is 90 pt away from it, so it is the raster's). Nothing crosses between the columns.
  it("preserves two columns with distinct captions, including a raster", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Left panel.", 40, 268, 9], ["Figure 2. Right raster.", 340, 268, 9]],
      shapes: [...panel(40, 100, 180, 150), { kind: "image", x: 340, top: 100, w: 180, h: 150 }],
    };
    expect(await boxes(page)).toEqual([[40, 100, 220, 250], [310, 100, 520, 250]]);
  });

  // Re-aimed (P12-84 R3-B), as the test above: the right box is [310, 100, 520, 250], the raster and the left panel's fourth
  // square that overlaps its left edge; the captions, their continuation and the left box are as they were.
  it("keeps column labels and continuation when another column interrupts the sorted lines", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Left start.", 40, 268, 9], ["Figure 2. Right start.", 340, 268, 9], ["Left continuation words.", 40, 282, 9]],
      shapes: [...panel(40, 100, 180, 150), { kind: "image", x: 340, top: 100, w: 180, h: 150 }],
    };
    const pdf = figurePdf([page]);
    const pick = async (label?: string) => (await extractPdfFigures(pdf, { ...options, measureOnly: true, ...(label ? { onlyPage: 1, label, maxFigures: 1 } : {}) })).figures.map(({ box, caption }) => ({ box, caption }));
    const expected = [
      { box: [40, 100, 220, 250], caption: "Figure 1. Left start. Left continuation words." },
      { box: [310, 100, 520, 250], caption: "Figure 2. Right start." },
    ];
    expect(await pick()).toEqual(expected);
    expect(await pick("Figure 1")).toEqual([expected[0]]);
    expect(await pick("Figure 2")).toEqual([expected[1]]);
  });

  it.each([10, 14])("preserves complete caption text at %ipt baseline spacing in the pool and requested route", async (spacing) => {
    const page: FigurePage = {
      text: [["Figure 1. A first line", 40, 268, 9], ["continues with detail.", 40, 268 + spacing, 9]],
      shapes: panel(40, 100, 180, 150),
    };
    const pdf = figurePdf([page]);
    const expected = [{ box: [40, 100, 220, 250], caption: "Figure 1. A first line continues with detail." }];
    const pick = async (label?: string) => (await extractPdfFigures(pdf, { ...options, measureOnly: true, ...(label ? { onlyPage: 1, label, maxFigures: 1 } : {}) })).figures.map(({ box, caption }) => ({ box, caption }));
    expect(await pick()).toEqual(expected);
    expect(await pick("Figure 1")).toEqual(expected);
  });

  it("stops at a later typed caption even when original-block line bounds overlap", () => {
    expect(mergeCaptionLines([
      { rect: [40, 258, 140, 271], text: "Figure 1. Start.", blockId: 1 },
      { rect: [40, 268, 140, 281], text: "Table 2. Next.", blockId: 1 },
    ], 0)).toBe("Figure 1. Start.");
  });

  it("retains a later original-block line despite an intervening distant block", () => {
    expect(mergeCaptionLines([
      { rect: [40, 260, 140, 270], text: "Figure 1. Start.", blockId: 1 },
      { rect: [40, 310, 140, 320], text: "Distant unrelated block.", blockId: 2 },
      { rect: [40, 350, 140, 360], text: "Original block continuation.", blockId: 1 },
    ], 0)).toBe("Figure 1. Start. Original block continuation.");
  });

  it("stops a caption before the next typed caption in its column", async () => {
    const page: FigurePage = { text: [["Figure 1. First caption.", 40, 268, 9], ["Table 2. Following table.", 40, 282, 9]], shapes: panel(40, 100, 180, 150) };
    const result = await extractPdfFigures(figurePdf([page]), { ...options, onlyPage: 1, label: "Figure 1", maxFigures: 1, measureOnly: true });
    expect(result.figures.map(({ box, caption }) => ({ box, caption }))).toEqual([{ box: [40, 100, 220, 250], caption: "Figure 1. First caption." }]);
  });

  // P12-47 R8a re-aim (title and comment only: the fixture and the assertion are as they were, and still hold). A
  // caption now ends at a pitch jump, but a one-line caption has no pitch of its own to jump from, so a body line
  // right under it is still joined: the limit R8a leaves. The jump itself is pinned in
  // `pdf-engine.figure-regions.test.ts` ("ends a caption of two lines before a body paragraph set apart by twice its pitch").
  it("still joins a body line right under a one-line caption (R8a ends a caption at a pitch jump; this one has no pitch yet)", async () => {
    const page: FigurePage = { text: [["Figure 1. Complete caption.", 40, 268, 9], ["The body references Figure 1.", 40, 282, 9]], shapes: panel(40, 100, 180, 150) };
    const result = await extractPdfFigures(figurePdf([page]), { ...options, onlyPage: 1, label: "Figure 1", maxFigures: 1, measureOnly: true });
    expect(result.figures[0]?.caption).toBe("Figure 1. Complete caption. The body references Figure 1.");
  });

  it("does not split an inline Figure mention into a new supported label", async () => {
    const page: FigurePage = { text: [["Figure 1. Left.     Figure 2. Right.", 40, 268, 9]], shapes: [...panel(40, 100, 180, 150), ...panel(260, 100, 180, 150)] };
    const result = await extractPdfFigures(figurePdf([page]), { ...options, onlyPage: 1, label: "Figure 2", maxFigures: 1, measureOnly: true });
    expect(result.figures).toEqual([]);
  });

  it("does not turn prose cross references or uncaptioned decorative vectors into labelled figures", async () => {
    expect(await boxes({ text: [["The text refers to Figure 4 elsewhere.", 40, 268, 9]], shapes: panel(40, 100, 180, 150) }, "Figure 4")).toEqual([]);
  });

  it("uses nested transformed clipping bounds for a filled path that extends past its caption", async () => {
    const page: FigurePage = {
      text: [["Figure 4. Invented clipped panel.", 90, 268, 9]],
      // In PDF coordinates: page-space x90..450, y542..692. The fill extends
      // below the clip into the caption; nested transform preserves that clip.
      drawingOps: ["q 90 542 360 150 re W n", "q 1 0 0 1 90 542 cm 0 0 360 150 re W n", "0 -52 360 202 re f Q Q"],
    };
    expect(await boxes(page)).toEqual([[90, 100, 450, 250]]);
    expect(await boxes(page, "Figure 4")).toEqual([[90, 100, 450, 250]]);
  });

  it("preserves a stroked, transformed clip and its visible edge", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented stroked panel.", 90, 268, 9]],
      drawingOps: ["q 90 542 360 150 re W n 1 0 0 1 90 542 cm 4 w 0 0 360 150 re S Q"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([[90, 100, 450, 250]]);
  });

  it("retains zero-width vertical and horizontal stroked lines when they cross a caption", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented interior label.", 90, 268, 9]],
      drawingOps: ["90 542 360 150 re f", "2 w 90 542 m 90 490 l S", "90 490 m 450 490 l S"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([]);
  });

  it("restores the previous clip after a nested graphics state closes", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented panel.", 90, 268, 9]],
      drawingOps: ["q 90 542 360 150 re W n q 90 600 360 92 re W n 90 490 360 202 re f Q 90 542 360 150 re f Q"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([[90, 100, 450, 250]]);
  });

  it("does not invent a tight rectangle for an unsupported text clip", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented interior label.", 90, 268, 9]],
      drawingOps: ["q BT /F1 9 Tf 7 Tr 90 600 Td (clip) Tj ET 90 490 360 202 re f Q"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([]);
  });

  it("restores a known outer clip after an unsupported inner text clip", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented panel.", 90, 268, 9]],
      drawingOps: ["q 90 542 360 150 re W n q BT /F1 9 Tf 7 Tr 90 600 Td (clip) Tj ET Q 90 490 360 202 re f Q"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([[90, 100, 450, 250]]);
  });

  it("keeps original fill support when clip nesting exceeds the retained-state limit", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented interior label.", 90, 268, 9]],
      drawingOps: [...Array(129).fill("q 90 542 360 150 re W n"), "90 490 360 202 re f", ...Array(129).fill("Q")],
    };
    expect(await boxes(page, "Figure 1")).toEqual([]);
  });

  it("ignores an unpainted trailing move without changing the region or rendered pixels", async () => {
    const make = (trailing: boolean) => figurePdf([{ text: [["Figure 1. Invented panel.", 100, 318, 9]], drawingOps: [`100 492 300 200 re ${trailing ? "500 92 m " : ""}f`] }]);
    const pick = async (pdf: Buffer) => (await extractPdfFigures(pdf, { ...options, onlyPage: 1, label: "Figure 1", maxFigures: 1 })).figures;
    const plain = await pick(make(false));
    const withMove = await pick(make(true));
    expect(plain.map(({ box, caption }) => ({ box, caption }))).toEqual([{ box: [100, 100, 400, 300], caption: "Figure 1. Invented panel." }]);
    expect(withMove.map(({ box, caption }) => ({ box, caption }))).toEqual(plain.map(({ box, caption }) => ({ box, caption })));
    expect(withMove[0].png).toEqual(plain[0].png);
  });

  it("keeps a genuinely drawn later subpath start under transform and clip", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Invented two-part panel.", 100, 318, 9]],
      drawingOps: ["q 1 0 0 1 10 0 cm 90 492 470 200 re W n 90 492 300 200 re 550 692 m 510 692 l 510 492 l f Q"],
    };
    expect(await boxes(page, "Figure 1")).toEqual([[100, 100, 560, 300]]);
  });

  it("does not pair a truly painted extension through its caption", async () => {
    const page: FigurePage = { text: [["Figure 4. Invented interior label.", 90, 268, 9]], drawingOps: ["90 490 360 202 re f"] };
    expect(await boxes(page, "Figure 4")).toEqual([]);
  });

  it("never searches another page to conceal an incorrect requested page", async () => {
    const pdf = figurePdf([{ text: [["Table 1. Invented rows.", 90, 268, 9]], shapes: panel(90, 100, 360, 150) }, neighbors]);
    expect((await extractPdfFigures(pdf, { ...options, onlyPage: 1, label: "Figure 4", maxFigures: 1 })).figures).toEqual([]);
  });
});

describe("P12-56 (R14a): an Extended Data caption is a typed caption of its own numbering", () => {
  // Panel A has an Extended Data caption right under it; panel B, below, has "Figure 4". Before R14a the
  // Extended Data line was no typed caption, so A (the typed caption within reach being B's) took "Figure 4"
  // as well, lost it to the nearer B and was dropped.
  const twoPanels: FigurePage = {
    text: [["Extended Data Fig. 1 | Invented extended panel.", 100, 212, 9], ["Figure 4. Invented main panel.", 100, 392, 9]],
    shapes: [...panel(100, 60, 370, 130), ...panel(100, 240, 370, 130)],
  };

  it("lists both panels, each with its own caption, in the whole pool", async () => {
    const result = await extractPdfFigures(figurePdf([twoPanels]), options);
    expect(result.figures.map((f) => f.caption)).toEqual(["Extended Data Fig. 1 | Invented extended panel.", "Figure 4. Invented main panel."]);
  });

  it("draws the region of the label it is asked for: 'Extended Data Fig. 1' the upper panel, 'Figure 4' the lower, 'Figure 1' none", async () => {
    expect(await boxes(twoPanels, "Extended Data Fig. 1")).toEqual([[100, 60, 470, 190]]);
    expect(await boxes(twoPanels, "Extended Data Figure 1")).toEqual([[100, 60, 470, 190]]);
    expect(await boxes(twoPanels, "Figure 4")).toEqual([[100, 240, 470, 370]]);
    expect(await boxes(twoPanels, "Figure 1")).toEqual([]);
    expect(await boxes(twoPanels, "Fig. 1")).toEqual([]);
  });

  it("does not take 'Supplementary Fig. 4' or 'Fig. S4' for a caption of Figure 4: the label of another file's figure finds nothing", async () => {
    const page: FigurePage = {
      text: [["Supplementary Fig. 4 | Invented panel of another file.", 100, 212, 9]],
      shapes: panel(100, 60, 370, 130),
    };
    expect(await boxes(page, "Figure 4")).toEqual([]);
    expect(await boxes(page, "Figure S4")).toEqual([]);
    expect(await boxes(page, "Supplementary Fig. 4")).toEqual([]);
    const sPage: FigurePage = { text: [["Fig. S4 | Invented panel of another file.", 100, 212, 9]], shapes: panel(100, 60, 370, 130) };
    expect(await boxes(sPage, "Figure 4")).toEqual([]);
    expect(await boxes(sPage, "Figure S4")).toEqual([]);
  });

  it("a nearby Extended Data caption vetoes a farther Figure caption for a region, as a nearby Table does", async () => {
    const page: FigurePage = {
      text: [["Extended Data Fig. 2 | Invented extended panel.", 100, 212, 9], ["Figure 6. A farther caption in reach.", 100, 392, 9]],
      shapes: panel(100, 60, 370, 130),
    };
    expect(await boxes(page, "Extended Data Fig. 2")).toEqual([[100, 60, 470, 190]]);
    expect(await boxes(page, "Figure 6")).toEqual([]);
  });
});
