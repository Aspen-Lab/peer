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
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";

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

afterEach(() => {
  bySourceId.openalex.fetch = originalAcademicFetch;
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

// The papers `web` source has no adapter any more (the Tavily one is deleted):
// a request naming it arms no fetch and no timeout for it at all.
describe("P0-02 — papers web source stays server-funded-disabled without a capability", () => {
  // `connectors` is what an old client could still put in the body as
  // `searchConnectors`; the request type has no such field now, hence the cast.
  async function run(connectors: Record<string, unknown> | undefined) {
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    withSourceTimeoutSpy.mockReset();
    await runFeedPipeline(
      {
        topics: ["molten salt"],
        sources: ["openalex" as const, "web" as const],
        aiTier: 0 as const,
        paperCacheScope: createTrustedPaperCacheScope({
          ownerId: "timeout-test-owner",
          topics: ["molten salt"],
          aiTier: 0,
        }),
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

  it("does not arm a server-funded web timeout from configured credentials", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const budgets = await run(undefined);
    expect(budgets.has("web")).toBe(false);
    // THE OVERRIDE IS PER-SOURCE, NEVER A GLOBAL DEFAULT CHANGE. Every other
    // paper source keeps the 8 s it has always had.
    expect(budgets.has("openalex")).toBe(true);
    expect(budgets.get("openalex")).toBeUndefined();
  });

  it("an old client's Tavily connector in the body changes nothing (legacy body value, ignored)", async () => {
    // THIS TEST ONCE ASSERTED THE OPPOSITE, and the change of premise is the
    // point: a Tavily key once selected a Tavily provider for this source and
    // kept it on the 8 s default. Tavily is removed — the request has no
    // `searchConnectors` and there is no web adapter — so a body that still
    // carries a Tavily connector must be indistinguishable from one that does
    // not.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const withTavily = await run({
      tavily: { enabled: true, apiKey: "test-key" },
    });
    const without = await run(undefined);
    expect([...withTavily.entries()]).toEqual([...without.entries()]);
    expect(withTavily.has("web")).toBe(false);
  });

  it("does not raise the wall when no Vertex project is configured", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    const budgets = await run(undefined);
    expect(budgets.has("web")).toBe(false);
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
    // The override is a property of the shared helper and stays covered even
    // though no paper source passes one any more (the 25 s it was raised to was
    // for the Gemini grounding adapter, which is deleted).
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const raced = withSourceTimeout("probe", never, 25_000).catch(
        (err: Error) => err.message,
      );
      await vi.advanceTimersByTimeAsync(25_001);
      await expect(raced).resolves.toContain("source-timeout after 25000ms");
    } finally {
      vi.useRealTimers();
    }
  });
});
