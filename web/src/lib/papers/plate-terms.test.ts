import { describe, expect, it } from "vitest";
import { allocatePlateTerms } from "./plate-terms";

const TOPICS = ["protein structure prediction", "diffusion models"];

function paper(id: string, keywords: string[]) {
  return { id, summaryExperimentKeywords: keywords };
}

describe("allocatePlateTerms", () => {
  it("never echoes the reader's own topic back at them", () => {
    // The live failure: matchedKeywords ARE the reader's required topics, so
    // this field led with the same phrase on all ten cards.
    const out = allocatePlateTerms(
      [paper("a", ["protein structure prediction", "Contact maps"])],
      TOPICS,
    );

    expect(out.a).toEqual(["Contact maps"]);
  });

  it("suppresses a substring of a topic the reader declared", () => {
    const out = allocatePlateTerms([paper("a", ["Protein structure"])], TOPICS);

    expect(out.a).toEqual([]);
  });

  it("collapses case and substring duplicates within one card", () => {
    // Verbatim from the shipped feed: one card carried three variants of the
    // same phrase because the dedup was a case-sensitive Set.
    const out = allocatePlateTerms(
      [paper("a", ["Contact maps", "contact maps", "Contact map"])],
      [],
    );

    expect(out.a).toEqual(["Contact maps"]);
  });

  it("drops concepts whose bracket marks them out of domain", () => {
    const out = allocatePlateTerms(
      [
        paper("a", [
          "Representation (politics)",
          "Generative grammar",
          "Quantum entanglement",
        ]),
      ],
      [],
    );

    expect(out.a).toContain("Quantum entanglement");
    expect(out.a).not.toContain("Representation (politics)");
  });

  it("lets no term headline more than two cards in one briefing", () => {
    const papers = ["a", "b", "c", "d"].map((id) => paper(id, ["Transformers"]));

    const out = allocatePlateTerms(papers, []);
    const used = Object.values(out).filter((t) => t.includes("Transformers"));

    expect(used).toHaveLength(2);
    expect(out.c).toEqual([]);
    expect(out.d).toEqual([]);
  });

  it("caps a card at three terms", () => {
    const out = allocatePlateTerms(
      [paper("a", ["Contact maps", "Backbone geometry", "Side chains", "Rotamer libraries", "Loop modelling"])],
      [],
    );

    expect(out.a).toHaveLength(3);
  });

  it("returns an empty list rather than throwing on a paper with no keywords", () => {
    const out = allocatePlateTerms([paper("a", [])], TOPICS);

    expect(out.a).toEqual([]);
  });
  it("rejects a concept that appears nowhere in the paper's own words", () => {
    // OpenAlex put "Generative grammar" on a protein-folding paper. A wrong
    // term set at display size is worse than no term.
    const out = allocatePlateTerms(
      [
        {
          id: "a",
          summaryExperimentKeywords: ["Generative grammar", "Contact maps"],
          title: "Predicting contact maps from sequence",
          summaryIntro: "We infer contact maps for protein backbones.",
        },
      ],
      [],
    );

    expect(out.a).toEqual(["Contact maps"]);
  });

  it("drops arXiv category codes", () => {
    const out = allocatePlateTerms(
      [{ id: "a", summaryExperimentKeywords: ["quant-ph", "physics.chem-ph"] }],
      [],
    );

    expect(out.a).toEqual([]);
  });

  it("drops terms too short to set at display size", () => {
    const out = allocatePlateTerms(
      [{ id: "a", summaryExperimentKeywords: ["Graph", "Model"] }],
      [],
    );

    expect(out.a).toEqual([]);
  });
});
