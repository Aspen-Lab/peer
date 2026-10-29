import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import { isPlaceholderHeading } from "@/lib/papers/reading-roles";
import type { Paper } from "@/types";
import { MAP } from "./copy";
import { PaperBody, paragraphAnchor, sectionAnchor } from "./paper-body";
import { ReadingMapView } from "./reading-map";

// P12-63 (rule 4; ruling §1h.436 (c)): the opening of a paper that prints no heading above its first text is given the extractors' placeholder
// ("Body") for a heading. The paper's body prints none for it; the map's row for it keeps its role label ("Introduction", setup, by A1). Every text
// is invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF.

const paper: Paper = {
  id: "upload:00000000000000dd", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

const OPENING = ["Shore snails feed on algal film.", "Their numbers vary along a single coast.", "Here we show what sets those numbers."];
const SNAILS = "Snail density rises with wave exposure";
const SHELLS = "Shell thickness follows crab predation";

function readingOf(sections: ExtractedDocument["sections"]): PaperReading {
  const doc: ExtractedDocument = { source: "pdf", pageCount: 3, figureCaptions: [], sections };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/shore.pdf", kind: "pdf", label: "doi", rank: 1 } };
  return buildReading(paper, fullText, new Date("2026-10-28T00:00:00.000Z"));
}

/** A Nature-style paper: text above the first heading (the extractors' placeholder "Body"), two descriptive parts, the methods. */
const reading = readingOf([
  { id: "s0", heading: "Body", canonical: "body", text: OPENING.join("\n\n"), page: 1 },
  { id: "s1", heading: SNAILS, canonical: "body", text: "The survey logged 12 counts of limpets.\n\nThe survey logged 13 counts of barnacles.", page: 2 },
  { id: "s2", heading: SHELLS, canonical: "body", text: "The survey logged 14 counts of periwinkles.", page: 2 },
  { id: "s3", heading: "Methods", canonical: "methods", text: "Sites were walked at low tide.", page: 3 },
]);
const html = renderToStaticMarkup(createElement(PaperBody, { reading }));

describe("PaperBody - the unheaded opening prints no placeholder heading (P12-63, rule 4)", () => {
  it("reads the reading as the extractors give it: the opening's heading is the placeholder", () => {
    expect(reading.body[0].heading).toBe("Body");
    expect(reading.body[0].paragraphs).toEqual(OPENING);
    expect(isPlaceholderHeading("Body")).toBe(true);
    expect(isPlaceholderHeading("")).toBe(true);
    expect(isPlaceholderHeading("  ")).toBe(true);
    expect(isPlaceholderHeading("1 Introduction")).toBe(false);
    expect(isPlaceholderHeading("Body language")).toBe(false);
  });

  it("(c) prints no \"Body\" heading in the paper's body", () => {
    expect(html).not.toContain(">Body</h3>");
    expect(html).not.toMatch(/<h3[^>]*>\s*Body\s*</);
  });

  it("keeps the opening's section, its anchor and its paragraphs, in place", () => {
    expect(html).toContain(`<section id="${sectionAnchor(0)}"`);
    OPENING.forEach((text, i) => {
      expect(html).toContain(`id="${paragraphAnchor(0, i)}"`);
      expect(html).toContain(`<p>${text}</p>`);
    });
    // No block is made for a heading that is not printed.
    expect(html).not.toContain(`id="${paragraphAnchor(0, OPENING.length)}"`);
    // The opening comes first, then the paper's own headings in order.
    expect(html.indexOf(`id="${sectionAnchor(0)}"`)).toBeLessThan(html.indexOf(`>${SNAILS}</h3>`));
  });

  it("leaves every heading the paper printed as it was, with its anchor", () => {
    reading.body.slice(1).forEach((section, k) => {
      expect(html).toContain(`<h3 id="${paragraphAnchor(k + 1, section.paragraphs.length)}" data-anchor-block="heading"`);
      expect(html).toContain(`>${section.heading}</h3>`);
    });
    expect((html.match(/<h3\b/g) ?? []).length).toBe(3);
  });

  it("does the same for an empty heading, and for a paper that is one unheaded section", () => {
    const empty = renderToStaticMarkup(createElement(PaperBody, { reading: { ...reading, body: reading.body.map((s, i) => (i === 0 ? { ...s, heading: "" } : s)) } }));
    const whole = renderToStaticMarkup(createElement(PaperBody, { reading: { ...reading, body: reading.body.slice(0, 1) } }));

    expect((empty.match(/<h3\b/g) ?? []).length).toBe(3);
    expect(whole).not.toContain("<h3");
    expect(whole).toContain(`id="${paragraphAnchor(0, 0)}"`);
  });

  it("prints the placeholder nowhere but the opening: a later section keeps the heading it has", () => {
    const later = renderToStaticMarkup(
      createElement(PaperBody, { reading: { ...reading, body: reading.body.map((s, i) => (i === 1 ? { ...s, heading: "Body" } : s)) } }),
    );

    expect(later).toContain(">Body</h3>");
  });

  it("does not take a heading that merely starts with the word", () => {
    const headed = renderToStaticMarkup(
      createElement(PaperBody, { reading: { ...reading, body: reading.body.map((s, i) => (i === 0 ? { ...s, heading: "Body size of the snails" } : s)) } }),
    );

    expect(headed).toContain(">Body size of the snails</h3>");
  });

  it("leaves the map's row for the opening labelled by its role", () => {
    const row = reading.map!.sections[0];
    const map = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map! }));

    expect([row.heading, row.role]).toEqual([MAP.parts.labels.introduction, "setup"]);
    expect(map).toContain(`>${MAP.parts.labels.introduction}</a>`);
    expect(map).toContain(`<span data-meta-part="role" class="whitespace-nowrap">${MAP.roles.setup}</span>`);
    // The map's row and the body's section are the same section, and the map's link lands on it.
    expect(map).toContain(`href="#${sectionAnchor(0)}"`);
    expect(html).toContain(`id="${sectionAnchor(0)}"`);
  });
});
