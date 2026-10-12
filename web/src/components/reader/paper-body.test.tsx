import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { blockMarker, inlineMath } from "@/lib/text/math";
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
 *  for exactly this reading). P7-14 (R5, the owner's review): re-pinned without the line that
 *  joined the section headings and the line that counted sections and words — the map is the
 *  paper's one contents list now, and says the count itself. Nothing else in the body moved. */
const BEFORE =
  '<div id="paper-body" class="scroll-mt-20"><section class="mt-12 sm:mt-16"><div class="flex items-center gap-3"><h2 class="eyebrow inline-flex items-center gap-2 whitespace-nowrap text-text-faint"><span aria-hidden="true" class="block h-[6px] w-[6px] shrink-0 bg-current"></span>The paper</h2><span aria-hidden="true" class="h-px flex-1 bg-border-strong"></span></div><section id="paper-section-0" class="mt-8 scroll-mt-20 first:mt-6"><h3 class="font-reading font-medium text-heading text-title leading-[1.3] mb-2">1 Introduction</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Creep limits the life of hot parts.</p></div><div class="space-y-4"><p>Grain boundaries carry the strain.</p></div></div></section><section id="paper-section-1" class="mt-8 scroll-mt-20 first:mt-6"><h3 class="font-reading font-medium text-heading text-title leading-[1.3] mb-2">2 Results</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Figure 1 shows the rate.</p><div class="group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2"><div class="min-w-0 flex-1 overflow-x-auto text-center text-heading [&amp;_.katex-display]:my-0"><code class="block whitespace-pre-wrap font-mono text-body text-text">r = k d</code></div><div class="flex shrink-0 flex-col items-end gap-2"></div></div><figure class="my-6"><div class="bg-[var(--plate-mat)] p-3 sm:p-4"><img src="/api/papers/openalex%3AW1/figure-image?page=2&amp;fig=1" alt="Creep against density." loading="lazy" decoding="async" referrerPolicy="no-referrer" class="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"/></div><figcaption class="annotation mt-2 leading-[1.6] text-text-faint measure-mono"><span class="text-text-muted">Figure 1</span> · Creep against density.</figcaption></figure></div><div class="space-y-4"><p>The finest grains crept fastest.</p></div></div></section></section></div>';

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

// P3-01 (ruling §1h.1): a clicked term is marked where the paper first uses it
// — a `data-term-mark` on that paragraph and a `<mark>` around the words —
// and the body is otherwise the body it was: nothing hidden, reordered or
// wrapped, with the mark or without it.
describe("PaperBody — the highlighted term (P3-01)", () => {
  const plain = renderToStaticMarkup(createElement(PaperBody, { reading }));
  const at = { sectionId: reading.body[0].id, sectionIndex: 0, paragraphIndex: 1, offset: 0, length: 5 };
  // "Grain boundaries carry the strain." — the second paragraph of the first section.
  const marked = renderToStaticMarkup(createElement(PaperBody, { reading, termMark: at }));

  it("marks the words and the paragraph that holds them, and no other", () => {
    expect(marked.match(/<mark\b/g)).toHaveLength(1);
    expect(marked.match(/data-term-mark/g)).toHaveLength(1);
    expect(marked).toMatch(/<div id="paper-section-0-p1"[^>]*data-term-mark=""[^>]*>/);
    expect(marked).toMatch(/<mark[^>]*>Grain<\/mark> boundaries carry the strain\./);
  });

  it("draws the mark with the term token, a background only, never a hue of the route's", () => {
    const tag = /<mark[^>]*>/.exec(marked)![0];

    expect(tag).toContain("bg-[color:var(--color-term-mark)]");
    expect(tag).not.toMatch(/route-(?:read|background|skim)/);
    expect(tag).toContain("text-heading");
  });

  it("changes nothing else: without the mark's two additions the body is exactly the unmarked body", () => {
    const stripped = marked.replace(' data-term-mark=""', "").replace(/<mark[^>]*>/, "").replace("</mark>", "");

    expect(stripped).toBe(plain);
  });

  it("is the unmarked body when there is no mark, or the mark points at nothing the body holds", () => {
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, termMark: null }))).toBe(plain);
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, termMark: { ...at, sectionId: "s99", sectionIndex: 9 } }))).toBe(plain);
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, termMark: { ...at, paragraphIndex: 9 } }))).toBe(plain);
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, termMark: { ...at, offset: 500 } }))).toBe(plain);
  });

  it("marks words that follow a formula without disturbing it", () => {
    const withFormula: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [{ id: "s1", heading: "1 A", canonical: "introduction", text: `The load ${inlineMath("x_{1}")} meets the QPU twice.` }],
    };
    const formulaReading = buildReading(paper, { ...fullText, doc: withFormula } as FullTextResult, new Date("2026-10-05T00:00:00.000Z"));
    const paragraph = formulaReading.body[0].paragraphs[0];
    const offset = paragraph.indexOf("QPU");
    const html = renderToStaticMarkup(
      createElement(PaperBody, {
        reading: formulaReading,
        termMark: { sectionId: "s1", sectionIndex: 0, paragraphIndex: 0, offset, length: 3 },
      }),
    );

    expect(html).toMatch(/<code[^>]*>x_\{1\}<\/code>/);
    expect(html).toMatch(/<mark[^>]*>QPU<\/mark> twice\./);
  });
});

