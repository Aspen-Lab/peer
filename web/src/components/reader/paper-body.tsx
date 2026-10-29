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
// blocks, and then — if you are still here — the paper. (P7-14: on a paper
// Peer has read in full the page has two tabs, and the body is the second,
// "Paper digestion", under the map, which is the section list and the honest
// statement of how much of the paper Peer reached.)
//
// The paper's own words, so: the reading serif, at the long measure. The headings
// are the paper's too, so they are serif as well — the mono on this page is
// Peer's voice, and none of this is Peer's.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { PaperReading, ReadingFigure, ReadingSection } from "@/lib/papers/reading";
import { GIST_QUESTION, MAX_STRONG_ROWS, type RouteResult, type RouteSection, type RouteTier } from "@/lib/papers/reading-map";
import { isPlaceholderHeading } from "@/lib/papers/reading-roles";
import type { QuestionAnswers } from "@/lib/papers/report";
import { Equation, MathText } from "./math";
import { Band } from "@/components/ui/band";
import { openFigure, useFigureOpen } from "@/lib/reader/figure-viewer";
import { paragraphKey } from "@/store/plain-rewrites";
import { repairAnchors, resolveAnchors, useLostPassages } from "@/store/notes";
import { captionBlock, captionText, headingBlock, setBodyOnShow } from "@/lib/notes/anchor-blocks";
import { ASK, BODY, ROUTE } from "./copy";
import { ParagraphPlainControl, PlainRewrite, plainOffered, type PlainView } from "./plain-button";
import { NoteTag, highlightMarks, isHighlightSpot, passageSegments, rangeOf, tieOrder, type AnchorSpot } from "@/components/notes/note-tags";
import type { NoteAnchorMap } from "@/lib/notes/blocks";
import { highlightPaint } from "@/lib/notes/highlight-colours";
import type { HighlightColourId } from "@/lib/notes/types";
import { drawableSegments, type DrawableSegment, type ExplainSegment } from "@/lib/notes/selection-segments";
import type { ExplainRange } from "@/lib/papers/explain-range";
import type { ExplainIdentity } from "@/lib/reader/explain-range";
import { domTextEnv } from "@/components/notes/block-marks";

/** Each section is a destination: the map's rows jump here, and `scroll-mt`
 *  keeps the heading clear of the sticky masthead. */
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
// tint behind its row in the map, its heading here and its paragraph lines in
// the map (the contents rail that used to carry a third is gone, P7-14 R5).
// The mark is an attribute and a background — the paper itself is
// never hidden, collapsed, greyed, reordered or wrapped, whatever the route
// says (blueprint §2 boundary 3). The tables live here, beside the anchors,
// because the map already reads those from this file.

/** A route tier as the page draws it; `background` is Tier 2's (P2). */
export type TintTier = RouteTier | "background";

/** Tier → tint: a background from the route's own tokens (`globals.css`),
 *  never a text colour; `none` draws nothing. */
export const ROUTE_TINT: Readonly<Record<TintTier, string | null>> = {
  strong: "bg-[color:var(--color-route-strong)]",
  medium: "bg-[color:var(--color-route-medium)]",
  background: "bg-[color:var(--color-route-background)]",
  faint: "bg-[color:var(--color-route-faint)]",
  none: null,
};

/** What a marked heading adds besides its tint: the tint hugs the words,
 *  and they stay where they were. */
export const HEADING_MARK = "w-fit -mx-1 px-1";

const TIER_RANK: Readonly<Record<TintTier, number>> = { none: 0, faint: 1, background: 2, medium: 3, strong: 4 };

