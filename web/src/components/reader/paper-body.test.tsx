import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { blockMarker } from "@/lib/text/math";
import { PaperBody, paragraphAnchor, sectionAnchor } from "./paper-body";

// P1-04 (§1f.12): every paragraph of the body is a destination — the map's
// paragraph lines scroll to it — and nothing else in the body changes.

const paper: Paper = {
  id: "openalex:W1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [{ ordinal: 1, label: "Figure 1", caption: "Creep against density.", page: 2, at: 0.5 }],
  equations: [{ text: "r = k d" }],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life of hot parts.\n\nGrain boundaries carry the strain.", page: 1 },
    { id: "s2", heading: "2 Results", canonical: "results", text: `Figure 1 shows the rate.\n\n${blockMarker(0)}\n\nThe finest grains crept fastest.`, page: 2 },
  ],
};
const fullText: FullTextResult = {
  status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 },
};
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));

/** The body as it rendered before P1-04 (captured from the code at 44140fe
 *  for exactly this reading). */
const BEFORE =
  '<div id="paper-body" class="scroll-mt-20"><section class="mt-12 sm:mt-16"><div class="flex items-center gap-3"><h2 class="eyebrow inline-flex items-center gap-2 whitespace-nowrap text-text-faint"><span aria-hidden="true" class="block h-[6px] w-[6px] shrink-0 bg-current"></span>The paper</h2><span aria-hidden="true" class="h-px flex-1 bg-border-strong"></span></div><p class="annotation text-text-faint mt-4 measure-mono xl:hidden">1 Introduction · 2 Results</p><p class="annotation text-text-faint mt-1.5">Read from PDF · 2 sections · 22 words</p><section id="paper-section-0" class="mt-8 scroll-mt-20 first:mt-6"><h3 class="font-reading font-medium text-heading text-title leading-[1.3] mb-2">1 Introduction</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Creep limits the life of hot parts.</p></div><div class="space-y-4"><p>Grain boundaries carry the strain.</p></div></div></section><section id="paper-section-1" class="mt-8 scroll-mt-20 first:mt-6"><h3 class="font-reading font-medium text-heading text-title leading-[1.3] mb-2">2 Results</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Figure 1 shows the rate.</p><div class="group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2"><div class="min-w-0 flex-1 overflow-x-auto text-center text-heading [&amp;_.katex-display]:my-0"><code class="block whitespace-pre-wrap font-mono text-body text-text">r = k d</code></div><div class="flex shrink-0 flex-col items-end gap-2"></div></div><figure class="my-6"><div class="bg-[var(--plate-mat)] p-3 sm:p-4"><img src="/api/papers/openalex%3AW1/figure-image?page=2" alt="Creep against density." loading="lazy" decoding="async" referrerPolicy="no-referrer" class="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"/></div><figcaption class="annotation mt-2 leading-[1.6] text-text-faint measure-mono"><span class="text-text-muted">Figure 1</span> · Creep against density.</figcaption></figure></div><div class="space-y-4"><p>The finest grains crept fastest.</p></div></div></section></section></div>';

describe("PaperBody — paragraph anchors (P1-04)", () => {
  const html = renderToStaticMarkup(createElement(PaperBody, { reading }));

  it("names a paragraph's anchor after its section's", () => {
    expect(paragraphAnchor(3, 2)).toBe(`${sectionAnchor(3)}-p2`);
    expect(paragraphAnchor(0, 0)).toBe("paper-section-0-p0");
  });

  it("gives every paragraph its anchor, clear of the sticky masthead", () => {
    reading.body.forEach((section, k) => {
      section.paragraphs.forEach((_, i) => {
        expect(html).toContain(`<div id="${paragraphAnchor(k, i)}" class="space-y-4 scroll-mt-20">`);
      });
    });
    expect(html.match(/id="paper-section-\d+-p\d+"/g)).toHaveLength(4);
  });

  it("changes nothing else: the body without the anchors is the body it was", () => {
    const withoutAnchors = html.replace(/<div id="paper-section-\d+-p\d+" class="space-y-4 scroll-mt-20">/g, '<div class="space-y-4">');

    expect(withoutAnchors).toBe(BEFORE);
  });
});
