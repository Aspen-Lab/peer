// P4-S8b (Round 3) — ABC-JEV-INTEGRATION.md §3c "Queue" paragraph: "Manual
// refresh 15min initial cooldown and user/global cap; changes debounced
// with one pending newest-intent job." §4 ruling (the "usage-limit
// interruption recovered ... P4-S8 B complete + rulings" entry): the
// 15-minute figure is sourced (§3c, verbatim, the ONLY place "15" appears
// attached to "min" in the whole state file — see docs/jev-abc/
// P4-S8-B-20260924T115008Z.md POLICY E1) and is kept exactly; the cooldown
// fails CLOSED on an unreadable counter (E2), the same direction
// pipeline.ts's claimSourceRetry already takes for a real outbound spend —
// see that function's own doc comment for why "unreadable" must never be
// read as "permitted." This module was deliberately NOT built as part of
// P4-S8a: in today's product a manual refresh only ever rebuilds on a cold
// cache (now coalesced by P4-S8a) or the already-capped degraded retry, so
// a cooldown had nothing to limit yet (E1's ruling). It has something to
// limit once P4-S8b's refresh-triggered prepare jobs exist, which is why it
// lives here.
//
// TWO independent, deliberately separate mechanisms (mirrors the split
// pipeline.ts's own P2-S2-FIX already makes between isEligibleForRetry's
// pure sliding-window predicate and claimSourceRetry's atomic cross-instance
// claim — see that file's own comments for the precedent this copies):
//
//  1. `canRefresh` — a pure, directly-testable boundary predicate over a
//     caller-supplied `lastRefreshAt`. It has NO cross-instance safety of
//     its own (nothing stops two different processes from each computing
//     "true" off two different notions of "last") — it exists as the
//     spec-level building block whose 14:59-blocked/15:00-allowed boundary
//     semantics are easy to pin down in isolation, mirroring P2-S2-FIX's own
//     proven 29:59/30:00 convention for a different window.
//  2. `claimManualRefresh` — the actual production mechanism this slice
//     ships: a thin wrapper over `CounterStore` using the SAME atomic
//     window-then-cap claim idiom as `claimSourceRetry` (window claimed
//     first, cap claimed second, so a loser of the window never spends a
//     day-budget unit). Cross-instance-safe because it rides the same
//     Postgres `INSERT ... ON CONFLICT ... RETURNING` every other counter in
//     this codebase already trusts (usage/counters.ts).
//
// The per-user and global DAILY CAPS below are a narrower guarantee than
// the full P0/acceptance-12 atomic-spend-reservation infrastructure (which
// stays BLOCKED per §1k/§1p.C — see the B guide's DESIGN B2, written before
// the manager's E1 ruling moved the cooldown itself into this slice): they
// bound the COUNT of manual-refresh-triggered prepare jobs a user (or all
// users) can enqueue per UTC day, using the same already-proven atomic
// counter primitive `deepReportGlobalDayKey`/`FORCED_REBUILDS_PER_DAY`
// already use elsewhere in usage/counters.ts — not a dollar-budget
// reservation. Named here, not hidden, per this codebase's own convention
// of stating a trade-off rather than silently deciding it.
import type { CounterStore } from "@/lib/usage/counters";

/** Sourced, not invented — see the module header. Kept exact. */
export const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Pure boundary predicate: has at least `REFRESH_COOLDOWN_MS` elapsed since
 * `lastRefreshAt`? Both timestamps are epoch milliseconds (caller's choice
 * of clock/storage) — this function reads no clock and touches no store.
 * `now - lastRefreshAt === REFRESH_COOLDOWN_MS` (exactly 15:00 elapsed) is
 * ALLOWED — the boundary is inclusive on the "allowed" side, matching
 * pipeline.ts's claimSourceRetry/isEligibleForRetry convention
 * (`>= SOURCE_RETRY_INTERVAL_MS`).
 */
export function canRefresh(lastRefreshAt: number, now: number): boolean {
  return now - lastRefreshAt >= REFRESH_COOLDOWN_MS;
}

