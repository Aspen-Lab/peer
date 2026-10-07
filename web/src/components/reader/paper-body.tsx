"use client";

// The paper itself.
//
// Until now the reading page showed one figure, the abstract, and eight
// sentences quoted out of the full text — and then sent the reader to the
// publisher to actually read the thing. The extractor had the whole document
// the entire time: `getFullText` returns every section, and `buildReading`
// took its eight sentences and dropped the rest. This renders what was being
// thrown away.
//
// It sits last, under everything Peer has to say about the paper, because the
// order of this page is decide-then-read: the claim, the abstract, the
// blocks, and then — if you are still here — the paper. The contents strip is
// the section list, which is also the honest statement of how much of the
// paper Peer reached.
//
// The paper's own words, so: the reading serif, at the long measure. The headings
// are the paper's too, so they are serif as well — the mono on this page is
// Peer's voice, and none of this is Peer's.

import { useEffect, useRef, useState } from "react";
import type { PaperReading, ReadingFigure, ReadingSection } from "@/lib/papers/reading";
import { GIST_QUESTION, type RouteResult, type RouteSection, type RouteTier } from "@/lib/papers/reading-map";
import type { QuestionAnswers } from "@/lib/papers/report";
import type { TermOccurrence } from "@/lib/papers/terms";
import { Equation, MathText } from "./math";
import { Band } from "@/components/ui/band";
import { paragraphKey } from "@/store/plain-rewrites";
import { ASK, BODY, ROUTE } from "./copy";
import { ParagraphPlainControl, PlainRewrite, plainOffered, type PlainView } from "./plain-button";

function countWords(body: ReadingSection[]): number {
  let words = 0;
  for (const section of body) {
    for (const paragraph of section.paragraphs) {
      words += paragraph.split(/\s+/).length;
    }
  }
  return words;
}

/** Each section is a destination: the contents rail beside the page jumps
 *  here, and `scroll-mt` keeps the heading clear of the sticky masthead. */
export function sectionAnchor(index: number): string {
  return `paper-section-${index}`;
}

/** P1-04 (§1f.12): each paragraph is a destination too — the reading map's
 *  paragraph lines scroll here. */
export function paragraphAnchor(sectionIndex: number, paragraphIndex: number): string {
  return `${sectionAnchor(sectionIndex)}-p${paragraphIndex}`;
}

// ── The route's mark (P1-05, ruling §1f.13; blueprint §3.3 目录颜色) ──────
//
// The reader's questions, routed through the paper (`readingRoute` in
// `reading-map.tsx`), mark a section by how it answers them: a light-green
// tint behind its row in the contents rail, its heading here and its row in
// the map. The mark is an attribute and a background — the paper itself is
// never hidden, collapsed, greyed, reordered or wrapped, whatever the route
// says (blueprint §2 boundary 3). The tables live here, beside the anchors,
// because the rail and the map already read those from this file.

/** A route tier as the page draws it; `background` is Tier 2's (P2). */
export type TintTier = RouteTier | "background";

/** Tier → tint: a background from the route's own tokens (`globals.css`),
 *  never a text colour; `none` draws nothing. */
export const ROUTE_TINT: Readonly<Record<TintTier, string | null>> = {
  read: "bg-[color:var(--color-route-read)]",
  background: "bg-[color:var(--color-route-background)]",
  skim: "bg-[color:var(--color-route-skim)]",
  none: null,
};

/** What a marked heading adds besides its tint: the tint hugs the words,
 *  and they stay where they were. */
export const HEADING_MARK = "w-fit -mx-1 px-1";

const TIER_RANK: Readonly<Record<TintTier, number>> = { none: 0, skim: 1, background: 2, read: 3 };

export interface SectionMark {
  /** The highest tier any question gives the section. */
  tier: Exclude<TintTier, "none">;
  /** The `title`: the questions that mark it ("Q1, Q3"), or the gist. */
  title: string;
  /** The reader's terms the section mentions, spelled as typed, most first. */
  hits: { term: string; count: number }[];
  /** The verbatim sentence of the highest-tier question that has one. */
  evidence?: string;
  /** Paragraph index → the highest tier of a question that mentions it. */
  paragraphs: ReadonlyMap<number, Exclude<TintTier, "none">>;
}

/** The page-only route shape. Tier 0 stays `RouteResult`; this local shape
 * adds the model's display-only `background` tier without widening that data
 * contract or sending model/question data into the shared reading cache. */
