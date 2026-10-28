// P12-61 (§1h.434, part 3) — `withFigureSizes` opens the PDF once for all of a paper's captions: one call to the
// engine with every figure, where it made one call (and one open of the whole file) per caption. The engine is the
// real one on an invented PDF; its batch measurer is watched.

import { describe, expect, it, vi } from "vitest";
import { barChart, bodyText, figurePdf, panel, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const watched = vi.hoisted(() => ({ measurePdfFigures: vi.fn(), measurePdfFigure: vi.fn() }));
vi.mock("@/lib/figures/pdf-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/figures/pdf-engine")>();
  watched.measurePdfFigures.mockImplementation(actual.measurePdfFigures);
  watched.measurePdfFigure.mockImplementation(actual.measurePdfFigure);
  return { ...actual, measurePdfFigures: watched.measurePdfFigures, measurePdfFigure: watched.measurePdfFigure };
});

import { extractPdfTextFromBytes } from "./pdf-text";

const LEDE = bodyText(
  [
    "Synthetic body text, one line of the introduction, long enough to be read as prose here.",
    "Synthetic body text, a second line of the introduction that goes on for a while longer.",
    "As Figure 1 shows the first result and Figure 2 shows the second one in the same paper.",
  ],
  120,
);

function paperPdf(tag: string): Buffer {
  const first: FigurePage = {
    text: [[`A Synthetic Paper About Two Figures ${tag}`, 72, 60, 18], ["Abstract", 72, 100, 13], ...bodyText(["An invented abstract of one sentence, long enough to read as prose in the page."], 118)],
  };
  const second: FigurePage = {
    text: [["1. Introduction", 72, 80, 13], ...LEDE.map(([t, x, top, s]): [string, number, number, number] => [t, x, top + 6, s]), ["Figure 1. A synthetic bar chart of one ratio.", 100, 470, 9]],
    shapes: barChart(110, 250),
  };
  const third: FigurePage = {
    text: [["2. Results", 72, 80, 13], ...bodyText(["More invented prose on the third page, long enough to read as a paragraph of text."], 100), ["Figure 2. A synthetic wide panel of another ratio.", 100, 280, 9]],
    shapes: panel(100, 130, 370, 130),
  };
  return figurePdf([first, second, third]);
}

describe("withFigureSizes opens the PDF once for all captions (P12-61)", () => {
  it("makes one batch call carrying both figures, and none of the one-figure calls", async () => {
    const result = await extractPdfTextFromBytes(paperPdf("one open"));

    expect(result.ok).toBe(true);
    expect(watched.measurePdfFigures).toHaveBeenCalledTimes(1);
    expect(watched.measurePdfFigures.mock.calls[0][1]).toEqual([
      { page: 2, fig: 1 },
      { page: 3, fig: 2 },
    ]);
    expect(watched.measurePdfFigure).not.toHaveBeenCalled();
    // And both captions carry their picture's size.
    expect(result.doc?.figureCaptions.map((cap) => cap.width && cap.height)).toEqual([expect.any(Number), expect.any(Number)]);
  });

  it("asks the engine for nothing the second time: the sizes are kept under the PDF's hash", async () => {
    const pdf = paperPdf("kept sizes");
    await extractPdfTextFromBytes(pdf);
    watched.measurePdfFigures.mockClear();
    await extractPdfTextFromBytes(Buffer.from(pdf));
    expect(watched.measurePdfFigures).not.toHaveBeenCalled();
  });

  it("does not remember a figure the budget left unmeasured, and remembers the others", async () => {
    const pdf = paperPdf("budget");
    watched.measurePdfFigures.mockImplementationOnce(async () => [{ width: 640, height: 360 }, undefined]);
    const first = await extractPdfTextFromBytes(pdf);
    expect(first.doc?.figureCaptions.map((cap) => cap.width)).toEqual([640, undefined]);

    watched.measurePdfFigures.mockClear();
    const second = await extractPdfTextFromBytes(Buffer.from(pdf));
    // Only the unmeasured one is asked for again.
    expect(watched.measurePdfFigures).toHaveBeenCalledTimes(1);
    expect(watched.measurePdfFigures.mock.calls[0][1]).toEqual([{ page: 3, fig: 2 }]);
    expect(second.doc?.figureCaptions[0].width).toBe(640);
    expect(second.doc?.figureCaptions[1].width).toBeGreaterThan(0);
  });

  it("carries on without sizes, and tries again next time, when the engine will not load", async () => {
    const pdf = paperPdf("no engine");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    watched.measurePdfFigures.mockRejectedValueOnce(new Error("no wasm"));
    const first = await extractPdfTextFromBytes(pdf);
    expect(first.ok).toBe(true);
    expect(first.doc?.figureCaptions.every((cap) => cap.width === undefined)).toBe(true);

    watched.measurePdfFigures.mockClear();
    const second = await extractPdfTextFromBytes(Buffer.from(pdf));
    expect(watched.measurePdfFigures).toHaveBeenCalledTimes(1);
    expect(second.doc?.figureCaptions.every((cap) => (cap.width ?? 0) > 0)).toBe(true);
  });
});
