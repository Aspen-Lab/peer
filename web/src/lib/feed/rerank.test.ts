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
