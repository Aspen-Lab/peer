import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import { DblpBotCheckError } from "@/lib/sources/dblp";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPaperPool, CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { isCachedPaperPool } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import {
  InMemoryCounterStore,
  resetCounterStoreForTests,
  type CounterReading,
  type CounterStore,
} from "@/lib/usage/counters";

// P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2)/§3c. Before
// this slice, a source's own outage was indistinguishable from a
// legitimately quiet day (every adapter swallowed its failure to `[]`), and
// even if it HAD been visible, `getOrBuildCachedPool` cached the pool
// unconditionally and a cache-hit response always reported `meta.errors: {}`
// regardless of what the build actually saw. This file proves the fix at the
// pipeline level: a real per-source failure survives into `sourceStatus` and
// `meta.errors` (on both a build AND a later cache-hit response), a fully
// failed build is never cached as a valid day, and a degraded cache hit
// retries ONLY the failed source, only within the stated bounds, merging any
// recovered items into the pool rather than the served response being stuck
// wrong for the rest of the day.

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();

  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }

  onlyPool(): CachedPaperPool {
    const pools = [...this.values.values()];
    expect(pools).toHaveLength(1);
    const pool = pools[0];
    if (!isCachedPaperPool(pool)) throw new Error("expected a papers pool");
    return pool;
  }
}

// P2-S2-FIX (Round 3) — F-A-P2S2-01. Simulates TWO SERVER INSTANCES sharing
// one durable store (e.g. two function invocations both reading/writing the
// same Supabase row): two DISTINCT `PoolCache` object instances — so the
// in-process single-flight WeakMap, keyed by object identity, never
// coalesces between them, exactly like two real processes that don't share
// memory — that both read and write the SAME backing `Map`.
class SharedPoolCache implements PoolCache {
  constructor(private readonly backing: Map<string, CachedPool>) {}

  async get(key: string): Promise<CachedPool | null> {
    return this.backing.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.backing.set(key, pool);
  }
}

function onlyPoolFrom(backing: Map<string, CachedPool>): CachedPaperPool {
  const pools = [...backing.values()];
  expect(pools).toHaveLength(1);
  const pool = pools[0];
  if (!isCachedPaperPool(pool)) throw new Error("expected a papers pool");
  return pool;
}

// Titles literally carry the request topic — an unrelated, pre-existing
// literal-keyword admission gate (F-A-P2-03, a different finding entirely)
// would otherwise drop these candidates before they ever reach this slice's
// own sourceStatus/meta.errors/retry logic, and this file has no business
// exercising that gate.
const paperFrom = (source: RawItem["source"], id: string, label: string): RawItem => ({
  id: `${source}:${id}`,
  source,
  title: `Solid-State Battery Research Note: ${label}`,
  authors: ["A. Researcher"],
  abstract: "An abstract about solid-state battery electrolytes.",
  url: `https://example.org/${id}`,
  publishedAt: "2026-07-20",
  venue: "Journal of Testing",
  tags: ["solid-state battery"],
  metadata: {},
});

const originalOpenalexFetch = bySourceId.openalex.fetch;
const originalS2Fetch = bySourceId.semantic_scholar.fetch;
const originalDblpFetch = bySourceId.dblp.fetch;

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  bySourceId.semantic_scholar.fetch = originalS2Fetch;
  bySourceId.dblp.fetch = originalDblpFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// P2-S2-FIX (Round 3) — the retry claim (`claimSourceRetry` in pipeline.ts)
// calls `getCounterStore()` whenever a test doesn't pass its own
// `counterStore` option (every pre-existing test below, plus one new one).
// Forcing the in-memory fallback and resetting its memoized singleton
// between tests is this codebase's established convention for this exact
// situation (see `deep-report-quota.test.ts`) — it keeps every test
// deterministic regardless of the ambient shell environment, and stops one
// test's counts leaking into the next via the module-level singleton.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetCounterStoreForTests();
});

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier: 0,
  });
}

