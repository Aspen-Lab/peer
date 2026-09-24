/**
 * P3-S5 — the Jev shadow runner (ABC-JEV-INTEGRATION.md §4 Round 3
 * "P3-S5 DESIGN RULING", 2026-09-24T11:29:31Z; docs/jev-abc/
 * P3-B-20260924T0525Z.md §4/§6). Scheduled by `app/api/feed/route.ts` via
 * `after()`, so this runs AFTER the response is already sent — nothing here
 * can affect what the user saw, and nothing here may block or throw into
 * anything.
 *
 * For each of up to `MAX_SHADOW_CANDIDATES` candidates: derive the decision
 * cache key, check the cache first (a hit costs nothing — no reservation, no
 * broker call), and on a miss call the broker
 * (`decisions/broker-client.ts`'s `callJevViaBroker`, which itself owns the
 * budget reservation via `security/jev-broker-auth.ts` — this module never
 * touches a counter directly). An `ok` result is written to the cache; every
 * other outcome is left uncached so the next request tries again. Every
 * candidate attempt gets exactly one `logDecisionUsage()` line.
 *
 * SAFETY: this function never throws, no matter what the cache or the
 * broker do — every failure becomes a typed per-candidate status folded
 * into the returned summary's `byStatus` counts. For the MAIN Jev call, it
 * never reads `process.env` itself (all config — flag state, broker
 * URL/secret, caps — is resolved by `decisions/flag.ts` and handed in by
 * the caller).
 *
 * P3-S6 addition (ABC-JEV-INTEGRATION.md §4 "P3-S6 RULING",
 * 2026-09-24T14:35:58Z): after an `ok` Jev result with >=1 `unknown`
 * answer, this module calls the bounded Gemini decision fallback
 * (`decisions/gemini-fallback.ts`'s `runDecisionFallback`) for exactly the
 * unknown questions — but ONLY when a `geminiFallbackProvider` capability
 * was supplied (see `ShadowRunnerOptions`) AND `PEER_JEV_GEMINI_FALLBACK`
 * is "on". This module DOES read that one flag itself, via
 * `decisions/flag.ts`'s `readGeminiFallbackConfig()` (resolved once per
 * run, not per candidate) — the same delegation-to-flag.ts relationship
 * the main Jev path already has with `app/api/feed/route.ts`, just with
 * this module as the caller instead. Never on a Jev fault/refusal, never
 * near-threshold (no score/combine.ts logic is consulted). Bounded to
 * `MAX_GEMINI_FALLBACK_PER_RUN` calls across the WHOLE run. A fallback
 * answer only ever REPLACES the corresponding answer inside the CACHED
 * `DecisionResult` for that one candidate — it never removes a candidate
 * from anything; this summary carries no candidate list at all.
 */

import {
  callJevViaBroker,
  type BrokerCallResult,
  type BrokerFetchLike,
} from "./broker-client";
import { DECISION_CACHE_PROVIDER, deriveDecisionCacheKey, type DecisionCache } from "./decision-cache";
import { MAX_GEMINI_FALLBACK_PER_RUN, readGeminiFallbackConfig } from "./flag";
import {
  runDecisionFallback,
  type GeminiFallbackProviderCapability,
  type GeminiFallbackResult,
  type SourcedDecisionAnswer,
} from "./gemini-fallback";
import { paperContentHash } from "./paper-content-hash";
import { JEV_MODEL_ID, DECISION_RUBRIC_VERSION, intentSpecifiesMethodOutcome, selectQuestionsForRequest } from "./rubric";
import type { DecisionRequest, DecisionResult } from "./types";
import type { CounterStore } from "@/lib/usage/counters";
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

/** Generous enough for a handful of sequential 15s-timeout broker calls at bounded concurrency without ever approaching a route's own response deadline (this runs AFTER the response, but a runaway background task is still a resource leak). */
const DEFAULT_DEADLINE_MS = 45_000;

