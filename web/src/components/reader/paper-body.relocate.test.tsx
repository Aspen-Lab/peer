import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { PaperBody, paragraphAnchor } from "./paper-body";

// P10-35 (BACKLOG-91; ruling §1h.101, rules 1 and 2): a saved note's anchor is positional. When the paragraph under its id
// does not hold the words it was taken on at [start, end), the body draws no mark and no tag there; it finds the quote in
// the same section (nearest first), then in the whole body, and marks the words where they now stand. Every text is invented.

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const readingOf = (...paragraphs: string[]) => {
  const doc: ExtractedDocument = {
    source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
    sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: paragraphs.join("\n\n"), page: 1 }],
  };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
  return buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
};
const A = "Creep limits the life of hot parts in service.";
const B = "Grain boundaries carry the strain when the load is held.";
const C = "The finest grains crept fastest when annealed at the lowest temperature.";
const QUOTE = "finest grains crept fastest";
const start = C.indexOf(QUOTE);
// the note was taken when C was paragraph 2
const anchors = { [paragraphAnchor(0, 2)]: [{ id: "a", n: 1, start, end: start + QUOTE.length, quote: QUOTE }] };
const render = (reading: ReturnType<typeof readingOf>, noteAnchors: typeof anchors | Record<string, never> = anchors) =>
  renderToStaticMarkup(createElement(PaperBody, { reading, noteAnchors }));
const paragraphHtml = (html: string, i: number) => {
  const from = html.indexOf(`<div id="${paragraphAnchor(0, i)}"`);
  return html.slice(from, html.indexOf("</p>", from) + 4);
};
const MARK = /<mark data-note="1"[^>]*>finest grains crept fastest<\/mark>/;

describe("PaperBody — a note whose paragraph moved (P10-35)", () => {
  it("is as before when the words stand where the anchor says (no change for a matching anchor)", () => {
    const html = render(readingOf(A, B, C));
    expect(paragraphHtml(html, 2)).toMatch(MARK);
    expect(html.match(/<mark\b/g)).toHaveLength(1);
  });

  it("draws no mark and no tag on the words that now stand under the old id (rule 1)", () => {
    // the first paragraph's text is longer, so a paragraph was added above: paragraph 2 is now B
    const html = render(readingOf(A, A, B, C));
    expect(paragraphHtml(html, 2)).not.toContain("<mark");
    expect(paragraphHtml(html, 2)).not.toContain("Open note 1");
    expect(paragraphHtml(html, 2)).toContain(B);
  });

  it("marks the words where they now stand after a paragraph above was split in two (rule 2)", () => {
    const html = render(readingOf(A.slice(0, 20), A.slice(20), B, C));
    expect(paragraphHtml(html, 3)).toMatch(MARK);
    expect(paragraphHtml(html, 3)).toContain("Open note 1");
    for (const i of [0, 1, 2]) expect(paragraphHtml(html, i)).not.toContain("<mark");
    expect(html.match(/<mark\b/g)).toHaveLength(1);
  });

  it("marks them when the section gains a paragraph above, and when it loses one (rule 2)", () => {
    expect(paragraphHtml(render(readingOf(A, A, B, C)), 3)).toMatch(MARK);
    expect(paragraphHtml(render(readingOf(B, C)), 1)).toMatch(MARK);
  });

  it("draws nothing for a quote the paper no longer holds, and the paragraph's text is untouched (rules 1, 2)", () => {
    const reading = readingOf(A, B, "A different sentence stands here instead.");
    const html = render(reading);
    expect(html).not.toContain("<mark");
    expect(html).not.toContain("Open note");
    expect(html).toBe(render(reading, {}));
  });

  it("marks the nearest copy when the words stand twice", () => {
    // copies at 3 and 6; the old place was 2
    const html = render(readingOf(A, B, A, C, A, A, C));
    expect(paragraphHtml(html, 3)).toMatch(MARK);
    expect(paragraphHtml(html, 6)).not.toContain("<mark");
    expect(html.match(/<mark\b/g)).toHaveLength(1);
  });
});
