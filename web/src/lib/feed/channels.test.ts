import { afterEach, describe, expect, it, vi } from "vitest";

// P2-S4a (Round 3) — F-A-P2-04 (4b/4e), ABC-JEV-INTEGRATION.md §1p.B(3),
// docs/jev-abc/P2-B-20260924T0345Z.md SLICES "P2-S4". Proves the two new
// OpenAlex channels (semantic search, topic/field) at the
// `buildPaperPool`/`runFeedPipeline` level, the same way
// `admission-channels.test.ts` proved the P2-S3 citation-neighborhood wiring:
//
//   - OFF by default: a throw-on-any-call sentinel for BOTH new adapters is
//     never invoked with the flags unset, even though a keyword source runs.
//   - Nothing in a `FeedRequest` body can enable either channel — only the
//     server's own `process.env.PEER_CHANNEL_OPENALEX_SEMANTIC` /
//     `_TOPIC` can (mirrors the `paperCacheScope`/`companySpendCapability`
//     "server-minted only" convention already documented on `FeedRequest`).
//   - ON (semantic): a stubbed adapter's zero-literal-topic-overlap item is
//     tagged "semantic" and reaches the pool via the admission bypass
//     scoring/combine.ts already grants "semantic"/"topic-field" (built in
//     P2-S3, reused unchanged here — see that file's `admittedByNonLiteralChannel`).
//     A channel failure degrades to no candidates from that channel without
//     breaking Tier 0.
//   - ON (topic-field): stays structurally inert even when flagged on,
//     because no upstream code path supplies a real OpenAlex topic id yet
//     (confirmed by reading profile-compiler.ts/senses.ts in full — see this
//     slice's checkpoint). This is a documented, deliberate gap, not a bug
//     this test is hiding.
const fetchOpenAlexSemanticMock = vi.hoisted(() => vi.fn());
const fetchOpenAlexTopicFieldMock = vi.hoisted(() => vi.fn());
// P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
// Two more mocks for the new positive-seed channels below: the S2
// recommendations adapter (net-new module) and `fetchCitationNeighborhood`
// (EXISTING module, already used unmocked by the advisor-seed tests
// elsewhere in this file — none of THOSE tests set `req.affiliation`, so
// they never call it regardless of this mock; `admission-channels.test.ts`
// mocks this same module the same bare way).
const fetchSemanticScholarRecommendationsMock = vi.hoisted(() => vi.fn());
const fetchCitationNeighborhoodMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sources/openalex-semantic", () => ({
  fetchOpenAlexSemantic: fetchOpenAlexSemanticMock,
}));
vi.mock("@/lib/sources/openalex-topic", () => ({
  fetchOpenAlexTopicField: fetchOpenAlexTopicFieldMock,
}));
vi.mock("@/lib/sources/semantic-scholar-recommendations", () => ({
  fetchSemanticScholarRecommendations: fetchSemanticScholarRecommendationsMock,
}));
vi.mock("@/lib/affiliation/openalex", () => ({
  fetchCitationNeighborhood: fetchCitationNeighborhoodMock,
}));

import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { FeedRequest } from "./types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { canonicalPaperKey } from "@/lib/utils/canonical-identity";
import { identityForRawItem } from "@/lib/feed/paper-identity";
import type { ResolvedPositiveSeed } from "@/lib/preferences/positive-seeds";
import {
  MemoryChannelCandidateCache,
  PrivateChannelCandidateCache,
  type CachedChannelCandidates,
} from "@/lib/opportunities/channel-candidate-cache";
import { InMemoryCounterStore } from "@/lib/usage/counters";

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
  fetchOpenAlexSemanticMock.mockReset();
  fetchOpenAlexTopicFieldMock.mockReset();
  fetchSemanticScholarRecommendationsMock.mockReset();
  fetchCitationNeighborhoodMock.mockReset();
  vi.unstubAllEnvs();
});

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier: 0,
  });
}

function sentinel(name: string) {
  return vi.fn(() => {
    throw new Error(`sentinel: ${name} must not be called`);
  });
}

const TOPIC = "solid-state battery";
// Inside every freshness ceiling (default "week") relative to NOW below.
const FRESH_DATE = "2026-09-05";
const NOW = new Date(2026, 8, 20, 9, 0); // 2026-09-20 local

const nonMatchingKeywordItem = (id: string): RawItem => ({
  id,
  source: "openalex",
  title: "Unrelated Catalysis Study With No Topic Overlap",
  authors: ["N. Body"],
  url: `https://openalex.org/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

const semanticPaper = (id = "openalex:semantic-1"): RawItem => ({
  id,
  source: "openalex",
  title: "A Semantic Discovery Paper With No Literal Topic Overlap At All",
  authors: ["S. Emantic"],
  url: `https://openalex.org/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

// P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
const recommendedPaper = (id = "semantic_scholar:rec-1"): RawItem => ({
  id,
  source: "semantic_scholar",
  title: "A Recommended Paper With No Literal Topic Overlap At All",
  authors: ["R. Ecommend"],
  url: `https://semanticscholar.org/paper/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

const citationNeighbourPaper = (id = "openalex:citation-neighbour-1"): RawItem => ({
  id,
  source: "openalex",
  title: "A Citation-Neighbour Paper With No Literal Topic Overlap At All",
  authors: ["C. Iter"],
  url: `https://openalex.org/${id}`,
  publishedAt: FRESH_DATE,
  metadata: {},
});

/** A resolved positive seed, shaped the way `preferences/positive-seeds.ts` produces it. */
function positiveSeed(overrides: Partial<ResolvedPositiveSeed> = {}): ResolvedPositiveSeed {
  return {
    identity: canonicalPaperKey({
      source: "openalex",
      id: "openalex:W-seed-1",
      title: "My Saved Seed Paper",
    }),
    openalexWorkId: "W-seed-1",
    s2PaperId: "s2-seed-1",
    title: "My Saved Seed Paper",
    ...overrides,
  };
}

describe("P2-S4a new channels — flags default off (F-A-P2-04 4b/4e)", () => {
  it("neither semantic nor topic-field adapter is ever called with both flags unset", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [
      nonMatchingKeywordItem("openalex:kw-a"),
    ]);
    fetchOpenAlexSemanticMock.mockImplementation(sentinel("fetchOpenAlexSemantic"));
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-off-a"),
      },
      { cache, now: NOW },
    );

    expect(fetchOpenAlexSemanticMock).not.toHaveBeenCalled();
    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
    // No literal overlap and no channel admitted it -> correctly dropped.
    expect(result.items.map((item) => item.id)).toEqual([]);
  });

  it("no field on a FeedRequest body can enable either channel — only the server's own env vars can", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockImplementation(sentinel("fetchOpenAlexSemantic"));
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    // `FeedRequest` declares no field for either channel at all — this is
    // the shape a hostile or buggy client body would have to take to even
    // try, cast through `unknown` since the real type has no such keys.
    const req = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-off-b"),
      PEER_CHANNEL_OPENALEX_SEMANTIC: "on",
      PEER_CHANNEL_OPENALEX_TOPIC: "on",
      channels: { semantic: true, topicField: true },
    } as unknown as FeedRequest;

    await runFeedPipeline(req, { cache, now: NOW });

    expect(fetchOpenAlexSemanticMock).not.toHaveBeenCalled();
    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });
});

