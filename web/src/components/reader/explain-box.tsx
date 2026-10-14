"use client";

// "Explain this" — the window the reader opens on a selected passage, and what it shows (P3-02, P3-02b; rulings §1h.2, §1h.3;
// user decision §1a.10; blueprint §3.5 ⑤ 词, relaxed from a word to a passage up to a paragraph, then to a short conversation
// beside the text).
//
// P10-08 (the owner's review of 2026-10-13, items 8.4-8.6; ruling §1h.78; brief P10-08): the window is opened ONLY when the reader
// asks — nothing stands at the right when a paper is entered, with a key or without, and the page keeps its full width. The paper's
// body, the Summary's blocks and an answer under the question are all explain targets (`paper-body.tsx` reads the selection, `source`
// says where it is from); a small pair of buttons above the selection (`selection-toolbar.tsx`) and the `e` key call the page's
// `explain` action, which is this box's `open` (below, `openRef`). The gutter pill, the window's empty state (P8-06), the header's
// "Explain this?" control (P9-03b) and the web-search toggle (P3-02c; review 8.6: "目前的ai解释功能挺厉害的，够用了") are gone (review 8.5, 8.6). Under 768 px the thumb bar's cell is
// the control and the box only says, through `explain-offer.ts`, that a target is selected (P9-41, ruling §1h.66).
//
// What the window shows, in order, when the reader opens it:
//
//   - its header: a large highlighted X at the top-left (Close; the accent colour, 32 px or more, keyboard-focusable), the title
//     beside it, and the passage's opening words quoted from the paper with their section — the paper's words go through
//     `EvidenceQuote`, always (§1f.17);
//   - when the paper itself defines a term inside the passage (Tier 0, P3-01's list), that sentence as a quote. With no key this is
//     the whole window, and with no key and no paper definition there is nothing to open (a locked block is not shown);
//   - with a key, the model's two parts: "What it means" (Peer's words, labelled) and "Why it is here" — Peer's prose, then the
//     paper's own sentence as a quote, or, when that sentence could not be verified, the prose labelled as Peer's own reading and no quote;
//   - P4-00c (§1h.11 (a)): when the passage holds two or more terms or quantities, the small term table under both parts — the reply's
//     own `ItemsTable`, in the reading face with the label-face headers — and, as before, no "Say more" on the first answer.
//
// An answer already kept for the passage opens at once with no request, with the thread that followed it. Escape, a press outside the
// window, or a new selection closes the CARD (640 to 1023 px) and the phone's sheet; a selection that merely goes away (a click in the
// card collapses it) does not. P7-15: the dock is not closed by a press outside it — closing it gives the page its width back, and a
// page that reflows on the press moves the word under the pointer before the press has chosen it. P8-02 (BACKLOG-31; the owner: "the
// AI window should stay open", ruling §1h.41 (b)): nor is it closed by a new selection. Once open it stays, with the page's width kept
// clear, until Escape or Close — the one thing that gives the width back; P10-08: Escape clears the passage AND closes the window
// (there is no empty state to go back to). Pressing "Explain this" on a new selection, or `e`, takes that passage into THE SAME window:
// the session is replaced in place (never null in between, so `reserveDock`'s properties are not taken off and put on again and the
// page does not reflow), the previous passage's thread staying the store's, kept for its passage. `e` on the open window with the same
// passage (or none selected) goes to the input. Nothing here links off the page.
//
// P9-03b (ruling §1h.49; the owner, "level with the first line of the SELECTED paragraph"): while the window stands from 1024 px, it
// follows the selection. When a selection is settled (P9-18: once the primary pointer is up, so a drag that pauses with the button held
// offers nothing; a keyboard selection keeps the page's 150 ms debounce) in a paragraph other than the one the window stands at, the
// window moves to that paragraph's first line (`placePanel`'s clamp, as for the explained one), with no close and no reflow, its
// content unchanged; the window stays level with the last selection it followed when that selection goes away (a click in the window
// collapses it — it must not jump from under the pointer). P10-08: a selection in the Summary or an answer has no paragraph of the
// paper to be level with, so the window stands at the masthead's foot (`DOCK_TOP_PX`).
//
// P3-02b: under the first answer, the thread — the reader's messages under "You", Peer's replies under "Peer" (a verified quote through
// `EvidenceQuote`, else Peer's label beside the prose) — and, pinned at the box's foot, a one-line input: Enter sends, Shift+Enter is a
// newline, Escape closes. The send is the only request (`onReply`); nothing is sent before it, a failed reply leaves the thread as it was
// and the typed words in the input, and eight reader messages fill the thread (it is dropped when the passage is opened again). `openRef`
// hands the page an `open` function: the selection buttons and the `e` key do what the thumb bar's cell does.
//
// Where it stands (`placePanel`): P7-15 (the owner's R7): from a window of 1024 px a dock fixed at the right edge of the screen — flush
// with it, 360 px wide, scrolling inside (`explain-dock.ts`); between 640 and 1024 the card P3-02 put under the selection, measured
// again as the page scrolls — P9-50: held between the masthead's foot and the foot legend's top as the dock is, so a grown thread scrolls
// inside it and never covers either; a bottom sheet on a phone. P8-02 (the owner: "level with the first line of the selected
// paragraph"): the dock's TOP is level with the first line of the PARAGRAPH of the passage it stands at, held between the masthead's foot
// and the room its whole height needs above the legend (P9-17, rulings §1h.56 and §1h.57: its measured height, at least 360 px once it
// holds a passage — lifted until its bottom stands on the screen's bottom when the paragraph is too low for all of it) and measured
// again as the page scrolls; its height is its content. The selections measured again as the page scrolls are the open window's
// passage and the one the window stands level with (`stand`).
//
// P10-08 (review 1.1, B P10-01, ruling §1h.80): the after-every-commit layout effect that reads the card's height cannot run away
// (`settleHeight`), and the viewport is read by the selection watcher — not after every commit.
//
// P3-07 (ruling §1h.9; user decision §1a.14): the answers are short and exact, and the box shows two things for it. A reply may carry a
// small term table — three columns, the term, what it means here, how to read it, two to four rows a dozen words a cell — under its
// prose (headers in the label face from `copy.ts`, cells in the reading face; never quote-styled: the table is Peer's, the paper's own
// sentence stays an `EvidenceQuote` below it). And under Peer's LATEST reply — never under the first answer, never under a reply that is
// already the long form — one label-face button, "Say more", re-sends the reader's last message in the long form (`onSayMore`): the
// thread before that message and the message, no copy of it, so the reader count does not grow; the reply is appended as Peer's next
// turn and replaces nothing. It waits while a request is in flight and at the full thread, as a send does; what the reader was typing
// stays.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { setExplainOffer } from "@/lib/reader/explain-offer";
import { stackRoom, useWindows } from "@/lib/reader/windows";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer, ExplainItem } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { MAX_EXPLAIN_MESSAGE_CHARS, threadFull, type ExplainTurn } from "@/store/explain-threads";
import type { Paper, UserProfile } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { useReadingPrefsStore } from "@/store/reading-prefs";
import {
  DOCK_BOTTOM_PX,
  DOCK_MIN_VIEWPORT_PX,
  DOCK_MIN_VISIBLE_PX,
  DOCK_THREAD_FLOOR_PX,
  DOCK_TOP_PX,
  DOCK_WIDTH_PX,
  MASTHEAD_MIN_VIEWPORT_PX,
  PAGE_ZOOM_ROOT,
  PAGE_ZOOM_VAR,
  dockInStack,
  legendHeightPx,
  newHeightGuard,
  reserveDock,
  resetHeightGuard,
  settleHeight,
} from "./explain-dock";
import { EvidenceQuote } from "./evidence-quote";
import { asItems, firstAnswerMessage, keyToSend, postExplain, moreReply, replyPair, sayMoreOf, type ReplyResult } from "./explain-thread";
import type { ExplainSelection, ExplainSource, SelectionTarget, ViewRect, ViewRects } from "./paper-body";

