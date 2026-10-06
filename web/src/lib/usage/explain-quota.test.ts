import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_USERS_EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_SEARCH_TENTHS,
  EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_TURN_TENTHS,
  consumeExplainTurn,
  explainTenthsHouseKey,
  explainTenthsKey,
} from "./explain-quota";
import { getCounterStore, resetCounterStoreForTests } from "./counters";
import { setUsageEventsClientForTests, type UsageEventRow } from "./events";
import { ANONYMOUS_ENTITLEMENT, type Entitlement } from "@/lib/entitlement/types";

// P3-02c (ruling §1h.4, amendment of 08:1xZ 2026-10-06): the explain counter —
// a parallel counter in tenths of a deep-report unit. A normal turn costs one
// tenth, a searched turn ten; each reader has a per-UTC-day cap and all readers
// share a house ceiling; every plan is charged the same; an unreadable counter
// refuses with reason `unavailable` and says nothing about a spent allowance.
// The deep-report counters are not touched here (their own tests pin them).
// The clock is a pinned `now`, never `Date.now()`.

const NOW = new Date("2026-10-06T12:00:00.000Z");
const TOMORROW = new Date("2026-10-07T00:00:01.000Z");
const RESETS_AT = "2026-10-07T00:00:00.000Z";

const rows: UsageEventRow[] = [];

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return { ...ANONYMOUS_ENTITLEMENT, userId: "reader-1", plan: "free", effectivePlan: "free", deepReportsBudget: 5, ...overrides };
}

const FREE = entitlement();
const TRIAL = entitlement({ plan: "trial", effectivePlan: "trial", deepReportsBudget: 20, trialEndsAt: "2026-10-20T00:00:00.000Z" });
const PAID = entitlement({ plan: "paid", effectivePlan: "paid", deepReportsBudget: Number.POSITIVE_INFINITY });

async function used(userId: string, now: Date = NOW): Promise<number> {
  return (await getCounterStore().read(explainTenthsKey(userId, now), now)).value;
}
async function houseUsed(now: Date = NOW): Promise<number> {
  return (await getCounterStore().read(explainTenthsHouseKey(now), now)).value;
}
const normal = { searched: false };
const searching = { searched: true };

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setUsageEventsClientForTests(undefined);
  resetCounterStoreForTests();
});

/** The error lines carrying the stable outage prefix. */
function storeUnavailableLines(): string[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith("[quota] store unavailable"));
}

/** Point the store at a URL no admin client can be built from in-process. */
function breakTheStore(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE-ROLE-NOT-A-KEY");
  resetCounterStoreForTests();
}

describe("the prices and the caps (§1h.4 amendment)", () => {
  it("is one tenth for a normal turn and ten for a searched one, 400 a reader a day, 20,000 across readers", () => {
    expect(EXPLAIN_TURN_TENTHS).toBe(1);
    expect(EXPLAIN_SEARCH_TENTHS).toBe(10);
    expect(EXPLAIN_TENTHS_PER_DAY).toBe(400);
    expect(ALL_USERS_EXPLAIN_TENTHS_PER_DAY).toBe(20000);
  });

  it("a searched turn costs ten normal ones", () => {
    expect(EXPLAIN_SEARCH_TENTHS).toBe(10 * EXPLAIN_TURN_TENTHS);
  });
});

describe("the keys", () => {
  it("names the reader and the UTC day, so it rolls over at midnight UTC", () => {
    const key = explainTenthsKey("user-1", new Date("2026-10-06T23:59:59.000Z"));

    expect(key).toBe("explain_tenths:user-1:2026-10-06");
    expect(explainTenthsKey("user-1", new Date("2026-10-07T00:00:01.000Z"))).not.toBe(key);
    expect(explainTenthsKey("user-2", new Date("2026-10-06T10:00:00.000Z"))).not.toBe(key);
    expect(explainTenthsKey("user-1", new Date("2026-10-06T00:00:01.000Z"))).toBe(key);
  });

  it("has one house key for the day, which is not any reader's and is not the deep-report key", () => {
    expect(explainTenthsHouseKey(NOW)).toBe("explain_tenths:house:2026-10-06");
    expect(explainTenthsHouseKey(TOMORROW)).not.toBe(explainTenthsHouseKey(NOW));
    expect(explainTenthsHouseKey(NOW)).not.toBe(explainTenthsKey("reader-1", NOW));
    expect(explainTenthsKey("reader-1", NOW).startsWith("deep:")).toBe(false);
    expect(explainTenthsHouseKey(NOW).startsWith("deep:")).toBe(false);
  });
});

