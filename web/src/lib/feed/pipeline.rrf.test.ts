import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bySourceId } from "@/lib/sources";
import type { RawItem, SourceId } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import type { ShadowCandidate } from "@/lib/decisions/shadow";

// P2-S6 (Round 3) — F-A-P2-05, ABC-JEV-INTEGRATION.md §1p.B(1) and the
// P2-S6 RULING (§4). Flag PEER_RANK_FUSION, default off. Structural model:
// pipeline.shadow.test.ts (P3-S5's own sibling `pipeline.*.test.ts` file) —
// same MemoryPoolCache/fixture/fake-timer conventions, so the two files
// read the same way.
//
// `fuseRankings` is spied on (wrapping its REAL implementation, never
// replaced) so every test still gets correct RRF math, while the
// "flag off" tests can additionally assert it was never invoked at all —
// proving "no RRF computation" rather than merely "the result is ignored."
const mocks = vi.hoisted(() => ({
  fuseRankings: vi.fn(),
  fetchOpenAlexSemantic: vi.fn(),
}));
vi.mock("@/lib/scoring/rrf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scoring/rrf")>();
  mocks.fuseRankings.mockImplementation(actual.fuseRankings);
  return { ...actual, fuseRankings: mocks.fuseRankings };
});
vi.mock("@/lib/sources/openalex-semantic", () => ({
  fetchOpenAlexSemantic: mocks.fetchOpenAlexSemantic,
}));

// Imported AFTER the mocks above, per vitest convention (see
// pipeline.shadow.test.ts and test-digest/route.test.ts for the same order).
const { runFeedPipeline } = await import("./pipeline");

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
// P2-S6-FIX (Round 3) — F-A-P2S6-01's own reproduction needs two more real
// source channels (dblp has no id-tier in canonical-identity.ts, so a
// DOI-less dblp item can only ever be recognized as the same work as an
// arXiv copy via the title+year+first-author weak-link tier — see
// bridgePairItems below). Saved/restored the same way originalOpenalexFetch
// already is.
const originalDblpFetch = bySourceId.dblp.fetch;
const originalArxivFetch = bySourceId.arxiv.fetch;

// Titles/tags carry the request topic so the pre-existing literal-keyword
// admission gate (an unrelated concern) never drops these fixtures — same
// discipline pipeline.shadow.test.ts already established.
function openalexItem(i: number): RawItem {
  return {
    id: `openalex:p${i}`,
    source: "openalex",
    title: `Solid-State Battery Electrolyte Study ${i}`,
    authors: [`Researcher ${i}`],
    abstract: "An abstract about solid-state battery electrolyte interfaces.",
    url: `https://example.org/p${i}`,
    publishedAt: "2026-07-20",
    venue: "Journal of Testing",
    tags: ["solid-state battery"],
    metadata: {},
  };
}

// Zero literal overlap with "solid-state battery" — title/abstract/tags
// share no vocabulary with the request topic at all, so it can ONLY survive
// combine.ts's literal-topic admission gate via a non-literal
// (admissionChannels: ["semantic"]) tag, and can only ever reach a high
// rank through a real channel vote — never through keyword/tfidf score,
// which stays near zero for it.
function semanticOnlyItem(): RawItem {
  return {
    id: "openalex:semantic-only-1",
    source: "openalex",
    title: "Completely Unrelated Notes On Zebra Migration Patterns",
    authors: ["Zoologist Z"],
    abstract: "An abstract sharing no vocabulary with battery electrolyte research at all.",
    url: "https://example.org/semantic-only-1",
    publishedAt: "2026-07-20",
    venue: "Journal of Zoology",
    tags: ["zebra migration"],
    metadata: {},
  };
}

function fixtureItems(count: number): RawItem[] {
  return Array.from({ length: count }, (_, i) => openalexItem(i));
}

