import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { Paper } from "@/types";
import { blockMarker } from "@/lib/text/math";
import { paragraphKey } from "@/store/plain-rewrites";
import { PEERS_READING, PLAIN } from "./copy";
import { PaperBody, type DrawRoute } from "./paper-body";
import { ParagraphPlainControl, PlainControl, type PlainControlProps, type PlainTarget, type PlainView } from "./plain-button";

// P4-01 (blueprint §3.6 ⑥; rulings §1h.12 (h); §3d 15, 18): the body draws "Say it plainly"
// under a paragraph the route marks read, and the rewrite BESIDE the paragraph — through one
// optional prop, `plain`. Without it the body is the body it was, byte for byte; with it, and
// no rewrite showing, the paragraphs' own markup is still the same and the only addition is the
// control. The original is never replaced: with a rewrite showing, the paragraph is still in
// its own anchor, so the selection that "Explain this?" reads from it still finds it.

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

/** s1 is read at its second paragraph only (a Tier 0 route marks paragraphs); s2 is read as a whole
 *  with no paragraph marks (a Tier 2 answer marks a section). */
const route: DrawRoute = {
  vague: false,
  byQuestion: [
    {
      question: "How fast do grains creep?",
      vague: false,
      sections: {
        s1: { tier: "read", hits: [{ term: "creep", count: 2 }], paragraphs: [1] },
        s2: { tier: "read", hits: [], paragraphs: [] },
      },
    },
  ],
};
/** A route that marks s1 skim and s2 background: nothing is read. */
const quietRoute: DrawRoute = {
  vague: false,
  byQuestion: [
    {
      question: "How fast do grains creep?",
      vague: false,
      sections: {
        s1: { tier: "skim", hits: [{ term: "creep", count: 1 }], paragraphs: [0] },
        s2: { tier: "background", hits: [], paragraphs: [] },
      },
    },
  ],
};

/** The body with this route, as it rendered before P4-01 (captured from the code at 5567fee2
 *  for exactly this reading and route, before any line of this item changed `paper-body.tsx`). */
const TODAY_WITH_ROUTE =
  "<div id=\"paper-body\" class=\"scroll-mt-20\"><section class=\"mt-12 sm:mt-16\"><div class=\"flex items-center gap-3\"><h2 class=\"eyebrow inline-flex items-center gap-2 whitespace-nowrap text-text-faint\"><span aria-hidden=\"true\" class=\"block h-[6px] w-[6px] shrink-0 bg-current\"></span>The paper</h2><span aria-hidden=\"true\" class=\"h-px flex-1 bg-border-strong\"></span></div><p class=\"annotation text-text-faint mt-4 measure-mono xl:hidden\">1 Introduction \u00b7 2 Results</p><p class=\"annotation text-text-faint mt-1.5\">Read from PDF \u00b7 2 sections \u00b7 22 words</p><section id=\"paper-section-0\" class=\"mt-8 scroll-mt-20 first:mt-6\"><h3 data-route=\"read\" class=\"font-reading font-medium text-heading text-title leading-[1.3] mb-2 bg-[color:var(--color-route-read)] w-fit -mx-1 px-1\">1 Introduction</h3><div class=\"font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify\"><div id=\"paper-section-0-p0\" class=\"space-y-4 scroll-mt-20\"><p>Creep limits the life of hot parts.</p></div><div id=\"paper-section-0-p1\" class=\"space-y-4 scroll-mt-20\"><p>Grain boundaries carry the strain.</p></div></div></section><section id=\"paper-section-1\" class=\"mt-8 scroll-mt-20 first:mt-6\"><h3 data-route=\"read\" class=\"font-reading font-medium text-heading text-title leading-[1.3] mb-2 bg-[color:var(--color-route-read)] w-fit -mx-1 px-1\">2 Results</h3><div class=\"font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify\"><div id=\"paper-section-1-p0\" class=\"space-y-4 scroll-mt-20\"><p>Figure 1 shows the rate.</p><div class=\"group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2\"><div class=\"min-w-0 flex-1 overflow-x-auto text-center text-heading [&amp;_.katex-display]:my-0\"><code class=\"block whitespace-pre-wrap font-mono text-body text-text\">r = k d</code></div><div class=\"flex shrink-0 flex-col items-end gap-2\"></div></div><figure class=\"my-6\"><div class=\"bg-[var(--plate-mat)] p-3 sm:p-4\"><img src=\"/api/papers/openalex%3AW1/figure-image?page=2\" alt=\"Creep against density.\" loading=\"lazy\" decoding=\"async\" referrerPolicy=\"no-referrer\" class=\"mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain\"/></div><figcaption class=\"annotation mt-2 leading-[1.6] text-text-faint measure-mono\"><span class=\"text-text-muted\">Figure 1</span> \u00b7 Creep against density.</figcaption></figure></div><div id=\"paper-section-1-p1\" class=\"space-y-4 scroll-mt-20\"><p>The finest grains crept fastest.</p></div></div></section></section></div>";
