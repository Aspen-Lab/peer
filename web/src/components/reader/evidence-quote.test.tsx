import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading, type ReadingQuote } from "@/lib/papers/reading";
import type { Claim } from "@/lib/papers/report";
import { EvidenceQuote, SectionLinks, sectionHref } from "./evidence-quote";
import { PaperWords } from "./paper-words";
import { QuoteList } from "./quote-list";

// P1-04 (§1f.12): a claim's "§Heading" goes to the section it was quoted
// from — the first body section with that heading — and is plain text when
// no section has it (the abstract, or a heading the body does not carry).

const HEADINGS = ["1 Introduction", "2 Methods", "3 Results", "2 Methods"];

function render(where: string, headings: readonly string[] | null = HEADINGS): string {
  const quote = createElement(EvidenceQuote, { text: "Samples were held at fixed stress.", where });
  return renderToStaticMarkup(headings ? createElement(SectionLinks, { headings }, quote) : quote);
}

describe("EvidenceQuote — the section link (P1-04)", () => {
  it("finds the first body section with the quote's heading", () => {
    expect(sectionHref("2 Methods", HEADINGS)).toBe("#paper-section-1");
    expect(sectionHref("  3 Results ", HEADINGS)).toBe("#paper-section-2");
    expect(sectionHref("Methods", HEADINGS)).toBeNull();
    expect(sectionHref("abstract", HEADINGS)).toBeNull();
  });

  it("links the attribution to that section", () => {
    const html = render("2 Methods");

    expect(html).toContain('<a href="#paper-section-1"');
    expect(html).toContain("§2 Methods</a>");
    expect(html).toContain("Samples were held at fixed stress.");
  });

  it("leaves the attribution as text when no section matches, for the abstract, and outside the reading page", () => {
    for (const html of [render("4 Discussion"), render("abstract"), render("2 Methods", null)]) {
      expect(html).not.toContain("<a");
    }
    expect(render("abstract")).toContain("— abstract");
  });
});

// P1-05 (the §1f.13 amendment): the two other "§Heading" attributions on
// the page — the Tier 0 quotes and the model skim's quoted evidence — link
// the same way, through the same headings.
describe("the other attributions link to their section (P1-05)", () => {
  const within = (node: ReturnType<typeof createElement>, headings: readonly string[] | null = HEADINGS) =>
    renderToStaticMarkup(headings ? createElement(SectionLinks, { headings }, node) : node);

  it("a Tier 0 quote's '§Heading' is a link; a figure's label and an unknown heading stay text", () => {
    const quotes: ReadingQuote[] = [
      { text: "Samples were held at fixed stress.", from: { kind: "section", heading: "2 Methods", canonical: "methods" } },
      { text: "Creep against density.", from: { kind: "figure", heading: "Figure 1", canonical: "figure" } },
      { text: "The rate rose with stress.", from: { kind: "section", heading: "4 Discussion", canonical: "discussion" } },
    ];
    const html = within(createElement(QuoteList, { block: "method", quotes }));

    expect(html).toMatch(/<a href="#paper-section-1" class="[^"]*">§2 Methods<\/a>/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(">Figure 1<");
    expect(html).toContain(">§4 Discussion<");
    expect(within(createElement(QuoteList, { block: "method", quotes }), null)).not.toContain("<a ");
  });

  it("the skim's quoted evidence links its '§Heading'; the abstract stays text", () => {
    const reading = buildReading(
      { id: "openalex:W1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other", summaryIntro: "Creep limits the life of hot parts. We measured it.", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false },
      null,
      new Date("2026-10-05T00:00:00.000Z"),
    );
    const skim: Claim[] = [{ text: "Creep was measured.", evidence: "Samples were held at fixed stress.", evidenceWhere: "2 Methods" }];
    const quotedSkim: Claim[] = [...skim, { text: "Hot parts.", evidence: "Creep limits the life of hot parts.", evidenceWhere: "abstract" }];
    const words = (headings: readonly string[] | null) =>
      within(createElement(PaperWords, { reading, marks: [], skim, basis: "model-fulltext", quotedSkim }), headings);

    expect(words(HEADINGS)).toMatch(/— <a href="#paper-section-1" class="[^"]*">§2 Methods<\/a>/);
    expect(words(HEADINGS)).toContain("— abstract");
    expect(words(HEADINGS).match(/<a /g)).toHaveLength(1);
    expect(words(null)).not.toContain("<a ");
  });
});