export interface DisplayRoute {
  byQuestion: {
    question: string;
    vague: boolean;
    sections: Record<string, Omit<RouteSection, "tier"> & { tier: TintTier }>;
  }[];
  vague: boolean;
}

/** What every route consumer draws from — the contents rail, the map and the
 *  body: Tier 0's `RouteResult`, or `DisplayRoute` once Tier 2's marks are
 *  merged over it (P2-04b, §1g.15: a type-only widening — the three already
 *  handle the `background` tier at runtime — in place of a cast on the page). */
export type DrawRoute = RouteResult | DisplayRoute;

function displaySection(tier: TintTier, evidence?: string): Omit<RouteSection, "tier"> & { tier: TintTier } {
  return { tier, hits: [], paragraphs: [], ...(evidence ? { evidence } : {}) };
}

/** Verified report answers become read marks; background suggestions become
 * background marks. The report itself is never changed and unknown ids are
 * harmless here (the map-consuming component drops them defensively). */
export function questionRouteOverlay(questions: readonly QuestionAnswers[] | undefined): DisplayRoute | undefined {
  if (!questions || questions.length === 0) return undefined;
  return {
    byQuestion: questions.map((entry) => {
      const sections: DisplayRoute["byQuestion"][number]["sections"] = {};
      const place = (id: string | undefined, tier: Exclude<TintTier, "none">, evidence?: string) => {
        if (!id || TIER_RANK[tier] <= TIER_RANK[sections[id]?.tier ?? "none"]) return;
        sections[id] = displaySection(tier, evidence);
      };
      for (const answer of entry.answers) place(answer.sectionId, "read", answer.evidence);
      for (const next of entry.readNext) place(next.sectionId, next.kind === "background" ? "background" : "read");
      return { question: entry.question, vague: false, sections };
    }),
    vague: false,
  };
}

function mergedSections(
  base: Record<string, RouteSection>,
  overlay: DisplayRoute["byQuestion"][number]["sections"],
): DisplayRoute["byQuestion"][number]["sections"] {
  const merged: DisplayRoute["byQuestion"][number]["sections"] = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(overlay)])) {
    const tier0 = base[id];
    const tier2 = overlay[id];
    if (!tier0) {
      merged[id] = tier2;
      continue;
    }
    if (!tier2 || TIER_RANK[tier0.tier] > TIER_RANK[tier2.tier]) {
      merged[id] = { ...tier0 };
      continue;
    }
    // Keep Tier 0's inspectable hits/paragraphs while the verified model
    // answer supplies its read tier and evidence (also on an equal read).
    merged[id] = { ...tier0, tier: tier2.tier, ...(tier2.evidence ? { evidence: tier2.evidence } : {}) };
  }
  return merged;
}

/** One display route for all three consumers. Questions are paired by their
 * reader-owned text, retaining Tier 0's order/titles. P2-08b (§1g.19 c, F6): a
 * model entry whose question matches no live line — the reader has since
 * edited a question the report answered — is dropped, never appended: the live
 * lines are the questions there are, and an orphan would be a phantom "Q3" on
 * the rail, the map and the headings. With no live route there is nothing for
 * a model entry to answer. No model data means the original Tier 0 route
 * object is returned unchanged. */
export function mergeQuestionRoute(base: RouteResult | undefined, overlay: DisplayRoute | undefined): DrawRoute | undefined {
  if (!overlay) return base;
  if (!base) return undefined;
  const answered = new Map(overlay.byQuestion.map((entry) => [entry.question, entry]));
  const byQuestion: DisplayRoute["byQuestion"] = base.byQuestion.map((entry) => {
    const model = answered.get(entry.question);
    if (!model) return { ...entry, sections: { ...entry.sections } };
    return { ...entry, vague: entry.vague && model.vague, sections: mergedSections(entry.sections, model.sections) };
  });
  return { byQuestion, vague: byQuestion.length > 0 && byQuestion.every((entry) => entry.vague) };
}

/** `term` (`tokenize`'s lower-cased token) as the reader typed it in `question`. */
function asTyped(term: string, question: string): string {
  const tokens = question.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/);
  return tokens.find((token) => token.toLowerCase() === term) ?? term;
}

/** A route with somewhere to point: not vague, and asked as questions
 *  (the gist has no question a section could fail to mention). */
export function routeAsksQuestions(route: DrawRoute | undefined): boolean {
  return Boolean(route && !route.vague && route.byQuestion.some((entry) => !entry.vague && entry.question !== GIST_QUESTION));
}

