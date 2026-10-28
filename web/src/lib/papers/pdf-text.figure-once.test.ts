// P10-37 (P10-34's unsettled): a paper's figures are measured once. The upload route reads the PDF (and measures
// its figures), and the reading route reads the same bytes again when it first builds the reading; the second
// build asks the figure engine for nothing, because the sizes are kept under the PDF's own hash (nothing per
// user). The PDF here is invented; the measurer is counted, not run.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { barChart, figurePdf, panel, bodyText, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const measure = vi.hoisted(() => vi.fn());
// P12-61 (part 3), re-aimed: the engine measures a paper's figures in one open (`measurePdfFigures`); the counted
// `measure` is still the per-figure measurer behind it, so every count below is the figures measured, as before.
vi.mock("@/lib/figures/pdf-engine", () => ({
  measurePdfFigures: (bytes: Uint8Array, targets: { page: number; fig: number }[]) =>
    Promise.all(targets.map((target) => measure(bytes, target.page, target.fig))),
}));
const revision = vi.hoisted(() => ({ FIGURE_EXTRACTION_REVISION: "invented-old-engine" }));
vi.mock("@/lib/figures/figure-revision", () => revision);

import { extractPdfTextFromBytes, withFigureSizes } from "./pdf-text";

const LEDE = bodyText(
  [
    "Synthetic body text, one line of the introduction, long enough to be read as prose here.",
    "Synthetic body text, a second line of the introduction that goes on for a while longer.",
    "As Figure 1 shows the first result and Figure 2 shows the second one in the same paper.",
  ],
  120,
);

/** Two figures; `tag` makes the bytes (and so the hash) of one paper differ from another's. */
function paperPdf(tag = "one"): Buffer {
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

const sizeOf = (_bytes: Uint8Array, page: number, fig: number) => Promise.resolve(fig === 1 ? { width: 400 + page, height: 300 } : null);

describe("a paper's figures are measured once (P10-37, P10-34's unsettled)", () => {
  beforeEach(() => {
    measure.mockReset();
    measure.mockImplementation(sizeOf);
  });

  it("the second build of the same bytes calls the measurer zero times, and carries the same sizes", async () => {
    const pdf = paperPdf("once");
    const upload = await extractPdfTextFromBytes(pdf);
    expect(upload.ok).toBe(true);
    const firstCalls = measure.mock.calls.length;
    expect(firstCalls).toBe(2);
    const reading = await extractPdfTextFromBytes(Buffer.from(pdf));
    expect(measure.mock.calls.length).toBe(firstCalls);
    expect(reading.doc?.figureCaptions).toEqual(upload.doc?.figureCaptions);
    expect(reading.doc?.figureCaptions.map((c) => [c.width, c.height])).toEqual([[expect.any(Number), 300], [undefined, undefined]]);
  });

  it("a figure the engine found nothing for is not looked for again", async () => {
    const pdf = paperPdf("nothing");
    await extractPdfTextFromBytes(pdf);
    measure.mockClear();
    await extractPdfTextFromBytes(pdf);
    expect(measure).not.toHaveBeenCalled();
  });

  it("another paper's bytes are measured of their own: the key is the PDF's hash", async () => {
    await extractPdfTextFromBytes(paperPdf("alpha"));
    measure.mockClear();
    await extractPdfTextFromBytes(paperPdf("beta"));
    expect(measure.mock.calls.length).toBe(2);
  });

  it("a measuring that failed is tried again on the next build", async () => {
    const pdf = paperPdf("flaky");
    measure.mockRejectedValue(new Error("engine down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const first = await extractPdfTextFromBytes(pdf);
      expect(first.doc?.figureCaptions.every((c) => c.width === undefined)).toBe(true);
      measure.mockReset();
      measure.mockImplementation(sizeOf);
      const second = await extractPdfTextFromBytes(pdf);
      expect(measure.mock.calls.length).toBe(2);
      expect(second.doc?.figureCaptions[0].width).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("withFigureSizes itself keeps them: the same document and bytes twice", async () => {
    const pdf = paperPdf("direct");
    const read = await extractPdfTextFromBytes(pdf);
    const bare = {
      ...read.doc!,
      figureCaptions: read.doc!.figureCaptions.map((cap) => {
        const copy = { ...cap };
        delete copy.width;
        delete copy.height;
        return copy;
      }),
    };
    measure.mockClear();
    const again = await withFigureSizes(bare, new Uint8Array(pdf));
    expect(measure).not.toHaveBeenCalled();
    expect(again.figureCaptions[0].width).toBeGreaterThan(0);
  });

  it("P12-28: changing the engine revision recomputes both an old size and an old null, then reuses the new answers", async () => {
    const pdf = paperPdf("revision-refresh");
    revision.FIGURE_EXTRACTION_REVISION = "invented-old-engine";
    const first = await extractPdfTextFromBytes(pdf);
    expect(first.doc?.figureCaptions.map((c) => c.width)).toEqual([expect.any(Number), undefined]);
    measure.mockReset();
    measure.mockResolvedValue({ width: 721, height: 411 });
    revision.FIGURE_EXTRACTION_REVISION = "invented-new-engine";
    const second = await extractPdfTextFromBytes(pdf);
    expect(measure).toHaveBeenCalledTimes(2);
    expect(second.doc?.figureCaptions.map((c) => [c.width, c.height])).toEqual([[721, 411], [721, 411]]);
    measure.mockClear();
    expect((await extractPdfTextFromBytes(pdf)).doc?.figureCaptions).toEqual(second.doc?.figureCaptions);
    expect(measure).not.toHaveBeenCalled();
  });
});