export interface ShadowRunnerOptions {
  /** The server-derived owner id (never client-supplied) — see `app/api/feed/route.ts`'s gating. */
  ownerId: string;
  /** Server-derived entitlement decision, passed straight through to `callJevViaBroker` — this module never computes it. */
  entitled: boolean;
  /** Reused as-is — never re-derived (`feed/intent.ts`). */
  intent: NormalizedFeedIntent;
  /** Reused as-is — never a competing taxonomy (`feed/senses.ts`). */
  senseConcepts: readonly SelectedSenseConcept[];
  /** Up to `MAX_SHADOW_CANDIDATES`; extra entries are dropped, never processed. */
  candidates: readonly ShadowCandidate[];
  cache: DecisionCache;
  brokerUrl: string;
  brokerSecret: string;
  perUserCap: number;
  globalCap: number;
  store: CounterStore;
  /** Defaults to the global `fetch`. Tests always inject their own — see `broker-client.ts`. */
  fetchImpl?: BrokerFetchLike;
  /** Per-call broker timeout, forwarded to `callJevViaBroker` unchanged. */
  brokerTimeoutMs?: number;
  /** Defaults to the real clock. Tests inject a controllable one to make the deadline behavior deterministic. */
  clock?: () => Date;
  /** Defaults to the real clock's starting point too (`now` below) for cache-key purposes only — decision cache keys carry no date component regardless. */
  now?: Date;
  /** Clamped to `[1, MAX_CONCURRENCY]`. Defaults to `MAX_CONCURRENCY`. */
  concurrencyLimit?: number;
  /** Overall wall-clock budget for this run, from the first clock reading. Defaults to `DEFAULT_DEADLINE_MS`. */
  deadlineMs?: number;
  /**
   * P3-S6 — company-funded JSON generator capability for the bounded Gemini
   * decision fallback (ABC-JEV-INTEGRATION.md §4 "P3-S6 RULING",
   * 2026-09-24T14:35:58Z). Optional — absent (the only reachable production
   * state today; `app/api/feed/route.ts`'s `runJevShadowSafely` passes no
   * such field, proven structurally in this slice's checkpoint/tests) means
   * the fallback never runs, regardless of `PEER_JEV_GEMINI_FALLBACK`. Must
   * be minted via `gemini-fallback.ts`'s `mintGeminiFallbackProviderCapability`
   * — a plain `{generateJsonText}` object (e.g. a BYOK-resolved
   * `DigestProvider`) is refused at runtime, never merely by the type
   * system (see `hasGeminiFallbackProviderCapability`).
   */
  geminiFallbackProvider?: GeminiFallbackProviderCapability;
}

/**
 * Every possible per-candidate outcome, folded into the summary's counts.
 * `shadow_internal_error` is the final per-candidate safety net — a truly
 * unanticipated throw anywhere in this module's own orchestration for one
 * candidate (never a broker/HTTP fault, which already has its own named
 * status from `BrokerCallResult`).
 */
export type ShadowCandidateStatus = "cache_hit" | "shadow_internal_error" | BrokerCallResult["status"];

