import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { resolveProvider } from "@/lib/llm/providers/registry";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPaperPool, CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { captureConsole } from "@/test-support/console-capture";
import type { ScreenCandidate, ScreenResult, ScreenSummary } from "@/lib/decisions/screen";
import type { DecisionAnswer, DecisionResult } from "@/lib/decisions/types";

// Jev on the reader's own key, as the paper pipeline sees it. The route hands
// the pipeline a `jevScreen` function (a closure that holds the key and the
// owner; the pipeline never sees either). On a FRESH pool build the pipeline
// calls it with the top-50 shortlist, orders the shortlist by the answers it
// gets back (demote, never drop; Jev's order is used only when at least 60 % of
// the shortlist was answered), and writes that order into the cached pool's
// `aiOrder` slot, where the read path replays it for free. With no `jevScreen`
// the pipeline is exactly what it was before Jev existed.
//
// This file replaced `pipeline.shadow.test.ts`, which proved the old
// fire-and-forget hook could not change the feed. The "cannot change the feed"
// property is now "with no key, nothing changes"; the new property is "with a
// key, the order does".

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
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

// An invented string. It is not, and never was, a key.
const SENTINEL_KEY = "jev-pipeline-test-sentinel-not-a-key-0000";

const originalOpenalexFetch = bySourceId.openalex.fetch;

// Titles carry the request topic so the pre-existing literal-keyword
// admission gate (an unrelated concern) never drops these fixtures.
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

function scopeFor(ownerId: string, aiTier: 0 | 2 = 0) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier,
  });
}

function baseReq(ownerId: string, aiTier: 0 | 2 = 0) {
  return {
    topics: ["solid-state battery"],
    sources: ["openalex" as const],
    aiTier,
    paperCacheScope: scopeFor(ownerId, aiTier),
  };
}

