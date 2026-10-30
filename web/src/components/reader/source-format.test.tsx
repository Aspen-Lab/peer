import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chooseHtmlExtractor } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { PaperBody } from "./paper-body";

const paper: Paper = {
  id: "arxiv:test", title: "Genetics", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

const listing = "inductive NucBase\n  | U | A | G | C | T\n  deriving DecidableEq, Repr\n\ndef isRNA := U";
const encoded = Buffer.from(listing).toString("base64");
const source = `<article class="ltx_document">
<h2 class="ltx_title ltx_title_section">1 Definitions</h2>
<p>Before the listing.</p>
<div class="ltx_listing ltx_lst_language_lean ltx_lstlisting">
  <div class="ltx_listing_data"><a href="data:text/plain;base64,${encoded}">download</a></div>
  <div class="ltx_listingline"><span>inductive</span> NucBase</div>
  <div class="ltx_listingline"> | U | A | G | C | T</div>
</div>
<p>After the listing. See Table 1.</p>
<figure class="ltx_table"><table><tr><th>Base</th><th>Value</th></tr><tr><td>U</td><td>Uracil</td></tr></table><figcaption class="ltx_caption">Table 1: Bases.</figcaption></figure>
</article>`;

describe("source format conversion", () => {
  it("keeps a LaTeXML code listing in order and a real table as cells", () => {
    const doc = chooseHtmlExtractor("https://arxiv.org/html/1234.5678")(source);
    expect(doc.codeBlocks).toEqual([{ text: listing, language: "lean" }]);
    const reading = buildReading(paper, { status: "ok", attempts: [], doc });
    const section = reading.body[0];
    expect(section.paragraphs).toEqual(["Before the listing.", "After the listing. See Table 1."]);
    expect(section.codeBlocks).toEqual([{ text: listing, language: "lean", after: 0 }]);
    expect(section.figures?.[0].table?.rows[1].cells.map((cell) => cell.text)).toEqual(["U", "Uracil"]);
    const html = renderToStaticMarkup(<PaperBody reading={reading} />);
    expect(html).toContain(`<pre><code>${listing}</code></pre>`);
    expect(html.indexOf("Before the listing.")).toBeLessThan(html.indexOf("<pre><code>"));
    expect(html.indexOf("<pre><code>")).toBeLessThan(html.indexOf("After the listing."));
    expect(html).toContain('<table class="reader-data-table"');
    expect(html).not.toContain("⟦@0⟧");
  });

  it("does not discard a listing when the original code data is invalid", () => {
    const broken = source.replace(encoded, "bad===");
    const doc = chooseHtmlExtractor("https://arxiv.org/html/1234.5678")(broken);
    expect(doc.codeBlocks).toBeUndefined();
    expect(doc.sections[0].text).toContain("inductive NucBase");
  });
});
