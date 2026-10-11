"use client";

// "Explain this?" — the button beside a selected passage, and the box it opens
// (P3-02, P3-02b; rulings §1h.2, §1h.3; user decision §1a.10; blueprint §3.5 ⑤
// 词, relaxed from a word to a passage up to a paragraph, then to a short
// conversation beside the text). The popover of P3-02 is this box's first state.
//
// The reader selects words of the body (`paper-body.tsx` reads the selection);
// a small button appears just below them. Clicking it is the send: nothing goes
// anywhere before it. The card then shows, in order,
//
//   - the passage's opening words, quoted from the paper with their section —
//     the paper's words go through `EvidenceQuote`, always (§1f.17);
//   - when the paper itself defines a term inside the passage (Tier 0,
//     P3-01's list), that sentence as a quote. With no key this is the whole
//     card, and with no key and no paper definition there is no button at all
//     (a locked block is not shown);
//   - with a key, the model's two parts: "What it means" (Peer's words, labelled)
//     and "Why it is here" — Peer's prose, then the paper's own sentence as a
//     quote, or, when that sentence could not be verified, the prose labelled as
//     Peer's own reading and no quote;
//   - P4-00c (§1h.11 (a)): when the passage holds two or more terms or quantities, the
//     small term table under both parts — the reply's own `ItemsTable`, in the reading
//     face with the label-face headers — and, as before, no "Say more" on the first
//     answer.
//
// An answer already kept for the passage opens at once with no request, with the
// thread that followed it. Escape, a press outside the card, or a new selection
// closes the CARD (640 to 1023 px) and the phone's sheet; a selection that merely goes away
// (a click in the card collapses it) does not. P7-15: the dock is not closed by a press outside
// it — closing it gives the page its width back, and a page that reflows on the press moves the
// word under the pointer before the press has chosen it (measured: a double-click on one word
// selected another). P8-02 (BACKLOG-31; the owner: "the AI window should stay open", ruling
// §1h.41 (b), which amends §1h.3's "a new selection closes" for the dock only): nor is it closed
// by a new selection. Once the window is open it stays, with the page's width kept clear, until
// Escape or Close — the one thing that gives the width back. A new selection gets its own
// "Explain this?" button beside the words as before; pressing it, or `e`, takes that passage into
// THE SAME window: the session is replaced in place (never null in between, so `reserveDock`'s
// properties are not taken off and put on again and the page does not reflow), the previous
// passage's thread staying the store's, kept for its passage. `e` on the open window with the
// same passage (or none selected) goes to the input, as before. Nothing here links off the page.
//
// P8-06 (the owner's "yes" of 16:4xZ 2026-10-11, ruling §1h.45): for a reader WITH A KEY, on a paper with a
// readable body, from 1024 px, the window is present from the body's first paint — before any selection, as an
// empty panel (`emptyDockStands`, `ExplainCard`'s `empty`): the card's header (the title "Explain this?" and Close)
// and one line of label-face copy (`EXPLAIN.empty`), no input, no quote, no "You" / "Peer". It is the dock all the
// same: at the right edge, top `DOCK_TOP_PX` until a passage is explained (then the paragraph's, above), and the
// page keeps its 376 px clear from the MOUNT (`reserveDock`), not from the first open. The first Explain (the
// button, or `e`) fills that same window in place — the empty state is replaced, nothing closes or reopens, the
// properties are never taken off. Escape and Close hide the window — empty or holding a passage — for the rest of
// the page visit (`hidden`: this component's state, not stored; the box is keyed by the paper, and a reload shows
// the empty panel again) and the next "Explain this?" brings it back with that passage. `e` with nothing selected
// and the empty state showing does nothing (there is no input to go to). WITHOUT A KEY nothing stands: a permanent
// panel could only say what a key unlocks, and a locked block is never shown (§1b); the Tier 0 definition opens on
// a defined-term selection as it always did, and stays open per P8-02. Below 1024 px — the card and the sheet —
// nothing changes: nothing is persistent there. While the empty state is possible and nothing is open the box
// watches the window's width (a resize alone), to give the page its width back below 1024 and to take it again
// from there; it is the page that clears a selection on a change of tab (`clearExplain`), which touches neither
// the empty state nor an open window.
//
// P3-02b: under the first answer, the thread — the reader's messages under
// "You", Peer's replies under "Peer" (a verified quote through `EvidenceQuote`,
// else Peer's label beside the prose) — and, pinned at the box's foot, a one-line
// input: Enter sends, Shift+Enter is a newline, Escape closes. The send is the
// only request (`onReply`); nothing is sent before it, a failed reply leaves the
// thread as it was and the typed words in the input, and eight reader messages
// fill the thread (it is dropped when the passage is opened again). `openRef`
// hands the page an `open` function: the `e` key does what the button does.
//
// Where it stands (`placePanel`): P7-15 (the owner's R7): from a window of 1024 px a dock
// fixed at the right edge of the screen — flush with it, 360 px wide, scrolling inside
// (`explain-dock.ts`); between 640 and 1024 the card P3-02 put under the selection, measured
// again as the page scrolls; a bottom sheet on a phone. P8-02 (the owner: "level with the first
// line of the selected paragraph"): the dock's TOP is level with the first line of the PARAGRAPH
// of the passage it explains (`ExplainSelection.paragraph`, from `paper-body.tsx`), held between
// the masthead's foot and 160 px above the legend and measured again as the page scrolls; its
// height is its content. It moves when the next passage is explained, not on a mere selection.
// The selection is measured again as the page scrolls for two things now: the open window's
// passage (where the window stands) and, while the dock is open, the NEW selection (where its
// button stands — kept clear of the dock's 376 px).
//
// P3-02c (ruling §1h.4 amendment; user decision §1a.11): at the start of the
// control row, a small toggle "Search the web" — off whenever the box opens or a
// passage is opened, never remembered, session state only. Hovering it, or giving
// it the keyboard's focus, shows a tooltip that web search costs many times more
// than a normal reply; on a touch screen, with no hover, the first tap shows the
// same line and the second turns search on (`toggleStep`). The next send carries
// it — as the reply's fourth argument, only when on — and the toggle is off again
// the moment it is sent, sent or failed. A message the server answered with search
// carries the label-face mark "searched the web" beside "You"; a reply to one that
// asked for search the provider could not give carries a one-line note. Nothing
// here links to a web source: the mark is the only trace of the search.
//
// P3-07 (ruling §1h.9; user decision §1a.14): the answers are short and exact, and the box
// shows two things for it. A reply may carry a small term table — three columns, the term,
// what it means here, how to read it, two to four rows a dozen words a cell — under its
// prose (headers in the label face from `copy.ts`, cells in the reading face; never quote-
// styled: the table is Peer's, the paper's own sentence stays an `EvidenceQuote` below it).
// And under Peer's LATEST reply — never under the first answer, never under a reply that is
// already the long form — one label-face button, "Say more", re-sends the reader's last
// message in the long form (`onSayMore`): the thread before that message and the message,
// no copy of it, so the reader count does not grow; the reply is appended as Peer's next
// turn and replaces nothing. It waits while a request is in flight and at the full thread,
// as a send does; what the reader was typing stays.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer, ExplainItem } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { MAX_EXPLAIN_MESSAGE_CHARS, threadFull, type ExplainTurn } from "@/store/explain-threads";
import type { Paper, UserProfile } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { DOCK_BOTTOM_PX, DOCK_MIN_VIEWPORT_PX, DOCK_MIN_VISIBLE_PX, DOCK_RESERVE_PX, DOCK_TOP_PX, DOCK_WIDTH_PX, emptyDockStands, reserveDock } from "./explain-dock";
import { EvidenceQuote } from "./evidence-quote";
import {
  asItems,
  firstAnswerMessage,
  keyToSend,
  postExplain,
  pressKind,
  moreReply,
  replyPair,
  sayMoreOf,
  toggleStep,
  type ReplyResult,
} from "./explain-thread";
import type { ExplainSelection, SelectionTarget, ViewRect, ViewRects } from "./paper-body";

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

