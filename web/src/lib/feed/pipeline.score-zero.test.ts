import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// SCORE-ZERO (ABC-JEV-INTEGRATION.md §1at, docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md).
// End-to-end regression net through the real, exported `runFeedPipeline` —
// the only way to exercise `pipeline.ts`'s own (private) `scorePaperCandidates`
// wiring, which is exactly where the bug lived (it fed combine.ts's harsh
// ×0.15 `negativePenalty` from the system's default "avoid reviews/surveys"
// words instead of the reader's own declared dislikes, stacking with
// rerank.ts's separate review demotion and occasionally flooring a shown,
// on-topic item's score at exactly 0). Same harness as
// pipeline.shadow.test.ts / pipeline.rrf.test.ts (MemoryPoolCache, a mocked
// `bySourceId.openalex.fetch`, fake timers).
//
// The 3 real OpenAlex ids below (W7213911724 / W7209401474 / W7214083402)
// and the "electrolyte" subject are the only concrete facts the
// investigation's guide preserved (a pre-rerank score table and a card
// caption quoting "Matches your interest in electrolyte") — the real
// title/abstract text was not saved by that investigation and no longer
// exists on disk (checked: neither this session's nor the investigating
// session's scratchpad directory has it). These fixtures use the shortest
// text that is faithful to those real, quoted facts (the ids, the subject,
// genuinely review/overview/survey-shaped wording) rather than inventing
// realistic-looking paper prose.
//
// The second `it()` below was rewritten in the fix round after A's
// FAILED_REVIEW (docs/jev-abc/SCORE-ZERO-A-20260929T015211Z.md Check 2) —
// see its own comment for why.

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
const FIXED_NOW = new Date(2026, 8, 28, 9, 0);
const RECENT = "2026-09-24";

const TOPIC = "battery electrolyte transport";
// Strong direct overlap with the 3 review-shaped items below, so they
// survive combine.ts's separate `shouldPushReviewPaper` leniency filter
// (an unrelated, pre-existing mechanism this file does not exercise) —
// matches how the guide's own live 3 items survived into their 9-item pool.
const PROJECT = "Battery electrolyte transport review study";

function openalexItem(id: string, title: string, abstract: string): RawItem {
  return {
    id,
    source: "openalex",
    title,
    authors: ["Researcher"],
    abstract,
    url: `https://example.org/${id}`,
    publishedAt: RECENT,
    venue: "Journal of Testing",
    metadata: {},
  };
}

function realGuideItems(): RawItem[] {
  return [
    openalexItem(
      "openalex:W7213911724",
      "A Review of Battery Electrolyte Transport Mechanisms",
      "This review covers battery electrolyte transport phenomena in depth.",
    ),
    openalexItem(
      "openalex:W7209401474",
      "An Overview Of Electrolyte Transport In Battery Cells",
      "This overview surveys electrolyte transport behavior in battery systems.",
    ),
    openalexItem(
      "openalex:W7214083402",
      "A Survey Of Battery Electrolyte Transport Studies",
      "This survey summarizes battery electrolyte transport research to date.",
    ),
  ];
}

