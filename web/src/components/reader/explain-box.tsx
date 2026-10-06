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
//     Peer's own reading and no quote.
//
// An answer already kept for the passage opens at once with no request, with the
// thread that followed it. Escape, a press outside the card, or a new selection
// closes it; a selection that merely goes away (a click in the card collapses
// it) does not. Nothing here links off the page.
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
// Positioned `fixed` from the selection's rectangle, measured again as the page
// scrolls: beside the text column on the spread, where P3-02 put the card
// between 640 and 1024, a bottom sheet on a phone (`placePanel`).
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
// asked for search the provider could not give carries a one-line note. A day's
// explanations used up, or an allowance that could not be checked, is a line under
// the thread (the first: the input and the toggle disabled, the typed words kept)
// or, for the first message, in place of the loading line. Nothing here links to a
// web source: the mark is the only trace of the search.
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
// turn and replaces nothing. It waits while a request is in flight, at the full thread and
// when the day's explanations are used up, as a send does; what the reader was typing stays.

import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer, ExplainItem } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { MAX_EXPLAIN_MESSAGE_CHARS, threadFull, type ExplainTurn } from "@/store/explain-threads";
import type { Paper, UserProfile } from "@/types";
import { EXPLAIN, PEERS_READING, QUOTA } from "./copy";
import { EvidenceQuote } from "./evidence-quote";
import {
  firstAnswerMessage,
  keyToSend,
  postExplain,
  pressKind,
  refusalOf,
  moreReply,
  replyPair,
  sayMoreOf,
  toggleStep,
  type AllowanceRefusal,
  type ReplyResult,
} from "./explain-thread";
import type { ExplainSelection, SelectionTarget, ViewRect, ViewRects } from "./paper-body";

// ── What the card shows ────────────────────────────────────────────────

/** `none`: no model is asked (no key) — the paper's own definition is all there is.
 *  `exhausted` / `allowance_unavailable` (P3-02c): the first message was refused by
 *  the allowance — the day's explanations are used up, or the counter could not be
 *  read and nothing was spent. */
export type ExplainStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "answer"; answer: ExplainAnswer }
  | { kind: "unavailable" }
  | { kind: "not_in_paper" }
  | { kind: AllowanceRefusal };

/** What asking comes to. */
export type AskResult = ExplainAnswer | "unavailable" | "not_in_paper" | AllowanceRefusal;

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
  /** P3-02c: the allowance refused the last send — `exhausted`: the day's
   *  explanations are used up (the input and the toggle are disabled, the typed
   *  words kept); `unavailable`: it could not be checked and nothing was spent
   *  (the reader may try again). */
  quota?: "exhausted" | "unavailable";
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

/** The text column's right edge, in the viewport's coordinates (P3-02b). */
export interface ColumnEdge {
  right: number;
}