describe("the charge", () => {
  it("takes one tenth from the reader and from the house for a normal turn", async () => {
    expect(await consumeExplainTurn(FREE, normal, NOW)).toEqual({ allowed: true });

    expect(await used("reader-1")).toBe(1);
    expect(await houseUsed()).toBe(1);
  });

  it("takes ten for a searched turn", async () => {
    expect(await consumeExplainTurn(FREE, searching, NOW)).toEqual({ allowed: true });

    expect(await used("reader-1")).toBe(10);
    expect(await houseUsed()).toBe(10);
  });

  it("adds a mix up exactly: three normal and two searched are twenty-three tenths", async () => {
    for (const shape of [normal, searching, normal, searching, normal]) await consumeExplainTurn(FREE, shape, NOW);

    expect(await used("reader-1")).toBe(23);
    expect(await houseUsed()).toBe(23);
  });

  it("counts each reader apart, and the house across them", async () => {
    await consumeExplainTurn(FREE, normal, NOW);
    await consumeExplainTurn(entitlement({ userId: "reader-2" }), searching, NOW);

    expect(await used("reader-1")).toBe(1);
    expect(await used("reader-2")).toBe(10);
    expect(await used("reader-3")).toBe(0);
    expect(await houseUsed()).toBe(11);
  });

  it("does not touch the deep-report counters", async () => {
    await consumeExplainTurn(FREE, searching, NOW);
    const store = getCounterStore();

    expect((await store.read("deep:reader-1:2026-10", NOW)).value).toBe(0);
    expect((await store.read("deep:reader-1:2026-10-06", NOW)).value).toBe(0);
    expect((await store.read("deep:all:2026-10-06", NOW)).value).toBe(0);
  });

  it("charges every plan the same: free, trial and paid are each held to 400 tenths", async () => {
    for (const [index, plan] of [FREE, TRIAL, PAID].entries()) {
      const reader = entitlement({ ...plan, userId: `plan-reader-${index}` });
      await getCounterStore().increment(explainTenthsKey(reader.userId as string, NOW), null, EXPLAIN_TENTHS_PER_DAY - 1, NOW);

      expect((await consumeExplainTurn(reader, normal, NOW)).allowed).toBe(true);
      expect((await consumeExplainTurn(reader, normal, NOW)).allowed).toBe(false);
    }
  });
});

describe("the per-reader day cap", () => {
  it("allows 400 normal turns and refuses the next, with the hour the day ends", async () => {
    for (let i = 0; i < EXPLAIN_TENTHS_PER_DAY / EXPLAIN_TURN_TENTHS; i += 1) {
      expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(true);
    }

    expect(await consumeExplainTurn(FREE, normal, NOW)).toEqual({ allowed: false, reason: "exhausted", resetsAt: RESETS_AT });
  });

  it("allows 40 searched turns and refuses the next", async () => {
    for (let i = 0; i < EXPLAIN_TENTHS_PER_DAY / EXPLAIN_SEARCH_TENTHS; i += 1) {
      expect((await consumeExplainTurn(FREE, searching, NOW)).allowed).toBe(true);
    }

    expect(await consumeExplainTurn(FREE, searching, NOW)).toEqual({ allowed: false, reason: "exhausted", resetsAt: RESETS_AT });
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);
  });

  it("allows a mix up to the cap: 39 searched turns and ten normal ones are exactly 400", async () => {
    for (let i = 0; i < 39; i += 1) await consumeExplainTurn(FREE, searching, NOW);
    for (let i = 0; i < 10; i += 1) expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(true);

    expect(await used("reader-1")).toBe(EXPLAIN_TENTHS_PER_DAY);
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);
  });

  it("refuses a searched turn that would cross the cap, and takes nothing for it", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY - 5, NOW);
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, EXPLAIN_TENTHS_PER_DAY - 5, NOW);

    expect((await consumeExplainTurn(FREE, searching, NOW)).allowed).toBe(false);

    // The refused ten came back out of both counters ...
    expect(await used("reader-1")).toBe(EXPLAIN_TENTHS_PER_DAY - 5);
    expect(await houseUsed()).toBe(EXPLAIN_TENTHS_PER_DAY - 5);
    // ... so the five tenths still left are five normal turns, not none.
    for (let i = 0; i < 5; i += 1) expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(true);
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);
  });

  it("starts again the next UTC day, with no extra state", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);

    expect((await consumeExplainTurn(FREE, normal, TOMORROW)).allowed).toBe(true);
    expect(await used("reader-1", TOMORROW)).toBe(1);
  });

  it("one reader at the cap does not stop another", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);

    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);
    expect((await consumeExplainTurn(entitlement({ userId: "reader-2" }), normal, NOW)).allowed).toBe(true);
  });
});

