import { afterEach, describe, expect, it, vi } from "vitest";

// P2-S3 (Round 3) — F-A-P2-03, ABC-JEV-INTEGRATION.md §1p.A/G, §3
// (§1c: "No automatic literal required-topic gate for candidates admitted
// by semantic/seed/citation/topic channels"). `scoring/admission.test.ts`
// already proves the BYPASS MECHANISM itself is correct once a caller
// supplies `admissionChannels` — but nothing in production ever supplied
// it: `buildPaperPool` never tagged the one real non-literal channel that
// exists today (citation-neighborhood discovery), so a real,
// already-fetched, already-relevant citation-neighbor paper with zero
// literal keyword overlap was silently dropped by the literal-topic gate in
// `scoring/combine.ts`. This file tags it at the pipeline level, ON THE
// ITEM (not the request), because `buildPaperPool` (build time) and the
// read-time rescore on a cache hit run on two DIFFERENT `req` objects that
// share no state — the tag must travel through dedupe and the cached pool
// itself to survive both, and the scheduled-digest path (a third, later
// request) needs the same guarantee.
const fetchCitationNeighborhoodMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/affiliation/openalex", () => ({
  fetchCitationNeighborhood: fetchCitationNeighborhoodMock,
}));

import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";

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

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  fetchCitationNeighborhoodMock.mockReset();
});

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier: 0,
  });
}

const TOPIC = "solid-state battery";
// Inside every freshness ceiling (default "week" = 60 days) relative to the
// fixed `now` every test below uses (2026-09-20).
const FRESH_DATE = "2026-09-05";
const NOW = new Date(2026, 8, 20, 9, 0); // 2026-09-20 local

