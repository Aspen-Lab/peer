/**
 * The per-candidate Jev screen, on the READER'S own Jev key. It runs inside the
 * feed request, on a fresh pool build only, and RETURNS the decisions Jev gave
 * (cache hits and fresh answers) so the pipeline can order the reader's papers
 * by them (`apply.ts`). It began as the P3-S5 "shadow" runner (ABC-JEV-
 * INTEGRATION.md §4 Round 3), which ran after the response and returned counts
 * only; it is the same per-candidate loop, now live.
 *
 * Peer has no company key, no broker, no daily company budget and no Gemini
 * fallback (the owner cut that path on 2026-10-06; Jev is a bring-your-own-key
 * option). The key is an option, handed in by the route's closure, used only to
 * call Jev and never stored, cached, logged or returned.
 *
 * For each of up to `MAX_SCREEN_CANDIDATES` candidates: derive the decision
 * cache key, check the cache first (a hit costs nothing, no Jev call), and on a
 * miss call Jev (`jev-direct-client.ts`'s `callJevDirect`). An `ok` result is
 * returned and written to the cache; every other outcome is left uncached so
 * the next request tries again. Every candidate attempt gets exactly one
 * `logDecisionUsage()` line (counts and a status, never a key).
 *
 * BOUNDS. The reader pays Jev directly, so what a runaway client could spend is
 * bounded here and in the route, with no company counters:
 *  - at most `MAX_SCREEN_CANDIDATES` (50) candidates per run, and one run per
 *    fresh pool build (the pool is cached for the day);
 *  - at most 4 calls in flight;
 *  - a hard `SCREEN_DEADLINE_MS` (20 s) wall-clock race: when it passes, the run
 *    returns what has arrived so far, and nothing that arrives later can change
 *    what was returned;
 *  - stop at the first `unauthorized` (a wrong key must cost one failed call, not
 *    fifty), and stop after `MAX_CONSECUTIVE_THROTTLED` (3) rate-limited or
 *    overloaded answers in a row;
 *  - the decision cache, so an unchanged paper is never asked about twice;
 *  - the route's hourly request limit, which is the outer bound.
 *
 * SAFETY: this function never throws, no matter what the cache or the call do:
 * every failure becomes a typed per-candidate status folded into the summary's
 * `byStatus` counts. It never reads `process.env`.
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

/** The minimal, non-sensitive shape the screen needs per paper — no scores, no local ranking metadata. */
export interface ScreenCandidate {
  id: string;
  title: string;
  abstract: string | null;
  venue?: string;
}

/** ABC-JEV-INTEGRATION.md §1d "evaluate shortlist up to 50" — a hard ceiling this module enforces itself, never merely trusted from the caller. */
export const MAX_SCREEN_CANDIDATES = 50;

/** A hard ceiling this module enforces itself regardless of what a caller requests. */
const MAX_CONCURRENCY = 4;
const DEFAULT_CONCURRENCY = 4;

/**
 * The race deadline for a whole run. A call can take 15 s and the client retries a throttled one twice, so a slow Jev
 * could otherwise hold the reader's briefing for a minute or more. Twenty seconds is generous for a typical run
 * (four live samples answered in 0.2 to 0.7 s each) and short enough that the rest of the build still fits the route's
 * `maxDuration`.
 */
export const SCREEN_DEADLINE_MS = 20_000;

/** After this many throttled (`rate_limited` / `overloaded`) answers in a row the run stops: Jev is telling us to slow down. */
export const MAX_CONSECUTIVE_THROTTLED = 3;

export interface ScreenOptions {
  /** The server-derived owner id (never client-supplied) — see `app/api/feed/route.ts`'s gating. */
  ownerId: string;
  /** The reader's own Jev key, as the browser sent it. Used only to call Jev: never stored, cached, logged or returned. */
  apiKey: string;
  /** Reused as-is — never re-derived (`feed/intent.ts`). */
  intent: NormalizedFeedIntent;
  /** Reused as-is — never a competing taxonomy (`feed/senses.ts`). */
  senseConcepts: readonly SelectedSenseConcept[];
  /** Up to `MAX_SCREEN_CANDIDATES`; extra entries are dropped, never processed. */
  candidates: readonly ScreenCandidate[];
  cache: DecisionCache;
  /** Defaults to the global `fetch`. Tests always inject their own. */
  fetchImpl?: FetchLike;
  /** Per-call timeout, forwarded to `callJevDirect` unchanged. */
  jevTimeoutMs?: number;
  /** Clamped to `[1, MAX_CONCURRENCY]`. Defaults to `MAX_CONCURRENCY`. */
  concurrencyLimit?: number;
  /** Wall-clock budget for the whole run, from its start. Defaults to `SCREEN_DEADLINE_MS`. */
  deadlineMs?: number;
}

/**
 * Every possible per-candidate outcome, folded into the summary's counts.
 * `screen_internal_error` is the final per-candidate safety net — a truly
 * unanticipated throw anywhere in this module's own orchestration for one
 * candidate (never a Jev/HTTP fault, which already has its own named status
 * from `JevCallResult`).
 */
export type ScreenCandidateStatus = "cache_hit" | "screen_internal_error" | JevCallResult["status"];

export interface ScreenSummary {
  /** After clamping to `MAX_SCREEN_CANDIDATES` — the number this run actually considered. */
  totalCandidates: number;
  /** Candidates that reached Jev (i.e. were a cache miss). */
  attempted: number;
  cacheHits: number;
  byStatus: Partial<Record<ScreenCandidateStatus, number>>;
  /** True when the deadline passed before every candidate had been answered. */
  deadlineExceeded: boolean;
  /** True when Jev answered `unauthorized`: the key was refused, and the run stopped there. */
  rejected: boolean;
  /** True when `MAX_CONSECUTIVE_THROTTLED` throttled answers arrived in a row: the run stopped there. */
  throttled: boolean;
}