export interface SectionMark {
  /** The highest tier any question gives the section. */
  tier: Exclude<TintTier, "none">;
  /** The `title`: the questions that mark it ("Q1, Q3"), or the gist. */
  title: string;
  /** The reader's terms the section mentions, spelled as typed, most first. */
  hits: { term: string; count: number }[];
  /** The verbatim sentence of the highest-tier question that has one. */
  evidence?: string;
  /** Paragraph index → the highest tier of a question that mentions it: the section's own for the paragraphs that
   *  say most in it, `faint` for the others (P10-06). */
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

/** What every route consumer draws from — the map and the body: Tier 0's `RouteResult`, or `DisplayRoute` once Tier 2's marks are
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
      for (const answer of entry.answers) place(answer.sectionId, "strong", answer.evidence);
      for (const next of entry.readNext) place(next.sectionId, next.kind === "background" ? "background" : "strong");
      return { question: entry.question, vague: false, sections: withStrongCap(sections, []) };
    }),
    vague: false,
  };
}

/**
 * P10-06b (rule 6): the strongest tier is worn by three rows at most, as in the Tier 0 route — a model that verifies
 * five sections still shows three strongest rows, the others medium. `first` are the ids that keep it first (the
 * verified answers of the model, over Tier 0's own strong rows); then the rows in the order they stand. Only the
 * tier changes: a demoted row keeps its hits, paragraphs and evidence. The sections come back unchanged (the same
 * object) when no row is over the cap.
 *
 * P10-06d (rule 3): the cap counts leaf rows, as the route's does. A group row (`group`, which the route sets on a section with
 * no paragraphs of its own and subsections under it) wears its child's tier and takes no slot: it is skipped here and keeps
 * the tier the merge gave it. A row without the mark (the model's own rows) counts.
 */
function withStrongCap<T extends { tier: TintTier; group?: boolean }>(sections: Record<string, T>, first: readonly string[]): Record<string, T> {
  const strong = Object.keys(sections).filter((id) => sections[id].tier === "strong" && !sections[id].group);
  if (strong.length <= MAX_STRONG_ROWS) return sections;
  const order = [...first.filter((id) => strong.includes(id)), ...strong.filter((id) => !first.includes(id))];
  const capped = { ...sections };
  for (const id of order.slice(MAX_STRONG_ROWS)) capped[id] = { ...capped[id], tier: "medium" };
  return capped;
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
  // P10-06b (rule 6): the model's strongest rows and Tier 0's together are three at most, the model's first.
  return withStrongCap(
    merged,
    Object.keys(overlay).filter((id) => overlay[id].tier === "strong"),
  );
}

/** One display route for both consumers (the map and the body; the contents rail was a
 * third until P7-14). Questions are paired by their reader-owned text, retaining Tier 0's order/titles. P2-08b (§1g.19 c, F6): a
 * model entry whose question matches no live line — the reader has since
 * edited a question the report answered — is dropped, never appended: the live
 * lines are the questions there are, and an orphan would be a phantom "Q3" on
 * the map and the headings. With no live route there is nothing for
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
      // P10-06 (rule 3): the paragraphs that say most in the section carry its tier, the others that mention
      // a term a faint one. A section with no such list (a hand-built route, a model's mark) tints them all alike.
      const here = at === "background" || !section.topParagraphs || section.topParagraphs.includes(index) ? at : "faint";
      const was = paragraphs.get(index);
      if (!was || TIER_RANK[here] > TIER_RANK[was]) paragraphs.set(index, here);
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
// A reader selects words and the selection buttons offer "Explain this". What counts is one container's worth of text: a selection whose
// two ends sit in the same paragraph of the paper's body, or (P10-08, review 8.4: "不仅仅是正文，甚至可以是summary或者for your question里的
// answer，但是不包括最左边的各种功能button") in one element the page marks `data-explain-source` — the Summary's blocks (`"summary"`) and the answers
// under the question (`"answer"`) — non-empty, of any length (P11-47, below), with no drawn formula in it (the text of a formula is not the paper's
// text), and never with an end inside a control (a button, a link, a field). The commands at the left, the map, the question bar and the
// notes are in no marked container, so they are no target. Anything else is no target. The body's markup is untouched: this reads the DOM's
// selection and the ids the paragraphs already carry (`paragraphAnchor`) and the attribute the page puts on a container; nothing is added
// to what renders here.
//
// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): a figure's caption and a section's heading are targets too — each its own container, with
// an anchor of its own in the shape of a paragraph's (`paper-section-<k>-p<n>`; n counts the section's paragraphs, then its heading, then its captions:
// `lib/notes/anchor-blocks.ts`). The heading carries its id and the marker `data-anchor-block="heading"`; the figure carries its id and `data-anchor-block="caption"`,
// and the words of the caption are its `figcaption`'s (the picture's button is no part of them). The target says which it is (`block`); a selection across two
// containers is still no target.
//
// P11-47 (round 3's Theme B walk, weighed (f); owner items 5 and 8; ruling §1h.148 rule 1): the selection has no length limit of its own. It was 1,200 characters — the Explain
// route's passage cap — and a triple click on a paragraph of 1,300 to 3,000 characters offered nothing, not Highlight and not Take notes: 10 of 13 paragraphs of the owner's paper.
// A selection inside one block — a paragraph, a caption, a heading, a Summary block, an answer — is a target whatever its length: a highlight keeps all its words
// (`lib/notes/blocks.ts`), a sticky is anchored over all of them, and Explain this explains the first 1,200 characters (`explain-box.tsx`, `explainPassage`;
// `MAX_SELECTION_CHARS` is that cap now). A selection across two blocks is still no target (D5): across two paragraphs by `samePlace`; across two blocks of one Summary
// or answer container — one container's worth, as ever — only up to that cap, so a longer one must stay in one block (`oneBlock`).

/**
 * The longest passage the Explain request carries (characters, whitespace collapsed): the route's own cap (`EXPLAIN_CAPS.passageChars`). P11-47 (ruling §1h.148): it is
 * no limit on a selection any more — Highlight and Take notes take any length inside one block, and Explain this clips at this. It is still the length up to which a
 * selection across two blocks of one Summary or answer container is a target, as it always was (`selectionTarget`'s `oneBlock`).
 */
export const MAX_SELECTION_CHARS = 1200;
/**
 * How long a selection holds still before it is read — for a selection made
 * without a press of the primary pointer (shift + arrows, touch handles, a
 * script). A selection made by a drag with the mouse or a pen is read when the
 * button comes up, however long the reader holds still before that (P9-18).
 */
export const SELECTION_DEBOUNCE_MS = 150;

const PARAGRAPH_ANCHOR = /^paper-section-(\d+)-p(\d+)$/;
/** What a drawn formula leaves in the DOM: KaTeX's markup, or the TeX in `<code>`. */
const FORMULA_SELECTOR = ".katex, .katex-display, code";

/** P10-08 (review 8.4): where a selection is from — the paper's body (as before), a block of the Summary, or an answer under the question. */
export type ExplainSource = "paper" | "summary" | "answer";

/** Where the selection sits in the body, and its words. */
export interface SelectionTarget {
  /** Ordered actual ranges. Legacy/synthetic single-block callers may omit these. */
  segments?: DrawableSegment[];
  /** Canonical Explain boundaries, separate from persisted raw highlight offsets. Ephemeral only. */
  explainSegments?: ExplainSegment[];
  range?: ExplainRange;
  explainIdentity?: ExplainIdentity;
  /** Explain-only refusal: other drawable actions remain applicable. */
  explainUnavailableReason?: string;
  unavailableReason?: string;
  /** Captured DOM provenance still holds at the action press. Never stored or sent. */
  selectionStillHolds?: () => boolean;
  /** `reading.body[sectionIndex]` and its `paragraphs[paragraphIndex]`; −1 for a selection that is not the paper's (below). */
  sectionIndex: number;
  paragraphIndex: number;
  passage: string;
  /** P10-08: where it is from; absent is the paper's body, which is all there was. */
  source?: ExplainSource;
  /** P10-08: the container's own stable id — the paragraph's anchor for the paper, the block's key or the answer's index otherwise. */
  paragraphId?: string;
  /**
   * P11-09 (B P11-04 §2.8, I10): the length of the paragraph's words before the selection's start, a tag's text left out — a
   * hint for telling the occurrence the reader selected from an earlier one of the same words ("tide pools", twice). The
   * paper's body only, and only when the range could give it: a hint, never required (a formula's rendered text is not the
   * paragraph's raw text, so it is the nearest occurrence that wins, not an exact one).
   */
  offset?: number;
  /** P11-27 (rule 2): the selection is in a section's heading or a figure's caption (its anchor's `n` is the heading's block or a caption's); absent for a paragraph's. */
  block?: "heading" | "caption";
}

/** A rectangle in the viewport's coordinates. */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a selection is on screen: `rect`, where it ends (the last line the
 *  words reach — what the floating button stands under where it has no gutter), and `bounds`, the
 *  whole of it (what the card stands clear of; its top is the selection's FIRST line, which the
 *  floating button in the gutter stands level with, P9-03b; and the dock's level where no
 *  paragraph is reported). `paragraph` (P8-02) is the box of the paragraph's own `<p>`: its top
 *  is the paragraph's first line, which the explain window stands level with — the selected
 *  paragraph's, P9-03b. Absent only where the element cannot give a box (the selection is still read). */
export interface ViewRects {
  rect: ViewRect;
  bounds: ViewRect;
  paragraph?: ViewRect;
}

/**
 * A target with where it is on screen, and how to look again after a scroll.
 *
 * `spansBlocks` (P11-50; ruling §1h.155 rule 1) is set, and only ever to `true`, when the selection's two ends are in two blocks of the one Summary or answer container
 * (`readSelection`'s `oneBlock: false`): it is a target, and Explain this and Take notes work on it, but a highlight is one block's words (D5) and there is nothing to mark
 * across two. `canHighlight` is the one reader of it: Highlight is offered only where it makes a mark. Absent for every other selection.
 */
export type ExplainSelection = SelectionTarget & ViewRects & { measure?: () => ViewRects | null; spansBlocks?: true };

/**
 * A selection is a target when both its ends sit in the same paragraph (the
 * paragraph's id, as `paragraphAnchor` writes it) and its text is not empty once
 * the whitespace is collapsed. P11-47 (ruling §1h.148 rule 1): whatever its length — it was
 * at most 1,200 characters. With `oneBlock: false` (a Summary or answer selection whose two ends are in two blocks of the one container) the old cap stays: such a
 * selection is a target only up to `MAX_SELECTION_CHARS`, so a long one across two blocks is none (D5). Pure.
 */
export function selectionTarget(input: {
  anchorParagraphId: string | null;
  focusParagraphId: string | null;
  text: string;
  /** P10-08: where the selection is from; the paper's body when absent. For the Summary or an answer the ids are the container's own. */
  source?: ExplainSource;
  /** P11-47: both ends are in one block (the default). False for a Summary or answer selection that runs from one block into another: it is a target up to `MAX_SELECTION_CHARS` only. */
  oneBlock?: boolean;
}): SelectionTarget | null {
  const { anchorParagraphId, focusParagraphId } = input;
  if (!anchorParagraphId || anchorParagraphId !== focusParagraphId) return null;
  const passage = input.text.replace(/\s+/g, " ").trim();
  if (!passage) return null;
  if (input.oneBlock === false && passage.length > MAX_SELECTION_CHARS) return null;
  const source = input.source ?? "paper";
  // Not the paper's: there is no section and no paragraph of the body to name; the container's own id keys it.
  if (source !== "paper") return { sectionIndex: -1, paragraphIndex: -1, passage, source, paragraphId: anchorParagraphId };
  const match = PARAGRAPH_ANCHOR.exec(anchorParagraphId);
  if (!match) return null;
  return { sectionIndex: Number(match[1]), paragraphIndex: Number(match[2]), passage, source: "paper", paragraphId: anchorParagraphId };
}

const sameRect = (a: ViewRect, b: ViewRect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
const sameOptionalRect = (a: ViewRect | undefined, b: ViewRect | undefined) => (a === undefined || b === undefined ? a === b : sameRect(a, b));

/** Whether two selections are the same one, so the page does not re-render for
 *  a selection that has not changed (every `selectionchange` is not a change). */
export function sameSelection(a: ExplainSelection | null, b: ExplainSelection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.selectionStillHolds && !a.selectionStillHolds()) return false;
  return (
    a.sectionIndex === b.sectionIndex &&
    a.paragraphIndex === b.paragraphIndex &&
    a.passage === b.passage &&
    (a.source ?? "paper") === (b.source ?? "paper") &&
    a.paragraphId === b.paragraphId &&
    a.block === b.block &&
    a.offset === b.offset &&
    JSON.stringify(a.segments) === JSON.stringify(b.segments) &&
    JSON.stringify(a.explainSegments) === JSON.stringify(b.explainSegments) &&
    JSON.stringify(a.range) === JSON.stringify(b.range) &&
    a.explainUnavailableReason === b.explainUnavailableReason &&
    a.unavailableReason === b.unavailableReason &&
    sameRect(a.rect, b.rect) &&
    sameRect(a.bounds, b.bounds) &&
    sameOptionalRect(a.paragraph, b.paragraph)
  );
}

// The few parts of the DOM the reading needs, so a test can stand in for them.
interface ElementLike {
  id: string;
  parentElement: ElementLike | null;
  /** P11-56: the block's children, so a range can be ended at the block's end (`ownContents`); absent from a stand-in that has none. */
  childNodes?: ArrayLike<unknown>;
  closest(selector: string): ElementLike | null;
  getBoundingClientRect?(): ViewRect;
  getAttribute?(name: string): string | null;
}
interface NodeLike {
  nodeType: number;
  parentElement: ElementLike | null;
}
/** A node of the range's cloned contents, as far as the words of a paragraph are read from it (P10-24). */
interface ChildLike {
  nodeType: number;
  nodeName: string;
  data?: string;
  childNodes?: ArrayLike<ChildLike>;
}
interface RangeLike {
  startContainer: NodeLike;
  endContainer: NodeLike;
  /** P11-09: where the range starts in `startContainer`; with the three members below, what the offset hint is read with (all optional: a hint, never required). */
  startOffset?: number;
  endOffset: number;
  cloneRange(): RangeLike;
  selectNodeContents?(node: unknown): void;
  setEnd?(node: unknown, offset: number): void;
  toString?(): string;
  cloneContents(): { querySelector(selector: string): unknown; childNodes?: ArrayLike<ChildLike> };
  getClientRects(): ArrayLike<ViewRect>;
  getBoundingClientRect(): ViewRect;
}
export interface SelectionLike {
  rangeCount: number;
  isCollapsed: boolean;
  toString(): string;
  getRangeAt(index: number): RangeLike;
}

/** The paragraph (the element `paragraphAnchor` names) that holds `node`, when it is inside the
 *  paper's body — each holds exactly one `<p>`, so text in an equation or a caption beside it is in
 *  none — with its id and that `<p>`, whose box is the paragraph's (P8-02). */
function paragraphOf(node: NodeLike | null): { id: string; text: ElementLike } | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as unknown as ElementLike) : node.parentElement;
  const text = element?.closest("p") ?? null;
  const host = text?.parentElement ?? null;
  if (!text || !host || host.closest(`#${PAPER_BODY_ID}`) === null) return null;
  return PARAGRAPH_ANCHOR.test(host.id) ? { id: host.id, text } : null;
}