// A keyword-source result carrying ZERO literal overlap with `TOPIC` — the
// pre-existing literal gate must still drop this one. Present in every
// scenario so a passing test proves the fix is a narrow bypass, not a
// disabled gate.
const nonMatchingKeywordItem = (id: string): RawItem => ({
  id,
  source: "openalex",
  title: "Unrelated Catalysis Study With No Topic Overlap",
  authors: ["N. Body"],
  url: `https://openalex.org/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

// The citation-neighborhood candidate: zero literal overlap with `TOPIC`,
// admitted only because `fetchCitationNeighborhood` returned it as a
// citation-neighbor of the advisor's seed works.
const citationPaper = (id = "openalex:citation-neighbor-1"): RawItem => ({
  id,
  source: "openalex",
  title: "Adjacent Prior Work In Catalytic Reaction Kinetics",
  authors: ["A. Advisor Neighbor"],
  url: `https://openalex.org/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

const affiliation = { authorId: "advisor-1", seedWorkIds: ["W111"] };

describe("admission channels — item-level tagging (P2-S3)", () => {
  it("(a) a citation-neighbourhood paper with zero literal keyword match survives buildPaperPool, while a genuinely unadmitted candidate is still dropped", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [nonMatchingKeywordItem("openalex:no-match-a")]);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationPaper()]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        paperCacheScope: scopeFor("owner-admission-a"),
      },
      { cache, now: NOW },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("openalex:citation-neighbor-1");
    // The literal gate is a narrow bypass, not a disabled one: a candidate
    // with no channel tag and no literal match still does not survive.
    expect(ids).not.toContain("openalex:no-match-a");
  });

  it("(b) survives a second, SEPARATE runFeedPipeline call served from the cached pool — the read-time rescore, with no affiliation/admissionChannels on the second request", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [nonMatchingKeywordItem("openalex:no-match-b")]);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationPaper("openalex:citation-neighbor-b")]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-admission-b");

    const first = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        paperCacheScope: scope,
      },
      { cache, now: NOW },
    );
    expect(first.items.map((item) => item.id)).toContain("openalex:citation-neighbor-b");

    // Prove the SECOND call is a genuine cache hit — no re-fetch of either
    // channel — before trusting its result.
    vi.mocked(bySourceId.openalex.fetch).mockClear();
    fetchCitationNeighborhoodMock.mockClear();

    const second = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        // Deliberately NO `affiliation` and NO `admissionChannels` here: a
        // request-scoped-only fix would fail this exact case, because this
        // request has nothing telling it the item is a citation-neighbor.
        paperCacheScope: scope,
      },
      { cache, now: NOW },
    );

    expect(bySourceId.openalex.fetch).not.toHaveBeenCalled();
    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
    expect(second.items.map((item) => item.id)).toContain("openalex:citation-neighbor-b");
  });

  it("(c) survives the scheduled-digest entry path — a later runFeedPipeline call shaped like dispatch-digests/route.ts (aiTier forced 0, excludeIds from past deliveries, no affiliation/admissionChannels)", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [nonMatchingKeywordItem("openalex:no-match-c")]);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationPaper("openalex:citation-neighbor-c")]);
    const cache = new MemoryPoolCache();
    const scope = scopeFor("owner-admission-c");

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        paperCacheScope: scope,
      },
      { cache, now: NOW },
    );

    // dispatch-digests/route.ts's own request shape: aiTier always forced 0,
    // excludeIds populated from `briefing_deliveries` history, topN set from
    // the user's configured paper_count, no `affiliation`/`admissionChannels`
    // field at all (the digest never re-derives the channel; it only ever
    // reads today's already-built pool through the same runFeedPipeline).
    const digestResult = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        excludeIds: ["openalex:some-other-already-sent-paper"],
        topN: 10,
        paperCacheScope: scope,
      },
      { cache, now: NOW },
    );

    expect(digestResult.items.map((item) => item.id)).toContain("openalex:citation-neighbor-c");
  });

  it("(d) an explicit exclusion (excludeIds) still removes a citation-admitted item", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const target = citationPaper("openalex:citation-neighbor-d");
    fetchCitationNeighborhoodMock.mockResolvedValue([target]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        excludeIds: [target.id],
        paperCacheScope: scopeFor("owner-admission-d"),
      },
      { cache, now: NOW },
    );

    expect(result.items.map((item) => item.id)).not.toContain(target.id);
  });

  it("(e) a citation-admitted item outside the freshness window is still dropped", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const staleTarget: RawItem = {
      ...citationPaper("openalex:citation-neighbor-e-stale"),
      // ~260 days before NOW (2026-09-20) — well past even the most
      // generous "month" ceiling (180 days), let alone the default "week"
      // ceiling (60 days) these tests otherwise stay inside of.
      publishedAt: "2026-01-01",
    };
    fetchCitationNeighborhoodMock.mockResolvedValue([staleTarget]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        paperCacheScope: scopeFor("owner-admission-e"),
      },
      { cache, now: NOW },
    );

    expect(result.items.map((item) => item.id)).not.toContain(staleTarget.id);
  });

  it("(f) dedupe union: the same paper arriving via a keyword source AND the citation-neighbourhood channel keeps both channels on the survivor", async () => {
    const sharedDoi = "10.5555/union-channel-test";
    const keywordMatch: RawItem = {
      id: "openalex:union-keyword-src",
      source: "openalex",
      title: "Solid-State Battery Materials For Union Channel Test",
      authors: ["Uma Nion"],
      url: "https://openalex.org/union-keyword-src",
      publishedAt: FRESH_DATE,
      metadata: { doi: sharedDoi },
    };
    const citationMatch: RawItem = {
      id: "openalex:union-citation-src",
      source: "openalex",
      title: "Solid-State Battery Materials For Union Channel Test",
      authors: ["Uma Nion"],
      url: "https://openalex.org/union-citation-src",
      publishedAt: FRESH_DATE,
      metadata: { doi: sharedDoi },
    };
    bySourceId.openalex.fetch = vi.fn(async () => [keywordMatch]);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationMatch]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        affiliation,
        paperCacheScope: scopeFor("owner-admission-f"),
      },
      { cache, now: NOW },
    );

    // Same DOI -> one dedupe survivor, not two candidates.
    expect(result.items).toHaveLength(1);
    const survivor = result.items[0];
    expect([...(survivor.admissionChannels ?? [])].sort()).toEqual(["citation", "keyword"]);
  });
});