export interface ShadowRunSummary {
  /** After clamping to `MAX_SHADOW_CANDIDATES` — the number this run actually considered. */
  totalCandidates: number;
  /** Candidates that reached `callJevViaBroker` (i.e. were a cache miss). */
  attempted: number;
  cacheHits: number;
  byStatus: Partial<Record<ShadowCandidateStatus, number>>;
  /** True when the deadline was reached before every candidate could be started. */
  deadlineExceeded: boolean;
  /**
   * P3-S6 — the bounded Gemini decision fallback's own counts for this run.
   * Always present, even when the fallback never ran at all (`attempted: 0`
   * — the only reachable state in production today). Deliberately just
   * counts, exactly like every other field here: this summary carries no
   * candidate list of any kind, so nothing it returns can ever be read as
   * "which candidates survived" — the protective property that a fallback
   * answer can never remove a candidate from any list holds structurally,
   * not merely by convention.
   */
  geminiFallback: {
    attempted: number;
    byStatus: Partial<Record<GeminiFallbackResult["status"], number>>;
  };
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

function logAttempt(result: BrokerCallResult, latencyMs: number): void {
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
 * P3-S6 — replaces each of `base`'s answers whose `questionId` the fallback
 * also answered, tagging the replacement `"gemini-fallback"`; every other
 * answer (including any the fallback was never asked about) passes through
 * unchanged. Never drops or reorders an entry — same length in, same length
 * out, always. `SourcedDecisionAnswer` (`gemini-fallback.ts`) — not
 * `decisions/types.ts`'s plain `DecisionAnswer` — deliberately, so the
 * Edge-mirrored `types.ts` never needs to know about answer provenance; see
 * `SourcedDecisionAnswer`'s own doc comment.
 */
function mergeFallbackAnswers(
  base: readonly SourcedDecisionAnswer[],
  fallback: readonly SourcedDecisionAnswer[],
): SourcedDecisionAnswer[] {
  const byQuestion = new Map(fallback.map((answer) => [answer.questionId, answer]));
  return base.map((answer) => byQuestion.get(answer.questionId) ?? answer);
}

/**
 * Runs the shadow decision pass over up to `MAX_SHADOW_CANDIDATES`
 * candidates at bounded concurrency. Never throws. See the module doc
 * comment for the per-candidate flow.
 */
export async function runJevShadow(options: ShadowRunnerOptions): Promise<ShadowRunSummary> {
  const byStatus: Partial<Record<ShadowCandidateStatus, number>> = {};
  const bump = (status: ShadowCandidateStatus): void => {
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  };
  let cacheHits = 0;
  let attempted = 0;
  let deadlineExceeded = false;

  // P3-S6 — resolved ONCE per run, not per candidate. `readGeminiFallbackConfig`
  // is the one place this module reads `PEER_JEV_GEMINI_FALLBACK`/its cap env
  // vars, mirroring how `app/api/feed/route.ts` already resolves the main
  // Jev shadow flag/caps once and hands the result in. A provider capability
  // must ALSO have been supplied — absent that, the fallback is structurally
  // unreachable regardless of the flag (see `ShadowRunnerOptions.geminiFallbackProvider`).
  const geminiFallbackConfig = readGeminiFallbackConfig();
  const geminiFallbackCaps: { perUserDailyCap: number; globalDailyCap: number } | null =
    geminiFallbackConfig.status === "enabled"
      ? { perUserDailyCap: geminiFallbackConfig.perUserDailyCap, globalDailyCap: geminiFallbackConfig.globalDailyCap }
      : null;
  const geminiFallbackByStatus: Partial<Record<GeminiFallbackResult["status"], number>> = {};
  let geminiFallbackAttempted = 0;

  /**
   * <=5-per-run ceiling (`MAX_GEMINI_FALLBACK_PER_RUN`, BINDING —
   * ABC-JEV-INTEGRATION.md §1p.H(5)), shared across every candidate this
   * run, including ones running concurrently. Synchronous check-and-
   * increment with no `await` between them, so this is atomic across the
   * bounded-concurrency workers below — the same reasoning
   * `InMemoryCounterStore.increment` documents for its own atomicity: no
   * `await` point exists for a concurrent caller to interleave through.
   */
  function tryReserveFallbackSlot(): boolean {
    if (geminiFallbackAttempted >= MAX_GEMINI_FALLBACK_PER_RUN) return false;
    geminiFallbackAttempted += 1;
    return true;
  }

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
        let result: BrokerCallResult;
        try {
          result = await callJevViaBroker(request, {
            ownerId: options.ownerId,
            entitled: options.entitled,
            brokerUrl: options.brokerUrl,
            brokerSecret: options.brokerSecret,
            perUserCap: options.perUserCap,
            globalCap: options.globalCap,
            store: options.store,
            now: options.now,
            fetchImpl: options.fetchImpl,
            timeoutMs: options.brokerTimeoutMs,
          });
        } catch {
          // callJevViaBroker is documented never-throwing; this is the final
          // safety net so a truly unanticipated failure can never escape.
          result = { status: "network_error" };
        }
        const latencyMs = clock().getTime() - startedAt;
        bump(result.status);

        if (result.status === "ok") {
          // Tag every real Jev answer "jev" at the point this module
          // assembles the cached `DecisionResult` — `jev-contract.ts` is not
          // edited by this slice, and `source` deliberately lives on
          // `gemini-fallback.ts`'s `SourcedDecisionAnswer`, not on
          // `types.ts`'s `DecisionAnswer` (see that type's own doc comment:
          // `types.ts` is Edge-mirrored and the Edge side never needs this).
          let finalAnswers: SourcedDecisionAnswer[] = result.answers.map((answer) => ({ ...answer, source: "jev" as const }));

          // P3-S6 — trigger ONLY on an `unknown` dimension of this `ok`
          // result, never on a fault/refusal (we are already inside the
          // `status === "ok"` branch) and never on score proximity (no
          // combine.ts/threshold logic is consulted anywhere here).
          const unknownIds = finalAnswers.filter((answer) => answer.unknown).map((answer) => answer.questionId);
          const fallbackProvider = options.geminiFallbackProvider;
          if (geminiFallbackCaps && fallbackProvider !== undefined && unknownIds.length > 0 && tryReserveFallbackSlot()) {
            try {
              const fallbackResult = await runDecisionFallback({
                request,
                unknownQuestionIds: unknownIds,
                provider: fallbackProvider,
                caps: geminiFallbackCaps,
                store: options.store,
                ownerId: options.ownerId,
                now: options.now,
              });
              geminiFallbackByStatus[fallbackResult.status] = (geminiFallbackByStatus[fallbackResult.status] ?? 0) + 1;
              if (fallbackResult.status === "ok") {
                finalAnswers = mergeFallbackAnswers(finalAnswers, fallbackResult.answers);
              }
            } catch {
              // runDecisionFallback is documented never-throwing; this is the
              // final safety net so a truly unanticipated failure can never
              // escape — the candidate keeps its original Jev-only answers.
              geminiFallbackByStatus.provider_error = (geminiFallbackByStatus.provider_error ?? 0) + 1;
            }
          }

          try {
            await options.cache.set(key, {
              paperId: candidate.id,
              answers: finalAnswers,
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

    return {
      totalCandidates: candidates.length,
      attempted,
      cacheHits,
      byStatus,
      deadlineExceeded,
      geminiFallback: { attempted: geminiFallbackAttempted, byStatus: geminiFallbackByStatus },
    };
  } catch {
    // A truly unanticipated failure in the orchestration itself (not any
    // single candidate) still must never throw into `after()`.
    return {
      totalCandidates: 0,
      attempted,
      cacheHits,
      byStatus,
      deadlineExceeded,
      geminiFallback: { attempted: geminiFallbackAttempted, byStatus: geminiFallbackByStatus },
    };
  }
}
