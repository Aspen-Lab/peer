import { describe, expect, it } from "vitest";
import { pickSkimSentence } from "./skim";

describe("pickSkimSentence", () => {
  it("skips the field-is-hard opener for the sentence that says what was done", () => {
    // Verbatim shape of the live briefing that motivated this: the card showed
    // only the first sentence, which was interchangeable across three papers.
    const intro =
      "Protein structure prediction remains a grand challenge in computational biology.";
    const discussion =
      "We propose a graph neural network that predicts inter-residue contacts directly from sequence. Our model reaches 94% precision on CASP14 targets, outperforming the previous best by 7 points.";

    const skim = pickSkimSentence(intro, discussion);

    expect(skim).not.toContain("grand challenge");
    // Leads with the proposal and carries the result that gives it weight.
    expect(skim).toContain("We propose a graph neural network");
    expect(skim).toContain("94% precision");
  });

  it("prefers a quantified result over an unquantified claim", () => {
    const skim = pickSkimSentence(
      "In recent years, docking has attracted considerable attention.",
      "This paper studies docking. The method cuts inference time by 12x while holding accuracy.",
    );

    expect(skim).toContain("12x");
  });

  it("keeps the follow-on sentence when a claim needs it and there is room", () => {
    const skim = pickSkimSentence(
      "Folding is hard.",
      "We present Foldnet, a compact predictor for backbone geometry. It matches larger models on CASP15.",
    );

    expect(skim).toContain("We present Foldnet");
    expect(skim).toContain("CASP15");
  });

  it("falls back to the abstract when nothing looks like a claim", () => {
    const only =
      "A descriptive catalogue of ribosome profiling datasets collected between 2019 and 2024 across twelve laboratories.";

    expect(pickSkimSentence(only, "")).toBe(only);
  });

  it("handles a single-sentence abstract", () => {
    expect(pickSkimSentence("One sentence only.", "")).toBe(
      "One sentence only.",
    );
  });

  it("returns null when there is no abstract", () => {
    expect(pickSkimSentence("", "")).toBeNull();
    expect(pickSkimSentence(null, null)).toBeNull();
    expect(pickSkimSentence(undefined)).toBeNull();
  });

  it("never exceeds the card's line budget", () => {
    const long = `We show that ${"the method generalises across every benchmark we tried ".repeat(20)}`;

    const skim = pickSkimSentence("Intro sentence here.", long);

    expect(skim!.length).toBeLessThanOrEqual(261);
  });

  it("ignores sentence fragments below the readable minimum", () => {
    const skim = pickSkimSentence(
      "Background is hard.",
      "Fig. 1. We demonstrate a decoder that recovers side-chain angles within one degree of the crystal structure.",
    );

    expect(skim).toContain("We demonstrate a decoder");
  });
  it("prefers a self-contained sentence over one with a dangling reference", () => {
    // Lifting "…to address this challenge" out of the abstract leaves the
    // reader without the challenge. Seen live on a GNN paper.
    const skim = pickSkimSentence(
      "Protein structure prediction remains a significant challenge in bioinformatics.",
      "This work explores the application of Graph Neural Networks to address this challenge. The resulting predictor recovers contact maps from sequence alone across sixty targets.",
    );

    expect(skim).toContain("recovers contact maps from sequence alone");
  });

  it("still takes a dangling-reference claim over pure boilerplate", () => {
    const skim = pickSkimSentence(
      "Docking has attracted considerable attention in recent years.",
      "We address this problem with a lightweight scorer.",
    );

    expect(skim).toContain("lightweight scorer");
  });
});