/** The same reading with no route at all, captured the same way. */
const TODAY_NO_ROUTE =
  "<div id=\"paper-body\" class=\"scroll-mt-20\"><section class=\"mt-12 sm:mt-16\"><div class=\"flex items-center gap-3\"><h2 class=\"eyebrow inline-flex items-center gap-2 whitespace-nowrap text-text-faint\"><span aria-hidden=\"true\" class=\"block h-[6px] w-[6px] shrink-0 bg-current\"></span>The paper</h2><span aria-hidden=\"true\" class=\"h-px flex-1 bg-border-strong\"></span></div><p class=\"annotation text-text-faint mt-4 measure-mono xl:hidden\">1 Introduction \u00b7 2 Results</p><p class=\"annotation text-text-faint mt-1.5\">Read from PDF \u00b7 2 sections \u00b7 22 words</p><section id=\"paper-section-0\" class=\"mt-8 scroll-mt-20 first:mt-6\"><h3 class=\"font-reading font-medium text-heading text-title leading-[1.3] mb-2\">1 Introduction</h3><div class=\"font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify\"><div id=\"paper-section-0-p0\" class=\"space-y-4 scroll-mt-20\"><p>Creep limits the life of hot parts.</p></div><div id=\"paper-section-0-p1\" class=\"space-y-4 scroll-mt-20\"><p>Grain boundaries carry the strain.</p></div></div></section><section id=\"paper-section-1\" class=\"mt-8 scroll-mt-20 first:mt-6\"><h3 class=\"font-reading font-medium text-heading text-title leading-[1.3] mb-2\">2 Results</h3><div class=\"font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify\"><div id=\"paper-section-1-p0\" class=\"space-y-4 scroll-mt-20\"><p>Figure 1 shows the rate.</p><div class=\"group/eq relative my-6 flex items-center gap-4 border-l border-border-strong py-3 pl-5 pr-2\"><div class=\"min-w-0 flex-1 overflow-x-auto text-center text-heading [&amp;_.katex-display]:my-0\"><code class=\"block whitespace-pre-wrap font-mono text-body text-text\">r = k d</code></div><div class=\"flex shrink-0 flex-col items-end gap-2\"></div></div><figure class=\"my-6\"><div class=\"bg-[var(--plate-mat)] p-3 sm:p-4\"><img src=\"/api/papers/openalex%3AW1/figure-image?page=2\" alt=\"Creep against density.\" loading=\"lazy\" decoding=\"async\" referrerPolicy=\"no-referrer\" class=\"mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain\"/></div><figcaption class=\"annotation mt-2 leading-[1.6] text-text-faint measure-mono\"><span class=\"text-text-muted\">Figure 1</span> \u00b7 Creep against density.</figcaption></figure></div><div id=\"paper-section-1-p1\" class=\"space-y-4 scroll-mt-20\"><p>The finest grains crept fastest.</p></div></div></section></section></div>";

function view(over: Partial<PlainView> = {}): PlainView {
  return {
    level: "undergrad",
    shown: new Map(),
    busy: new Set(),
    notices: new Map(),
    onToggle: () => {},
    onLevel: () => {},
    ...over,
  };
}

const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PaperBody, { reading, ...props }));
const CONTROL = /<div data-plain-control="" class="[^"]*">.*?<\/div>/g;
const controls = (html: string) => html.match(CONTROL) ?? [];

describe("PaperBody without the `plain` prop — today's body", () => {
  it("renders the markup it rendered before, byte for byte, with a route and without one", () => {
    expect(render({ route })).toBe(TODAY_WITH_ROUTE);
    expect(render({})).toBe(TODAY_NO_ROUTE);
    expect(render({ route, plain: undefined })).toBe(TODAY_WITH_ROUTE);
  });

  it("has no control, no rewrite and no word of Say it plainly anywhere in it", () => {
    for (const html of [TODAY_WITH_ROUTE, render({ route }), render({})]) {
      expect(html).not.toContain("data-plain");
      expect(html).not.toContain(PLAIN.button);
    }
  });
});

