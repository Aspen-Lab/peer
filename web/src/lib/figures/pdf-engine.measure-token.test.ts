// P12-70 (integration of C P12-56 and C P12-61) — `measurePdfFigures` takes the same figure target as
// `measurePdfFigure`: a number ("Figure 3") or the token `ed<N>` ("Extended Data Fig. N"). C P12-61 made the batch
// measurer take a number only, and C P12-56 sized an Extended Data caption by its token, so such a caption was
// never sized. The PDF is invented.

import { describe, expect, it } from "vitest";
import { bodyText, figurePdf, panel, type FigurePage } from "./figure-pdf.test-helper";
import { measurePdfFigure, measurePdfFigures } from "./pdf-engine";

const PAGES: FigurePage[] = [
  {
    text: [...bodyText(["Synthetic body text, one line."], 80), ["Fig. 1 | The main panel.", 100, 330, 9]],
    shapes: panel(100, 140, 330, 170),
  },
  {
    text: [["Extended Data Fig. 1 | The narrow panel of an Extended Data page.", 100, 400, 9]],
    shapes: panel(100, 200, 200, 120),
  },
];
const PDF = figurePdf(PAGES);

describe("measurePdfFigures takes a number or an Extended Data token (P12-70)", () => {
  it("sizes an Extended Data target by its token, as measurePdfFigure does, and each figure by its own label", async () => {
    const targets = [
      { page: 1, fig: 1 },
      { page: 2, fig: "ed1" },
    ];
    const many = await measurePdfFigures(PDF, targets);
    const one = await Promise.all(targets.map((target) => measurePdfFigure(PDF, target.page, target.fig)));
    expect(many).toEqual(one);
    expect(many[0]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(many[1]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(many[0]).not.toEqual(many[1]);
  });

  it("keeps the two numberings apart: a token finds nothing on the page of a main figure, a number nothing on the other", async () => {
    expect(await measurePdfFigures(PDF, [{ page: 1, fig: "ed1" }, { page: 2, fig: 1 }])).toEqual([null, null]);
  });

  it("names nothing by any other string, and measures the targets beside it", async () => {
    const bad = ["ed", "ed0", "ed03", "ED1", "s3", "S3", "1", "ed1a", "ed1000"];
    const sizes = await measurePdfFigures(PDF, [...bad.map((fig) => ({ page: 2, fig })), { page: 2, fig: "ed1" }]);
    expect(sizes.slice(0, bad.length)).toEqual(bad.map(() => null));
    expect(sizes[bad.length]).not.toBeNull();
  });
});
