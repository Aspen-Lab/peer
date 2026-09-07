import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDailyEventPool } from "@/lib/events/pipeline";
import { eventSources } from "@/lib/events/sources";
import { eventweb } from "@/lib/events/sources/eventweb";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import { buildDailyJobPool } from "@/lib/jobs/pipeline";
import { jobSources } from "@/lib/jobs/sources";
import { jobweb } from "@/lib/jobs/sources/jobweb";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import {
  EVENT_QUERY_BUDGET,
  JOB_QUERY_BUDGET,
} from "./query-budget";
import type { CachedPool, PoolCache } from "./pool-cache";

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();

  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const originalEventSources = [...eventSources];
const originalJobSources = [...jobSources];
const originalAcademicFetch = bySourceId.openalex.fetch;

const academicPaper: RawItem = {
  id: "openalex:daily-budget-paper",
  source: "openalex",
  title: "Battery Materials for Durable Solid-State Electrolytes",
  authors: ["A. Researcher"],
  abstract: "Battery materials and solid-state electrolyte research.",
  url: "https://openalex.org/W456",
  publishedAt: "2026-07-20",
  metadata: {},
};

afterEach(() => {
  eventSources.splice(0, eventSources.length, ...originalEventSources);
  jobSources.splice(0, jobSources.length, ...originalJobSources);
  bySourceId.openalex.fetch = originalAcademicFetch;
  vi.unstubAllGlobals();
});

describe("combined daily search budget", () => {
  it("stays within 16 Events + 12 Jobs + 0 Papers for repeated daily builds", async () => {
    const searchFetch = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", searchFetch);
    eventSources.splice(0, eventSources.length, eventweb);
    jobSources.splice(0, jobSources.length, jobweb);
    const academicFetch = vi.fn(async () => [academicPaper]);
    bySourceId.openalex.fetch = academicFetch;

    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 10, 0);
    const searchConnectors = {
      tavily: { enabled: true, apiKey: "test-key" },
    };
    const topics = [
      "solid-state battery",
      ...Array.from({ length: 19 }, (_, index) => `research topic ${index}`),
    ];
    const eventRequest = {
      topics,
      aiTier: 0 as const,
      searchConnectors,
    };
    const jobRequest = {
      topics,
      locationPreferences: [],
      aiTier: 0 as const,
      searchConnectors,
    };
    const paperRequest = {
      topics,
      sources: ["openalex" as const],
      aiTier: 1 as const,
      searchConnectors,
    };

    await buildDailyEventPool(eventRequest, { cache, now });
    const eventSearches = searchFetch.mock.calls.length;
    await buildDailyJobPool(jobRequest, { cache, now });
    const jobSearches = searchFetch.mock.calls.length - eventSearches;
    await runFeedPipeline(paperRequest, { cache, now });
    const paperSearches =
      searchFetch.mock.calls.length - eventSearches - jobSearches;
    const firstDaySearches = searchFetch.mock.calls.length;

    expect(eventSearches).toBe(EVENT_QUERY_BUDGET);
    expect(jobSearches).toBe(JOB_QUERY_BUDGET);
    // ZERO, with a Tavily key in the request. This used to be 4: a discovery
    // side-channel bought them daily to compute query boosts that nothing fed
    // back into the search and a stats field that nothing displayed. Papers
    // come from the free academic sources and cost no search quota at all.
    expect(paperSearches).toBe(0);
    expect(firstDaySearches).toBe(28);

    await buildDailyEventPool(eventRequest, { cache, now });
    await buildDailyJobPool(jobRequest, { cache, now });
    await runFeedPipeline(paperRequest, { cache, now });

    expect(searchFetch).toHaveBeenCalledTimes(firstDaySearches);
    // ONE academic fetch across both paper builds. This assertion used to read
    // `2`: the papers entry cached only the discovery side-channel, so every
    // request re-fetched every academic source and, at Tier 2, re-ran the LLM
    // rerank. The papers pool now holds the candidates themselves, so a second
    // read the same day costs nothing at all.
    expect(academicFetch).toHaveBeenCalledTimes(1);
  });
});
