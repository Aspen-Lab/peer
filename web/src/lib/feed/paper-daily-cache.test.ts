import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { resolveProvider } from "@/lib/llm/providers/registry";
import { bySourceId, webSearch } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { normalizeFeedIntent } from "./intent";
import { selectedSenseConcept } from "./senses";
import type { ShadowCandidate } from "@/lib/decisions/shadow";

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/llm/providers/registry")
  >();
  return { ...actual, resolveProvider: vi.fn(() => null) };
});

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();

  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const academicPaper: RawItem = {
  id: "openalex:daily-paper",
  source: "openalex",
  title: "Solid-State Battery Electrolytes for High Energy Cells",
  authors: ["A. Researcher"],
  abstract:
    "Solid-state battery electrolyte design improves electrochemical stability.",
  url: "https://openalex.org/W123",
  publishedAt: "2026-07-20",
  venue: "Journal of Battery Research",
  tags: ["solid-state battery", "electrolyte"],
  metadata: {},
};

const secondPaper: RawItem = {
  ...academicPaper,
  id: "openalex:daily-paper-2",
  title: "Interfacial Stability of Sulfide Solid Electrolytes",
  url: "https://openalex.org/W124",
};

const originalAcademicFetch = bySourceId.openalex.fetch;
const originalWebFetch = webSearch.fetch;

afterEach(() => {
  bySourceId.openalex.fetch = originalAcademicFetch;
  webSearch.fetch = originalWebFetch;
  vi.mocked(resolveProvider).mockReset();
  vi.mocked(resolveProvider).mockReturnValue(null);
});

function stubSources() {
  const academicFetch = vi.fn(async () => [academicPaper, secondPaper]);
  const searchFetch = vi.fn(async () => [
    {
      ...academicPaper,
      id: "web:https://arxiv.org/abs/2607.12345",
      source: "web" as const,
      title: "New Solid-State Electrolytes for High Energy Batteries",
      url: "https://arxiv.org/abs/2607.12345",
    },
  ]);
  bySourceId.openalex.fetch = academicFetch;
  webSearch.fetch = searchFetch;
  return { academicFetch, searchFetch };
}

const request = {
  topics: ["solid-state battery"],
  sources: ["openalex" as const],
  aiTier: 1 as const,
  searchConnectors: {
    tavily: { enabled: true, apiKey: "test-key" },
  },
};

const privateScope = createTrustedPaperCacheScope({
  ownerId: "owner-test",
  project: "solid-state battery research",
  topics: request.topics,
  aiTier: 1,
});