/** The web-search toggle as the card draws it (P3-02c): its state, and its three
 *  events — the pointer's kind as it goes down (a finger, a mouse, a pen; none at
 *  all is the keyboard), the press, and the button losing the focus. */
export interface SearchView {
  on: boolean;
  /** The warning is showing because a touch put it there (hover and focus show it by CSS). */
  tip: boolean;
  onPointerDown: (pointerType: string) => void;
  onPress: () => void;
  onBlur: () => void;
}

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
  /** P3-02c: the web-search toggle. Without it the row has none. */
  search?: SearchView;
  /** P3-07: "Say more" — re-send the reader's last message in the long form. Without it
   *  the thread has no such button. */
  onSayMore?: () => void;
}

/** The tooltip's id: there is one box on a page, so one is enough. */
const SEARCH_TIP_ID = "explain-search-tip";

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
}

const BUTTON_WIDTH = 120;
const BUTTON_HEIGHT = 32;
const BUTTON_GAP = 6;
const BUTTON_MARGIN = 8;
const CARD_WIDTH = 360;
const CARD_MARGIN = 12;
const CARD_GAP = 8;
const CARD_ROOM = 220;
const CARD_MIN_HEIGHT = 120;
/** Below this the card takes the window's width: a phone. */
const PHONE_WIDTH = 640;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** The button: just below where the selection ends, centred on its end; above
 *  it when there is no room below; always inside the window. */
