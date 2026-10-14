import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading, placeFigures, type ReadingFigure, type ReadingSection } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { PaperBody, figureBoxStyle, figureMatClass } from "./paper-body";

// P10-26 (A's X-A8, BACKLOG-89): a figure's room is its own height. The mat reserved the tallest picture there can be
// (32rem) until a picture arrived; a shorter one shrank the page and the settle re-landed the heading in front of the
// reader. When the picture's own width and height travel with the figure record, the mat is an aspect-ratio box of
// exactly that size from the first paint, so the page does not move when the picture comes in; a figure with no known
// size keeps the fixed room it had.

const paper: Paper = {
  id: "openalex:W1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

function readingWith(captions: ExtractedDocument["figureCaptions"]) {
  const doc: ExtractedDocument = {
    source: "pdf",
    pageCount: 3,
    figureCaptions: captions,
    sections: [
      { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
      { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Figure 1 shows the rate.\n\nFigure 2 shows the other.", page: 1 },
    ],
  };
  const fullText: FullTextResult = {
    status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 },
  };
  return buildReading(paper, fullText, new Date("2026-10-14T00:00:00.000Z"));
}

describe("the figure's size travels with its record (P10-26)", () => {
  it("placeFigures carries a caption's picture width and height to the figure", () => {
    const sections: ReadingSection[] = [{ id: "s1", heading: "1", canonical: "introduction", paragraphs: ["Figure 1 shows it."] }];
    const out = placeFigures(sections, [{ ordinal: 0, label: "Figure 1", caption: "Rate.", page: 1, width: 1400, height: 900 }], { paperId: "openalex:W1" });
    const figure = out[0].figures?.[0] as ReadingFigure;
    expect(figure.width).toBe(1400);
    expect(figure.height).toBe(900);
  });

  it("a size that is not two positive whole numbers is not carried", () => {
    const sections: ReadingSection[] = [{ id: "s1", heading: "1", canonical: "introduction", paragraphs: ["Figure 1 shows it. Figure 2 and Figure 3."] }];
    const out = placeFigures(
      sections,
      [
        { ordinal: 0, label: "Figure 1", caption: "A.", page: 1, width: 0, height: 900 },
        { ordinal: 1, label: "Figure 2", caption: "B.", page: 1, width: 1400 },
        { ordinal: 2, label: "Figure 3", caption: "C.", page: 1, width: Number.NaN, height: -3 },
      ],
      { paperId: "openalex:W1" },
    );
    for (const figure of out[0].figures ?? []) {
      expect(figure.width).toBeUndefined();
      expect(figure.height).toBeUndefined();
    }
    expect(out[0].figures).toHaveLength(3);
  });
});

describe("a figure with a known size is an aspect-ratio box from the first paint (P10-26)", () => {
  const sized = readingWith([{ ordinal: 0, label: "Figure 1", caption: "Creep against density.", page: 1, width: 1400, height: 900 }]);
  const html = renderToStaticMarkup(createElement(PaperBody, { reading: sized }));

  it("the box's style comes from the record: the ratio, and never wider than the column, the picture or 32rem's worth", () => {
    expect(html).toContain("aspect-ratio:1400 / 900");
    expect(html).toContain("width:min(100%, 1400px, calc(32rem * 1400 / 900))");
  });

  it("the mat no longer reserves the fixed 32rem, and the picture fills its box", () => {
    expect(html).not.toContain("min-h-[calc(32rem");
    expect(html).toMatch(/<img [^>]*class="block h-full w-full object-contain"/);
    expect(html).toContain('<div class="bg-[var(--plate-mat)] p-3 sm:p-4"><div class="mx-auto" style="aspect-ratio:1400 / 900;');
  });

  it("the box's style is a pure function of the record", () => {
    expect(figureBoxStyle({ ordinal: 0, label: "Figure 1", caption: "", after: 0, width: 800, height: 1200 })).toEqual({
      aspectRatio: "800 / 1200",
      width: "min(100%, 800px, calc(32rem * 800 / 1200))",
    });
  });
});

describe("a figure with no known size keeps the room it had (P10-26)", () => {
  const unsized = readingWith([{ ordinal: 0, label: "Figure 1", caption: "Creep against density.", page: 1 }]);
  const html = renderToStaticMarkup(createElement(PaperBody, { reading: unsized }));

  it("no box: the mat is the first-paint mat and the picture is as it was", () => {
    expect(html).not.toContain("aspect-ratio");
    expect(html).toContain('<div class="bg-[var(--plate-mat)] p-3 sm:p-4"><img ');
    expect(html).toContain('class="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"');
  });

  it("figureBoxStyle is null without both numbers, and the fallback mat is the 32rem one", () => {
    expect(figureBoxStyle({ ordinal: 0, label: "Figure 1", caption: "", after: 0 })).toBeNull();
    expect(figureBoxStyle({ ordinal: 0, label: "Figure 1", caption: "", after: 0, width: 1400 })).toBeNull();
    expect(figureBoxStyle({ ordinal: 0, label: "Figure 1", caption: "", after: 0, width: 0, height: 10 })).toBeNull();
    expect(figureMatClass(true)).toContain("min-h-[calc(32rem+1.5rem)]");
  });
});
