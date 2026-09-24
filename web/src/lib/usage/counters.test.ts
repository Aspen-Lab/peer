import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryCounterStore,
  SupabaseCounterStore,
  breakerTripped,
  deepReportDayKey,
  deepReportMonthKey,
  deepReportTrialKey,
  endOfUtcDay,
  endOfUtcHour,
  endOfUtcMonth,
  getCounterStore,
  rateKey,
  resetCounterStoreForTests,
  forcedRebuildDayKey,
  underLimit,
  type CounterSupabaseClient,
} from "./counters";

/**
 * ABC-freemium 1-04 — the tests for 1-02 (R-METER-3, R-METER-4).
 *
 * The two that matter most are the concurrency case (an increment that is not
 * atomic hands two callers the same number, which is how a 5-report quota
 * becomes a 6-report one) and the fail-open/fail-closed asymmetry, which is
 * documented by comment in the module and by assertion here so a later round
 * cannot "make it consistent".
 */

const NOW = new Date("2026-09-04T12:34:56.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
  resetCounterStoreForTests();
});

describe("counter keys", () => {
  it("carries the period in the key, in UTC", () => {
    expect(rateKey("paper-feed", "u1", NOW)).toBe(
      "rate:paper-feed:u1:2026-09-04T12",
    );
    expect(deepReportMonthKey("u1", NOW)).toBe("deep:u1:2026-09");
    expect(deepReportDayKey("u1", NOW)).toBe("deep:u1:2026-09-04");
    // 5-02 · Ruling 13 point 1 — was `systemSearchDayKey` and `search:u1:...`.
    // The counter now guards the forced pool rebuild, not a search, so the key
    // says so. Free to change: migrations unapplied, no users, nothing orphaned.
    expect(forcedRebuildDayKey("u1", NOW)).toBe(
      "forced_rebuilds_today:u1:2026-09-04",
    );
  });

  it("gives the trial cap no period segment at all", () => {
    // 20 over the whole 14 days, not 20 per period. A date segment here would
    // hand every trial a fresh twenty each month.
    expect(deepReportTrialKey("u1")).toBe("deep:u1:trial");
  });

  it("computes window ends in UTC, not the server's local zone", () => {
    expect(endOfUtcHour(NOW).toISOString()).toBe("2026-09-04T13:00:00.000Z");
    expect(endOfUtcMonth(NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("InMemoryCounterStore", () => {
  it("labels itself honestly", () => {
    expect(new InMemoryCounterStore().label).toBe("in-memory");
  });

  it("returns the post-increment value", async () => {
    const store = new InMemoryCounterStore();
    expect((await store.increment("k", null)).value).toBe(1);
    expect((await store.increment("k", null)).value).toBe(2);
    expect((await store.read("k")).value).toBe(2);
  });

  it("prunes against the caller's clock, not the process clock", async () => {
    // ABC-freemium 2-01 · Ruling 5 point 3. `prune` used to read `Date.now()`
    // while its caller passed a pinned `now`, so an entry written with a window
    // that is "in the future" by the caller's clock was swept on the very next
    // call because the real clock had already passed it.
    //
    // The date below is in the past on ANY real clock, forever, so unlike a
    // fixture pinned near today this case can never age into a false pass or a
    // false failure. Under the old code the second increment returns 1.
    const store = new InMemoryCounterStore();
    const past = new Date("2020-01-01T12:00:00.000Z");

    await store.increment("k", endOfUtcDay(past), 1, past);

    expect((await store.increment("k", endOfUtcDay(past), 1, past)).value).toBe(2);
    expect((await store.read("k", past)).value).toBe(2);
  });

  it("does not let one user's day-window entry sweep another's", async () => {
    // ABC-freemium 2-01 — the same defect wearing different clothes, and no
    // existing test covered it: with the process clock past the shared day
    // boundary, `user-b`'s increment deleted `user-a`'s live entry.
    const store = new InMemoryCounterStore();
    const past = new Date("2020-01-01T12:00:00.000Z");
    const windowEnd = endOfUtcDay(past);

    await store.increment("deep:user-a:2020-01-01", windowEnd, 1, past);
    await store.increment("deep:user-b:2020-01-01", windowEnd, 1, past);

    expect((await store.read("deep:user-a:2020-01-01", past)).value).toBe(1);
    expect((await store.read("deep:user-b:2020-01-01", past)).value).toBe(1);
  });

  it("hands N concurrent increments N distinct values", async () => {
    // If the implementation awaited between reading and writing, two callers
    // would both see 4 and both proceed — which is exactly how a quota leaks.
    const store = new InMemoryCounterStore();
    const readings = await Promise.all(
      Array.from({ length: 50 }, () => store.increment("k", null)),
    );
    const values = readings.map((r) => r.value).sort((a, b) => a - b);

    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(values).size).toBe(50);
  });
});

describe("SupabaseCounterStore", () => {
  it("labels itself supabase and returns the RPC's value", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });
    const store = new SupabaseCounterStore({
      rpc,
    } as unknown as CounterSupabaseClient);

    const reading = await store.increment("deep:u1:2026-09", null, 1);

    expect(store.label).toBe("supabase");
    expect(reading).toEqual({ value: 7, ok: true });
    expect(rpc).toHaveBeenCalledWith("increment_usage_counter", {
      p_key: "deep:u1:2026-09",
      p_window_ends_at: null,
      p_by: 1,
    });
  });

  it("reports not-ok rather than throwing when the store errors", async () => {
    const store = new SupabaseCounterStore({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "down" } }),
    } as unknown as CounterSupabaseClient);

    await expect(store.increment("k", null)).resolves.toEqual({
      value: 0,
      ok: false,
    });
  });
});

describe("store selection (R-METER-4)", () => {
  it("uses the in-memory fallback when Supabase is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    resetCounterStoreForTests();

    expect(getCounterStore().label).toBe("in-memory");
  });

  it("is never selected when the Supabase env is present", () => {
    // R-METER-4's rule is about configuration, not about being in development —
    // which is why this does not read NODE_ENV the way pool-cache-runtime does.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "PROBE-NOT-A-KEY");
    resetCounterStoreForTests();

    expect(getCounterStore().label).toBe("supabase");
  });
});

describe("the two failure rules", () => {
  it("fails OPEN for a rate limit", () => {
    // A Supabase outage that answers 429 to every signed-in user is a worse
    // failure than an hour of unmetered use.
    //
    // The `ok: false` reading below carries a value ABOVE the limit on purpose.
    // The store itself always returns 0 on failure, so asserting with 0 would
    // pass whether or not the rule existed — 0 is under every limit. The rule
    // being tested is "when `ok` is false the answer is `true` whatever the
    // value says", and only a value over the limit can state that.
    expect(underLimit({ value: 999, ok: false }, 60)).toBe(true);
    expect(underLimit({ value: 0, ok: false }, 60)).toBe(true);
    expect(underLimit({ value: 60, ok: true }, 60)).toBe(true);
    expect(underLimit({ value: 61, ok: true }, 60)).toBe(false);
  });

  it("fails CLOSED for a breaker", () => {
    // A wallet that cannot be read must not be spent. The caller degrades to
    // the existing no-LLM path — never an error.
    expect(breakerTripped({ value: 0, ok: false }, 200)).toBe(true);
    expect(breakerTripped({ value: 200, ok: true }, 200)).toBe(false);
    expect(breakerTripped({ value: 201, ok: true }, 200)).toBe(true);
  });
});