describe("P2-S4a new channels — flagged on (F-A-P2-04 4b/4e)", () => {
  it("semantic: a zero-literal-overlap item is tagged \"semantic\" and survives via the existing admission bypass", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      nonMatchingKeywordItem("openalex:no-match"),
    ]);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper()]);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-on-a"),
      },
      { cache, now: NOW },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("openalex:semantic-1");
    // The literal gate is a narrow bypass, not a disabled one.
    expect(ids).not.toContain("openalex:no-match");
    const survivor = result.items.find((item) => item.id === "openalex:semantic-1")!;
    expect(survivor.admissionChannels).toContain("semantic");
    expect(fetchOpenAlexSemanticMock).toHaveBeenCalledTimes(1);
    // The semantic-only flag must not also fire the topic-field channel.
    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });

  it("semantic: a channel failure degrades to no candidates from that channel, without breaking Tier 0", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-survives"), title: TOPIC },
    ]);
    fetchOpenAlexSemanticMock.mockRejectedValue(new Error("openalex-semantic HTTP 500"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-on-b"),
      },
      { cache, now: NOW },
    );

    expect(result.items.map((item) => item.id)).toContain("openalex:kw-survives");
  });

  // P2-S4c-1 (Round 3) — REWRITTEN: `openalex_topic` is no longer a
  // build-time channel at all (the old "no upstream topic-id source exists
  // yet" reasoning is retired along with the dead scaffold it described —
  // see pipeline.ts's own retirement comment). It is now a READ-TIME
  // channel driven by the signed-in owner's `preferenceLedger` (see the
  // "P2-S4c-1 topic-field read-time channel" describe block below for its
  // full flagged-on/populated-ledger coverage). This specific test keeps
  // proving the still-true, still-important case: flag on, but a ledger
  // with NO positive `openalex_topic` entries (including the common
  // "ledger absent entirely" case this request exercises) correctly stays
  // inert — nothing to send is not a bug.
  it("topic-field: flag on but no positive openalex_topic ledger entries -> adapter never called (nothing to send)", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-on-c"),
      },
      { cache, now: NOW },
    );

    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });

  // P2-S4c-1 — REWRITTEN: semantic (build-time) and topic-field (now
  // read-time) are independent channels reached through the same
  // `runFeedPipeline` entry point. Both flags on, but still no ledger ->
  // semantic fires (it never needed a ledger), topic-field still doesn't
  // (nothing to send).
  it("semantic (build-time) and topic-field (read-time) flagged on together, no ledger: only semantic actually fires; no duplicate/cross-tagging", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:semantic-both")]);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-on-d"),
      },
      { cache, now: NOW },
    );

    const survivor = result.items.find((item) => item.id === "openalex:semantic-both");
    expect(survivor?.admissionChannels).toEqual(["semantic"]);
    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });
});

// P2-S4c-1 (Round 3) — docs/jev-abc/P2-S4c-B-20260924T113605Z.md Section B,
// ABC-JEV-INTEGRATION.md §4 "P2-S4c B complete" ruling. The topic-field
// channel is now READ-TIME, resolving real OpenAlex topic ids from the
// signed-in owner's own `preferenceLedger` (every like/save on an
// OpenAlex-sourced paper already records `openalex_topic:<id>` entries —
// `topic-seeds.ts`'s own doc comment). SIGNED-IN OWNERS ONLY (manager
// ruling 3): every test below supplies `paperCacheScope`.
describe("P2-S4c-1 topic-field read-time channel", () => {
  function errorsOf(result: { meta: { errors: unknown } }): Partial<Record<string, string>> {
    return result.meta.errors as Partial<Record<string, string>>;
  }

  /** A minimal ledger with exactly one qualifying positive `openalex_topic` entry, lowercased exactly as the ledger stores it in production. */
  function topicLedger(topicKey = "openalex_topic:t20001") {
    return {
      [topicKey]: {
        key: topicKey,
        label: "Solid-state batteries",
        source: "openalex_topic" as const,
        positive: 3,
        negative: 0,
        lastPositiveAt: "2026-09-19T00:00:00.000Z",
        lastSeenAt: "2026-09-19T00:00:00.000Z",
      },
    };
  }

  it("flag on + populated ledger: adapter called with the correctly-cased uppercase id, results tagged \"topic-field\"", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockResolvedValue([semanticPaper("openalex:topic-live-1")]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-topic-live"),
        preferenceLedger: topicLedger(),
      },
      // P2-S4d-FIX: an explicit, available channel-candidate cache — this
      // test exercises the live topic-field fetch itself, not cache
      // configuration, so it must not depend on the ambient (unconfigured
      // in tests) default `PrivateChannelCandidateCache`.
      { cache, now: NOW, channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    // THE case-regression probe at the pipeline level: the ledger key is
    // lowercase ("openalex_topic:t20001") but the adapter must receive the
    // uppercase form the real adapter's own id filter requires.
    expect(fetchOpenAlexTopicFieldMock).toHaveBeenCalledWith(["T20001"]);
    const survivor = result.items.find((item) => item.id === "openalex:topic-live-1");
    expect(survivor?.admissionChannels).toContain("topic-field");
  });

  it("flag off: adapter never called even with a fully populated ledger", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-topic-flag-off"),
        preferenceLedger: topicLedger(),
      },
      { cache, now: NOW },
    );

    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });

  it("anonymous (no paperCacheScope): adapter never called even with flag on and a populated ledger", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        preferenceLedger: topicLedger(),
      },
      { cache, now: NOW },
    );

    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });

  it("negative/zero-net topics are excluded from the call", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-topic-negative"),
        preferenceLedger: {
          "openalex_topic:t20001": {
            key: "openalex_topic:t20001",
            label: "Not actually liked",
            source: "openalex_topic" as const,
            positive: 1,
            negative: 3,
            lastSeenAt: "2026-09-19T00:00:00.000Z",
          },
        },
      },
      { cache, now: NOW },
    );

    expect(fetchOpenAlexTopicFieldMock).not.toHaveBeenCalled();
  });

  it("a channel failure appears in meta.errors.openalex_topic on both a fresh build and a cache-hit read", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockRejectedValue(new Error("openalex-topic HTTP 500"));
    const cache = new MemoryPoolCache();
    // P2-S4d-FIX: shared across both calls, like the day-pool `cache`
    // above — an available cache, so this test exercises the topic leg's
    // own failure reporting rather than the (unconfigured-in-tests)
    // default cache's "unavailable" classification.
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-topic-err"),
      preferenceLedger: topicLedger(),
    };

    const first = await runFeedPipeline(req, { cache, now: NOW, channelCandidateCache });
    expect(errorsOf(first).openalex_topic).toContain("HTTP 500");

    const second = await runFeedPipeline(req, { cache, now: NOW, channelCandidateCache });
    expect(errorsOf(second).openalex_topic).toContain("HTTP 500");
  });
});