// P7-14 (R5, the owner's review): "The paper" band over the body had two lines under it that said
// again what the map says — every section heading joined by " · " (stacked layout only), and a
// count of sections and words — and, on the spread, the panel carried a third copy as a rail. The
// map is the paper's one contents list now (it says where the text was read from and how long it
// is, `MAP.summary`); the band keeps its label "The paper" (Q3) and the body below it is the same.
describe("PaperBody — no second contents list (P7-14, R5)", () => {
  const html = renderToStaticMarkup(createElement(PaperBody, { reading }));
  const band = html.slice(0, html.indexOf('<section id="paper-section-0"'));

  it("keeps the band label 'The paper' over the body", () => {
    expect(band).toContain(">The paper</h2>");
  });

  it("has no line joining the section headings, in either layout", () => {
    expect(html).not.toContain("1 Introduction · 2 Results");
    expect(html).not.toContain("xl:hidden");
    expect(html).not.toContain("measure-mono xl:");
  });

  it("has no count line: nothing under the band says 'Read from', a section count or a word count", () => {
    expect(html).not.toContain("Read from");
    expect(html).not.toMatch(/\d+ sections?\b/);
    expect(html).not.toMatch(/\d+ words\b/);
  });

  it("goes from the band's rule straight to the first section", () => {
    // Between the band's header and the first section there is nothing: no paragraph of Peer's.
    expect(band.endsWith('<span aria-hidden="true" class="h-px flex-1 bg-border-strong"></span></div>')).toBe(true);
  });

  it("is the same body, section for section, as before the two lines went", () => {
    for (const [i, heading] of ["1 Introduction", "2 Results"].entries()) {
      expect(html).toContain(`<section id="${sectionAnchor(i)}"`);
      expect(html).toContain(`>${heading}</h3>`);
    }
    expect(html).toContain('id="paper-section-0-p0"');
    expect(html).toContain('id="paper-section-1-p1"');
  });
});

describe("the contents rail is gone (P7-14, R5)", () => {
  it("has no PaperContents module, no import of it, and no contents slot in the layout or on the page", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const at = (path: string) => resolve(process.cwd(), path);
    expect(existsSync(at("src/components/reader/paper-contents.tsx"))).toBe(false);
    const page = readFileSync(at("src/app/papers/[id]/page.tsx"), "utf8");
    const layout = readFileSync(at("src/components/reader/reader-layout.tsx"), "utf8");
    expect(page).not.toContain("PaperContents");
    expect(page).not.toContain("paper-contents");
    expect(page).not.toContain("contents={");
    expect(layout).not.toMatch(/\bcontents\b\s*[?:]/);
    expect(layout).not.toContain("p.contents");
  });
});
