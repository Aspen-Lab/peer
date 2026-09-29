// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u.3, §1w P1, guide Finding C4) — the
// shared call-budget ledger for the live S2/OpenAlex channel-comparison
// runner. Every live call the runner makes (a channel fetch, a seed-id
// lookup, a topic-id resolution) goes through `trackedCall` so the ceiling
// and the stop-rules apply uniformly, in one place, instead of being
// re-implemented at each call site.
//
// Stop-rule design (Finding C4, revised by the §1w AMENDMENT below):
//   1. Check BEFORE every call, never after: if the ceiling is already
//      reached, or a prior call already tripped a stop that covers this
//      provider, this call is not attempted at all.
//   2. Every actual attempt (success or failure) increments the call count —
//      the attempt happened and counts against budget either way. A retried
//      call (see 4 below) counts TWICE: once per attempt.
//   3. A thrown error whose message carries "<provider> HTTP 429" (the only
//      way a status code is visible to a caller of these adapters —
//      `sources/search-failure.ts`'s `searchHttpFailure`, no typed status
//      field exists) is the only trigger for everything below. Any OTHER
//      error (non-429 HTTP status, network error, timeout) fails only that
//      one call; the budget stays fully open for the rest of the run — "one
//      flaky query never takes a channel down" (Finding C4 item 2).
//   4. LIVE-EVAL-4-FIX (ABC-JEV-INTEGRATION.md §1w AMENDMENT,
//      2026-09-25T06:3xZ — the first full live run stopped at call 2 on a
//      real S2 429 and produced zero comparison data; stopping the WHOLE
//      run on an S2 429 threw away the entire OpenAlex half for nothing to
//      do with OpenAlex itself). The two providers now diverge:
//        - OpenAlex 429: unchanged — stops the WHOLE run (every provider,
//          not just OpenAlex). It is the metered budget.
//        - S2 429: a thrown S2 429 already represents the paced production
//          client's own 1s/2s/4s backoff (`semantic-scholar-client.ts`, NOT
//          modified by this file) having been exhausted. Instead of
//          stopping everything, this ledger now gives it one 60s cool-off
//          (`coolOffAfterS2RateLimit`) and retries the SAME call once. Only
//          if THAT retry ALSO 429s does S2 get blocked
//          (`s2Blocked`/`recordS2RateLimit`) — and even then, only further
//          S2 calls are refused; OpenAlex calls keep running. Every S2
//          failure is still reported (the doubly-429'd call itself comes
//          back `status: "failed"` with the real error — never silently
//          hidden — and only calls AFTER it come back `not_run`).
//   5. LIVE-EVAL-4-FIX: runner-side S2 pacing. Separately from the
//      cool-off/retry above, this ledger also enforces >=3s between the
//      START of one S2 call this budget issues and the START of the next
//      one (`waitForS2Slot`), REGARDLESS of success/failure/provider mix —
//      a spacing rule for the runner's OWN call cadence, layered on top of
//      (not a replacement for) the production client's own internal
//      per-request pacing. OpenAlex calls are never paced by this ledger.
//   6. Every wait (the 3s pacing floor, the 60s cool-off) goes through an
//      injectable `sleep`, and every elapsed-time computation through an
//      injectable `now` — both default to real timers, so production is
//      unaffected, but a test can supply a virtual clock and run instantly.

export type CallProvider = "semantic_scholar" | "openalex";

export type SleepFn = (ms: number) => Promise<void>;
export type ClockFn = () => number;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultNow: ClockFn = () => Date.now();

/** LIVE-EVAL-4-FIX (§1w AMENDMENT): runner-side floor between the START of one S2 call this budget issues and the START of the next — separate from, and in addition to, the production S2 client's own internal pacing/backoff (`semantic-scholar-client.ts`, not touched by this fix). */
const S2_MIN_INTERVAL_MS = 3_000;
/** LIVE-EVAL-4-FIX (§1w AMENDMENT): the one cool-off before retrying a call that hit an S2 429 after the production client's own backoff was already exhausted. */
const S2_COOL_OFF_MS = 60_000;