// P2-S4c-2 (Round 3) — docs/jev-abc/P2-S4c-B-20260924T113605Z.md Section C,
// ABC-JEV-INTEGRATION.md §4 "P2-S4c B complete" ruling (4). The ADVISOR
// citation-neighborhood channel (`req.affiliation`-driven — distinct from
// the user's OWN positive-seed `seed_citations` channel below, which already
// had truthful reporting) used to swallow its own failure completely
// (`.catch(() => [])` with no capture at all) — a real advisor-lookup outage
// was indistinguishable from "no advisor configured" or "advisor configured,
// zero citation neighbours found". `"affiliation_citation"` is now a 6th
// tracked channel name, reported truthfully under the SAME gate that already
// decided whether a real fetch was attempted (authorId present AND at least
// one seedWorkId) — never merely "authorId present", or a channel that was
// never attempted would be mis-reported as empty/failed.
describe("P2-S4c-2 advisor citation channel truthful failure reporting", () => {
  function errorsOf(result: { meta: { errors: unknown } }): Partial<Record<string, string>> {
    return result.meta.errors as Partial<Record<string, string>>;
  }

  it("a failure appears in meta.errors.affiliation_citation under its own channel name, response still serves other sources' items", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-survives-advisor-err"), title: TOPIC },
    ]);
    fetchCitationNeighborhoodMock.mockRejectedValue(new Error("advisor HTTP 500"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-advisor-err"),
        affiliation: { authorId: "A1", seedWorkIds: ["W1"] },
      },
      { cache, now: NOW },
    );

    expect(result.items.map((item) => item.id)).toContain("openalex:kw-survives-advisor-err");
    expect(errorsOf(result).affiliation_citation).toContain("advisor HTTP 500");
  });

  it("a cache-hit read still reports the same advisor failure, without calling the adapter again (no retry for channels)", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockRejectedValue(new Error("advisor HTTP 500"));
    const cache = new MemoryPoolCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-advisor-cachehit"),
      affiliation: { authorId: "A1", seedWorkIds: ["W1"] },
    };

    const first = await runFeedPipeline(req, { cache, now: NOW });
    expect(errorsOf(first).affiliation_citation).toBeDefined();
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(1);

    const second = await runFeedPipeline(req, { cache, now: NOW });
    expect(errorsOf(second).affiliation_citation).toBeDefined();
    // Still exactly once total across both reads -- a channel failure is
    // never retried, same as every other new-channel name in this file.
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(1);
  });

  it("no advisor configured: no affiliation_citation key appears at all, and the mock is never called for that reason", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-no-advisor") },
      { cache, now: NOW },
    );

    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
    expect(errorsOf(result).affiliation_citation).toBeUndefined();
  });

  it("an advisor configured with authorId but ZERO seedWorkIds is correctly reported as 'not attempted', not empty/failed", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-advisor-no-seeds"),
        affiliation: { authorId: "A1", seedWorkIds: [] },
      },
      { cache, now: NOW },
    );

    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
    expect(errorsOf(result).affiliation_citation).toBeUndefined();
  });

  it("a succeeding advisor channel reports 'ok'-shaped status: no error, and its items are tagged \"citation\"", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationNeighbourPaper("openalex:advisor-ok")]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-advisor-ok"),
        affiliation: { authorId: "A1", seedWorkIds: ["W1"] },
      },
      { cache, now: NOW },
    );

    expect(errorsOf(result).affiliation_citation).toBeUndefined();
    const survivor = result.items.find((item) => item.id === "openalex:advisor-ok");
    expect(survivor?.admissionChannels).toContain("citation");
  });
});

// P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
// Positive-seed channels: S2 recommendations, OpenAlex seed-similarity
// (reusing 4b's `fetchOpenAlexSemantic`, seeded with the SEED's own title
// rather than a project-derived query), and citation neighbours of the
// user's own positive seeds (reusing 4c's `fetchCitationNeighborhood`,
// seeded with the user's OWN work ids rather than an advisor's). All three
// are:
//   - resolved server-side ONLY (via `options.positiveSeeds` — never a
//     `FeedRequest` field, so nothing in a request body can supply or
//     enable them; mirrors the `paperCacheScope`/`companySpendCapability`
//     convention the two P2-S4a channels above already established),
//   - individually flag-gated (server env, literal "on" only),
//   - self-excluding (a channel returning the seed's own paper never
//     reaches the pool — required by the brief's "seed self-exclusion"),
//   - degrade to no candidates on failure without breaking Tier 0.
describe("P2-S4b positive-seed channels — flags default off, positiveSeeds absent (F-A-P2-04 4c/4d)", () => {
  it("all three channel functions stay uncalled when positiveSeeds is supplied but every flag is unset", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [nonMatchingKeywordItem("openalex:kw-a")]);
    fetchOpenAlexSemanticMock.mockImplementation(sentinel("fetchOpenAlexSemantic"));
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-seed-flags-off"),
      },
      { cache, now: NOW, positiveSeeds: [positiveSeed()] },
    );

    expect(fetchOpenAlexSemanticMock).not.toHaveBeenCalled();
    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
  });

  it("positiveSeeds absent (the default): zero calls to any channel function even with all three flags on", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-no-seeds-passed") },
      // P2-S4d-FIX: an explicit, available cache — the point of this test
      // is "empty seeds -> each leg legitimately fetches nothing", which
      // needs the live-fetch path to actually run (not be skipped as
      // "unavailable" by the ambient unconfigured default).
      { cache, now: NOW, channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
  });

  it("no field on a FeedRequest body can supply or enable a positive-seed channel — only options.positiveSeeds + server env can", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    const cache = new MemoryPoolCache();

    // `FeedRequest` declares no `positiveSeeds`/flag field at all — cast
    // through `unknown` since the real type has no such keys, same idiom
    // the P2-S4a "no field on a FeedRequest body" test above uses.
    const req = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-seed-body"),
      PEER_CHANNEL_S2_RECOMMENDATIONS: "on",
      PEER_CHANNEL_OPENALEX_SEED_SIMILARITY: "on",
      PEER_CHANNEL_POSITIVE_SEED_CITATIONS: "on",
      positiveSeeds: [positiveSeed()],
    } as unknown as FeedRequest;

    // positiveSeeds deliberately NOT in `options` here — only stuffed into
    // the request body above, which the pipeline never reads for this.
    await runFeedPipeline(req, { cache, now: NOW });

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    expect(fetchCitationNeighborhoodMock).not.toHaveBeenCalled();
  });
});

