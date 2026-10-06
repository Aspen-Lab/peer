// The thread's pure rules and its one request (P3-02b; ruling §1h.3) — what
// `explain-box.tsx` calls and the page imports. No hook, no DOM.
//
// A reader's follow-up goes out when they press Enter or Send and never before:
// the paper, the passage and where it sits, and the thread so far — the first
// answer as its first `peer` message, so the server never has to remember it —
// with the reader's new message last, roles and words only.

import { apiFetch } from "@/lib/api";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { ExplainTurn } from "@/store/explain-threads";
import type { Paper } from "@/types";
import type { SelectionTarget } from "./paper-body";

/** What sending a follow-up comes to: Peer's reply, or nothing (an outage, a
 *  refusal, a thread the server calls full, a gone upload — all one line). */
export type ReplyResult = ExplainTurn | "unavailable";

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
  };
}

/**
 * The one request a send makes (P3-02b), when the reader presses Enter or Send —
 * never before: the paper, the passage and where it sits, and the thread so far
 * (the first answer first) with the reader's new message last, roles and words
 * only; the reader's own key only when they have one. Peer's turn, or
 * "unavailable" for everything else — an outage, a refusal, a full thread, a gone
 * upload, a reply that is not what was promised.
 */
export async function requestReply(args: {
  paper: Paper;
  selection: SelectionTarget;
  sectionId: string;
  thread: readonly ExplainTurn[];
  message: string;
  llmOverride?: ProviderOverrideConfig;
}): Promise<ReplyResult> {
  const { paper, selection, sectionId, thread, message, llmOverride } = args;
  try {
    const reply = await apiFetch<unknown>(`/api/papers/${encodeURIComponent(paper.id)}/explain`, {
      method: "POST",
      body: JSON.stringify({
        paper,
        passage: selection.passage,
        sectionId,
        paragraphIndex: selection.paragraphIndex,
        thread: [...thread.map(({ role, text }) => ({ role, text })), { role: "reader", text: message }],
        ...(llmOverride ? { llmOverride } : {}),
      }),
    });
    return asTurn(reply) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}
