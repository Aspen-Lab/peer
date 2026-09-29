/**
 * Count-based Jev-call reservation (ABC-JEV-INTEGRATION.md §1p.H(1),
 * BINDING): before EVERY Jev call — real or brokered — reserve one call unit
 * against BOTH a per-user daily counter and a global daily counter, using
 * the existing `usage/counters.ts` atomic increment. Fail CLOSED (refuse the
 * call) if either counter is unreadable or over its cap — "a Jev budget cap
 * is a wallet-protecting breaker, not a rate limit" (docs/jev-abc/
 * P3-B-20260924T0525Z.md F-A-P3-06), so it takes `breakerTripped`'s
 * fail-closed direction, the opposite of this codebase's rate-limit
 * convention.
 *
 * This module never makes an HTTP call itself; it is purely the reservation
 * gate `decisions/broker-client.ts` checks strictly before attempting any
 * fetch, on every path including error paths.
 *
 * RESERVATION ORDER (P3-S4-FIX, Round 3 — docs/jev-abc/P3-S4-A-20260924T0905Z.md
 * Finding 2): the per-user counter is reserved FIRST, in isolation. The global
 * counter is only ever reserved once the per-user reservation is known to be
 * within cap. A per-user refusal (over cap, or the counter unreadable) returns
 * immediately and never touches the shared global counter.
 *
 * Before this fix both counters were incremented unconditionally, in
 * parallel, before either reading was inspected — which meant an owner who
 * was already over their OWN per-user cap still consumed a unit of the
 * SHARED global cap on every subsequent (refused) attempt, bounded only by
 * however many retries they could issue. That was budget griefing, not a
 * rate limit doing its job, and is exactly what this ordering fixes.
 *
 * DESIGN CHOICE — still no rollback, but now bounded (docs/jev-abc/
 * P3-S3S4-C-*.md has the original no-rollback reasoning; this note updates it
 * for the new order): if the per-user reservation succeeds but the global
 * reservation then refuses, the per-user counter's increment is NOT rolled
 * back — accepted, safe-direction over-reservation, same as before. What
 * changed is the blast radius: this cost is now bounded by the owner's OWN
 * per-user cap, since once that owner is over their own cap, every further
 * attempt is refused at the per-user check and never reaches the global
 * counter at all.
 */

import { breakerTripped, endOfUtcDay, type CounterStore } from "@/lib/usage/counters";

export type ReserveJevCallRefusalReason =
  | "counter_unreadable"
  | "per_user_cap_exceeded"
  | "global_cap_exceeded";

export type ReserveJevCallResult = { ok: true } | { ok: false; reason: ReserveJevCallRefusalReason };

export interface ReserveJevCallOptions {
  perUserCap: number;
  globalCap: number;
  /** Defaults to the real clock. Every production caller should pass its own, per this codebase's established `CounterStore` convention. */
  now?: Date;
  store: CounterStore;
}

function utcDaySegment(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** `jev:<ownerId>:<UTC-day>` — ABC-JEV-INTEGRATION.md §1p.H(1)'s literal key scheme. */
export function jevPerUserDayKey(ownerId: string, now: Date): string {
  return `jev:${ownerId}:${utcDaySegment(now)}`;
}

/** `jev:all:<UTC-day>` — the ceiling across every owner, for one UTC day. */
export function jevGlobalDayKey(now: Date): string {
  return `jev:all:${utcDaySegment(now)}`;
}

/**
 * Reserves one Jev call unit for `ownerId`. Callers must call this, and must
 * receive `{ok: true}`, strictly before any Jev/broker HTTP attempt — never
 * after, and never skipped on any code path (including a path that will
 * itself go on to fail for some other reason).
 */
export async function reserveJevCall(
  ownerId: string,
  options: ReserveJevCallOptions,
): Promise<ReserveJevCallResult> {
  const now = options.now ?? new Date();
  const windowEndsAt = endOfUtcDay(now);

  // Per-user reservation FIRST, in isolation — a per-user refusal must never
  // touch the shared global counter (see the module doc comment's
  // RESERVATION ORDER note, P3-S4-FIX Finding 2).
  const perUserReading = await options.store.increment(jevPerUserDayKey(ownerId, now), windowEndsAt, 1, now);
  if (breakerTripped(perUserReading, options.perUserCap)) {
    return { ok: false, reason: perUserReading.ok ? "per_user_cap_exceeded" : "counter_unreadable" };
  }

  // Only reserve the shared global counter once the per-user reservation is
  // known to be within cap. Not rolled back if this refuses (see DESIGN CHOICE).
  const globalReading = await options.store.increment(jevGlobalDayKey(now), windowEndsAt, 1, now);
  if (breakerTripped(globalReading, options.globalCap)) {
    return { ok: false, reason: globalReading.ok ? "global_cap_exceeded" : "counter_unreadable" };
  }
  return { ok: true };
}