describe("P2-S4b positive-seed channels — flagged on (F-A-P2-04 4c/4d)", () => {
  it("S2 recommendations: fires once with the seed's S2 id, tagged \"positive-seed\", survives via the admission bypass", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [nonMatchingKeywordItem("openalex:no-match")]);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper()]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s2-on") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledWith(["s2-seed-1"], expect.anything());
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("semantic_scholar:rec-1");
    expect(ids).not.toContain("openalex:no-match");
    const survivor = result.items.find((item) => item.id === "semantic_scholar:rec-1")!;
    expect(survivor.admissionChannels).toContain("positive-seed");
  });

  it("S2 recommendations: a seed with no s2PaperId never fires the call", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s2-no-id") },
      // P2-S4d-FIX: explicit, available cache — this proves "no s2PaperId
      // means nothing to send," not "the cache looked unavailable."
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed({ s2PaperId: undefined })],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
  });

  // P2-S4b-FIX (Round 3) — item 2: "Not interested" feedback must supply
  // NEGATIVE seeds passed as `negativePaperIds` (§1p.B(5)). Resolution from
  // stored feedback happens in route.ts (preferences/positive-seeds.ts's
  // `resolveNegativeSeedPaperIds`); this level only proves the pipeline
  // OPTION reaches the S2 adapter call correctly once resolved.
  it("S2 recommendations: resolved negative seeds reach the request as negativePaperIds", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper()]);
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s2-negative") },
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed()],
        negativeSeedPaperIds: ["s2-not-interested-1"],
        // P2-S4d-FIX: explicit, available channel-candidate cache.
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledWith(
      ["s2-seed-1"],
      expect.objectContaining({ negativePaperIds: ["s2-not-interested-1"] }),
    );
  });

  it("S2 recommendations: negativeSeedPaperIds alone (no positive seed) never fires the call — S2 requires a positive example", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-negative-only") },
      // P2-S4d-FIX: explicit, available cache — proves "no positive seed
      // means S2 is never called," not "the cache looked unavailable."
      {
        cache,
        now: NOW,
        negativeSeedPaperIds: ["s2-not-interested-1"],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
  });

  it("S2 recommendations: no negativeSeedPaperIds (the default) omits the field entirely — byte-identical to before this option existed", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper()]);
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s2-no-negative") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    const [, opts] = fetchSemanticScholarRecommendationsMock.mock.calls[0];
    expect(opts).not.toHaveProperty("negativePaperIds");
  });

  it("OpenAlex seed-similarity: calls fetchOpenAlexSemantic with the SEED's own title (not a project-derived query), tagged \"positive-seed\"", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:similar-1")]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-sim-on") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed({ title: "My Saved Seed Paper" })],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchOpenAlexSemanticMock).toHaveBeenCalledWith("My Saved Seed Paper", expect.anything());
    const survivor = result.items.find((item) => item.id === "openalex:similar-1");
    expect(survivor?.admissionChannels).toContain("positive-seed");
  });

  it("OpenAlex seed-similarity: a seed with no title never gets its own call", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockImplementation(sentinel("fetchOpenAlexSemantic"));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-sim-no-title") },
      // P2-S4d-FIX: explicit, available cache — proves "no title means
      // nothing to send," not "the cache looked unavailable."
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed({ title: undefined })],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchOpenAlexSemanticMock).not.toHaveBeenCalled();
  });

  it("positive-seed citation neighbours: calls fetchCitationNeighborhood with the seed's OWN OpenAlex work ids, tagged \"citation\"", async () => {
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationNeighbourPaper()]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-cite-on") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed({ openalexWorkId: "W-seed-9" })],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledWith(["W-seed-9"], expect.anything());
    const survivor = result.items.find((item) => item.id === "openalex:citation-neighbour-1");
    expect(survivor?.admissionChannels).toContain("citation");
  });

  it("self-exclusion: a channel returning the seed's OWN paper never reaches the pool, even flagged on", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockResolvedValue([
      semanticPaper("openalex:W-seed-1"), // same identity as the seed itself
      semanticPaper("openalex:genuinely-new"),
    ]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-self-exclude") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed({ openalexWorkId: "W-seed-1" })],
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain("openalex:W-seed-1");
    expect(ids).toContain("openalex:genuinely-new");
  });

  // P2-S4b-FIX (Round 3) — item 4 / docs/jev-abc/P2-S4b-A-20260924T103042Z.md
  // NEW FINDING #2: the test above only proves self-exclusion via a NATIVE
  // openalex-id match (the seed already carries openalexWorkId "W-seed-1"
  // and the mock returns exactly that id). It never exercises the
  // TITLE-ALIAS fallback — the mechanism that actually protects a seed
  // whose paper came from a NON-OpenAlex source (no openalexWorkId at
  // all, e.g. an S2-sourced save with no cross-referenced OpenAlex id).
  // This test's seed is S2-sourced with no openalexWorkId, and its title
  // has >=4 qualifying (length>=3) tokens so canonical-identity.ts actually
  // emits a title alias — the shared positiveSeed() fixture's own default
  // title, "My Saved Seed Paper", is one qualifying token short of that
  // bar (per the review's own finding), so this test deliberately uses a
  // longer title rather than the shared default.
  it("self-exclusion: a NON-OpenAlex-sourced seed (no openalexWorkId) is still excluded via the title-alias fallback", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const SEED_TITLE = "A Distinctive Seed Paper About Solid State Batteries";
    const titleAliasMatch: RawItem = {
      id: "openalex:different-id-same-title",
      source: "openalex",
      title: SEED_TITLE, // same normalized title as the seed -> same title: alias, different native id
      authors: ["A. Lias"],
      url: "https://openalex.org/different-id-same-title",
      publishedAt: FRESH_DATE,
      metadata: {},
    };
    fetchOpenAlexSemanticMock.mockResolvedValue([titleAliasMatch, semanticPaper("openalex:genuinely-new-2")]);
    const cache = new MemoryPoolCache();

    const nonOpenAlexSeed = positiveSeed({
      identity: canonicalPaperKey({
        source: "semantic_scholar",
        id: "semantic_scholar:s2-seed-alias-1",
        title: SEED_TITLE,
      }),
      openalexWorkId: undefined,
      s2PaperId: "s2-seed-alias-1",
      title: SEED_TITLE,
    });
    // Sanity-check the fixture actually exercises the alias path (not the
    // native-id path the test above already covers): no openalexWorkId,
    // and the title genuinely qualifies for a title alias.
    expect(nonOpenAlexSeed.openalexWorkId).toBeUndefined();
    expect(nonOpenAlexSeed.identity.aliases.some((a) => a.startsWith("title:"))).toBe(true);

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-title-alias-exclude") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [nonOpenAlexSeed], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain("openalex:different-id-same-title");
    expect(ids).toContain("openalex:genuinely-new-2");
  });

  // P2-S4b-FIX (Round 3) — item 5 / docs/jev-abc/P2-S4b-A-20260924T103042Z.md
  // NEW FINDING #2: pipeline.ts merges seed-channel items into the
  // candidate list BEFORE dropStale/scoring/excludeIds/ledgerExclusions
  // filtering (see pipeline.ts's own comment at that merge point) —
  // verified correct by code position in that review, but never proven by
  // a dedicated test. This proves it directly: a paper already in the
  // owner's permanent delivery ledger, or already in this request's
  // excludeIds, can never come back through a seed channel, even though
  // the channel itself has no idea those exclusions exist.
  it("a seed-channel candidate already covered by ledgerExclusions or excludeIds never re-enters the pool", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const ledgerHit = recommendedPaper("semantic_scholar:rec-ledger-excluded");
    const excludeIdHit = recommendedPaper("semantic_scholar:rec-excludeid-excluded");
    const survivor = recommendedPaper("semantic_scholar:rec-survives");
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([ledgerHit, excludeIdHit, survivor]);
    const cache = new MemoryPoolCache();
    const ledgerKey = identityForRawItem(ledgerHit).key;

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-seed-ledger-exclusion"),
        excludeIds: [excludeIdHit.id],
      },
      {
        cache,
        now: NOW,
        positiveSeeds: [positiveSeed()],
        ledgerExclusions: new Set([ledgerKey]),
        // P2-S4d-FIX: explicit, available channel-candidate cache.
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(ledgerHit.id);
    expect(ids).not.toContain(excludeIdHit.id);
    expect(ids).toContain(survivor.id);
  });

  it("a positive-seed channel failure degrades to no candidates from that channel, without breaking Tier 0", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-survives"), title: TOPIC },
    ]);
    fetchSemanticScholarRecommendationsMock.mockRejectedValue(new Error("semantic-scholar-recommendations HTTP 500"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-seed-fail") },
      // P2-S4d-FIX: explicit, available cache — this test's whole point is
      // that the S2 leg is genuinely ATTEMPTED and its rejection is caught
      // without breaking the rest of the pipeline; without an available
      // cache the leg would be skipped entirely (never attempted), which
      // would let this test pass without proving anything about the catch
      // path it's named for.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.id)).toContain("openalex:kw-survives");
  });

  it("all three channels together: results from each reach the pool with the right tags, no cross-tagging", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper("semantic_scholar:rec-all")]);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:similar-all")]);
    fetchCitationNeighborhoodMock.mockResolvedValue([citationNeighbourPaper("openalex:citation-all")]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-all-three") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get("semantic_scholar:rec-all")?.admissionChannels).toEqual(["positive-seed"]);
    expect(byId.get("openalex:similar-all")?.admissionChannels).toEqual(["positive-seed"]);
    expect(byId.get("openalex:citation-all")?.admissionChannels).toEqual(["citation"]);
  });
});

