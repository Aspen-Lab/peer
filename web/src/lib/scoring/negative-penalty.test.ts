import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";

// DISLIKE-CHANNEL (ABC-JEV-INTEGRATION.md §1br,
// docs/jev-abc/DISLIKE-CHANNEL-B-20260930T083933Z.md) — REWRITTEN, NOT
// DELETED. This file used to unit-test combine.ts's `negativePenalty` (a
// reader-dislike ×0.15 rank-lower cut) in isolation from `profile.exclusions`,
// the hard drop that — in every real request — always ALSO matches the
// identical declared term and removes the item before `negativePenalty`
// could ever run (the SCORE-ZERO CORRECTION, ABC-JEV-INTEGRATION.md §1at).
// DISLIKE-CHANNEL's own investigation, by fresh execution, confirmed this
// is not merely "usually unreachable" but ALWAYS unreachable: nothing in
// the product writes `profile.dislikedTopics` at all (the only field
// `negativeTopics`/`legacyNegativeTopics` were ever fed from), so
// `negativePenalty` and its sibling `legacyDislikePenalty` were deleted as
// dead code — no behaviour change, since the removed factors were always
// exactly 1 in every real request (proven with a before/after run over the
// saved pools, recorded in this item's checkpoint).
//
// This file now pins the SAME "reader's own declared dislike" scenario
// against the mechanism that actually governs it, `profile.exclusions` — a
// hard drop, not a score cut. Checked for overlap before adding:
// admission.test.ts already covers `profile.exclusions` as a hard drop, on
// a different fixture domain (solid electrolyte / conflict-of-interest);
// pipeline.score-zero.test.ts covers the full end-to-end REAL request shape
// (through the real `intent.exclusions` wiring, via `runFeedPipeline`) —
// this file stays a `scoreItems`-level unit test, calling
// `profile.exclusions` directly, the same level its predecessor tested
// `negativeTopics` at, with its own (battery/cobalt-sourcing) fixtures kept
// for continuity with this file's history.
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

function scoreAlone(exclusions: string[]) {
  return scoreItems(
    [paper()],
    { topics: [TOPIC], exclusions },
    undefined,
    now,
  );
}

describe("profile.exclusions — DISLIKE-CHANNEL (§1br)", () => {
  // DISLIKE-CHANNEL (§1br): rewritten from "cuts ... to exactly 0.15x" —
  // the reachable, real-request contract is a hard drop, not a score cut.
  it("removes an item matching the reader's own declared dislike entirely, rather than scoring it down", () => {
    const undisliked = scoreAlone([]);
    const disliked = scoreAlone(["cobalt sourcing"]);

    expect(undisliked).toHaveLength(1);
    expect(undisliked[0]!.score).toBeGreaterThan(0);
    // MUTATION CHECK (DISLIKE-CHANNEL §1br): weakening the hard drop back
    // into a score cut (or removing it) turns this red — the item must be
    // ABSENT, not merely demoted.
    expect(disliked).toHaveLength(0);
  });

  // DISLIKE-CHANNEL (§1br): same assertion shape as the predecessor test,
  // ported from `negativeTopics` to `exclusions`.
  it("does not fire on a declared term that does not match the item's text", () => {
    const clean = scoreAlone([]);
    const unmatched = scoreAlone(["nonexistent unrelated phrase"]);

    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.score).toBe(clean[0]!.score);
  });

  // DISLIKE-CHANNEL (§1br): rewritten from "cut to exactly 0.15x" —
  // preserves the ORIGINAL point of this scenario (a review-shaped item is
  // only affected when the reader ACTUALLY declared a matching term, never
  // merely for looking like a review) under the new hard-drop contract.
  it("a review-shaped item is only excluded when a matching term is actually in the reader's own declared exclusions — not merely for being review-shaped", () => {
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
    const profile = (exclusions: string[]) => ({
      topics: [TOPIC],
      exclusions,
      seedTexts,
    });

    const undeclared = scoreItems([reviewShaped], profile([]), undefined, now);
    const declared = scoreItems([reviewShaped], profile(["review"]), undefined, now);

    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]!.score).toBeGreaterThan(0);
    // MUTATION CHECK (DISLIKE-CHANNEL §1br): if the system's own default
    // "avoid reviews" words were ever fed into `exclusions` (rather than
    // only a reader's own declared dislike), `undeclared` would be removed
    // too and this would go empty regardless of the declared term.
    expect(declared).toHaveLength(0);
  });
});