// P2-S6-FIX (Round 3) — F-A-P2S6-01, docs/jev-abc/P2-S6-A-20260924T145415Z.md
// NEW FINDING #1 / EVIDENCE #6. A dblp-sourced copy and an arXiv-sourced
// copy of the SAME paper: the dblp copy carries no DOI/externalIds, and
// canonical-identity.ts has no id-tier for source "dblp" at all, so its own
// identity is keyed `title:<normalized title>` alone (no real id-form key);
// the arXiv copy is keyed `arxiv:<id>` with a `title:` alias. The two share
// NO id-form key, so they can only ever be recognized as one work via the
// title+year+first-author weak-link tier `clusterCanonicalWorks` provides.
// Author name format deliberately differs ("Jane Doe" vs "Doe, Jane") to
// prove the fix mirrors dedup.ts's actual surname EXTRACTION (handles both
// "First Last" and "Last, First"), not a raw first-author-string
// pass-through — which would fail to match these two strings against each
// other and defeat the point of the test.
function bridgePairItems(): { dblp: RawItem; arxiv: RawItem } {
  const title = "Solid-State Battery Interfacial Degradation Under Cycling";
  const shared = {
    title,
    abstract: "An abstract about solid-state battery electrolyte interfaces.",
    publishedAt: "2026-07-20",
    venue: "Journal of Testing",
    tags: ["solid-state battery"],
  };
  return {
    dblp: {
      ...shared,
      id: "dblp:bridge1",
      source: "dblp",
      authors: ["Jane Doe"],
      url: "https://example.org/dblp-bridge1",
      metadata: {},
    },
    arxiv: {
      ...shared,
      id: "arxiv:bridge1",
      source: "arxiv",
      authors: ["Doe, Jane"],
      url: "https://example.org/arxiv-bridge1",
      metadata: {},
    },
  };
}

// A REAL conflict, same shape as the bridge pair above but with two
// DIFFERENT DOIs: same title/year/author-surname, but a confirmed,
// disagreeing external identity on each side. `clusterCanonicalWorks`
// (paper-identity.ts, untouched by this slice) must keep these separate
// even after F-A-P2S6-01's fix populates year/authors — a same-type
// id-form conflict (doi vs doi) always blocks a weak-link collapse,
// regardless of title/year/author agreement. This is a safety-net proving
// the fix doesn't overreach into merging genuinely different papers, not a
// RED/GREEN pair by itself (dedupe already kept these separate before this
// fix too, for an unrelated reason — RRF's own weak-link tier simply never
// fired at all without year/authors).
function conflictPairItems(): { dblp: RawItem; arxiv: RawItem } {
  const title = "Grain Boundary Impedance In Garnet Solid Electrolytes";
  const shared = {
    title,
    abstract: "An abstract about solid-state battery electrolyte interfaces.",
    publishedAt: "2026-07-20",
    venue: "Journal of Testing",
    tags: ["solid-state battery"],
  };
  return {
    dblp: {
      ...shared,
      id: "dblp:conflict1",
      source: "dblp",
      authors: ["John Smith"],
      url: "https://example.org/dblp-conflict1",
      metadata: { doi: "10.1234/conflict-dblp" },
    },
    arxiv: {
      ...shared,
      id: "arxiv:conflict1",
      source: "arxiv",
      authors: ["Smith, John"],
      url: "https://example.org/arxiv-conflict1",
      metadata: { doi: "10.1234/conflict-arxiv" },
    },
  };
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
    sources: ["openalex" as const satisfies SourceId],
    aiTier: 0 as const,
    paperCacheScope: scopeFor(ownerId),
  };
}

// P2-S6-FIX — same shape as baseReq, but the two real, id-tier-asymmetric
// sources bridgePairItems/conflictPairItems need.
function dblpArxivReq(ownerId: string) {
  return {
    topics: ["solid-state battery"],
    sources: ["dblp", "arxiv"] as SourceId[],
    aiTier: 0 as const,
    paperCacheScope: scopeFor(ownerId),
  };
}