// P2-S4b — CACHE-KEY DECISION (§1c: "the private paper cache key must
// change when seeds change, or seeded channels must not be cached under a
// key that ignores them — decide and justify"). `pool-cache.ts`'s
// `derivePoolCacheKey` is outside this slice's allowed-file list, so it
// cannot gain a seed-derived component; the chosen branch is "never
// persist seed-driven candidates under the existing key at all" — proven
// directly here, at the level that actually matters (what a second reader
// or a second read can observe), rather than by inspecting the key string
// (which this slice never changes).
describe("P2-S4b positive-seed channels — cache-key decision (§1c)", () => {
  it("a seed-driven candidate reaches THIS read's response but is never written into the persisted per-day pool cache", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:similar-cache-test")]);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-cache-seed") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );
    expect(result.items.map((item) => item.id)).toContain("openalex:similar-cache-test");

    // Read the persisted cache directly (bypassing runFeedPipeline) --
    // exactly one pool was built and stored (one cache key for this
    // owner/day/topic set), and it must NOT contain the seed-driven item.
    expect(cache.values.size).toBe(1);
    const [cachedPool] = Array.from(cache.values.values());
    const cachedIds = (cachedPool as { items: { id: string }[] }).items.map((item) => item.id);
    expect(cachedIds).not.toContain("openalex:similar-cache-test");
  });

  it("a second read against the SAME cached pool, with positiveSeeds omitted, never inherits a prior read's seed-driven candidate", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:similar-leak-test")]);
    const cache = new MemoryPoolCache();
    // P2-S4d-FIX: shared across both calls (like the day-pool `cache`
    // above) — an explicit, available channel-candidate cache.
    const channelCandidateCache = new MemoryChannelCandidateCache();

    const first = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-cache-leak") },
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );
    expect(first.items.map((item) => item.id)).toContain("openalex:similar-leak-test");

    // Same day-pool cache, same owner/day/topics -> a day-pool cache HIT.
    // No positiveSeeds this time (e.g. the flag turned off between
    // requests, or a caller that never resolves seeds at all) -> a
    // DIFFERENT channel-candidate signature (empty seed-key set) -> the
    // channel cache itself also misses and fetches fresh, but with no
    // seeds to search, correctly finding/sending nothing.
    const second = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-cache-leak") },
      { cache, now: NOW, channelCandidateCache },
    );
    expect(second.items.map((item) => item.id)).not.toContain("openalex:similar-leak-test");
  });
});

