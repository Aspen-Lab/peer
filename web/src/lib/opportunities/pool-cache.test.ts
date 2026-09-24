import { describe, expect, it, vi } from "vitest";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedPaperPool,
  isCachedPool,
  localCalendarDate,
  type CachedPaperPool,
  type CachedPool,
  type PoolCache,
  type PoolCacheKeyInput,
} from "./pool-cache";

const base: PoolCacheKeyInput = {
  surface: "events",
  requiredTopics: ["solid-state batteries", "electrochemistry"],
  exploreTopics: ["cathode materials"],
  careerStage: "PhD Year 4",
  locationPreferences: ["Chicago", "Online"],
  now: new Date(2026, 6, 27, 12, 0, 0),
};

describe("daily opportunity pool cache key", () => {
  it("is deterministic, order-insensitive, and file-safe", () => {
    const first = derivePoolCacheKey(base);
    const reordered = derivePoolCacheKey({
      ...base,
      requiredTopics: [" Electrochemistry ", "SOLID-STATE BATTERIES"],
      exploreTopics: ["  Cathode Materials"],
      locationPreferences: ["online", "chicago"],
    });

    expect(reordered).toBe(first);
    expect(first).toMatch(
      /^peer-pool-v5-events-2026-07-27-[a-f0-9]{32}$/,
    );
  });

  it("ignores aiTier on surfaces that never send it", () => {
    // `aiTier` exists for the papers pool, whose Tier-2 entry carries an LLM
    // ranking a Tier-0 entry does not. Events and jobs pass it as undefined,
    // and an undefined field must not perturb their keys.
    expect(derivePoolCacheKey({ ...base, aiTier: undefined })).toBe(
      derivePoolCacheKey(base),
    );
  });

  it("gives each papers AI tier its own pool", () => {
    const papers: PoolCacheKeyInput = { ...base, surface: "papers" };
    const keys = [
      derivePoolCacheKey({ ...papers, aiTier: 0 }),
      derivePoolCacheKey({ ...papers, aiTier: 1 }),
      derivePoolCacheKey({ ...papers, aiTier: 2 }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("changes for every profile dimension, surface, and local date", () => {
    const keys = [
      derivePoolCacheKey(base),
      derivePoolCacheKey({
        ...base,
        requiredTopics: [...base.requiredTopics, "solid electrolyte"],
      }),
      derivePoolCacheKey({
        ...base,
        exploreTopics: ["anode materials"],
      }),
      derivePoolCacheKey({
        ...base,
        careerStage: "Postdoc",
      }),
      derivePoolCacheKey({
        ...base,
        locationPreferences: ["Berlin"],
      }),
      derivePoolCacheKey({
        ...base,
        surface: "jobs",
      }),
      derivePoolCacheKey({
        ...base,
        now: new Date(2026, 6, 28, 0, 1, 0),
      }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the host's local calendar date rather than UTC slicing", () => {
    const lateLocal = new Date(2026, 6, 27, 23, 59, 0);
    expect(localCalendarDate(lateLocal)).toBe("2026-07-27");
  });

  // 9-25 (Ruling 4): "two profiles with different upload concepts get
  // different pool keys IFF the retrieval queries they generate differ" —
  // the forward half (different concepts -> different key) is already
  // covered in `upload-concepts.test.ts`; this file adds the reverse half
  // right next to the rest of this key's own dimension tests.
  it("folds uploadInterests into the key, order/case-insensitively, same as every other topic list", () => {
    const papers: PoolCacheKeyInput = { ...base, surface: "papers" };
    expect(derivePoolCacheKey({ ...papers, uploadInterests: ["solid electrolyte"] }))
      .not.toBe(derivePoolCacheKey(papers));
    expect(derivePoolCacheKey({ ...papers, uploadInterests: ["Solid Electrolyte"] }))
      .toBe(derivePoolCacheKey({ ...papers, uploadInterests: ["solid electrolyte"] }));
    expect(derivePoolCacheKey({ ...papers, uploadInterests: ["a", "b"] }))
      .toBe(derivePoolCacheKey({ ...papers, uploadInterests: ["b", "a"] }));
  });

  it("an absent uploadInterests and an empty one produce the same key — no private-learning residue when nothing surfaced", () => {
    const papers: PoolCacheKeyInput = { ...base, surface: "papers" };
    expect(derivePoolCacheKey({ ...papers, uploadInterests: [] }))
      .toBe(derivePoolCacheKey(papers));
  });
});

// Compile-time contract guard: adapters may vary, but every implementation
// stores the complete discriminated CachedPool payload.
class TestCache implements PoolCache {
  value: CachedPool | null = null;

  async get(): Promise<CachedPool | null> {
    return this.value;
  }

  async set(_key: string, pool: CachedPool): Promise<void> {
    this.value = pool;
  }
}

void TestCache;

// P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2): "a pool
// where every source failed is not cached as a valid day." The decision of
// WHAT counts as "every source failed" is papers-specific (see
// feed/pipeline.ts's own pool-degraded tests) — this file only proves the
// generic mechanism `getOrBuildCachedPool` now offers: an optional
// `shouldPersist` gate on the freshly-built pool, checked before (and only
// before) writing it to the cache. Omitting the parameter must behave
// exactly as before, since `events/pipeline.ts` and `jobs/pipeline.ts` both
// call this function and never pass it.
describe("getOrBuildCachedPool — optional shouldPersist gate (P2-S2)", () => {
  function fakePaperPool(): CachedPaperPool {
    return {
      surface: "papers",
      items: [],
      aiOrder: [],
      aiReasons: {},
      generatedAt: new Date(2026, 6, 29, 9, 0).toISOString(),
      localDate: "2026-07-29",
    };
  }

  it("persists on a build exactly as before when shouldPersist is omitted", async () => {
    const cache: PoolCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    await getOrBuildCachedPool(cache, "k", isCachedPaperPool, async () =>
      fakePaperPool(),
    );

    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("does not call cache.set when shouldPersist returns false", async () => {
    const cache: PoolCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const loaded = await getOrBuildCachedPool(
      cache,
      "k",
      isCachedPaperPool,
      async () => fakePaperPool(),
      () => false,
    );

    expect(cache.set).not.toHaveBeenCalled();
    // The caller still gets the freshly built pool back — only PERSISTING
    // it was skipped, not building or serving it.
    expect(loaded.pool.surface).toBe("papers");
    expect(loaded.cacheHit).toBe(false);
  });

  it("still calls cache.set when shouldPersist returns true", async () => {
    const cache: PoolCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    await getOrBuildCachedPool(
      cache,
      "k",
      isCachedPaperPool,
      async () => fakePaperPool(),
      () => true,
    );

    expect(cache.set).toHaveBeenCalledTimes(1);
  });
});

// P4-S8a (Round 3) — F-B-P4S8-01, ABC-JEV-INTEGRATION.md §4 Round 3
// "usage-limit interruption recovered; P2-S4b-FIX2 C done; P4-S8 B complete
// + rulings" (Policy E3), docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN
// B1. Before this slice, `getOrBuildCachedPool`'s single-flight map was a
// `WeakMap<PoolCache, Map<string, Promise<CachedPool>>>` keyed by the
// CALLER's `cache` object, so two distinct `PoolCache` instances working
// the exact same pool key never coalesced. That was harmless for the
// anonymous/events/jobs surfaces (they all share one process-wide cache
// singleton — `ephemeralPaperPoolCache` / `getDefaultOpportunityPoolCache()`
// — so there was only ever one object to key on), but silently broken for
// signed-in papers: `feed/pipeline.ts`'s `runFeedPipeline` constructs a
// brand-new `PrivatePaperPoolCache` on every request that omits
// `options.cache`, so two truly concurrent requests for the same owner —
// two tabs, a double click — each built and (up to) each spent Tier-2/Jev
// shadow cost independently, no matter how many landed in the same process
// at once. This block proves the fix: the in-flight map is keyed by the
// pool key STRING alone (already fully unique per owner+scope+surface+date+
// tier — see `derivePoolCacheKey` above), not by cache-object identity.
class SharedPoolCache implements PoolCache {
  constructor(private readonly backing: Map<string, CachedPool>) {}

  async get(key: string): Promise<CachedPool | null> {
    return this.backing.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.backing.set(key, pool);
  }
}

function fakePaperPoolAt(localDate: string): CachedPaperPool {
  return {
    surface: "papers",
    items: [],
    aiOrder: [],
    aiReasons: {},
    generatedAt: new Date(2026, 6, 29, 9, 0).toISOString(),
    localDate,
  };
}

describe("getOrBuildCachedPool — cross-instance in-flight coalescing (P4-S8a, F-B-P4S8-01)", () => {
  it("two distinct PoolCache object instances sharing one key coalesce a concurrent build onto a single build() call, and the follower gets the leader's exact pool", async () => {
    // Two SEPARATE object instances over one shared backing store — the
    // same shape `feed/pool-degraded.test.ts`'s own `SharedPoolCache`
    // uses to simulate two server instances sharing one durable store.
    // Here both instances are queried for the SAME owner/key (unlike that
    // file's cross-instance test), which is exactly the signed-in
    // double-tab/double-click scenario F-B-P4S8-01 describes.
    const backing = new Map<string, CachedPool>();
    const instanceA: PoolCache = new SharedPoolCache(backing);
    const instanceB: PoolCache = new SharedPoolCache(backing);
    const key = "peer-pool-v6-papers-shared-owner-key";
    const build = vi.fn(async () => fakePaperPoolAt("2026-07-29"));

    // Promise.all evaluates both call expressions synchronously, left to
    // right, before either can await anything — so instanceB's call is
    // guaranteed to observe instanceA's already-registered in-flight entry
    // for this key, exactly like a genuine concurrent double-request.
    const [a, b] = await Promise.all([
      getOrBuildCachedPool(instanceA, key, isCachedPaperPool, build),
      getOrBuildCachedPool(instanceB, key, isCachedPaperPool, build),
    ]);

    // RED against today's WeakMap-keyed code: two objects, two separate
    // inner maps, build() called twice. GREEN once single-flight is keyed
    // by the string key alone.
    expect(build).toHaveBeenCalledTimes(1);
    // The follower must receive the SAME pool the leader built, not a
    // second, possibly-different build.
    expect(a.pool).toEqual(b.pool);
    // Leader/follower cacheHit contract — unchanged from the pre-existing
    // same-instance case, now reachable across instances too: exactly one
    // caller reports it built fresh (false), the other reports a coalesced
    // hit (true). Sorted so the assertion doesn't depend on which of the
    // two call sites happens to resolve as the leader.
    expect([a.cacheHit, b.cacheHit].sort()).toEqual([false, true]);
  });

  it("two different keys never share a flight, even on the same cache instance — owner/scope isolation holds because derivePoolCacheKey already folds paperOwnerId + paperScopeIdentity into the key", async () => {
    // One cache instance is enough here: the claim under test is that the
    // KEY, not the object, is what must differ for two builds to run
    // independently. `derivePoolCacheKey` (this file's own key-derivation
    // tests above) proves two owners, two surfaces, or two days always
    // produce different key strings, so two owners can never collide on
    // one key and therefore can never share a flight under this fix either.
    const cache: PoolCache = new SharedPoolCache(new Map());
    const keyOne = "peer-pool-v6-papers-owner-one";
    const keyTwo = "peer-pool-v6-papers-owner-two";
    const buildOne = vi.fn(async () => fakePaperPoolAt("2026-07-29"));
    const buildTwo = vi.fn(async () => fakePaperPoolAt("2026-07-29"));

    const [one, two] = await Promise.all([
      getOrBuildCachedPool(cache, keyOne, isCachedPaperPool, buildOne),
      getOrBuildCachedPool(cache, keyTwo, isCachedPaperPool, buildTwo),
    ]);

    expect(buildOne).toHaveBeenCalledTimes(1);
    expect(buildTwo).toHaveBeenCalledTimes(1);
    expect(one.cacheHit).toBe(false);
    expect(two.cacheHit).toBe(false);
  });

  it("a leader build() rejection propagates to every follower sharing its key, and the flight is cleared afterward so the next call retries fresh", async () => {
    const backing = new Map<string, CachedPool>();
    const instanceA: PoolCache = new SharedPoolCache(backing);
    const instanceB: PoolCache = new SharedPoolCache(backing);
    const key = "peer-pool-v6-papers-failing-owner";
    const failingBuild = vi.fn(async () => {
      throw new Error("simulated build failure");
    });

    const callA = getOrBuildCachedPool(instanceA, key, isCachedPaperPool, failingBuild);
    const callB = getOrBuildCachedPool(instanceB, key, isCachedPaperPool, failingBuild);
    const [resultA, resultB] = await Promise.allSettled([callA, callB]);

    expect(resultA.status).toBe("rejected");
    expect(resultB.status).toBe("rejected");
    if (resultA.status === "rejected") {
      expect((resultA.reason as Error).message).toBe("simulated build failure");
    }
    if (resultB.status === "rejected") {
      expect((resultB.reason as Error).message).toBe("simulated build failure");
    }
    // Only ONE actual build attempt for the shared key, exactly like the
    // success case — the follower does not retry independently, it shares
    // the leader's outcome, good or bad.
    expect(failingBuild).toHaveBeenCalledTimes(1);

    // The failed flight must not linger in the map: a later call for the
    // SAME key starts a brand-new build rather than hanging on, or
    // replaying, the earlier rejection.
    const recovered = await getOrBuildCachedPool(
      instanceA,
      key,
      isCachedPaperPool,
      vi.fn(async () => fakePaperPoolAt("2026-07-29")),
    );
    expect(recovered.cacheHit).toBe(false);
  });
});

// P2-S6-FIX (Round 3) — F-A-P2S6-02, docs/jev-abc/P2-S6-A-20260924T145415Z.md
// NEW FINDING #2. `CachedPaperPool` gains an OPTIONAL `rrf` provenance
// field (mirrors `FeedMeta.rrf`'s shape, feed/types.ts — see feed/pipeline.ts
// for how it's populated/read). Additive: an old pool built before this
// field existed has no `rrf` key at all, and both type guards must keep
// accepting it exactly as before — this file proves that explicitly rather
// than leaving it as an unstated assumption of "optional means safe."
describe("CachedPaperPool.rrf — optional provenance field (P2-S6-FIX, F-A-P2S6-02)", () => {
  function poolWithoutRrf(): CachedPaperPool {
    return {
      surface: "papers",
      items: [],
      aiOrder: [],
      aiReasons: {},
      generatedAt: new Date(2026, 6, 29, 9, 0).toISOString(),
      localDate: "2026-07-29",
    };
  }

  function poolWithRrf(): CachedPaperPool {
    return {
      ...poolWithoutRrf(),
      rrf: {
        "openalex:p0": {
          fusedScore: 1 / 61,
          channels: [{ channel: "openalex", rank: 1 }],
        },
      },
    };
  }

  it("isCachedPaperPool accepts a pool with no rrf field at all (old pools stay valid)", () => {
    expect(isCachedPaperPool(poolWithoutRrf())).toBe(true);
  });

  it("isCachedPaperPool accepts a pool that DOES carry rrf provenance", () => {
    expect(isCachedPaperPool(poolWithRrf())).toBe(true);
  });

  it("isCachedPool (the runtime/unknown-value guard) accepts a raw payload with no rrf key", () => {
    const raw: unknown = JSON.parse(JSON.stringify(poolWithoutRrf()));
    expect(isCachedPool(raw)).toBe(true);
  });

  it("isCachedPool (the runtime/unknown-value guard) accepts a raw payload that DOES carry rrf provenance", () => {
    const raw: unknown = JSON.parse(JSON.stringify(poolWithRrf()));
    expect(isCachedPool(raw)).toBe(true);
    expect((raw as CachedPaperPool).rrf).toEqual(poolWithRrf().rrf);
  });
});