// Frozen so `meta.latencyMs` reads deterministically — same reasoning
// pipeline.shadow.test.ts records for its own identical constant.
const FIXED_NOW = new Date(2026, 6, 29, 9, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetCounterStoreForTests();
  bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));
  mocks.fetchOpenAlexSemantic.mockReset().mockResolvedValue([]);
  mocks.fuseRankings.mockClear();
});

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  bySourceId.dblp.fetch = originalDblpFetch;
  bySourceId.arxiv.fetch = originalArxivFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pipeline.ts — P2-S6 reciprocal rank fusion (PEER_RANK_FUSION)", () => {
  describe("flag off (default)", () => {
    it("byte-identical to the pre-RRF baseline: no meta.rrf, item order unchanged, fuseRankings never called", async () => {
      const result = await runFeedPipeline(baseReq("owner-off"), {
        cache: new MemoryPoolCache(),
        now: FIXED_NOW,
      });

      expect(result.items.map((i) => i.id)).toEqual(fixtureItems(5).map((i) => i.id));
      expect(result.meta).not.toHaveProperty("rrf");
      expect(mocks.fuseRankings).not.toHaveBeenCalled();
    });

    it.each(["true", "1", "onn", "yes", "Off"])(
      "PEER_RANK_FUSION=%s keeps the flag off (only the literal \"on\" enables it)",
      async (value) => {
        vi.stubEnv("PEER_RANK_FUSION", value);
        const result = await runFeedPipeline(baseReq(`owner-typo-${value}`), {
          cache: new MemoryPoolCache(),
          now: FIXED_NOW,
        });
        expect(result.meta).not.toHaveProperty("rrf");
        expect(mocks.fuseRankings).not.toHaveBeenCalled();
      },
    );
  });

  describe("flag on — judgment shortlist and provenance", () => {
    // 55 well-matching openalex candidates (one channel) + 1 zero-literal-
    // overlap candidate admitted only via the "semantic" channel. Under
    // plain Tier-1 (score) order the semantic-only item is the WEAKEST of
    // all 56 (near-zero keyword+tfidf); under RRF it is the sole occupant
    // of its channel, so its one vote (rank 1, fused 1/61) ties the
    // openalex channel's own rank-1 item and beats every openalex item
    // ranked 2nd or worse (whose fused scores are all < 1/61).
    async function runShortlistScenario(rankFusion: boolean) {
      if (rankFusion) vi.stubEnv("PEER_RANK_FUSION", "on");
      vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
      bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(55));
      mocks.fetchOpenAlexSemantic.mockResolvedValue([semanticOnlyItem()]);

      const received: ReadonlyArray<ShadowCandidate>[] = [];
      const result = await runFeedPipeline(
        { ...baseReq(`owner-shortlist-${rankFusion}`), topN: 250 }, // large enough that `result.items` reflects the whole processed pool
        {
          cache: new MemoryPoolCache(),
          now: FIXED_NOW,
          onFreshShortlist: (shortlist) => received.push(shortlist),
        },
      );
      return { result, shortlist: received[0] ?? [] };
    }

    it("flag off: the shortlist is Tier-1 (score) order — the semantic-only candidate is excluded", async () => {
      const { shortlist } = await runShortlistScenario(false);
      expect(shortlist).toHaveLength(50);
      expect(shortlist.some((c) => c.id === "openalex:semantic-only-1")).toBe(false);
    });

    it("flag on: the shortlist is the RRF top 50 — the semantic-only candidate reaches it", async () => {
      const { shortlist } = await runShortlistScenario(true);
      expect(mocks.fuseRankings).toHaveBeenCalledTimes(1);
      expect(shortlist).toHaveLength(50);

      // The semantic-only item and openalex's own rank-1 item tie for the
      // best fused score (both exactly 1/61) — together they occupy the
      // first two shortlist slots, in either order.
      expect(new Set(shortlist.slice(0, 2).map((c) => c.id))).toEqual(
        new Set(["openalex:p0", "openalex:semantic-only-1"]),
      );
      expect(shortlist.some((c) => c.id === "openalex:semantic-only-1")).toBe(true);

      // The RRF top 50 excludes openalex's own weakest-ranked candidates
      // (channel rank 51-55) to make room — unlike Tier-1 order, which
      // would have excluded the semantic-only item instead (previous test).
      expect(shortlist.some((c) => c.id === "openalex:p54")).toBe(false);
    });

    it("provenance: fused score + contributing channel/rank are present on the response", async () => {
      const { result } = await runShortlistScenario(true);
      expect(result.meta.rrf).toBeDefined();
      const semanticProvenance = result.meta.rrf!["openalex:semantic-only-1"];
      expect(semanticProvenance).toEqual({
        fusedScore: 1 / 61,
        channels: [{ channel: "semantic", rank: 1 }],
      });
      const openalexTopProvenance = result.meta.rrf!["openalex:p0"];
      expect(openalexTopProvenance).toEqual({
        fusedScore: 1 / 61,
        channels: [{ channel: "openalex", rank: 1 }],
      });
    });

    it("flag off: no provenance on the response at all", async () => {
      const { result } = await runShortlistScenario(false);
      expect(result.meta).not.toHaveProperty("rrf");
    });
  });

  describe("flag on — pool membership at MAX_PAPER_POOL_ITEMS (200)", () => {
    // 203 well-matching openalex candidates + 1 zero-literal-overlap
    // semantic-only candidate = 204 total, forcing the build-time 200-item
    // ceiling to drop exactly 4. Under plain score order the semantic-only
    // item is the weakest of the 204 and is one of the 4 dropped. Under RRF
    // its lone channel vote (fused 1/61) ranks it well inside the top 200
    // (it beats every openalex item ranked 61st-or-worse in ITS channel),
    // so it survives the same ceiling instead.
    async function runMembershipScenario(rankFusion: boolean) {
      if (rankFusion) vi.stubEnv("PEER_RANK_FUSION", "on");
      vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
      bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(203));
      mocks.fetchOpenAlexSemantic.mockResolvedValue([semanticOnlyItem()]);

      return runFeedPipeline(
        { ...baseReq(`owner-membership-${rankFusion}`), topN: 250 }, // above the 200 pool ceiling, so `result.items` reflects full pool membership
        { cache: new MemoryPoolCache(), now: FIXED_NOW },
      );
    }

    it("flag off: pool membership follows plain score order — the semantic-only candidate is cut", async () => {
      const result = await runMembershipScenario(false);
      expect(result.items).toHaveLength(200);
      expect(result.items.some((i) => i.id === "openalex:semantic-only-1")).toBe(false);
    });

    it("flag on: pool membership follows RRF order — the semantic-only candidate survives the cut", async () => {
      const result = await runMembershipScenario(true);
      expect(result.items).toHaveLength(200);
      expect(result.items.some((i) => i.id === "openalex:semantic-only-1")).toBe(true);
    });
  });

  describe("flag on — cache hit never recomputes RRF", () => {
    it("fuseRankings runs once on the fresh build and not again on a same-day cache hit", async () => {
      vi.stubEnv("PEER_RANK_FUSION", "on");
      const cache = new MemoryPoolCache();
      bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));

      await runFeedPipeline(baseReq("owner-cache"), { cache, now: FIXED_NOW });
      expect(mocks.fuseRankings).toHaveBeenCalledTimes(1);
      expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

      await runFeedPipeline(baseReq("owner-cache"), { cache, now: FIXED_NOW });
      expect(mocks.fuseRankings).toHaveBeenCalledTimes(1); // unchanged — cache hit, no fresh build
      expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // P2-S6-FIX (Round 3) — F-A-P2S6-01, docs/jev-abc/P2-S6-A-20260924T145415Z.md
  // NEW FINDING #1 / EVIDENCE #6. Before this fix, `toRRFCandidate` never
  // forwarded `year`/`authors`, so RRF's own weak-link tier could never
  // fire — a dblp+arXiv pair dedupe correctly merges into ONE survivor
  // still fused as TWO separate RRF work-groups, and `applyRRFOrder`
  // silently credited only whichever one it matched first, dropping the
  // other channel's vote entirely (channel-balance gap, acceptance 7).
  describe("flag on — weak-link channel-balance matches dedupe (P2-S6-FIX, F-A-P2S6-01)", () => {
    it("a dblp + arXiv copy of the same paper, bridged only by title+year+author (no shared id-form key), fuses into ONE RRF group crediting BOTH channels", async () => {
      vi.stubEnv("PEER_RANK_FUSION", "on");
      const { dblp, arxiv } = bridgePairItems();
      bySourceId.dblp.fetch = vi.fn(async () => [dblp]);
      bySourceId.arxiv.fetch = vi.fn(async () => [arxiv]);

      const result = await runFeedPipeline(dblpArxivReq("owner-bridge"), {
        cache: new MemoryPoolCache(),
        now: FIXED_NOW,
      });

      // Dedupe already merges this pair into one survivor (arxiv beats
      // dblp on SOURCE_PRIORITY) — true both before and after this fix,
      // since dedup.ts has always forwarded year/authors correctly. This
      // assertion isolates the bug to RRF's own wiring, not dedupe.
      expect(result.items.map((i) => i.id)).toEqual(["arxiv:bridge1"]);

      expect(result.meta.rrf).toBeDefined();
      const provenance = result.meta.rrf!["arxiv:bridge1"];
      expect(provenance).toBeDefined();
      // THE fix: both channels contribute. Before the fix, only one
      // (whichever sorts first) is credited and the other's vote is
      // silently dropped — see EVIDENCE #6 in the A checkpoint cited above
      // (channels: [{channel:"arxiv",rank:1}] only, fusedScore exactly
      // 1/61 — one channel's worth, not two).
      expect(provenance.channels).toEqual([
        { channel: "arxiv", rank: 1 },
        { channel: "dblp", rank: 1 },
      ]);
      expect(provenance.fusedScore).toBeCloseTo(2 / 61, 10);
    });

    it("a same-title/year/author pair with two DIFFERENT DOIs is a real conflict and stays two separate items/provenance entries (safety net — not overridden by this fix)", async () => {
      vi.stubEnv("PEER_RANK_FUSION", "on");
      const { dblp, arxiv } = conflictPairItems();
      bySourceId.dblp.fetch = vi.fn(async () => [dblp]);
      bySourceId.arxiv.fetch = vi.fn(async () => [arxiv]);

      const result = await runFeedPipeline(dblpArxivReq("owner-conflict"), {
        cache: new MemoryPoolCache(),
        now: FIXED_NOW,
      });

      expect(new Set(result.items.map((i) => i.id))).toEqual(
        new Set(["arxiv:conflict1", "dblp:conflict1"]),
      );
      expect(result.meta.rrf).toBeDefined();
      expect(result.meta.rrf!["arxiv:conflict1"]).toEqual({
        fusedScore: 1 / 61,
        channels: [{ channel: "arxiv", rank: 1 }],
      });
      expect(result.meta.rrf!["dblp:conflict1"]).toEqual({
        fusedScore: 1 / 61,
        channels: [{ channel: "dblp", rank: 1 }],
      });
    });
  });

  // P2-S6-FIX (Round 3) — F-A-P2S6-02, docs/jev-abc/P2-S6-A-20260924T145415Z.md
  // NEW FINDING #2 / EVIDENCE #7. Before this fix, `meta.rrf` existed only
  // on the exact request that triggered a fresh build; the persisted
  // `CachedPaperPool` had no `rrf` field to carry it, so a same-day
  // cache-hit read had no path to it at all (structurally absent, not
  // merely undefined-valued).
  describe("flag on — cached provenance survives a cache hit (P2-S6-FIX, F-A-P2S6-02)", () => {
    it("a fresh build's meta.rrf and a same-day cache-hit's meta.rrf are identical, and fuseRankings still runs only once", async () => {
      vi.stubEnv("PEER_RANK_FUSION", "on");
      const cache = new MemoryPoolCache();
      bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));

      const first = await runFeedPipeline(baseReq("owner-cache-provenance"), {
        cache,
        now: FIXED_NOW,
      });
      expect(first.meta.rrf).toBeDefined();
      expect(Object.keys(first.meta.rrf!).length).toBeGreaterThan(0);

      const second = await runFeedPipeline(baseReq("owner-cache-provenance"), {
        cache,
        now: FIXED_NOW,
      });
      // RED today: second.meta.rrf is undefined (the key is missing
      // entirely). GREEN after the fix: identical provenance on both reads.
      expect(second.meta.rrf).toBeDefined();
      expect(second.meta.rrf).toEqual(first.meta.rrf);
      // Provenance now survives the round trip through the cache, but RRF
      // itself is still computed exactly once — the fix threads EXISTING
      // build-time output through, it never recomputes on a hit.
      expect(mocks.fuseRankings).toHaveBeenCalledTimes(1);
      expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    });

    it("flag off: the persisted pool carries no rrf field at all, on the build or a later cache hit (byte-identical — nothing written, nothing changes)", async () => {
      const cache = new MemoryPoolCache();
      bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));

      const first = await runFeedPipeline(baseReq("owner-cache-rrf-off"), {
        cache,
        now: FIXED_NOW,
      });
      expect(first.meta).not.toHaveProperty("rrf");
      const stored = Array.from(cache.values.values())[0];
      expect(stored).not.toHaveProperty("rrf");

      const second = await runFeedPipeline(baseReq("owner-cache-rrf-off"), {
        cache,
        now: FIXED_NOW,
      });
      expect(second.meta).not.toHaveProperty("rrf");
    });
  });
});
