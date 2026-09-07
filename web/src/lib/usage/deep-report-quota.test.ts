import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAID_DEEP_REPORTS_PER_DAY,
  consumeDeepReport,
  quotaMessage,
} from "./deep-report-quota";
import {
  FORCED_REBUILDS_PER_DAY,
  consumeSystemSearches,
} from "./search-breaker";
import { getCounterStore, resetCounterStoreForTests } from "./counters";
import { setUsageEventsClientForTests, type UsageEventRow } from "./events";
import { ANONYMOUS_ENTITLEMENT, type Entitlement } from "@/lib/entitlement/types";

/**
 * ABC-freemium 1-23 · R-QUOTA-1, R-QUOTA-2, R-QUOTA-3, D4, R-TEST-1.
 *
 * **The clock is stubbed, never `Date.now()`.** `resetsAt` is a claim about a
 * calendar boundary, and a test that computed it the same way the code does
 * would assert nothing.
 */

const NOW = new Date("2026-09-04T12:00:00.000Z");

const rows: UsageEventRow[] = [];

function entitlement(overrides: Partial<Entitlement>): Entitlement {
  return { ...ANONYMOUS_ENTITLEMENT, userId: "user-1", ...overrides };
}

const FREE = entitlement({
  plan: "free",
  effectivePlan: "free",
  deepReportsBudget: 5,
});
const TRIAL = entitlement({
  plan: "trial",
  effectivePlan: "trial",
  deepReportsBudget: 20,
  trialEndsAt: "2026-09-18T00:00:00.000Z",
});
const PAID = entitlement({
  plan: "paid",
  effectivePlan: "paid",
  deepReportsBudget: Number.POSITIVE_INFINITY,
});

