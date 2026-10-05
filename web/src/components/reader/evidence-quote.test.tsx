import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceQuote, SectionLinks, sectionHref } from "./evidence-quote";

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
