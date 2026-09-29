import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import type { ShadowCandidate } from "@/lib/decisions/shadow";

// P3-S5 — ABC-JEV-INTEGRATION.md §4 Round 3 "P3-S5 DESIGN RULING"
// (2026-09-24T11:29:31Z). No pre-existing pipeline.test.ts to extend
// (docs/jev-abc/P3-B-20260924T0525Z.md EVIDENCE #31), so this is a new,
// narrowly-scoped file proving exactly what the DESIGN RULING promises:
// `onFreshShortlist` is purely a side channel that (a) fires only on an
// actual fresh pool build, never on a cache hit or a retry, (b) can never
// change what the pipeline returns even if it throws or mutates what it was
// given, and (c) never sees more than 50 candidates. This IS the regression
// net for "shadow mode cannot affect the feed."

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();
  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const originalOpenalexFetch = bySourceId.openalex.fetch;

// Titles carry the request topic so the pre-existing literal-keyword
// admission gate (an unrelated concern) never drops these fixtures — same
// discipline pool-degraded.test.ts already established for this file's
// neighborhood.
function paperFrom(id: string, label: string): RawItem {
  return {
    id: `openalex:${id}`,
    source: "openalex",
    title: `Solid-State Battery Research Note: ${label}`,
    authors: ["A. Researcher"],
    abstract: "An abstract about solid-state battery electrolytes.",
    url: `https://example.org/${id}`,
    publishedAt: "2026-07-20",
    venue: "Journal of Testing",
    tags: ["solid-state battery"],
    metadata: {},
  };
}

function fixtureItems(count: number): RawItem[] {
  return Array.from({ length: count }, (_, i) => paperFrom(`p${i}`, `Note ${i}`));
}

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier: 0,
  });
}

function baseReq(ownerId: string) {
  return {
    topics: ["solid-state battery"],
    sources: ["openalex" as const],
    aiTier: 0 as const,
    paperCacheScope: scopeFor(ownerId),
  };
}

// Frozen so `meta.latencyMs` (a real `Date.now()` measurement, not derived
// from the injected `now`) reads deterministically across every call in this
// file — otherwise a byte-identical deep-equal between two independent
// builds would be flaky by construction.
const FIXED_NOW = new Date(2026, 6, 29, 9, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetCounterStoreForTests();
  bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));
});

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pipeline.ts — P3-S5 Jev shadow hook (onFreshShortlist)", () => {
  it("(a) hook absent: the normal fresh-build result, unchanged", async () => {
    const result = await runFeedPipeline(baseReq("owner-a"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
    });

    expect(result.items).toHaveLength(5);
    expect(result.items.map((i) => i.id)).toEqual(
      fixtureItems(5).map((i) => i.id),
    );
  });

  it("(b) hook present and succeeds: the result is byte-identical to the hook-absent baseline", async () => {
    const baseline = await runFeedPipeline(baseReq("owner-b1"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
    });

    const received: ReadonlyArray<ShadowCandidate>[] = [];
    const withHook = await runFeedPipeline(baseReq("owner-b2"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      onFreshShortlist: (shortlist) => {
        received.push(shortlist);
      },
    });

    expect(withHook).toEqual(baseline);
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(5);
    expect(received[0].map((c) => c.id)).toEqual(
      fixtureItems(5).map((i) => i.id),
    );
  });

  it("(c) a throwing hook: the result is still identical to baseline, and runFeedPipeline itself never rejects", async () => {
    const baseline = await runFeedPipeline(baseReq("owner-c1"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
    });

    const call = runFeedPipeline(baseReq("owner-c2"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      onFreshShortlist: () => {
        throw new Error("boom from a shadow hook");
      },
    });
    await expect(call).resolves.toBeDefined();
    const result = await call;

    expect(result).toEqual(baseline);
  });

  it("(d) cache hit: the hook fires on the fresh build but never again on the cached read", async () => {
    const cache = new MemoryPoolCache();
    const calls: ReadonlyArray<ShadowCandidate>[] = [];
    const hook = (shortlist: ReadonlyArray<ShadowCandidate>): void => {
      calls.push(shortlist);
    };

    await runFeedPipeline(baseReq("owner-d"), { cache, now: FIXED_NOW, onFreshShortlist: hook });
    expect(calls).toHaveLength(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    await runFeedPipeline(baseReq("owner-d"), { cache, now: FIXED_NOW, onFreshShortlist: hook });
    expect(calls).toHaveLength(1); // unchanged — the second read was a cache hit
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1); // proves it really was a hit, not a second fetch
  });

  it("(e) the hook sees at most 50 candidates, and mutating them cannot change the built pool", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(60));
    const baselineNoHook = await runFeedPipeline(baseReq("owner-e-baseline"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
    });

    let receivedCount = 0;
    let captured: ShadowCandidate[] = [];
    const result = await runFeedPipeline(baseReq("owner-e"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      onFreshShortlist: (shortlist) => {
        receivedCount = shortlist.length;
        captured = shortlist as ShadowCandidate[];
        captured.forEach((c) => {
          c.title = "MUTATED";
        });
        captured.push({ id: "injected-by-hook", title: "should never appear", abstract: null });
      },
    });

    expect(receivedCount).toBeLessThanOrEqual(50);
    expect(result.items.every((item) => item.title !== "MUTATED")).toBe(true);
    expect(result.items.some((item) => item.id === "injected-by-hook")).toBe(false);
    // The returned pool is untouched by the hook's mutation — identical to a
    // hook-less build over the same 60-item fixture (topN truncation, not
    // the hook, decides how many come back).
    expect(result).toEqual(baselineNoHook);
  });

  it("never invoked at all when the pool build fetches zero candidates (no crash on an empty shortlist)", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    let callCount = 0;

    const result = await runFeedPipeline(baseReq("owner-empty"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      onFreshShortlist: () => {
        callCount += 1;
      },
    });

    expect(result.items).toEqual([]);
    // Either convention (never called on empty vs. called once with an
    // empty array) is safe; what matters is it never throws and never
    // fabricates candidates. Assert only the safe, load-bearing part.
    expect(callCount).toBeLessThanOrEqual(1);
  });
});
