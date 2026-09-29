import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";

// SCORE-ZERO (ABC-JEV-INTEGRATION.md §1at ruling 2,
// docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md). `negativePenalty`
// (combine.ts) is meant for a reader's OWN declared dislikes, a harsh ×0.15
// cut — not the softer ×0.65 `legacyDislikePenalty` gets. Before this fix,
// `web/src/lib/feed/pipeline.ts` fed it the system's own default
// "avoid reviews/surveys" words instead of (or as well as) genuine reader
// dislikes, so every review-shaped paper took a second, uncoordinated review
// penalty stacked on top of `rerank.ts`'s purpose-built one — see
// pipeline.score-zero.test.ts for that wiring-level regression net. This
// file locks down `negativePenalty`'s own contract in isolation, independent
// of wiring: it fires exactly and only on a `profile.negativeTopics` text
// match, at exactly ×0.15, regardless of whether the matched item happens to
// look like a review.
//
// UNIT-LEVEL ONLY — not a claim about production behavior for reader
// dislikes. FIX ROUND (manager, after A's FAILED_REVIEW,
// docs/jev-abc/SCORE-ZERO-A-20260929T015211Z.md Check 2 / HIGH finding):
// in every real request, the reader's own declared dislike terms ALSO reach
// `profile.exclusions` (`combine.ts:195`), a hard drop that runs FIRST,
// through the exact same text-match function this file exercises — so in
// production a paper a reader's dislike matches is removed from the pool
// entirely, and `negativePenalty`'s ×0.15 never gets the chance to run on
// it. This file still calls `scoreItems` directly with `profile.negativeTopics`
// set by hand (bypassing `pipeline.ts`'s request-shape wiring and the
// exclusion filter both), so `negativePenalty`'s own math stays covered
// should that channel ever become reachable, or be reused elsewhere — see
// `pipeline.score-zero.test.ts` for the real, end-to-end behavior (the
// paper is absent, not demoted).
const now = Date.parse("2026-09-28T00:00:00Z");

function paper(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "p1",
    source: "openalex",
    title: "Battery electrolyte transport with cobalt sourcing concerns",
    authors: [],
    abstract:
      "A study of battery electrolyte transport mechanisms, including cobalt sourcing.",
    url: "https://example.test/p1",
    publishedAt: "2026-09-20",
    metadata: {},
    ...overrides,
  };
}

const TOPIC = "battery electrolyte transport";

function scoreAlone(negativeTopics: string[]) {
  const [scored] = scoreItems(
    [paper()],
    { topics: [TOPIC], negativeTopics },
    undefined,
    now,
  );
  return scored;
}

describe("negativePenalty — SCORE-ZERO", () => {
  it("cuts an item matching the reader's own declared dislike to exactly 0.15x its undisliked score", () => {
    const undisliked = scoreAlone([]);
    const disliked = scoreAlone(["cobalt sourcing"]);

    expect(undisliked.score).toBeGreaterThan(0);
    expect(disliked.score).toBeGreaterThan(0);
    // MUTATION CHECK (SCORE-ZERO): weakening/removing the ×0.15 cut turns
    // this red.
    expect(disliked.score / undisliked.score).toBeCloseTo(0.15, 5);
  });

  it("does not fire on a declared term that does not match the item's text", () => {
    const clean = scoreAlone([]);
    const unmatched = scoreAlone(["nonexistent unrelated phrase"]);

    expect(unmatched.score).toBe(clean.score);
  });

  it("a review-shaped item is only cut when review words are actually in the reader's own declared negativeTopics — not merely for being review-shaped", () => {
    const reviewShaped = paper({
      title: "A review of battery electrolyte transport",
      abstract:
        "This review surveys battery electrolyte transport mechanisms in depth.",
    });
    // Strong direct match to the reader's own declared work, so this
    // item's admission survives combine.ts's own separate
    // `shouldPushReviewPaper` leniency filter either way — not what this
    // test exercises.
    const seedTexts = ["battery electrolyte transport review study"];
    const profile = (negativeTopics: string[]) => ({
      topics: [TOPIC],
      negativeTopics,
      seedTexts,
    });

    const [undeclared] = scoreItems([reviewShaped], profile([]), undefined, now);
    const [declared] = scoreItems(
      [reviewShaped],
      profile(["review"]),
      undefined,
      now,
    );

    expect(undeclared).toBeDefined();
    expect(undeclared.score).toBeGreaterThan(0);
    // MUTATION CHECK (SCORE-ZERO): if pipeline.ts ever again feeds the
    // system's own "avoid reviews" default into profile.negativeTopics
    // (rather than only a reader's own declared dislike), `undeclared`
    // would be cut too and this ratio would collapse to 1.
    expect(declared.score / undeclared.score).toBeCloseTo(0.15, 5);
  });
});
