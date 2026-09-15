/**
 * How many deep reports this reader has left, and what to say when they run out.
 *
 * ABC-freemium 1-20 / 1-21 · R-QUOTA-1, R-QUOTA-2, D4.
 *
 * **One counter across papers + jobs + events** (D4 says so in as many words),
 * so all three report routes increment the same key. Implementing it as three
 * separate counters is the easy accident, which is why `1-23` asserts a papers
 * deep report and a jobs report draw on the same budget.
 *
 * **Check and increment are one round trip.** `increment` returns the value
 * *after* this call's increment, so two tabs cannot both see "4 of 5" and both
 * proceed. Never read-then-write here.
 *
 * ── WHAT THE READER GETS WHEN THE BUDGET IS GONE ─────────────────────────────
 *
 * The **existing** degraded payload — `generateShallowReport` on papers, the
 * `noLlm: true` object on jobs and events — plus a machine-readable `quota`.
 * No error status, no new response shape, nothing new to render an emptiness
 * into. A reader who is out of deep reports gets the deterministic report they
 * would have had without a key, which is exactly what free means.
 *
 * ── THIS COUNTER FAILS CLOSED, AND HERE IS WHY ───────────────────────────────
 *
 * `counters.ts` sets out two opposite rules: rate limits fail open, breakers
 * fail closed. **A deep-report allowance is a spend cap, so it takes the
 * breaker's direction** — an unreadable counter denies the deep read. The cost
 * is bounded and visible: the reader still gets a complete deterministic report,
 * because that is what the degraded path already produces. Failing open would
 * hand out unmetered model calls for the length of an outage.
 *
 * That is a reading of D4 rather than a sentence in it, so it is written here
 * and flagged in the round log rather than left implicit.
 */
import type { Entitlement } from "@/lib/entitlement/types";
import {
  FORCED_REBUILDS_PER_DAY,
  breakerTripped,
  deepReportDayKey,
  deepReportMonthKey,
  deepReportTrialKey,
  endOfUtcDay,
  endOfUtcMonth,
  getCounterStore,
  logStoreUnavailable,
} from "./counters";
import { recordUsageEventAwaited } from "./events";

/** D4 — the paid breaker. Unlimited to the user, capped to protect the wallet. */
export const PAID_DEEP_REPORTS_PER_DAY = 200;

export { FORCED_REBUILDS_PER_DAY };

/**
 * The machine-readable signal R-QUOTA-1 requires. **Additive and optional** —
 * every existing client ignores an unknown key, which is why the server half
 * could land before the UI half.
 */
export interface QuotaSignal {
  /**
   * **Which cap said no** — the monthly/trial allowance, or the daily wallet
   * breaker.
   */
  kind: "deep_report" | "breaker";
  /**
   * **How we know** (ABC-freemium 2-02 · Ruling 4 point 2 · Ruling 6 point 1).
   *
   * `kind` and `reason` are orthogonal on purpose, and a third
   * `kind: "unavailable"` was rejected for exactly that reason: an outage
   * happens on the `breaker` path too, so collapsing the two axes would make a
   * paid outage and a free outage indistinguishable in the payload — losing the
   * information this field exists to add.
   *
   * **Required, not optional.** The whole defect this field fixes was a branch
   * that forgot to say which state it was in; an optional field lets the next
   * branch forget again, and `tsc` is the cheapest available reviewer.
   *
   * The vocabulary is **two values and stays two**. In particular the no-user
   * branch below says `exhausted` rather than inventing a third: it never
   * reaches the store, so there is nothing unavailable about it.
   */
  reason: "exhausted" | "unavailable";
  remaining: number;
  /** ISO instant at which the allowance comes back. */
  resetsAt: string;
}

export interface DeepReportDecision {
  allowed: boolean;
  quota?: QuotaSignal;
}

/**
 * R-QUOTA-1's UI string, in English (Ruling 3 point 1 — the original Chinese was
 * the manager's shorthand, and the product has no other CJK text in it).
 *
 * Kept next to the mechanism so the two cannot drift, and pure so it is
 * testable without rendering anything.
 */
export function quotaMessage(quota: QuotaSignal, now = new Date()): string {
  // `reason` is tested BEFORE `kind` (2-02). An outage is not a cap, so it must
  // never borrow a cap's wording — and it happens on both `kind` paths, so a
  // `kind` test could not have caught it. The copy is Ruling 4 point 2's,
  // verbatim, and deliberately promises nothing about a number of days: during
  // an outage we do not know the count, and a reset date would be a second lie.
  if (quota.reason === "unavailable") {
    return "Deep reports are temporarily unavailable — your allowance is unchanged. Try again shortly.";
  }
  return quota.kind === "breaker"
    ? `Peer is at today's limit for deep reports. Resets in ${resetsIn(quota, now)}.`
    : `You've used this month's deep reports. Resets in ${resetsIn(quota, now)}.`;
}

/**
 * "N hours" under a day, "N days" otherwise (ABC-freemium 3-01 · Ruling 8
 * point 1 · Ruling 9 point 4).
 *
 * **The bug this replaces was the opposite of the one first reported.** The old
 * code was days-only with a `Math.max(1, …)` floor, so "Resets in 0 days" was
 * already impossible — and the floor is what produced the real defect: the
 * daily breaker's `resetsAt` is `endOfUtcDay(now)`, which is under 24 hours *by
 * construction*, so the breaker sentence said **"Resets in 1 day" on every
 * single trip**, overstating a 30-minute wait by 48x. Round-3 B proved it by
 * execution. The monthly path had the same fault on its last day.
 *
 * `Math.ceil` on both units, so a reset instant already in the past still reads
 * "1 hour" rather than a zero or a negative — a reader who is one tick early is
 * told to wait a little, which is true, rather than told a number that reads
 * like a bug. And because `Math.ceil` stays, 25 hours renders "2 days": the
 * days branch can no longer produce "1 day" at all, which is correct and is why
 * the singular-day test moved to a 1-hour fixture rather than being deleted.
 */
