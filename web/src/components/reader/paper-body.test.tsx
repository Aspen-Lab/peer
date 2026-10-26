import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { routeByQuestions, type RouteResult } from "@/lib/papers/reading-map";
import { blockMarker } from "@/lib/text/math";
import { PaperBody, mergeQuestionRoute, paragraphAnchor, questionRouteOverlay, sectionAnchor } from "./paper-body";

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
 *  paper's one contents list now, and says the count itself. Nothing else in the body moved.
 *  P11-12 (owner item 1): re-pinned with the figure's picture inside a button — "Open Figure 1 in the margin" — that
 *  opens it in the margin; the picture, the mat and the caption are the markup they were. */
const BEFORE =
  '<div id="paper-body" class="scroll-mt-20"><section class="mt-12 sm:mt-16"><div class="flex items-center gap-3"><h2 class="eyebrow inline-flex items-center gap-2 whitespace-nowrap text-text-faint"><span aria-hidden="true" class="block h-[6px] w-[6px] shrink-0 bg-current"></span>The paper</h2><span aria-hidden="true" class="h-px flex-1 bg-border-strong"></span></div><section id="paper-section-0" class="mt-8 scroll-mt-20 first:mt-6"><h3 id="paper-section-0-p2" data-anchor-block="heading" class="font-reading font-medium text-heading text-title leading-[1.3] scroll-mt-20 mb-2">1 Introduction</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Creep limits the life of hot parts.</p></div><div class="space-y-4"><p>Grain boundaries carry the strain.</p></div></div></section><section id="paper-section-1" class="mt-8 scroll-mt-20 first:mt-6"><h3 id="paper-section-1-p2" data-anchor-block="heading" class="font-reading font-medium text-heading text-title leading-[1.3] scroll-mt-20 mb-2">2 Results</h3><div class="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify"><div class="space-y-4"><p>Figure 1 shows the rate.</p><div class="group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2"><div class="min-w-0 flex-1 overflow-x-auto text-center text-heading [&amp;_.katex-display]:my-0"><code class="block whitespace-pre-wrap font-mono text-body text-text">r = k d</code></div><div class="flex shrink-0 flex-col items-end gap-2"></div></div><figure id="paper-section-1-p3" data-anchor-block="caption" class="my-6 scroll-mt-20"><div class="bg-[var(--plate-mat)] p-3 sm:p-4"><button type="button" aria-label="Open Figure 1 in the margin" aria-expanded="false" class="mx-auto block max-w-full cursor-zoom-in"><img src="/api/papers/openalex%3AW1/figure-image?page=2&amp;fig=1&amp;v=2" alt="Creep against density." loading="lazy" decoding="async" referrerPolicy="no-referrer" class="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"/></button></div><figcaption class="annotation mt-2 leading-[1.6] text-text-faint measure-mono"><span class="text-text-muted">Figure 1</span> · Creep against density.</figcaption></figure></div><div class="space-y-4"><p>The finest grains crept fastest.</p></div></div></section></section></div>';

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
    // P11-27 (rule 2), RE-AIMED (§1c): the four are the paragraphs' anchors; each heading (two) and each figure (one) now carries its own, in the same shape
    // (`paper-body.blocks.test.tsx` pins them), so the ids of that shape in all are seven.
    expect(html.match(/<div id="paper-section-\d+-p\d+"/g)).toHaveLength(4);
    expect(html.match(/id="paper-section-\d+-p\d+"/g)).toHaveLength(7);
  });

  it("changes nothing else: the body without the anchors is the body it was", () => {
    const withoutAnchors = html.replace(/<div id="paper-section-\d+-p\d+" class="space-y-4 scroll-mt-20">/g, '<div class="space-y-4">');

    expect(withoutAnchors).toBe(BEFORE);
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

// P10-04 (review 3.3; A10): "2 Results" holds only its subsections. It is a section of the body with no
// paragraphs: its heading stands alone (the anchor the map's group row jumps to), nothing under it before
// its first child, and the paragraphs everywhere else keep their anchors' indices.
describe("PaperBody — a group heading stands alone (P10-04, A10)", () => {
  const grouped: ExtractedDocument = {
    ...doc,
    equations: [],
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
      { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life of hot parts.", page: 1 },
      { id: "s2", heading: "2 Results", canonical: "results", text: "", page: 2 },
      { id: "s3", heading: "2.1 Growth", canonical: "results", text: "The finest grains crept fastest.", page: 2 },
    ],
  };
  const groupedReading = buildReading(paper, { ...fullText, doc: grouped }, new Date("2026-10-05T00:00:00.000Z"));
  const html = renderToStaticMarkup(createElement(PaperBody, { reading: groupedReading }));

  it("renders the group heading as a heading alone, with its anchor, between its neighbours", () => {
    expect(groupedReading.body.map((s) => s.heading)).toEqual(["1 Introduction", "2 Results", "2.1 Growth"]);
    expect(groupedReading.body[1].paragraphs).toEqual([]);
    const section = /<section id="paper-section-1"[^>]*>(.*?)<\/section>/.exec(html)?.[1] ?? "";

    expect(section).toMatch(/^<h3\b[^>]*>2 Results<\/h3>$/);
    expect(section).not.toContain("measure-paper");
    expect(html.indexOf('id="paper-section-1"')).toBeLessThan(html.indexOf('id="paper-section-2"'));
  });

  // P11-27 (rule 2), RE-AIMED (§1c): was "…and no anchor is made for the heading", counting every id of the paragraph's shape. No paragraph anchor is made for the
  // group heading still (no `<div id=…>` for it: the map's row jumps to the section's own anchor); the heading, like every heading, now carries the id of its own
  // block — the one after its paragraphs, here p0 of a section that has none — and its marker (`paper-body.blocks.test.tsx`).
  it("leaves the paragraphs where they were: the child's anchors carry the body index, and no paragraph anchor is made for the heading", () => {
    expect(html).toContain('<div id="paper-section-2-p0"');
    expect(html).toContain('<div id="paper-section-0-p0"');
    expect(html).not.toContain('<div id="paper-section-1-p0"');
    expect(html.match(/<div id="paper-section-\d+-p\d+"/g)).toHaveLength(2);
    expect(html).toContain('<h3 id="paper-section-1-p0" data-anchor-block="heading"');
  });

  it("tints the group heading by the same class path as any heading", () => {
    const route = {
      byQuestion: [{ question: "q", vague: false, sections: { s2: { tier: "strong" as const, hits: [], paragraphs: [] } } }],
      vague: false,
    };
    const tinted = renderToStaticMarkup(createElement(PaperBody, { reading: groupedReading, route }));
    const heading = /<section id="paper-section-1"[^>]*>(<h3\b[^>]*>)/.exec(tinted)?.[1] ?? "";

    expect(heading).toContain('data-route="strong"');
  });
});

// P10-06d (the P10-06c checkpoint's unsettled 4): the strongest rows are three leaf rows at most once the model's marks are
// merged over the route, as they are in the route itself — a group row (no paragraphs of its own, subsections under it) wears its
// child's tier and takes no slot, or it would demote a leaf in the overlay as it once did in the route.
describe("PaperBody — the merged route's strong cap counts leaf rows (P10-06d)", () => {
  const Q = "Does the LCO lattice crack at H1-3?";
  const row = (tier: "strong" | "medium" | "faint" | "none", extra: object = {}) => ({ tier, hits: [{ term: "lco", count: 2 }], paragraphs: [0], ...extra });
  const tier0 = (sections: Record<string, ReturnType<typeof row>>): RouteResult => ({ byQuestion: [{ question: Q, vague: false, sections }], vague: false });
  const answered = (...ids: string[]) => [
    { question: Q, verdict: "answered" as const, answers: ids.map((sectionId) => ({ text: `Peer answer ${sectionId}.`, evidence: `Model says ${sectionId}.`, sectionId })), readNext: [] },
  ];
  const tiersOf = (route: ReturnType<typeof mergeQuestionRoute>) =>
    Object.fromEntries(Object.entries(route!.byQuestion[0].sections).map(([id, section]) => [id, section.tier as string]));

  it("skips a group row among four strong rows: it keeps its tier and takes no slot, so three leaves stay strong", () => {
    const merged = mergeQuestionRoute(
      tier0({ g: row("strong", { group: true, paragraphs: [] }), a: row("strong"), b: row("strong"), c: row("strong"), d: row("medium") }),
      questionRouteOverlay(answered("d")),
    );
    const tiers = tiersOf(merged);

    expect(tiers).toEqual({ g: "strong", d: "strong", a: "strong", b: "strong", c: "medium" });
  });

  it("still puts the model's strong rows first among the leaves, and keeps a demoted leaf's evidence", () => {
    const merged = mergeQuestionRoute(
      tier0({ a: row("strong"), g: row("strong", { group: true, paragraphs: [] }), b: row("strong"), c: row("strong"), d: row("faint"), e: row("faint") }),
      questionRouteOverlay(answered("d", "e")),
    );

    expect(tiersOf(merged)).toEqual({ a: "strong", g: "strong", b: "medium", c: "medium", d: "strong", e: "strong" });
    expect(merged!.byQuestion[0].sections.d.evidence).toBe("Model says d.");
  });

  it("counts a row that is not marked as a group row, so the cap of three stands for leaf rows as before", () => {
    const merged = mergeQuestionRoute(tier0({ a: row("strong"), b: row("strong"), c: row("strong"), d: row("strong") }), questionRouteOverlay(answered("d")));

    expect(tiersOf(merged)).toEqual({ a: "strong", b: "strong", c: "medium", d: "strong" });
  });

  it("carries the mark from the route itself: the route of an invented paper, merged with a verified answer", () => {
    const text = (n: number) => `The lattice of the quillwort changed ${n} times. ${"Cells were cycled at a fixed rate. ".repeat(12)}`;
    const specs = [
      { id: "res", paragraphs: [] as string[], parent: undefined },
      { id: "r1", paragraphs: [text(4)], parent: "res" },
      { id: "r2", paragraphs: [text(3)], parent: "res" },
      { id: "r3", paragraphs: [text(3)], parent: "res" },
      { id: "r4", paragraphs: [text(3)], parent: "res" },
      { id: "x", paragraphs: ["Nothing of the kind is said here. ".repeat(12)], parent: undefined },
    ];
    const map = {
      sections: specs.map((s) => ({
        id: s.id, heading: s.id, canonical: "body", role: "evidence", words: 100, minutes: 1,
        paragraphs: s.paragraphs.map((_, index) => ({ index, opening: null })),
        ...(s.parent ? { level: 2, parentId: s.parent } : { level: 1 }),
      })),
      totalMinutes: 1,
    } as unknown as Parameters<typeof routeByQuestions>[0];
    const route = routeByQuestions(map, specs.map((s) => ({ paragraphs: s.paragraphs })), ["quillwort lattice"]);
    const q = route.byQuestion[0].question;
    const merged = mergeQuestionRoute(route, questionRouteOverlay([{ question: q, verdict: "answered", answers: [{ text: "x", evidence: "Model says x.", sectionId: "x" }], readNext: [] }]));
    const tiers = tiersOf(merged);

    expect(tiers.res).toBe("strong");
    expect(tiers.x).toBe("strong");
    expect(["r1", "r2", "r3", "r4", "x"].filter((id) => tiers[id] === "strong")).toHaveLength(3);
  });
});
