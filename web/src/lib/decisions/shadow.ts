/**
 * The per-candidate Jev runner (originally the P3-S5 "shadow" runner, ABC-JEV-
 * INTEGRATION.md §4 Round 3). It runs on the READER'S own Jev key: the key is
 * an option, handed in by the caller, used only to call Jev and never stored,
 * cached, logged or returned. Peer has no company key, no broker, no daily
 * company budget and no Gemini fallback (the owner cut that path on
 * 2026-10-06; Jev is a bring-your-own-key option).
 *
 * For each of up to `MAX_SHADOW_CANDIDATES` candidates: derive the decision
 * cache key, check the cache first (a hit costs nothing, no Jev call), and on a
 * miss call Jev (`jev-direct-client.ts`'s `callJevDirect`). An `ok` result is
 * written to the cache; every other outcome is left uncached so the next
 * request tries again. Every candidate attempt gets exactly one
 * `logDecisionUsage()` line (counts and a status, never a key).
 *
 * SAFETY: this function never throws, no matter what the cache or the call do:
 * every failure becomes a typed per-candidate status folded into the returned
 * summary's `byStatus` counts. It never reads `process.env`.
 *
 * It is not called by the feed route in this commit; it returns counts only,
 * so nothing here can change what a reader sees.
 */

import { DECISION_CACHE_PROVIDER, deriveDecisionCacheKey, type DecisionCache } from "./decision-cache";
import { callJevDirect } from "./jev-direct-client";
import type { FetchLike, JevCallResult } from "./jev-client";
import { paperContentHash } from "./paper-content-hash";
import { JEV_MODEL_ID, DECISION_RUBRIC_VERSION, intentSpecifiesMethodOutcome, selectQuestionsForRequest } from "./rubric";
import type { DecisionRequest, DecisionResult } from "./types";
import type { NormalizedFeedIntent } from "@/lib/feed/intent";
import { serializeFeedIntent } from "@/lib/feed/intent";
import type { SelectedSenseConcept } from "@/lib/feed/senses";
import { logDecisionUsage } from "@/lib/llm/usage-log";

/** The minimal, non-sensitive shape the runner needs per paper — no scores, no local ranking metadata. */
export interface ShadowCandidate {
  id: string;
  title: string;
  abstract: string | null;
  venue?: string;
}

/** ABC-JEV-INTEGRATION.md §1d "evaluate shortlist up to 50" — a hard ceiling this module enforces itself, never merely trusted from the caller. */
export const MAX_SHADOW_CANDIDATES = 50;

/** A hard ceiling this module enforces itself regardless of what a caller requests. */
const MAX_CONCURRENCY = 4;
const DEFAULT_CONCURRENCY = 4;

/** Generous enough for a handful of sequential 15s-timeout calls at bounded concurrency. */
const DEFAULT_DEADLINE_MS = 45_000;

export interface ShadowRunnerOptions {
  /** The server-derived owner id (never client-supplied) — see `app/api/feed/route.ts`'s gating. */
  ownerId: string;
  /** The reader's own Jev key, as the browser sent it. Used only to call Jev: never stored, cached, logged or returned. */
  apiKey: string;
  /** Reused as-is — never re-derived (`feed/intent.ts`). */
  intent: NormalizedFeedIntent;
  /** Reused as-is — never a competing taxonomy (`feed/senses.ts`). */
  senseConcepts: readonly SelectedSenseConcept[];
  /** Up to `MAX_SHADOW_CANDIDATES`; extra entries are dropped, never processed. */
  candidates: readonly ShadowCandidate[];
  cache: DecisionCache;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: FetchLike;
  /** Per-call timeout, forwarded to `callJevDirect` unchanged. */
  jevTimeoutMs?: number;
  /** Defaults to the real clock. Tests inject a controllable one to make the deadline behavior deterministic. */
  clock?: () => Date;
  /** Clamped to `[1, MAX_CONCURRENCY]`. Defaults to `MAX_CONCURRENCY`. */
  concurrencyLimit?: number;
  /** Overall wall-clock budget for this run, from the first clock reading. Defaults to `DEFAULT_DEADLINE_MS`. */
  deadlineMs?: number;
}

/**
 * Every possible per-candidate outcome, folded into the summary's counts.
 * `shadow_internal_error` is the final per-candidate safety net — a truly
 * unanticipated throw anywhere in this module's own orchestration for one
 * candidate (never a Jev/HTTP fault, which already has its own named status
 * from `JevCallResult`).
 */
export type ShadowCandidateStatus = "cache_hit" | "shadow_internal_error" | JevCallResult["status"];

export interface ShadowRunSummary {
  /** After clamping to `MAX_SHADOW_CANDIDATES` — the number this run actually considered. */
  totalCandidates: number;
  /** Candidates that reached Jev (i.e. were a cache miss). */
  attempted: number;
  cacheHits: number;
  byStatus: Partial<Record<ShadowCandidateStatus, number>>;
  /** True when the deadline was reached before every candidate could be started. */
  deadlineExceeded: boolean;
}