/** P11-27: the attribute a heading and a figure carry (`"heading"`, `"caption"`) beside their anchor id, and the elements whose words are the block's: the heading
 *  itself, and the figure's `figcaption` (the figure's picture is no part of the caption). */
export const ANCHOR_BLOCK_ATTRIBUTE = "data-anchor-block";
export const ANCHOR_BLOCK_TEXT_SELECTOR = `[${ANCHOR_BLOCK_ATTRIBUTE}="heading"], figcaption`;

/** The heading or the caption (the element that carries its anchor id and `data-anchor-block`) that holds `node`, inside the paper's body, with its text element. */
function blockOf(node: NodeLike | null): { id: string; text: ElementLike; block: "heading" | "caption" } | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as unknown as ElementLike) : node.parentElement;
  const text = element?.closest(ANCHOR_BLOCK_TEXT_SELECTOR) ?? null;
  if (!text) return null;
  const host = text.getAttribute?.(ANCHOR_BLOCK_ATTRIBUTE) ? text : text.parentElement;
  const kind = host?.getAttribute?.(ANCHOR_BLOCK_ATTRIBUTE);
  if (!host || (kind !== "heading" && kind !== "caption") || host.closest(`#${PAPER_BODY_ID}`) === null) return null;
  return PARAGRAPH_ANCHOR.test(host.id) ? { id: host.id, text, block: kind } : null;
}

/** The attribute the page puts on a container whose text may be explained, and the values it takes besides the body's own paragraphs. */
export const EXPLAIN_SOURCE_ATTRIBUTE = "data-explain-source";
const EXPLAIN_SOURCE_SELECTOR = `[${EXPLAIN_SOURCE_ATTRIBUTE}]`;
/** What is a control, wherever it sits: a selection with an end inside one is no target. */
const CONTROL_SELECTOR = "button, a, input, textarea, select, summary, label, [role='button'], [role='tab'], [role='link'], [contenteditable='true'], [data-explain-skip]";

/** Where one end of a selection is, for the rule that both ends share a place. */
interface Place {
  source: ExplainSource;
  /** The element the two ends must share: the paragraph's anchor in the body, else the marked container. */
  container: unknown;
  /** The target's own stable id: the paragraph's anchor; else the block's `data-explain-id` or `id`, else the container's, else its kind. */
  id: string;
  /** The paper's `<p>`, whose box is the paragraph's (P8-02); none for the Summary and the answers. P11-27: a heading's or a caption's own element. */
  text?: ElementLike;
  /** P11-27: the container is a heading or a caption of the paper's body. */
  block?: "heading" | "caption";
}

/**
 * P10-08 (review 8.4): where `node` sits — a paragraph of the paper's body (as before), or a block inside an element marked
 * `data-explain-source="summary"` or `"answer"` (the page marks them). Null for everything else, and for a node inside a control.
 */