// ── What the card shows ────────────────────────────────────────────────

/** `none`: no model is asked (no key) — the paper's own definition is all there is. */
export type ExplainStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "answer"; answer: ExplainAnswer }
  | { kind: "unavailable" }
  | { kind: "not_in_paper" };

/** What asking comes to. */
export type AskResult = ExplainAnswer | "unavailable" | "not_in_paper";

/** The thread as the card draws it, and the handlers it calls. The card owns no
 *  state: the box holds the draft and the pending reply. */
export interface ThreadView {
  turns: readonly ExplainTurn[];
  draft: string;
  /** A reply is on its way: the input waits. */
  pending: boolean;
  /** The last send failed: the thread is as it was and the draft is still here. */
  failed: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
  /** P3-07: "Say more" — re-send the reader's last message in the long form. Without it
   *  the thread has no such button. */
  onSayMore?: () => void;
}

const PREVIEW_CHARS = 80;

/** The passage's opening words, for the card's first line — cut at a word. */
export function previewOf(passage: string): string {
  if (passage.length <= PREVIEW_CHARS) return passage;
  const space = passage.lastIndexOf(" ", PREVIEW_CHARS);
  return `${(space > 0 ? passage.slice(0, space) : passage.slice(0, PREVIEW_CHARS)).trimEnd()}…`;
}

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `term` is a word (or words) of `passage`: whole, in any case — "DM"
 *  is not found inside "admission". */