function buildDecisionRequest(
  candidate: ShadowCandidate,
  intent: NormalizedFeedIntent,
  senseConcepts: readonly SelectedSenseConcept[],
): DecisionRequest {
  const questions = selectQuestionsForRequest({
    hasSenseConcepts: senseConcepts.length > 0,
    // NormalizedFeedIntent has no population field today (rubric.ts's own
    // documented gap) — conservatively never asked until one exists, rather
    // than guessing a heuristic mapping. See this slice's checkpoint.
    intentSpecifiesPopulation: false,
    intentSpecifiesMethodOutcome: intentSpecifiesMethodOutcome(intent.methods),
  });
  return {
    paperId: candidate.id,
    title: candidate.title,
    abstract: candidate.abstract,
    venue: candidate.venue,
    intentCard: intent,
    senseConcepts: [...senseConcepts],
    questions,
  };
}

function cacheKeyFor(
  ownerId: string,
  intent: NormalizedFeedIntent,
  candidate: ShadowCandidate,
): string {
  return deriveDecisionCacheKey({
    ownerId,
    intentHash: serializeFeedIntent(intent),
    paperContentHash: paperContentHash({
      title: candidate.title,
      abstract: candidate.abstract,
      venue: candidate.venue,
    }),
    provider: DECISION_CACHE_PROVIDER,
    modelVersion: JEV_MODEL_ID,
    rubricVersion: DECISION_RUBRIC_VERSION,
  });
}

function logCacheHit(): void {
  logDecisionUsage({
    provider: DECISION_CACHE_PROVIDER,
    model: "",
    cacheHit: true,
    status: "cache_hit",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
  });
}

function logAttempt(result: JevCallResult, latencyMs: number): void {
  if (result.status === "ok") {
    logDecisionUsage({
      provider: DECISION_CACHE_PROVIDER,
      model: result.modelId,
      cacheHit: false,
      status: "ok",
      inputTokens: result.usage.inputTokens,
      outputTokens: 0,
      latencyMs: result.usage.latencyMs,
    });
    return;
  }
  logDecisionUsage({
    provider: DECISION_CACHE_PROVIDER,
    model: "",
    cacheHit: false,
    status: result.status,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
  });
}

/**
 * Runs the Jev decision pass over up to `MAX_SHADOW_CANDIDATES` candidates at
 * bounded concurrency. Never throws. See the module doc comment for the
 * per-candidate flow.
 */
export async function runJevShadow(options: ShadowRunnerOptions): Promise<ShadowRunSummary> {
  const byStatus: Partial<Record<ShadowCandidateStatus, number>> = {};
  const bump = (status: ShadowCandidateStatus): void => {
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  };
  let cacheHits = 0;
  let attempted = 0;
  let deadlineExceeded = false;

  try {
    const clock = options.clock ?? (() => new Date());
    const deadlineAt = clock().getTime() + Math.max(0, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
    const concurrency = Math.max(1, Math.min(options.concurrencyLimit ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY));
    const candidates = options.candidates.slice(0, MAX_SHADOW_CANDIDATES);

    let nextIndex = 0;

    async function runOne(candidate: ShadowCandidate): Promise<void> {
      try {
        const key = cacheKeyFor(options.ownerId, options.intent, candidate);

        let cached: DecisionResult | null = null;
        try {
          cached = await options.cache.get(key);
        } catch {
          cached = null; // A cache outage degrades to a miss, never a crash.
        }
        if (cached) {
          cacheHits += 1;
          bump("cache_hit");
          logCacheHit();
          return;
        }

        attempted += 1;
        const request = buildDecisionRequest(candidate, options.intent, options.senseConcepts);
        const startedAt = clock().getTime();
        let result: JevCallResult;
        try {
          result = await callJevDirect(request, {
            apiKey: options.apiKey,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.jevTimeoutMs,
          });
        } catch {
          // callJevDirect is documented never-throwing; this is the final
          // safety net so a truly unanticipated failure can never escape.
          result = { status: "network_error" };
        }
        const latencyMs = clock().getTime() - startedAt;
        bump(result.status);

        if (result.status === "ok") {
          try {
            await options.cache.set(key, {
              paperId: candidate.id,
              answers: result.answers,
              usage: result.usage,
              modelId: result.modelId,
            });
          } catch {
            // A cache-write outage means the next request tries fresh —
            // the decision itself was still real and already logged below.
          }
        }
        logAttempt(result, latencyMs);
      } catch {
        // Final per-candidate safety net — a truly unanticipated throw
        // anywhere above must never escape this candidate, let alone the
        // whole run.
        bump("shadow_internal_error");
      }
    }

    async function worker(): Promise<void> {
      for (;;) {
        if (clock().getTime() >= deadlineAt) {
          if (nextIndex < candidates.length) deadlineExceeded = true;
          return;
        }
        const index = nextIndex;
        if (index >= candidates.length) return;
        nextIndex += 1;
        await runOne(candidates[index]);
      }
    }

    const workerCount = Math.min(concurrency, Math.max(candidates.length, 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return { totalCandidates: candidates.length, attempted, cacheHits, byStatus, deadlineExceeded };
  } catch {
    // A truly unanticipated failure in the orchestration itself (not any
    // single candidate) still must never throw.
    return { totalCandidates: 0, attempted, cacheHits, byStatus, deadlineExceeded };
  }
}