describe("PaperBody with the `plain` prop — where the control is", () => {
  it("is under a paragraph the route marks read: its own tier, or its section's when the section has no paragraph marks", () => {
    const html = render({ route, plain: view() });
    const marked = ["paper-section-0-p1", "paper-section-1-p0", "paper-section-1-p1"];
    const unmarked = ["paper-section-0-p0"];

    expect(controls(html)).toHaveLength(3);
    for (const id of marked) expect(html).toMatch(new RegExp(`<div id="${id}"[^>]*>.*?data-plain-control.*?</div></div>`));
    // The unmarked paragraph's own wrapper holds the paragraph and nothing else.
    for (const id of unmarked) expect(html).toContain(`<div id="${id}" class="space-y-4 scroll-mt-20"><p>Creep limits the life of hot parts.</p></div>`);
  });

  it("is nowhere when the route marks nothing read — skim, background, or no route at all", () => {
    expect(controls(render({ route: quietRoute, plain: view() }))).toHaveLength(0);
    expect(controls(render({ plain: view() }))).toHaveLength(0);
    expect(render({ route: quietRoute, plain: view() })).toBe(render({ route: quietRoute }));
  });

  it("leaves every paragraph's own markup as it was: take the controls out and it is today's body", () => {
    const html = render({ route, plain: view() });

    expect(html.replace(CONTROL, "")).toBe(TODAY_WITH_ROUTE);
  });

  it("puts the control right after the paragraph, before what the paper set after it", () => {
    const html = render({ route, plain: view() });
    const at = html.indexOf('<div id="paper-section-1-p0"');
    const slice = html.slice(at, html.indexOf('<div id="paper-section-1-p1"'));

    expect(slice.indexOf("<p>Figure 1 shows the rate.</p>")).toBeLessThan(slice.indexOf("data-plain-control"));
    expect(slice.indexOf("data-plain-control")).toBeLessThan(slice.indexOf("<code"));
    expect(slice.indexOf("data-plain-control")).toBeLessThan(slice.indexOf("<figure"));
  });

  it("draws the remembered level, and a button that is not pressed", () => {
    const html = render({ route, plain: view({ level: "graduate" }) });

    for (const control of controls(html)) {
      expect(control).toContain('data-plain-level="graduate" aria-pressed="true"');
      expect(control).toContain('data-plain-say="" aria-pressed="false"');
    }
  });

  it("says a paragraph is busy, and why one has no rewrite, on that paragraph alone", () => {
    const html = render({
      route,
      plain: view({
        busy: new Set([paragraphKey("s1", 1)]),
        notices: new Map([[paragraphKey("s2", 0), "numbers_changed" as const], [paragraphKey("s2", 1), "unavailable" as const]]),
      }),
    });
    const [first, second, third] = controls(html);

    expect(first).toContain(PLAIN.busy);
    expect(first).toContain("disabled");
    expect(second).toContain("numbers exact");
    expect(third).toContain(PLAIN.unavailable);
    expect(controls(html).filter((c) => c.includes(PLAIN.busy))).toHaveLength(1);
  });
});