function placeOf(node: NodeLike | null): Place | null {
  if (!node) return null;
  const paper = paragraphOf(node);
  if (paper) return { source: "paper", container: paper.id, id: paper.id, text: paper.text };
  const anchored = blockOf(node);
  if (anchored) return { source: "paper", container: anchored.id, id: anchored.id, text: anchored.text, block: anchored.block };
  const element = node.nodeType === 1 ? (node as unknown as ElementLike) : node.parentElement;
  const container = element?.closest(EXPLAIN_SOURCE_SELECTOR) ?? null;
  const kind = container?.getAttribute?.(EXPLAIN_SOURCE_ATTRIBUTE);
  if (!element || !container || (kind !== "summary" && kind !== "answer")) return null;
  if (element.closest(CONTROL_SELECTOR) !== null) return null;
  let block: ElementLike = element;
  while (block.parentElement && block.parentElement !== container) block = block.parentElement;
  const id = block.getAttribute?.("data-explain-id") || block.id || container.getAttribute?.("data-explain-id") || container.id || kind;
  return { source: kind, container, id };
}

/** Whether two ends share a place: the same paragraph of the body (by its id), else the same marked container. */
const samePlace = (a: Place | null, b: Place | null): a is Place => a !== null && b !== null && a.source === b.source && a.container === b.container;

const hasSize = (rect: ViewRect) => rect.right - rect.left > 0 || rect.bottom - rect.top > 0;
const plain = (rect: ViewRect): ViewRect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });

/** Where a range is on screen: its last line with a width — a range that ends
 *  at the start of the next block ends with one that has none — and the box of
 *  all its lines. Null when it has no size at all (off screen). With the paragraph's `<p>`
 *  (P8-02), also its box, read again each time. */
function measureRange(range: RangeLike, paragraph?: ElementLike): ViewRects | null {
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
  const box = paragraph?.getBoundingClientRect?.();
  return { rect: plain(last), bounds, ...(box && hasSize(box) ? { paragraph: plain(box) } : {}) };
}

/**
 * P10-24 (X-B2′, BACKLOG-87): the words a range holds when it holds a note's tag. The tag (`NoteTag`) is a `<sup>` — a word
 * joiner and the button "[n]" — inside the paragraph's `<p>`, and a browser's `selection.toString()` reads it as text in the
 * middle of the words it runs across. The paragraph's own words are the range's text nodes outside every `<sup>` (the
 * paper's text has none of its own: a formula is a drawn `.katex`, which the reading refuses). Null when the range holds
 * no tag, or its contents cannot be walked: `toString()` is then the words, as it always was.
 */
function wordsWithoutTags(contents: { childNodes?: ArrayLike<ChildLike> }): string | null {
  if (!contents.childNodes) return null;
  let skipped = false;
  const read = (nodes: ArrayLike<ChildLike>): string => {
    let words = "";
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.nodeType === 3) words += node.data ?? "";
      else if (node.nodeName === "SUP") skipped = true;
      else if (node.childNodes) words += read(node.childNodes);
    }
    return words;
  };
  const words = read(contents.childNodes);
  return skipped ? words : null;
}

/**
 * P11-09 (B P11-04 §2.8, I10): the length of the paragraph's words before the range's start — a range from the start of the
 * paragraph's `<p>` to the selection's start, read the way the passage is (a note's tag left out, `wordsWithoutTags`). Undefined
 * when the range cannot give it (a member it needs is missing, or it throws): the offset is a hint and the selection goes on without.
 */
