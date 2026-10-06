// The thread's pure rules and its one request (P3-02b; ruling §1h.3) — what
// `explain-box.tsx` calls and the page imports. No hook, no DOM.
//
// A reader's follow-up goes out when they press Enter or Send and never before:
// the paper, the passage and where it sits, and the thread so far — the first
// answer as its first `peer` message, so the server never has to remember it —
// with the reader's new message last, roles and words only.
//
// P3-02c (ruling §1h.4 amendment; user decision §1a.11) adds the web-search
// toggle's rules and the two refusals of the allowance:
//
//   - `toggleStep` / `pressKind`: one press of the toggle, and the touch screen's
//     two steps (the first tap shows the warning, the second turns search on);
//   - `replyPair`: what joins the thread when a reply arrives — the reader's
//     message, marked when the server says the reply searched, and Peer's reply,
//     with the one-line note when the reader asked to search and it could not;
//   - `postExplain` / `refusalOf`: the request, and a 429 `explain_exhausted` read
//     for which of the two lines to show. `apiFetch` drops the body of a refusal
//     and that body's `reason` is what tells a spent allowance from one that could
//     not be checked, so these requests read their own response.

import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import type { SelectionTarget } from "./paper-body";

/** What sending a follow-up comes to: Peer's reply; the day's explanations used
 *  up (`exhausted`); the allowance could not be checked and nothing was spent
 *  (`allowance_unavailable`); or nothing (an outage, a refusal, a thread the
 *  server calls full, a gone upload — all one line, `unavailable`). */
export type ReplyResult = ExplainTurn | "unavailable" | "exhausted" | "allowance_unavailable";

/** The two ways the allowance can refuse a turn. */
export type AllowanceRefusal = "exhausted" | "allowance_unavailable";

/** A response, read: its status and its body when it had one (null otherwise). */
export interface ExplainResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Post to the paper's explain route and read the response whatever its status.
 * Throws only when the request itself failed (offline, aborted): the callers
 * take that for "unavailable".
 */
export async function postExplain(paperId: string, payload: unknown): Promise<ExplainResponse> {
  const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * Which refusal of the allowance a response is, or null: only a 429 whose body
 * says `explain_exhausted`. A reason of `unavailable` is the counter that could
 * not be read; any other (or none) is the allowance spent — the reading that
 * stops the reader sending. Every other response — the sign-in gate's own 429,
 * any other status — is not this refusal.
 */
export function refusalOf(response: ExplainResponse): AllowanceRefusal | null {
  if (response.status !== 429) return null;
  const body = response.body as { error?: unknown; reason?: unknown } | null;
  if (body?.error !== "explain_exhausted") return null;
  return body.reason === "unavailable" ? "allowance_unavailable" : "exhausted";
}

// ── The web-search toggle (§1a.11) ─────────────────────────────────────

/** How the reader pressed the toggle: a finger (no hover), a mouse or pen, or the keyboard. */
export type PressKind = "touch" | "pointer" | "keyboard";

/** The toggle: whether search is on for the next message, and whether the
 *  warning is showing because a touch put it there. */
export interface SearchToggle {
  on: boolean;
  tip: boolean;
}

/** `pointerType` as a browser reports it on the `pointerdown` before a click;
 *  none at all is the keyboard (Enter or Space on the focused button). */
export function pressKind(pointerType: string | null | undefined): PressKind {
  if (pointerType === "touch") return "touch";
  if (pointerType === "mouse" || pointerType === "pen") return "pointer";
  return "keyboard";
}

/**
 * One press of the toggle. When search is on, any press turns it off. When it is
 * off, a mouse, a pen or the keyboard turns it on at once — the warning already
 * showed, on hover or on focus. A finger has no hover, so on a touch screen the
 * first tap shows the warning and leaves search off, and the second turns it on
 * (and puts the warning away).
 */
export function toggleStep(state: SearchToggle, press: PressKind): SearchToggle {
  if (state.on) return { on: false, tip: false };
  if (press === "touch" && !state.tip) return { on: false, tip: true };
  return { on: true, tip: false };
}

/**
 * The two messages that join the thread when a reply arrives: the reader's, and
 * Peer's. The reader's carries the mark `searched` only when the server says the
 * reply was written with web search (so the mark is a fact, not a wish). Peer's
 * carries `searchUnavailable` when the reader asked to search and it was not
 * (the provider cannot) — the page then says so, once, under that reply. For a
 * message sent without search this is the pair it always was.
 */
export function replyPair(message: string, asked: boolean, result: ExplainTurn): [ExplainTurn, ExplainTurn] {
  const searched = result.searched === true;
  return [
    { role: "reader", text: message, ...(searched ? { searched: true as const } : {}) },
    asked && !searched ? { ...result, searchUnavailable: true as const } : result,
  ];
}

/** Whether a key press in the input sends: Enter, alone, outside an IME
 *  composition (the Enter that picks a candidate is not a send). */
export function keyToSend(input: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

/** The first answer as the thread's first message, from Peer: both parts in one,
 *  so the server never has to remember it. */
export function firstAnswerMessage(answer: ExplainAnswer): ExplainTurn {
  return { role: "peer", text: `${answer.meaning} ${answer.here.text}` };
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** One of Peer's turns, as the server sent it — or null for anything else. */
function asTurn(value: unknown): ExplainTurn | null {
  const turn = (value as { turn?: unknown } | null)?.turn as Record<string, unknown> | undefined;
  if (!turn || typeof turn !== "object" || turn.role !== "peer" || !isText(turn.text)) return null;
  return {
    role: "peer",
    text: turn.text,
    ...(isText(turn.evidence) ? { evidence: turn.evidence } : {}),
    ...(isText(turn.evidenceWhere) ? { evidenceWhere: turn.evidenceWhere } : {}),
    ...(isText(turn.sectionId) ? { sectionId: turn.sectionId } : {}),
    ...(typeof turn.page === "number" ? { page: turn.page } : {}),
    ...(turn.peer === true ? { peer: true as const } : {}),
    // The server says whether the reply searched; only a yes is kept.
    ...(turn.searched === true ? { searched: true as const } : {}),
  };
}

/**
 * The one request a send makes (P3-02b), when the reader presses Enter or Send —
 * never before: the paper, the passage and where it sits, and the thread so far
 * (the first answer first) with the reader's new message last, roles and words
 * only; the reader's own key only when they have one; and — P3-02c — `search:
 * true` only when the reader turned web search on for this message. Peer's turn;
 * "exhausted" or "allowance_unavailable" for the allowance's two refusals; or
 * "unavailable" for everything else — an outage, a full thread, a gone upload, a
 * reply that is not what was promised.
 */
export async function requestReply(args: {
  paper: Paper;
  selection: SelectionTarget;
  sectionId: string;
  thread: readonly ExplainTurn[];
  message: string;
  /** The reader turned web search on for this message. */
  search?: boolean;
  llmOverride?: ProviderOverrideConfig;
}): Promise<ReplyResult> {
  const { paper, selection, sectionId, thread, message, search, llmOverride } = args;
  try {
    const response = await postExplain(paper.id, {
      paper,
      passage: selection.passage,
      sectionId,
      paragraphIndex: selection.paragraphIndex,
      thread: [...thread.map(({ role, text }) => ({ role, text })), { role: "reader", text: message }],
      ...(search === true ? { search: true } : {}),
      ...(llmOverride ? { llmOverride } : {}),
    });
    const refused = refusalOf(response);
    if (refused) return refused;
    return (response.ok ? asTurn(response.body) : null) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}
