// The thread's pure rules and its one request (P3-02b; ruling §1h.3) — what
// `explain-box.tsx` calls and the page imports. No hook, no DOM.
//
// A reader's follow-up goes out when they press Enter or Send and never before:
// the paper, the passage and where it sits, and the thread so far — the first
// answer as its first `peer` message, so the server never has to remember it —
// with the reader's new message last, roles and words only.
//
// `replyPair`: what joins the thread when a reply arrives — the reader's message and Peer's reply;
// `postExplain`: the request, reading its own response whatever its status.
// (P10-08, review 8.6: the web-search toggle of P3-02c — `toggleStep`, `pressKind`, the "searched the web" mark and the note
// on a search that could not run — is gone; a reply request never carries `search`. The server's option stays, ruling §1h.76 (e).)
//
// P3-07 (ruling §1h.9; user decision §1a.14) adds "Say more", the reader's way to ask
// for a longer reply than the short one Peer gives by default:
//
//   - `sayMoreOf`: which reply "Say more" is for (Peer's latest, never the first answer,
//     never one that is already long) and what it re-sends — the reader's LAST message, once,
//     with the thread before it. The thread is sent without the reply to be lengthened and
//     without a copy of the message, so the thread's readers are the readers it had, and the
//     server's rule that a thread ends with the reader's message holds;
//   - `moreReply`: what joins the thread when that reply arrives — Peer's turn alone, no
//     reader message, so nothing is replaced and the count of eight does not move;
//   - `threadAsSent`: the thread as the server reads it — one Peer message for each reader
//     message, the long reply standing for the short one before it — so the server's seventeen
//     messages are never crossed by the replies "Say more" adds;
//   - `requestReply`'s `detail`: the request carries `detail: true`, and only then.

import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer, ExplainItem } from "@/lib/papers/explain";
import { MAX_EXPLAIN_ITEMS, type ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import type { SelectionTarget } from "./paper-body";
import { explainRequestRange } from "@/lib/reader/explain-range";

/** What sending a follow-up comes to: Peer's reply, or nothing (an outage, a
 *  refusal, a thread the server calls full, a gone upload — all one line,
 *  `unavailable`). */
export type ReplyResult = ExplainTurn | "unavailable";

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
 * The two messages that join the thread when a reply arrives: the reader's, and Peer's.
 */
export function replyPair(message: string, result: ExplainTurn): [ExplainTurn, ExplainTurn] {
  return [{ role: "reader", text: message }, result];
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

/** One row of a reply's table, as the server sent it: three cells of words — or null. */
function asItem(value: unknown): ExplainItem | null {
  if (typeof value !== "object" || value === null) return null;
  const { term, here, read } = value as Record<string, unknown>;
  return isText(term) && isText(here) && isText(read) ? { term, here, read } : null;
}

/** The rows the server sent, the ones that are three cells of words, at most four. A reply's
 *  parse and — P4-00c — the first answer's (`requestExplanation`) read the table the same way. */
export function asItems(value: unknown): ExplainItem[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map(asItem).filter((item): item is ExplainItem => item !== null).slice(0, MAX_EXPLAIN_ITEMS);
}

/** One of Peer's turns, as the server sent it — or null for anything else. */
function asTurn(value: unknown): ExplainTurn | null {
  const turn = (value as { turn?: unknown } | null)?.turn as Record<string, unknown> | undefined;
  if (!turn || typeof turn !== "object" || turn.role !== "peer" || !isText(turn.text)) return null;
  const items = asItems(turn.items);
  return {
    role: "peer",
    text: turn.text,
    ...(isText(turn.evidence) ? { evidence: turn.evidence } : {}),
    ...(isText(turn.evidenceWhere) ? { evidenceWhere: turn.evidenceWhere } : {}),
    ...(isText(turn.sectionId) ? { sectionId: turn.sectionId } : {}),
    ...(typeof turn.page === "number" ? { page: turn.page } : {}),
    ...(turn.peer === true ? { peer: true as const } : {}),
    // P3-07: the table, and whether this is the long form — only a literal true.
    ...(items.length > 0 ? { items } : {}),
    ...(turn.detail === true ? { detail: true as const } : {}),
  };
}

// ── Say more (P3-07) ───────────────────────────────────────────────────

/**
 * What "Say more" re-sends, or null when there is nothing for it to lengthen: the last turn
 * must be a reply of Peer's that is not already the long form, and there must be a reader
 * message before it. The result is that reader message and the turns before it — the reply
 * to be lengthened is left out, and the message is not repeated, so sent with the message
 * last the thread holds the reader messages it held (§1h.9 (2)).
 */
export function sayMoreOf(turns: readonly ExplainTurn[]): { before: ExplainTurn[]; message: string } | null {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "peer" || last.detail === true) return null;
  const at = turns.map((turn) => turn.role).lastIndexOf("reader");
  if (at < 0) return null;
  return { before: turns.slice(0, at), message: turns[at].text };
}

/** What joins the thread when a long reply arrives: Peer's turn alone — no reader message,
 *  so nothing is replaced and the reader count does not grow. "Say more" never asks to search,
 *  so no note about a search is kept. */
export function moreReply(result: ExplainTurn): [ExplainTurn] {
  const turn = { ...result };
  delete turn.searchUnavailable;
  return [turn];
}

/**
 * The thread as the server reads it: roles and words, with one Peer message for each reader
 * message. A reply that another reply of Peer's follows — the short reply "Say more" was
 * pressed under — is left out, and the long one stands for it (the model sees what the reader
 * last read). Without this the replies "Say more" adds would carry a thread of eight reader
 * messages past the server's seventeen, and a longer thread is no thread.
 */
export function threadAsSent(thread: readonly ExplainTurn[]): Array<{ role: ExplainTurn["role"]; text: string }> {
  return thread.filter((turn, index) => !(turn.role === "peer" && thread[index + 1]?.role === "peer")).map(({ role, text }) => ({ role, text }));
}

/**
 * The one request a send makes (P3-02b), when the reader presses Enter or Send —
 * never before: the paper, the passage and where it sits, and the thread so far
 * (the first answer first) with the reader's new message last, roles and words
 * only; the reader's own key only when they have one; and — P3-07 —
 * `detail: true` only when this is "Say more" (the thread is then the one `sayMoreOf`
 * gives and the message the reader's last, once). The thread goes as the server reads it
 * (`threadAsSent`). Peer's turn, or "unavailable" for everything else — an outage,
 * a refusal, a full thread, a gone upload, a reply that is not what was promised.
 */
export async function requestReply(args: {
  paper: Paper;
  selection: SelectionTarget;
  sectionId: string;
  thread: readonly ExplainTurn[];
  message: string;
  /** P3-07: "Say more" — the reply may run to the long cap. */
  detail?: boolean;
  llmOverride?: ProviderOverrideConfig;
}): Promise<ReplyResult> {
  const { paper, selection, sectionId, thread, message, detail, llmOverride } = args;
  try {
    const projected = explainRequestRange(selection);
    if (!projected) return "unavailable";
    const response = await postExplain(paper.id, {
      paper,
      passage: projected.passage,
      ...(projected.range ? { range: projected.range } : {}),
      sectionId,
      paragraphIndex: selection.paragraphIndex,
      thread: [...threadAsSent(thread), { role: "reader", text: message }],
      ...(selection.source !== undefined && selection.source !== "paper" ? { source: selection.source } : {}),
      ...(detail === true ? { detail: true } : {}),
      ...(llmOverride ? { llmOverride } : {}),
    });
    return (response.ok ? asTurn(response.body) : null) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}