export interface CallBudgetOptions {
  /** Hard per-run ceiling on logical calls (ABC-JEV-INTEGRATION.md §1w P1: 150). */
  ceiling: number;
  /** Injectable wait, for the S2 pacing floor and the 429 cool-off. Defaults to a real `setTimeout`-based sleep; tests supply a virtual one so they run instantly. */
  sleep?: SleepFn;
  /** Injectable clock, for measuring the gap between S2 calls. Defaults to `Date.now`; tests supply a virtual one alongside `sleep` so pacing math is exact without waiting. */
  now?: ClockFn;
}

/** Whole-run stop — set ONLY by an OpenAlex 429 (§1w AMENDMENT: it is the metered budget; an S2 429 no longer stops the whole run — see `S2BlockReason`/`s2Blocked` below). */
export type StopReason = { kind: "openalex-429"; reason: "stopped after first OpenAlex 429" };

/** LIVE-EVAL-4-FIX (§1w AMENDMENT): S2-specific block, set only once a POST-COOL-OFF RETRY also 429s. Blocks only further `semantic_scholar` calls through this budget — `openalex` calls are unaffected and the run continues. */
export type S2BlockReason = { kind: "s2-rate-limited"; reason: "s2_rate_limited" };

/**
 * Mutable run-scoped ledger. One instance per run (never shared across
 * separate `runLiveChannelsEval` calls) — `trackedCall` is the only writer.
 */
export class CallBudget {
  readonly ceiling: number;
  private calls = 0;
  private openAlexStop: StopReason | null = null;
  private s2RateLimit: S2BlockReason | null = null;
  private lastS2CallStartMs: number | null = null;
  private readonly sleepFn: SleepFn;
  private readonly nowFn: ClockFn;

  constructor(options: CallBudgetOptions) {
    this.ceiling = options.ceiling;
    this.sleepFn = options.sleep ?? defaultSleep;
    this.nowFn = options.now ?? defaultNow;
  }

  get callsMade(): number {
    return this.calls;
  }

  /** Whole-run stop (OpenAlex 429 only — see file header item 4). */
  get stopped(): StopReason | null {
    return this.openAlexStop;
  }

  /** S2-specific block (see file header item 4). `null` means S2 is not currently blocked — either no S2 429 has happened, or one did but its cool-off retry succeeded. */
  get s2Blocked(): S2BlockReason | null {
    return this.s2RateLimit;
  }

  /**
   * The reason a NEW call for this provider must not be attempted, if any —
   * checked before every call (and re-checked, mid-retry, before the
   * post-cool-off S2 retry — see `trackedCall`). An OpenAlex stop blocks
   * EVERY provider; an S2 rate-limit blocks only `semantic_scholar`.
   */
  blockReason(provider: CallProvider): string | undefined {
    if (this.openAlexStop) return this.openAlexStop.reason;
    if (this.calls >= this.ceiling) return "call ceiling reached";
    if (provider === "semantic_scholar" && this.s2RateLimit) return this.s2RateLimit.reason;
    return undefined;
  }

  /** Called by `trackedCall` only, after an attempt (success or failure) actually happened — including a post-cool-off retry, so a retried call counts TWICE against the ceiling (file header item 2). */
  recordAttempt(): void {
    this.calls += 1;
  }

  /** Called by `trackedCall` only, on an OpenAlex 429. The first stop wins. */
  recordOpenAlexStop(): void {
    if (!this.openAlexStop) {
      this.openAlexStop = { kind: "openalex-429", reason: "stopped after first OpenAlex 429" };
    }
  }

  /** Called by `trackedCall` only, when a post-cool-off S2 retry ALSO 429s. The first block wins. */
  recordS2RateLimit(): void {
    if (!this.s2RateLimit) {
      this.s2RateLimit = { kind: "s2-rate-limited", reason: "s2_rate_limited" };
    }
  }