function resetsIn(quota: QuotaSignal, now: Date): string {
  const ms = new Date(quota.resetsAt).getTime() - now.getTime();
  if (ms < 86_400_000) {
    const hours = Math.max(1, Math.ceil(ms / 3_600_000));
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.ceil(ms / 86_400_000);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Check and consume one deep report.
 *
 * Call it **immediately before** `resolveProvider` on a deep path, and only on
 * the deep path — R-QUOTA-3's exempt work (shallow paper reports, ranking, the
 * digest, query generation) must never reach here.
 */
export async function consumeDeepReport(
  entitlement: Entitlement,
  now: Date = new Date(),
): Promise<DeepReportDecision> {
  const userId = entitlement.userId;
  // No user, no budget. The report routes answer a signed-out caller 401 well
  // before this, so in practice this is the local "no sign-in mechanism"
  // runtime; it gets the degraded payload rather than an unmetered model call.
  if (!userId) {
    return {
      allowed: false,
      quota: {
        kind: "deep_report",
        // `exhausted`, NOT a third value (2-02). This branch never touches the
        // store, so nothing here is unavailable — the reader simply has no
        // allowance. Two values is the ruled vocabulary; keep it at two.
        reason: "exhausted",
        remaining: 0,
        resetsAt: endOfUtcMonth(now).toISOString(),
      },
    };
  }

  const store = getCounterStore();

  if (entitlement.effectivePlan === "paid") {
    // D4 — unlimited to the reader, behind a hard daily circuit breaker.
    const reading = await store.increment(
      deepReportDayKey(userId, now),
      endOfUtcDay(now),
      // `by` is spelled out because `now` follows it (2-01). One clock.
      1,
      now,
    );
    if (breakerTripped(reading, PAID_DEEP_REPORTS_PER_DAY)) {
      const resetsAt = endOfUtcDay(now).toISOString();
      // **The decision is the same either way — only the explanation differs**
      // (2-02). `breakerTripped` fails CLOSED on an unreadable counter, and that
      // direction is Ruling-level behaviour that this item does not touch: a
      // wallet that cannot be read is not spent. What changes is that we stop
      // *claiming the cap tripped* when it did not.
      if (!reading.ok) {
        // Ruling 6 point 1 — the log line and NO usage row. A `kind: "breaker"`
        // row on an outage is a false trip record for a call that spent
        // nothing, in the one artefact built to say where the money went.
        logStoreUnavailable("deep-report", userId);
        return {
          allowed: false,
          quota: { kind: "breaker", reason: "unavailable", remaining: 0, resetsAt },
        };
      }
      // D4 names three things a REAL trip does: an error-level line, a `breaker`
      // usage row, and degradation for the rest of the UTC day. The third is a
      // property of the key, not of extra state — the date segment changes at
      // midnight and the breaker untrips itself.
      console.error(
        `[quota] deep-report breaker tripped for ${userId} (limit ${PAID_DEEP_REPORTS_PER_DAY}/day)`,
      );
      // **The one usage row that is awaited.** It is the audit trail for a spend
      // cap, and losing it to a cold shutdown would leave a trip with no record.
      // The decision is the counter's; this only records it.
      await recordUsageEventAwaited({
        user_id: userId,
        kind: "breaker",
        path: "deep-report",
        ok: false,
        byok: false,
      });
      return {
        allowed: false,
        quota: { kind: "breaker", reason: "exhausted", remaining: 0, resetsAt },
      };
    }
    return { allowed: true };
  }

  if (entitlement.effectivePlan === "trial") {
    // D4 — 20 over the WHOLE trial. The key carries no period segment, so it
    // never rolls over; the trial expires by date instead (D5).
    const reading = await store.increment(deepReportTrialKey(userId), null, 1, now);
    // `reading.ok` first: an unreadable counter fails CLOSED (see the header).
    if (reading.ok && reading.value <= entitlement.deepReportsBudget) {
      return { allowed: true };
    }
    if (!reading.ok) logStoreUnavailable("deep-report", userId);
    return {
      allowed: false,
      quota: {
        kind: "deep_report",
        // 2-02 — an outage and a spent allowance used to produce byte-identical
        // payloads, so the reader was told they had used up something they had
        // not touched. Never a `usage_events` row here (Ruling 6 point 1); this
        // branch never wrote one anyway.
        reason: reading.ok ? "exhausted" : "unavailable",
        remaining: 0,
        // Honest value, and NOT the next month: a trial's twenty do not come
        // back monthly. What changes is the plan — at `trialEndsAt` the reader
        // becomes free and a monthly allowance starts.
        resetsAt: entitlement.trialEndsAt ?? endOfUtcMonth(now).toISOString(),
      },
    };
  }

  // Free — D4's five per calendar month, in UTC.
  const reading = await store.increment(
    deepReportMonthKey(userId, now),
    endOfUtcMonth(now),
    // `by` is spelled out because `now` follows it (2-01). One clock.
    1,
    now,
  );
  // `reading.ok` first: an unreadable counter fails CLOSED (see the header).
  if (reading.ok && reading.value <= entitlement.deepReportsBudget) {
    return { allowed: true };
  }
  if (!reading.ok) logStoreUnavailable("deep-report", userId);
  return {
    allowed: false,
    quota: {
      kind: "deep_report",
      // 2-02 — see the trial branch above. Same fix, same reason.
      reason: reading.ok ? "exhausted" : "unavailable",
      remaining: 0,
      resetsAt: endOfUtcMonth(now).toISOString(),
    },
  };
}
