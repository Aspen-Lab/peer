/**
 * The daily cap on operator-funded **forced pool rebuilds**.
 *
 * ABC-freemium 1-21 / 5-02 · R-QUOTA-2, D4, Ruling 13 point 1.
 *
 * **It used to be the cap on operator-funded search, and the counter it charges
 * was renamed when that stopped being true.** D2a (Ruling 12) says the operator
 * pays for no search on any plan, so the search fan-out below is unreachable —
 * `systemSearchAllowed` is hard `false` and `resolveSystemSearchKeys` has no
 * system branch. **The mechanism is NOT dead, and deleting it would be a real
 * regression:** its other caller is 1-18's forced pool rebuild ("refresh now",
 * `jobs/pipeline.ts` and `events/pipeline.ts`, gated on `poolRefreshAllowed`),
 * and a forced rebuild still spends the operator's money on the query-generation
 * LLM call. Without this cap the refresh button is an unbounded spend button.
 *
 * **Two callers, one home.** The ordinary search fan-out in `jobweb`/`eventweb`
 * consumes it — now unreachably — and so does the forced pool rebuild, which is
 * live. Writing the rule twice is how the two would end up disagreeing about the
 * limit.
 *
 * **What this path writes is `kind: "breaker"`, never `kind: "search"`**, which
 * is why R-METER-2 stays N/A under D2a even though this breaker stays reachable.
 *
 * **Fails closed**, like every breaker: an unreadable counter is treated as
 * tripped. A wallet that cannot be read must not be spent, and the cost is
 * bounded — the surface serves its free structured sources, which is what a
 * keyless reader already gets.
 *
 * **"For the rest of the UTC day" is a property of the key, not extra state.**
 * The key carries the UTC date, so a tripped breaker untrips itself at midnight.
 * Do **not** add a `trippedUntil` timestamp: it would be a second source of
 * truth for the same fact.
 */
import {
  FORCED_REBUILDS_PER_DAY,
  breakerTripped,
  endOfUtcDay,
  getCounterStore,
  logStoreUnavailable,
  forcedRebuildDayKey,
} from "./counters";
import { recordUsageEventAwaited } from "./events";

export { FORCED_REBUILDS_PER_DAY };

/**
 * Charge `count` operator-funded units to `userId` and say whether they may run.
 *
 * **The name still says "searches" on purpose** — Ruling 13 point 1 renamed the
 * counter key and the constant, not this function, and the function genuinely
 * still serves both callers (the unreachable search fan-out and the live forced
 * rebuild). Recorded in the round-5 log for the manager rather than renamed on
 * C's own judgement; `path: "system-search"` on the usage row below is the same
 * case.
 *
 * Returns `true` when there is no user to charge **only** because such a call
 * cannot reach an operator-funded path in the first place — both callers gate on
 * an entitlement, and an entitlement with no user grants neither.
 */
export async function consumeSystemSearches(
  userId: string | null,
  count: number,
  now: Date = new Date(),
  surface?: string,
): Promise<boolean> {
  if (!userId || count <= 0) return true;

  const reading = await getCounterStore().increment(
    forcedRebuildDayKey(userId, now),
    endOfUtcDay(now),
    count,
    // One clock (2-01): the same `now` that built the key drives the store's
    // housekeeping sweep, so a caller who pins time keeps its own entries.
    now,
  );
  if (!breakerTripped(reading, FORCED_REBUILDS_PER_DAY)) return true;

  // **The decision is the same either way — only the explanation differs**
  // (2-02 · Ruling 6 point 1). `breakerTripped` fails CLOSED on an unreadable
  // counter and that direction is untouched: the searches are still refused and
  // the surface still serves its free structured sources. What changes is that
  // an outage stops fabricating a trip that never happened — the log line says
  // what actually went wrong, and NO `usage_events` row is written, because a
  // `kind: "breaker"` row means "a cap tripped" and on an outage none did.
  if (!reading.ok) {
    logStoreUnavailable("system-search", userId);
    return false;
  }

  // D4 names three things a REAL trip does: an error-level line, a `breaker`
  // usage row, and degradation for the rest of the UTC day.
  console.error(
    `[quota] system-search breaker tripped for ${userId} (limit ${FORCED_REBUILDS_PER_DAY}/day)`,
  );
  // Awaited: this is the audit trail for a spend cap that has already been
  // decided by the counter. Losing it to a cold shutdown would leave a trip
  // with no record.
  await recordUsageEventAwaited({
    user_id: userId,
    kind: "breaker",
    path: "system-search",
    surface: surface ?? null,
    query_count: count,
    ok: false,
    byok: false,
  });
  return false;
}