// Frozen so `meta.latencyMs` reads deterministically across every call in this
// file — otherwise a byte-identical deep-equal between two independent builds
// would be flaky by construction.
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
  vi.mocked(resolveProvider).mockReset();
  vi.mocked(resolveProvider).mockReturnValue(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── fixtures for the screen function ────────────────────────────────────────

function answer(partial: Partial<DecisionAnswer> & Pick<DecisionAnswer, "questionId" | "kind" | "value">): DecisionAnswer {
  return { confidence: 0.9, unknown: false, ...partial };
}

function strongDecision(id: string): DecisionResult {
  return {
    paperId: id,
    answers: [
      answer({ questionId: "core_vs_background", kind: "choice", value: "core" }),
      answer({ questionId: "project_help", kind: "score", value: 3 }),
    ],
    usage: null,
    modelId: "jev-1.13.0",
  };
}

function weakDecision(id: string): DecisionResult {
  return {
    paperId: id,
    answers: [
      answer({ questionId: "core_vs_background", kind: "choice", value: "core" }),
      answer({ questionId: "project_help", kind: "score", value: 0 }),
    ],
    usage: null,
    modelId: "jev-1.13.0",
  };
}

function wrongSenseDecision(id: string): DecisionResult {
  return {
    paperId: id,
    answers: [
      answer({ questionId: "sense_match", kind: "choice", value: "different_sense", confidence: 0.95 }),
      answer({ questionId: "project_help", kind: "score", value: 3 }),
    ],
    usage: null,
    modelId: "jev-1.13.0",
  };
}

function emptySummary(overrides: Partial<ScreenSummary> = {}): ScreenSummary {
  return {
    totalCandidates: 5,
    attempted: 5,
    cacheHits: 0,
    byStatus: {},
    deadlineExceeded: false,
    rejected: false,
    throttled: false,
    ...overrides,
  };
}

/** A screen function that answers with fixed decisions and records what it was asked. */
function fakeScreen(decisions: DecisionResult[], summary: Partial<ScreenSummary> = {}) {
  const calls: ReadonlyArray<ScreenCandidate>[] = [];
  const screen = vi.fn(async (candidates: ReadonlyArray<ScreenCandidate>): Promise<ScreenResult> => {
    calls.push(candidates);
    return {
      decisions: new Map(decisions.map((d) => [d.paperId, d])),
      summary: emptySummary({ totalCandidates: candidates.length, ...summary }),
    };
  });
  return { screen, calls };
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);
const baselineOrder = fixtureItems(5).map((i) => i.id);

function onlyPool(cache: MemoryPoolCache): CachedPaperPool {
  const pools = [...cache.values.values()] as CachedPaperPool[];
  expect(pools).toHaveLength(1);
  return pools[0];
}

describe("pipeline.ts — no Jev key: nothing changes", () => {
  it("with no jevScreen the feed is the normal fresh-build result, and the pool carries no Jev field", async () => {
    const cache = new MemoryPoolCache();
    const result = await runFeedPipeline(baseReq("owner-none"), { cache, now: FIXED_NOW });

    expect(ids(result.items)).toEqual(baselineOrder);
    expect(result.meta).not.toHaveProperty("jevScreening");
    expect(onlyPool(cache)).not.toHaveProperty("jev");
    expect(onlyPool(cache).aiOrder).toEqual([]);
  });

  it("jevScreen: undefined is the same as leaving it out: identical response and identical cache key", async () => {
    const cacheA = new MemoryPoolCache();
    const cacheB = new MemoryPoolCache();
    const a = await runFeedPipeline(baseReq("owner-undef"), { cache: cacheA, now: FIXED_NOW });
    const b = await runFeedPipeline(baseReq("owner-undef"), { cache: cacheB, now: FIXED_NOW, jevScreen: undefined });

    expect(b).toEqual(a);
    expect([...cacheB.values.keys()]).toEqual([...cacheA.values.keys()]);
  });
});

describe("pipeline.ts — a Jev key: Jev's order reaches the reader's papers", () => {
  it("asks Jev about the shortlist in local rank order, and only on a fresh build", async () => {
    const { screen, calls } = fakeScreen(fixtureItems(5).map((i) => strongDecision(i.id)));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(baseReq("owner-ask"), { cache, now: FIXED_NOW, jevScreen: screen });

    expect(screen).toHaveBeenCalledTimes(1);
    expect(calls[0].map((c) => c.id)).toEqual(baselineOrder);
    expect(Object.keys(calls[0][0]).sort()).toEqual(["abstract", "id", "title", "venue"]);
  });

  it("a strong match is lifted above a locally higher paper, and the order lands in the cached pool's aiOrder", async () => {
    // Everyone is weakly helpful except p3, which Jev finds directly helpful.
    const decisions = fixtureItems(5).map((i) => (i.id === "openalex:p3" ? strongDecision(i.id) : weakDecision(i.id)));
    const { screen } = fakeScreen(decisions);
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(baseReq("owner-order"), { cache, now: FIXED_NOW, jevScreen: screen });

    // Local order is p0 p1 p2 p3 p4. Jev lifts p3 above p1 and p2.
    expect(ids(result.items)).toEqual(["openalex:p0", "openalex:p3", "openalex:p1", "openalex:p2", "openalex:p4"]);
    expect(onlyPool(cache).aiOrder).toEqual(["openalex:p0", "openalex:p3", "openalex:p1", "openalex:p2", "openalex:p4"]);
    expect(result.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
  });

  it("a confident wrong-sense answer demotes the paper to the back; it is never dropped", async () => {
    const decisions = [
      wrongSenseDecision("openalex:p0"),
      ...["p1", "p2", "p3", "p4"].map((p) => strongDecision(`openalex:${p}`)),
    ];
    const { screen } = fakeScreen(decisions);

    const result = await runFeedPipeline(baseReq("owner-demote"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: screen,
    });

    expect(result.items).toHaveLength(5); // demote, never drop
    expect(result.items.at(-1)?.id).toBe("openalex:p0");
    expect(ids(result.items).slice(0, 4)).toEqual(["openalex:p1", "openalex:p2", "openalex:p3", "openalex:p4"]);
  });

  it("an unknown answer is neutral: when Jev knows nothing about any paper the order is the local one", async () => {
    const unknown = (id: string): DecisionResult => ({
      paperId: id,
      answers: [
        answer({ questionId: "core_vs_background", kind: "choice", value: "background", confidence: 0.2, unknown: true }),
        answer({ questionId: "project_help", kind: "score", value: 0, confidence: 0.2, unknown: true }),
      ],
      usage: null,
      modelId: "jev-1.13.0",
    });
    const { screen } = fakeScreen(fixtureItems(5).map((i) => unknown(i.id)));

    const result = await runFeedPipeline(baseReq("owner-unknown"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: screen,
    });

    expect(ids(result.items)).toEqual(baselineOrder);
  });

  it("Jev's order is used only when it answered at least 60 % of the shortlist", async () => {
    // 2 of 5 answered (40 %): the strong answer for p4 must NOT lift it.
    const below = fakeScreen([strongDecision("openalex:p4"), weakDecision("openalex:p0")]);
    const belowResult = await runFeedPipeline(baseReq("owner-below"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: below.screen,
    });
    expect(ids(belowResult.items)).toEqual(baselineOrder);
    expect(belowResult.meta.jevScreening).toEqual({ status: "unavailable", screened: 2, of: 5 });

    // 3 of 5 answered (60 %): Jev's order is used, and it is called partial.
    const atThreshold = fakeScreen([
      strongDecision("openalex:p4"),
      weakDecision("openalex:p0"),
      weakDecision("openalex:p1"),
    ]);
    const atResult = await runFeedPipeline(baseReq("owner-at"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: atThreshold.screen,
    });
    expect(atResult.meta.jevScreening).toEqual({ status: "partial", screened: 3, of: 5 });
    expect(ids(atResult.items)).not.toEqual(baselineOrder);
  });

  it("the Jev pool is its own pool: a reader without the key builds their own, and the two never mix", async () => {
    const { screen } = fakeScreen(fixtureItems(5).map((i) => (i.id === "openalex:p3" ? strongDecision(i.id) : weakDecision(i.id))));
    const cache = new MemoryPoolCache();

    await runFeedPipeline(baseReq("owner-split"), { cache, now: FIXED_NOW, jevScreen: screen });
    expect(cache.values.size).toBe(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);

    // Same reader, same day, key removed: a different pool key, so a fresh build.
    const without = await runFeedPipeline(baseReq("owner-split"), { cache, now: FIXED_NOW });
    expect(cache.values.size).toBe(2);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);
    expect(ids(without.items)).toEqual(baselineOrder);
    expect(without.meta).not.toHaveProperty("jevScreening");
  });
});

describe("pipeline.ts — a cache hit replays Jev's order for free", () => {
  it("the second same-day read makes no Jev call and no source fetch, returns the same order, and still reports what Jev did", async () => {
    const decisions = fixtureItems(5).map((i) => (i.id === "openalex:p3" ? strongDecision(i.id) : weakDecision(i.id)));
    const { screen } = fakeScreen(decisions);
    const cache = new MemoryPoolCache();

    const first = await runFeedPipeline(baseReq("owner-hit"), { cache, now: FIXED_NOW, jevScreen: screen });
    expect(screen).toHaveBeenCalledTimes(1);

    const second = await runFeedPipeline(baseReq("owner-hit"), { cache, now: FIXED_NOW, jevScreen: screen });

    expect(screen).toHaveBeenCalledTimes(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    expect(ids(second.items)).toEqual(ids(first.items));
    expect(second.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
  });
});

describe("pipeline.ts — Jev fails: the reader gets the keyless briefing", () => {
  it("a screen that throws changes nothing about the papers and reports unavailable", async () => {
    const baseline = await runFeedPipeline(baseReq("owner-throw-baseline"), { cache: new MemoryPoolCache(), now: FIXED_NOW });

    const call = runFeedPipeline(baseReq("owner-throw"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: async () => {
        throw new Error("boom from the Jev screen");
      },
    });
    await expect(call).resolves.toBeDefined();
    const result = await call;

    expect(ids(result.items)).toEqual(ids(baseline.items));
    expect(result.meta.jevScreening).toEqual({ status: "unavailable", screened: 0, of: 5 });
  });

  it("every call failed: unavailable, local order, and the pool is still cached for the day (a down Jev does not force a rebuild per page load)", async () => {
    const { screen } = fakeScreen([], { attempted: 5, byStatus: { network_error: 5 } });
    const cache = new MemoryPoolCache();

    const first = await runFeedPipeline(baseReq("owner-down"), { cache, now: FIXED_NOW, jevScreen: screen });
    expect(ids(first.items)).toEqual(baselineOrder);
    expect(first.meta.jevScreening).toEqual({ status: "unavailable", screened: 0, of: 5 });
    expect(cache.values.size).toBe(1);

    await runFeedPipeline(baseReq("owner-down"), { cache, now: FIXED_NOW, jevScreen: screen });
    expect(screen).toHaveBeenCalledTimes(1);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
  });

  it("a rejected key: local order, status rejected, and the pool is NOT cached, so a corrected key works on the next load", async () => {
    const rejected = fakeScreen([], { rejected: true, attempted: 1, byStatus: { unauthorized: 1 } });
    const cache = new MemoryPoolCache();

    const first = await runFeedPipeline(baseReq("owner-rejected"), { cache, now: FIXED_NOW, jevScreen: rejected.screen });
    expect(ids(first.items)).toEqual(baselineOrder);
    expect(first.meta.jevScreening).toEqual({ status: "rejected", screened: 0, of: 5 });
    expect(cache.values.size).toBe(0);

    // The reader pastes a working key: the next load asks Jev again.
    const working = fakeScreen(fixtureItems(5).map((i) => (i.id === "openalex:p3" ? strongDecision(i.id) : weakDecision(i.id))));
    const second = await runFeedPipeline(baseReq("owner-rejected"), { cache, now: FIXED_NOW, jevScreen: working.screen });
    expect(working.screen).toHaveBeenCalledTimes(1);
    expect(second.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
    expect(cache.values.size).toBe(1);
  });

  it("an empty shortlist never calls Jev and reports nothing", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const { screen } = fakeScreen([]);

    const result = await runFeedPipeline(baseReq("owner-empty"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: screen,
    });

    expect(result.items).toEqual([]);
    expect(screen).not.toHaveBeenCalled();
    expect(result.meta).not.toHaveProperty("jevScreening");
  });
});

describe("pipeline.ts — both keys: Jev owns the order, the model key writes the reasons", () => {
  function modelProvider(orderedIds: string[], reasons: Record<string, string>) {
    const generateJsonText = vi.fn(async () => JSON.stringify({ orderedIds, reasons }));
    vi.mocked(resolveProvider).mockReturnValue({ generateJsonText } as unknown as ReturnType<typeof resolveProvider>);
    return generateJsonText;
  }

  it("keeps Jev's order and the model's reasons", async () => {
    const decisions = fixtureItems(5).map((i) => (i.id === "openalex:p3" ? strongDecision(i.id) : weakDecision(i.id)));
    const { screen } = fakeScreen(decisions);
    // The model would put p4 first; Jev's order must win.
    const generateJsonText = modelProvider(
      ["openalex:p4", "openalex:p3", "openalex:p2", "openalex:p1", "openalex:p0"],
      { "openalex:p3": "a reason written by the model key" },
    );
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(baseReq("owner-both", 2), { cache, now: FIXED_NOW, jevScreen: screen });

    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(ids(result.items)).toEqual(["openalex:p0", "openalex:p3", "openalex:p1", "openalex:p2", "openalex:p4"]);
    expect(result.items.find((i) => i.id === "openalex:p3")?.relevanceReason).toBe("a reason written by the model key");
    expect(onlyPool(cache).aiOrder).toEqual(["openalex:p0", "openalex:p3", "openalex:p1", "openalex:p2", "openalex:p4"]);
  });

  it("when Jev was unavailable, the model key's own order stands (no regression for a reader with both keys)", async () => {
    const { screen } = fakeScreen([], { attempted: 5, byStatus: { network_error: 5 } });
    modelProvider(["openalex:p4", "openalex:p3", "openalex:p2", "openalex:p1", "openalex:p0"], {});

    const result = await runFeedPipeline(baseReq("owner-both-down", 2), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: screen,
    });

    expect(ids(result.items)).toEqual(["openalex:p4", "openalex:p3", "openalex:p2", "openalex:p1", "openalex:p0"]);
  });

  it("with a model key and no Jev key the pipeline is exactly the model's (the Jev change adds nothing)", async () => {
    modelProvider(["openalex:p4", "openalex:p3", "openalex:p2", "openalex:p1", "openalex:p0"], {});
    const cache = new MemoryPoolCache();

    const result = await runFeedPipeline(baseReq("owner-model-only", 2), { cache, now: FIXED_NOW });

    expect(ids(result.items)).toEqual(["openalex:p4", "openalex:p3", "openalex:p2", "openalex:p1", "openalex:p0"]);
    expect(onlyPool(cache)).not.toHaveProperty("jev");
  });
});

describe("pipeline.ts — the shortlist and what the pool keeps", () => {
  it("hands Jev at most 50 candidates", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(60));
    const { screen, calls } = fakeScreen([]);

    await runFeedPipeline({ ...baseReq("owner-cap"), topN: 60 }, { cache: new MemoryPoolCache(), now: FIXED_NOW, jevScreen: screen });

    expect(calls).toHaveLength(1);
    expect(calls[0].length).toBeLessThanOrEqual(50);
  });

  it("mutating what Jev was handed cannot change the built pool", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(8));
    const baseline = await runFeedPipeline(baseReq("owner-mutate-baseline"), { cache: new MemoryPoolCache(), now: FIXED_NOW });

    const result = await runFeedPipeline(baseReq("owner-mutate"), {
      cache: new MemoryPoolCache(),
      now: FIXED_NOW,
      jevScreen: async (candidates) => {
        (candidates as ScreenCandidate[]).forEach((c) => {
          c.title = "MUTATED";
        });
        (candidates as ScreenCandidate[]).push({ id: "injected", title: "should never appear", abstract: null });
        return { decisions: new Map(), summary: emptySummary() };
      },
    });

    expect(result.items.every((item) => item.title !== "MUTATED")).toBe(true);
    expect(result.items.some((item) => item.id === "injected")).toBe(false);
    expect(ids(result.items)).toEqual(ids(baseline.items));
  });
});

