import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

// P11-20 rule 2 (BACKLOG-100; C P11-17c "For the manager" 2; ruling §1h.118): C P11-17c's rule 2 holds on an uploaded paper, but a paper from the
// briefing has a venue line, a byline (three names and "and N more") and the first author's affiliation in the title block, about 117 px more in
// the left pane's fixed zone, which then scrolled inside itself again. On a window under 700 css px high — the one the zone's other short-window rules
// are for — the byline and the affiliation are each one line with an ellipsis; the whole of each stays in its `title=` and in the pane's details (the
// scroll zone: the full author list and the affiliation, shown on those windows only). The venue line stays whole; the title, the commands and the
// progress are never hidden; the cap is not raised. The heights themselves are measured in a browser (the P11-20 checkpoint); a unit test cannot lay
// a line out, so this file pins the SHAPE: the hooks, the titles, where the rules are, what they touch, and that one column is what it was.
// Every name and affiliation is invented.

let spread = true;
vi.mock("./reader-layout", () => ({ useSpread: () => spread }));

import { DecisionBlock } from "./decision-block";
import { TitleBlock } from "./title-block";

const NOW = Date.UTC(2026, 9, 3);
const AUTHORS = ["A. Writer", "B. Reader", "C. Author", "D. Fourth", "E. Fifth"];
const AFFILIATION = "University of Invented Studies, Department of Made-Up Science";
const paper = (extra: Partial<Paper> = {}): Paper =>
  ({ id: "p1", title: "A Survey of Shore Ecology", authors: AUTHORS, leadAffiliation: AFFILIATION, relevanceReason: "", venue: "Nature Communications", publishedDate: "2026-10-01T00:00:00Z", summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", source: "arxiv", isSaved: false, ...extra }) as unknown as Paper;
const title = (p: Paper, pane?: boolean, recommendation: string | null = null) =>
  renderToStaticMarkup(createElement(TitleBlock, { paper: p, recommendation, now: NOW, ...(pane === undefined ? {} : { pane }) }));
const tagOf = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? "";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const SHORT = "@media (max-height: 699px)";
const shortBlock = () => {
  const start = CSS.indexOf(SHORT);
  expect(start, `${SHORT} is in globals.css`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start) + 2);
};
/** The declarations of the rule in `block` whose selector list names `hook`. */
const declarationsFor = (block: string, hook: string): string => {
  for (const chunk of block.split("}")) {
    const open = chunk.indexOf("{");
    if (open >= 0 && chunk.slice(0, open).includes(hook)) return chunk.slice(open + 1);
  }
  return "";
};

describe("the byline in the pane (title-block.tsx)", () => {
  it("carries the hooks the short-window rule reads, and the whole of each line in its title=: every author, not the first three", () => {
    const html = title(paper(), true);
    const byline = tagOf(html, /<p\b[^>]*data-pane-byline[^>]*>/);
    const affiliation = tagOf(html, /<p\b[^>]*data-pane-affiliation[^>]*>/);

    expect(byline).toContain(`title="${AUTHORS.join(", ")}"`);
    expect(affiliation).toContain(`title="${AFFILIATION}"`);
    // The three names stay the words of the line; the others are named by the control.
    expect(html).toContain("A. Writer, B. Reader, C. Author, ");
    expect(html).toContain(AFFILIATION);
  });

  it("puts the comma and the control that opens the rest in one element the short-window rule can take away", () => {
    const html = title(paper(), true);
    const more = /<span\b[^>]*data-pane-more[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? "";

    expect(more).toMatch(/^, <button\b[^>]*>and 2 more<\/button>$/);
    // The three names are outside it: they are what the line is.
    expect(html.indexOf("C. Author")).toBeLessThan(html.indexOf("data-pane-more"));
  });

  it("with three names or fewer there is no control, and so no element for it; the title is still the whole line", () => {
    const html = title(paper({ authors: ["A. Writer", "B. Reader"] }), true);

    expect(html).not.toContain("data-pane-more");
    expect(tagOf(html, /<p\b[^>]*data-pane-byline[^>]*>/)).toContain('title="A. Writer, B. Reader"');
  });

  it("leaves the venue line whole: no hook, no title, the markup it had", () => {
    const html = title(paper(), true);

    expect(html).toContain('<p class="annotation text-meta text-text-muted mt-1">Nature Communications · 2d ago</p>');
    expect(tagOf(html, /<p\b[^>]*>Nature Communications/)).not.toMatch(/data-|title=/);
  });

  it("an upload has no byline, no affiliation and no venue: the block is the title alone, hooks or no hooks", () => {
    const upload = paper({ authors: [], leadAffiliation: undefined, venue: "", publishedDate: undefined });
    const html = title(upload, true);

    expect(html).toMatch(/^<header><h1\b[^>]*>A Survey of Shore Ecology<\/h1><\/header>$/);
    expect(html).not.toMatch(/data-pane-(byline|affiliation|more)/);
  });

  it("one column is what it was, byte for byte: no hook, no title=, no wrapper around the control", () => {
    const html = title(paper(), undefined, "Why it is here.");

    expect(html).toBe(
      '<header><p class="annotation text-meta text-text-muted mt-6">Nature Communications · 2d ago</p><h1 class="paper-line text-heading text-display-sm measure-title mt-2 sm:text-display xl:text-display-sm">A Survey of Shore Ecology</h1><div class="mt-3"><p class="font-reading text-body-lg leading-[1.45] text-text mt-3 mt-0 measure-lede">A. Writer, B. Reader, C. Author, <button type="button" aria-expanded="false" class="annotation text-text-faint hover:text-heading underline decoration-border-strong underline-offset-4 transition-colors [@media(hover:none)]:py-3">and 2 more</button></p><p class="annotation text-text-faint mt-1.5">University of Invented Studies, Department of Made-Up Science</p></div><p class="font-sans text-body-sm text-text-muted mt-1">Why it is here.</p></header>',
    );
    expect(title(paper(), false, "Why it is here.")).toBe(html);
  });
});

describe("the short-window rules for the byline (globals.css)", () => {
  it("make the byline and the affiliation one line each, cut with an ellipsis, on a window under 700 css px high", () => {
    for (const hook of ["[data-pane-byline]", "[data-pane-affiliation]"]) {
      const declarations = declarationsFor(shortBlock(), `.reader-left ${hook}`);

      expect(declarations, hook).toMatch(/white-space:\s*nowrap;/);
      expect(declarations, hook).toMatch(/overflow:\s*hidden;/);
      expect(declarations, hook).toMatch(/text-overflow:\s*ellipsis;/);
    }
  });

  it("take the control that opens the rest away there (it would sit past the ellipsis, out of reach): the details hold the list", () => {
    expect(declarationsFor(shortBlock(), ".reader-left [data-pane-more]")).toMatch(/display:\s*none;/);
  });

  it("show the details' copy of the byline there, and only there", () => {
    expect(declarationsFor(shortBlock(), ".reader-left [data-pane-byline-full]")).toMatch(/display:\s*block;/);
    expect(CSS.replace(shortBlock(), "")).not.toMatch(/data-pane-(byline|affiliation|more)/);
  });

  it("leave the venue line, the title's other rule, the commands, the progress and the map alone: no rule of the block names them", () => {
    const block = shortBlock();

    expect(block).not.toMatch(/data-pane-meta|\.annotation|progress|reader-left-scroll|reader-left-fixed|<h1|\bh1\b/);
  });
});

describe("the details in the pane (decision-block.tsx)", () => {
  const base = { sentences: ["SENTENCE-MARK."], stage: null, source: null, doi: undefined, isSaved: false, showAddKey: false, onSave: () => {}, onCopy: () => {}, onOpen: () => {} };
  const many = Array.from({ length: 63 }, (_, i) => `Coauthor Number${i + 1}`);
  const details = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(DecisionBlock, { ...base, part: "details", ...props } as never));

  it("holds the whole list of authors and the affiliation, in a block the short-window rule shows and a taller window leaves hidden", () => {
    spread = true;
    const html = details({ authors: many, affiliation: AFFILIATION });
    const block = tagOf(html, /<div\b[^>]*data-pane-byline-full[^>]*>/);

    expect(block).toMatch(/class="[^"]*\bhidden\b/);
    expect(html).toContain(many.join(", "));
    expect(html).toContain(AFFILIATION);
  });

  it("puts it before the sentence: it is the first thing the scroll zone says about the paper", () => {
    spread = true;
    const html = details({ authors: AUTHORS, affiliation: AFFILIATION });

    expect(html.indexOf("data-pane-byline-full")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("data-pane-byline-full")).toBeLessThan(html.indexOf("SENTENCE-MARK."));
  });

  it("says only what the record knows: authors without an affiliation, an affiliation without authors, neither (an upload) — nothing drawn", () => {
    spread = true;

    expect(details({ authors: AUTHORS })).not.toContain(AFFILIATION);
    expect(details({ authors: AUTHORS })).toContain(AUTHORS.join(", "));
    expect(details({ authors: [], affiliation: AFFILIATION })).toContain(AFFILIATION);
    expect(details({ authors: [], affiliation: AFFILIATION })).not.toMatch(/<p\b[^>]*>\s*<\/p>/);
    expect(details({})).not.toContain("data-pane-byline-full");
    expect(details({ authors: [] })).not.toContain("data-pane-byline-full");
  });

  it("in one column the title block shows the byline whole: the details do not say it twice", () => {
    spread = false;
    const html = details({ authors: AUTHORS, affiliation: AFFILIATION });

    expect(html).not.toContain("data-pane-byline-full");
    expect(html).not.toContain(AFFILIATION);
    spread = true;
  });
});
