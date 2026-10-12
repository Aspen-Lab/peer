import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { leadFigurePending, PaperPlate } from "./paper-plate";

// P9-49 (N6, X3, round 3's walk): the reading page's LEAD PICTURE.
//
//   * N6 — with no key the plate was drawn only when `POST /api/figure` answered (4-5 s), and the title
//     and the decision block moved 96 px (1440) / 120 px (390) down under a reader about to press
//     "Read it here". The slot is held from the first paint in both paths: the figure's own box
//     (16:9, the mat) stands there before any picture exists, class for class what the picture will
//     stand in, so nothing below it has anywhere to move when the picture lands.
//   * X3 — in one column the plate is as wide as the column (up to 712 px) and 16:9, so 337-400 px
//     tall at 768-1024. Below the spread it is capped; the figure is contained inside the capped box,
//     never cropped.
//   * The feed's tiles (`feed-tile.tsx`) mount the same component without these props and must not
//     change: the exact markup they had is pinned below.
//
// The page's first paint is the component's first render, which is what `renderToStaticMarkup` runs
// (no effect, so the figure is "idle", exactly the state a reader's first paint has).

type PlateProps = ComponentProps<typeof PaperPlate>;
const render = (props: PlateProps): string => renderToStaticMarkup(createElement(PaperPlate, props));

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: "arxiv:2607.00001",
  title: "A paper",
  authors: ["A. Author"],
  relevanceReason: "",
  venue: "arXiv",
  source: "arxiv",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  linkArxiv: "https://arxiv.org/abs/2607.00001",
  ...over,
});
/** An uploaded PDF with no terms of its own: the case the no-key page drew nothing for. */
const upload = paper({ id: "upload:0123456789abcdef", venue: "Uploaded PDF", linkArxiv: undefined });
const BOUND = { imageUrl: "data:image/png;base64,AAAA", caption: "Figure 1. A caption." };
const TERMS = ["Soil water", "Seaweed mulch", "Terraces"];

const openTag = (html: string): string => /<div data-plate="[a-z]+"[^>]*>/.exec(html)?.[0] ?? "";
const classes = (tag: string): string[] => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);
const lead = (over: Partial<PlateProps> = {}): PlateProps => ({ paper: upload, terms: [], lead: true, lightbox: true, ...over });

describe("the lead plate holds its box from the first paint (rule 1, N6)", () => {
  it("draws the figure's own box before any figure exists, for a paper with no terms (the no-key upload)", () => {
    const html = render(lead());
    expect(html, "the head draws nothing here until /api/figure answers").not.toBe("");
    const tag = openTag(html);
    expect(tag).toContain('data-plate="figure"');
    expect(classes(tag)).toContain("aspect-[16/9]");
  });

  it("is the same box, class for class, as the box the picture stands in (nothing to gain when it lands)", () => {
    const pending = classes(openTag(render(lead())));
    const landed = classes(openTag(render(lead({ figure: BOUND }))));
    expect(pending.length).toBeGreaterThan(0);
    expect([...pending].sort()).toEqual([...landed].sort());
  });

  it("is that box, not the 2.4:1 terms plate, when the paper has terms of its own (a terms plate would then grow)", () => {
    const html = render(lead({ terms: TERMS }));
    const tag = openTag(html);
    expect(tag).toContain('data-plate="figure"');
    expect(tag).not.toContain("aspect-[2.4/1]");
    expect(html).not.toContain('data-plate="terms"');
    expect([...classes(tag)].sort()).toEqual([...classes(openTag(render(lead({ terms: TERMS, figure: BOUND }))))].sort());
  });

  it("is only a mat: no picture, no words, no caption, and hidden from assistive technology", () => {
    const html = render(lead({ terms: TERMS }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Soil water");
    expect(openTag(html)).toContain('aria-hidden="true"');
  });

  it("keeps drawing the picture itself when one is bound (the keyed first paint with a cached report)", () => {
    const html = render(lead({ figure: BOUND }));
    expect(html).toContain("<img");
    expect(html).toContain("data:image/png;base64,AAAA");
  });
});

// Rule 2 reaches the plate itself: with no `imageAlt`, the plate's own caption is the image's alt and the lightbox's
// caption, so an abstract block must not get in by that door either. (The line under the plate is `leadCaption`'s,
// tested in lead-caption.test.ts.)
describe("an abstract block is not the lead picture's alt or lightbox caption (rule 2, N8)", () => {
  const ABSTRACT = "ABSTRACT: Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer.";
  const altOf = (html: string): string | null => /<img [^>]*alt="([^"]*)"/.exec(html)?.[1] ?? null;

  it("drops a block that opens with the word Abstract", () => {
    expect(altOf(render(lead({ figure: { imageUrl: BOUND.imageUrl, caption: ABSTRACT } })))).toBe("");
  });

  it("drops the reading's own abstract, even without the word", () => {
    const abstract = "Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer, a thin layer or not at all.";
    const block = "Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer.";
    expect(altOf(render(lead({ figure: { imageUrl: BOUND.imageUrl, caption: block }, abstract })))).toBe("");
    expect(altOf(render(lead({ figure: { imageUrl: BOUND.imageUrl, caption: block } })))).toBe(block);
  });

  it("keeps a real caption as the alt (the page then passes imageAlt='' when it sets the caption itself)", () => {
    expect(altOf(render(lead({ figure: BOUND, abstract: "Terraced orchards lose water to storms and to dry spells." })))).toBe("Figure 1. A caption.");
    expect(altOf(render(lead({ figure: BOUND, imageAlt: "" })))).toBe("");
  });

  it("is for the lead picture only: a feed tile's alt is as it was", () => {
    expect(altOf(render({ paper: paper(), terms: [], figure: { imageUrl: BOUND.imageUrl, caption: ABSTRACT } }))).toBe(ABSTRACT);
  });
});

