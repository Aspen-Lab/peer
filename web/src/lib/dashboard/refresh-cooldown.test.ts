import { describe, expect, it } from "vitest";
import { InMemoryCounterStore, type CounterReading, type CounterStore } from "@/lib/usage/counters";
import {
  DEFAULT_MANUAL_REFRESH_GLOBAL_DAILY_CAP,
  DEFAULT_MANUAL_REFRESH_USER_DAILY_CAP,
  REFRESH_COOLDOWN_MS,
  canRefresh,
  claimManualRefresh,
  refreshCooldownKey,
} from "./refresh-cooldown";

/** Always reports the store as unreachable — proves the fail-CLOSED direction. */
class UnreadableCounterStore implements CounterStore {
  readonly label = "in-memory" as const;
  async increment(): Promise<CounterReading> {
    return { value: 0, ok: false };
  }
  async read(): Promise<CounterReading> {
    return { value: 0, ok: false };
  }
}

describe("canRefresh — pure boundary predicate", () => {
  it("blocks at 14:59.999 elapsed", () => {
    expect(canRefresh(0, REFRESH_COOLDOWN_MS - 1)).toBe(false);
  });

  it("allows at exactly 15:00.000 elapsed", () => {
    expect(canRefresh(0, REFRESH_COOLDOWN_MS)).toBe(true);
  });

  it("allows past the boundary", () => {
    expect(canRefresh(0, REFRESH_COOLDOWN_MS + 1)).toBe(true);
  });

  it("blocks a zero-elapsed refresh", () => {
    expect(canRefresh(1000, 1000)).toBe(false);
  });
});

describe("refreshCooldownKey", () => {
  it("is stable within the same 15-minute bucket", () => {
    const a = refreshCooldownKey("owner-1", new Date("2026-09-24T15:00:00.000Z"));
    const b = refreshCooldownKey("owner-1", new Date("2026-09-24T15:07:00.000Z"));
    expect(a).toBe(b);
  });

  it("changes across a 15-minute bucket boundary", () => {
    const a = refreshCooldownKey("owner-1", new Date("2026-09-24T15:14:59.999Z"));
    const b = refreshCooldownKey("owner-1", new Date("2026-09-24T15:15:00.000Z"));
    expect(a).not.toBe(b);
  });

  it("differs per owner in the same window", () => {
    const now = new Date("2026-09-24T15:00:00.000Z");
    expect(refreshCooldownKey("owner-1", now)).not.toBe(refreshCooldownKey("owner-2", now));
  });
});