beforeEach(() => {
  rows.length = 0;
  resetCounterStoreForTests();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  setUsageEventsClientForTests({
    from: () => ({
      insert: (inserted: UsageEventRow[]) => {
        rows.push(...inserted);
        return Promise.resolve({ error: null });
      },
    }),
  } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * The error lines carrying 2-02's stable prefix. A's standing tally counts
 * these, so the prefix is asserted byte-for-byte rather than by substring.
 */
function storeUnavailableLines(): string[] {
  const spy = vi.mocked(console.error);
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("[quota] store unavailable"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setUsageEventsClientForTests(undefined);
  resetCounterStoreForTests();
});

describe("free monthly quota (R-QUOTA-1, D4)", () => {
  it("allows five and refuses the sixth", async () => {
    for (let i = 1; i <= 5; i += 1) {
      const decision = await consumeDeepReport(FREE, NOW);
      expect(decision.allowed, `report ${i}`).toBe(true);
      expect(decision.quota).toBeUndefined();
    }

    const sixth = await consumeDeepReport(FREE, NOW);

    expect(sixth.allowed).toBe(false);
    expect(sixth.quota).toEqual({
      kind: "deep_report",
      // 2-02 — the contract gained a required `reason`. Rewritten, not deleted:
      // a real exhaustion says `exhausted`, and an outage now says something
      // different (see "the two failure directions" below).
      reason: "exhausted",
      remaining: 0,
      // First instant of the next UTC month, asserted against a stubbed clock.
      resetsAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("draws papers, jobs and events from ONE counter (D4)", async () => {
    // Three separate counters is the easy accident, and it would give a free
    // reader fifteen deep reports instead of five. Nothing about these calls
    // names a surface, which is the point: the budget is the reader's.
    for (let i = 0; i < 5; i += 1) await consumeDeepReport(FREE, NOW);

    expect((await consumeDeepReport(FREE, NOW)).allowed).toBe(false);
  });

  it("starts again in the next calendar month", async () => {
    for (let i = 0; i < 6; i += 1) await consumeDeepReport(FREE, NOW);

    const october = new Date("2026-10-01T00:00:00.000Z");
    expect((await consumeDeepReport(FREE, october)).allowed).toBe(true);
  });
});

describe("trial cap (R-QUOTA-2, D4)", () => {
  it("allows twenty over the whole trial and refuses the twenty-first", async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await consumeDeepReport(TRIAL, NOW)).allowed).toBe(true);
    }

    const decision = await consumeDeepReport(TRIAL, NOW);

    expect(decision.allowed).toBe(false);
    // NOT the next month: a trial's twenty do not come back monthly. What
    // changes is the plan, at the trial's end.
    expect(decision.quota?.resetsAt).toBe("2026-09-18T00:00:00.000Z");
  });

  it("does NOT reset at a month boundary", async () => {
    // The trial key carries no period segment on purpose. A later reader will
    // want to make it monthly for symmetry; this is what stops them.
    for (let i = 0; i < 20; i += 1) await consumeDeepReport(TRIAL, NOW);

    const october = new Date("2026-10-01T00:00:00.000Z");
    expect((await consumeDeepReport(TRIAL, october)).allowed).toBe(false);
  });

  it("an expired trial falls to the FREE budget, not the trial one", async () => {
    // D5 — expiry is computed at read time, so `effectivePlan` is already
    // `free` here and `deepReportsBudget` is five.
    const expired = entitlement({
      plan: "trial",
      effectivePlan: "free",
      deepReportsBudget: 5,
      trialEndsAt: null,
    });

    for (let i = 0; i < 5; i += 1) {
      expect((await consumeDeepReport(expired, NOW)).allowed).toBe(true);
    }
    expect((await consumeDeepReport(expired, NOW)).allowed).toBe(false);
  });
});

describe("paid breaker (R-QUOTA-2, D4)", () => {
  it("is unlimited to the reader until the daily cap", async () => {
    const store = getCounterStore();
    // Pre-spend the day to one below the cap rather than making 200 calls.
    await store.increment(
      `deep:${PAID.userId}:2026-09-04`,
      null,
      PAID_DEEP_REPORTS_PER_DAY - 1,
    );

    expect((await consumeDeepReport(PAID, NOW)).allowed).toBe(true);

    const overCap = await consumeDeepReport(PAID, NOW);

    expect(overCap.allowed).toBe(false);
    expect(overCap.quota).toEqual({
      kind: "breaker",
      // 2-02 — a REAL trip. R-QUOTA-2's `breaker` vocabulary is unchanged for
      // this case; only the outage case below stops borrowing it.
      reason: "exhausted",
      remaining: 0,
      resetsAt: "2026-09-05T00:00:00.000Z",
    });
  });

  it("writes exactly one breaker row and one error line per trip", async () => {
    const store = getCounterStore();
    await store.increment(
      `deep:${PAID.userId}:2026-09-04`,
      null,
      PAID_DEEP_REPORTS_PER_DAY,
    );

    await consumeDeepReport(PAID, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "user-1",
      kind: "breaker",
      path: "deep-report",
      ok: false,
    });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("untrips on the next UTC day, with no extra state", async () => {
    const store = getCounterStore();
    await store.increment(
      `deep:${PAID.userId}:2026-09-04`,
      null,
      PAID_DEEP_REPORTS_PER_DAY,
    );
    expect((await consumeDeepReport(PAID, NOW)).allowed).toBe(false);

    const tomorrow = new Date("2026-09-05T00:00:01.000Z");
    expect((await consumeDeepReport(PAID, tomorrow)).allowed).toBe(true);
  });
});

// ABC-freemium 5-02 · Ruling 13 point 1 — THIS IS STILL LIVE COVERAGE, and it is
// the only place the 500/day breaker is genuinely exercised. Under D2a the search
// fan-out can no longer reach it, but the FORCED POOL REBUILD still can
// (`jobs/pipeline.ts`, `events/pipeline.ts`, gated on `poolRefreshAllowed`), so
// the cap stays and so do these cases. The counter it charges was renamed to
// `FORCED_REBUILDS_PER_DAY` / `forced_rebuilds_today:<user>:<day>`. The function
// name `consumeSystemSearches` and the row's `path: "system-search"` were NOT
// renamed — Ruling 13 named two things and C does not widen a ruling; both are
// flagged in the round-5 log for the manager.
describe("the system-search breaker (R-QUOTA-2)", () => {
  it("allows the day's searches and refuses the one past the cap", async () => {
    expect(
      await consumeSystemSearches("user-1", FORCED_REBUILDS_PER_DAY, NOW),
    ).toBe(true);

    expect(await consumeSystemSearches("user-1", 1, NOW)).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "breaker", path: "system-search" });
  });

  it("charges the whole fan-out, not one per call", async () => {
    // A fan-out of twelve queries costs twelve, or the 500/day cap would mean
    // 500 fan-outs rather than 500 searches.
    await consumeSystemSearches("user-1", FORCED_REBUILDS_PER_DAY - 5, NOW);

    expect(await consumeSystemSearches("user-1", 12, NOW)).toBe(false);
  });
});

describe("the two failure directions", () => {
  /** Point the store at a URL no admin client can be built from in-process. */
  function breakTheStore(): void {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE-ROLE-NOT-A-KEY");
    resetCounterStoreForTests();
  }

  it("fails CLOSED when the counter store is unreachable", async () => {
    // A deep-report allowance is a spend cap, so it takes the breaker's
    // direction. The reader still gets a complete deterministic report.
    breakTheStore();

    const decision = await consumeDeepReport(FREE, NOW);

    expect(decision.allowed).toBe(false);
    expect(decision.quota?.kind).toBe("deep_report");
    // 2-02 — strengthened. Before this item the assertion above was the whole
    // test, and it passed just as well when the payload claimed the reader had
    // spent an allowance they had not touched.
    expect(decision.quota?.reason).toBe("unavailable");
  });

  it("tells an outage apart from a spent allowance (2-02)", async () => {
    // These two produced BYTE-IDENTICAL payloads before this item, which is the
    // whole defect: the reader was told they had used up something they had
    // not touched. One test, both payloads, so "identical" can never come back.
    for (let i = 0; i < 6; i += 1) await consumeDeepReport(FREE, NOW);
    const exhausted = await consumeDeepReport(FREE, NOW);

    breakTheStore();
    const outage = await consumeDeepReport(FREE, NOW);

    expect(exhausted.quota?.reason).toBe("exhausted");
    expect(outage.quota?.reason).toBe("unavailable");
    expect(outage.quota).not.toEqual(exhausted.quota);
  });

  it("a PAID outage is a breaker that did not trip (Ruling 6 point 1)", async () => {
    // The case that did not exist before 2-02, and the one that caught the
    // false audit row: an outage used to write `kind:"breaker", ok:false` and
    // an error line claiming the 200/day cap had tripped — for a call that
    // spent nothing. `kind` stays `breaker` (that IS the cap in play for a paid
    // reader) and `reason` carries the truth.
    breakTheStore();

    const decision = await consumeDeepReport(PAID, NOW);

    expect(decision.allowed).toBe(false);
    expect(decision.quota).toEqual({
      kind: "breaker",
      reason: "unavailable",
      remaining: 0,
      resetsAt: "2026-09-05T00:00:00.000Z",
    });
    // Ruling 6 point 1 — NO usage row on an outage. A `breaker` row means "a
    // cap tripped"; none did.
    expect(rows).toHaveLength(0);
  });

  it("writes one [quota] store unavailable line per outage, and none on a real exhaustion", async () => {
    // A's standing tally counts occurrences, so the line must be per-decision
    // rather than once per process — which is why `warnOnce` in counters.ts is
    // deliberately NOT reused for it.
    for (let i = 0; i < 6; i += 1) await consumeDeepReport(FREE, NOW);
    expect(storeUnavailableLines()).toHaveLength(0);

    breakTheStore();
    await consumeDeepReport(FREE, NOW);
    expect(storeUnavailableLines()).toHaveLength(1);

    await consumeDeepReport(PAID, NOW);
    expect(storeUnavailableLines()).toHaveLength(2);
  });

  it("the system-search breaker does the same (2-02)", async () => {
    // `consumeSystemSearches` had the identical shape: an outage fabricated a
    // `kind:"breaker", path:"system-search"` row and an error line claiming the
    // 500/day cap tripped. Same fix, same ruling.
    breakTheStore();

    expect(await consumeSystemSearches("user-1", 3, NOW)).toBe(false);

    expect(rows).toHaveLength(0);
    expect(storeUnavailableLines()).toHaveLength(1);
  });
});

describe("quotaMessage (R-QUOTA-1, Ruling 3 point 1)", () => {
  it("is the English string the ruling names", () => {
    expect(
      quotaMessage(
        {
          kind: "deep_report",
          reason: "exhausted",
          remaining: 0,
          resetsAt: "2026-10-01T00:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("You've used this month's deep reports. Resets in 27 days.");
  });

  it("says the count in singular when it is one", () => {
    // ABC-freemium 3-01 — **re-pointed at a 1-hour fixture, not deleted.** This
    // case used a 12-hour reset and asserted "Resets in 1 day", which is the
    // bug written down as an assertion. Because `Math.ceil` stays, the days
    // branch can no longer produce "1 day" at all (25 h renders "2 days"), so
    // the singular case that still exists is the hour.
    expect(
      quotaMessage(
        {
          kind: "deep_report",
          reason: "exhausted",
          remaining: 0,
          resetsAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
        },
        NOW,
      ),
    ).toContain("Resets in 1 hour.");
  });

  it("says the breaker string, unchanged, for a real trip", () => {
    // 2-02 pinned byte-for-byte: the existing two strings must not drift while
    // the outage branch is added beside them. 3-01 changed the RESET CLAUSE
    // only — the breaker's `resetsAt` is `endOfUtcDay(now)`, always under a day
    // by construction, so this sentence used to read "Resets in 1 day" on every
    // trip including one 30 minutes away. The lead sentence is unchanged.
    expect(
      quotaMessage(
        {
          kind: "breaker",
          reason: "exhausted",
          remaining: 0,
          resetsAt: "2026-09-05T00:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("Peer is at today's limit for deep reports. Resets in 12 hours.");
  });

  /**
   * ABC-freemium 3-01 · Ruling 8 point 1 · Ruling 9 point 4 — **the unit
   * boundary.** Round-3 B proved by execution that every daily-breaker trip
   * rendered "Resets in 1 day", overstating a 30-minute wait by 48x, because
   * the old formatter was days-only with a `Math.max(1, …)` floor.
   */
  describe("the reset unit (3-01)", () => {
    function resetIn(ms: number): string {
      return quotaMessage(
        {
          kind: "breaker",
          reason: "exhausted",
          remaining: 0,
          resetsAt: new Date(NOW.getTime() + ms).toISOString(),
        },
        NOW,
      );
    }

    it("uses hours at 23 h 59 m and days at 24 h 1 m", () => {
      expect(resetIn(23 * 3_600_000 + 59 * 60_000)).toContain(
        "Resets in 24 hours.",
      );
      expect(resetIn(24 * 3_600_000 + 60_000)).toContain("Resets in 2 days.");
    });

    it("says half an hour in hours, not in days", () => {
      // The exact case B measured: a breaker that resets in 30 minutes.
      expect(resetIn(30 * 60_000)).toContain("Resets in 1 hour.");
    });

    it("never renders a zero, a negative, or a bare '0 '", () => {
      // A reset instant already in the past clamps to one hour: a reader one
      // tick early is told to wait a little, which is true, rather than shown a
      // number that reads like a bug.
      for (const ms of [-86_400_000, -1, 0, 1, 60_000]) {
        const message = resetIn(ms);
        expect(message).toContain("Resets in 1 hour.");
        expect(message).not.toContain("0 ");
        expect(message).not.toContain("-");
      }
    });

    it("still counts long waits in days", () => {
      expect(resetIn(26 * 86_400_000)).toContain("Resets in 26 days.");
    });

    it("uses hours on the monthly path too, on its last day", () => {
      // The same fault hit the monthly sentence in the last 24 hours of a
      // month, which is exactly when a reader is most likely to be looking.
      expect(
        quotaMessage(
          {
            kind: "deep_report",
            reason: "exhausted",
            remaining: 0,
            resetsAt: new Date(NOW.getTime() + 2 * 3_600_000).toISOString(),
          },
          NOW,
        ),
      ).toBe("You've used this month's deep reports. Resets in 2 hours.");
    });
  });

  it("says the outage copy verbatim, on BOTH kinds (2-02)", () => {
    // Ruling 4 point 2's copy, byte-for-byte. It is asserted on both `kind`
    // values because an outage happens on the breaker path too — that is why
    // `reason` is a separate axis and not a third `kind`.
    const expected =
      "Deep reports are temporarily unavailable — your allowance is unchanged. Try again shortly.";

    for (const kind of ["deep_report", "breaker"] as const) {
      expect(
        quotaMessage(
          { kind, reason: "unavailable", remaining: 0, resetsAt: "2026-10-01T00:00:00.000Z" },
          NOW,
        ),
      ).toBe(expected);
    }
  });

  it("never promises a reset date during an outage (2-02)", () => {
    // We do not know the count during an outage, so a day number would be a
    // second lie on top of the first. This is what stops a later reader
    // "making it consistent" with the other two strings.
    const message = quotaMessage(
      { kind: "deep_report", reason: "unavailable", remaining: 0, resetsAt: "2026-10-01T00:00:00.000Z" },
      NOW,
    );
    expect(message).not.toMatch(/Resets in/);
  });

  it("contains no CJK characters", () => {
    // The product is English-only; the spec's original Chinese was the
    // manager's shorthand (Ruling 3 point 1). 2-02 extends the guard to the
    // new outage string.
    const messages = [
      quotaMessage(
        { kind: "breaker", reason: "exhausted", remaining: 0, resetsAt: "2026-09-05T00:00:00.000Z" },
        NOW,
      ),
      quotaMessage(
        { kind: "deep_report", reason: "exhausted", remaining: 0, resetsAt: "2026-10-01T00:00:00.000Z" },
        NOW,
      ),
      quotaMessage(
        { kind: "deep_report", reason: "unavailable", remaining: 0, resetsAt: "2026-10-01T00:00:00.000Z" },
        NOW,
      ),
    ];

    for (const message of messages) {
      expect(/[一-鿿]/.test(message)).toBe(false);
    }
  });
});