export interface Place {
  /** `side`: beside the text column; `card`: P3-02's place; `sheet`: a phone's bottom sheet. */
  kind: "side" | "card" | "sheet";
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** From here up the box may stand beside the text. */
const SPREAD_WIDTH = 1024;
/** The panel's width and the gap to the column: the room it needs to its right. */
const SIDE_GAP = 16;
const SIDE_ROOM = CARD_WIDTH + SIDE_GAP;
/** The least the side panel may be tall: it is moved up rather than made shorter. */
const PANEL_MIN_HEIGHT = 280;
/** A phone's sheet takes at most this share of the window's height. */
const SHEET_SHARE = 0.6;

/**
 * Where the box stands (P3-02b). On a spread (1024 and up) with at least 376 px
 * between the text column's right edge and the window's: a panel 360 px wide,
 * 16 px right of the column, its top at the selection's top and clamped inside
 * the window, as tall as the room under it (the thread scrolls inside, the
 * input is pinned at its foot). Below 640: a sheet — the window's width, on its
 * bottom edge, at most 60% of its height. Everywhere else P3-02's place
 * (`placeCard`), under or above the selection, unchanged.
 */
export function placePanel(bounds: ViewRect, viewport: Viewport, column: ColumnEdge | null): Place {
  if (viewport.width < PHONE_WIDTH) {
    return { kind: "sheet", left: 0, width: viewport.width, bottom: 0, maxHeight: Math.floor(viewport.height * SHEET_SHARE) };
  }
  if (viewport.width >= SPREAD_WIDTH && column !== null && viewport.width - column.right >= SIDE_ROOM) {
    const top = clamp(bounds.top, CARD_MARGIN, viewport.height - CARD_MARGIN - PANEL_MIN_HEIGHT);
    return { kind: "side", left: column.right + SIDE_GAP, width: CARD_WIDTH, top, maxHeight: viewport.height - top - CARD_MARGIN };
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

function currentViewport(): Viewport {
  return typeof window === "undefined" ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight };
}

// ── Asking ─────────────────────────────────────────────────────────────

/** The reader's own provider and key, when they have set one — the shape the
 *  report request carries; nothing for Peer's own model. */
export function explainLlmOverride(profile: Pick<UserProfile, "feedAiProvider" | "feedAiApiKey">): ProviderOverrideConfig | undefined {
  if (!hasUserLlmOverride(profile as UserProfile)) return undefined;
  return { provider: profile.feedAiProvider as ProviderOverrideConfig["provider"], apiKey: (profile.feedAiApiKey ?? "").trim() };
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The two parts, as the server sent them — or null for anything else. */
function asAnswer(value: unknown): ExplainAnswer | null {
  const answer = (value as { answer?: unknown } | null)?.answer as { meaning?: unknown; here?: Record<string, unknown> } | undefined;
  if (!answer || !isText(answer.meaning) || !answer.here || !isText(answer.here.text)) return null;
  const { here } = answer;
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
  };
}

/**
 * The one request "Explain this?" makes, when the reader clicks: the paper, the
 * passage and where it sits (the first message has no thread, and never asks to
 * search), and the reader's own key only when they have one. An answer,
 * "not_in_paper" when the server says the words are not the paper's (422),
 * "exhausted" or "allowance_unavailable" when the allowance refused it (P3-02c: a
 * 429 `explain_exhausted`, by its reason), and "unavailable" for everything else —
 * an outage, a refusal, a gone upload, a reply that is not what was promised.
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
    const refused = refusalOf(response);
    if (refused) return refused;
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
  /** A phone's bottom sheet: square at the foot, rounded at the top. */
  sheet?: boolean;
  /** The card itself — the one thing that scrolls, and what the sheet's height is read from. */
  cardRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const asking = canAsk && status.kind === "answer" ? thread : undefined;
  const full = asking ? threadFull(asking.turns) : false;
  /** The day's explanations are used up: nothing more can be sent, the words stay. */
  const spent = asking?.quota === "exhausted";
  const sendBlocked = (asking?.pending ?? false) || full || spent;
  return (
    <div
      role="dialog"
      aria-label={EXPLAIN.card}
      data-explain-card=""
      {...(sheet ? { "data-explain-sheet": "" } : {})}
      ref={cardRef}
      style={style}
      className={`fixed z-[70] overflow-y-auto border border-border-strong bg-surface p-4 shadow-card-hover ${sheet ? "rounded-t-lg border-b-0" : "rounded-lg"}`}
    >
      {/* The card is what scrolls; its passage stays at the top and its input at the foot (sticky,
          offset by the card's own padding, which a sticky box would otherwise stop short of). */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <EvidenceQuote text={previewOf(passage)} where={heading} />
        </div>
        <button type="button" onClick={onClose} className="annotation shrink-0 text-text-faint transition-colors hover:text-heading">
          {EXPLAIN.close}
        </button>
      </div>

      {term?.evidence && termWhere && (
        <div className="mt-4">
          <p className="font-mono text-caption text-text-muted">{EXPLAIN.defines(term.term)}</p>
          <EvidenceQuote text={term.evidence} where={termWhere.where} page={termWhere.page} />
        </div>
      )}

      {canAsk && status.kind !== "none" && (
        <div role="status" aria-live="polite" className="mt-4 space-y-4">
          {status.kind === "loading" && <p className="annotation text-text-faint">{EXPLAIN.loading}</p>}
          {status.kind === "unavailable" && <p className="annotation text-text-faint">{EXPLAIN.unavailable}</p>}
          {status.kind === "not_in_paper" && <p className="annotation text-text-faint">{EXPLAIN.notInPaper}</p>}
          {status.kind === "exhausted" && <p className="annotation text-text-faint">{QUOTA.explainExhausted}</p>}
          {status.kind === "allowance_unavailable" && <p className="annotation text-text-faint">{QUOTA.explainUnavailable}</p>}
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
              {asking?.quota === "exhausted" && <p className="annotation text-text-faint">{QUOTA.explainExhausted}</p>}
              {asking?.quota === "unavailable" && <p className="annotation text-text-faint">{QUOTA.explainUnavailable}</p>}
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
          className={`sticky -bottom-4 -mx-4 -mb-4 mt-4 flex flex-wrap items-end gap-2 border-t border-border bg-surface p-3 ${sheet ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : ""}`}
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
  /** `exhausted` / `allowance_unavailable` (P3-02c): what the allowance said to the last send. */
  reply: "idle" | "pending" | "failed" | AllowanceRefusal;
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
  /** Where the text column's right edge is now (measured as the selection is). */
  column?: () => ColumnEdge | null;
  /** Filled with the box's `open`, which does what the button's click does on the
   *  current selection — the page's `e` key calls it. With the box already open
   *  it moves to the input instead. */
  openRef?: { current: (() => void) | null };
}

export function ExplainBox({ target, terms, canAsk, onAsk, cached, reading, cachedTurns, onReply, onSayMore, onResetThread, column, openRef }: ExplainBoxProps) {
  const [session, setSession] = useState<Session | null>(null);
  // A new selection closes the card; one that merely went away does not (a click
  // in the card collapses it). Derived, so the stale card never paints.
  const stale = session !== null && target !== null && target.passage !== session.selection.passage;
  const open = stale ? null : session;
  if (stale) setSession(null);

  const anchor = open?.selection ?? target;
  const [measured, setMeasured] = useState<{ of: ExplainSelection; where: ViewRects } | null>(null);
  const [viewport, setViewport] = useState<Viewport>(currentViewport);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const live = useRef<Session | null>(null);
  const refocus = useRef(false);
  const wasPending = useRef(false);
  /** The kind of pointer that went down on the toggle, until the click that follows reads it. */
  const pointer = useRef<string | null>(null);

  // Where the selection is, measured again as the page scrolls or resizes.
  useEffect(() => {
    if (!anchor) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      setViewport(currentViewport());
      const where = anchor.measure?.();
      if (where) setMeasured({ of: anchor, where });
    };
    const onMove = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [anchor]);

  // While the card is open: Escape closes it (and goes no further — the page's
  // own Escape means "back"), and so does a press outside it.
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
        // A press in the card, off the toggle, puts a touch's warning away.
        if (!node.closest("[data-explain-search]")) setSession((current) => (current !== null && current.tip ? { ...current, tip: false } : current));
        return;
      }
      setSession(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen]);

  const term = anchor ? definingTerm(terms, anchor.passage) : null;
  const asked = (selection: ExplainSelection): SelectionTarget => ({ sectionIndex: selection.sectionIndex, paragraphIndex: selection.paragraphIndex, passage: selection.passage });

  // What the button's click does — and what `e` does through `openRef`.
  const start = () => {
    const selection = anchor;
    if (!selection) return;
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
  // draft, a reply already on its way, a full thread or a day's explanations used
  // up; the reply joins the thread, with the message it answers, only once it has
  // arrived. The search toggle is for this message only (§1a.11): it goes with the
  // request — as the fourth argument, only when on — and is off again at once,
  // whatever comes back.
  const send = () => {
    if (!open || !onReply || open.status.kind !== "answer") return;
    if (open.reply === "pending" || open.reply === "exhausted" || threadFull(open.turns)) return;
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
          if (result === "exhausted" || result === "allowance_unavailable") return { ...current, reply: result };
          if (typeof result === "string") return { ...current, reply: "failed" };
          return { ...current, reply: "idle", draft: "", turns: [...current.turns, ...replyPair(message, searching, result)] };
        }),
      );
  };

  // "Say more" (P3-07): re-send the reader's last message in the long form — the thread
  // before it, then the message, no copy of it (`sayMoreOf`). It does nothing for a reply
  // already on its way, a full thread, a day's explanations used up, or no reply to
  // lengthen; the reply joins the thread as Peer's turn alone, only once it has arrived;
  // a failed one leaves the thread as it was; the draft the reader was typing stays; and
  // the toggle is not touched (a long reply never searches).
  const sayMore = () => {
    if (!open || !onSayMore || open.status.kind !== "answer") return;
    if (open.reply === "pending" || open.reply === "exhausted" || threadFull(open.turns)) return;
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
          if (result === "exhausted" || result === "allowance_unavailable") return { ...current, reply: result };
          if (typeof result === "string") return { ...current, reply: "failed" };
          return { ...current, reply: "idle", turns: [...current.turns, ...moreReply(result)] };
        }),
      );
  };

  // The toggle's events (§1a.11). The pointer that went down is read once by the
  // click that follows it: a finger needs two taps (the first shows the warning), a
  // mouse, a pen or the keyboard one. A press does nothing while a reply is on its
  // way, the thread is full or the day's explanations are used up.
  const pressSearch = () => {
    const kind = pressKind(pointer.current);
    pointer.current = null;
    setSession((current) => {
      if (current === null || current.reply === "pending" || current.reply === "exhausted" || threadFull(current.turns)) return current;
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
    // Already open: `e` goes to the input, to ask the next thing.
    if (open) {
      inputRef.current?.focus();
      return;
    }
    if (!anchor || (!term && !canAsk)) return;
    start();
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

  // The newest message is the one in view.
  useEffect(() => {
    const card = cardRef.current;
    if (card && turnCount > 0) card.scrollTop = card.scrollHeight;
  }, [turnCount, replyState]);

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

  if (!anchor) return null;
  const where = measured !== null && measured.of === anchor ? measured.where : anchor;

  if (!open) {
    // A locked block is not shown: with no key, only the paper's own definition is worth a button.
    if (!term && !canAsk) return null;
    const at = placeButton(where.rect, viewport);
    return (
      <button
        type="button"
        data-explain-ask=""
        // The press must not take the selection with it: it is what is explained.
        onMouseDown={(event) => event.preventDefault()}
        onClick={start}
        style={{ left: at.left, top: at.top }}
        className="fixed z-[70] rounded-full border border-border-strong bg-surface px-3 py-2 font-mono text-caption text-heading shadow-card-hover transition-colors hover:bg-surface-hover"
      >
        {EXPLAIN.ask}
      </button>
    );
  }

  const place = placePanel(where.bounds, viewport, column?.() ?? null);
  const heading = reading.body[open.selection.sectionIndex]?.heading ?? "";
  const threadView: ThreadView | undefined =
    canAsk && onReply && open.status.kind === "answer"
      ? {
          turns: open.turns,
          draft: open.draft,
          pending: open.reply === "pending",
          failed: open.reply === "failed",
          ...(open.reply === "exhausted" ? { quota: "exhausted" as const } : open.reply === "allowance_unavailable" ? { quota: "unavailable" as const } : {}),
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
    <ExplainCard
      passage={open.selection.passage}
      heading={heading}
      term={term}
      termWhere={term ? termSource(term, reading) : null}
      canAsk={canAsk}
      status={open.status}
      onClose={() => setSession(null)}
      thread={threadView}
      sheet={place.kind === "sheet"}
      cardRef={cardRef}
      inputRef={inputRef}
      style={{
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
        ...(place.top !== undefined ? { top: place.top } : { bottom: place.bottom }),
      }}
    />
  );
}
