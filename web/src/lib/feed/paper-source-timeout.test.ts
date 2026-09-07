import { afterEach, describe, expect, it, vi } from "vitest";

// SUB-ITEM 8 / RULING 79c (round 29 C, item 6). The spy wraps the SHARED
// helper this pipeline now imports, so the assertion is on the real call site
// rather than on a re-derivation of its ternary.
const withSourceTimeoutSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/opportunities/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/opportunities/shared")>();
  return {
    ...actual,
    withSourceTimeout: (
      sourceId: string,
      promise: Promise<unknown>,
      timeoutMs?: number,
    ) => {
      withSourceTimeoutSpy(sourceId, timeoutMs);
      return actual.withSourceTimeout(sourceId, promise, timeoutMs);
    },
  };
});

import { runFeedPipeline } from "./pipeline";
import { withSourceTimeout } from "@/lib/opportunities/shared";
import { GEMINI_SOURCE_TIMEOUT_MS } from "@/lib/sources/gemini-search";
import { bySourceId, webSearch } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";

class MemoryPoolCache implements PoolCache {
  private readonly values = new Map<string, CachedPool>();

  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const paper: RawItem = {
  id: "openalex:timeout-probe",
  source: "openalex",
  title: "Molten Salt Electrochemistry Review",
  authors: ["A. Researcher"],
  abstract: "A review of molten salt electrochemistry.",
  url: "https://openalex.org/W999",
  publishedAt: "2026-07-20",
  venue: "Journal of Molten Salts",
  tags: ["molten salt"],
  metadata: {},
};

const originalAcademicFetch = bySourceId.openalex.fetch;
const originalWebFetch = webSearch.fetch;

afterEach(() => {
  bySourceId.openalex.fetch = originalAcademicFetch;
  webSearch.fetch = originalWebFetch;
  withSourceTimeoutSpy.mockReset();
  vi.unstubAllEnvs();
});

// ═══════════════════════════════════════════════════════════════════════════
// The paper pipeline's source wall. Round 29 B measured two paper-shaped
// grounded searches through the shipped adapter: 7541 ms (survives 8000) and
// 11832 ms (KILLED). The surface was not uniformly dead at 8 s — it was a coin
// flip, which is worse, because the report's contents then depend on grounding
// latency on the day with nothing telling the reader so.
//
// B also recorded that NO shipped test asserted the 8000 ms value at all, so
// the number could have changed silently in either direction. This file is
// that missing assertion as well as this item's.
// ═══════════════════════════════════════════════════════════════════════════

describe("RULING 79c — the papers web source gets the gemini budget", () => {
  async function run(connectors: Record<string, unknown> | undefined) {
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    webSearch.fetch = vi.fn(async () => []);
    withSourceTimeoutSpy.mockReset();
    await runFeedPipeline(
      {
        topics: ["molten salt"],
        sources: ["openalex" as const, "web" as const],
        aiTier: 0 as const,
        ...(connectors ? { searchConnectors: connectors } : {}),
      } as Parameters<typeof runFeedPipeline>[0],
      // A private cache per run. The daily pool would otherwise serve the
      // second call of a comparison from the first call's entry, and a
      // cache hit reaches no source at all — the assertion would pass by
      // measuring nothing.
      { now: new Date(2026, 7, 18, 9, 0), cache: new MemoryPoolCache() },
    );
    return new Map<string, number | undefined>(
      withSourceTimeoutSpy.mock.calls.map(
        (call) => [call[0] as string, call[1] as number | undefined],
      ),
    );
  }

  it("hands the web source 25 s on gemini and every other source the default", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const budgets = await run(undefined);
    expect(budgets.get("web")).toBe(GEMINI_SOURCE_TIMEOUT_MS);
    // THE OVERRIDE IS PER-SOURCE, NEVER A GLOBAL DEFAULT CHANGE. Every other
    // paper source keeps the 8 s it has always had, so the 25 s is only ever
    // paid when the web source is genuinely slow.
    expect(budgets.get("openalex")).toBeUndefined();
  });

  it("is unaffected by the Tavily connector, because papers never use it", async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the change of premise is the
    // point: a Tavily key once selected a Tavily provider for this source and
    // kept it on the 8 s default. The paper surface no longer spends the
    // user's Tavily quota anywhere, so an enabled connector must now be
    // indistinguishable from no connector at all.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const withTavily = await run({
      tavily: { enabled: true, apiKey: "test-key" },
    });
    const without = await run(undefined);
    expect([...withTavily.entries()]).toEqual([...without.entries()]);
    expect(withTavily.get("web")).toBe(GEMINI_SOURCE_TIMEOUT_MS);
  });

  it("does not raise the wall when no Vertex project is configured", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    const budgets = await run(undefined);
    expect(budgets.get("web")).toBeUndefined();
  });
});

describe("the shared source wall itself — the value B found untested", () => {
  it("defaults to 8000 ms", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const raced = withSourceTimeout("probe", never).catch((err: Error) => err.message);
      await vi.advanceTimersByTimeAsync(7999);
      let settled: string | undefined;
      void raced.then((value) => {
        settled = value;
      });
      await Promise.resolve();
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2);
      await expect(raced).resolves.toContain("source-timeout after 8000ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours the override, which the deleted private copy could not do", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const raced = withSourceTimeout("probe", never, GEMINI_SOURCE_TIMEOUT_MS).catch(
        (err: Error) => err.message,
      );
      await vi.advanceTimersByTimeAsync(GEMINI_SOURCE_TIMEOUT_MS + 1);
      await expect(raced).resolves.toContain("source-timeout after 25000ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the inner adapter budget UNDER the outer wall", async () => {
    // The two numbers disagreed by 2.6x before this item: the adapter was built
    // to spend up to 21 s inside a source the papers pipeline killed at 8 s.
    const { default: gemini } = { default: await import("@/lib/sources/gemini-search") };
    expect(gemini.GEMINI_SOURCE_TIMEOUT_MS).toBe(25_000);
    expect(gemini.geminiSearchDeadline(0)).toBeLessThan(gemini.GEMINI_SOURCE_TIMEOUT_MS);
  });
});
