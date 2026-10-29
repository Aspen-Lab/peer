import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { RecordBlock } from "./record-block";
import { GlanceBlock } from "./report-sections";

const paper = {
  id: "example", title: "Example paper", authors: ["Author One", "Author Two"],
  venue: "Example Journal", publishedDate: "2026-10-20", relevanceScore: 0.78,
  linkPaper: "https://example.org/article", linkCode: "https://example.org/code",
} as Paper;

describe("paper facts", () => {
  it("presents glance facts as labelled table rows", () => {
    const html = renderToStaticMarkup(createElement(GlanceBlock, { paper, now: Date.parse("2026-10-27"), stagger: 0 }));
    expect(html).toContain("<table");
    for (const label of ["Source", "Code", "Age", "Authors", "Relevance"]) expect(html).toContain(`<th scope="row">${label}</th>`);
    expect(html).toContain("78% match to your topics");
  });

  it("keeps record links in a labelled table without repeating the primary source", () => {
    const html = renderToStaticMarkup(createElement(RecordBlock, { paper, primaryUrl: paper.linkPaper! }));
    expect(html).toContain("<table");
    expect(html).toContain('<th scope="row">Published</th>');
    expect(html).toContain('<th scope="row">Venue</th>');
    expect(html).toContain("https://example.org/code");
    expect(html).not.toContain("https://example.org/article");
  });
});