describe("pipeline.ts — the key never reaches the pool, the response or the log", () => {
  it("a screen closure that holds a key leaves it in neither the cached pool nor the response nor any log line", async () => {
    const consoleText = captureConsole(); // log, info, debug, warn and error
    // The closure captures the sentinel the way the route's closure captures the reader's key.
    const apiKey = SENTINEL_KEY;
    const screen = async (candidates: ReadonlyArray<ScreenCandidate>): Promise<ScreenResult> => {
      if (!apiKey) throw new Error("no key");
      return {
        decisions: new Map(candidates.map((c) => [c.id, strongDecision(c.id)])),
        summary: emptySummary({ totalCandidates: candidates.length, byStatus: { ok: candidates.length } }),
      };
    };
    const cache = new MemoryPoolCache();

    let result: Awaited<ReturnType<typeof runFeedPipeline>>;
    try {
      result = await runFeedPipeline(baseReq("owner-leak"), { cache, now: FIXED_NOW, jevScreen: screen });
    } finally {
      consoleText.restore();
    }

    expect(JSON.stringify(result)).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify([...cache.values])).not.toContain(SENTINEL_KEY);
    expect(consoleText.text()).not.toContain(SENTINEL_KEY);
    expect([...cache.values.keys()].join(" ")).not.toContain(SENTINEL_KEY);
  });

  it("FeedRequest has no field for a Jev key, so no request-shaped value can carry one into a cache key", () => {
    const types = readFileSync(path.join(process.cwd(), "src/lib/feed/types.ts"), "utf8");
    expect(types).not.toMatch(/jevApiKey/);
    const pipelineSource = readFileSync(path.join(process.cwd(), "src/lib/feed/pipeline.ts"), "utf8");
    expect(pipelineSource).not.toMatch(/jevApiKey/);
  });
});
