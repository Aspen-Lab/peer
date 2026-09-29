import { describe, expect, it } from "vitest";
import { applyTier1Rerank } from "./rerank";
import { compileSearchBrief } from "./profile-compiler";
import type { ScoredItem } from "@/lib/scoring/types";

function brief() {
  return compileSearchBrief({
    researchTopics: ["protein structure prediction"],
  } as never);
}

let n = 0;
function item(overrides: Partial<ScoredItem> = {}): ScoredItem {
  n += 1;
  return {
    id: `openalex:${n}`,
    source: "openalex",
    title: `Paper ${n}`,
    authors: [`Author ${n}`],
    url: `https://example.test/${n}`,
    publishedAt: "2026-09-01",
    metadata: {},
    score: 0.5,
    scoreBreakdown: {
      keyword: 0.5,
      tfidf: 0.5,
      recency: 0.5,
      source: 0.5,
      combined: 0.5,
    },
    matchedKeywords: [],
    relevanceReason: "",
    ...overrides,
  } as ScoredItem;
}

describe("applyTier1Rerank — per-author diversification", () => {
  it("defers a single author past two slots", () => {
    // The live failure this guards: one researcher took six of ten slots in a
    // daily briefing. `topicKey` did not catch it — the titles share no
    // three-token prefix, so every one hashed to a different topic key.
    const flood = [
      "Graph Neural Networks for Protein Structure Prediction",
      "Deep Generative Models for Predicting Protein Structures",
      "Quantum Machine Learning Protein Structure Prediction",
      "Quantum Bioinformatics: Protein Structure Prediction",
      "Improving Protein Contact Maps with Transformers",
      "Diffusion Priors for Protein Backbone Generation",
    ].map((title) => item({ title, authors: ["Jincheng Zhang"] }));
    const others = [
      item({ title: "Ribosome Profiling at Scale", authors: ["Ada Lovelace"] }),
      item({ title: "Cryo-EM Density Refinement", authors: ["Rosalind Franklin"] }),
    ];

    const ranked = applyTier1Rerank([...flood, ...others], brief());
    const topFour = ranked.slice(0, 4).map((i) => i.authors[0]);

    expect(topFour.filter((a) => a === "Jincheng Zhang")).toHaveLength(2);
    // Nothing is dropped — the surplus is deferred to the back of the list.
    expect(ranked).toHaveLength(8);
    expect(ranked.filter((i) => i.authors[0] === "Jincheng Zhang")).toHaveLength(6);
  });

  it("leaves a briefing of distinct authors in score order", () => {
    const items = [
      item({ score: 0.9, authors: ["A"], title: "Alpha methods for folding" }),
      item({ score: 0.8, authors: ["B"], title: "Beta approach to docking" }),
      item({ score: 0.7, authors: ["C"], title: "Gamma survey of contacts" }),
    ];

    const ranked = applyTier1Rerank(items, brief());

    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((i) => i.authors[0]))).toEqual(
      new Set(["A", "B", "C"]),
    );
  });

  it("does not cap items with no author", () => {
    const anon = Array.from({ length: 5 }, (_, i) =>
      item({ authors: [], title: `Anonymous submission ${i} on folding` }),
    );

    const ranked = applyTier1Rerank(anon, brief());

    expect(ranked).toHaveLength(5);
  });
});