export function placeButton(rect: ViewRect, viewport: Viewport): { left: number; top: number } {
  const left = clamp(rect.right - BUTTON_WIDTH / 2, BUTTON_MARGIN, viewport.width - BUTTON_WIDTH - BUTTON_MARGIN);
  const below = rect.bottom + BUTTON_GAP;
  const top = below + BUTTON_HEIGHT > viewport.height - BUTTON_MARGIN ? Math.max(BUTTON_MARGIN, rect.top - BUTTON_GAP - BUTTON_HEIGHT) : below;
  return { left, top };
}

/** The card: 360 px wide under the whole selection on a spread, the window's
 *  width less a margin on a phone; above it when there is more room there than
 *  below — it never covers the words it explains. Its height is bounded by the
 *  room it has, and it scrolls inside. */
export function placeCard(
  rect: ViewRect,
  viewport: Viewport,
): { left: number; width: number; top?: number; bottom?: number; maxHeight: number } {
  const phone = viewport.width < PHONE_WIDTH;
  const width = phone ? viewport.width - 2 * CARD_MARGIN : CARD_WIDTH;
  const left = phone ? CARD_MARGIN : clamp(rect.left, CARD_MARGIN, viewport.width - CARD_WIDTH - CARD_MARGIN);
  const roomBelow = viewport.height - rect.bottom - CARD_GAP - CARD_MARGIN;
  const roomAbove = rect.top - CARD_GAP - CARD_MARGIN;
  if (roomBelow >= CARD_ROOM || roomBelow >= roomAbove) {
    const maxHeight = Math.max(roomBelow, CARD_MIN_HEIGHT);
    return { left, width, maxHeight, top: Math.min(rect.bottom + CARD_GAP, viewport.height - CARD_MARGIN - maxHeight) };
  }
  const maxHeight = Math.max(roomAbove, CARD_MIN_HEIGHT);
  return { left, width, maxHeight, bottom: Math.min(viewport.height - rect.top + CARD_GAP, viewport.height - CARD_MARGIN - maxHeight) };
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
 * 360 px wide, and (P8-02, BACKLOG-31) its top level with the first line of the explained passage's
 * PARAGRAPH: `top = clamp(paragraphTop, DOCK_TOP_PX, height − DOCK_BOTTOM_PX − DOCK_MIN_VISIBLE_PX)`,
 * so never above the masthead's foot and never so low that less than 160 px of it shows above the foot
 * legend. Its height is its content, at most the room from its top down to the legend (`maxHeight`);
 * the thread scrolls inside and the input is pinned at its foot. The words of the selection do not enter
 * it — `bounds` only does where the body reported no paragraph (the selection's own first line then).
 * Below 640: a sheet — the window's width, on its bottom edge, at most 60% of its
 * height. Between the two P3-02's place (`placeCard`), under or above the selection, unchanged.
 */
export function placePanel(bounds: ViewRect, viewport: Viewport, paragraphTop?: number): Place {
  if (viewport.width < PHONE_WIDTH) {
    return { kind: "sheet", left: 0, width: viewport.width, bottom: 0, maxHeight: Math.floor(viewport.height * SHEET_SHARE) };
  }
  if (viewport.width >= DOCK_MIN_VIEWPORT_PX) {
    const top = clamp(paragraphTop ?? bounds.top, DOCK_TOP_PX, viewport.height - DOCK_BOTTOM_PX - DOCK_MIN_VISIBLE_PX);
    return { kind: "dock", right: 0, width: DOCK_WIDTH_PX, top, maxHeight: Math.max(0, viewport.height - top - DOCK_BOTTOM_PX) };
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

/** Where nothing is selected: the empty state's `placePanel` has no words to stand by (the dock ignores them). */
const NO_BOUNDS: ViewRect = { left: 0, top: 0, right: 0, bottom: 0 };

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

function currentViewport(): Viewport {
  return typeof window === "undefined" ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight };
}

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
        {turn.searched === true ? (
          // P3-02c: the one trace of a search — a label-face mark beside "You", so the
          // cost of this message can be explained afterwards. Never a source.
          <div className="flex flex-wrap items-baseline gap-x-3">
            <p className="font-mono text-caption text-text-muted">{EXPLAIN.you}</p>
            <span className="annotation text-text-faint">{EXPLAIN.searchedMark}</span>
          </div>
        ) : (
          <p className="font-mono text-caption text-text-muted">{EXPLAIN.you}</p>
        )}
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
      {turn.searchUnavailable === true && <p className="annotation mt-2 text-text-faint">{EXPLAIN.searchUnavailable}</p>}
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
  empty,
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
  /** P8-06 (ruling §1h.45): the window's EMPTY state — there before anything is explained. The same frame and header
   *  (the title "Explain this?" in place of the passage's quote, and Close) and, under it, the one line `EXPLAIN.empty`
   *  in the label face; no definition, no answer, no input, no thread, whatever else it is handed. */
  empty?: boolean;
  /** The card itself — the one thing that scrolls, and what the sheet's height is read from. */
  cardRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const asking = !empty && canAsk && status.kind === "answer" ? thread : undefined;
  const full = asking ? threadFull(asking.turns) : false;
  const sendBlocked = (asking?.pending ?? false) || full;
  return (
    <div
      role="dialog"
      aria-label={empty ? EXPLAIN.ask : EXPLAIN.card}
      data-explain-card=""
      {...(sheet ? { "data-explain-sheet": "" } : {})}
      {...(dock ? { "data-explain-dock": "" } : {})}
      {...(empty ? { "data-explain-empty": "" } : {})}
      ref={cardRef}
      style={style}
      className={`fixed z-[70] overflow-y-auto border border-border-strong bg-surface p-4 ${
        dock ? "flex flex-col border-r-0" : `shadow-card-hover ${sheet ? "rounded-t-lg border-b-0" : "rounded-lg"}`
      }`}
    >
      {/* The card is what scrolls; its passage stays at the top and its input at the foot (sticky,
          offset by the card's own padding, which a sticky box would otherwise stop short of). */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          {empty ? (
            // P8-06: nothing is explained yet, so the header holds the window's title where the passage's quote goes.
            <p className="font-mono text-caption text-heading">{EXPLAIN.ask}</p>
          ) : (
            <EvidenceQuote text={previewOf(passage)} where={heading} />
          )}
        </div>
        <button type="button" onClick={onClose} className="annotation shrink-0 text-text-faint transition-colors hover:text-heading">
          {EXPLAIN.close}
        </button>
      </div>

      {empty && <p className="mt-4 font-mono text-caption text-text-muted">{EXPLAIN.empty}</p>}

      {!empty && term?.evidence && termWhere && (
        <div className="mt-4">
          <p className="font-mono text-caption text-text-muted">{EXPLAIN.defines(term.term)}</p>
          <EvidenceQuote text={term.evidence} where={termWhere.where} page={termWhere.page} />
        </div>
      )}

      {!empty && canAsk && status.kind !== "none" && (
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
        // The control row: the input, then Send — and (P3-02c) at its start the one
        // small toggle, on a line of its own so the input keeps the card's width.
        <div
          data-explain-controls=""
          className={`sticky -bottom-4 -mx-4 -mb-4 ${dock ? "mt-auto" : "mt-4"} flex flex-wrap items-end gap-2 border-t border-border bg-surface p-3 ${sheet ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : ""}`}
        >
          {asking.search && (
            <div data-explain-search="" className="w-full">
              {/* The tooltip is the button's next sibling: hover and keyboard focus show it by
                  CSS (`peer-hover`, `peer-focus-visible`, which a touch screen never matches);
                  a touch's first tap shows it by its attribute. */}
              <span className="relative inline-flex">
                <button
                  type="button"
                  data-explain-search-toggle=""
                  aria-pressed={asking.search.on}
                  aria-describedby={SEARCH_TIP_ID}
                  disabled={sendBlocked}
                  onPointerDown={(event) => asking.search?.onPointerDown(event.pointerType)}
                  onClick={() => asking.search?.onPress()}
                  onBlur={() => asking.search?.onBlur()}
                  className={`peer annotation rounded-full border px-3 py-1 transition-colors disabled:opacity-50 ${
                    asking.search.on ? "border-heading text-heading" : "border-border-strong text-text-muted hover:text-heading"
                  }`}
                >
                  {EXPLAIN.searchToggle}
                </button>
                <span
                  role="tooltip"
                  id={SEARCH_TIP_ID}
                  data-tooltip-open={asking.search.tip ? "" : undefined}
                  className="annotation pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-64 rounded-md border border-border-strong bg-surface p-2 text-text-muted opacity-0 shadow-card-hover transition-opacity peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100 peer-disabled:hidden data-[tooltip-open]:visible data-[tooltip-open]:opacity-100"
                >
                  {EXPLAIN.searchWarning}
                </span>
              </span>
            </div>
          )}
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
  /** P3-02c: web search is on for the next message. Session state only — off
   *  whenever a box or a passage is opened, never remembered. */
  search: boolean;
  /** The warning is showing because a touch put it there. */
  tip: boolean;
}

const noThread = { turns: [] as ExplainTurn[], draft: "", reply: "idle" as const, search: false, tip: false };
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
   *  first) and the new message — and, only when the reader turned web search on
   *  for it (P3-02c), `true` as a fourth argument. Without it the box has no thread. */
  onReply?: (target: SelectionTarget, thread: readonly ExplainTurn[], message: string, search?: boolean) => Promise<ReplyResult>;
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
  // P8-06: the reader hid the window (Escape, Close) — for the rest of this page visit. Component state, never
  // stored: the box is keyed by the paper, and a reload shows the empty panel again.
  const [hidden, setHidden] = useState(false);
  // A new selection closes the card and the sheet; one that merely went away does not (a click
  // in the card collapses it). P8-02: the dock, from 1024 px, is not closed by a new selection — it
  // stays, and the reader takes the new passage into it with the button or `e`. Derived, so the
  // stale card never paints.
  const stale = session !== null && target !== null && target.passage !== session.selection.passage && viewport.width < DOCK_MIN_VIEWPORT_PX;
  const open = stale ? null : session;
  if (stale) setSession(null);

  // The selection the open window explains (null with none open), and the one the button and `e`
  // would take into it: the reader's current selection, when it is not the passage already there.
  const placed = open?.selection ?? null;
  const offered = target !== null && target.passage !== placed?.passage ? target : null;
  const anchor = placed ?? target;
  // P8-06: with nothing open, the window may still STAND, empty — for a reader with a key, on a paper with a body,
  // from 1024 px, until it is hidden. `waiting` is the same without the width: the cases in which it could stand
  // once the window is wide enough, so that its width is watched.
  const hasBody = (reading.body?.length ?? 0) > 0;
  const standing = open === null && emptyDockStands({ canAsk, hasBody, hidden, width: viewport.width });
  const waiting = open === null && canAsk && hasBody && !hidden;
  /** The reader hides the window: Escape and Close, whether it is empty or holds a passage. */
  const hide = () => {
    setSession(null);
    setHidden(true);
  };
  const [measured, setMeasured] = useState<Array<{ of: ExplainSelection; where: ViewRects }>>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const live = useRef<Session | null>(null);
  const refocus = useRef(false);
  const wasPending = useRef(false);
  /** The kind of pointer that went down on the toggle, until the click that follows reads it. */
  const pointer = useRef<string | null>(null);
  /** Reads where the selection is again, on the next frame (below); null with no selection. */
  const remeasure = useRef<(() => void) | null>(null);

  // Where the selections are, measured again as the page scrolls or resizes: the one the window
  // explains, and the one the button stands at (the same one while nothing is open).
  useEffect(() => {
    const watched = [placed, offered].filter((selection): selection is ExplainSelection => selection !== null);
    if (watched.length === 0) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      // The same size is the same state: a scroll frame that moved nothing renders nothing.
      const size = currentViewport();
      setViewport((previous) => (previous.width === size.width && previous.height === size.height ? previous : size));
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
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      if (remeasure.current === onMove) remeasure.current = null;
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [placed, offered]);

  // P8-06: the empty state is present with no selection at all, so nothing above is watching the window. While it
  // could stand (a key, a body, nothing open, not hidden) a resize alone is watched, for its width: below 1024 px the
  // dock and its reserve go, from 1024 px they come. No scroll listener: the empty window does not follow the page.
  useEffect(() => {
    if (!waiting) return;
    const onResize = () => {
      const size = currentViewport();
      setViewport((previous) => (previous.width === size.width && previous.height === size.height ? previous : size));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [waiting]);

  // P7-15 (R7, Q4): while the box stands as the dock the page keeps its width clear (`reserveDock`),
  // so the text reflows beside it instead of running under it, and gives the width back when the box
  // closes or the window narrows below the dock's. The reflow moves the words — a selection deep in a
  // paper lands hundreds of pixels lower in a narrower column — so, before the next paint, the box
  // reads where the selection's top is, changes the layout, reads it again and scrolls the page by the
  // difference: the words stay where the reader's eyes are, and the highlight (the browser's own
  // selection, which the reflow does not touch) and the button follow them.
  // P8-06: the empty state is the dock too, so a reader with a key has the page's width kept clear from the MOUNT —
  // before any selection, hence nothing to hold across that first reflow — and the first Explain finds `docked`
  // already true: the window it fills is the one that was there, and the layout effect below does not run again.
  const docked = (open !== null || standing) && viewport.width >= DOCK_MIN_VIEWPORT_PX;
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
    // selection when it closes (P8-02: a new passage no longer closes the dock, so that is Escape, Close, or a narrower window)
    // — and, P8-06, on a reader's first sight of the paper, when there is usually none.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);
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

  // While the window is there — open on a passage, or (P8-06) standing empty: Escape hides it (and goes no further —
  // the page's own Escape means "back"), and so does a press outside it — all but the dock's (above), which is the
  // empty state's too. Hidden, the window stays so for the rest of the visit (`hidden`, as `hide` sets it).
  const shown = open !== null || standing;
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSession(null);
      setHidden(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Element | null;
      if (node?.closest?.("[data-explain-card]")) {
        // A press in the card, off the toggle, puts a touch's warning away.
        if (!node.closest("[data-explain-search]")) setSession((current) => (current !== null && current.tip ? { ...current, tip: false } : current));
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
  }, [shown, docked]);

  // The paper's own definition inside the open window's passage; and inside the new selection's, which
  // is what makes its button worth showing for a reader with no key.
  const term = placed ? definingTerm(terms, placed.passage) : null;
  const offeredTerm = offered ? definingTerm(terms, offered.passage) : null;
  const next = offered !== null && (offeredTerm !== null || canAsk) ? offered : null;
  const asked = (selection: ExplainSelection): SelectionTarget => ({ sectionIndex: selection.sectionIndex, paragraphIndex: selection.paragraphIndex, passage: selection.passage });

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
  // arrived. The search toggle is for this message only (§1a.11): it goes with the
  // request — as the fourth argument, only when on — and is off again at once,
  // whatever comes back.
  const send = () => {
    if (!open || !onReply || open.status.kind !== "answer") return;
    if (open.reply === "pending" || threadFull(open.turns)) return;
    const message = open.draft.trim();
    if (!message) return;
    const selection = open.selection;
    const searching = open.search;
    const thread = [firstAnswerMessage(open.status.answer), ...open.turns];
    refocus.current = inputRef.current !== null && typeof document !== "undefined" && document.activeElement === inputRef.current;
    setSession((current) => (current ? { ...current, reply: "pending", search: false, tip: false } : current));
    void (searching ? onReply(asked(selection), thread, message, true) : onReply(asked(selection), thread, message))
      .catch((): ReplyResult => "unavailable")
      .then((result) =>
        setSession((current) => {
          if (current === null || current.selection.passage !== selection.passage) return current;
          if (typeof result === "string") return { ...current, reply: "failed" };
          return { ...current, reply: "idle", draft: "", turns: [...current.turns, ...replyPair(message, searching, result)] };
        }),
      );
  };

  // "Say more" (P3-07): re-send the reader's last message in the long form — the thread
  // before it, then the message, no copy of it (`sayMoreOf`). It does nothing for a reply
  // already on its way, a full thread, or no reply to lengthen; the reply joins the
  // thread as Peer's turn alone, only once it has arrived; a failed one leaves the
  // thread as it was; the draft the reader was typing stays; and the toggle is not
  // touched (a long reply never searches).
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

  // The toggle's events (§1a.11). The pointer that went down is read once by the
  // click that follows it: a finger needs two taps (the first shows the warning), a
  // mouse, a pen or the keyboard one. A press does nothing while a reply is on its
  // way or the thread is full.
  const pressSearch = () => {
    const kind = pressKind(pointer.current);
    pointer.current = null;
    setSession((current) => {
      if (current === null || current.reply === "pending" || threadFull(current.turns)) return current;
      const next = toggleStep({ on: current.search, tip: current.tip }, kind);
      return { ...current, search: next.on, tip: next.tip };
    });
  };
  // A button that loses the focus has been left: a touch's warning goes, and a
  // pointer that never clicked is forgotten.
  const blurSearch = () => {
    pointer.current = null;
    setSession((current) => (current !== null && current.tip ? { ...current, tip: false } : current));
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

  if (!anchor && !standing) return null;
  /** Where `selection` is now: as it was last measured, else as it was read. */
  const whereOf = (selection: ExplainSelection): ViewRects => measured.find((one) => one.of === selection)?.where ?? selection;

  // The button beside the current selection — a locked block is not shown: with no key, only the paper's
  // own definition is worth a button. While the dock is open the page keeps its 376 px clear on the right,
  // and the button, which stands beside the words, never reaches into it.
  const ask = next ? (
    <button
      type="button"
      data-explain-ask=""
      // The press must not take the selection with it: it is what is explained.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => start(next)}
      style={placeButton(whereOf(next).rect, docked ? { width: viewport.width - DOCK_RESERVE_PX, height: viewport.height } : viewport)}
      className="fixed z-[70] rounded-full border border-border-strong bg-surface px-3 py-2 font-mono text-caption text-heading shadow-card-hover transition-colors hover:bg-surface-hover"
    >
      {EXPLAIN.ask}
    </button>
  ) : null;
  if (!open) {
    if (!standing) return ask;
    // P8-06: the empty state — the dock at its highest top, with the card's header and its one line. It is the same
    // `ExplainCard` at the same place in the tree as the window below, so the first Explain fills this very element.
    return (
      <>
        <ExplainCard
          empty
          passage=""
          heading=""
          term={null}
          termWhere={null}
          canAsk={canAsk}
          status={{ kind: "none" }}
          onClose={hide}
          dock
          cardRef={cardRef}
          inputRef={inputRef}
          style={styleOf(placePanel(NO_BOUNDS, viewport, DOCK_TOP_PX))}
        />
        {ask}
      </>
    );
  }

  const placedAt = whereOf(open.selection);
  const place = placePanel(placedAt.bounds, viewport, placedAt.paragraph?.top);
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
          search: {
            on: open.search,
            tip: open.tip,
            onPointerDown: (pointerType) => {
              pointer.current = pointerType;
            },
            onPress: pressSearch,
            onBlur: blurSearch,
          },
        }
      : undefined;
  return (
    <>
      <ExplainCard
        passage={open.selection.passage}
        heading={heading}
        term={term}
        termWhere={term ? termSource(term, reading) : null}
        canAsk={canAsk}
        status={open.status}
        onClose={hide}
        thread={threadView}
        sheet={place.kind === "sheet"}
        dock={place.kind === "dock"}
        cardRef={cardRef}
        inputRef={inputRef}
        style={styleOf(place)}
      />
      {ask}
    </>
  );
}