describe("the house ceiling", () => {
  it("refuses a reader far under their own cap once the day's total across readers is spent", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY, NOW);

    expect(await consumeExplainTurn(entitlement({ userId: "reader-new" }), normal, NOW)).toEqual({
      allowed: false,
      reason: "exhausted",
      resetsAt: RESETS_AT,
    });
    expect(await used("reader-new")).toBe(0);
    expect(await houseUsed()).toBe(ALL_USERS_EXPLAIN_TENTHS_PER_DAY);
  });

  it("allows up to exactly the ceiling", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY - EXPLAIN_SEARCH_TENTHS, NOW);

    expect((await consumeExplainTurn(FREE, searching, NOW)).allowed).toBe(true);
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);
  });

  it("untrips on the next UTC day", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY, NOW);
    expect((await consumeExplainTurn(FREE, normal, NOW)).allowed).toBe(false);

    expect((await consumeExplainTurn(FREE, normal, TOMORROW)).allowed).toBe(true);
  });
});

describe("no reader, no allowance", () => {
  it("refuses a request with no user id as exhausted, and never reaches the store", async () => {
    const decision = await consumeExplainTurn(entitlement({ userId: null }), normal, NOW);

    expect(decision).toEqual({ allowed: false, reason: "exhausted", resetsAt: RESETS_AT });
    expect(await houseUsed()).toBe(0);
    expect(rows).toHaveLength(0);
    expect(storeUnavailableLines()).toHaveLength(0);
  });
});

describe("the audit trail of a real trip", () => {
  it("writes one breaker row and one error line when a reader's cap trips, naming the reader and no passage", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);

    await consumeExplainTurn(FREE, normal, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: "reader-1", kind: "breaker", path: "explain", ok: false });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("writes one breaker row, under its own path, when the house ceiling trips", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY, NOW);

    await consumeExplainTurn(FREE, normal, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "breaker", path: "explain-house", ok: false });
  });

  it("writes none for a charge that was allowed", async () => {
    await consumeExplainTurn(FREE, searching, NOW);

    expect(rows).toHaveLength(0);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("an unreadable counter fails closed, and is called an outage (§1g.14)", () => {
  it("refuses with reason unavailable, not exhausted", async () => {
    breakTheStore();

    expect(await consumeExplainTurn(FREE, normal, NOW)).toEqual({ allowed: false, reason: "unavailable", resetsAt: RESETS_AT });
  });

  it("is the same for a searched turn and for every plan", async () => {
    breakTheStore();

    for (const who of [FREE, TRIAL, PAID]) {
      for (const shape of [normal, searching]) {
        expect(await consumeExplainTurn(who, shape, NOW)).toMatchObject({ allowed: false, reason: "unavailable" });
      }
    }
  });

  it("writes one [quota] store unavailable line per outage and NO usage row — a trip record would be false", async () => {
    breakTheStore();

    await consumeExplainTurn(FREE, normal, NOW);
    expect(storeUnavailableLines()).toHaveLength(1);
    expect(storeUnavailableLines()[0]).toContain("explain");

    await consumeExplainTurn(PAID, searching, NOW);
    expect(storeUnavailableLines()).toHaveLength(2);
    expect(rows).toHaveLength(0);
  });

  it("tells an outage apart from a spent allowance", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    const exhausted = await consumeExplainTurn(FREE, normal, NOW);
    breakTheStore();
    const outage = await consumeExplainTurn(FREE, normal, NOW);

    expect(exhausted).toMatchObject({ allowed: false, reason: "exhausted" });
    expect(outage).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(outage).not.toEqual(exhausted);
    expect(storeUnavailableLines()).toHaveLength(1);
  });
});
