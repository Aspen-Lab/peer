/**
 * The daily cap on operator-funded **forced pool rebuilds**.
 *
 * ABC-freemium 1-21 / 5-02 / 6-01 · R-QUOTA-2, D4, Ruling 13 point 1,
 * Ruling 14 point 3.
 *
 * **It used to be the cap on operator-funded search. Everything that said so is
 * now renamed — the file, the function, the counter, and the usage row.** D2a
 * (Ruling 12) says the operator pays for no search on any plan, so the search
 * fan-out callers are unreachable — `systemSearchAllowed` is hard `false` and
 * `resolveSystemSearchKeys` has no system branch. **The mechanism is NOT dead,
 * and deleting it would be a real regression:** its other caller is 1-18's
 * forced pool rebuild ("refresh now", `jobs/pipeline.ts` and
 * `events/pipeline.ts`, gated on `poolRefreshAllowed`), and a forced rebuild
 * still spends the operator's money on the query-generation LLM call. Without
 * this cap the refresh button is an unbounded spend button.
 *
 * **Two callers, one home.** The ordinary search fan-out in `jobweb`/`eventweb`
 * consumes it — now unreachably — and so does the forced pool rebuild, which is
 * live. Writing the rule twice is how the two would end up disagreeing about the
 * limit.
 *
 * **If operator-funded search is ever restored, this counter must be SPLIT, not
 * just re-pointed.** The three fan-out call sites are dead because no
 * operator-funded provider can be *selected*, not because anything refuses
 * them — `isOperatorFundedSearch` still returns `true` for Brave, Vertex and
 * Gemini. Flipping the flag back would therefore start charging search fan-outs
 * to a counter named `forced_rebuilds_today`, which re-creates in reverse the
 * false-audit defect 6-01 exists to fix. Each of the three sites carries this
 * warning at the line; this is the second copy, because a future reader may
 * arrive here first.
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
 * **ABC-freemium 6-01 · Ruling 14 point 3 — the name matches the counter now.**
 * Ruling 13 point 1 renamed the counter key and the constant to
 * `forced_rebuilds_today` / `FORCED_REBUILDS_PER_DAY` when D2a made "search"
 * false; this function and the usage row it writes kept saying "search" for one
 * more round, so the audit trail for a spend cap recorded the wrong cap. Half a
 * rename is how the defect comes back, which is Ruling 14 point 3's whole point.
 *
 * **Nothing about the behaviour moved.** Same signature, same optional
 * `surface`, same cap, same fail-closed direction, same 200 to the reader with
 * the cached pool served. One recorded fact stopped being false.
 *
 * Returns `true` when there is no user to charge **only** because such a call
 * cannot reach an operator-funded path in the first place — both callers gate on
 * an entitlement, and an entitlement with no user grants neither.
 */
export async function consumeForcedRebuild(
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
  // counter and that direction is untouched: the rebuild is still refused and
  // the surface still serves its free structured sources. What changes is that
  // an outage stops fabricating a trip that never happened — the log line says
  // what actually went wrong, and NO `usage_events` row is written, because a
  // `kind: "breaker"` row means "a cap tripped" and on an outage none did.
  if (!reading.ok) {
    logStoreUnavailable("forced-rebuild", userId);
    return false;
  }

  // D4 names three things a REAL trip does: an error-level line, a `breaker`
  // usage row, and degradation for the rest of the UTC day.
  console.error(
    `[quota] forced-rebuild breaker tripped for ${userId} (limit ${FORCED_REBUILDS_PER_DAY}/day)`,
  );
  // Awaited: this is the audit trail for a spend cap that has already been
  // decided by the counter. Losing it to a cold shutdown would leave a trip
  // with no record.
  await recordUsageEventAwaited({
    user_id: userId,
    kind: "breaker",
    path: "forced-rebuild",
    surface: surface ?? null,
    query_count: count,
    ok: false,
    byok: false,
  });
  return false;
}
