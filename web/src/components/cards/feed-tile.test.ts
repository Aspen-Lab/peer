import { describe, expect, it } from "vitest";
import { resolvePaperTileSummary } from "./feed-tile";

const paper = {
  summaryIntro:
    "First abstract sentence. Second abstract sentence. Third abstract sentence.",
  summaryResultDiscussion: "",
  relevanceReason: "Matches your declared battery topic.",
};

describe("resolvePaperTileSummary", () => {
  it("prefers the stored digest sentence", () => {
    expect(
      resolvePaperTileSummary(paper, "Digest sentence for this paper."),
    ).toBe("Digest sentence for this paper.");
  });

  it("reads the whole abstract, not just its opening", () => {
    // The card used to render `summaryIntro` alone — the first one or two
    // sentences, which in an academic abstract is the motivation. Everything
    // that distinguished one paper from another sat unused in
    // `summaryResultDiscussion`.
    const summary = resolvePaperTileSummary({
      summaryIntro:
        "Protein structure prediction remains a grand challenge in computational biology.",
      summaryResultDiscussion:
        "We propose a graph neural network for inter-residue contacts. It reaches 94% precision on CASP14.",
      relevanceReason: "Matches protein structure prediction.",
    });

    expect(summary).not.toContain("grand challenge");
    expect(summary).toContain("We propose a graph neural network");
  });

  it("keeps a plain abstract readable when nothing looks like a claim", () => {
    expect(resolvePaperTileSummary(paper)).toBe(
      "First abstract sentence. Second abstract sentence.",
    );
  });

  it("falls back to the relevance reason when the abstract is absent", () => {
    expect(
      resolvePaperTileSummary({
        summaryIntro: " ",
        summaryResultDiscussion: "",
        relevanceReason: "Matches your declared electrolyte topic.",
      }),
    ).toBe("Matches your declared electrolyte topic.");
  });

  it("never returns an empty body", () => {
    expect(
      resolvePaperTileSummary({
        summaryIntro: "",
        summaryResultDiscussion: "",
        relevanceReason: "",
      }),
    ).toBe("Open this paper for details.");
  });
});
