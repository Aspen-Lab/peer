import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyJobPool } from "@/lib/jobs/pipeline";
import {
  FORCED_REBUILDS_PER_DAY,
  getCounterStore,
  resetCounterStoreForTests,
  forcedRebuildDayKey,
} from "@/lib/usage/counters";
import type { CachedPool, PoolCache } from "./pool-cache";

/**
 * ABC-freemium 1-19 · R-POOL-2, R-QUOTA-2, R-TEST-1.
 *
 * The two gates on "refresh now", asserted where they live. R-POOL-2 requires
 * both: an entitlement gate, and a count against the daily forced-rebuild breaker —
 * "the only thing stopping a paid user's refresh button from being an unbounded
 * spend button".
 *
 * **Refused, never errored.** Both gates degrade the same way: the pool that was
 * already there is served, unchanged. That is the rule every gate in this round
 * follows.
 *
 * The pipeline is driven with an injected cache holding a marked pool, so
 * "did it rebuild?" is answered by which pool comes back rather than by a spy.
 * Every source is keyless here (no Tavily, no Vertex), so a rebuild fans out to
 * the free structured sources only and costs nothing.
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
  userId: USER,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  delete process.env.GOOGLE_API_KEY;
  delete process.env.TAVILY_API_KEY;
  vi.stubEnv("TAVILY_API_KEY", "");
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
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

describe("forced pool rebuild — the two gates", () => {
  it("serves the cached pool when no refresh is asked for", async () => {
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, { cache, now: NOW });

    expect(pool.cacheHit).toBe(true);
    expect(cache.sets).toBe(0);
  });

  it("rebuilds when the route grants a refresh", async () => {
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, {
      cache,
      now: NOW,
      poolRefresh: true,
    });

    expect(pool.cacheHit).toBe(false);
    // Written back under the same key, so everyone else gets it next load.
    expect(cache.sets).toBe(1);
  });

  it("serves the cached pool when the daily forced-rebuild breaker has tripped", async () => {
    // R-QUOTA-2. Pre-spend the day's allowance, then ask for a refresh: the
    // pool that was already there comes back, with no error and no rebuild.
    const store = getCounterStore();
    await store.increment(
      forcedRebuildDayKey(USER, NOW),
      null,
      FORCED_REBUILDS_PER_DAY,
    );
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, {
      cache,
      now: NOW,
      poolRefresh: true,
    });

    expect(pool.cacheHit).toBe(true);
    expect(cache.sets).toBe(0);
  });

  it("still allows a refresh one increment below the breaker", async () => {
    // Without this the case above would pass against a gate that always
    // refuses.
    const store = getCounterStore();
    await store.increment(
      forcedRebuildDayKey(USER, NOW),
      null,
      FORCED_REBUILDS_PER_DAY - 2,
    );
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(REQUEST, {
      cache,
      now: NOW,
      poolRefresh: true,
    });

    expect(pool.cacheHit).toBe(false);
  });

  it("cannot be forced by a request that carries no user", async () => {
    // A forced rebuild is attributed spend. With nobody to attribute it to
    // there is nothing to count it against, so it is refused.
    const cache = new SeededCache(seededPool());

    const pool = await buildDailyJobPool(
      { ...REQUEST, userId: null },
      { cache, now: NOW, poolRefresh: true },
    );

    expect(pool.cacheHit).toBe(true);
  });
});
