import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { DecisionBlock } from "./decision-block";
import { ReaderLayout } from "./reader-layout";
import { TitleBlock } from "./title-block";

// P11-17c rule 2 (BACKLOG-99; ruling §1h.115, the owner's laptop at 125 %): at 1093 x 614 with the pane pinned on arrival and a report running,
// the left pane's fixed zone (the title, the commands, the progress, the strip) was 337 px in a zone capped at 314: it scrolled inside itself
// by 11-23 px and its foot was cut off until the report arrived. At every window from 1024 x 600 up its scrollHeight must equal its
// clientHeight, with or without a report, with the longest title, and the map's first row must stay on screen.
//
// The means, in the order the brief gives them: on a window shorter than 700 css px the title's clamp is three lines, not four, and the gaps
// between the zone's blocks are tighter (`--pane-gap`, 8 px for 12). A window of 700 or more keeps four lines and the 12 px gaps. The
// progress part is never hidden and the map is never pushed off: the zone gets smaller, the cap (62 % of the pane) stays. The numbers
// themselves are measured in a browser (P11-17c checkpoint); a unit test cannot resolve a `calc()` against the window, so this file pins the
// SHAPE: where the short-window rule is, what it changes, and that one column and a tall window are untouched. Invented text.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CSS = read("src/app/globals.css");
const ruleIn = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} is in the stylesheet`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("\n  }", start) + 4);
};
const SHORT = "@media (max-height: 699px)";

/** The text of the short-window block: from its at-rule to the closing brace at the left margin. */
const shortBlock = () => {
  const start = CSS.indexOf(SHORT);
  expect(start, `${SHORT} is in globals.css`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf("\n}", start) + 2);
};

describe("the fixed zone on a short window (globals.css)", () => {
  it("has a short-window block: a window under 700 css px high, and nothing about its width (the pane exists only from 1024)", () => {
    expect(CSS).toContain(SHORT);
    expect(shortBlock()).not.toMatch(/min-width|max-width|width\s*[<>]/);
  });

  it("clamps the pane's title to three lines there, overriding the utility's four", () => {
    const rule = ruleIn(shortBlock(), ".reader-left [data-pane-title]");
    expect(rule).toMatch(/-webkit-line-clamp:\s*3;/);
  });

  it("tightens the gaps between the zone's blocks there: 8 px for the 12 px the blocks carry", () => {
    expect(ruleIn(shortBlock(), ".reader-left")).toMatch(/--pane-gap:\s*0\.5rem;/);
    // The default is the fallback of each use, not a rule of the pane: the one column has no pane to set it.
    expect(CSS).not.toMatch(/--pane-gap:\s*0\.75rem/);
  });

  it("keeps the cap, a safety valve at 62 % of the pane's body: the zone is made smaller, the cap is not raised", () => {
    expect(ruleIn(CSS, ".reader-left-fixed")).toMatch(/max-height:\s*calc\(0\.62\s*\*\s*\(100vh\s*-\s*4rem\s*-\s*var\(--legend-h\)\s*-\s*1rem\)\s*\/\s*var\(--page-zoom,\s*1\)\);/);
  });

  it("changes nothing else on a short window: no display, no visibility, no overflow rule for the progress or the map", () => {
    const block = shortBlock();
    expect(block).not.toMatch(/display:\s*none|visibility:\s*hidden|overflow/);
    expect(block).not.toMatch(/progress|reader-left-scroll|reader-left-fixed/);
  });
});

describe("the title in the pane (title-block.tsx)", () => {
  const paper = (title: string): Paper => ({ id: "p1", title, authors: [], relevanceReason: "", venue: "", summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", source: "arxiv", isSaved: false }) as unknown as Paper;
  const h1 = (pane?: boolean) =>
    /<h1\b[^>]*>/.exec(renderToStaticMarkup(createElement(TitleBlock, { paper: paper("A long title for a narrow pane"), recommendation: null, now: 0, ...(pane === undefined ? {} : { pane }) })))?.[0] ?? "";

  it("carries the hook the short-window rule reads, and still the four-line clamp the window of 700 and over keeps", () => {
    expect(h1(true)).toContain("data-pane-title");
    expect(h1(true)).toMatch(/class="[^"]*\bline-clamp-4\b/);
  });

  it("is untouched in one column: no hook, no clamp", () => {
    expect(h1()).not.toContain("data-pane-title");
    expect(h1(false)).not.toContain("data-pane-title");
  });
});

describe("the gaps in the zone (reader-layout.tsx, decision-block.tsx)", () => {
  const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
  const page = (spread: boolean) =>
    renderToStaticMarkup(
      createElement(ReaderLayout, {
        spread, plate: mark("PLATE"), title: mark("TITLE"), decision: mark("DECISION"), details: mark("DETAILS"), progress: mark("PROGRESS"),
        tabs: mark("TABS"), tab: "digestion", map: mark("MAP"), common: mark("COMMON"), words: mark("WORDS"), additions: mark("ADDITIONS"), next: mark("NEXT"),
      }),
    );

  it("the commands' and the strip's top gaps read --pane-gap, 12 px and 16 px when the pane sets nothing", () => {
    const fixed = page(true);
    const zone = fixed.slice(fixed.indexOf("data-reader-left-fixed"), fixed.indexOf("data-reader-left-scroll"));
    expect(zone).toContain("[&amp;&gt;*&gt;:first-child]:mt-[var(--pane-gap,0.75rem)]");
    expect(zone).toContain("[&amp;&gt;:first-child]:mt-[calc(var(--pane-gap,0.75rem)_+_0.25rem)]");
    expect(zone).not.toMatch(/\bmt-3\b|\[&amp;&gt;:first-child\]:mt-4/);
  });

  it("one column has no pane, so it names no --pane-gap at all", () => {
    expect(page(false)).not.toContain("--pane-gap");
  });

  it("the progress part's gaps read it too: the bar 12 px, the status line 6 px under a bar and 12 px alone", () => {
    const bar = renderToStaticMarkup(createElement(DecisionBlock, { part: "progress", stage: { label: "Reading", pct: 40 } } as never));
    const alone = renderToStaticMarkup(createElement(DecisionBlock, { part: "progress", stage: { label: "Starting the report", pct: null } } as never));
    const classOf = (html: string, tag: string) => new RegExp(`<${tag}\\b[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "";
    expect(classOf(bar, "div")).toContain("mt-[var(--pane-gap,0.75rem)]");
    expect(classOf(bar, "p")).toContain("mt-[calc(var(--pane-gap,0.75rem)_/_2)]");
    expect(classOf(alone, "p")).toContain("mt-[var(--pane-gap,0.75rem)]");
    expect(bar).toContain("role=\"progressbar\"");
    expect(bar).toContain("Reading…");
  });
});