// P2-S4a-FIX (Round 3) — F-A-P2S4a-02, ABC-JEV-INTEGRATION.md §1p.B(2)/(3),
// docs/jev-abc/P2-S4a-A-20260924T100013Z.md NEW FINDING #2. Before this fix,
// a semantic/topic-field/S2-recommendation/seed-similarity/seed-citation
// channel failure was completely invisible outside a server console line —
// `meta.errors` and the cached pool's `sourceStatus` never mentioned it, so
// a real outage on any of these channels looked identical to the channel
// quietly finding nothing. Each channel now reports truthfully under a
// stable name (`openalex_semantic`, `openalex_topic`, `s2_recommendations`,
// `openalex_seed_similarity`, `seed_citations`) — on a fresh build AND on a
// cache-hit read, never retried, and never reported at all when its own
// flag is off. `result.meta.errors` is typed `Partial<Record<SourceId,
// string>>` (SourceId is a closed union that doesn't include these channel
// names) so every read here goes through a loose cast, matching how this
// slice's checkpoint documents the widened runtime shape.
describe("P2-S4a-FIX channel failure visibility (F-A-P2S4a-02)", () => {
  function errorsOf(result: { meta: { errors: unknown } }): Partial<Record<string, string>> {
    return result.meta.errors as Partial<Record<string, string>>;
  }

  it("openalex_semantic: a channel failure appears in meta.errors under its channel name, response still served", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-survives-sem-err"), title: TOPIC },
    ]);
    fetchOpenAlexSemanticMock.mockRejectedValue(
      new Error("openalex-semantic HTTP 500 — upstream exploded"),
    );
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-err-semantic") },
      { cache, now: NOW },
    );

    expect(result.items.map((item) => item.id)).toContain("openalex:kw-survives-sem-err");
    expect(errorsOf(result).openalex_semantic).toContain("HTTP 500");
  });

  it("openalex_semantic: a cache-hit read still reports the same failure, without calling the adapter again (no retry for channels)", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-cachehit-sem"), title: TOPIC },
    ]);
    fetchOpenAlexSemanticMock.mockRejectedValue(new Error("openalex-semantic HTTP 500"));
    const cache = new MemoryPoolCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-cachehit-semantic"),
    };

    const first = await runFeedPipeline(req, { cache, now: NOW });
    expect(errorsOf(first).openalex_semantic).toBeDefined();
    expect(fetchOpenAlexSemanticMock).toHaveBeenCalledTimes(1);

    const second = await runFeedPipeline(req, { cache, now: NOW });
    expect(errorsOf(second).openalex_semantic).toBeDefined();
    // Still exactly once total across both reads — a channel failure is
    // never retried, unlike the 5 registered academic sources.
    expect(fetchOpenAlexSemanticMock).toHaveBeenCalledTimes(1);
  });

  // P2-S4c-1 — REWRITTEN reasoning: `openalex_topic` reports nothing here
  // NOT because "no topic-id source exists yet" (that scaffold is retired),
  // but because this request supplies no `preferenceLedger` at all, so the
  // read-time resolver finds zero positive topic ids to send — a correct
  // "nothing to send", covered in full by the "P2-S4c-1 topic-field
  // read-time channel" describe block above. Kept here too since this
  // describe block is specifically about truthful `meta.errors` reporting.
  it("openalex_topic: flagged on but no ledger to resolve ids from — reports nothing in meta.errors", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-topic-inert-err") },
      { cache, now: NOW },
    );

    expect(errorsOf(result).openalex_topic).toBeUndefined();
  });

  // P2-S4c-2 — extended from 5 to 6 channel names: `affiliation_citation`
  // uses a different gate (an advisor actually configured, not an env
  // flag), but this request configures no advisor either, so it must be
  // just as silent as the five flag-gated channels.
  it("disabled/unconfigured channels report nothing: with every new-channel flag off and no advisor configured, none of the 6 channel names appear in meta.errors", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex HTTP 500");
    });
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-all-channels-off") },
      { cache, now: NOW, positiveSeeds: [positiveSeed()] },
    );

    const errors = errorsOf(result);
    for (const channel of [
      "openalex_semantic",
      "openalex_topic",
      "s2_recommendations",
      "openalex_seed_similarity",
      "seed_citations",
      "affiliation_citation",
    ]) {
      expect(errors[channel]).toBeUndefined();
    }
    // The real, registered source's own failure is untouched by any of this.
    expect(errors.openalex).toContain("500");
  });

  it("s2_recommendations: a channel failure appears in meta.errors under its channel name, response still served", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => [
      { ...nonMatchingKeywordItem("openalex:kw-survives-s2-err"), title: TOPIC },
    ]);
    fetchSemanticScholarRecommendationsMock.mockRejectedValue(
      new Error("semantic-scholar-recommendations HTTP 500"),
    );
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-err-s2") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(result.items.map((item) => item.id)).toContain("openalex:kw-survives-s2-err");
    expect(errorsOf(result).s2_recommendations).toContain("HTTP 500");
  });

  it("openalex_seed_similarity: a channel failure appears in meta.errors under its channel name", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexSemanticMock.mockRejectedValue(new Error("openalex-semantic HTTP 500"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-err-sim") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(errorsOf(result).openalex_seed_similarity).toContain("HTTP 500");
  });

  it("seed_citations: a channel failure appears in meta.errors under its channel name", async () => {
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockRejectedValue(new Error("seed-citations HTTP 500"));
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-err-cite") },
      // P2-S4d-FIX: explicit, available channel-candidate cache.
      { cache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache: new MemoryChannelCandidateCache() },
    );

    expect(errorsOf(result).seed_citations).toContain("HTTP 500");
  });

  // Regression guard for the `everySourceFailed` scoping fix this slice
  // makes: a channel's status entry now shares the same map as the 5
  // registered sources (so it can survive a cache-hit round trip), and
  // must NEVER change whether "every ATTEMPTED source failed"
  // (§1p.B(2): "a pool where every source failed is not cached as a valid
  // day") — a channel is not a "source" in that rule's sense.
  it("a succeeding channel never masks a real all-sources-failed pool from the every-source-failed cache guard", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEMANTIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex HTTP 500");
    });
    fetchOpenAlexSemanticMock.mockResolvedValue([semanticPaper("openalex:masking-check")]);
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-mask-check") },
      { cache, now: NOW },
    );

    // The one real, registered source failed outright -- per §1p.B(2) this
    // must not be cached as a valid day, REGARDLESS of the semantic
    // channel succeeding alongside it in the same sourceStatus map.
    expect(cache.values.size).toBe(0);
  });
});