  /**
   * LIVE-EVAL-4-FIX (§1w AMENDMENT, file header item 5): waits, if needed,
   * until at least `S2_MIN_INTERVAL_MS` have passed since the last S2 call
   * THIS budget recorded — shared across every channel/seed/topic call site,
   * one clock for the whole run — then records this call's start. A no-op
   * (no wait) before the very first S2 call this budget ever sees. Called by
   * `trackedCall` only, immediately before every S2 attempt, including the
   * post-cool-off retry (there it is a real-time no-op, since 60s already
   * exceeds the 3s floor).
   */
  async waitForS2Slot(): Promise<void> {
    const nowMs = this.nowFn();
    if (this.lastS2CallStartMs !== null) {
      const remaining = S2_MIN_INTERVAL_MS - (nowMs - this.lastS2CallStartMs);
      if (remaining > 0) await this.sleepFn(remaining);
    }
    this.lastS2CallStartMs = this.nowFn();
  }

  /** LIVE-EVAL-4-FIX (§1w AMENDMENT, file header item 4): the one 60s cool-off before retrying a call that hit an S2 429. Called by `trackedCall` only. */
  async coolOffAfterS2RateLimit(): Promise<void> {
    await this.sleepFn(S2_COOL_OFF_MS);
  }
}

export type TrackedCallOutcome<T> =
  | { status: "ok"; value: T; latencyMs: number }
  | { status: "failed"; error: Error; latencyMs: number }
  | { status: "not_run"; reason: string };

/** True when an error's message carries the "<provider> HTTP 429" shape `searchHttpFailure` bakes in. */
function is429(error: unknown): boolean {
  return error instanceof Error && /HTTP 429\b/.test(error.message);
}

/** One bare attempt at `fn`, always recording it against the budget (success or failure) — no retry/stop/pacing decisions here, those live in `trackedCall`. */
async function attemptOnce<T>(
  budget: CallBudget,
  fn: () => Promise<T>,
): Promise<TrackedCallOutcome<T>> {
  const startedAt = Date.now();
  try {
    const value = await fn();
    budget.recordAttempt();
    return { status: "ok", value, latencyMs: Date.now() - startedAt };
  } catch (err) {
    budget.recordAttempt();
    const latencyMs = Date.now() - startedAt;
    const error = err instanceof Error ? err : new Error(String(err));
    return { status: "failed", error, latencyMs };
  }
}

/**
 * Runs one planned live call against the shared budget. See the file header
 * for the full stop/retry/pacing rule design.
 */
export async function trackedCall<T>(
  budget: CallBudget,
  provider: CallProvider,
  fn: () => Promise<T>,
): Promise<TrackedCallOutcome<T>> {
  const blocked = budget.blockReason(provider);
  if (blocked) return { status: "not_run", reason: blocked };

  if (provider === "semantic_scholar") await budget.waitForS2Slot();

  const first = await attemptOnce(budget, fn);
  if (first.status !== "failed" || !is429(first.error)) return first;

  if (provider !== "semantic_scholar") {
    // OpenAlex 429 — unchanged: stop the whole run (file header item 4).
    budget.recordOpenAlexStop();
    return first;
  }

  // S2 429, after the paced production client's own backoff was already
  // exhausted (file header item 4) — LIVE-EVAL-4-FIX: one 60s cool-off, then
  // one retry of this SAME call, instead of stopping the whole run.
  if (budget.blockReason(provider)) {
    // The first attempt itself exhausted the ceiling (the only way this can
    // fire here, since calls are sequential — see runner.ts) — never spend
    // a 60s wait, or a call, the budget can no longer afford. Report the
    // 429 actually observed; do not claim S2 is rate-limited (a retry was
    // never attempted, so a second 429 was never confirmed).
    return first;
  }
  await budget.coolOffAfterS2RateLimit();
  await budget.waitForS2Slot();

  const retry = await attemptOnce(budget, fn);
  if (retry.status === "failed" && is429(retry.error)) {
    budget.recordS2RateLimit();
  }
  return retry;
}