describe("leadFigurePending — when the page keeps the slot (rule 1)", () => {
  it("is true while the figure route has not answered and nothing is bound", () => {
    expect(leadFigurePending({ status: "idle", imageUrl: null }, null)).toBe(true);
    expect(leadFigurePending({ status: "idle", imageUrl: null })).toBe(true);
  });

  it("is false once the route has answered, with a picture or without one (the box then goes in one step)", () => {
    expect(leadFigurePending({ status: "found", imageUrl: "data:image/png;base64,AAAA" }, null)).toBe(false);
    expect(leadFigurePending({ status: "no_figures", imageUrl: null }, null)).toBe(false);
    expect(leadFigurePending({ status: "source_unavailable", imageUrl: null }, null)).toBe(false);
  });

  it("is false when the report has bound a picture (it is there, not coming)", () => {
    expect(leadFigurePending({ status: "idle", imageUrl: null }, { imageUrl: "data:image/png;base64,AAAA" })).toBe(false);
  });
});

describe("in one column the lead plate is capped (rule 3, X3)", () => {
  const cap = (tag: string): number | null => {
    const hit = classes(tag)
      .map((c) => /^max-xl:max-h-\[(\d+)px\]$/.exec(c))
      .find(Boolean);
    return hit ? Number(hit[1]) : null;
  };

  it("carries a height cap below the spread, at most 240 px", () => {
    const value = cap(openTag(render(lead({ figure: BOUND }))));
    expect(value, "the lead figure plate has no `max-xl:max-h-[Npx]` cap").not.toBeNull();
    expect(value as number).toBeLessThanOrEqual(240);
    expect(value as number).toBeGreaterThan(0);
  });

  it("keeps the column's width and loses only height: the capped box is `max-xl:w-full`", () => {
    expect(classes(openTag(render(lead({ figure: BOUND }))))).toContain("max-xl:w-full");
    expect(classes(openTag(render(lead())))).toContain("max-xl:w-full");
  });

  it("is the same cap on the box that holds the slot, so the picture's landing changes no height", () => {
    expect(cap(openTag(render(lead())))).toBe(cap(openTag(render(lead({ figure: BOUND })))));
    expect(cap(openTag(render(lead())))).not.toBeNull();
  });

  it("does not reach the spread: the cap is `max-xl:` only, with no unprefixed `max-h-` on the box", () => {
    for (const html of [render(lead({ figure: BOUND })), render(lead())]) {
      const names = classes(openTag(html));
      expect(names.some((c) => c.startsWith("max-xl:max-h-")), "there is no cap to scope").toBe(true);
      expect(names.filter((c) => /(^|:)max-h-/.test(c) && !c.startsWith("max-xl:"))).toEqual([]);
    }
  });

  it("contains the figure inside the capped box, never crops it", () => {
    const html = render(lead({ figure: BOUND }));
    expect(html).toContain("object-contain");
    expect(html).not.toContain("object-cover");
    expect(classes(openTag(html))).toContain("overflow-hidden");
  });

  it("leaves the feed's plate uncapped", () => {
    const tag = openTag(render({ paper: paper(), terms: [], figure: BOUND }));
    expect(tag).toContain('data-plate="figure"');
    expect(classes(tag).filter((c) => c.includes("max-h-"))).toEqual([]);
  });
});

