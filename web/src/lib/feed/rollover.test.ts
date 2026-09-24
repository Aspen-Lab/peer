import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { identityForRawItem } from "./paper-identity";
import type { NormalizedFeedIntent } from "./intent";

// P4-S6 (Round 3) -- F-A-P4-08, ABC-JEV-INTEGRATION.md §1g/§1p.C.4/DESIGN §6
// of docs/jev-abc/P4-B-20260924T0338Z.md. Pipeline-level proof for the two
// rollover contracts pipeline.ts now implements:
//
//   1. `finalPool` (the curated, up-to-30 ranked-and-excluded candidate list
//      rollover storage operates on) is exposed on runFeedPipeline's return
//      value ONLY when a caller explicitly opts in via
//      `FeedPipelineOptions.includeFinalPool` -- every other caller's output
//      is byte-identical to before this option existed, and critically the
//      field is structurally ABSENT (not merely undefined-valued) so it can
//      never leak through web/src/app/api/feed/route.ts's flag-off/
//      no-owner-scope pass-through path (see that file's own tests for the
//      HTTP-JSON-level half of this same guarantee).
//
//   2. `FeedPipelineOptions.rolloverCandidates` -- candidates carried forward
//      from a prior day's final pool -- are merged into the SAME candidate
//      set live-fetched items go through, at the SAME point (before
//      dropStale/scoring/reranking), so every subsequent read-time step
//      (date window, current-intent scoring, explicit exclusions, ledger/
//      excludeIds exclusion, topN slice) treats a rollover candidate
//      identically to one fetched fresh this second: same eligibility, no
//      special boost or penalty (ABC-JEV-INTEGRATION.md §1g/§3e).
//
// This file follows web/src/lib/feed/paper-daily-cache.test.ts's own
// established pattern exactly: bySourceId.openalex.fetch is monkey-patched
// per test (restored in afterEach) so "live" candidates are fully
// controlled and no network call ever happens; a local MemoryPoolCache
// double plus a real createTrustedPaperCacheScope gives runFeedPipeline a
// deterministic, single-build cache path (options.cache is silently IGNORED
// by pipeline.ts unless paperCacheScope is also present -- confirmed by
// reading pipeline.ts's own cache-selection line before writing this file).

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();
  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const originalOpenAlexFetch = bySourceId.openalex.fetch;
afterEach(() => {
  bySourceId.openalex.fetch = originalOpenAlexFetch;
});

function stubLiveOpenAlex(items: RawItem[]) {
  bySourceId.openalex.fetch = vi.fn(async () => items);
}

/** A minimal, battery-topic-matching RawItem with a unique DOI (so it never accidentally dedupe-merges with another fixture). */
function paper(n: number, opts: Partial<RawItem> = {}): RawItem {
  return {
    id: `openalex:paper-${n}`,
    source: "openalex",
    title: `Solid-State Battery Study Number ${n}`,
    authors: ["A. Researcher"],
    abstract: "Solid-state battery electrolyte design improves electrochemical stability.",
    url: `https://openalex.org/W${n}`,
    publishedAt: "2026-09-01",
    venue: "Journal of Battery Research",
    tags: ["solid-state battery"],
    metadata: { doi: `10.1000/rollover-fixture-${n}` },
    ...opts,
  };
}

function manyPapers(count: number, offset = 0): RawItem[] {
  return Array.from({ length: count }, (_, i) => paper(offset + i + 1));
}

function freshScope(topics: string[] = ["battery"], ownerId = "owner-rollover-test") {
  return createTrustedPaperCacheScope({ ownerId, topics, aiTier: 0 });
}

const baseRequest = {
  topics: ["battery"],
  sources: ["openalex" as const],
  aiTier: 0 as const,
};

const exclusionIntent = (term: string): NormalizedFeedIntent => ({
  version: "feed-intent-v1",
  project: { presence: "omitted" },
  challenge: { presence: "omitted" },
  requiredConcepts: [],
  preferredConcepts: [],
  exclusions: [{ kind: "exclude-term", value: term }],
  methods: [],
  selectedSenseConcepts: [],
});

describe("finalPool -- opt-in exposure (P4-S6)", () => {
  it("is absent from the result when includeFinalPool is not requested", async () => {
    stubLiveOpenAlex(manyPapers(35));
    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0) },
    );
    expect(result).not.toHaveProperty("finalPool");
  });

  it("is capped at 30 and is a strict superset (same order) of the presented topN, when requested", async () => {
    stubLiveOpenAlex(manyPapers(35));
    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0), includeFinalPool: true },
    );
    expect(result.items).toHaveLength(10);
    expect(result.finalPool).toHaveLength(30);
    expect(result.finalPool!.slice(0, 10).map((i) => i.id)).toEqual(result.items.map((i) => i.id));
  });

  it("shrinks with scarcity instead of padding, even when requested", async () => {
    stubLiveOpenAlex(manyPapers(3));
    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0), includeFinalPool: true },
    );
    expect(result.items).toHaveLength(3);
    expect(result.finalPool).toHaveLength(3);
  });
});