// Deliberately near-identical in structure/keyword density to the first
// "real" item above (same word count, same topic words repeated the same
// number of times) — only "review" → "study" changes — so the comparison
// below isolates the review-related demotion rather than an unrelated
// difference in how strongly each item matches the topic.
function nonReviewControl(): RawItem {
  return openalexItem(
    "openalex:control-nonreview",
    "A Study Of Battery Electrolyte Transport Mechanisms",
    "This study covers battery electrolyte transport phenomena in depth.",
  );
}

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: PROJECT,
    topics: [TOPIC],
    aiTier: 0,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetCounterStoreForTests();
});

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runFeedPipeline — SCORE-ZERO", () => {
  it("the 3 real guide items get a nonzero final score and rank below a comparable non-review item", async () => {
    const items = [...realGuideItems(), nonReviewControl()];
    bySourceId.openalex.fetch = vi.fn(async () => items);

    const result = await runFeedPipeline(
      {
        topics: [TOPIC],
        project: PROJECT,
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-guide-items"),
      },
      { cache: new MemoryPoolCache(), now: FIXED_NOW },
    );

    const byId = new Map(result.items.map((i) => [i.id, i]));
    const control = byId.get("openalex:control-nonreview");
    expect(control).toBeDefined();

    for (const guideId of [
      "openalex:W7213911724",
      "openalex:W7209401474",
      "openalex:W7214083402",
    ]) {
      const scored = byId.get(guideId);
      expect(scored).toBeDefined();
      // MUTATION CHECK (SCORE-ZERO): removing rerank.ts's floor reproduces
      // the live bug — this item lands on exactly 0 instead.
      expect(scored!.score).toBeGreaterThan(0);
      expect(scored!.score).toBeLessThan(control!.score);
    }

    // Ranking: the non-review control leads; all 3 review-shaped items sink
    // below it (still shown — not evicted — per ruling 3, "demotion is a
    // ranking preference, not a relevance verdict").
    const order = result.items.map((i) => i.id);
    const controlRank = order.indexOf("openalex:control-nonreview");
    for (const guideId of [
      "openalex:W7213911724",
      "openalex:W7209401474",
      "openalex:W7214083402",
    ]) {
      expect(order.indexOf(guideId)).toBeGreaterThan(controlRank);
    }
  });

  // FIX ROUND (manager, after A's FAILED_REVIEW —
  // docs/jev-abc/SCORE-ZERO-A-20260929T015211Z.md Check 2 / HIGH finding;
  // CORRECTION under ABC-JEV-INTEGRATION.md §1at). This test used to send
  // `negativeTopics` WITHOUT a matching `intent.exclusions` and assert a
  // demotion ratio — a request shape A proved no real caller ever produces
  // (every one of the 4 real callers sets both together, from the same
  // source: `intent.exclusions.map(e => e.value)`). In the REAL shape,
  // `combine.ts`'s pre-existing hard `profile.exclusions` filter (fed from
  // `intent.exclusions`, untouched by this item) drops the item before
  // `negativePenalty` ever runs — so the correct, honest claim is that the
  // paper is ABSENT, not "demoted". `negativePenalty`'s own ×0.15 math is
  // still covered, at the unit level, by negative-penalty.test.ts.
  const DISLIKE_TERM = "grain boundary impurities";

  function dislikeTargetItem(): RawItem {
    return openalexItem(
      "openalex:dislike-target",
      "Grain Boundary Impurities In Battery Electrolyte Transport",
      "We study grain boundary impurities affecting battery electrolyte transport.",
    );
  }

  // The shape every real caller sends (api/feed/route.ts, api/jobs/
  // dispatch-digests/route.ts, api/test-digest/route.ts,
  // dashboard/prepare-pool.ts — all traced by A's review): `negativeTopics`
  // AND `intent.exclusions` set together, from the same term.
  function realCallerShapedRequest(ownerId: string, disliked: boolean) {
    return {
      topics: [TOPIC],
      sources: ["openalex" as const],
      aiTier: 0 as const,
      paperCacheScope: scopeFor(ownerId),
      ...(disliked
        ? {
            negativeTopics: [DISLIKE_TERM],
            intent: {
              version: "feed-intent-v1" as const,
              project: { presence: "omitted" as const },
              challenge: { presence: "omitted" as const },
              requiredConcepts: [TOPIC],
              preferredConcepts: [],
              exclusions: [{ kind: "exclude-term" as const, value: DISLIKE_TERM }],
              methods: [],
              selectedSenseConcepts: [],
            },
          }
        : {}),
    };
  }

  it("a reader's own declared dislike, in the request shape every real caller sends, removes the paper entirely", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [dislikeTargetItem()]);

    const undisliked = await runFeedPipeline(
      realCallerShapedRequest("owner-undisliked", false),
      { cache: new MemoryPoolCache(), now: FIXED_NOW },
    );
    const disliked = await runFeedPipeline(
      realCallerShapedRequest("owner-disliked", true),
      { cache: new MemoryPoolCache(), now: FIXED_NOW },
    );

    // Sanity: without the dislike, the item is a normal, shown, positive-
    // scoring match — proves its absence below is caused by the declared
    // dislike, not some unrelated admission failure.
    const undislikedMatch = undisliked.items.find((i) => i.id === "openalex:dislike-target");
    expect(undislikedMatch).toBeDefined();
    expect(undislikedMatch!.score).toBeGreaterThan(0);

    // MUTATION CHECK (SCORE-ZERO fix round, hash-verified in the
    // checkpoint's Fix round section): dropping `intent.exclusions` from
    // the disliked request — the shape this test used before the fix round
    // — makes the item reappear and turns this red.
    expect(disliked.items.some((i) => i.id === "openalex:dislike-target")).toBe(false);
  });
});