// SCORE-ZERO (ABC-JEV-INTEGRATION.md §1at ruling 3,
// docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md). Before this fix,
// `localScore`'s review/avoid demotion could floor an already-admitted
// item's score at exactly 0 (`Math.max(0, ...)`) — no visible relevance
// badge, even though the card's `relevanceReason` still claimed a match.
// `brief()` (above) defaults `controls.avoidReviews`/`avoidBroadSurveys` to
// true with empty `mustInclude`/`niceToHave`/`methods`, so for an
// "openalex" item with no code-pattern text, every boost/penalty term is 0
// except `sourceLaneBoost` (a fixed +0.03) and whatever `avoid`/
// `reviewPenalty` the item's own text earns — chosen so every expected
// value below is exact, not approximate.
describe("applyTier1Rerank — review/avoid demotion floor (SCORE-ZERO)", () => {
  // Title carries exactly one of brief().avoid's 5 signal tokens
  // ("review"; not "survey"/"overview"/"broad"/"tutorial") and IS
  // review-shaped (`isReviewLike` matches `\breview\b`), so
  // avoid = 1/5 = 0.2 and reviewPenalty = 0.16 exactly — a combined
  // reviewAvoidDemotion of 0.2, comfortably more than a small pre-rerank
  // score can survive unfloored.
  function reviewShaped(overrides: Partial<ScoredItem> = {}): ScoredItem {
    return item({
      title: "A Review of Battery Electrolyte Transport",
      abstract:
        "This paper covers electrolyte transport mechanisms in solid batteries.",
      ...overrides,
    });
  }

  it("never lets the review/avoid demotion alone sink a score below 0.25x its pre-rerank score", () => {
    const preRerankScore = 0.1;
    const [ranked] = applyTier1Rerank(
      [reviewShaped({ score: preRerankScore, scoreBreakdown: { keyword: 0.1, tfidf: 0.1, topicality: 0.1, recency: 0.1, source: 0.1, combined: preRerankScore } })],
      brief(),
    );

    // Hand-computed: before = 0.1 (item.score) + 0.03 (sourceLaneBoost) =
    // 0.13; floor = 0.25 * 0.1 = 0.025; the uncapped formula would have
    // subtracted the full 0.2 (0.13 - 0.2 = -0.07, floored to 0 by the old
    // unconditional Math.max(0, ...)). The new floor caps the subtraction
    // at (before - floor) = 0.105, landing exactly on the floor.
    expect(ranked.score).toBeCloseTo(0.025, 10);
    expect(ranked.scoreBreakdown.combined).toBeCloseTo(0.025, 10);
    // MUTATION CHECK (SCORE-ZERO): deleting the floor (reverting to plain
    // `Math.max(0, Math.min(1, ...))`) turns this red — the item would
    // land on exactly 0 instead, as the live bug did.
    expect(ranked.score).toBeGreaterThan(0);
  });

  it("does not floor a score the unfloored formula would have kept comfortably positive", () => {
    const preRerankScore = 0.9;
    const [ranked] = applyTier1Rerank(
      [reviewShaped({ score: preRerankScore, scoreBreakdown: { keyword: 0.9, tfidf: 0.9, topicality: 0.9, recency: 0.9, source: 0.9, combined: preRerankScore } })],
      brief(),
    );

    // 0.9 + 0.03 (sourceLaneBoost) - 0.2 (reviewAvoidDemotion) = 0.73,
    // already above its floor (0.225) — the floor must not perturb it.
    expect(ranked.score).toBeCloseTo(0.73, 10);
  });

  it("keeps demoted items ordered the way their pre-rerank scores were, each landing on its own floor", () => {
    const items = [
      reviewShaped({ id: "openalex:a", title: "Review A of Battery Electrolyte Transport", score: 0.12, scoreBreakdown: { keyword: 0.12, tfidf: 0.12, topicality: 0.12, recency: 0.12, source: 0.12, combined: 0.12 } }),
      reviewShaped({ id: "openalex:b", title: "Review B of Battery Electrolyte Transport", score: 0.06, scoreBreakdown: { keyword: 0.06, tfidf: 0.06, topicality: 0.06, recency: 0.06, source: 0.06, combined: 0.06 } }),
      reviewShaped({ id: "openalex:c", title: "Review C of Battery Electrolyte Transport", score: 0.03, scoreBreakdown: { keyword: 0.03, tfidf: 0.03, topicality: 0.03, recency: 0.03, source: 0.03, combined: 0.03 } }),
    ];

    const ranked = applyTier1Rerank(items, brief());

    expect(ranked.map((i) => i.id)).toEqual(["openalex:a", "openalex:b", "openalex:c"]);
    expect(ranked[0].score).toBeCloseTo(0.25 * 0.12, 10);
    expect(ranked[1].score).toBeCloseTo(0.25 * 0.06, 10);
    expect(ranked[2].score).toBeCloseTo(0.25 * 0.03, 10);
    // Strictly descending — flooring proportionally to each item's own
    // pre-rerank score is what keeps them from collapsing to one tied value.
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("leaves a non-review, non-avoid item's score byte-identical to the un-floored formula", () => {
    const clean = item({
      title: "Impedance Mapping Of Cathode Interfaces",
      abstract: "A study of interface impedance in cathode materials.",
      score: 0.5,
      scoreBreakdown: { keyword: 0.5, tfidf: 0.5, topicality: 0.5, recency: 0.5, source: 0.5, combined: 0.5 },
    });

    const [ranked] = applyTier1Rerank([clean], brief());

    // 0.5 (item.score) + 0.03 (sourceLaneBoost) + 0 everywhere else — the
    // original, un-floored expression, unchanged.
    expect(ranked.score).toBeCloseTo(0.53, 10);
  });

  it("leaves methodPenalty's own, separate zero-floor unrestricted — only the review/avoid terms are floored", () => {
    const strictMethods = compileSearchBrief({
      topics: [],
      methods: ["impedance spectroscopy"],
      controls: { methodMode: "mustMatch" },
    });
    // No review/avoid words at all, and no overlap with "impedance
    // spectroscopy" — methodPenalty (0.18) fires alone.
    const noMethodOverlap = item({
      title: "Cathode Interface Study",
      abstract: "An investigation of cathode interface chemistry.",
      score: 0.1,
      scoreBreakdown: { keyword: 0.1, tfidf: 0.1, topicality: 0.1, recency: 0.1, source: 0.1, combined: 0.1 },
    });

    const [ranked] = applyTier1Rerank([noMethodOverlap], strictMethods);

    // 0.1 + 0.03 (sourceLaneBoost) - 0.18 (methodPenalty) = -0.05, floored
    // to exactly 0 by methodPenalty alone — the SCORE-ZERO floor (which
    // only bounds avoid*0.2 + reviewPenalty) must not rescue it.
    expect(ranked.score).toBe(0);
  });
});
