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
import { PHONE_TERMS, TermsStrip, findInBody, hiddenOnPhone, termButtonState } from "./terms-strip";

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

// P7-14 (R10, the owner's review): the strip stands in the panel under both tabs, but the paper's
// text only under "Paper digestion". A click on a term on Summary has to bring the body in before
// it can scroll to the term's first use; with the body on the page it scrolls at once, as before.
describe("finding a term when the body may be on another tab (P7-14, R10)", () => {
  const hit = { sectionId: "s1", sectionIndex: 0, paragraphIndex: 1, offset: 0, length: 3 };

  it("scrolls at once when the page has no way to reveal the body", () => {
    const scrolled: unknown[] = [];

    findInBody(hit, undefined, (at) => scrolled.push(at));

    expect(scrolled).toEqual([hit]);
  });

  it("hands the scroll to the page's reveal, which runs it once the body is mounted — not before", () => {
    const scrolled: unknown[] = [];
    const jobs: Array<() => void> = [];

    findInBody(hit, (run) => jobs.push(run), (at) => scrolled.push(at));

    expect(scrolled).toEqual([]);
    expect(jobs).toHaveLength(1);
    jobs[0]();
    expect(scrolled).toEqual([hit]);
  });

  it("a strip handed a reveal draws the same terms and buttons as one without", () => {
    const terms: PaperTerm[] = [{ term: "QPU", definition: "A quantum processor.", evidence: SENTENCE, evidenceWhere: "2 Methods" }];
    const draw = (extra: object) =>
      renderToStaticMarkup(createElement(SectionLinks, { headings: ["1 Introduction", "2 Methods"] }, createElement(TermsStrip, { terms, reading, marked: null, onMark: () => {}, ...extra })));

    expect(draw({ reveal: (run: () => void) => run() })).toBe(draw({}));
  });
});

// P9-04 (X3, the feature walk's 390 x 844 with eight terms): the strip was 1,409 px of the phone's page. Below
// `sm` (40rem) it shows its first two terms and a toggle in the map's style, "show all N terms" / "fewer
// terms"; from `sm` up nothing changes (all the terms, no toggle). The fold is CSS (`hidden sm:block`,
// `sm:hidden`), as the map's is, so all the terms stay in the DOM and the markup is the same on the server and
// the client. No DOM here: the open state is the `phoneOpen` prop, as the map's tests use it.
describe("TermsStrip — folded to two terms on a phone (P9-04, X3)", () => {
  const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
  const eightDoc: ExtractedDocument = {
    source: "pdf",
    pageCount: 1,
    figureCaptions: [],
    sections: [
      { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: WORDS.map((word) => `The ${word} gauge is read twice a day.`).join("\n\n") },
    ],
  };
  const eightReading = buildReading(
    paper,
    { status: "ok", attempts: [], doc: eightDoc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } } as FullTextResult,
    new Date("2026-10-05T00:00:00.000Z"),
  );
  const many = (n: number): PaperTerm[] =>
    WORDS.slice(0, n).map((word) => ({ term: word, definition: `What ${word} names.`, peer: true }));
  const draw = (n: number, extra: Partial<Props> = {}) =>
    renderToStaticMarkup(
      createElement(
        SectionLinks,
        { headings: eightReading.body.map((section) => section.heading) },
        createElement(TermsStrip, { terms: many(n), reading: eightReading, marked: null, onMark: () => {}, ...extra }),
      ),
    );
  /** The class attribute of each term's <li>, in order. */
  const itemClasses = (html: string): Array<string | null> =>
    [...html.matchAll(/<li\b([^>]*)>/g)].map((match) => /class="([^"]*)"/.exec(match[1])?.[1] ?? null);
  const toggleOf = (html: string) => /<button\b[^>]*aria-expanded="[^"]*"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? null;

  it("holds all eight terms in the DOM, each with its 'Find X in the paper' button as before", () => {
    const html = draw(8);

    expect(itemClasses(html)).toHaveLength(8);
    for (const word of WORDS) expect(html).toContain(`aria-label="${TERMS.find(word)}"`);
    expect(html.match(/<button\b[^>]*aria-pressed=/g)).toHaveLength(8);
  });

  it("folds terms 3 to 8 below sm until the toggle is pressed, and not the first two", () => {
    const classes = itemClasses(draw(8));

    expect(PHONE_TERMS).toBe(2);
    expect(classes.slice(0, 2).every((cls) => !cls || !/\bhidden\b/.test(cls))).toBe(true);
    for (const cls of classes.slice(2)) expect(cls).toBe("hidden sm:block");
  });

  it("says 'show all 8 terms' while folded and 'fewer terms' once open, with aria-expanded to match", () => {
    expect(TERMS.showAll(8)).toBe("show all 8 terms");
    expect(TERMS.fewer).toBe("fewer terms");

    const folded = toggleOf(draw(8)) ?? "";
    expect(folded).toContain(">show all 8 terms<");
    expect(folded).toContain('aria-expanded="false"');
    // The toggle is a phone control: from sm up there is nothing to fold.
    expect(folded).toMatch(/class="[^"]*\bsm:hidden\b/);

    const open = draw(8, { phoneOpen: true });
    const opened = toggleOf(open) ?? "";
    expect(opened).toContain(">fewer terms<");
    expect(opened).toContain('aria-expanded="true"');
    expect(itemClasses(open).every((cls) => !cls || !/\bhidden\b/.test(cls))).toBe(true);
  });

  it("counts the terms it was given: three terms fold one, and the toggle names three", () => {
    const html = draw(3);

    expect(itemClasses(html).map((cls) => cls === "hidden sm:block")).toEqual([false, false, true]);
    expect(toggleOf(html)).toContain(">show all 3 terms<");
  });

  it("has no toggle and folds nothing for two terms or one: there is nothing to show", () => {
    for (const n of [1, 2]) {
      const html = draw(n);

      expect(toggleOf(html)).toBeNull();
      expect(html).not.toContain("aria-expanded");
      expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
    }
  });

  it("hiddenOnPhone: only a term past the second, only while folded, only when there is a toggle to open it", () => {
    expect(hiddenOnPhone(0, 8, false)).toBe(false);
    expect(hiddenOnPhone(1, 8, false)).toBe(false);
    expect(hiddenOnPhone(2, 8, false)).toBe(true);
    expect(hiddenOnPhone(7, 8, false)).toBe(true);
    expect(hiddenOnPhone(7, 8, true)).toBe(false);
    expect(hiddenOnPhone(2, 3, false)).toBe(true);
    // Two terms or fewer: no toggle, so nothing may be hidden.
    expect(hiddenOnPhone(1, 2, false)).toBe(false);
    expect(hiddenOnPhone(0, 1, false)).toBe(false);
  });
});