/** The section's mark across every question of the route, or null when no
 *  question marks it (or there is no route, or it is vague). */
export function sectionMark(route: DrawRoute | undefined, sectionId: string): SectionMark | null {
  if (!route || route.vague) return null;
  let tier: Exclude<TintTier, "none"> | null = null;
  let evidence: string | undefined;
  let gist = false;
  const numbers: number[] = [];
  const hits = new Map<string, number>();
  const paragraphs = new Map<number, Exclude<TintTier, "none">>();

  for (const [q, entry] of route.byQuestion.entries()) {
    const section = entry.vague ? undefined : entry.sections[sectionId];
    if (!section || section.tier === "none") continue;
    const at = section.tier;
    numbers.push(q + 1);
    if (entry.question === GIST_QUESTION) gist = true;
    if (tier === null || TIER_RANK[at] > TIER_RANK[tier]) {
      tier = at;
      evidence = section.evidence;
    } else if (at === tier && evidence === undefined) {
      evidence = section.evidence;
    }
    for (const hit of section.hits) {
      const term = asTyped(hit.term, entry.question);
      hits.set(term, Math.max(hits.get(term) ?? 0, hit.count));
    }
    for (const index of section.paragraphs) {
      const was = paragraphs.get(index);
      if (!was || TIER_RANK[at] > TIER_RANK[was]) paragraphs.set(index, at);
    }
  }

  if (tier === null) return null;
  return {
    tier,
    title: gist ? ASK.chips.gist : ROUTE.questions(numbers),
    // Stable: equal counts keep the order the questions gave them.
    hits: [...hits].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count),
    ...(evidence !== undefined ? { evidence } : {}),
    paragraphs,
  };
}

/** `base` with the mark's tint (and `extra`) when there is a mark. */
export function markedClass(base: string, mark: SectionMark | null, extra?: string): string {
  if (!mark) return base;
  return [base, ROUTE_TINT[mark.tier], extra].filter(Boolean).join(" ");
}

// ── The selection (P3-02; ruling §1h.2, user decision §1a.10) ─────────────
//
// A reader selects words of the body and "Explain this?" appears beside
// them. What counts is exactly one paragraph's worth of the paper's own text:
// a selection whose two ends sit in the same paragraph, non-empty, at most
// 1,200 characters, with no drawn formula in it (the text of a formula is not
// the paper's text). Anything else is no target. The body's markup is
// untouched: this reads the DOM's selection and the ids the paragraphs
// already carry (`paragraphAnchor`); nothing is added to what renders.

/** The longest passage a selection may be (characters, whitespace collapsed). */
export const MAX_SELECTION_CHARS = 1200;
/** How long a selection holds still before it is read — a drag is not a selection. */
export const SELECTION_DEBOUNCE_MS = 150;

const PARAGRAPH_ANCHOR = /^paper-section-(\d+)-p(\d+)$/;
/** What a drawn formula leaves in the DOM: KaTeX's markup, or the TeX in `<code>`. */
const FORMULA_SELECTOR = ".katex, .katex-display, code";

/** Where the selection sits in the body, and its words. */
export interface SelectionTarget {
  /** `reading.body[sectionIndex]` and its `paragraphs[paragraphIndex]`. */
  sectionIndex: number;
  paragraphIndex: number;
  passage: string;
}

/** A rectangle in the viewport's coordinates. */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a selection is on screen: `rect`, where it ends (the last line the
 *  words reach — what the button stands under), and `bounds`, the whole of it
 *  (what the card stands clear of). */
export interface ViewRects {
  rect: ViewRect;
  bounds: ViewRect;
}

/** A target with where it is on screen, and how to look again after a scroll. */
export type ExplainSelection = SelectionTarget & ViewRects & { measure?: () => ViewRects | null };

/**
 * A selection is a target when both its ends sit in the same paragraph (the
 * paragraph's id, as `paragraphAnchor` writes it), its text is not empty once
 * the whitespace is collapsed, and it is at most 1,200 characters. Pure.
 */
export function selectionTarget(input: {
  anchorParagraphId: string | null;
  focusParagraphId: string | null;
  text: string;
}): SelectionTarget | null {
  const { anchorParagraphId, focusParagraphId } = input;
  if (!anchorParagraphId || anchorParagraphId !== focusParagraphId) return null;
  const match = PARAGRAPH_ANCHOR.exec(anchorParagraphId);
  if (!match) return null;
  const passage = input.text.replace(/\s+/g, " ").trim();
  if (!passage || passage.length > MAX_SELECTION_CHARS) return null;
  return { sectionIndex: Number(match[1]), paragraphIndex: Number(match[2]), passage };
}