describe("rolloverCandidates -- merge + eligibility (P4-S6)", () => {
  it("merges rollover candidates into the ranked set so they can be presented alongside live ones", async () => {
    stubLiveOpenAlex(manyPapers(3)); // paper-1..3
    const rolloverCandidates = manyPapers(7, 100); // paper-101..107, distinct DOIs

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0), rolloverCandidates },
    );

    expect(result.items).toHaveLength(10);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain("openalex:paper-101");
    expect(ids).toContain("openalex:paper-1");
  });

  it("deduplicates a rollover candidate against an existing pool item by canonical identity (no duplicate entry)", async () => {
    const shared = paper(1);
    stubLiveOpenAlex([shared]);
    const rolloverDuplicate: RawItem = {
      ...shared,
      id: "openalex:paper-1-rollover-copy", // different raw id
      title: shared.title.toUpperCase(), // different casing
    };

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      {
        cache: new MemoryPoolCache(),
        now: new Date(2026, 8, 24, 9, 0),
        rolloverCandidates: [rolloverDuplicate],
      },
    );

    const sameDoiItems = result.items.filter(
      (i) => identityForRawItem(i).key === identityForRawItem(shared).key,
    );
    expect(sameDoiItems).toHaveLength(1);
  });

  it("excludes a rollover candidate already covered by ledgerExclusions, exactly like a live candidate would be", async () => {
    stubLiveOpenAlex(manyPapers(2)); // paper-1, paper-2
    const rolloverCandidate = paper(200);
    const excludedKey = identityForRawItem(rolloverCandidate).key;

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      {
        cache: new MemoryPoolCache(),
        now: new Date(2026, 8, 24, 9, 0),
        rolloverCandidates: [rolloverCandidate],
        ledgerExclusions: new Set([excludedKey]),
        includeFinalPool: true,
      },
    );

    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain("openalex:paper-200");
    expect(result.finalPool!.map((i) => i.id)).not.toContain("openalex:paper-200");
    expect(ids).toEqual(expect.arrayContaining(["openalex:paper-1", "openalex:paper-2"]));
  });

  it("drops a rollover candidate that has fallen outside the date window, same as dropStale already does for live candidates", async () => {
    stubLiveOpenAlex(manyPapers(2));
    const staleRolloverCandidate = paper(300, { publishedAt: "2010-01-01" }); // far outside any window

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      {
        cache: new MemoryPoolCache(),
        now: new Date(2026, 8, 24, 9, 0),
        rolloverCandidates: [staleRolloverCandidate],
      },
    );

    expect(result.items.map((i) => i.id)).not.toContain("openalex:paper-300");
  });

  it("drops a rollover candidate matching an explicit user exclusion, same as a live candidate would be", async () => {
    stubLiveOpenAlex(manyPapers(2));
    const excludedRolloverCandidate = paper(400, { title: "Solid-State Battery Review" });

    const result = await runFeedPipeline(
      {
        ...baseRequest,
        topN: 10,
        paperCacheScope: freshScope(),
        intent: exclusionIntent("review"),
      },
      {
        cache: new MemoryPoolCache(),
        now: new Date(2026, 8, 24, 9, 0),
        rolloverCandidates: [excludedRolloverCandidate],
      },
    );

    expect(result.items.map((i) => i.id)).not.toContain("openalex:paper-400");
  });

  it("gives a rollover candidate no special boost or penalty -- its score is byte-identical to what the SAME content would get if fetched live", async () => {
    const itemA = paper(1);
    const itemB = paper(2, {
      title: "Solid-State Battery Electrolyte Interfacial Stability",
      abstract: "battery battery solid-state electrolyte interfacial stability",
    });

    // Run 1: both items arrive as ordinary live-fetched candidates.
    stubLiveOpenAlex([itemA, itemB]);
    const bothLive = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0) },
    );
    const bScoreAsLive = bothLive.items.find((i) => i.id === "openalex:paper-2")?.score;
    expect(bScoreAsLive).toEqual(expect.any(Number));

    // Run 2: identical content, but item B now arrives ONLY as a rollover
    // candidate (item A is still the sole live-fetched item). If rollover
    // candidates got any special boost or penalty, B's score here would
    // differ from run 1's -- same candidate SET either way (A and B are the
    // only two candidates the scorer ever sees in both runs), so
    // pool-relative scoring (topicality) has nothing else to react to.
    stubLiveOpenAlex([itemA]);
    const bAsRollover = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      {
        cache: new MemoryPoolCache(),
        now: new Date(2026, 8, 24, 9, 0),
        rolloverCandidates: [itemB],
      },
    );
    const bScoreAsRollover = bAsRollover.items.find((i) => i.id === "openalex:paper-2")?.score;

    // toBeCloseTo, not toBe: the two runs' floating-point summation order
    // can differ in the last couple of decimal places (a real, harmless
    // artifact of JS float arithmetic, not a special boost/penalty) --
    // 9 digits of precision is far tighter than any deliberate boost/
    // penalty in this codebase (e.g. the +1/3 journal boost) could hide
    // inside.
    expect(bScoreAsRollover).toBeCloseTo(bScoreAsLive!, 9);
  });

  it("never pads: live + rollover candidates fewer than topN still returns only what's genuinely eligible", async () => {
    stubLiveOpenAlex(manyPapers(2));
    const rolloverCandidates = manyPapers(1, 600);

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10, paperCacheScope: freshScope() },
      { cache: new MemoryPoolCache(), now: new Date(2026, 8, 24, 9, 0), rolloverCandidates },
    );

    expect(result.items).toHaveLength(3);
  });
});
