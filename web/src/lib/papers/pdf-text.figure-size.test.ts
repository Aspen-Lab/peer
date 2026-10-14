// P10-34 (BACKLOG-89) — a figure carries its picture's size from the reading's build, so the page can draw the
// box before the picture arrives (P10-26's `figureBoxStyle`). The PDF here is invented (a vector bar chart and a
// wide panel, of different ratios) and read the way an upload is; the owner's paper is never a fixture.

import { describe, expect, it, vi } from "vitest";
import { barChart, figurePdf, panel, pngInfo, bodyText, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";
import { extractPdfFigures } from "@/lib/figures/pdf-engine";
import { extractPdfTextFromBytes, tryExtractPdfText } from "./pdf-text";
import { buildReading } from "./reading";
import type { Paper } from "@/types";

const LEDE = bodyText(
  [
    "Synthetic body text, one line of the introduction, long enough to be read as prose here.",
    "Synthetic body text, a second line of the introduction that goes on for a while longer.",
    "As Figure 1 shows the first result and Figure 2 shows the second one in the same paper.",
  ],
  120,
);

function paperPdf(): Buffer {
  const first: FigurePage = {
    text: [["A Synthetic Paper About Two Figures", 72, 60, 18], ["Abstract", 72, 100, 13], ...bodyText(["An invented abstract of one sentence, long enough to read as prose in the page."], 118)],
  };
  const second: FigurePage = {
    text: [["1. Introduction", 72, 80, 13], ...LEDE.map(([t, x, top, s]): [string, number, number, number] => [t, x, top + 6, s]), ["Figure 1. A synthetic bar chart of one ratio.", 100, 470, 9]],
    shapes: barChart(110, 250),
  };
  const third: FigurePage = {
    text: [["2. Results", 72, 80, 13], ...bodyText(["More invented prose on the third page, long enough to read as a paragraph of text."], 100), ["Figure 2. A synthetic wide panel of another ratio.", 100, 262, 9]],
    shapes: panel(100, 100 + 40, 370, 100),
  };
  return figurePdf([first, second, third]);
}

const ratio = (w: number, h: number) => w / h;

describe("a placed figure carries its picture's size (P10-34)", () => {
  it("each figure's width and height are positive whole numbers, and their ratio is the picture's within 2 %", async () => {
    const pdf = paperPdf();
    const result = await extractPdfTextFromBytes(pdf);
    expect(result.ok).toBe(true);
    const captions = result.doc?.figureCaptions ?? [];
    expect(captions.map((c) => c.label)).toEqual(["Figure 1", "Figure 2"]);
    const ratios: number[] = [];
    for (const cap of captions) {
      expect(Number.isInteger(cap.width) && cap.width! > 0).toBe(true);
      expect(Number.isInteger(cap.height) && cap.height! > 0).toBe(true);
      const fig = Number(cap.label.replace(/\D/g, ""));
      const { figures } = await extractPdfFigures(new Uint8Array(pdf), { maxPages: 300, maxFigures: 1, onlyPage: cap.page, label: `Figure ${fig}` });
      const info = pngInfo(figures[0].png);
      expect(Math.abs(ratio(cap.width!, cap.height!) / ratio(info.width, info.height) - 1)).toBeLessThanOrEqual(0.02);
      ratios.push(ratio(cap.width!, cap.height!));
    }
    // two figures of different ratios: the sizes are each figure's own, not one shared box
    expect(Math.abs(ratios[0] / ratios[1] - 1)).toBeGreaterThan(0.3);
  });

  it("the reading's figure keeps the size", async () => {
    const result = await extractPdfTextFromBytes(paperPdf());
    const paper = { id: "upload:0123456789abcdef", title: "A Synthetic Paper About Two Figures" } as unknown as Paper;
    const reading = buildReading(paper, { status: "ok", doc: result.doc, sourceLink: { kind: "pdf", url: "https://example.org/x.pdf" } } as never);
    const figures = (reading.body ?? []).flatMap((s) => s.figures ?? []);
    expect(figures.length).toBe(2);
    for (const f of figures) {
      expect(f.width).toBeGreaterThan(0);
      expect(f.height).toBeGreaterThan(0);
    }
  });

  it("a PDF read from a link carries the sizes too", async () => {
    const pdf = paperPdf();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(pdf), { status: 200, headers: { "content-type": "application/pdf" } })));
    try {
      const result = await tryExtractPdfText("https://example.org/p10-34-link.pdf");
      expect(result.ok).toBe(true);
      expect((result.doc?.figureCaptions ?? []).every((c) => c.width! > 0 && c.height! > 0)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a caption with no picture behind it carries no size", async () => {
    const lone: FigurePage = {
      text: [["1. Introduction", 72, 80, 13], ...bodyText(["Invented prose, long enough to read as a paragraph of the introduction."], 100), ["Figure 1. A caption with nothing drawn above it.", 72, 300, 9]],
    };
    const head: FigurePage = { text: [["A Synthetic Paper With No Picture", 72, 60, 18], ["Abstract", 72, 100, 13], ...bodyText(["An invented abstract of one sentence, long enough to read as prose."], 118)] };
    const result = await extractPdfTextFromBytes(figurePdf([head, lone]));
    const captions = result.doc?.figureCaptions ?? [];
    expect(captions.length).toBe(1);
    expect(captions[0].width).toBeUndefined();
    expect(captions[0].height).toBeUndefined();
  });
});