// Rule 4 — `feed-tile.tsx` mounts `<PaperPlate paper={paper} terms={plateTerms} />` and nothing else. These are
// the exact strings the head renders for it; any change to what a tile draws fails here.
describe("the feed tile's plate is byte for byte what it was (rule 4)", () => {
  it("the terms plate, three terms", () => {
    expect(render({ paper: paper(), terms: TERMS })).toBe(
      '<div data-plate="terms" class="tile-cover grain overflow-hidden aspect-[2.4/1] @container"><div class="flex h-full w-full flex-col justify-end px-[7%] pb-[7%] pt-3"><div class="flex gap-[5%]"><div class="flex flex-col gap-[0.28em] pt-[0.34em] font-mono text-micro tabular-nums tracking-[0.1em] text-[var(--plate-ink-faint)]"><span class="leading-[1.5]">01</span><span class="leading-[1.5]">02</span><span class="leading-[1.5]">03</span></div><div class="min-w-0 flex flex-col gap-[0.1em]"><span class="paper-line leading-[1.06] truncate text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]">Soil water</span><span class="paper-line leading-[1.06] truncate text-[clamp(17px,5.8cqw,23px)] italic text-[var(--plate-ink-muted)]">Seaweed mulch</span><span class="paper-line leading-[1.06] truncate text-[clamp(14px,4.6cqw,18px)] text-[var(--plate-ink-faint)]">Terraces</span></div></div><span aria-hidden="true" class="mt-[0.7em] h-px w-[34%] bg-[var(--plate-ink-faint)] ml-[calc(5%+2.1em)]"></span></div></div>',
    );
  });

  it("the terms plate, one term", () => {
    expect(render({ paper: paper(), terms: ["Soil water"] })).toBe(
      '<div data-plate="terms" class="tile-cover grain overflow-hidden aspect-[2.4/1] @container"><div class="flex h-full w-full flex-col justify-end px-[7%] pb-[7%] pt-3"><div class="flex gap-[5%]"><div class="min-w-0 flex flex-col gap-[0.1em]"><span class="paper-line leading-[1.06] truncate text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]">Soil water</span></div></div><span aria-hidden="true" class="mt-[0.7em] h-px w-[34%] bg-[var(--plate-ink-faint)] "></span></div></div>',
    );
  });

  it("no plate at all for a paper with no figure and no term, however the figure is still on its way", () => {
    expect(render({ paper: paper(), terms: [] })).toBe("");
    expect(render({ paper: upload, terms: [] })).toBe("");
  });

  it("the figure plate: the same box and the same image classes, the caption read as the image's alt as before", () => {
    expect(render({ paper: paper(), terms: ["Soil water"], figure: { imageUrl: "data:image/png;base64,AAAA", caption: "ABSTRACT: A caption." } })).toBe(
      '<div data-plate="figure" class="tile-cover cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] overflow-hidden aspect-[16/9] @container"><img src="data:image/png;base64,AAAA" alt="ABSTRACT: A caption." loading="lazy" decoding="async" referrerPolicy="no-referrer" class="h-full w-full object-contain opacity-0 transition-opacity duration-[var(--dur-base)] ease-expo"/></div>',
    );
  });

  it("a tile's className is appended as before", () => {
    const tag = openTag(render({ paper: paper(), terms: TERMS, className: "extra" }));
    expect(classes(tag).at(-1)).toBe("extra");
  });
});
