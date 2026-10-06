import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedPaperPool,
  isCachedPool,
  localCalendarDate,
  PAPER_POOL_KEY_PREFIX,
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
    // ABC-freemium 1-17 · R-POOL-1 — REWRITTEN, NOT DELETED. The prefix moves
    // from `v5` and a local DATE to `v6` and a local ISO WEEK on this surface.
    // 2026-07-27 is a Monday, so it opens 2026-W31.
    expect(first).toMatch(/^peer-pool-v6-events-2026-W31-[a-f0-9]{32}$/);
  });

  it("keeps papers on a DAILY key while jobs and events go weekly", () => {
    // ABC-freemium 1-17 — the case that catches an over-broad edit. D3 keeps
    // papers daily because they run on free academic sources.
    const monday = new Date(2026, 6, 27, 12, 0, 0);
    expect(
      derivePoolCacheKey({ ...base, surface: "papers", now: monday }),
    ).toMatch(new RegExp(`^${PAPER_POOL_KEY_PREFIX}2026-07-27-[a-f0-9]{32}$`));
    expect(derivePoolCacheKey({ ...base, surface: "jobs", now: monday })).toMatch(
      /^peer-pool-v6-jobs-2026-W31-[a-f0-9]{32}$/,
    );
  });

  it("gives two days in the same ISO week the SAME jobs and events key", () => {
    // The whole point of the item: a rebuild once a week, not once a night.
    const monday = new Date(2026, 6, 27, 12, 0, 0);
    const thursday = new Date(2026, 6, 30, 12, 0, 0);

    for (const surface of ["events", "jobs"] as const) {
      expect(derivePoolCacheKey({ ...base, surface, now: thursday })).toBe(
        derivePoolCacheKey({ ...base, surface, now: monday }),
      );
    }
    // ...and papers still change nightly, which is what makes the assertion
    // above a statement about the fork rather than about the whole function.
    expect(
      derivePoolCacheKey({ ...base, surface: "papers", now: thursday }),
    ).not.toBe(
      derivePoolCacheKey({ ...base, surface: "papers", now: monday }),
    );
  });

  it("changes across a Monday boundary", () => {
    const sunday = new Date(2026, 7, 2, 23, 59, 0);
    const monday = new Date(2026, 7, 3, 0, 1, 0);

    expect(derivePoolCacheKey({ ...base, now: monday })).not.toBe(
      derivePoolCacheKey({ ...base, now: sunday }),
    );
  });

  it("no longer produces a v5-shaped key", () => {
    // The bump is not cosmetic: a v5 daily key and a v6 weekly key would
    // otherwise collide in the shared `opportunity_pools` table. Asserted as
    // "not v5" rather than "is v6" so this test does not go stale on its own
    // the next time either version constant moves independently — papers is
    // now v23 (T2-EXTRACTOR, ABC-JEV-INTEGRATION.md §1bv; previously v22 via
    // NMC-HYPONYM §1bu — before that v21 via QUERY-GENERIC-WORDS §1bs —
    // before that v20 via NON-ASCII-TEXT §1bo — before that v19 via DATASET-RECORDS
    // §1bl — CORRECTION, NON-ASCII-TEXT (§1bo): this comment had not been
    // updated when that bump shipped and still named v18 here — before
    // that v18 via SENSE-CONTEXT-EVIDENCE §1bg, before
    // that v17 via TOKENIZE-PLURALS §1be, before that v16
    // via QUERY-BUDGET, before that v15 via QUERY-QUALITY, before that v14
    // via SENSE-CONTEXT-R3, before that v13 via DEDUP-ANGEW, before that v12
    // via SCORE-ZERO, before that v11 via ABBREV-RECALL, before that v10 via
    // LCO-FORMULA, before that v9 via SENSE-CONTEXT round 2, before that v8
    // via SENSE-CONTEXT round 1, before that v7 via REQUIRED-GATE §1ao.9; see
    // the papers-specific PAPER_POOL_KEY_PREFIX assertion above) while events
    // and jobs stay on CACHE_KEY_VERSION 6.
    for (const surface of ["papers", "events", "jobs"] as const) {
      expect(derivePoolCacheKey({ ...base, surface })).not.toMatch(/^peer-pool-v5-/);
    }
  });

  // T2-EXTRACTOR (ABC-JEV-INTEGRATION.md §1bv) — REWRITTEN, NOT DELETED (was
  // NMC-HYPONYM §1bu's v22 pin): pins the EXACT current papers version,
  // unlike the "not v5" check above (which only rules out the
  // pre-ABC-freemium shape and would stay green through any later bump). A
  // pool built before this fix must not be read back as if it already
  // reflects the comma-form self-declared-pair reading in rule (c) — see
  // this constant's own doc comment in pool-cache.ts for the full v23
  // description — this test is what actually breaks if a future edit
  // forgets to bump PAPER_CACHE_KEY_VERSION.
  it("is on papers cache version 23 (T2-EXTRACTOR, §1bv)", () => {
    expect(PAPER_POOL_KEY_PREFIX).toBe("peer-pool-v23-papers-");
    expect(derivePoolCacheKey({ ...base, surface: "papers" })).toMatch(/^peer-pool-v23-papers-/);
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

  it("changes for every profile dimension, surface, and period", () => {
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
        // ABC-freemium 1-17 — was "the next day", which no longer moves an
        // events key. The period is a week now, so the case steps a week.
        now: new Date(2026, 7, 3, 0, 1, 0),
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

// A reader who brings their own Jev key gets a pool built with Jev's order in
// it. That pool must not be the one a reader without the key shares (adding the
// key at noon would otherwise keep serving the keyless pool until tomorrow), so
// `jevScreening` is part of the key — but ONLY when true, so every key that
// existed before this field is byte-identical (the daily pool of every reader
// without a Jev key is not rebuilt by this change).
describe("pool cache key — jevScreening (a reader's Jev key)", () => {
  const paperInput: PoolCacheKeyInput = {
    surface: "papers",
    requiredTopics: ["solid-state battery", "LCO"],
    exploreTopics: ["catalysis"],
    aiTier: 2,
    paperScopeIdentity: "scope-identity-fixture",
    paperOwnerId: "owner-fixture",
    now: new Date(2026, 6, 29, 9, 0),
  };

  it("leaves every existing key byte-identical when the field is absent (pinned values)", () => {
    // Computed with the code as it stood before the field existed.
    expect(derivePoolCacheKey(paperInput)).toBe("peer-pool-v23-papers-2026-07-29-a20d4bb76a385658ff2b53d56a0f0fc1");
    expect(derivePoolCacheKey({ ...paperInput, aiTier: 0 })).toBe(
      "peer-pool-v23-papers-2026-07-29-b06c55f8f53271189881eaf696c74520",
    );
    expect(derivePoolCacheKey({ ...paperInput, aiTier: undefined })).toBe(
      "peer-pool-v23-papers-2026-07-29-715ae6d0d47e52f96ce1406f03008b1c",
    );
  });

  it("treats jevScreening: undefined like an absent field", () => {
    expect(derivePoolCacheKey({ ...paperInput, jevScreening: undefined })).toBe(derivePoolCacheKey(paperInput));
  });

  it("gives a reader with a Jev key a different pool from the same reader without one, at every AI tier", () => {
    for (const aiTier of [0, 2] as const) {
      const without = derivePoolCacheKey({ ...paperInput, aiTier });
      const withJev = derivePoolCacheKey({ ...paperInput, aiTier, jevScreening: true });
      expect(withJev).not.toBe(without);
      expect(withJev.startsWith("peer-pool-v23-papers-2026-07-29-")).toBe(true);
    }
  });

  it("is stable: the same Jev inputs give the same key", () => {
    expect(derivePoolCacheKey({ ...paperInput, jevScreening: true })).toBe(
      derivePoolCacheKey({ ...paperInput, jevScreening: true }),
    );
  });

  it("still separates owners and days for a Jev pool", () => {
    const a = derivePoolCacheKey({ ...paperInput, jevScreening: true });
    expect(derivePoolCacheKey({ ...paperInput, paperOwnerId: "someone-else", jevScreening: true })).not.toBe(a);
    expect(derivePoolCacheKey({ ...paperInput, now: new Date(2026, 6, 30, 9, 0), jevScreening: true })).not.toBe(a);
  });

  it("the key has no field that could carry the Jev key: only a boolean, true or absent", () => {
    // The type admits `true` only; a key value cannot be passed.
    const input: PoolCacheKeyInput = { ...paperInput, jevScreening: true };
    expect(input.jevScreening).toBe(true);
    const text = readFileSync(join(process.cwd(), "src/lib/opportunities/pool-cache.ts"), "utf8");
    expect(text).toMatch(/jevScreening\?:\s*true;/);
    expect(text).not.toMatch(/jevApiKey/);
  });
});

describe("CachedPaperPool.jev — optional record of what Jev did (a reader's Jev key)", () => {
  function poolWithoutJev(): CachedPaperPool {
    return {
      surface: "papers",
      items: [],
      aiOrder: [],
      aiReasons: {},
      generatedAt: new Date(2026, 6, 29, 9, 0).toISOString(),
      localDate: "2026-07-29",
    };
  }

  it("a pool with no jev field is valid (every old pool stays valid)", () => {
    expect(isCachedPaperPool(poolWithoutJev())).toBe(true);
    expect(isCachedPool(JSON.parse(JSON.stringify(poolWithoutJev())))).toBe(true);
  });

  it("a pool that records what Jev did is valid, and the record survives a JSON round trip", () => {
    const pool: CachedPaperPool = { ...poolWithoutJev(), jev: { status: "partial", screened: 31, of: 50 } };
    expect(isCachedPaperPool(pool)).toBe(true);
    const raw: unknown = JSON.parse(JSON.stringify(pool));
    expect(isCachedPool(raw)).toBe(true);
    expect((raw as CachedPaperPool).jev).toEqual({ status: "partial", screened: 31, of: 50 });
  });
});

/**
 * ABC-freemium 1-19 · R-POOL-2, R-TEST-1.
 *
 * The single-flight assertion is the one that matters: it is what fails if a
 * later change reaches for the obvious "bypass the cache function" shape, which
 * would let two clicks fire two full builds — two Tavily fan-outs, on the
 * operator's key.
 */
describe("getOrBuildCachedPool — forced rebuild (R-POOL-2)", () => {
  const KEY = "peer-pool-v6-jobs-2026-W31-deadbeef";

  function pool(marker: string): CachedPool {
    return {
      surface: "jobs",
      items: [],
      facetCounts: {},
      generatedAt: marker,
      localDate: "2026-07-27",
    } as unknown as CachedPool;
  }

  // Every pool is acceptable here — the cases are about the cache path, not
  // about payload validation. Written as a plain boolean rather than a type
  // predicate so the unused parameter name is a real use.
  const accepts = ((value: CachedPool) =>
    Boolean(value)) as (value: CachedPool) => value is CachedPool;

  class RecordingCache implements PoolCache {
    stored: CachedPool | null = null;
    gets = 0;
    sets = 0;

    async get(): Promise<CachedPool | null> {
      this.gets += 1;
      return this.stored;
    }

    async set(_key: string, value: CachedPool): Promise<void> {
      this.sets += 1;
      this.stored = value;
    }
  }

  it("serves the cache when not forced", async () => {
    const cache = new RecordingCache();
    cache.stored = pool("cached");
    let builds = 0;

    const loaded = await getOrBuildCachedPool(cache, KEY, accepts, async () => {
      builds += 1;
      return pool("fresh");
    });

    expect(loaded.pool.generatedAt).toBe("cached");
    expect(builds).toBe(0);
  });

  it("skips the READ but keeps the WRITE, under the same key", async () => {
    // A nonce in the key would store the rebuilt pool where nobody else will
    // ever look, so the user pays for a rebuild and everyone else — including
    // them, on the next load — still gets the stale pool.
    const cache = new RecordingCache();
    cache.stored = pool("cached");

    const loaded = await getOrBuildCachedPool(
      cache,
      KEY,
      accepts,
      async () => pool("fresh"),
      undefined,
      true,
    );

    expect(loaded.pool.generatedAt).toBe("fresh");
    expect(loaded.cacheHit).toBe(false);
    expect(cache.gets).toBe(0);
    // Written back under the SAME key, so the next ordinary load gets it too.
    expect(cache.sets).toBe(1);
    expect(cache.stored?.generatedAt).toBe("fresh");
  });

  it("builds ONCE for two concurrent forced calls", async () => {
    // The single-flight assertion. This is the one that fails if a later change
    // bypasses `getOrBuildCachedPool` instead of passing the flag into it.
    const cache = new RecordingCache();
    let builds = 0;

    const build = async () => {
      builds += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return pool("fresh");
    };

    await Promise.all([
      getOrBuildCachedPool(cache, KEY, accepts, build, undefined, true),
      getOrBuildCachedPool(cache, KEY, accepts, build, undefined, true),
    ]);

    expect(builds).toBe(1);
  });
});
