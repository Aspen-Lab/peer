import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { resolveProvider } from "@/lib/llm/providers/registry";
import { bySourceId, webSearch } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";

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

describe("daily paper pool", () => {
  it("serves the same papers all day without re-fetching a single source", async () => {
    const { academicFetch, searchFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const morning = await runFeedPipeline(request, { cache, now });
    const afternoon = await runFeedPipeline(request, { cache, now });

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

    await runFeedPipeline(request, { cache, now: new Date(2026, 6, 29, 9, 0) });
    await runFeedPipeline(request, { cache, now: new Date(2026, 6, 30, 9, 0) });

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
    const tier2Request = { ...request, aiTier: 2 as const };

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

  it("keeps a Tier-2 pool separate from a Tier-0 pool", async () => {
    const { academicFetch } = stubSources();
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    await runFeedPipeline({ ...request, aiTier: 0 as const }, { cache, now });
    await runFeedPipeline({ ...request, aiTier: 2 as const }, { cache, now });

    // A Tier-2 pool carries an LLM ranking a Tier-0 pool does not have, so the
    // two cannot share one entry: whichever tier ran first would otherwise
    // decide the other's ordering for the rest of the day.
    expect(cache.values.size).toBe(2);
    expect(academicFetch).toHaveBeenCalledTimes(2);
  });
});