describe("degraded paper pools — visibility + retry (P2-S2)", () => {
  it("records failed for a source whose fetch rejects and ok for the one that succeeds, caches the pool as degraded, and names the failure in meta.errors on the build response", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated outage");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex", "semantic_scholar"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-degraded-1"),
      },
      { cache, now },
    );

    expect(result.meta.errors.openalex).toMatch(/openalex/i);
    expect(result.items.map((item) => item.id)).toEqual([
      "semantic_scholar:ok-1",
    ]);

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.status).toBe("failed");
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(0);
    expect(stored.sourceStatus?.semantic_scholar?.status).toBe("ok");
  });

  it("does not cache a pool where every attempted source failed — and returns the honest empty result without padding", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated total outage");
    });
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-degraded-2"),
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.errors.openalex).toMatch(/openalex/i);
    expect(cache.values.size).toBe(0);
  });

  it("a same-day cache hit within 30 minutes still reports the earlier failure and does not retry yet", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated outage");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-3");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    const second = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 9, 15),
    });

    expect(second.meta.errors.openalex).toMatch(/openalex/i);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
  });

  it("a cache hit 30+ minutes later retries only the failed source and merges its items", async () => {
    let openalexCalls = 0;
    bySourceId.openalex.fetch = vi.fn(async () => {
      openalexCalls += 1;
      if (openalexCalls === 1) throw new Error("openalex: simulated outage");
      return [paperFrom("openalex", "recovered-1", "A Paper That Recovered")];
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-4");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    const first = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 9, 0),
    });
    expect(first.meta.errors.openalex).toBeDefined();

    const second = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 9, 31),
    });

    // Only the failed source was retried — the healthy one was never
    // touched again.
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);
    expect(bySourceId.semantic_scholar.fetch).toHaveBeenCalledTimes(1);
    expect(second.meta.errors.openalex).toBeUndefined();
    expect(second.items.map((item) => item.id).sort()).toEqual(
      ["openalex:recovered-1", "semantic_scholar:ok-1"].sort(),
    );

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.status).toBe("ok");
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(1);
  });

  it("never retries more than 3 times in one local day", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: still down");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-5");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    // Build (attempt 1) + 3 eligible retries, each >=31 minutes apart, same
    // local day: 9:00, 9:31, 10:02, 10:33 — that is the build plus exactly 3
    // retries, the stated cap.
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 31) });
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 10, 2) });
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 10, 33) });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(4);

    // A 4th retry opportunity (well past another 30 minutes) must NOT fire —
    // the day's 3-retry cap was already spent.
    const fifth = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 11, 4),
    });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(4);
    expect(fifth.meta.errors.openalex).toBeDefined();

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(3);
    expect(stored.sourceStatus?.openalex?.status).toBe("failed");
  });

  // DBLP-BOTWALL (ABC-JEV-INTEGRATION.md §1ba). dblp.org sometimes answers a
  // plain HTTP 200 whose body is an anti-automation challenge page instead
  // of data; `sources/dblp.ts` now recognizes this and throws the named
  // `DblpBotCheckError` instead of a bare JSON-parse `SyntaxError`. These
  // two cases prove the pipeline-level half of that fix: the failure stays
  // isolated to dblp exactly like any other source's failure already does
  // (`Promise.allSettled`), and ruling 2's back-off — no same-day retry for
  // a failure classified as the challenge, while an ordinary failure on
  // another source keeps today's normal retry behaviour.
  it("(DBLP-BOTWALL) a bot-check failure on one source does not affect a concurrently succeeding source — pool-level isolation", async () => {
    bySourceId.dblp.fetch = vi.fn(async () => {
      throw new DblpBotCheckError("text/html; charset=utf-8");
    });
    bySourceId.openalex.fetch = vi.fn(async () => [
      paperFrom("openalex", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["dblp", "openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-degraded-dblp-1"),
      },
      { cache, now },
    );

    expect(result.meta.errors.dblp).toMatch(/bot-check page/i);
    expect(result.items.map((item) => item.id)).toEqual(["openalex:ok-1"]);

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.dblp?.status).toBe("failed");
    expect(stored.sourceStatus?.dblp?.retryBlockedToday).toBe(true);
    expect(stored.sourceStatus?.openalex?.status).toBe("ok");
  });

  it("(DBLP-BOTWALL) a bot-challenge failure is not retried the same day, while an ordinary failure on another source still is", async () => {
    bySourceId.dblp.fetch = vi.fn(async () => {
      throw new DblpBotCheckError("text/html; charset=utf-8");
    });
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: still down");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-dblp-2");
    const req = {
      topics: ["solid-state battery"],
      sources: ["dblp" as const, "openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    expect(bySourceId.dblp.fetch).toHaveBeenCalledTimes(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    // 31 minutes later both failures are old enough, and under the 3/day cap,
    // by the ORDINARY rule — but dblp's is a bot-challenge failure, so only
    // openalex is retried.
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 31) });
    expect(bySourceId.dblp.fetch).toHaveBeenCalledTimes(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);

    // Two more eligible windows the same local day: openalex keeps retrying
    // up to its normal 3-per-day cap; dblp never fires again.
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 10, 2) });
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 10, 33) });
    expect(bySourceId.dblp.fetch).toHaveBeenCalledTimes(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(4);

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.dblp?.status).toBe("failed");
    expect(stored.sourceStatus?.dblp?.retryCount).toBe(0);
    expect(stored.sourceStatus?.dblp?.retryBlockedToday).toBe(true);
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(3);
  });
});

