// P12-28: every PDF and caption is invented. Exercise the producing engine,
// including the one-region route shape, rather than a caption helper alone.
import { describe, expect, it } from "vitest";
import { figurePdf, panel, pngInfo, type FigurePage } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

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
      text: [["Figure 4. Equal support leaves the region ambiguous.", 40, 268, 9]],
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

  it("preserves two columns with distinct captions, including a raster", async () => {
    const page: FigurePage = {
      text: [["Figure 1. Left panel.", 40, 268, 9], ["Figure 2. Right raster.", 340, 268, 9]],
      shapes: [...panel(40, 100, 180, 150), { kind: "image", x: 340, top: 100, w: 180, h: 150 }],
    };
    expect(await boxes(page)).toEqual([[40, 100, 220, 250], [340, 100, 520, 250]]);
  });

  it("does not turn prose cross references or uncaptioned decorative vectors into labelled figures", async () => {
    expect(await boxes({ text: [["The text refers to Figure 4 elsewhere.", 40, 268, 9]], shapes: panel(40, 100, 180, 150) }, "Figure 4")).toEqual([]);
  });

  it("never searches another page to conceal an incorrect requested page", async () => {
    const pdf = figurePdf([{ text: [["Table 1. Invented rows.", 90, 268, 9]], shapes: panel(90, 100, 360, 150) }, neighbors]);
    expect((await extractPdfFigures(pdf, { ...options, onlyPage: 1, label: "Figure 4", maxFigures: 1 })).figures).toEqual([]);
  });
});