// P2-S4d (Round 3) — F-M-P2-02, ABC-JEV-INTEGRATION.md §4 "P2-S4d design
// (addendum to the P2-S4c guide) accepted". Before this, ANY enabled
// read-time channel flag meant every batchless page open/refresh fired that
// channel's live call fresh, unbounded. This wraps all four read-time
// channels (S2 recommendations, OpenAlex seed-similarity, positive-seed
// citations, and P2-S4c-1's topic-field) in a per-owner/local-date/
// signature cache, reusing the P2-S2 bounded-retry discipline for a failed
// leg. `options.channelCandidateCache` is a REAL `MemoryChannelCandidateCache`
// in every test below (never a hand-stubbed object) so these tests exercise
// the actual cached code path, not a mock of the cache itself.
describe("P2-S4d read-time channel candidate cache (F-M-P2-02)", () => {
  it("THE KEY TEST — second read, same day, same seed/topic/legs signature: ZERO adapter calls", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper("semantic_scholar:cache-1")]);
    const dayPoolCache = new MemoryPoolCache();
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-s4d-zero-calls"),
    };
    const options = { cache: dayPoolCache, now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache };

    const first = await runFeedPipeline(req, options);
    expect(first.items.map((i) => i.id)).toContain("semantic_scholar:cache-1");
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);

    // Sentinel-throw every one of the four adapters: if ANY of them fires on
    // the second read, the test fails loudly rather than silently passing.
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    fetchOpenAlexSemanticMock.mockImplementation(sentinel("fetchOpenAlexSemantic"));
    fetchCitationNeighborhoodMock.mockImplementation(sentinel("fetchCitationNeighborhood"));
    fetchOpenAlexTopicFieldMock.mockImplementation(sentinel("fetchOpenAlexTopicField"));

    const second = await runFeedPipeline(req, options);
    expect(second.items.map((i) => i.id)).toContain("semantic_scholar:cache-1");
  });

  it("a changed seed set produces a different signature = exactly one new fetch", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper("semantic_scholar:cache-2")]);
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-s4d-changed-seed"),
    };

    await runFeedPipeline(req, {
      cache: new MemoryPoolCache(),
      now: NOW,
      positiveSeeds: [positiveSeed()],
      channelCandidateCache,
    });
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);

    // One MORE resolved seed than before -> a different positive-seed-key
    // signature -> guaranteed miss, regardless of caching.
    await runFeedPipeline(req, {
      cache: new MemoryPoolCache(),
      now: NOW,
      positiveSeeds: [positiveSeed(), positiveSeed({ identity: canonicalPaperKey({ source: "openalex", id: "openalex:W-seed-2", title: "A Second Distinct Saved Seed Paper" }), openalexWorkId: "W-seed-2", s2PaperId: "s2-seed-2", title: "A Second Distinct Saved Seed Paper" })],
      channelCandidateCache,
    });
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(2);
  });

  it("a changed negative-seed set produces a different signature = exactly one new fetch", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper("semantic_scholar:cache-neg")]);
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-s4d-changed-negative"),
    };
    const positiveSeeds = [positiveSeed()];

    await runFeedPipeline(req, {
      cache: new MemoryPoolCache(),
      now: NOW,
      positiveSeeds,
      channelCandidateCache,
    });
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);

    // A newly-resolved "Not interested" id -> a different negative-seed-id
    // signature -> guaranteed miss.
    await runFeedPipeline(req, {
      cache: new MemoryPoolCache(),
      now: NOW,
      positiveSeeds,
      negativeSeedPaperIds: ["s2-newly-not-interested"],
      channelCandidateCache,
    });
    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(2);
  });

  it("a changed topic set produces a different signature = exactly one new fetch", async () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_TOPIC", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchOpenAlexTopicFieldMock.mockResolvedValue([semanticPaper("openalex:cache-topic")]);
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-s4d-changed-topic"),
      preferenceLedger: {
        "openalex_topic:t1": {
          key: "openalex_topic:t1",
          label: "Topic One",
          source: "openalex_topic",
          positive: 3,
          negative: 0,
          lastSeenAt: "2026-09-19T00:00:00.000Z",
        },
      },
    };

    await runFeedPipeline(req, { cache: new MemoryPoolCache(), now: NOW, channelCandidateCache });
    expect(fetchOpenAlexTopicFieldMock).toHaveBeenCalledTimes(1);
    expect(fetchOpenAlexTopicFieldMock).toHaveBeenCalledWith(["T1"]);

    // A newly-liked topic added to the ledger -> a different topic-id
    // signature -> guaranteed miss.
    const withSecondTopic: FeedRequest = {
      ...req,
      preferenceLedger: {
        ...req.preferenceLedger,
        "openalex_topic:t2": {
          key: "openalex_topic:t2",
          label: "Topic Two",
          source: "openalex_topic",
          positive: 3,
          negative: 0,
          lastSeenAt: "2026-09-19T00:00:00.000Z",
        },
      },
    };
    await runFeedPipeline(withSecondTopic, { cache: new MemoryPoolCache(), now: NOW, channelCandidateCache });
    expect(fetchOpenAlexTopicFieldMock).toHaveBeenCalledTimes(2);
  });

  it("a failed leg is retried at most once per 30 minutes and at most 3 times per local day (fake clock via `now`)", async () => {
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchCitationNeighborhoodMock.mockRejectedValue(new Error("seed-citations HTTP 500"));
    const channelCandidateCache = new MemoryChannelCandidateCache();
    const counterStore = new InMemoryCounterStore();
    const req: FeedRequest = {
      topics: [TOPIC],
      sources: ["openalex"],
      aiTier: 0,
      paperCacheScope: scopeFor("owner-s4d-retry-bounds"),
    };
    const seeds = [positiveSeed({ openalexWorkId: "W-retry-1" })];
    const baseOptions = { cache: new MemoryPoolCache(), positiveSeeds: seeds, channelCandidateCache, counterStore };

    // T0 09:00 -- fresh build, the leg fails. Not a retry: attempt #1.
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 9, 0) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(1);

    // T0+10min -- well under the 30-minute window: no retry.
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 9, 10) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(1);

    // T0+32min -- past the window: exactly one retry (attempt #2).
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 9, 32) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(2);

    // +31min twice more, same local day -- two more retries (#3, #4), the
    // day's 3rd and LAST allowed retry lands on attempt #4 total.
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 10, 3) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(3);
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 10, 34) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(4);

    // +31min again, same local day -- the 3-retries-per-day cap is now
    // exhausted (attempt #2,#3,#4 were the 3 retries); no further call.
    await runFeedPipeline(req, { ...baseOptions, now: new Date(2026, 8, 20, 11, 5) });
    expect(fetchCitationNeighborhoodMock).toHaveBeenCalledTimes(4);
  });

  // P2-S4d-FIX (Round 3): this test forces the failure via
  // `vi.spyOn(cache, "get").mockRejectedValue(...)` -- a raw JS rejection.
  // That proves `resolveChannelCandidates`'s OWN defensive try/catch
  // fallback still degrades safely for a hypothetical future cache
  // implementation that throws instead of returning the tri-state
  // "unavailable" status. It does NOT prove either SHIPPED class ever
  // actually produces this state in production -- that was fresh A's
  // Finding 2 (docs/jev-abc/P2-S4cd-A-20260924T152147Z.md): neither class
  // could ever reject, so this path was previously unreachable via real
  // code. The "P2-S4d-FIX — tri-state channel cache read via the REAL
  // PrivateChannelCandidateCache" describe block below is the realistic
  // reproduction, driving an actual Supabase-shaped error response (no JS
  // throw) through the real class.
  it("cache-unreadable degrades to SKIP the live legs (never fetch-without-caching), with a truthful, distinct error", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    const channelCandidateCache = new MemoryChannelCandidateCache();
    // A real instance, with `get` forced to reject -- proves the WRAPPER's
    // own defensive handling, not a hand-stubbed `{get, set}` pair.
    vi.spyOn(channelCandidateCache, "get").mockRejectedValue(new Error("supabase: connection reset"));

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s4d-unreadable") },
      { cache: new MemoryPoolCache(), now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    const errors = result.meta.errors as Partial<Record<string, string>>;
    expect(errors.s2_recommendations).toBeDefined();
    // Distinct wording from a real adapter failure (never the same shape as
    // "semantic-scholar-recommendations HTTP 500", so a reader can tell "we
    // didn't even try" apart from "the adapter failed").
    expect(errors.s2_recommendations).toContain("cache");
    expect(errors.s2_recommendations).not.toContain("HTTP");
  });

  it("anonymous request (no paperCacheScope): zero adapter calls AND zero cache reads/writes", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));
    const channelCandidateCache = new MemoryChannelCandidateCache();
    vi.spyOn(channelCandidateCache, "get").mockImplementation(sentinel("channelCandidateCache.get"));
    vi.spyOn(channelCandidateCache, "set").mockImplementation(sentinel("channelCandidateCache.set"));

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0 }, // no paperCacheScope
      { cache: new MemoryPoolCache(), now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
  });
});