// P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2). The
// fresh-A review above proved the retry bound only held under SEQUENTIAL
// access: N genuinely concurrent (`Promise.all`) retry-eligible requests for
// the same degraded pool measured N independent fetches of the same failed
// source (15-for-15 and 6-for-6), not the "at most once per 30 minutes"
// §1p.B(2) requires — because `retryFailedSources` had no coalescing of its
// own and the durable private-pool store's `set()` is a plain last-write-
// wins upsert. These cases exercise the two-layer fix directly: an
// in-process single-flight for concurrent callers sharing one cache
// instance, and a cross-instance claim (the existing atomic
// `usage/counters.ts` store) for callers that don't share one — including a
// simulated second server instance, a simulated counter-store outage, the
// 30-minute window rolling over instead of blocking forever, and the
// 3-per-day cap holding even under concurrent cross-instance bursts.
describe("degraded paper pools — concurrent retry coalescing (P2-S2-FIX)", () => {
  it("N concurrent retry-eligible reads against the same cache share one in-process single-flight, producing exactly one fetch (not N)", async () => {
    let openalexCalls = 0;
    bySourceId.openalex.fetch = vi.fn(async () => {
      openalexCalls += 1;
      if (openalexCalls === 1) throw new Error("openalex: simulated outage");
      return [paperFrom("openalex", "recovered-1", "A Paper That Recovered")];
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-6");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    expect(openalexCalls).toBe(1);

    const burstNow = new Date(2026, 6, 29, 9, 31);
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, () => runFeedPipeline(req, { cache, now: burstNow })),
    );

    // Before the fix: N independent fetches (RED). After: exactly one.
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.meta.errors.openalex).toBeUndefined();
      expect(result.items.map((item) => item.id)).toContain("openalex:recovered-1");
    }

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(1);
  });

  it("a second server instance (fresh in-process single-flight state) sharing the same durable store and counter store still produces at most one fetch within the window", async () => {
    let openalexCalls = 0;
    bySourceId.openalex.fetch = vi.fn(async () => {
      openalexCalls += 1;
      if (openalexCalls === 1) throw new Error("openalex: simulated outage");
      return [paperFrom("openalex", "recovered-1", "A Paper That Recovered")];
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);

    const backing = new Map<string, CachedPool>();
    const instanceA = new SharedPoolCache(backing);
    const instanceB = new SharedPoolCache(backing);
    const counterStore = new InMemoryCounterStore();
    const scope = scopeFor("owner-degraded-7");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, {
      cache: instanceA,
      now: new Date(2026, 6, 29, 9, 0),
      counterStore,
    });
    expect(openalexCalls).toBe(1);

    const burstNow = new Date(2026, 6, 29, 9, 31);
    // Three requests land on "instance A", three on "instance B" — distinct
    // PoolCache object identities, so the in-process single-flight gives
    // EACH group its own, separate coalescing (proven insufficient alone by
    // itself in this exact split). Only the counter-store claim, shared by
    // both instances, can still prevent a second fetch across that boundary.
    const results = await Promise.all([
      ...Array.from({ length: 3 }, () =>
        runFeedPipeline(req, { cache: instanceA, now: burstNow, counterStore }),
      ),
      ...Array.from({ length: 3 }, () =>
        runFeedPipeline(req, { cache: instanceB, now: burstNow, counterStore }),
      ),
    ]);

    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);
    // Every response is internally TRUTHFUL, even though which group's
    // three callers see the recovery and which see the still-failed status
    // is a genuine, acceptable race (exactly like two real processes: the
    // group that didn't win this window's claim never retried, so it
    // reports the same honest failure it already had — never something
    // else, and never the OTHER group's recovered item pretending to be
    // its own). What the fix guarantees is the FETCH COUNT above and the
    // FINAL stored state below, not which specific caller sees what.
    for (const result of results) {
      if (result.meta.errors.openalex !== undefined) {
        expect(result.meta.errors.openalex).toMatch(/openalex/i);
      }
    }
    const stored = onlyPoolFrom(backing);
    expect(stored.sourceStatus?.openalex?.status).toBe("ok");
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(1);
  });

  it("skips the retry fetch entirely when the counter store is unreadable (fail closed), but still reports the stored failure truthfully", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated outage");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-8");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };
    const unreadable: CounterStore = {
      label: "in-memory",
      async increment(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
      async read(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    const second = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 9, 31),
      counterStore: unreadable,
    });

    // No retry fetch fired at all — fail closed, no extra spend.
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    // The pre-existing failure is still honestly reported, not silently
    // dropped just because the retry was skipped.
    expect(second.meta.errors.openalex).toMatch(/openalex/i);

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(0);
    expect(stored.sourceStatus?.openalex?.status).toBe("failed");
  });

  // F-A-P2S2FIX-01 (fresh P2-S2-FIX reviewer,
  // docs/jev-abc/P2-S2-FIX-A-20260924T090527Z.md, MEDIUM) — manager-assigned
  // to the P4-S6 pipeline.ts writer. Unlike the "unreadable" test above (a
  // CounterStore that answers `{ok:false}` gracefully), THIS counter store's
  // increment() itself THROWS — simulating e.g. a live Supabase-backed store
  // whose network call rejects rather than resolving a failure value. Before
  // the fix, retryFailedSources's own caller in runFeedPipeline had no
  // try/catch (unlike the very next line, the cache.set write-back, which
  // already had one) — the throw propagated all the way out of
  // runFeedPipeline and the whole feed READ rejected, even though a
  // perfectly good degraded pool already existed to serve as-is.
  it("(F-A-P2S2FIX-01) a counterStore whose increment() throws degrades to 'no retry this read' instead of rejecting the whole feed response", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated outage");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-degraded-p2s2fix01");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };
    const throwingCounterStore: CounterStore = {
      label: "in-memory",
      async increment(): Promise<CounterReading> {
        throw new Error("counter store network error");
      },
      async read(): Promise<CounterReading> {
        throw new Error("counter store network error");
      },
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0) });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    // RED before the fix: this call rejects instead of resolving.
    const second = await runFeedPipeline(req, {
      cache,
      now: new Date(2026, 6, 29, 9, 31),
      counterStore: throwingCounterStore,
    });

    // No retry fetch fired — the claim itself threw before any fetch.
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    // The pre-existing failure is still honestly reported, never silently
    // dropped or replaced by a fabricated success just because the retry
    // attempt crashed.
    expect(second.meta.errors.openalex).toMatch(/openalex/i);
    // The served pool itself is never dropped/emptied by the crash — the
    // OK source's item is still there.
    expect(second.items.map((item) => item.id)).toContain("semantic_scholar:ok-1");

    const stored = cache.onlyPool();
    expect(stored.sourceStatus?.openalex?.retryCount).toBe(0);
    expect(stored.sourceStatus?.openalex?.status).toBe("failed");
  });

  it("a window rollover allows exactly one new attempt — the claim does not permanently block after its first use", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: still down");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const cache = new MemoryPoolCache();
    const counterStore = new InMemoryCounterStore();
    const scope = scopeFor("owner-degraded-9");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 0), counterStore });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 9, 31), counterStore });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);

    // 31 minutes after the FIRST retry — a new 30-minute window — must be
    // allowed to try again, not blocked forever by the first window's claim.
    await runFeedPipeline(req, { cache, now: new Date(2026, 6, 29, 10, 2), counterStore });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(3);
  });

  it("caps at 3 retries per local day even across concurrent cross-instance bursts at each window", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: still down");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => [
      paperFrom("semantic_scholar", "ok-1", "A Paper That Came Through"),
    ]);
    const backing = new Map<string, CachedPool>();
    const instanceA = new SharedPoolCache(backing);
    const instanceB = new SharedPoolCache(backing);
    const counterStore = new InMemoryCounterStore();
    const scope = scopeFor("owner-degraded-10");
    const req = {
      topics: ["solid-state battery"],
      sources: ["openalex" as const, "semantic_scholar" as const],
      aiTier: 0 as const,
      paperCacheScope: scope,
    };

    await runFeedPipeline(req, {
      cache: instanceA,
      now: new Date(2026, 6, 29, 9, 0),
      counterStore,
    });
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    // Three eligible windows, each hit by a 2-way concurrent burst split
    // across the two "instances" — every window contributes at most one
    // real fetch (proven by the previous case), and the running day total
    // must still stop at 3 even though each window's own race is resolved
    // independently.
    const windows = [
      new Date(2026, 6, 29, 9, 31),
      new Date(2026, 6, 29, 10, 2),
      new Date(2026, 6, 29, 10, 33),
    ];
    for (const now of windows) {
      await Promise.all([
        runFeedPipeline(req, { cache: instanceA, now, counterStore }),
        runFeedPipeline(req, { cache: instanceB, now, counterStore }),
      ]);
    }
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(4); // build + 3

    // A 4th window, same cross-instance burst shape — the day cap must
    // block BOTH claimants, not just coalesce them into one more fetch.
    const fourthWindow = new Date(2026, 6, 29, 11, 4);
    const fourth = await Promise.all([
      runFeedPipeline(req, { cache: instanceA, now: fourthWindow, counterStore }),
      runFeedPipeline(req, { cache: instanceB, now: fourthWindow, counterStore }),
    ]);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(4);
    for (const result of fourth) {
      expect(result.meta.errors.openalex).toBeDefined();
    }
    expect(onlyPoolFrom(backing).sourceStatus?.openalex?.retryCount).toBe(3);
  });
});
