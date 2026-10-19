import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { TitleBlock } from "./title-block";

// P11-16 (B P11-01 §2.3; ruling §1h.113 (a)): in the three-pane page the title stands in the left pane's fixed zone, which never scrolls, so a
// six-line title (the owner's paper: 187 px at the pane's width) would take the room the map needs. The page tells the block it is in the
// pane (`pane`), and the title is clamped to four lines with the whole of it in `title=`; the words are still all in the page. In one column
// nothing changes: no clamp, no `title=`.

const WORDS = "A study of how very long titles wrap in a narrow pane of a reader, and whether four lines are enough for all of them to be recognised";
const paper = (title: string): Paper => ({ id: "p1", title, authors: ["A. Writer", "B. Reader"], relevanceReason: "", venue: "", summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", source: "arxiv", isSaved: false }) as unknown as Paper;
const render = (title: string, pane?: boolean) =>
  renderToStaticMarkup(createElement(TitleBlock, { paper: paper(title), recommendation: null, now: 0, ...(pane === undefined ? {} : { pane }) }));
const h1 = (html: string) => /<h1\b[^>]*>/.exec(html)?.[0] ?? "";
const classes = (tag: string) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

describe("TitleBlock in the left pane (P11-16)", () => {
  it("clamps the title to four lines and keeps the whole of it in title=", () => {
    const tag = h1(render(WORDS, true));

    expect(classes(tag)).toContain("line-clamp-4");
    expect(tag).toContain(`title="${WORDS}"`);
  });

  it("keeps every word of the title in the page: the clamp is the style's, not the markup's", () => {
    expect(render(WORDS, true).replace(/<[^>]*>/g, "")).toContain(WORDS);
  });

  it("sets the title at the pane's size at every window width: a short one does not grow at sm", () => {
    const short = classes(h1(render("A short title", true)));

    expect(short).toContain("text-display-sm");
    expect(short.filter((c) => /display/.test(c) && c !== "text-display-sm")).toEqual([]);
  });

  it("does the same for a long title", () => {
    const long = classes(h1(render(WORDS.repeat(2), true)));

    expect(long).toContain("line-clamp-4");
    expect(long.filter((c) => /display/.test(c) && c !== "text-display-sm")).toEqual([]);
  });

  it("takes the pane's tighter top: the meta line does not carry the one column's 24px gap", () => {
    const meta = /<p class="([^"]*)">[^<]*·/.exec(renderToStaticMarkup(createElement(TitleBlock, { paper: { ...paper("T"), venue: "arXiv", publishedDate: "2026-10-01T00:00:00Z" }, recommendation: null, now: Date.UTC(2026, 9, 3), pane: true })))?.[1] ?? "";

    expect(meta).toContain("annotation");
    expect(meta.split(/\s+/)).not.toContain("mt-6");
  });
});

describe("TitleBlock in one column and on the pages that are not the reader's panes (P11-16)", () => {
  it("is what it was: no clamp and no title=, whatever the title", () => {
    for (const title of [WORDS, "A short title"]) {
      const tag = h1(render(title));

      expect(classes(tag)).not.toContain("line-clamp-4");
      expect(tag).not.toContain("title=");
    }
  });

  it("keeps its sizes: a short title grows at sm and returns to the panel's size at xl; a long one stays at 26px", () => {
    expect(classes(h1(render("A short title")))).toEqual(expect.arrayContaining(["text-display-sm", "sm:text-display", "xl:text-display-sm"]));
    expect(classes(h1(render(WORDS.repeat(2))))).toEqual(expect.arrayContaining(["text-display-sm"]));
    expect(classes(h1(render(WORDS.repeat(2)))).filter((c) => /display/.test(c) && c !== "text-display-sm")).toEqual([]);
  });

  it("keeps the one column's 24px gap above the meta line", () => {
    const html = renderToStaticMarkup(createElement(TitleBlock, { paper: { ...paper("T"), venue: "arXiv", publishedDate: "2026-10-01T00:00:00Z" }, recommendation: null, now: Date.UTC(2026, 9, 3) }));
    const meta = /<p class="([^"]*)">[^<]*·/.exec(html)?.[1] ?? "";

    expect(meta.split(/\s+/)).toContain("mt-6");
  });
});