export function termInPassage(term: string, passage: string): boolean {
  const wanted = term.trim();
  if (!wanted) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(wanted)}(?![\\p{L}\\p{N}])`, "iu").test(passage);
}

/** The first term whose definition is the paper's own sentence (not Peer's)
 *  that lies inside the passage — the Tier 0 answer. */
export function definingTerm(terms: readonly PaperTerm[], passage: string): PaperTerm | null {
  return terms.find((term) => term.evidence && termInPassage(term.term, passage)) ?? null;
}

/** Where a term's sentence is from, for its attribution: its own place, else the
 *  map's heading and page for its section, else the abstract (as the strip does). */
export function termSource(term: PaperTerm, reading: Pick<PaperReading, "map">): { where: string; page: number | undefined } {
  const section = term.sectionId ? reading.map?.sections.find((candidate) => candidate.id === term.sectionId) : undefined;
  return { where: term.evidenceWhere ?? section?.heading ?? "abstract", page: term.page ?? section?.page };
}

// ── Where it stands ────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
  /** P9-20 (BACKLOG-42): the foot legend's height on screen, as Fit's zoom scales it (`legendHeightPx`); `DOCK_BOTTOM_PX` where absent. */
  legend?: number;
}

/** The legend's strip: what the window's bottom and the floating control's pill stand above. */
const legendOf = (viewport: Viewport) => viewport.legend ?? DOCK_BOTTOM_PX;

const CARD_WIDTH = 360;
const CARD_MARGIN = 12;
const CARD_GAP = 8;
const CARD_ROOM = 220;
const CARD_MIN_HEIGHT = 120;
/** Below this the card takes the window's width: a phone. */
const PHONE_WIDTH = 640;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * P9-50 rule 1 (A P9-W3's N7): where the card's room begins. From 768 px the masthead (`hidden md:grid sticky top-0 h-12`,
 * `MASTHEAD_MIN_VIEWPORT_PX`) stands over the page, and the card (`fixed z-[70]`) over the masthead (`z-50`): a thread grown by replies,
 * placed above a low selection, climbed to 12 px at 768 × 1000 and covered the masthead's mark, its "←" and WRITE. Its head there is the
 * masthead's foot, `DOCK_TOP_PX` — the dock's own clamp (`placePanel`), and the masthead's measured bottom at 768, 900 and 1023 px with a
 * mouse and with touch: it is `h-12` at every width of the card range and wraps nowhere (`explain-dock.test.ts` holds `h-12` against the
 * number) — so a taller thread scrolls inside the card, as the dock's does. Under 768 px there is no masthead (the top of the page is the
 * page's own) and the head stays the card's margin.
 */
const cardHead = (viewport: Viewport) => (viewport.width >= MASTHEAD_MIN_VIEWPORT_PX ? DOCK_TOP_PX : CARD_MARGIN);

/**
 * P9-50 rule 2 (A P9-W3 §3 c; the owner's §1a.18 (c): "始终让窗口存在于屏幕里"): where the card's room ends — where the dock's does. From 768 px the
 * foot legend (`hidden md:flex fixed bottom-0`, `z-30`) is the page's last line and the card (`z-[70]`) used to stand over it: placed under
 * the selection its bottom was `CARD_MARGIN` (12) above the screen's last pixel, 16 px into the 28-px legend (bottom 988 on a legend whose
 * top is 972 at 768 × 1000). Its foot is the legend's top, `legendOf` — `DOCK_BOTTOM_PX` at the page's own scale and 28 × zoom once Fit
 * scales the legend (P9-20), as the dock's `placePanel` reads it. Under 768 px the thumb bar (`md:hidden`) stands in the legend's place and
 * the sheet (under 640) is flush with the screen's bottom over it, so with no legend the card's foot is the screen's bottom.
 */
const cardFoot = (viewport: Viewport) => (viewport.width >= MASTHEAD_MIN_VIEWPORT_PX ? legendOf(viewport) : 0);

/** The card: 360 px wide under the whole selection on a spread, the window's
 *  width less a margin on a phone; above it when there is more room there than
 *  below — it never covers the words it explains. Its height is bounded by the
 *  room it has, and it scrolls inside. P9-50: the room is the masthead's foot (`cardHead`)
 *  to the foot legend's top (`cardFoot`), as the dock's is. */
export function placeCard(
  rect: ViewRect,
  viewport: Viewport,
): { left: number; width: number; top?: number; bottom?: number; maxHeight: number } {
  const phone = viewport.width < PHONE_WIDTH;
  const width = phone ? viewport.width - 2 * CARD_MARGIN : CARD_WIDTH;
  const left = phone ? CARD_MARGIN : clamp(rect.left, CARD_MARGIN, viewport.width - CARD_WIDTH - CARD_MARGIN);
  const head = cardHead(viewport);
  const foot = cardFoot(viewport);
  // Which side is P3-02's choice, measured as it was — the room each side of the selection to a `CARD_MARGIN` from the window's edge — so
  // that the head and the foot below hold the card where it stands and never move it to the other side of the words.
  const roomBelow = viewport.height - rect.bottom - CARD_GAP - CARD_MARGIN;
  const roomAbove = rect.top - CARD_GAP - CARD_MARGIN;
  if (roomBelow >= CARD_ROOM || roomBelow >= roomAbove) {
    // Under the selection: from its last line — for a selection scrolled up under the masthead, no higher than the masthead's foot — down
    // to the legend's top.
    const top = Math.max(rect.bottom + CARD_GAP, head);
    const maxHeight = Math.max(viewport.height - foot - top, CARD_MIN_HEIGHT);
    return { left, width, maxHeight, top: Math.min(top, viewport.height - foot - maxHeight) };
  }
  // Above it: 8 px clear of its first line — or, for a selection lower than the legend's top, on the legend's top, never below it — and no
  // higher than the masthead's foot, so a long thread scrolls inside.
  const maxHeight = Math.min(Math.max(rect.top - CARD_GAP - head, CARD_MIN_HEIGHT), Math.max(viewport.height - foot - head, CARD_MIN_HEIGHT));
  return { left, width, maxHeight, bottom: clamp(viewport.height - rect.top + CARD_GAP, foot, viewport.height - head - maxHeight) };
}

export interface Place {
  /** `dock`: the window at the right edge (P7-15), level with its paragraph (P8-02), with a `top` and a
   *  `maxHeight` and no `bottom` — its height is its content; `card`: P3-02's place; `sheet`: a phone's bottom sheet. */
  kind: "dock" | "card" | "sheet";
  left?: number;
  /** The dock stands against the window's right edge: `right`, not a `left` computed from a width that
   *  counts the scrollbar the fixed box does not stand under. */
  right?: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** A phone's sheet takes at most this share of the window's height. */
const SHEET_SHARE = 0.6;

/**
 * Where the box stands. From a window of 1024 px: the dock (P7-15, R7) — the window's right edge,
 * 360 px wide, and (P8-02, BACKLOG-31; P9-03b) its top level with the first line of the PARAGRAPH it
 * stands at — the selected one, the explained one until another is selected —
 * `top = clamp(paragraphTop, DOCK_TOP_PX, height − legend − needed)` (P9-20: `legend` is `viewport.legend`, the foot legend's height as
 * Fit's zoom scales it — `DOCK_BOTTOM_PX` where the viewport names none),
 * so never above the masthead's foot and never so low that the `needed` height does not fit above the foot
 * legend. P9-17 (rulings §1h.56, §1h.57): `needed` is what the window needs below its top, its own height — the box
 * passes the card's measured height, and at least `DOCK_THREAD_FLOOR_PX` (360: room for its sticky header, its sticky
 * controls row and two lines of the answer between them) once it holds a passage; the default, 160 px
 * (`DOCK_MIN_VISIBLE_PX`), is the empty window's until it is measured (it is about 125 px tall). So the window is level
 * with the paragraph's first line whenever all of it fits below, else it is lifted until its bottom edge stands on the
 * legend's reserve — never lower, and always inside the screen. Its height is its content, at most the room from its
 * top down to the legend (`maxHeight`);
 * the thread scrolls inside and the input is pinned at its foot. The words of the selection do not enter
 * it — `bounds` only does where the body reported no paragraph (the selection's own first line then).
 * Below 640: a sheet — the window's width, on its bottom edge, at most 60% of its
 * height. Between the two P3-02's place (`placeCard`), under or above the selection — P9-50: between the masthead's foot (`DOCK_TOP_PX` from
 * 768 px) and the legend's top, as the dock's is (the screen's bottom where there is no legend, under 768 px).
 */
export function placePanel(bounds: ViewRect, viewport: Viewport, paragraphTop?: number, needed: number = DOCK_MIN_VISIBLE_PX): Place {
  if (viewport.width < PHONE_WIDTH) {
    return { kind: "sheet", left: 0, width: viewport.width, bottom: 0, maxHeight: Math.floor(viewport.height * SHEET_SHARE) };
  }
  if (viewport.width >= DOCK_MIN_VIEWPORT_PX) {
    const legend = legendOf(viewport);
    const top = clamp(paragraphTop ?? bounds.top, DOCK_TOP_PX, viewport.height - legend - needed);
    return { kind: "dock", right: 0, width: DOCK_WIDTH_PX, top, maxHeight: Math.max(0, viewport.height - top - legend) };
  }
  return { kind: "card", ...placeCard(bounds, viewport) };
}

/**
 * How far to scroll the page so a selection stays visible above a sheet that
 * covers the foot of the window: just enough that it ends a margin above the
 * sheet, and never so far that its own top leaves the window — where it cannot
 * all fit, it shows what it can. Zero when it is already clear.
 */
export function revealShift(bounds: ViewRect, viewport: Viewport, sheetHeight: number): number {
  const wanted = bounds.bottom - (viewport.height - sheetHeight - CARD_MARGIN);
  if (wanted <= 0) return 0;
  return Math.max(0, Math.min(wanted, bounds.top - CARD_MARGIN));
}

/** A place as the card's inline style. */
function styleOf(place: Place): CSSProperties {
  return {
    ...(place.left !== undefined ? { left: place.left } : {}),
    ...(place.right !== undefined ? { right: place.right } : {}),
    width: place.width,
    maxHeight: place.maxHeight,
    ...(place.top !== undefined ? { top: place.top } : {}),
    ...(place.bottom !== undefined ? { bottom: place.bottom } : {}),
  };
}

/** P9-20 (BACKLOG-42): the page's Fit zoom, read from the page container (`--page-zoom`, `usePageZoom`'s number mirrored beside the CSS
 *  `zoom`); 1 with Fit off, with no container (a page that is not the paper's) or where there is no DOM to ask. */
function pageZoom(): number {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof document.querySelector !== "function") return 1;
  const root = document.querySelector(PAGE_ZOOM_ROOT);
  if (!root || typeof window.getComputedStyle !== "function") return 1;
  const zoom = Number.parseFloat(window.getComputedStyle(root).getPropertyValue(PAGE_ZOOM_VAR));
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function currentViewport(): Viewport {
  return typeof window === "undefined"
    ? { width: 1024, height: 768 }
    : { width: window.innerWidth, height: window.innerHeight, legend: legendHeightPx(pageZoom()) };
}

/** P10-08: the y the dock's top is level with — the first line of the selected paragraph of the paper (P9-03b); a selection in the
 *  Summary or an answer has no paragraph of the paper, so the window stands at the masthead's foot. */
function levelTopOf(selection: ExplainSelection, where: ViewRects): number | undefined {
  return selection.source === undefined || selection.source === "paper" ? where.paragraph?.top : DOCK_TOP_PX;
}

/** The same window as far as placing goes: a scroll frame that moved nothing renders nothing. P10-08 (B P10-01's step 2): a legend
 *  within 0.01 px is the same legend, so a differing last bit of the page's zoom cannot count as a change. */
const sameViewport = (a: Viewport, b: Viewport) =>
  a.width === b.width && a.height === b.height && (a.legend === b.legend || (a.legend !== undefined && b.legend !== undefined && Math.abs(a.legend - b.legend) < 0.01));

// ── Asking ─────────────────────────────────────────────────────────────

/** The reader's own provider and key, when they have set one — the shape the
 *  report request carries; nothing without one. */
export function explainLlmOverride(profile: Pick<UserProfile, "feedAiProvider" | "feedAiApiKey">): ProviderOverrideConfig | undefined {
  if (!hasUserLlmOverride(profile as UserProfile)) return undefined;
  return { provider: profile.feedAiProvider as ProviderOverrideConfig["provider"], apiKey: (profile.feedAiApiKey ?? "").trim() };
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The two parts, as the server sent them — and, P4-00c, the table when it sent one, read as a
 *  reply's is (the rows that are three cells of words, at most four) — or null for anything else. */
function asAnswer(value: unknown): ExplainAnswer | null {
  const answer = (value as { answer?: unknown } | null)?.answer as { meaning?: unknown; here?: Record<string, unknown>; items?: unknown } | undefined;
  if (!answer || !isText(answer.meaning) || !answer.here || !isText(answer.here.text)) return null;
  const { here } = answer;
  const items = asItems(answer.items);
  return {
    meaning: answer.meaning,
    here: {
      text: here.text as string,
      ...(isText(here.evidence) ? { evidence: here.evidence } : {}),
      ...(isText(here.evidenceWhere) ? { evidenceWhere: here.evidenceWhere } : {}),
      ...(isText(here.sectionId) ? { sectionId: here.sectionId } : {}),
      ...(typeof here.page === "number" ? { page: here.page } : {}),
      ...(here.peer === true ? { peer: true as const } : {}),
    },
    ...(items.length > 0 ? { items } : {}),
  };
}

/**
 * The one request "Explain this?" makes, when the reader clicks: the paper, the
 * passage and where it sits (the first message has no thread, and never asks to
 * search), and the reader's own key only when they have one. An answer,
 * "not_in_paper" when the server says the words are not the paper's (422), and
 * "unavailable" for everything else — an outage, a refusal, a gone upload, a reply
 * that is not what was promised.
 */
export async function requestExplanation(args: {
  paper: Paper;
  selection: SelectionTarget;
  sectionId: string;
  llmOverride?: ProviderOverrideConfig;
}): Promise<AskResult> {
  const { paper, selection, sectionId, llmOverride } = args;
  try {
    const response = await postExplain(paper.id, {
      paper,
      passage: selection.passage,
      sectionId,
      paragraphIndex: selection.paragraphIndex,
      thread: [],
      ...(selection.source !== undefined && selection.source !== "paper" ? { source: selection.source } : {}),
      ...(llmOverride ? { llmOverride } : {}),
    });
    if (response.status === 422) return "not_in_paper";
    return (response.ok ? asAnswer(response.body) : null) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

// ── The card ───────────────────────────────────────────────────────────

/** A part's label, in the label face — with Peer's own label beside it when the
 *  words under it are Peer's. */
function PartHeading({ children, peers }: { children: string; peers: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <p className="font-mono text-caption text-text-muted">{children}</p>
      {peers && <span className="annotation text-text-faint">{PEERS_READING}</span>}
    </div>
  );
}

/** The columns of a reply's table: a narrow one for the term, the other two share the rest. */
const TABLE_COLUMNS = ["w-[26%]", "w-[37%]", "w-[37%]"] as const;

/** A reply's term table (P3-07): the headers in the label face, from `copy.ts`; the cells
 *  in the reading face, a step smaller than the prose so three columns fit the card. Peer's
 *  words, so no quote styling; nothing in it links anywhere. */
function ItemsTable({ items }: { items: readonly ExplainItem[] }) {
  return (
    <table className="mt-2 w-full table-fixed border-collapse text-left">
      <thead>
        <tr>
          {[EXPLAIN.tableTerm, EXPLAIN.tableHere, EXPLAIN.tableRead].map((label, column) => (
            <th key={label} scope="col" className={`${TABLE_COLUMNS[column]} border-b border-border pb-1 pr-3 align-bottom font-mono text-caption font-normal text-text-muted`}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, row) => (
          <tr key={row} className="align-top">
            {[item.term, item.here, item.read].map((cell, column) => (
              <td key={column} className="font-reading text-body-sm leading-[1.45] text-text break-words border-b border-border py-2 pr-3">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One message of the thread: the reader's under "You"; Peer's under "Peer", the
 *  paper's own sentence through `EvidenceQuote` when it was verified, else Peer's
 *  reading label beside the prose and no quote (§1f.17). A reply's term table (P3-07)
 *  sits under its prose and above its quote. */
function TurnView({ turn }: { turn: ExplainTurn }) {
  if (turn.role === "reader") {
    return (
      <div>
        <p className="font-mono text-caption text-text-muted">{EXPLAIN.you}</p>
        <p className="font-reading text-body leading-[1.6] text-text mt-1 whitespace-pre-wrap">{turn.text}</p>
      </div>
    );
  }
  return (
    <div>
      <PartHeading peers={turn.peer === true}>{EXPLAIN.peer}</PartHeading>
      <p className="font-reading text-body leading-[1.6] text-text mt-1">{turn.text}</p>
      {turn.items && turn.items.length > 0 && <ItemsTable items={turn.items} />}
      {turn.evidence && turn.peer !== true && <EvidenceQuote text={turn.evidence} where={turn.evidenceWhere ?? "abstract"} page={turn.page} />}
    </div>
  );
}

/**
 * The card itself: its passage as a quote, the paper's own definition when it
 * has one, and, with a key, the model's two parts or the state it is in; then,
 * once there is a first answer to talk about, the thread and — pinned at the
 * foot, outside the part that scrolls — the input and its Send button.
 * Presentational and hook-free: `ExplainBox` owns what it shows and where.
 */
export function ExplainCard({
  passage,
  heading,
  term,
  termWhere,
  canAsk,
  status,
  onClose,
  style,
  thread,
  sheet,
  dock,
  source,
  cardRef,
  inputRef,
}: {
  passage: string;
  /** The heading of the section the passage sits in. */
  heading: string;
  /** The paper's own definition of a term inside the passage, if it has one. */
  term: PaperTerm | null;
  termWhere: { where: string; page?: number } | null;
  canAsk: boolean;
  status: ExplainStatus;
  onClose: () => void;
  style?: CSSProperties;
  /** P3-02b: the thread and its handlers; drawn only with a key and a first answer. */
  thread?: ThreadView;
  /** A phone's bottom sheet, flush with the screen's foot and sides: square corners all round, as the page's cards (the theme's radius scale is 0, so the card's `rounded-*` classes draw nothing; P3-02d). */
  sheet?: boolean;
  /** P7-15: the dock at the window's right edge. A column against it: a line on its left, top and bottom and none
   *  on the right; P8-02: as tall as its content, level with its paragraph, so it stands free of the masthead
   *  and the legend (it was a window-high column with a line on its left only), the controls pinned at its foot. */
  dock?: boolean;
  /** P10-08 (review 8.4): where the passage is from. A selection in the Summary or an answer is Peer's reading, not the paper's words, so its
   *  first words are shown as Peer's own under a label naming where they are from, not as a quote with a section (§1f.17). The paper's body when absent. */
  source?: ExplainSource;
  /** The card itself — the one thing that scrolls, and what the sheet's height is read from. */
  cardRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const asking = canAsk && status.kind === "answer" ? thread : undefined;
  const full = asking ? threadFull(asking.turns) : false;
  const sendBlocked = (asking?.pending ?? false) || full;
  return (
    <div
      // P9-20 (BACKLOG-44; A P8-05 §11.8; the owner: "改"): a region, not a dialog. The window is non-modal and never traps the focus (the page
      // behind it stays usable), so announcing a dialog told a screen reader a lie. A named non-modal landmark:
      // `region`, not `complementary` — the box mounts inside the page's `<main>`, where a complementary landmark is flagged
      // (axe `landmark-complementary-is-top-level`), a named region is not; and the card and the sheet are the same content in
      // another place, not a sidebar. The name is the label below: the explanation of the selected passage.
      role="region"
      aria-label={EXPLAIN.card}
      data-explain-card=""
      {...(sheet ? { "data-explain-sheet": "" } : {})}
      {...(dock ? { "data-explain-dock": "" } : {})}
      ref={cardRef}
      // The container can take the focus (never in the tab order), so a script can hand it the focus. It is no control, so it draws no ring.
      tabIndex={-1}
      style={style}
      // P9-20 (A P9-W2's N4): the quotes in this 360 px window (and the phone's sheet) are set ragged-right, not justified: the body's
      // `reading-justify` opened word gaps 4.4 times a space at this measure. The override is scoped to the window; the paper's own
      // column keeps its justification (the design).
      className={`fixed z-[70] overflow-y-auto border border-border-strong bg-surface p-4 outline-none [&_.reading-justify]:text-left ${
        dock ? "flex flex-col border-r-0" : `shadow-card-hover ${sheet ? "rounded-t-lg border-b-0" : "rounded-lg"}`
      }`}
    >
      {/* The card is what scrolls; its header stays at the top and its input at the foot (sticky, offset by the card's own padding,
          which a sticky box would otherwise stop short of). P10-08 (review 8.4, 8.5; the owner: the top-left close "要改成一个大大的X，并高亮"):
          Close is a large X in the accent colour at the header's top-left — 36 px (44 where there is no hover), the page's own accent, a
          button the keyboard reaches — with the window's title beside it; the passage's quote is under both. */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-explain-close=""
            aria-label={EXPLAIN.close}
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-accent text-bg transition-colors hover:bg-accent/90 [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <p className="min-w-0 flex-1 font-mono text-caption text-heading">{EXPLAIN.title}</p>
        </div>
        <div className="mt-3 min-w-0">
          {source === undefined || source === "paper" ? (
            <EvidenceQuote text={previewOf(passage)} where={heading} />
          ) : (
            <>
              <p className="annotation text-text-faint">{source === "summary" ? EXPLAIN.fromSummary : EXPLAIN.fromAnswer}</p>
              <p className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-2">{previewOf(passage)}</p>
            </>
          )}
        </div>
      </div>

      {term?.evidence && termWhere && (
        <div className="mt-4">
          <p className="font-mono text-caption text-text-muted">{EXPLAIN.defines(term.term)}</p>
          <EvidenceQuote text={term.evidence} where={termWhere.where} page={termWhere.page} />
        </div>
      )}

      {canAsk && status.kind !== "none" && (
        <div role="status" aria-live="polite" className={`mt-4 space-y-4 ${dock ? "mb-4" : ""}`}>
          {status.kind === "loading" && <p className="annotation text-text-faint">{EXPLAIN.loading}</p>}
          {status.kind === "unavailable" && <p className="annotation text-text-faint">{EXPLAIN.unavailable}</p>}
          {status.kind === "not_in_paper" && <p className="annotation text-text-faint">{EXPLAIN.notInPaper}</p>}
          {status.kind === "answer" && (
            <>
              <section>
                <PartHeading peers>{EXPLAIN.meaning}</PartHeading>
                <p className="font-reading text-body leading-[1.6] text-text mt-2">{status.answer.meaning}</p>
              </section>
              <section>
                <PartHeading peers={status.answer.here.peer === true}>{EXPLAIN.here}</PartHeading>
                <p className="font-reading text-body leading-[1.6] text-text mt-2">{status.answer.here.text}</p>
                {status.answer.here.evidence && status.answer.here.peer !== true && (
                  <EvidenceQuote text={status.answer.here.evidence} where={status.answer.here.evidenceWhere ?? "abstract"} page={status.answer.here.page} />
                )}
              </section>
              {status.answer.items && status.answer.items.length > 0 && <ItemsTable items={status.answer.items} />}
              {asking?.turns.map((turn, index) => <TurnView key={index} turn={turn} />)}
              {asking?.onSayMore && sayMoreOf(asking.turns) !== null && (
                // P3-07: one button, under Peer's latest reply only — and never under the first
                // answer (no turn yet), nor under a reply that is already the long form.
                <button
                  type="button"
                  data-explain-say-more=""
                  disabled={sendBlocked}
                  onClick={() => asking.onSayMore?.()}
                  className="rounded-full border border-border-strong bg-surface px-3 py-1 font-mono text-caption text-text-muted transition-colors hover:text-heading disabled:opacity-50"
                >
                  {EXPLAIN.sayMore}
                </button>
              )}
              {asking?.pending && <p className="annotation text-text-faint">{EXPLAIN.thinking}</p>}
              {asking?.failed && <p className="annotation text-text-faint">{EXPLAIN.unavailable}</p>}
              {full && <p className="annotation text-text-faint">{EXPLAIN.threadFull}</p>}
            </>
          )}
        </div>
      )}

      {asking && (
        // The control row: the input, then Send. (P10-08, review 8.6: the web-search toggle that stood at its start is gone.)
        <div
          data-explain-controls=""
          className={`sticky -bottom-4 -mx-4 -mb-4 ${dock ? "mt-auto" : "mt-4"} flex flex-wrap items-end gap-2 border-t border-border bg-surface p-3 ${sheet ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : ""}`}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={asking.draft}
            maxLength={MAX_EXPLAIN_MESSAGE_CHARS}
            disabled={sendBlocked}
            placeholder={EXPLAIN.placeholder}
            aria-label={EXPLAIN.placeholder}
            onChange={(event) => asking.onDraft(event.target.value)}
            onKeyDown={(event) => {
              // 229 is how some browsers report the key that ends an IME composition.
              if (!keyToSend({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing || event.keyCode === 229 })) return;
              event.preventDefault();
              asking.onSend();
            }}
            className="max-h-[4.5rem] min-h-9 min-w-0 flex-1 resize-none rounded-md border border-border-strong bg-surface px-3 py-2 font-reading text-body leading-[1.4] text-text placeholder:text-text-faint disabled:opacity-60"
          />
          <button
            type="button"
            data-explain-send=""
            disabled={sendBlocked || asking.draft.trim() === ""}
            onClick={() => asking.onSend()}
            className="shrink-0 rounded-full border border-border-strong bg-surface px-3 py-2 font-mono text-caption text-heading transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {EXPLAIN.send}
          </button>
        </div>
      )}
    </div>
  );
}

// ── The box ────────────────────────────────────────────────────────────

interface Session {
  /** The selection the card was opened for. */
  selection: ExplainSelection;
  status: ExplainStatus;
  /** The thread after the first answer, as this session has it. */
  turns: ExplainTurn[];
  /** What the reader has typed and not sent. */
  draft: string;
  reply: "idle" | "pending" | "failed";
}

const noThread = { turns: [] as ExplainTurn[], draft: "", reply: "idle" as const };
/** The input grows to three lines, then scrolls. */
const INPUT_MAX_HEIGHT = 72;

export interface ExplainBoxProps {
  /** What the reader has selected in the body, or null. */
  target: ExplainSelection | null;
  /** P3-01's terms as the page holds them: the paper's definitions and the model's. */
  terms: readonly PaperTerm[];
  /** Whether the reader has a model to ask (their own key, or Peer's signed in). */
  canAsk: boolean;
  /** The one request, made when the reader clicks — never before. */
  onAsk: (target: SelectionTarget) => Promise<AskResult>;
  /** An answer already kept for this passage: opens at once, no request. */
  cached?: ExplainAnswer;
  /** The body the passage sits in and the map its sections are named by. */
  reading: Pick<PaperReading, "body" | "map">;
  /** P3-02b: the thread kept for this passage, shown under the kept answer. */
  cachedTurns?: readonly ExplainTurn[];
  /** The send — the second kind of request, made when the reader presses Enter
   *  or Send, never before: the target, the thread so far (the first answer
   *  first) and the new message. Without it the box has no thread. (P10-08, review 8.6: there is no fourth argument; a reply never searches.) */
  onReply?: (target: SelectionTarget, thread: readonly ExplainTurn[], message: string) => Promise<ReplyResult>;
  /** P3-07: "Say more" — the same kind of request as a send, made when the reader presses it,
   *  never before: the target, the thread before the reader's last message (the first answer
   *  first) and that message — which is not repeated — to be answered in the long form. Without
   *  it the box has no such button. */
  onSayMore?: (target: SelectionTarget, thread: readonly ExplainTurn[], message: string) => Promise<ReplyResult>;
  /** Called when a passage whose thread is full is opened again: the page drops that thread. */
  onResetThread?: (target: SelectionTarget) => void;
  /** Filled with the box's `open`, which does what the button's click does on the
   *  current selection — the page's `e` key calls it. With the box already open
   *  it moves to the input instead. */
  openRef?: { current: (() => void) | null };
}

export function ExplainBox({ target, terms, canAsk, onAsk, cached, reading, cachedTurns, onReply, onSayMore, onResetThread, openRef }: ExplainBoxProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [viewport, setViewport] = useState<Viewport>(currentViewport);
  // P10-18: what the other floating windows need below the dock (0 while none stands); a number, so the box re-renders only when the stack's need changes.
  const [stackRoomPx, setStackRoomPx] = useState(() => stackRoom(useWindows.getState().windows));
  useEffect(() => {
    const read = () => setStackRoomPx(stackRoom(useWindows.getState().windows));
    read();
    return useWindows.subscribe(read);
  }, []);
  // P9-03b: the last settled selection the reader made — what the window stands level with once the selection itself
  // has gone away (a click in the window collapses it; the window must not jump back from under the pointer).
  const [followed, setFollowed] = useState<ExplainSelection | null>(null);
  // P9-17 (ruling §1h.57): the card's own height as the browser made it, read after each commit while the dock stands — what the
  // window needs below its top. null until it is read (a server render, the first paint, a test with no DOM).
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  // A new selection closes the card and the sheet; one that merely went away does not (a click
  // in the card collapses it). P8-02: the dock, from 1024 px, is not closed by a new selection — it
  // stays, and the reader takes the new passage into it with "Explain this" or `e`. Derived, so the
  // stale card never paints.
  const stale = session !== null && target !== null && target.passage !== session.selection.passage && viewport.width < DOCK_MIN_VIEWPORT_PX;
  const open = stale ? null : session;
  if (stale) setSession(null);

  // The selection the open window explains (null with none open), and the one the selection buttons and `e`
  // would take into it: the reader's current selection, when it is not the passage already there.
  const placed = open?.selection ?? null;
  const offered = target !== null && target.passage !== placed?.passage ? target : null;
  const anchor = placed ?? target;
  // P9-03b: the selection the window stands level with: the settled one, else the last one it followed (derived while
  // rendering, like `stale`, so the move is in the same paint as the selection).
  if (target !== null && target !== followed) setFollowed(target);
  const stand = target ?? followed;
  // What is measured again as the page scrolls: with a window open, the selection it stands level with; with none, only the selection
  // there is (the last one followed matters to a window that is not there).
  const following = open !== null ? stand : target;
  /** Close: the window goes, and the page gets its width back. Escape does the same (below). */
  const close = () => setSession(null);
  const [measured, setMeasured] = useState<Array<{ of: ExplainSelection; where: ViewRects }>>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const live = useRef<Session | null>(null);
  const refocus = useRef(false);
  const wasPending = useRef(false);
  /** Reads where the selection is again, on the next frame (below); null with no selection. */
  const remeasure = useRef<(() => void) | null>(null);

  // Where the selections are, measured again as the page scrolls or resizes: the one the window
  // explains, and the one it stands level with (the thumb bar's offer, for the selection on offer, reads the same measure).
  useEffect(() => {
    const watched = [...new Set([placed, following])].filter((selection): selection is ExplainSelection => selection !== null);
    if (watched.length === 0) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      // The same size is the same state: a scroll frame that moved nothing renders nothing.
      const size = currentViewport();
      setViewport((previous) => (sameViewport(previous, size) ? previous : size));
      const read = watched.map((selection) => ({ of: selection, where: selection.measure?.() ?? null }));
      // A selection that cannot be measured now (it has no size) keeps where it was last read.
      if (read.some((one) => one.where !== null)) {
        setMeasured((previous) => read.flatMap((one) => (one.where !== null ? [{ of: one.of, where: one.where }] : previous.filter((kept) => kept.of === one.of))));
      }
    };
    const onMove = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };
    remeasure.current = onMove;
    // P10-08 (B P10-01's step 2): the viewport is read here and nowhere else — when something is selected or open, on a resize, and
    // when the reader's Fit or reading size changes (the legend's height follows the page's zoom, which changes with no scroll and
    // no resize of this window; the page has re-rendered by the next frame). It used to be read again after every commit.
    const size = currentViewport();
    setViewport((previous) => (sameViewport(previous, size) ? previous : size));
    const unsubscribe = useReadingPrefsStore.subscribe((state, before) => {
      if (state.fit !== before.fit || state.scaleIndex !== before.scaleIndex) onMove();
    });
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      if (remeasure.current === onMove) remeasure.current = null;
      unsubscribe();
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [placed, following]);

  // P7-15 (R7, Q4): while the box stands as the dock the page keeps its width clear (`reserveDock`),
  // so the text reflows beside it instead of running under it, and gives the width back when the box
  // closes or the window narrows below the dock's. The reflow moves the words — a selection deep in a
  // paper lands hundreds of pixels lower in a narrower column — so, before the next paint, the box
  // reads where the selection's top is, changes the layout, reads it again and scrolls the page by the
  // difference: the words stay where the reader's eyes are, and the highlight (the browser's own
  // selection, which the reflow does not touch) and the button follow them.
  // P10-08 (review 8.5): the page's width is kept clear only while a passage is open — taken when the dock opens, given back when it
  // closes; on entering a paper nothing is reserved.
  const docked = open !== null && viewport.width >= DOCK_MIN_VIEWPORT_PX;
  const reserved = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!docked && reserved.current === null) return;
    const before = anchor?.measure?.()?.bounds.top;
    if (docked) reserved.current = reserveDock(typeof document === "undefined" ? null : document.documentElement);
    else {
      reserved.current?.();
      reserved.current = null;
    }
    const after = before === undefined ? undefined : anchor?.measure?.()?.bounds.top;
    if (before !== undefined && after !== undefined && Math.abs(after - before) >= 1) window.scrollBy({ top: after - before, behavior: "instant" });
    // `anchor` is read as it is when `docked` changes: the window's passage when it opens, the reader's current
    // selection when it closes (P8-02: a new passage no longer closes the dock, so that is Escape, Close, or a narrower window).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);
  // P9-17 (ruling §1h.57): the window's whole height must be in view, so its height is read after each commit while the dock
  // stands: `scrollHeight` (the content, whatever `max-height` clips) and the border. It does not depend on where the window is,
  // so the move it causes settles at once. After every commit on purpose: whatever changes what the card holds — a reply, a draft,
  // the control, a late font — is read, with no list of the causes to keep up. Before the paint, so no frame shows the old place.
  // P10-08 (review 1.1; B P10-01; ruling §1h.80): this is the effect React's "Maximum update depth exceeded" named, and the
  // number that moved was never found, so it is built so that no feedback can run away: a reading within 2 px of the held height is
  // the same height, and a burst of more than 8 writes with nothing changed by the reader, or an A, B, A pattern, settles on the
  // larger height and writes no more (`settleHeight`) until the reader changes something or the next frame (the guard resets).
  // The viewport is not read here any more (above: the selection watcher reads it, on a resize and on Fit's change).
  const heightGuard = useRef(newHeightGuard());
  const guardFrame = useRef<number | undefined>(undefined);
  const readerKey = [open?.selection.passage, open?.status.kind, open?.turns.length, open?.reply, open?.draft, docked, viewport.width, viewport.height, viewport.legend].join("\u0001");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!docked || !card) return;
    const height = card.scrollHeight + (card.offsetHeight - card.clientHeight);
    if (!Number.isFinite(height)) return;
    const write = settleHeight(heightGuard.current, cardHeight, height, readerKey);
    if (write === null) return;
    setCardHeight(write);
    if (guardFrame.current === undefined && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      guardFrame.current = window.requestAnimationFrame(() => {
        guardFrame.current = undefined;
        resetHeightGuard(heightGuard.current);
      });
    }
  });
  useLayoutEffect(
    () => () => {
      if (guardFrame.current !== undefined && typeof window !== "undefined") window.cancelAnimationFrame(guardFrame.current);
    },
    [],
  );
  // Leaving the paper with the dock open gives the width back — and scrolls nothing: the next page is not this one's.
  useLayoutEffect(
    () => () => {
      reserved.current?.();
      reserved.current = null;
    },
    [],
  );
  // Once the page has settled after either change, where the selection is gets read again, for the button
  // (after the effect above that follows the selection, so that a new passage's own measure is the one called).
  const dockedBefore = useRef(false);
  useEffect(() => {
    if (dockedBefore.current === docked) return;
    dockedBefore.current = docked;
    remeasure.current?.();
  }, [docked]);

  // While a window holds a passage: Escape clears it and CLOSES the window (and goes no further — the page's own Escape means
  // "back"), and so does a press outside it — all but the dock's (above). P10-08 (review 8.5): there is no empty state to go back
  // to, so Escape and Close do the same thing — the thread dropped, the answer kept for the passage staying kept, the width given
  // back; with no window open there is NO listener here at all — Escape is the page's and its other handlers' (the figure lightbox,
  // a term highlight, the help sheet, a field being edited, "back").
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSession(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Element | null;
      if (node?.closest?.("[data-explain-card]")) {
        return;
      }
      if (!docked) setSession(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen, docked]);

  // The paper's own definition inside the open window's passage; and inside the new selection's, which
  // is what makes its button worth showing for a reader with no key.
  const term = placed ? definingTerm(terms, placed.passage) : null;
  const offeredTerm = offered ? definingTerm(terms, offered.passage) : null;
  const next = offered !== null && (offeredTerm !== null || canAsk) ? offered : null;
  const asked = (selection: ExplainSelection): SelectionTarget => ({
    sectionIndex: selection.sectionIndex,
    paragraphIndex: selection.paragraphIndex,
    passage: selection.passage,
    ...(selection.source !== undefined ? { source: selection.source } : {}),
    ...(selection.paragraphId !== undefined ? { paragraphId: selection.paragraphId } : {}),
  });

  // What the button's click does — and what `e` does through `openRef`: explain `selection` (the
  // current one). With a window already open the session is replaced in place — never null on the way.
  const start = (selection: ExplainSelection) => {
    if (!canAsk) {
      setSession({ selection, status: { kind: "none" }, ...noThread });
      return;
    }
    // A full thread is dropped when its passage is opened again: the first
    // answer stays, the conversation starts over.
    const kept = cachedTurns ?? [];
    const full = threadFull(kept);
    if (full) onResetThread?.(asked(selection));
    if (cached) {
      setSession({ selection, status: { kind: "answer", answer: cached }, ...noThread, turns: full ? [] : [...kept] });
      return;
    }
    setSession({ selection, status: { kind: "loading" }, ...noThread });
    void onAsk(asked(selection))
      .catch((): AskResult => "unavailable")
      .then((result) =>
        setSession((current) =>
          current !== null && current.selection.passage === selection.passage
            ? { ...current, status: typeof result === "string" ? { kind: result } : { kind: "answer", answer: result } }
            : current,
        ),
      );
  };

  // The send: the one request of a follow-up. Nothing happens for an empty
  // draft, a reply already on its way or a full thread; the reply joins the thread, with the message it answers, only once it has
  // arrived. A reply never searches the web (P10-08, review 8.6).
  const send = () => {
    if (!open || !onReply || open.status.kind !== "answer") return;
    if (open.reply === "pending" || threadFull(open.turns)) return;
    const message = open.draft.trim();
    if (!message) return;
    const selection = open.selection;
    const thread = [firstAnswerMessage(open.status.answer), ...open.turns];
    refocus.current = inputRef.current !== null && typeof document !== "undefined" && document.activeElement === inputRef.current;
    setSession((current) => (current ? { ...current, reply: "pending" } : current));
    void onReply(asked(selection), thread, message)
      .catch((): ReplyResult => "unavailable")
      .then((result) =>
        setSession((current) => {
          if (current === null || current.selection.passage !== selection.passage) return current;
          if (typeof result === "string") return { ...current, reply: "failed" };
          return { ...current, reply: "idle", draft: "", turns: [...current.turns, ...replyPair(message, result)] };
        }),
      );
  };

  // "Say more" (P3-07): re-send the reader's last message in the long form — the thread
  // before it, then the message, no copy of it (`sayMoreOf`). It does nothing for a reply
  // already on its way, a full thread, or no reply to lengthen; the reply joins the
  // thread as Peer's turn alone, only once it has arrived; a failed one leaves the
  // thread as it was; the draft the reader was typing stays.
  const sayMore = () => {
    if (!open || !onSayMore || open.status.kind !== "answer") return;
    if (open.reply === "pending" || threadFull(open.turns)) return;
    const more = sayMoreOf(open.turns);
    if (!more) return;
    const selection = open.selection;
    const thread = [firstAnswerMessage(open.status.answer), ...more.before];
    setSession((current) => (current ? { ...current, reply: "pending" } : current));
    void onSayMore(asked(selection), thread, more.message)
      .catch((): ReplyResult => "unavailable")
      .then((result) =>
        setSession((current) => {
          if (current === null || current.selection.passage !== selection.passage) return current;
          if (typeof result === "string") return { ...current, reply: "failed" };
          return { ...current, reply: "idle", turns: [...current.turns, ...moreReply(result)] };
        }),
      );
  };

  const openBox = () => {
    // A selection the window does not hold yet: explain it (in the window, when one is open).
    if (next) {
      start(next);
      return;
    }
    // Already open, with nothing new selected: `e` goes to the input, to ask the next thing.
    if (open) inputRef.current?.focus();
  };

  const draft = open?.draft ?? "";
  const replyState = open?.reply;
  const answered = open?.status.kind === "answer";
  const turnCount = open?.turns.length ?? 0;
  const sheet = open !== null && viewport.width < PHONE_WIDTH;

  // The page's `e` key opens the box through this, as the button does.
  useEffect(() => {
    if (!openRef) return;
    openRef.current = openBox;
    return () => {
      if (openRef.current === openBox) openRef.current = null;
    };
  });

  // The latest session, for the effects that act on its arrival and growth.
  useEffect(() => {
    live.current = open;
  });

  // On a phone the sheet covers the foot of the window: as it opens and the
  // thread grows, scroll the page so the selection stays above it where it can.
  useEffect(() => {
    const current = live.current;
    const height = cardRef.current?.getBoundingClientRect().height;
    if (!sheet || !current || !height) return;
    const shift = revealShift((current.selection.measure?.() ?? current.selection).bounds, currentViewport(), height);
    if (shift > 0) window.scrollBy({ top: shift });
  }, [sheet, answered, turnCount]);

  // A passage taken into the window (P8-02) starts at the window's top, not where the last one was
  // scrolled to — the window is the same element; then the newest message is the one in view.
  const passageOpen = open?.selection.passage;
  useEffect(() => {
    const card = cardRef.current;
    if (card) card.scrollTop = 0;
  }, [passageOpen]);
  useEffect(() => {
    const card = cardRef.current;
    if (card && turnCount > 0) card.scrollTop = card.scrollHeight;
  }, [passageOpen, turnCount, replyState]);

  // The input grows to three lines as the reader types, and shrinks when it is cleared.
  useEffect(() => {
    const input = inputRef.current;
    if (!input?.style) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  // A reply that arrives (or fails) hands the input back to a reader who sent from it.
  useEffect(() => {
    if (replyState === "pending") {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if (refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [replyState]);

  /** Where `selection` is now: as it was last measured, else as it was read. */
  const whereOf = (selection: ExplainSelection): ViewRects => measured.find((one) => one.of === selection)?.where ?? selection;

  // P9-41 (ruling §1h.66): under 768 px the thumb bar is the page's foot (`md:hidden`), and the control is a cell of its rail, not a
  // pill (a pill above the bar covered 1,790 to 2,473 px² of the words scrolling under it). The box draws nothing there and says, through
  // `explain-offer.ts`, whether the bar should show the cell: while a control is on offer for the current selection (`next`: settled, the
  // reader's to explain — a key, or a defined term of the paper) and that selection is not wholly out of the viewport — scrolled away
  // above the screen or below it (read as the page scrolls, `measured`), the cell goes and the rail is as it was; scrolled back, it
  // returns. The bar's press is the page's `explain` action, which is `openBox` (`openRef`): the window opens for the selection, and
  // there is nothing on offer after that. Taken back when the page is left.
  const nextAt = next ? whereOf(next) : null;
  const inBar = nextAt !== null && viewport.width < MASTHEAD_MIN_VIEWPORT_PX && nextAt.bounds.bottom > 0 && nextAt.bounds.top < viewport.height;
  useEffect(() => {
    setExplainOffer(inBar);
  }, [inBar]);
  useEffect(() => () => setExplainOffer(false), []);

  // Nothing is drawn until the reader asks: no empty window on entry, no pill beside a selection (review 8.4, 8.5). The window
  // exists only while a passage is open; the selection buttons and `e` open it (`openBox`, through `openRef`).
  if (!open) return null;
  // P9-03b: where the window stands level with: the selection it follows (`stand`), measured as of now.
  const standAt = stand ? whereOf(stand) : null;

  const placedAt = whereOf(open.selection);
  // The dock stands level with the selected paragraph; the card and the sheet with the passage they explain.
  const levelWith = docked && standAt ? standAt : placedAt;
  const levelSelection = docked && stand ? stand : open.selection;
  // P9-17: the whole window stays in view (ruling §1h.57) — its measured height, and at least what a window that holds a passage
  // needs to show its header, its controls and two lines of the answer (ruling §1h.56).
  const paragraphTop = levelTopOf(levelSelection, levelWith);
  const basePlace = placePanel(levelWith.bounds, viewport, paragraphTop, Math.max(cardHeight ?? 0, DOCK_THREAD_FLOOR_PX));
  // P10-18 (X-B1, B9): the dock gives the stickies and the notes window their room — it shrinks (its body scrolls inside), so every other window's header stays reachable.
  const place: Place = basePlace.kind === "dock" && basePlace.top !== undefined
    ? { ...basePlace, ...dockInStack({ top: basePlace.top, paragraphTop: paragraphTop ?? levelWith.bounds.top, height: viewport.height, legend: legendOf(viewport), room: stackRoomPx }) }
    : basePlace;
  const heading = reading.body[open.selection.sectionIndex]?.heading ?? "";
  const threadView: ThreadView | undefined =
    canAsk && onReply && open.status.kind === "answer"
      ? {
          turns: open.turns,
          draft: open.draft,
          pending: open.reply === "pending",
          failed: open.reply === "failed",
          onDraft: (text) => setSession((current) => (current ? { ...current, draft: text.slice(0, MAX_EXPLAIN_MESSAGE_CHARS) } : current)),
          onSend: send,
          ...(onSayMore ? { onSayMore: sayMore } : {}),
        }
      : undefined;
  return (
    <ExplainCard
      passage={open.selection.passage}
      heading={heading}
      term={term}
      termWhere={term ? termSource(term, reading) : null}
      canAsk={canAsk}
      status={open.status}
      onClose={close}
      thread={threadView}
      sheet={place.kind === "sheet"}
      dock={place.kind === "dock"}
      source={open.selection.source}
      cardRef={cardRef}
      inputRef={inputRef}
      style={styleOf(place)}
    />
  );
}