describe("PaperBody with a rewrite showing — beside the paragraph, never in its place", () => {
  const showing = view({ shown: new Map([[paragraphKey("s1", 1), "Grain edges carry the strain, in plainer words."]]) });
  const html = render({ route, plain: showing });

  it("keeps the original paragraph, exactly as it was, in its own anchor — where a selection in it is still found", () => {
    expect(html).toContain('<div id="paper-section-0-p1" class="space-y-4 scroll-mt-20 xl:grid xl:grid-cols-2 xl:gap-x-6 xl:gap-y-4 xl:space-y-0 xl:[&amp;_p]:text-left"><p>Grain boundaries carry the strain.</p>');
    expect(html.split("Grain boundaries carry the strain.").length - 1).toBe(1);
    // The paragraph's parent is the anchor itself, as `readSelection` needs.
    expect(html).toMatch(/<div id="paper-section-0-p1"[^>]*><p>Grain boundaries carry the strain\.<\/p>/);
  });

  it("sets the rewrite after the original in the same anchor: a second column on the spread, under the paragraph at phone width", () => {
    const anchor = html.slice(html.indexOf('<div id="paper-section-0-p1"'), html.indexOf("</section>", html.indexOf('<div id="paper-section-0-p1"')));

    expect(anchor.indexOf("<p>Grain boundaries carry the strain.</p>")).toBeLessThan(anchor.indexOf("data-plain-rewrite"));
    expect(anchor.indexOf("data-plain-rewrite")).toBeLessThan(anchor.indexOf("data-plain-control"));
    // Below xl nothing is a grid: the three blocks stack, as the paragraphs already do.
    expect(anchor).toContain("space-y-4");
    expect(anchor).toContain("xl:grid-cols-2");
    expect(anchor).not.toMatch(/(?<![:\w-])grid-cols-2/);
  });

  it("labels the rewrite as Peer's once, in the label face, and draws its words in the reading face", () => {
    expect(html.split(PEERS_READING.replace(/'/g, "&#x27;")).length - 1).toBe(1);
    expect(html).toContain("<p>Grain edges carry the strain, in plainer words.</p>");
    expect(html).toContain(`aria-label="${PLAIN.rewrite}"`);
  });

  it("presses the paragraph's button, and spans the control across both columns on the spread", () => {
    const control = controls(html).find((one) => one.includes('aria-pressed="true"') && one.includes("data-plain-say=\"\" aria-pressed=\"true\""));

    expect(control).toBeDefined();
    expect(control).toContain("xl:col-span-2");
  });

  it("changes no other paragraph", () => {
    const other = render({ route, plain: view() });
    const strip = (markup: string) => markup.replace(/<div id="paper-section-0-p1".*?<div id="paper-section-1-p0"/s, "<div id=\"paper-section-1-p0\"");

    expect(strip(html).replace(CONTROL, "")).toBe(strip(other).replace(CONTROL, ""));
  });

  it("keeps what the paper set after the paragraph across both columns, and out of the grid's single cell", () => {
    const withEquation = render({ route, plain: view({ shown: new Map([[paragraphKey("s2", 0), "The rate, plainly."]]) }) });
    const anchor = withEquation.slice(withEquation.indexOf('<div id="paper-section-1-p0"'), withEquation.indexOf('<div id="paper-section-1-p1"'));

    expect(anchor).toContain('<div class="space-y-4 xl:col-span-2">');
    expect(anchor.indexOf("data-plain-control")).toBeLessThan(anchor.indexOf('<div class="space-y-4 xl:col-span-2">'));
    expect(anchor.indexOf('<div class="space-y-4 xl:col-span-2">')).toBeLessThan(anchor.indexOf("<figure"));
    // No empty wrapper where nothing follows.
    expect(html.match(/<div class="space-y-4 xl:col-span-2">/g) ?? []).toHaveLength(0);
  });

  it("keeps its control, and so a way to hide it, when the route no longer marks the paragraph read", () => {
    const html = render({ route: quietRoute, plain: showing });

    expect(controls(html)).toHaveLength(1);
    expect(html).toContain("data-plain-rewrite");
    expect(html).toContain("<p>Grain boundaries carry the strain.</p>");
  });
});

describe("ParagraphPlainControl — what the paragraph's control calls", () => {
  const target: PlainTarget = { sectionId: "s1", sectionIndex: 0, paragraphIndex: 1, text: "Grain boundaries carry the strain." };
  const key = paragraphKey("s1", 1);

  it("hands the control this paragraph's state: shown, busy, its notice, the remembered level", () => {
    const element = ParagraphPlainControl({
      view: view({ level: "highschool", shown: new Map([[key, "x"]]), busy: new Set([key]), notices: new Map([[key, "unavailable" as const]]) }),
      target,
    }) as ReactElement<PlainControlProps>;

    expect(element.type).toBe(PlainControl);
    expect(element.props).toMatchObject({ level: "highschool", showing: true, busy: true, notice: "unavailable" });
    const idle = ParagraphPlainControl({ view: view(), target }) as ReactElement<PlainControlProps>;
    expect(idle.props).toMatchObject({ level: "undergrad", showing: false, busy: false, notice: null });
  });

  it("calls the view with this paragraph: the button toggles it, a level chooses for it", () => {
    const onToggle = vi.fn();
    const onLevel = vi.fn();
    const element = ParagraphPlainControl({ view: view({ onToggle, onLevel }), target }) as ReactElement<PlainControlProps>;

    element.props.onToggle();
    element.props.onLevel("graduate");

    expect(onToggle).toHaveBeenCalledWith(target);
    expect(onLevel).toHaveBeenCalledWith(target, "graduate");
  });

  it("is the control of the spread when it sits beside a rewrite", () => {
    expect((ParagraphPlainControl({ view: view(), target, wide: true }) as ReactElement<PlainControlProps>).props.wide).toBe(true);
    expect((ParagraphPlainControl({ view: view(), target }) as ReactElement<PlainControlProps>).props.wide).toBeFalsy();
  });
});
