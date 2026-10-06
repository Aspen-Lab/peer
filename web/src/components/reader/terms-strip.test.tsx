import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { Paper } from "@/types";
import { PEERS_READING, TERMS } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { TermsStrip, termButtonState } from "./terms-strip";

// P3-01 (ruling §1h.1; §3d 13): the strip "Terms to know" under the map — one
// line per term, the paper's own definition as an attributed quote, Peer's
// as labelled prose, and a click that points at the term's first occurrence.
// No DOM in this project's Vitest: rendered with react-dom/server; the click
// is the pure `termButtonState` the button's handler calls.

const paper: Paper = {
  id: "upload:00000000000000aa", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: "Hot parts creep.\n\nQuantum Processing Units (QPU) are the target." },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: "We run the circuits on Quantum Processing Units (QPU) after calibration." },
  ],
};
const reading = buildReading(
  paper,
  { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } } as FullTextResult,
  new Date("2026-10-05T00:00:00.000Z"),
);
/** The label as it reads in rendered HTML (React escapes the apostrophe). */
const PEERS_HTML = PEERS_READING.replace(/'/g, "&#x27;");
const SENTENCE = "We run the circuits on Quantum Processing Units (QPU) after calibration.";

const defined: PaperTerm = { term: "QPU", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const peers: PaperTerm = { term: "creep", definition: "Slow deformation of a solid held under stress.", peer: true };
const unplaced: PaperTerm = { term: "ansatz", definition: "A trial circuit.", peer: true };

type Props = Parameters<typeof TermsStrip>[0];
const render = (props: Partial<Props> & Pick<Props, "terms">) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: reading.body.map((section) => section.heading) },
      createElement(TermsStrip, { reading, marked: null, onMark: () => {}, ...props }),
    ),
  );

describe("TermsStrip — what it shows", () => {
  it("renders nothing without terms", () => {
    expect(render({ terms: [] })).toBe("");
  });

  it("heads the strip with the label-face band 'Terms to know'", () => {
    const html = render({ terms: [defined] });

    expect(TERMS.heading).toBe("Terms to know");
    expect(html).toMatch(/<h2 class="eyebrow[^"]*"[^>]*>(?:<span[^>]*><\/span>)?Terms to know<\/h2>/);
  });

  it("gives each term one line, in the order given", () => {
    const html = render({ terms: [defined, peers] });

    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html.indexOf(">QPU<")).toBeLessThan(html.indexOf(">creep<"));
  });

  it("sets a paper-defined term's definition as an attributed quote, with the section link and the page", () => {
    const html = render({ terms: [defined] });

    expect(html).toContain("font-reading italic");
    expect(html).toContain(SENTENCE);
    expect(html).toContain('<a href="#paper-section-1"');
    expect(html).toContain("§2 Methods</a>");
    expect(html).toContain("p.2");
    expect(html).not.toContain(PEERS_HTML);
  });

  it("sets a Peer term as prose with Peer's label, never quote-styled and with no § attribution", () => {
    const html = render({ terms: [peers] });
    const line = html.slice(html.indexOf("<li"));

    expect(line).toContain(peers.definition);
    expect(line).toContain(PEERS_HTML);
    expect(line).not.toContain("italic");
    expect(line).not.toContain("§");
  });

  it("treats a model term whose evidence the verifier could not place as Peer's words, and one with no heading as attributed to the section it names", () => {
    const noWhere: PaperTerm = { term: "QPU", definition: "d", evidence: SENTENCE, sectionId: "s2" };
    const html = render({ terms: [noWhere] });

    // The heading comes from the map by the term's section id, as the answers do.
    expect(html).toContain("§2 Methods");
    expect(html).toContain("p.2");
    expect(render({ terms: [{ term: "x", definition: "Some words.", evidence: undefined, peer: true }] })).toContain(PEERS_HTML);
  });

  it("has no external link anywhere", () => {
    const html = render({ terms: [defined, peers, unplaced] });

    expect(html).not.toMatch(/href="(?:https?:)?\/\//);
    expect(html).not.toContain("target=");
    expect(html.match(/href="[^"]*"/g)?.every((href) => href.startsWith('href="#'))).toBe(true);
  });

  it("hides and folds nothing: every term is on the page, none behind a toggle", () => {
    const html = render({ terms: [defined, peers] });

    expect(html).not.toMatch(/class="[^"]*(?:^|\s)hidden(?:\s|")/);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("aria-expanded");
  });
});

describe("TermsStrip — the click to highlight", () => {
  it("makes a term the paper uses a button, unpressed until it is marked", () => {
    const html = render({ terms: [defined] });

    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>QPU<\/button>/);
    expect(render({ terms: [defined], marked: "QPU" })).toMatch(/<button[^>]*aria-pressed="true"[^>]*>QPU<\/button>/);
  });

  it("leaves a term the body never uses as plain text, since there is nothing to point at", () => {
    const html = render({ terms: [unplaced] });

    expect(html).toContain("ansatz");
    expect(html).not.toContain("<button");
  });

  it("names the button for the reader who cannot see the highlight", () => {
    expect(render({ terms: [defined] })).toContain(`aria-label="${TERMS.find("QPU")}"`);
  });

  describe("termButtonState — what a click does (cleared by the next click or Escape)", () => {
    it("marks a term that is not marked, and scrolls to it", () => {
      expect(termButtonState(null, "QPU")).toEqual({ next: "QPU", scroll: true });
    });

    it("moves the mark to another term, and scrolls to that one", () => {
      expect(termButtonState("creep", "QPU")).toEqual({ next: "QPU", scroll: true });
    });

    it("clears the mark when the marked term is clicked again, and does not scroll", () => {
      expect(termButtonState("QPU", "QPU")).toEqual({ next: null, scroll: false });
    });
  });
});