describe("daily paper pool", () => {
  it("invalidates a private identity when the selected alias mapping version changes", () => {
    const hr = normalizeFeedIntent({
      intent: { version: "feed-intent-v1", requiredConcepts: ["conflict"], selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] },
    });
    const oldSelection = selectedSenseConcept("hr.role_conflict");
    const oldVersion = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        requiredConcepts: ["conflict"],
        selectedSenseConcepts: [{
          ...oldSelection,
          vocabularyVersion: "peer-local-senses-v0",
          provenance: { ...oldSelection.provenance, release: "peer-local-senses-v0", mappingVersion: "peer-local-senses-v0" },
        }],
      },
    });
    if (!hr.ok || !oldVersion.ok) throw new Error("fixture must be valid");
    const first = createTrustedPaperCacheScope({ ownerId: "owner", intent: hr.intent, aiTier: 0 });
    const second = createTrustedPaperCacheScope({ ownerId: "owner", intent: oldVersion.intent, aiTier: 0 });

    expect(first.identity).not.toBe(second.identity);
  });

  it("applies typed sense admission through the mocked paper pipeline without weakening exclusion", async () => {
    const { academicFetch } = stubSources();
    academicFetch.mockResolvedValueOnce([
      { ...academicPaper, id: "hr", title: "Role conflict and employee wellbeing" },
      { ...academicPaper, id: "boilerplate", title: "Conflict of interest statement" },
      { ...academicPaper, id: "semantic", title: "Workplace identity study" },
      { ...academicPaper, id: "excluded", title: "Role conflict review" },
    ]);
    const intent = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        requiredConcepts: ["conflict"],
        exclusions: ["review"],
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!intent.ok) throw new Error("fixture must be valid");

    const result = await runFeedPipeline({
      topics: ["conflict"],
      intent: intent.intent,
      admissionChannels: { semantic: ["semantic"] },
      sources: ["openalex"],
      aiTier: 0,
    }, { now: new Date("2026-07-29T09:00:00Z") });

    expect(result.items.map((candidate) => candidate.id)).toEqual(["hr", "semantic"]);
  });
  it("keeps anonymous Tier-0 paper requests ephemeral instead of persisting their membership", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    await runFeedPipeline({ ...request, aiTier: 0 }, { cache, now });
    await runFeedPipeline({ ...request, aiTier: 0 }, { cache, now });

    expect(cache.values.size).toBe(0);
    expect(academicFetch).toHaveBeenCalledTimes(2);
  });

  it("isolates Tier-2 membership and reasons by trusted owner and full intent identity", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    const generateJsonText = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          orderedIds: ["openalex:daily-paper"],
          reasons: { "openalex:daily-paper": "owner one reason" },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          orderedIds: ["openalex:daily-paper-2"],
          reasons: { "openalex:daily-paper-2": "owner two reason" },
        }),
      );
    vi.mocked(resolveProvider).mockReturnValue({
      generateJsonText,
    } as unknown as ReturnType<typeof resolveProvider>);

    const ownerOne = createTrustedPaperCacheScope({
      ownerId: "owner-one",
      project: "battery cathodes",
      challenge: "reduce interfacial resistance",
      methods: ["impedance spectroscopy"],
      seedTexts: ["sulfide electrolyte"],
      aiTier: 2,
    });
    const ownerTwo = createTrustedPaperCacheScope({
      ownerId: "owner-two",
      project: "battery cathodes",
      challenge: "reduce interfacial resistance",
      methods: ["impedance spectroscopy"],
      seedTexts: ["sulfide electrolyte"],
      aiTier: 2,
    });

    const first = await runFeedPipeline(
      { ...request, aiTier: 2, paperCacheScope: ownerOne },
      { cache, now },
    );
    const second = await runFeedPipeline(
      { ...request, aiTier: 2, paperCacheScope: ownerTwo },
      { cache, now },
    );

    expect(cache.values.size).toBe(2);
    expect(academicFetch).toHaveBeenCalledTimes(2);
    expect(generateJsonText).toHaveBeenCalledTimes(2);
    expect(second.items[0].relevanceReason).not.toBe(
      first.items[0].relevanceReason,
    );
  });

  it("refuses an injected v5 paper payload and rebuilds only inside the v6 private scope", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    cache.values.set("peer-pool-v5-papers-2026-07-29-unsafe", {
      surface: "papers",
      generatedAt: now.toISOString(),
      localDate: "2026-07-29",
      items: [{
        ...academicPaper,
        score: 1,
        scoreBreakdown: {
          keyword: 1,
          tfidf: 1,
          topicality: 1,
          recency: 1,
          source: 1,
          combined: 1,
        },
        matchedKeywords: ["solid-state battery"],
        relevanceReason: "foreign reason",
      }],
      aiOrder: [academicPaper.id],
      aiReasons: { [academicPaper.id]: "foreign reason" },
    });

    const result = await runFeedPipeline(
      {
        ...request,
        aiTier: 0,
        paperCacheScope: createTrustedPaperCacheScope({
          ownerId: "owner-v6",
          project: "private project",
          topics: request.topics,
          aiTier: 0,
        }),
      },
      { cache, now },
    );

    expect(academicFetch).toHaveBeenCalledOnce();
    expect(result.items[0]?.relevanceReason).not.toBe("foreign reason");
    expect([...cache.values.keys()]).toEqual(
      expect.arrayContaining(["peer-pool-v5-papers-2026-07-29-unsafe"]),
    );
    expect([...cache.values.keys()].some((key) => key.startsWith("peer-pool-v6-papers-"))).toBe(true);
  });

  it("keeps Tier-0 usable when a private cache store is unavailable", async () => {
    const { academicFetch } = stubSources();
    const unavailable: PoolCache = {
      get: vi.fn().mockRejectedValue(new Error("private store unavailable")),
      set: vi.fn().mockRejectedValue(new Error("private store unavailable")),
    };
    const now = new Date(2026, 6, 29, 9, 0);
    const scopedRequest = {
      ...request,
      aiTier: 0 as const,
      paperCacheScope: createTrustedPaperCacheScope({
        ownerId: "owner-outage",
        project: "private project",
        topics: request.topics,
        aiTier: 0,
      }),
    };

    const first = await runFeedPipeline(scopedRequest, { cache: unavailable, now });
    const second = await runFeedPipeline(scopedRequest, { cache: unavailable, now });

    expect(first.items).not.toHaveLength(0);
    expect(second.items).not.toHaveLength(0);
    expect(academicFetch).toHaveBeenCalledTimes(2);
  });

  it("serves the same papers all day without re-fetching a single source", async () => {
    const { academicFetch, searchFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const morning = await runFeedPipeline(
      { ...request, paperCacheScope: privateScope },
      { cache, now },
    );
    const afternoon = await runFeedPipeline(
      { ...request, paperCacheScope: privateScope },
      { cache, now },
    );

    expect(morning.items).not.toHaveLength(0);
    // THE PROMISE THIS SURFACE MAKES: one search per day, and re-opening the
    // app returns the reading list you already had rather than a new one.
    expect(afternoon.items.map((item) => item.id)).toEqual(
      morning.items.map((item) => item.id),
    );
    expect(academicFetch).toHaveBeenCalledOnce();
    expect(cache.values.size).toBe(1);
    // NOT ONE WEB SEARCH, on either call, with a Tavily key sitting right
    // there in the request. The paper surface's only web spend was a
    // discovery side-channel whose output nothing read; papers come from the
    // free academic sources, so the surface now costs zero search quota.
    expect(searchFetch).not.toHaveBeenCalled();
    // The pool's build stamp travels with it, so a cached read reports when
    // the papers were actually found rather than when they were served.
    expect(afternoon.meta.generatedAt).toBe(morning.meta.generatedAt);
  });

  it("rebuilds on the next local day", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();

    await runFeedPipeline(
      { ...request, paperCacheScope: privateScope },
      { cache, now: new Date(2026, 6, 29, 9, 0) },
    );
    await runFeedPipeline(
      { ...request, paperCacheScope: privateScope },
      { cache, now: new Date(2026, 6, 30, 9, 0) },
    );

    expect(academicFetch).toHaveBeenCalledTimes(2);
    expect(cache.values.size).toBe(2);
  });

  it("runs the Tier-2 rerank once a day and replays its ranking after that", async () => {
    const { academicFetch } = stubSources();
    // Rank the second paper first, so a replayed ranking is distinguishable
    // from the order the local scorer would have produced on its own.
    const generateJsonText = vi.fn(async () =>
      JSON.stringify({
        orderedIds: ["openalex:daily-paper-2", "openalex:daily-paper"],
        reasons: { "openalex:daily-paper-2": "closest to the open question" },
      }),
    );
    vi.mocked(resolveProvider).mockReturnValue({
      generateJsonText,
    } as unknown as ReturnType<typeof resolveProvider>);

    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    const tier2Request = {
      ...request,
      aiTier: 2 as const,
      paperCacheScope: createTrustedPaperCacheScope({
        ownerId: "owner-test",
        project: "solid-state battery research",
        topics: request.topics,
        aiTier: 2,
      }),
    };

    const first = await runFeedPipeline(tier2Request, { cache, now });
    const second = await runFeedPipeline(tier2Request, { cache, now });

    // The expensive half of a Tier-2 build. Before the papers pool existed
    // this ran on every request, so simply reloading the page re-spent tokens.
    expect(generateJsonText).toHaveBeenCalledOnce();
    expect(academicFetch).toHaveBeenCalledOnce();
    expect(first.items[0].id).toBe("openalex:daily-paper-2");
    // Replayed from the cache, not recomputed: same order AND same written
    // reason, with no provider call behind it.
    expect(second.items[0].id).toBe("openalex:daily-paper-2");
    expect(second.items[0].relevanceReason).toBe(
      "closest to the open question",
    );
  });

  // P4-S8a (Round 3) — F-B-P4S8-01 regression pin, ABC-JEV-INTEGRATION.md
  // §4 Round 3 Policy E3 / docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN
  // B3: "a persisted cache-hit never invokes build()/the Tier-2 path/
  // onFreshShortlist." Checked for existing coverage before adding this:
  // the build-and-Tier-2 halves are already separately pinned just above,
  // by "runs the Tier-2 rerank once a day and replays its ranking after
  // that" (`academicFetch`/`generateJsonText` each called exactly once
  // across two same-day calls); the onFreshShortlist half already has its
  // own dedicated pin in `pipeline.shadow.test.ts`'s "(d) cache hit: the
  // hook fires on the fresh build but never again on the cached read".
  // `onFreshShortlist` already exists on `FeedPipelineOptions` on disk
  // (pipeline.ts), so the hook half is exercised here, not skipped. What
  // was missing — and what this test adds — is a single assertion that
  // ties all three together as one claim about the SAME cache-hit read,
  // which is what B3 actually asks this file to pin: a second call, at
  // aiTier 2 so the build, Tier-2 rerank, AND shadow-hook paths are all
  // live at once, proving a cache hit is a true no-op on every one of
  // them, not just whichever one each pre-existing test happened to check.
  it("a cache-hit read invokes no build, no Tier-2 rerank, and no onFreshShortlist hook (P4-S8a regression pin)", async () => {
    const { academicFetch } = stubSources();
    const generateJsonText = vi.fn(async () =>
      JSON.stringify({
        orderedIds: ["openalex:daily-paper"],
        reasons: { "openalex:daily-paper": "a reason" },
      }),
    );
    vi.mocked(resolveProvider).mockReturnValue({
      generateJsonText,
    } as unknown as ReturnType<typeof resolveProvider>);

    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    const scope = createTrustedPaperCacheScope({
      ownerId: "owner-p4s8a-pin",
      project: "solid-state battery research",
      topics: request.topics,
      aiTier: 2,
    });
    const hookCalls: ReadonlyArray<ShadowCandidate>[] = [];
    const onFreshShortlist = (shortlist: ReadonlyArray<ShadowCandidate>) => {
      hookCalls.push(shortlist);
    };
    const tier2Request = { ...request, aiTier: 2 as const, paperCacheScope: scope };

    const first = await runFeedPipeline(tier2Request, { cache, now, onFreshShortlist });
    expect(first.items).not.toHaveLength(0);
    expect(academicFetch).toHaveBeenCalledTimes(1);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(hookCalls).toHaveLength(1);

    // Second call, same key (same owner/topics/day/aiTier) — a persisted
    // cache hit, not a fresh build. None of the three counters may move.
    const second = await runFeedPipeline(tier2Request, { cache, now, onFreshShortlist });
    expect(second.items).not.toHaveLength(0);
    expect(academicFetch).toHaveBeenCalledTimes(1);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(hookCalls).toHaveLength(1);
  });

  it("keeps a Tier-2 pool separate from a Tier-0 pool", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    await runFeedPipeline(
      {
        ...request,
        aiTier: 0 as const,
        paperCacheScope: createTrustedPaperCacheScope({
          ownerId: "owner-test",
          project: "solid-state battery research",
          topics: request.topics,
          aiTier: 0,
        }),
      },
      { cache, now },
    );
    await runFeedPipeline(
      {
        ...request,
        aiTier: 2 as const,
        paperCacheScope: createTrustedPaperCacheScope({
          ownerId: "owner-test",
          project: "solid-state battery research",
          topics: request.topics,
          aiTier: 2,
        }),
      },
      { cache, now },
    );

    // A Tier-2 pool carries an LLM ranking a Tier-0 pool does not have, so the
    // two cannot share one entry: whichever tier ran first would otherwise
    // decide the other's ordering for the rest of the day.
    expect(cache.values.size).toBe(2);
    expect(academicFetch).toHaveBeenCalledTimes(2);
  });
});
