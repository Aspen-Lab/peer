import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

// P11-20 follow-up (ruling §1h.119, item 2a; BACKLOG-100): a briefing paper's venue line, byline and affiliation took 117 px of the left pane's fixed
// zone, and clamping them to one line on a window under 700 css px high (the first answer, retired below) recovered 22 to 176 px of a zone that
// overflowed by more. In the three panes the fixed zone now holds only what must stay in view while reading — the title, the commands, the strip, the
// report's progress — and the paper's bibliographic lines (the venue and its age, the byline with its "and N more", the affiliation, and the line
// saying why a briefing paper is here) are the head of the details, in the scroll zone after the map, whole at every height. In one column nothing
// changes, byte for byte. The heights are measured in a browser (the P11-20 checkpoint); this file pins the SHAPE: what stands where, in which
// order, that nothing is clamped or hidden, and that one column is what it was. Every name and affiliation is invented.
//
// Retired with their function (§1c): this file's cases for the one-line clamp — "carries the hooks the short-window rule reads, and the whole of
// each line in its title=", "puts the comma and the control that opens the rest in one element…", "with three names or fewer there is no control, and
// so no element for it…", "make the byline and the affiliation one line each, cut with an ellipsis…", "take the control that opens the rest away
// there…", "show the details' copy of the byline there, and only there", and the three cases of "the details in the pane" for the hidden copy.

let spread = true;
vi.mock("./reader-layout", () => ({ useSpread: () => spread }));

import { DecisionBlock } from "./decision-block";
import { Bibliography, TitleBlock } from "./title-block";

const NOW = Date.UTC(2026, 9, 3);
const AUTHORS = ["A. Writer", "B. Reader", "C. Author", "D. Fourth", "E. Fifth"];
const AFFILIATION = "University of Invented Studies, Department of Made-Up Science";
const paper = (extra: Partial<Paper> = {}): Paper =>
  ({ id: "p1", title: "A Survey of Shore Ecology", authors: AUTHORS, leadAffiliation: AFFILIATION, relevanceReason: "", venue: "Nature Communications", publishedDate: "2026-10-01T00:00:00Z", summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", source: "arxiv", isSaved: false, ...extra }) as unknown as Paper;
const title = (p: Paper, pane?: boolean, recommendation: string | null = null) =>
  renderToStaticMarkup(createElement(TitleBlock, { paper: p, recommendation, now: NOW, ...(pane === undefined ? {} : { pane }) }));
const biblio = (p: Paper, recommendation: string | null = null) => renderToStaticMarkup(createElement(Bibliography, { paper: p, recommendation, now: NOW }));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the title in the pane stands alone (title-block.tsx)", () => {
  it("is the title and nothing else: no venue line, no byline, no affiliation, no recommendation", () => {
    const html = title(paper(), true, "Why it is here.");

    expect(html).toMatch(/^<header><h1\b[^>]*>A Survey of Shore Ecology<\/h1><\/header>$/);
    for (const gone of ["Nature Communications", "A. Writer", AFFILIATION, "Why it is here.", "<button", "annotation"]) expect(html, gone).not.toContain(gone);
  });

  it("keeps what the pane's title had: four lines, the whole of it in title=, the hook the short-window rule reads, the pane's size", () => {
    const html = title(paper(), true);
    const h1 = /<h1\b[^>]*>/.exec(html)?.[0] ?? "";

    expect(h1).toMatch(/class="[^"]*\bline-clamp-4\b/);
    expect(h1).toContain('title="A Survey of Shore Ecology"');
    expect(h1).toContain("data-pane-title");
    expect(h1).toMatch(/class="[^"]*\btext-display-sm\b/);
    expect(h1).not.toMatch(/\bsm:text-display\b/);
  });

  it("one column keeps the venue, title, byline, affiliation pill and recommendation", () => {
    const html = title(paper(), undefined, "Why it is here.");

    for (const text of ["Nature Communications", "A Survey of Shore Ecology", "A. Writer", AFFILIATION, "Why it is here."]) expect(html).toContain(text);
    expect(html).toContain('class="institution-pill"');
    expect(title(paper(), false, "Why it is here.")).toBe(html);
  });
});