describe("claimManualRefresh — the production, counter-backed gate", () => {
  it("allows the first refresh in a fresh window", async () => {
    const store = new InMemoryCounterStore();
    const result = await claimManualRefresh(store, "owner-1", new Date("2026-09-24T15:00:00.000Z"));
    expect(result).toEqual({ allowed: true });
  });

  it("denies a second refresh by the SAME owner inside the SAME 15-minute window", async () => {
    const store = new InMemoryCounterStore();
    const now = new Date("2026-09-24T15:00:00.000Z");
    const first = await claimManualRefresh(store, "owner-1", now);
    const second = await claimManualRefresh(store, "owner-1", new Date(now.getTime() + 60_000));
    expect(first).toEqual({ allowed: true });
    expect(second).toEqual({ allowed: false, reason: "cooldown_active" });
  });

  it("does not block a DIFFERENT owner in the same window (keys are owner-scoped)", async () => {
    const store = new InMemoryCounterStore();
    const now = new Date("2026-09-24T15:00:00.000Z");
    await claimManualRefresh(store, "owner-1", now);
    const other = await claimManualRefresh(store, "owner-2", now);
    expect(other).toEqual({ allowed: true });
  });

  it("allows the SAME owner again once the window rolls over", async () => {
    const store = new InMemoryCounterStore();
    const now = new Date("2026-09-24T15:00:00.000Z");
    await claimManualRefresh(store, "owner-1", now);
    const later = await claimManualRefresh(store, "owner-1", new Date(now.getTime() + REFRESH_COOLDOWN_MS));
    expect(later).toEqual({ allowed: true });
  });

  it("fails CLOSED when the counter store is unreadable (E2 ruling — the opposite of underLimit's fail-open)", async () => {
    const store = new UnreadableCounterStore();
    const result = await claimManualRefresh(store, "owner-1", new Date("2026-09-24T15:00:00.000Z"));
    expect(result).toEqual({ allowed: false, reason: "store_unavailable" });
  });

  it("cross-instance simulation: two SEPARATE CounterStore-backed callers sharing ONE store (the real, Postgres-backed shape) correctly serialize", async () => {
    // Two independent caller objects (simulating two separate serverless
    // instances) that both talk to the SAME store instance — this is what a
    // real deployment looks like (every instance calls the same Supabase
    // RPC). The second caller is denied even though it never touched the
    // first caller's in-process memory.
    const sharedStore = new InMemoryCounterStore();
    const now = new Date("2026-09-24T15:00:00.000Z");
    const callerA = () => claimManualRefresh(sharedStore, "owner-1", now);
    const callerB = () => claimManualRefresh(sharedStore, "owner-1", new Date(now.getTime() + 1000));
    const first = await callerA();
    const second = await callerB();
    expect([first, second].filter((r) => r.allowed)).toHaveLength(1);
  });

  it("cross-instance ISOLATION counter-example: two callers on genuinely SEPARATE stores are NOT coordinated (names the limitation, does not hide it)", async () => {
    // If two serverless instances each fell back to their own in-memory
    // store (e.g. Supabase unconfigured), the cooldown would silently stop
    // being cross-instance-safe. This test documents that this module's
    // cross-instance guarantee depends entirely on being handed a truly
    // shared store (getCounterStore() returns SupabaseCounterStore in a
    // configured deployment) — it is not magic, and a caller handing this
    // function two different in-memory stores gets two independent
    // "allowed" answers.
    const storeA = new InMemoryCounterStore();
    const storeB = new InMemoryCounterStore();
    const now = new Date("2026-09-24T15:00:00.000Z");
    const first = await claimManualRefresh(storeA, "owner-1", now);
    const second = await claimManualRefresh(storeB, "owner-1", now);
    expect(first).toEqual({ allowed: true });
    expect(second).toEqual({ allowed: true }); // both allowed — the named limitation
  });

  it("denies once the per-user daily cap is exceeded, across separate cooldown windows", async () => {
    const store = new InMemoryCounterStore();
    let now = new Date("2026-09-24T00:00:00.000Z");
    const results = [];
    for (let i = 0; i < DEFAULT_MANUAL_REFRESH_USER_DAILY_CAP + 1; i++) {
      results.push(await claimManualRefresh(store, "owner-1", now));
      now = new Date(now.getTime() + REFRESH_COOLDOWN_MS); // advance past the cooldown each time
    }
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(DEFAULT_MANUAL_REFRESH_USER_DAILY_CAP);
    expect(results[results.length - 1]).toEqual({ allowed: false, reason: "user_daily_cap" });
  });

  it("respects a smaller injected userDailyCap override", async () => {
    const store = new InMemoryCounterStore();
    let now = new Date("2026-09-24T00:00:00.000Z");
    const first = await claimManualRefresh(store, "owner-1", now, { userDailyCap: 1 });
    now = new Date(now.getTime() + REFRESH_COOLDOWN_MS);
    const second = await claimManualRefresh(store, "owner-1", now, { userDailyCap: 1 });
    expect(first).toEqual({ allowed: true });
    expect(second).toEqual({ allowed: false, reason: "user_daily_cap" });
  });

  it("denies once the GLOBAL daily cap is exceeded, across different owners", async () => {
    const store = new InMemoryCounterStore();
    const now = new Date("2026-09-24T00:00:00.000Z");
    const first = await claimManualRefresh(store, "owner-1", now, { globalDailyCap: 1 });
    const second = await claimManualRefresh(store, "owner-2", now, { globalDailyCap: 1 }); // different owner -> different cooldown key, same global key
    expect(first).toEqual({ allowed: true });
    expect(second).toEqual({ allowed: false, reason: "global_daily_cap" });
    expect(DEFAULT_MANUAL_REFRESH_GLOBAL_DAILY_CAP).toBeGreaterThan(0);
  });

  it("a cooldown denial never spends a day-budget unit (window checked before the daily caps, mirrors claimSourceRetry's ordering)", async () => {
    const store = new InMemoryCounterStore();
    const now = new Date("2026-09-24T00:00:00.000Z");
    await claimManualRefresh(store, "owner-1", now); // wins the window, spends 1 user-day + 1 global-day unit
    const denied = await claimManualRefresh(store, "owner-1", new Date(now.getTime() + 1000)); // same window -> cooldown denial
    expect(denied).toEqual({ allowed: false, reason: "cooldown_active" });
    const userDay = await store.read(`rate:refresh-day:owner-1:2026-09-24`, now);
    expect(userDay.value).toBe(1); // NOT 2 — the denied call never reached the daily-cap increment
  });
});