function wordsBefore(range: RangeLike, paragraph: ElementLike | undefined): number | undefined {
  if (!paragraph || typeof range.startOffset !== "number") return undefined;
  try {
    const head = range.cloneRange();
    if (!head.selectNodeContents || !head.setEnd) return undefined;
    head.selectNodeContents(paragraph);
    head.setEnd(range.startContainer, range.startOffset);
    const words = wordsWithoutTags(head.cloneContents()) ?? head.toString?.();
    return typeof words === "string" ? words.length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * P11-56 (round 4, Theme B walk E-2; ruling §1h.165 rule 1): the contents of a range that the browser ended at the start of the NEXT block (a triple click), read as its own block's — the range from
 * its start to the end of the `block` that start is in. `range.cloneContents()` carries the range's words and also a clone of every ancestor its end sits in, empty (the end is at offset 0: none of
 * the next block's words are in it). A displayed equation's `code` (a PDF's line as printed) and its `.katex` (a paper drawn from HTML) are such ancestors, and the formula rule (`FORMULA_SELECTOR`)
 * read the paragraph before an equation as a selection with a formula in it: it was offered nothing. The block's own part holds the paragraph's words and any formula drawn in it, and nothing
 * of what comes next, whatever that is. Null where it cannot be had (the block cannot say how long it is, the range cannot move its end, or it throws): the range's own contents, as they were.
 */
function ownContents(range: RangeLike, block: ElementLike | undefined): ReturnType<RangeLike["cloneContents"]> | null {
  if (!block?.childNodes) return null;
  try {
    const own = range.cloneRange();
    if (!own.setEnd) return null;
    own.setEnd(block, block.childNodes.length);
    return own.cloneContents();
  } catch {
    return null;
  }
}

/** What the page's selection is, as an `ExplainSelection`, or null: nothing
 *  selected, a selection across paragraphs or outside the body, one with a
 *  formula in it, one over 1,200 characters across two blocks of a Summary or an
 *  answer (P11-47), or not on screen. A selection of up to 1,200 characters across
 *  two blocks of a Summary or an answer is a target that says so (`spansBlocks`,
 *  P11-50): it is not offered Highlight. A triple click on a paragraph is the paragraph's
 *  whatever the browser ends it at the start of — a paragraph, a heading, a caption, a
 *  displayed equation, a figure, a rule (P11-56). */
export function readSelection(selection: SelectionLike | null): ExplainSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  // The selection's own range changes as the selection does; this one is ours.
  const range = selection.getRangeAt(0).cloneRange();
  // Real ranges expose their document and comparison API. Keep the single-block
  // compatibility reader below for older minimal callers without DOM provenance.
  const real = range as unknown as Range;
  if (typeof real.comparePoint === "function" && real.startContainer.ownerDocument) {
    const result = drawableSegments(real, domTextEnv());
    const where = measureRange(range);
    if (!where) return null;
    if (result.reason) {
      const start = placeOf(range.startContainer);
      if (!start) return null;
      return { sectionIndex: -1, paragraphIndex: -1, passage: selection.toString().replace(/\s+/g, " ").trim(), source: start.source, paragraphId: start.id,
        unavailableReason: result.reason, ...where, measure: () => real.startContainer.isConnected ? measureRange(range) : null };
    }
    const first = result.segments[0];
    const at = PARAGRAPH_ANCHOR.exec(first.paragraphId);
    return { sectionIndex: at ? Number(at[1]) : -1, paragraphIndex: at ? Number(at[2]) : -1, paragraphId: first.paragraphId, source: first.source,
      passage: result.segments.map((s) => s.quote).join("\n\n"), offset: first.start, ...(first.kind === "heading" || first.kind === "caption" ? { block: first.kind } : {}), segments: result.segments, explainSegments: result.explainSegments,
      ...where, selectionStillHolds: () => {
        const now = drawableSegments(real, domTextEnv());
        return !now.reason && now.provenance?.length === result.provenance?.length && now.provenance?.every((node, i) => node.isConnected && node === result.provenance?.[i]) === true
          && JSON.stringify(now.segments) === JSON.stringify(result.segments) && JSON.stringify(now.explainSegments) === JSON.stringify(result.explainSegments);
      }, measure: () => real.startContainer.isConnected && real.endContainer.isConnected ? measureRange(range) : null };
  }
  const spoken = selection.toString();
  const start = placeOf(range.startContainer);
  let end = placeOf(range.endContainer);
  // A triple click selects a paragraph, and the browser ends it at offset 0 of
  // the NEXT block — a paragraph, a heading, a caption, a displayed equation's
  // `code`, a figure, a rule: the words are all the first paragraph's. A drag that
  // really runs on into another paragraph carries a break inside its words.
  const endsAtNextStart = range.endOffset === 0 && !/\n/.test(spoken.trim());
  let rolledBack = false;
  if (!samePlace(start, end) && endsAtNextStart) {
    end = start;
    rolledBack = true;
  }
  if (!samePlace(start, end)) return null;
  // P11-56: a selection rolled back to its own block holds that block's contents, not a clone of the next block's empty ancestors (an equation's `code`, its `.katex`) as well.
  const contents = (rolledBack ? ownContents(range, start.text) : null) ?? range.cloneContents();
  // P10-24: the passage is the paragraph's words, never a note tag's text (a break the selection carries was read from `spoken`).
  const text = wordsWithoutTags(contents) ?? spoken;
  // The two ends share a place (a paragraph, or one marked container whose blocks may differ): the start's id names the target.
  // P11-47: both ends in one block. A Summary or answer container is one place whatever its blocks, so a triple click on a block of it, which the browser ends at the start of the
  // next block (above), has its end in that next block: its words are the first block's all the same.
  const oneBlock = endsAtNextStart || start.id === end?.id;
  const target = selectionTarget({ anchorParagraphId: start.id, focusParagraphId: start.id, text, source: start.source, oneBlock });
  if (!target) return null;
  if (contents.querySelector(FORMULA_SELECTOR)) return null;
  const where = measureRange(range, start?.text);
  if (!where) return null;
  // P11-09: where in its paragraph the passage starts, for the paper's body (the Summary and the answers have no paragraph to anchor to).
  const offset = start.source === "paper" ? wordsBefore(range, start.text) : undefined;
  // P11-50 (ruling §1h.155 rule 1): across two blocks of the one container it is still a target (Explain this and Take notes), but a highlight is one block's words: say so, and only then.
  return {
    ...target,
    ...(start.block ? { block: start.block } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(oneBlock ? {} : { spansBlocks: true as const }),
    ...where,
    measure: () => measureRange(range, start?.text),
  };
}

// ── A click on a highlight (P11-09; B P11-04 §3.3) ────────────────────────

/** The few members of an element the click's reading needs, so a test can stand in for them. */
interface HitElement {
  nodeType: number;
  parentElement: HitElement | null;
  closest?(selector: string): HitElement | null;
  getAttribute?(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<HitElement>;
  getClientRects?(): ArrayLike<ViewRect>;
  getBoundingClientRect?(): ViewRect;
}

/** The marks a highlight is drawn in: its own (`data-highlight`) and the nested parts of it (`data-highlight-part`). */
const HIGHLIGHT_MARK = "mark[data-highlight], mark[data-highlight-part]";

/**
 * P11-09 (rule 2): what a click in the paper's body means to a highlight — the id of the highlight whose mark was clicked and
 * the box of its first line (the strip stands level with it), or null. Null for a click with a selection that is not
 * collapsed (a drag that ended on the mark, a double click: that is a selection, not a click), for a click on a control inside
 * the paragraph (a sticky's tag keeps its own click), and for a click that is on no highlight's mark. A sticky's mark inside
 * a highlight is the highlight's to click; the innermost highlight wins. `selection` is the page's, null when it has none.
 */
export function highlightClickOf(target: unknown, selection: { isCollapsed: boolean } | null): { id: string; rect: ViewRect } | null {
  if (selection && !selection.isCollapsed) return null;
  const node = target as HitElement | null;
  const element = node ? (node.nodeType === 1 ? node : node.parentElement) : null;
  if (!element?.closest || element.closest("button, a") !== null) return null;
  const mark = element.closest(HIGHLIGHT_MARK);
  const id = mark?.getAttribute?.("data-highlight") ?? mark?.getAttribute?.("data-highlight-part");
  if (!mark || !id) return null;
  // The first line of the highlight: its first mark in reading order (a nested part comes before its own mark), else the one clicked.
  const marks = mark.closest?.("p")?.querySelectorAll?.(highlightMarks(id));
  const first = marks && marks.length > 0 ? marks[0] : mark;
  const box = first.getClientRects?.()[0] ?? first.getBoundingClientRect?.();
  return box ? { id, rect: plain(box) } : null;
}

/**
 * Report the reader's selection to `onSelect`, and `null` whenever there is
 * none — once the reader has let go of it (P9-18, BACKLOG-45).
 *
 * A selection is offered when the primary pointer is up: while the mouse or pen
 * button is down a drag is not finished, however long the reader holds still
 * to look at the words, so `selectionchange` arms nothing then and a press ends
 * the wait it found. The release (or the browser taking the pointer away, or
 * the window losing focus with the button down, when no release will come)
 * reads at once — the drag's last `selectionchange` came before it, so nothing
 * else would schedule the read — and so does a click that collapses a
 * selection, which reports `null` the same way. A selection made without that
 * press (shift + arrows, touch handles, which fire no pointer events, or a
 * script) keeps the wait: it is read after `SELECTION_DEBOUNCE_MS` of stillness.
 * Listens only while there is somewhere to report to, and removes every
 * listener it added. Adds nothing to the page's markup.
 */
export function useSelectionListener(onSelect: ((selection: ExplainSelection | null) => void) | undefined): void {
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  }, [onSelect]);
  const listening = onSelect !== undefined;
  useEffect(() => {
    if (!listening) return;
    let timer: number | undefined;
    /** The primary button (mouse or pen) is held down on the page. */
    let down = false;
    const arm = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current?.(readSelection(window.getSelection() as unknown as SelectionLike | null)), delay);
    };
    const onChange = () => {
      if (!down) arm(SELECTION_DEBOUNCE_MS);
    };
    const onPress = (event: PointerEvent) => {
      // A touch selection is made with handles that fire no pointer events, and a
      // secondary button or a second pointer does not select: those keep the wait.
      if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return;
      down = true;
      window.clearTimeout(timer);
    };
    const onRelease = () => {
      if (!down) return;
      down = false;
      arm(0);
    };
    // The capture phase, so a handler that stops a pointer event's propagation cannot hide it.
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointercancel", onRelease, true);
    window.addEventListener("blur", onRelease);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("pointerup", onRelease, true);
      document.removeEventListener("pointercancel", onRelease, true);
      window.removeEventListener("blur", onRelease);
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
/**
 * P10-19 (X-A7, BACKLOG-78): the mat of a figure whose picture has not arrived. A lazy picture has no height until it
 * is loaded, so ten figures above a heading were 5,000 px the page did not know of when a map row's jump was aimed
 * at the heading. While the picture is on the way the mat keeps the room of the largest picture there can be (the
 * img's `max-h-[32rem]`, plus the mat's padding at each width); once it arrives the mat is the picture's own height.
 * The first paint — what the server and the first client render give — is the mat as it was.
 */
export function figureMatClass(waiting: boolean): string {
  const mat = "bg-[var(--plate-mat)] p-3 sm:p-4";
  return waiting ? `${mat} min-h-[calc(32rem+1.5rem)] sm:min-h-[calc(32rem+2rem)]` : mat;
}

/**
 * P10-26 (X-A8, BACKLOG-89): the box of a figure whose picture's own width and height are known. An aspect-ratio box
 * the size the picture will be — its own size, never wider than the mat's column or than `max-h-[32rem]` lets it be
 * at its ratio (P10-43: a tall one takes half the column) — so the page is the same height before and after the
 * picture arrives. Null without both numbers.
 */
export function figureBoxStyle(figure: ReadingFigure): CSSProperties | null {
  const { width, height } = figure;
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return null;
  // P10-43: a tall figure — one whose width at the 32rem cap falls under half the column — takes half the column's width
  // (never past its own picture), its height following its ratio; the 32rem cap would draw the owner's 465 × 1556 Figure 3
  // 153 px wide, too small to read. The column is at most 40rem (the measure), so a ratio of 40rem / 2 / 32rem = 0.625 or more
  // can never be tall, and such a figure's width stays exactly as it was. The box is still exactly the picture's ratio.
  const capped = `calc(32rem * ${width} / ${height})`;
  const tall = width / height < FIGURE_TALL_RATIO;
  return { aspectRatio: `${width} / ${height}`, width: `min(100%, ${width}px, ${tall ? `max(${capped}, 50%)` : capped})` };
}

/** The picture ratio (width / height) under which a figure may be narrower than half the column at the 32rem cap: (40rem column / 2) / 32rem. */
const FIGURE_TALL_RATIO = 20 / 32;

/**
 * P11-27 (rule 2): a figure's caption as the page draws it — the label in the quiet face, then " · " and the caption's words, then (where the picture is not drawn
 * and the extractor knew the page) " · p.N of the PDF". The words of the anchor (`captionText`) are all of it but, for a picture that failed to load, the page it says
 * after them. With notes on the caption its words are cut into runs and marks like a paragraph's; with none it is the markup it was.
 */
function CaptionText({ figure, spots, failed }: { figure: ReadingFigure; spots?: NoteAnchorMap[string]; failed: boolean }) {
  const text = captionText(figure);
  const tail = failed && Boolean(figure.imageUrl) && typeof figure.page === "number" ? ` \u00b7 p.${figure.page} of the PDF` : "";
  if (!spots || spots.length === 0) {
    return (
      <>
        <span className="text-text-muted">{figure.label}</span>
        {text.slice(figure.label.length)}
        {tail}
      </>
    );
  }
  return (
    <>
      {notedRuns(text, coveringSegments(text, spots), undefined, figure.label.length)}
      {tail}
    </>
  );
}

function Figure({ figure, anchor, spots }: { figure: ReadingFigure; /** P11-27: the caption's anchor id (`paper-section-<k>-p<n>`). */ anchor: string; /** The notes and highlights taken on the caption's words. */ spots?: NoteAnchorMap[string] }) {
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const showImage = Boolean(figure.imageUrl) && !failed;
  const box = figureBoxStyle(figure);
  // Once the picture is on the page: one that is not there yet reserves its room (P10-19). Not in the first render, so
  // that what the server drew and what the first client render draws stay as they were. A figure with a known size
  // (P10-26) has its own room from the first paint and needs no guess.
  const onPicture = useCallback((img: HTMLImageElement | null) => {
    if (img && !img.complete) setWaiting(true);
  }, []);
  const picture = (
    // A plain img: the picture lives on the source's host (or on our own figure route), and `next/image` would need
    // every host listed in advance.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={onPicture}
      src={figure.imageUrl}
      alt={figure.caption}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={() => setWaiting(false)}
      onError={() => setFailed(true)}
      className={
        box
          ? "block h-full w-full object-contain"
          : "mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"
      }
    />
  );
  // P11-12 (owner item 1; B P11-05 §6 C3): the picture is a button that opens the figure in the margin. The click goes through
  // the store (`figure-viewer.ts`), so the body takes no new prop. The button is the picture's own box and nothing moves: in the
  // aspect box it fills it (`block h-full w-full`; the box stays the mat's first child), and where the size is not known it is
  // the picture's own width, centred, never wider than the mat (`mx-auto block max-w-full`) around the unchanged `img`. A
  // figure with no picture is no button. The open figure — the store's key is the one this body's `Section` gives the figure —
  // wears a quiet accent ring (D10), a shadow, so the keyboard's focus outline (`globals.css`) is not overridden.
  const key = `${figure.label}:${figure.ordinal}`;
  const open = useFigureOpen(key);
  const opener = (boxClass: string) => (
    <button
      type="button"
      aria-label={`Open ${figure.label} in the margin`}
      aria-expanded={open}
      onClick={(event) => {
        if (!figure.imageUrl) return;
        const button = event.currentTarget;
        const img = button.querySelector("img");
        const at = button.getBoundingClientRect();
        openFigure({
          key,
          src: figure.imageUrl,
          label: figure.label,
          caption: figure.caption,
          // The picture's own size once it has loaded; before that, the extractor's record of it (P10-26); else not known.
          natural:
            img && img.naturalWidth > 0 && img.naturalHeight > 0
              ? { width: img.naturalWidth, height: img.naturalHeight }
              : box && figure.width && figure.height
                ? { width: figure.width, height: figure.height }
                : null,
          origin: { left: at.left, top: at.top, width: at.width, height: at.height },
        });
      }}
      className={`${boxClass} cursor-zoom-in${open ? " ring-2 ring-accent/45" : ""}`}
    >
      {picture}
    </button>
  );
  return (
    <figure id={anchor} {...{ [ANCHOR_BLOCK_ATTRIBUTE]: "caption" }} className="my-6 scroll-mt-20">
      {showImage && (
        <div className={box ? figureMatClass(false) : figureMatClass(waiting)}>
          {box ? (
            <div className="mx-auto" style={box}>
              {opener("block h-full w-full")}
            </div>
          ) : (
            opener("mx-auto block max-w-full")
          )}
        </div>
      )}
      <figcaption className="annotation mt-2 leading-[1.6] text-text-faint measure-mono">
        <CaptionText figure={figure} spots={spots} failed={failed} />
      </figcaption>
    </figure>
  );
}

/**
 * P10-09a / P10-09f (review 7.1c; walk X-B3): a paragraph's text with its sticky notes. The words each note was taken
 * on stay marked (`<mark data-note="N">`, the highlighter token) and the note's tag [N] stands right after them; a
 * note with no words to mark (no range, or the text no longer holds it) has its tag at the paragraph's end. The text
 * is the same text in the same order — only cut into runs — and with no notes it is the paragraph as it was.
 * P11-09: a highlight (a spot with a `colour`) is drawn here too, in its own colour and with no tag — see `notedRuns`.
 */
function NotedText({ text, spots }: { text: string; spots?: NoteAnchorMap[string] }) {
  if (!spots || spots.length === 0) return <MathText text={text} />;
  return <>{notedRuns(text, coveringSegments(text, spots))}</>;
}

/**
 * P10-43 (A P10-27 §5 (a)): a run of `passageSegments` plus the part of a later note's mark that lies inside an earlier
 * mark. `part` marks that piece: it draws the note's own words in the nested shade and carries no tag (the tag stays
 * after the note's last word, with its main mark).
 */
export type CoveringSegment =
  | { kind: "text"; from: number; to: number }
  | { kind: "tag"; spot: AnchorSpot }
  | { kind: "mark"; from: number; to: number; spot: AnchorSpot; inner: CoveringSegment[]; depth: number; part?: true };

/** The pieces of `[lo, hi)` in `segments`, a mark of `spot` laid over each run of plain text there and inside every mark it meets. */
function overlay(segments: readonly CoveringSegment[], lo: number, hi: number, spot: AnchorSpot, depth: number): CoveringSegment[] {
  const out: CoveringSegment[] = [];
  for (const one of segments) {
    if (one.kind === "tag") {
      out.push(one);
      continue;
    }
    const a = Math.max(lo, one.from);
    const b = Math.min(hi, one.to);
    if (a >= b) {
      out.push(one);
    } else if (one.kind === "mark") {
      out.push({ ...one, inner: overlay(one.inner, a, b, spot, depth + 1) });
    } else {
      if (a > one.from) out.push({ kind: "text", from: one.from, to: a });
      out.push({ kind: "mark", from: a, to: b, spot, inner: [{ kind: "text", from: a, to: b }], depth, part: true });
      if (b < one.to) out.push({ kind: "text", from: b, to: one.to });
    }
  }
  return out;
}

/** The mark segment of `spot` (the one with its tag), wherever it stands in the tree. */
function markOf(segments: readonly CoveringSegment[], spot: AnchorSpot): Extract<CoveringSegment, { kind: "mark" }> | null {
  for (const one of segments) {
    if (one.kind !== "mark") continue;
    if (one.spot === spot && !one.part) return one;
    const inside = markOf(one.inner, spot);
    if (inside) return inside;
  }
  return null;
}

/**
 * `passageSegments`, with every note's mark over all its words. `passageSegments` never lets two marks cross, so a note
 * that starts inside an earlier note's mark and ends after it is cut to start where the earlier mark ends. Here the words
 * it lost — from its own start to that cut — are laid back as nested marks inside the earlier mark(s): the overlap carries
 * both notes (the nested shade, as a mark inside a mark), and each tag stays right after its own note's last word.
 */
export function coveringSegments(text: string, spots: readonly AnchorSpot[]): CoveringSegment[] {
  let tree: CoveringSegment[] = passageSegments(text, spots);
  const clipped = spots
    .map((spot) => ({ spot, range: rangeOf(text, spot) }))
    .filter((one): one is { spot: AnchorSpot; range: { start: number; end: number } } => one.range !== null)
    .sort((a, b) => a.range.start - b.range.start || tieOrder(a.spot, b.spot));
  for (const { spot, range } of clipped) {
    const mark = markOf(tree, spot);
    if (mark && mark.from > range.start) tree = overlay(tree, range.start, mark.from, spot, 0);
  }
  return tree;
}

/** P10-20: the second shade (`--color-note-nested`) for a mark inside another's; the outer keeps the highlighter token. */
const MARK_OUTER = "bg-[color:var(--color-note-mark)] text-inherit";
const MARK_INNER = "bg-[color:var(--color-note-nested)] text-inherit";

/**
 * P11-09 (owner item 8; B P11-04 §3.2, I3): what a mark stands in when it sits inside a highlight — the highlight's colour, and
 * the ink of the shade painted under the words there. Every mark and every tag inside a highlight sets its own ink: the
 * paragraph's ink is no longer the only ink there is, and the muted ink of a sticky is not made for a bright highlight.
 */
interface Within {
  colour: HighlightColourId;
  ink: string;
}

/**
 * P11-27: a run of plain text. In a caption the first `labelEnd` characters are the figure's label ("Figure 1"), drawn in the quiet face as it always was — wherever
 * a mark runs across it: the label stays a label inside the mark. Inside a highlight the label takes the highlight's ink (the muted face is not made for a bright
 * fill). Without `labelEnd` — a paragraph, a heading — it is the text, as it was.
 */
function plainRun(text: string, from: number, to: number, key: string, within: Within | undefined, labelEnd: number | undefined) {
  if (labelEnd === undefined || from >= labelEnd) return <MathText key={key} text={text.slice(from, to)} />;
  const cut = Math.min(to, labelEnd);
  return (
    <Fragment key={key}>
      <span {...(within ? {} : { className: "text-text-muted" })}>{text.slice(from, cut)}</span>
      {cut < to ? <MathText text={text.slice(cut, to)} /> : null}
    </Fragment>
  );
}

/**
 * The runs of a paragraph, or of one mark: text, marks (their own nested runs inside, the tag right after), loose tags.
 *
 * P11-09: a highlight's spot (it has a `colour`) is a `<mark data-highlight="id">` painted inline — its fill at depth 0, its deeper
 * shade nested (`highlightPaint`) — with the ink best on that shade, and no tag; its `part` marks (a later highlight's words
 * that lie inside an earlier mark) carry `data-highlight-part`. A sticky's mark inside a highlight wears the highlight's deep
 * shade and ink and keeps its tag. A paragraph with no highlight in it renders as it always did.
 */
function notedRuns(text: string, segments: readonly CoveringSegment[], within?: Within, labelEnd?: number) {
  return segments.map((segment, k) => {
    if (segment.kind === "text") return plainRun(text, segment.from, segment.to, `t${k}`, within, labelEnd);
    const { spot } = segment;
    if (segment.kind === "tag") {
      // A highlight has no tag, even when the words it stood on are gone.
      return isHighlightSpot(spot) ? null : <NoteTag key={`g${spot.id}`} n={spot.n} id={spot.id} ink={within?.ink} />;
    }
    if (isHighlightSpot(spot)) {
      const colour = spot.colour as HighlightColourId;
      const paint = highlightPaint(colour, segment.depth);
      const style = { backgroundColor: paint.bg, color: paint.ink };
      const inner = notedRuns(text, segment.inner, { colour, ink: paint.ink }, labelEnd);
      return segment.part ? (
        <mark key={`p${spot.id}:${k}`} data-highlight-part={spot.id} style={style}>
          {inner}
        </mark>
      ) : (
        <mark key={`h${spot.id}`} data-highlight={spot.id} style={style}>
          {inner}
        </mark>
      );
    }
    // A sticky's mark inside a highlight: the highlight's deep shade and its ink, in place of the highlighter tokens.
    const worn = within ? highlightPaint(within.colour, 1) : null;
    const wear = worn ? { style: { backgroundColor: worn.bg, color: worn.ink } } : null;
    const inner = notedRuns(text, segment.inner, within && worn ? { colour: within.colour, ink: worn.ink } : within, labelEnd);
    // A part of a later note's mark inside an earlier mark: its words in the nested shade, no tag (the note's tag stands after its last word).
    if (segment.part) {
      return (
        <mark key={`p${spot.id}:${k}`} data-note-part={spot.n} {...(wear ?? { className: MARK_INNER })}>
          {inner}
        </mark>
      );
    }
    return (
      <Fragment key={`m${spot.id}`}>
        <mark data-note={spot.n} {...(wear ?? { className: segment.depth === 0 ? MARK_OUTER : MARK_INNER })}>
          {inner}
        </mark>
        <NoteTag n={spot.n} id={spot.id} ink={within?.ink} />
      </Fragment>
    );
  });
}

/** P4-01: a paragraph with its rewrite beside it. From the spread (xl) the anchor is two columns —
 *  the paper's paragraph and Peer's — with the control and whatever the paper set after the
 *  paragraph across both; below it nothing is a grid and the blocks stack, as paragraphs already do.
 *  Each column is about 308px at 1440 on the spread (the 640px column less the 24px gap, halved), too narrow to justify without rivers, so the pair's text is
 *  set ragged-right (the words are the same; only the alignment of a paragraph that shows a rewrite
 *  changes, and only on the spread). */
const SIDE_BY_SIDE = "xl:grid xl:grid-cols-2 xl:gap-x-6 xl:gap-y-4 xl:space-y-0 xl:[&_p]:text-left";

function Section({
  section,
  index,
  mark,
  plain,
  noteAnchors,
}: {
  section: ReadingSection;
  index: number;
  mark: SectionMark | null;
  /** P4-01: "Say it plainly" — absent without a model, and the section is then what it was. */
  plain?: PlainView;
  /** P10-09a: the sticky notes taken on this paper's paragraphs, by paragraph id. */
  noteAnchors?: NoteAnchorMap;
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
      {figures.map((f, k) =>
        f.after === i ? (
          <Figure key={`${f.label}:${f.ordinal}`} figure={f} anchor={paragraphAnchor(index, captionBlock(section, k))} spots={noteAnchors?.[paragraphAnchor(index, captionBlock(section, k))]} />
        ) : null,
      )}
    </>
  );
  /** Whether the paper set an equation or a figure right after paragraph `i`. */
  const hasFollowing = (i: number) => equations.some((e) => e.after === i) || figures.some((f) => f.after === i);
  // P10-04 (review 3.3): a group heading ("2 Results" holding only "2.1 …") has no paragraphs, no equation
  // and no figure: it is its heading alone, with its anchor, and nothing under it before its first child.
  const alone = section.paragraphs.length === 0 && equations.length === 0 && figures.length === 0;
  // P12-63 (rule 4; ruling §1h.436 (c)): the opening of a paper that prints no heading above its first text carries the extractors' placeholder
  // ("Body") for a heading. It is not a word of the paper, so none is printed; the section keeps its anchor and its paragraphs, and the map's row
  // for it is labelled by its role (`inferRoles`, A1). Only the first section: the placeholder is what the opening is given.
  const unheaded = index === 0 && isPlaceholderHeading(section.heading);
  return (
    <section id={sectionAnchor(index)} className="mt-8 scroll-mt-20 first:mt-6">
      {/* P1-05: the route marks the heading — an attribute and a tint,
          nothing else — and never the paragraphs under it. */}
      {/* P11-27 (rule 2): the heading is a block of its own — its anchor id and marker, and the notes and highlights taken on its words. */}
      {!unheaded && (
      <h3
        id={paragraphAnchor(index, headingBlock(section))}
        {...{ [ANCHOR_BLOCK_ATTRIBUTE]: "heading" }}
        data-route={mark?.tier}
        className={markedClass(`font-reading font-medium text-heading text-title leading-[1.3] scroll-mt-20${alone ? "" : " mb-2"}`, mark, HEADING_MARK)}
      >
        <NotedText text={section.heading} spots={noteAnchors?.[paragraphAnchor(index, headingBlock(section))]} />
      </h3>
      )}
      {!alone && (
      <div className="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4 reading-justify">
        {following(-1)}
        {section.paragraphs.map((paragraph, i) => {
          // P4-01: the rewrite beside this paragraph, when the reader asked for it; the control
          // under it where the route marks it read — and under a paragraph that shows a rewrite
          // whatever the route says now, so there is always a way to take it back.
          const rewrite = plain?.shown.get(paragraphKey(section.id, i));
          const offered = plain !== undefined && (rewrite !== undefined || plainOffered(mark, i, paragraph));
          return (
            <div
              key={i}
              id={paragraphAnchor(index, i)}
              className={rewrite !== undefined ? `space-y-4 scroll-mt-20 ${SIDE_BY_SIDE}` : "space-y-4 scroll-mt-20"}
            >
              <p>
                <NotedText text={paragraph} spots={noteAnchors?.[paragraphAnchor(index, i)]} />
              </p>
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
      )}
    </section>
  );
}

/** The anchor the decision block's "read it here" scrolls to. */
export const PAPER_BODY_ID = "paper-body";

export function PaperBody({
  reading,
  route,
  plain,
  onSelect,
  noteAnchors,
  onHighlightClick,
}: {
  reading: PaperReading;
  route?: DrawRoute;
  /** P4-01 (blueprint §3.6; §1h.12 (h)): "Say it plainly" — the control under each paragraph the
   *  route marks read and the rewrites beside the paragraphs that show one. Absent for a reader
   *  with no model, and the body is then exactly the body it was. */
  plain?: PlainView;
  /** P3-02 (§1h.2): told, once it holds still, what the reader has selected in
   *  the body — a target within one paragraph — or `null` for no such selection. */
  onSelect?: (selection: ExplainSelection | null) => void;
  /** P10-09a (review 7.1c): the paper's own note's anchors — per paragraph, the sticky notes taken on it —
   *  drawn as a small reference tag after the passage. Absent, and the body is what it was. */
  noteAnchors?: NoteAnchorMap;
  /** P11-09 (owner item 8): told, with the highlight's id and the box of its first line, when a click with a collapsed selection
   *  lands on a highlight's mark (the page raises the colour strip); a drag that ends on a mark is a selection and tells nothing.
   *  Absent, and the body listens to no click. */
  onHighlightClick?: (id: string, rect: ViewRect) => void;
}) {
  useSelectionListener(onSelect);
  // `?? []`: the version gate above should mean this is always an array, and
  // a missing optional block is still not worth taking the page down for.
  const body = useMemo(() => reading.body ?? [], [reading.body]);
  // P10-35 (BACKLOG-91): a note's anchor is positional; the body draws a note only on the words it was taken on. An anchor whose
  // paragraph no longer holds them finds its quote again here (nearest first); it is written back once (the next load needs no
  // search), and one the paper no longer holds is drawn nowhere and told to its sticky.
  const resolved = useMemo(() => (noteAnchors ? resolveAnchors(body, noteAnchors) : null), [body, noteAnchors]);
  useEffect(() => {
    if (!resolved) return;
    if (resolved.fixes.length > 0) repairAnchors(resolved.fixes);
    useLostPassages.getState().setLost(resolved.lost);
  }, [resolved]);
  // P11-27 (rule 2): the notes store reads the words of a heading or a caption from the body on show (the hooks that take a note or a highlight know only the
  // paragraphs). Memory only; taken back when the body goes.
  useEffect(() => {
    setBodyOnShow(body);
    return () => setBodyOnShow(null);
  }, [body]);
  if (body.length === 0) return null;
  // One listener on the body, not one per mark: the marks are drawn by `notedRuns` and nest, and a click on a nested mark
  // must tell once (the innermost highlight), which the bubbling of one handler per mark would not.
  const clickOnHighlight = (event: ReactMouseEvent<HTMLDivElement>) => {
    const hit = highlightClickOf(event.target, typeof window === "undefined" ? null : window.getSelection());
    if (hit) onHighlightClick?.(hit.id, hit.rect);
  };

  return (
    // `scroll-mt`: the masthead is sticky, and a heading scrolled to the
    // very top of the window lands under it.
    <div id={PAPER_BODY_ID} className="scroll-mt-20" onClick={onHighlightClick ? clickOnHighlight : undefined}>
    <Band label={BODY.heading}>
      {/* P7-14 (R5): no contents here. The map is the paper's one contents
          list — it names the sections Peer reached, where the text was read
          from and how long it is — so the line that joined the headings and
          the count line that stood under this label are gone. */}
      {body.map((section, i) => (
        <Section
          // P7-18 (F5): the id, unique by `withSectionIds`. `canonical:heading` collided on two sections
          // with one heading ("Notes") and put the heading into the dev terminal with React's warning.
          key={section.id ?? `${i}`}
          section={section}
          index={i}
          mark={sectionMark(route, section.id)}
          plain={plain}
          noteAnchors={resolved?.map}
        />
      ))}
    </Band>
    </div>
  );
}