const sameRect = (a: ViewRect, b: ViewRect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/** Whether two selections are the same one, so the page does not re-render for
 *  a selection that has not changed (every `selectionchange` is not a change). */
export function sameSelection(a: ExplainSelection | null, b: ExplainSelection | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sectionIndex === b.sectionIndex &&
    a.paragraphIndex === b.paragraphIndex &&
    a.passage === b.passage &&
    sameRect(a.rect, b.rect) &&
    sameRect(a.bounds, b.bounds)
  );
}

// The few parts of the DOM the reading needs, so a test can stand in for them.
interface ElementLike {
  id: string;
  parentElement: ElementLike | null;
  closest(selector: string): ElementLike | null;
}
interface NodeLike {
  nodeType: number;
  parentElement: ElementLike | null;
}
interface RangeLike {
  startContainer: NodeLike;
  endContainer: NodeLike;
  endOffset: number;
  cloneRange(): RangeLike;
  cloneContents(): { querySelector(selector: string): unknown };
  getClientRects(): ArrayLike<ViewRect>;
  getBoundingClientRect(): ViewRect;
}
export interface SelectionLike {
  rangeCount: number;
  isCollapsed: boolean;
  toString(): string;
  getRangeAt(index: number): RangeLike;
}

/** The id of the paragraph (the element `paragraphAnchor` names) that holds
 *  `node`, when it is inside the paper's body — each holds exactly one `<p>`, so
 *  text in an equation or a caption beside it is in none. */
function paragraphIdOf(node: NodeLike | null): string | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as unknown as ElementLike) : node.parentElement;
  const host = element?.closest("p")?.parentElement ?? null;
  if (!host || host.closest(`#${PAPER_BODY_ID}`) === null) return null;
  return PARAGRAPH_ANCHOR.test(host.id) ? host.id : null;
}

const hasSize = (rect: ViewRect) => rect.right - rect.left > 0 || rect.bottom - rect.top > 0;
const plain = (rect: ViewRect): ViewRect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** Where a range is on screen: its last line with a width — a range that ends
 *  at the start of the next block ends with one that has none — and the box of
 *  all its lines. Null when it has no size at all (off screen). */
function measureRange(range: RangeLike): ViewRects | null {
  const rects = Array.from(range.getClientRects());
  const sized = rects.filter((rect) => rect.right - rect.left > 0);
  const last = sized.length > 0 ? sized[sized.length - 1] : rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!hasSize(last)) return null;
  const lines = sized.length > 0 ? sized : [last];
  const bounds = {
    left: Math.min(...lines.map((rect) => rect.left)),
    top: Math.min(...lines.map((rect) => rect.top)),
    right: Math.max(...lines.map((rect) => rect.right)),
    bottom: Math.max(...lines.map((rect) => rect.bottom)),
  };
  return { rect: plain(last), bounds };
}

/** What the page's selection is, as an `ExplainSelection`, or null: nothing
 *  selected, a selection across paragraphs or outside the body, one with a
 *  formula in it, over-long, or not on screen. */
export function readSelection(selection: SelectionLike | null): ExplainSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  // The selection's own range changes as the selection does; this one is ours.
  const range = selection.getRangeAt(0).cloneRange();
  const text = selection.toString();
  const startId = paragraphIdOf(range.startContainer);
  let endId = paragraphIdOf(range.endContainer);
  // A triple click selects a paragraph, and the browser ends it at offset 0 of
  // the NEXT one: the words are all the first paragraph's. A drag that really
  // runs on into another paragraph carries a break inside its words.
  if (endId !== startId && range.endOffset === 0 && !/\n/.test(text.trim())) endId = startId;
  const target = selectionTarget({ anchorParagraphId: startId, focusParagraphId: endId, text });
  if (!target) return null;
  if (range.cloneContents().querySelector(FORMULA_SELECTOR)) return null;
  const where = measureRange(range);
  if (!where) return null;
  return { ...target, ...where, measure: () => measureRange(range) };
}

/**
 * Report the reader's selection to `onSelect` — after it has held still for
 * `SELECTION_DEBOUNCE_MS` — and `null` whenever there is none. Listens only
 * while there is somewhere to report to. Adds nothing to the page's markup.
 */