/**
 * `rate:refresh:<ownerId>:<15-min-bucket-start-ms>` — follows counters.ts's
 * own `rate:<scope>:<user>:<segment>` naming idiom (see that file's
 * `rateKey`). NOT a reuse of `rateKey` itself: that helper is UTC-HOUR
 * granularity only (documented on `utcHourSegment`), the wrong granularity
 * for a 15-minute window — this is a new, purpose-built key.
 */
export function refreshCooldownKey(ownerId: string, now: Date): string {
  const windowStartMs = Math.floor(now.getTime() / REFRESH_COOLDOWN_MS) * REFRESH_COOLDOWN_MS;
  return `rate:refresh:${ownerId}:${windowStartMs}`;
}

function utcDaySegment(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD, matches counters.ts's own (unexported) helper
}

function endOfUtcDay(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/** PROPOSED default, not sourced (POLICY E7's "label, don't hide" rule applied here too). */
export const DEFAULT_MANUAL_REFRESH_USER_DAILY_CAP = 20;
/** PROPOSED default, not sourced. */
export const DEFAULT_MANUAL_REFRESH_GLOBAL_DAILY_CAP = 2000;

export type ManualRefreshDenialReason =
  | "cooldown_active"
  | "user_daily_cap"
  | "global_daily_cap"
  | "store_unavailable";

export type ManualRefreshClaimResult =
  | { allowed: true }
  | { allowed: false; reason: ManualRefreshDenialReason };

export interface ManualRefreshCapOptions {
  userDailyCap?: number;
  globalDailyCap?: number;
}

/**
 * The full manual-refresh gate for enqueueing a refresh-triggered prepare
 * job: 15-minute per-owner cooldown, then per-user daily cap, then global
 * daily cap — checked in that order so a loser at an earlier stage never
 * spends a later stage's budget (same reasoning as claimSourceRetry's
 * "window claimed first, day claimed second"). Every stage fails CLOSED:
 * `!reading.ok` at ANY step returns `store_unavailable` immediately,
 * regardless of which stage was being checked.
 *
 * Anonymous callers have no `ownerId` to key on (matches every other
 * per-owner mechanism in this codebase — `paperCacheScope` is undefined for
 * anonymous requests everywhere else, per the B guide's CURRENT BEHAVIOUR
 * A2) — this function requires a real `ownerId` string; a caller with no
 * signed-in owner must not call it at all, the same boundary
 * `paperCacheScope` already draws.
 */
export async function claimManualRefresh(
  store: CounterStore,
  ownerId: string,
  now: Date,
  options: ManualRefreshCapOptions = {},
): Promise<ManualRefreshClaimResult> {
  const userDailyCap = options.userDailyCap ?? DEFAULT_MANUAL_REFRESH_USER_DAILY_CAP;
  const globalDailyCap = options.globalDailyCap ?? DEFAULT_MANUAL_REFRESH_GLOBAL_DAILY_CAP;

  // 1. 15-minute cooldown window (E1/E2 — the sourced, fail-closed gate).
  const windowStartMs = Math.floor(now.getTime() / REFRESH_COOLDOWN_MS) * REFRESH_COOLDOWN_MS;
  const cooldownKey = refreshCooldownKey(ownerId, now);
  const cooldownReading = await store.increment(
    cooldownKey,
    new Date(windowStartMs + REFRESH_COOLDOWN_MS),
    1,
    now,
  );
  if (!cooldownReading.ok) return { allowed: false, reason: "store_unavailable" };
  if (cooldownReading.value !== 1) return { allowed: false, reason: "cooldown_active" };

  // 2. Per-user daily cap.
  const day = utcDaySegment(now);
  const userReading = await store.increment(`rate:refresh-day:${ownerId}:${day}`, endOfUtcDay(now), 1, now);
  if (!userReading.ok) return { allowed: false, reason: "store_unavailable" };
  if (userReading.value > userDailyCap) return { allowed: false, reason: "user_daily_cap" };

  // 3. Global (all-owners) daily cap.
  const globalReading = await store.increment(`rate:refresh-day:all:${day}`, endOfUtcDay(now), 1, now);
  if (!globalReading.ok) return { allowed: false, reason: "store_unavailable" };
  if (globalReading.value > globalDailyCap) return { allowed: false, reason: "global_daily_cap" };

  return { allowed: true };
}
