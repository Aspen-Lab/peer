import { describe, expect, it } from "vitest";
import {
  DEEP_LINK_REASON,
  RERANK_DEFAULT_REASON,
  SCORING_FALLBACK_REASON,
  recommendationLine,
} from "./recommendation";

describe("recommendationLine", () => {
  it("shows a real reason verbatim", () => {
    expect(recommendationLine("Matches your interest in protein structure prediction.")).toBe(
      "Matches your interest in protein structure prediction.",
    );
    expect(recommendationLine("  Semantically close to your profile.  ")).toBe(
      "Semantically close to your profile.",
    );
  });

  it("shows nothing for the deep-link placeholder — the store copy may be unenriched and the page then holds the fetched one", () => {
    // A briefing paper whose store copy has no abstract is re-fetched from
    // /api/papers/[id], which stamps this line; it is not why the paper is here.
    expect(recommendationLine(DEEP_LINK_REASON)).toBeNull();
  });

  it("shows nothing for the reranker's and scoring's fill-ins", () => {
    expect(recommendationLine(RERANK_DEFAULT_REASON)).toBeNull();
    expect(recommendationLine(SCORING_FALLBACK_REASON)).toBeNull();
  });

  it("shows nothing for an empty or missing reason", () => {
    expect(recommendationLine("")).toBeNull();
    expect(recommendationLine("   ")).toBeNull();
    expect(recommendationLine(undefined)).toBeNull();
    expect(recommendationLine(null)).toBeNull();
  });
});