// P2-S4d-FIX (Round 3) — ABC-JEV-INTEGRATION.md §4 "P2-S4c+d fresh A ...
// Finding 2" (2026-09-24T15:40:42Z) + docs/jev-abc/
// P2-S4cd-A-20260924T152147Z.md. Fresh A's finding: the "cache-unreadable"
// test above only forced a rejection via `vi.spyOn(cache, "get")
// .mockRejectedValue(...)` -- a state NEITHER shipped cache class ever
// actually produced, since both swallowed every real failure to a clean
// `null` miss (indistinguishable from "nothing cached yet"). These tests
// drive the REAL `PrivateChannelCandidateCache` through a fake
// Supabase-shaped client (never a hand-stubbed `{get,set}` pair, never a
// forced `.get` rejection) end-to-end through `runFeedPipeline`, proving
// the tri-state contract: an actual storage error (a Supabase `error`
// object, no JS throw) is now classified "unavailable" and skips every
// live leg with the distinct error text, while a genuine miss and a
// genuine hit still behave exactly as before the fix.
describe("P2-S4d-FIX — tri-state channel cache read via the REAL PrivateChannelCandidateCache", () => {
  function fakeSupabaseClient(maybeSingleResult: { data: { payload: unknown } | null; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      upsert,
    }));
    return { client: { from }, maybeSingle, upsert };
  }

  it("a Supabase error object (no throw) on get() degrades to SKIP every live leg, zero adapter calls, the distinct cache-unavailable text — never the adapter-failure text", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));

    const scope = scopeFor("owner-s4d-fix-real-outage");
    const fake = fakeSupabaseClient({ data: null, error: { message: "supabase: connection reset" } });
    const channelCandidateCache = new PrivateChannelCandidateCache(scope, fake.client as never);

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scope },
      { cache: new MemoryPoolCache(), now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    expect(fake.maybeSingle).toHaveBeenCalledTimes(1);
    expect(fake.upsert).not.toHaveBeenCalled();
    const errors = result.meta.errors as Partial<Record<string, string>>;
    expect(errors.s2_recommendations).toBeDefined();
    expect(errors.s2_recommendations).toContain("cache");
    expect(errors.s2_recommendations).not.toContain("HTTP");
    expect(errors.s2_recommendations).not.toContain("connection reset");
  });

  it("a genuine miss (no row, no error) still fetches live exactly once and persists", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([recommendedPaper("semantic_scholar:s4d-fix-miss")]);

    const scope = scopeFor("owner-s4d-fix-real-miss");
    const fake = fakeSupabaseClient({ data: null, error: null });
    const channelCandidateCache = new PrivateChannelCandidateCache(scope, fake.client as never);

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scope },
      { cache: new MemoryPoolCache(), now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );

    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);
    expect(result.items.map((i) => i.id)).toContain("semantic_scholar:s4d-fix-miss");
    expect(fake.upsert).toHaveBeenCalledTimes(1);
    const errors = result.meta.errors as Partial<Record<string, string>>;
    expect(errors.s2_recommendations).toBeUndefined();
  });

  it("a genuine hit (valid cached row) makes zero adapter calls", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockImplementation(sentinel("fetchSemanticScholarRecommendations"));

    const scope = scopeFor("owner-s4d-fix-real-hit");
    const cachedPayload: CachedChannelCandidates = {
      // Tagged with its own admission channel exactly like a real
      // `fetchChannelLegs` result would be before being persisted — this is
      // what lets the item bypass the literal-topic-overlap gate downstream
      // (`combine.ts`'s `admittedByNonLiteralChannel`).
      items: [{ ...recommendedPaper("semantic_scholar:s4d-fix-hit"), admissionChannels: ["positive-seed"] }],
      legStatus: { s2_recommendations: { status: "ok", lastAttemptAt: NOW.toISOString(), retryCount: 0 } },
      generatedAt: NOW.toISOString(),
    };
    const fake = fakeSupabaseClient({ data: { payload: cachedPayload }, error: null });
    const channelCandidateCache = new PrivateChannelCandidateCache(scope, fake.client as never);

    const result = await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scope },
      { cache: new MemoryPoolCache(), now: NOW, positiveSeeds: [positiveSeed()], channelCandidateCache },
    );

    expect(fetchSemanticScholarRecommendationsMock).not.toHaveBeenCalled();
    expect(result.items.map((i) => i.id)).toContain("semantic_scholar:s4d-fix-hit");
  });
});

// S2 pre-flip conflict rule — ABC-JEV-INTEGRATION.md §4 "P5-S2 fresh A:
// VERIFIED_OFFLINE_BOUNDED; F-A-P5S2-01; R3-CLEANUP-1 C assigned; S2
// pre-flip conflict rule folded into P2-S4c+d" ruling: "at the S2
// recommendations leg, an S2 paper id present in BOTH the positive and
// negative seed lists is sent as NEITHER (conservative, needs no
// cross-record recency)." Originates from P2-S4b-FIX2 fresh A's finding (b):
// two different stored item_ids resolving to the same S2 paper, with
// opposite latest feedback, could previously send that id as both positive
// and negative in the same request.
describe("S2 recommendations — both-sides conflict rule", () => {
  it("an S2 id present in both the positive-seed list and the negative list is sent as NEITHER; other ids are unaffected", async () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    bySourceId.openalex.fetch = vi.fn(async () => []);
    fetchSemanticScholarRecommendationsMock.mockResolvedValue([]);
    const cache = new MemoryPoolCache();

    const conflictedSeed = positiveSeed({
      identity: canonicalPaperKey({ source: "semantic_scholar", id: "semantic_scholar:s2-conflict", title: "Conflicted Seed" }),
      openalexWorkId: undefined,
      s2PaperId: "s2-conflict",
      title: "Conflicted Seed",
    });
    const cleanSeed = positiveSeed({
      identity: canonicalPaperKey({ source: "semantic_scholar", id: "semantic_scholar:s2-clean", title: "Clean Seed" }),
      openalexWorkId: undefined,
      s2PaperId: "s2-clean",
      title: "Clean Seed",
    });

    await runFeedPipeline(
      { topics: [TOPIC], sources: ["openalex"], aiTier: 0, paperCacheScope: scopeFor("owner-s2-conflict") },
      {
        cache,
        now: NOW,
        positiveSeeds: [conflictedSeed, cleanSeed],
        // "s2-conflict" appears on BOTH sides; "s2-other-negative" is
        // genuinely negative-only and must be unaffected.
        negativeSeedPaperIds: ["s2-conflict", "s2-other-negative"],
        // P2-S4d-FIX: explicit, available channel-candidate cache.
        channelCandidateCache: new MemoryChannelCandidateCache(),
      },
    );

    expect(fetchSemanticScholarRecommendationsMock).toHaveBeenCalledTimes(1);
    const [sentPositiveIds, sentOptions] = fetchSemanticScholarRecommendationsMock.mock.calls[0];
    expect(sentPositiveIds).not.toContain("s2-conflict");
    expect(sentPositiveIds).toContain("s2-clean");
    expect((sentOptions as { negativePaperIds?: string[] }).negativePaperIds).not.toContain("s2-conflict");
    expect((sentOptions as { negativePaperIds?: string[] }).negativePaperIds).toContain("s2-other-negative");
  });
});