function useSelectionListener(onSelect: ((selection: ExplainSelection | null) => void) | undefined): void {
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  }, [onSelect]);
  const listening = onSelect !== undefined;
  useEffect(() => {
    if (!listening) return;
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current?.(readSelection(window.getSelection() as unknown as SelectionLike | null)), SELECTION_DEBOUNCE_MS);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.clearTimeout(timer);
    };
  }, [listening]);
}

/**
 * The paper's figure, where the paper put it.
 *
 * The picture on the plate's mat, the caption under it in the record's mono
 * — the paper's picture, Peer's filing of it. A picture that does not arrive
 * (a PDF figure drawn as vector art has no raster to serve; a publisher's
 * host may refuse the request) leaves the caption standing on its own, with
 * the page it is on where the source was a PDF, so the reader knows what
 * they are not seeing and where it is.
 */
function Figure({ figure }: { figure: ReadingFigure }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(figure.imageUrl) && !failed;
  return (
    <figure className="my-6">
      {showImage && (
        <div className="bg-[var(--plate-mat)] p-3 sm:p-4">
          {/* A plain img: the picture lives on the source's host (or on our
              own figure route), and `next/image` would need every host
              listed in advance. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={figure.imageUrl}
            alt={figure.caption}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"
          />
        </div>
      )}
      <figcaption className="annotation mt-2 leading-[1.6] text-text-faint measure-mono">
        <span className="text-text-muted">{figure.label}</span>
        {figure.caption ? ` \u00b7 ${figure.caption}` : ""}
        {!showImage && typeof figure.page === "number" ? ` \u00b7 p.${figure.page} of the PDF` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * P3-01 (§1h.1): the words a clicked term stands on, marked in place. The
 * paragraph's text is the same text in the same order — it is only cut into
 * three runs, before, the words and after, and the words wrapped in a `<mark>`
 * (a background, never a hue of the route's). `firstOccurrence` never starts
 * or ends a match inside a formula, so each run's formulas stay whole.
 */
function MarkedParagraph({ text, mark }: { text: string; mark: TermOccurrence }) {
  const end = mark.offset + mark.length;
  return (
    <>
      <MathText text={text.slice(0, mark.offset)} />
      <mark className="bg-[color:var(--color-term-mark)] text-heading">
        <MathText text={text.slice(mark.offset, end)} />
      </mark>
      <MathText text={text.slice(end)} />
    </>
  );
}

/** P4-01: a paragraph with its rewrite beside it. From the spread (xl) the anchor is two columns —
 *  the paper's paragraph and Peer's — with the control and whatever the paper set after the
 *  paragraph across both; below it nothing is a grid and the blocks stack, as paragraphs already do.
 *  Each column is about 250px at 1440, too narrow to justify without rivers, so the pair's text is
 *  set ragged-right (the words are the same; only the alignment of a paragraph that shows a rewrite
 *  changes, and only on the spread). */
const SIDE_BY_SIDE = "xl:grid xl:grid-cols-2 xl:gap-x-6 xl:gap-y-4 xl:space-y-0 xl:[&_p]:text-left";

function Section({
  section,
  index,
  mark,
  termMark,
  plain,
}: {
  section: ReadingSection;
  index: number;
  mark: SectionMark | null;
  /** The clicked term's first use, when it is in this section. */
  termMark?: TermOccurrence | null;
  /** P4-01: "Say it plainly" — absent without a model, and the section is then what it was. */
  plain?: PlainView;
}) {
  const figures = section.figures ?? [];
  const equations = section.equations ?? [];
  // What follows paragraph `i` (-1: what opens the section): the equations
  // the paper set there, then the figures it named there.
  const following = (i: number) => (
    <>
      {equations
        .filter((e) => e.after === i)
        .map((e, k) => (
          <Equation key={`eq:${i}:${k}`} equation={e} />
        ))}
      {figures
        .filter((f) => f.after === i)
        .map((f) => (
          <Figure key={`${f.label}:${f.ordinal}`} figure={f} />
        ))}
    </>
  );
  /** Whether the paper set an equation or a figure right after paragraph `i`. */
  const hasFollowing = (i: number) => equations.some((e) => e.after === i) || figures.some((f) => f.after === i);
  return (
    <section id={sectionAnchor(index)} className="mt-8 scroll-mt-20 first:mt-6">
      {/* P1-05: the route marks the heading — an attribute and a tint,
          nothing else — and never the paragraphs under it. */}
      <h3
        data-route={mark?.tier}
        className={markedClass("font-reading font-medium text-heading text-title leading-[1.3] mb-2", mark, HEADING_MARK)}
      >
        <MathText text={section.heading} />
      </h3>
      <div className="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify">
        {following(-1)}
        {section.paragraphs.map((paragraph, i) => {
          // P3-01: the clicked term's first use, when it is here and still
          // inside the paragraph (a stale mark draws nothing).
          const here =
            termMark && termMark.paragraphIndex === i && termMark.length > 0 && termMark.offset + termMark.length <= paragraph.length
              ? termMark
              : null;
          // P4-01: the rewrite beside this paragraph, when the reader asked for it; the control
          // under it where the route marks it read — and under a paragraph that shows a rewrite
          // whatever the route says now, so there is always a way to take it back.
          const rewrite = plain?.shown.get(paragraphKey(section.id, i));
          const offered = plain !== undefined && (rewrite !== undefined || plainOffered(mark, i));
          return (
            <div
              key={i}
              id={paragraphAnchor(index, i)}
              {...(here ? { "data-term-mark": "" } : {})}
              className={rewrite !== undefined ? `space-y-4 scroll-mt-20 ${SIDE_BY_SIDE}` : "space-y-4 scroll-mt-20"}
            >
              <p>{here ? <MarkedParagraph text={paragraph} mark={here} /> : <MathText text={paragraph} />}</p>
              {rewrite !== undefined && <PlainRewrite text={rewrite} />}
              {offered && plain && (
                <ParagraphPlainControl
                  view={plain}
                  target={{ sectionId: section.id, sectionIndex: index, paragraphIndex: i, text: paragraph }}
                  wide={rewrite !== undefined}
                />
              )}
              {rewrite !== undefined && hasFollowing(i) ? <div className="space-y-4 xl:col-span-2">{following(i)}</div> : following(i)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The anchor the decision block's "read it here" scrolls to. */
export const PAPER_BODY_ID = "paper-body";

/**
 * P3-02b (§1h.3): where the text column's right edge is in the viewport now —
 * `#paper-body`'s bounding box, measured the way the selection is (a fresh
 * read each time it is asked, so a scroll or a resize is never stale). Null
 * when the body is not on the page. The "Explain this?" box stands to its right
 * on a spread.
 */
export function measureBodyColumn(): { right: number } | null {
  if (typeof document === "undefined") return null;
  const rect = document.getElementById(PAPER_BODY_ID)?.getBoundingClientRect();
  return rect ? { right: rect.right } : null;
}

export function PaperBody({
  reading,
  route,
  termMark,
  plain,
  onSelect,
}: {
  reading: PaperReading;
  route?: DrawRoute;
  /** P3-01 (§1h.1): where the term the reader clicked first stands in the body. */
  termMark?: TermOccurrence | null;
  /** P4-01 (blueprint §3.6; §1h.12 (h)): "Say it plainly" — the control under each paragraph the
   *  route marks read and the rewrites beside the paragraphs that show one. Absent for a reader
   *  with no model, and the body is then exactly the body it was. */
  plain?: PlainView;
  /** P3-02 (§1h.2): told, once it holds still, what the reader has selected in
   *  the body — a target within one paragraph — or `null` for no such selection. */
  onSelect?: (selection: ExplainSelection | null) => void;
}) {
  useSelectionListener(onSelect);
  // `?? []`: the version gate above should mean this is always an array, and
  // a missing optional block is still not worth taking the page down for.
  const body = reading.body ?? [];
  if (body.length === 0) return null;

  const words = countWords(body);

  return (
    // `scroll-mt`: the masthead is sticky, and a heading scrolled to the
    // very top of the window lands under it.
    <div id={PAPER_BODY_ID} className="scroll-mt-20">
    <Band label={BODY.heading}>
      {/* The contents: the sections Peer reached, in the paper's own order.
          It doubles as the statement of what it did not reach — a paper whose
          extractor found four headings says so here and nowhere else. */}
      <p className="annotation text-text-faint mt-4 measure-mono xl:hidden">
        {body.map((section) => section.heading).join(" · ")}
      </p>
      <p className="annotation text-text-faint mt-1.5">
        {BODY.provenance(reading.provenance.sourceLabel, body.length, words)}
      </p>

      {body.map((section, i) => (
        <Section
          key={`${section.canonical}:${section.heading}`}
          section={section}
          index={i}
          mark={sectionMark(route, section.id)}
          termMark={termMark?.sectionId === section.id ? termMark : null}
          plain={plain}
        />
      ))}
    </Band>
    </div>
  );
}
