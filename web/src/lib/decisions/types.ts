/**
 * Jev is a separate `DecisionProvider`, not a generative `DigestProvider`
 * (ABC-JEV-INTEGRATION.md §1d, §1p.H — both BINDING). Its wire contract is
 * `{state, model, questions} -> {model, answers, usage}` with typed
 * Choice/Score answers, structurally incompatible with the free-text
 * chat-completion shape every `DigestProvider` implements
 * (`web/src/lib/llm/providers/types.ts`). Keeping this contract in its own
 * module tree means none of the 11 existing `generateJsonText`/
 * `generateDigest` call sites ever need to consider a decision-shaped
 * return value. See docs/jev-abc/P3-B-20260924T0525Z.md DESIGN §1-§2.
 */

import type { NormalizedFeedIntent } from "@/lib/feed/intent";
import type { SelectedSenseConcept } from "@/lib/feed/senses";

/**
 * The five Peer-defined decision dimensions. `population_match` and
 * `method_outcome_match` are only ever asked when the user's intent
 * specifies them; `sense_match` only when the paper has selected sense
 * concepts; `core_vs_background` and `project_help` are always asked. See
 * `rubric.ts`'s `selectQuestionsForRequest`.
 */
export type DecisionQuestionId =
  | "sense_match"
  | "core_vs_background"
  | "population_match"
  | "method_outcome_match"
  | "project_help";

/** Jev's own two usable primitives for these dimensions (Noul is never used — see rubric.ts). */
export type DecisionAnswerKind = "choice" | "score";

/**
 * A Peer-side decision request for exactly one paper. Never carries a raw
 * Jev API key. `abstract` is the full, untruncated text (or `null` when the
 * paper has none) — truncation is `jev-contract.ts`'s job, logged there, not
 * a precondition callers must satisfy themselves.
 */
export interface DecisionRequest {
  /** Peer's own id. Jev never echoes an id back (VERIFIED absent from the wire contract) — correlation is by request/response pairing in `jev-client.ts`/its caller, never by a wire field. This id is deliberately kept OUT of the wire `state` payload too (minimal metadata). */
  paperId: string;
  title: string;
  abstract: string | null;
  venue?: string;
  /** Reused as-is from `feed/intent.ts` — never re-derived. */
  intentCard: NormalizedFeedIntent;
  /** Reused as-is from `feed/senses.ts` — never a competing taxonomy. */
  senseConcepts: SelectedSenseConcept[];
  /** Which of the 5 dimensions to ask for THIS paper, already gated (see `rubric.ts`). */
  questions: DecisionQuestionId[];
}

/**
 * The single, local, typed-unknown flag every combiner/consumer reads.
 * `unknown` is derived by `jev-contract.ts`'s validator from Jev's actual
 * response (an explicit `insufficient_information` choice, or confidence
 * below the rubric-pinned threshold) — never invented downstream.
 */
export interface DecisionAnswer {
  questionId: DecisionQuestionId;
  kind: DecisionAnswerKind;
  /** The chosen criteria key (Choice) or the chosen level index (Score). */
  value: string | number;
  /** Jev's own confidence statistic, 0-1. Always present when `kind` is "choice" or "score" — Jev only omits confidence for a Noul answer, which this codebase never requests. */
  confidence: number;
  unknown: boolean;
}

/** Token/latency accounting for one Jev call. Output tokens are always 0 (Jev's output is free/uncosted) but the field stays for shape-consistency with `llm/usage-log.ts`'s `LlmUsage`. */
export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * The fully validated, Peer-shaped result of one decision call for one
 * paper. `usage` is `null` exactly when the call degraded (any fault row in
 * `jev-client.ts`'s fault table) — the empty/failure behavior required by
 * the spec: no decision this run, never a crash, never a fabricated score.
 */
export interface DecisionResult {
  paperId: string;
  answers: DecisionAnswer[];
  usage: DecisionUsage | null;
  /** The ACTUAL echoed model id (defense against a silent alias upgrade), for the cache key and cost log. Empty string when degraded before any model id was ever echoed. */
  modelId: string;
}

export interface DecisionProvider {
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
