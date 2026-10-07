import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyJobPool, type DailyJobPoolOptions } from "@/lib/jobs/pipeline";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { clearEveryOperatorSearchCredential } from "@/test-support/route-harness";
import type { CachedPool, PoolCache } from "./pool-cache";

/**
 * ABC-freemium 1-19 · R-POOL-2, R-QUOTA-2, R-TEST-1 — rewritten for the
 * BYOK-only change (scope (b)).
 *
 * "Refresh now" used to have two gates: an entitlement gate, and a count against
 * a daily forced-rebuild breaker that existed because a paid reader's refresh
 * button was "an unbounded spend button" on Peer's own model and search keys.
 * Peer spends nothing on either any more, so there is nothing to meter and
 * nothing to gate: the breaker, the entitlement and the `poolRefresh` option are
 * all gone, and the daily pool is simply the daily pool. What these cases pin is
 * that nothing a caller sends can force a rebuild.
 *
 * The pipeline is driven with an injected cache holding a marked pool, so
 * "did it rebuild?" is answered by which pool comes back rather than by a spy.
 * Every source is keyless here (no reader key, no environment credential), so a
 * rebuild would fan out to the free structured sources only and cost nothing.
 */

class SeededCache implements PoolCache {
  sets = 0;
  constructor(public stored: CachedPool | null) {}

  async get(): Promise<CachedPool | null> {
    return this.stored;
  }

  async set(_key: string, value: CachedPool): Promise<void> {
    this.sets += 1;
    this.stored = value;
  }
}

const NOW = new Date(2026, 6, 27, 12, 0, 0);
const USER = "refresh-user";

function seededPool(): CachedPool {
  return {
    surface: "jobs",
    items: [],
    facetCounts: {},
    generatedAt: "SEEDED",
    localDate: "2026-07-27",
  } as unknown as CachedPool;
}

const REQUEST = {
  topics: ["molten salt"],
  perSourceLimit: 1,
  topN: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  delete process.env.GOOGLE_API_KEY;
  clearEveryOperatorSearchCredential(vi.stubEnv);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  // Every outward call fails fast; the keyless sources return nothing and the
  // build still completes.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetCounterStoreForTests();
});

describe("the daily pool cannot be forced to rebuild", () => {
  it("serves the cached pool when nothing is asked for", async () => {
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, { cache, now: NOW });

    expect(pool.cacheHit).toBe(true);
    expect(cache.sets).toBe(0);
  });

  it("ignores a poolRefresh option: an ask changes nothing", async () => {
    // The old suite had four cases here (grant, tripped breaker, one increment
    // below the breaker, no user). All four were about a gate that is deleted;
    // what survives of them is the one claim worth keeping — an ask for a forced
    // rebuild changes nothing.
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, {
      cache,
      now: NOW,
      poolRefresh: true,
    } as DailyJobPoolOptions);

    expect(pool.cacheHit).toBe(true);
    expect(cache.sets).toBe(0);
  });

  it("serves the cached pool when the request itself carries a refresh ask and a user", async () => {
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(
      { ...REQUEST, poolRefresh: true, userId: USER } as typeof REQUEST,
      { cache, now: NOW },
    );

    expect(pool.cacheHit).toBe(true);
    expect(cache.sets).toBe(0);
  });
});