/** What one run produced: the decisions by paper id (cache hits and fresh answers), and the counts. A snapshot: nothing that arrives later can change it. */
export interface ScreenResult {
  decisions: Map<string, DecisionResult>;
  summary: ScreenSummary;
}

/**
 * The function the feed pipeline calls on a fresh build. The route builds it as
 * a closure over the reader's key, owner, intent and decision cache, so none of
 * them travels through the pipeline, a request type or a cache key.
 */
export type JevScreenFn = (candidates: ReadonlyArray<ScreenCandidate>) => Promise<ScreenResult>;

function buildDecisionRequest(
  candidate: ScreenCandidate,
  intent: NormalizedFeedIntent,
  senseConcepts: readonly SelectedSenseConcept[],
): DecisionRequest {
  const questions = selectQuestionsForRequest({
    hasSenseConcepts: senseConcepts.length > 0,
    // NormalizedFeedIntent has no population field today (rubric.ts's own
    // documented gap) — conservatively never asked until one exists, rather
    // than guessing a heuristic mapping.
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
  candidate: ScreenCandidate,
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
 * Screens up to `MAX_SCREEN_CANDIDATES` candidates with the reader's key, at
 * bounded concurrency, and returns the decisions it got. Never throws. See the
 * module doc comment for the per-candidate flow and every bound.
 */
export async function screenWithJev(options: ScreenOptions): Promise<ScreenResult> {
  const decisions = new Map<string, DecisionResult>();
  const byStatus: Partial<Record<ScreenCandidateStatus, number>> = {};
  let cacheHits = 0;
  let attempted = 0;
  let deadlineExceeded = false;
  let rejected = false;
  let throttled = false;
  let consecutiveThrottled = 0;
  /** No new candidate is started once this is set (a stop rule fired, or the deadline passed). */
  let stopped = false;
  /** The result has been handed back: late completions may still write the decision cache, but change nothing returned. */
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const bump = (status: ScreenCandidateStatus): void => {
    if (closed) return;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  };

  const snapshot = (totalCandidates: number): ScreenResult => ({
    decisions: new Map(decisions),
    summary: {
      totalCandidates,
      attempted,
      cacheHits,
      byStatus: { ...byStatus },
      deadlineExceeded,
      rejected,
      throttled,
    },
  });

  let total = 0;
  try {
    const concurrency = Math.max(1, Math.min(options.concurrencyLimit ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY));
    const candidates = options.candidates.slice(0, MAX_SCREEN_CANDIDATES);
    total = candidates.length;
    if (candidates.length === 0) return snapshot(0);

    let nextIndex = 0;

    async function runOne(candidate: ScreenCandidate): Promise<void> {
      try {
        const key = cacheKeyFor(options.ownerId, options.intent, candidate);

        let cached: DecisionResult | null = null;
        try {
          cached = await options.cache.get(key);
        } catch {
          cached = null; // A cache outage degrades to a miss, never a crash.
        }
        if (cached) {
          if (!closed) {
            cacheHits += 1;
            decisions.set(candidate.id, cached);
          }
          bump("cache_hit");
          logCacheHit();
          return;
        }

        if (!closed) attempted += 1;
        const request = buildDecisionRequest(candidate, options.intent, options.senseConcepts);
        const startedAt = Date.now();
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
        const latencyMs = Date.now() - startedAt;
        bump(result.status);

        if (!closed) {
          if (result.status === "unauthorized") {
            // A wrong key must cost one failed call, not one per paper.
            rejected = true;
            stopped = true;
          }
          if (result.status === "rate_limited" || result.status === "overloaded") {
            consecutiveThrottled += 1;
            if (consecutiveThrottled >= MAX_CONSECUTIVE_THROTTLED) {
              throttled = true;
              stopped = true;
            }
          } else {
            consecutiveThrottled = 0;
          }
        }

        if (result.status === "ok") {
          const decision: DecisionResult = {
            paperId: candidate.id,
            answers: result.answers,
            usage: result.usage,
            modelId: result.modelId,
          };
          if (!closed) decisions.set(candidate.id, decision);
          try {
            await options.cache.set(key, decision);
          } catch {
            // A cache-write outage means the next request tries fresh —
            // the decision itself was still real and is already returned.
          }
        }
        logAttempt(result, latencyMs);
      } catch {
        // Final per-candidate safety net — a truly unanticipated throw
        // anywhere above must never escape this candidate, let alone the
        // whole run.
        bump("screen_internal_error");
      }
    }

    async function worker(): Promise<void> {
      for (;;) {
        if (stopped || closed) return;
        const index = nextIndex;
        if (index >= candidates.length) return;
        nextIndex += 1;
        await runOne(candidates[index]);
      }
    }

    const workerCount = Math.min(concurrency, candidates.length);
    const allDone = Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => "done" as const);
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), Math.max(0, options.deadlineMs ?? SCREEN_DEADLINE_MS));
    });

    const winner = await Promise.race([allDone, deadline]);
    if (winner === "deadline") deadlineExceeded = true;
    stopped = true;
    closed = true;
    return snapshot(total);
  } catch {
    // A truly unanticipated failure in the orchestration itself (not any
    // single candidate) still must never throw.
    stopped = true;
    closed = true;
    return snapshot(total);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    stopped = true;
  }
}