describe("the bibliography heads the pane's details (title-block.tsx, decision-block.tsx)", () => {
  it("is the venue and its age, the byline with its control for the rest, the affiliation and the recommendation, in the order the title block had them", () => {
    const html = biblio(paper(), "Why it is here.");
    const at = (needle: string) => html.indexOf(needle);

    expect(html).toContain("Nature Communications · 2d ago");
    expect(html).toContain("A. Writer, B. Reader, C. Author, ");
    expect(html).toMatch(/<button\b[^>]*aria-expanded="false"[^>]*>and 2 more<\/button>/);
    expect(html).toContain(AFFILIATION);
    expect(html).toContain("Why it is here.");
    expect(at("Nature Communications")).toBeLessThan(at("A. Writer"));
    expect(at("A. Writer")).toBeLessThan(at(AFFILIATION));
    expect(at(AFFILIATION)).toBeLessThan(at("Why it is here."));
  });

  it("is whole at every height: nothing clamped, hidden, cut with an ellipsis or taken away on a short window, and no title= repeating a line", () => {
    const html = biblio(paper());

    expect(html).not.toMatch(/title=|\bhidden\b|truncate|line-clamp|nowrap|data-pane-(byline|affiliation|more)/);
    expect(html).toContain('data-pane-bibliography=""');
  });

  it("aligns the metadata in labelled table rows", () => {
    const html = biblio(paper(), "Why it is here.");
    expect(html).toContain('<table aria-label="Paper details"');
    expect(html).toContain('<th scope="row">Published</th>');
    expect(html).toContain('<th scope="row">Authors</th>');
    expect(html).toContain('<th scope="row">Affiliation</th>');
    expect(html).toMatch(/<th scope="row">Relevance<\/th><td>Why it is here\.<\/td>/);
  });

  it("includes source access in the same table when available", () => {
    const html = renderToStaticMarkup(createElement(Bibliography, { paper: paper(), now: NOW, access: createElement("button", null, "Source") }));
    expect(html).toMatch(/<th scope="row">Access<\/th><td><button>Source<\/button><\/td>/);
  });

  it("says only what the record knows: no venue, no date, no authors, no recommendation — an upload — draws nothing at all", () => {
    expect(biblio(paper({ authors: [], leadAffiliation: undefined, venue: "", publishedDate: undefined }))).toBe("");
    expect(biblio(paper({ authors: [], leadAffiliation: undefined }))).toContain("Nature Communications");
    expect(biblio(paper({ authors: [], leadAffiliation: undefined }))).not.toContain("<button");
    expect(biblio(paper({ venue: "", publishedDate: undefined }))).not.toContain("annotation text-meta");
  });

  const base = { sentences: ["SENTENCE-MARK."], stage: null, source: null, doi: undefined, isSaved: false, showAddKey: false, onSave: () => {}, onCopy: () => {}, onOpen: () => {} };
  const details = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(DecisionBlock, { ...base, part: "details", ...props } as never));

  it("in the panes the details open with it, before the sentence", () => {
    spread = true;
    const html = details({ paper: paper(), now: NOW, recommendation: "Why it is here." });

    expect(html.indexOf("data-pane-bibliography")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("data-pane-bibliography")).toBeLessThan(html.indexOf("SENTENCE-MARK."));
    expect(html).toContain("A. Writer, B. Reader, C. Author, ");
    expect(html).toContain("Why it is here.");
  });

  it("in one column the title block has the lines: the details do not say them twice", () => {
    spread = false;
    const html = details({ paper: paper(), now: NOW, recommendation: "Why it is here." });

    expect(html).not.toContain("data-pane-bibliography");
    expect(html).not.toContain("A. Writer");
    expect(html).toContain("SENTENCE-MARK.");
    spread = true;
  });

  it("without a paper (the other callers of the details) there is nothing to draw", () => {
    spread = true;

    expect(details({})).not.toContain("data-pane-bibliography");
  });

  it("the page hands the details the paper, the clock and the recommendation — the title block's own", () => {
    const page = read("src/app/papers/[id]/page.tsx");
    const block = /<DecisionBlock\s+part="details"[\s\S]*?\/>/.exec(page)?.[0] ?? "";

    expect(block).toMatch(/\bpaper=\{paper\}/);
    expect(block).toMatch(/\brecommendation=\{recommendation\}/);
    expect(block).toMatch(/\bnow=\{now\}/);
    expect(page).toMatch(/<TitleBlock paper=\{paper\} recommendation=\{recommendation\} now=\{now\} pane=\{spread\} \/>/);
  });
});

describe("the stylesheet no longer clamps the byline (globals.css)", () => {
  it("has no rule for the byline, the affiliation, the control that opens the rest or a hidden copy: the first answer is retired", () => {
    expect(noComments(CSS)).not.toMatch(/data-pane-(byline|affiliation|more)/);
  });

  it("keeps the title's short-window rule and the gaps (C P11-17c)", () => {
    expect(noComments(CSS)).toMatch(/\[data-pane-title\]\s*\{\s*-webkit-line-clamp:\s*3;/);
    expect(noComments(CSS)).toMatch(/--pane-gap:\s*0\.5rem;/);
  });
});
