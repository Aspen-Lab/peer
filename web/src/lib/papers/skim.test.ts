import { describe, expect, it } from "vitest";
import {
  QUANTITY_STRICT,
  pickSkimMarks,
  pickSkimSentence,
  scoreSentence,
  splitSentences,
} from "./skim";

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

describe("splitSentences", () => {
  it("keeps an abbreviation and a decimal inside one sentence", () => {
    expect(splitSentences("Fig. 3 shows 0.5 mm. The rest is text.")).toEqual([
      "Fig. 3 shows 0.5 mm.",
      "The rest is text.",
    ]);
  });

  it("keeps a citation, an initial and e.g. inside one sentence", () => {
    expect(
      splitSentences(
        "As Smith et al. reported, J. Doe used two probes, e.g. a laser. We did not.",
      ),
    ).toEqual(["As Smith et al. reported, J. Doe used two probes, e.g. a laser.", "We did not."]);
  });

  it("treats an OpenAlex reconstruction with no terminal period as one sentence", () => {
    const flat = "Predicting protein structure remains hard and we propose a graph method for it";

    expect(splitSentences(flat)).toEqual([flat]);
  });

  it("joins a piece that starts in lower case onto the sentence before it", () => {
    expect(splitSentences("We compare X-ray vs. cryo-EM maps. Then we stop.")).toEqual([
      "We compare X-ray vs. cryo-EM maps.",
      "Then we stop.",
    ]);
  });
});

describe("QUANTITY_STRICT", () => {
  it("wants a unit or a comparison, not a bare number", () => {
    expect(QUANTITY_STRICT.test("reaches 94% precision")).toBe(true);
    expect(QUANTITY_STRICT.test("cuts time by 12x")).toBe(true);
    expect(QUANTITY_STRICT.test("a 3-fold gain")).toBe(true);
    expect(QUANTITY_STRICT.test("with p < 0.01")).toBe(true);
    expect(QUANTITY_STRICT.test("scored 0.82 vs. 0.71")).toBe(true);
    expect(QUANTITY_STRICT.test("on CASP14 targets")).toBe(false);
    expect(QUANTITY_STRICT.test("between 2019 and 2024")).toBe(false);
  });
});

describe("scoreSentence", () => {
  it("ranks a claim above the field and penalises a fragment", () => {
    expect(scoreSentence("We show that the decoder recovers side-chain angles.", 0)).toBeGreaterThan(
      scoreSentence("Protein folding remains a grand challenge in biology.", 0),
    );
    expect(scoreSentence("Fig. 1.", 0)).toBeLessThan(
      scoreSentence("We show that the decoder recovers side-chain angles.", 0),
    );
  });
});

describe("pickSkimMarks", () => {
  const seven = [
    "Protein structure prediction remains a grand challenge in computational biology.",
    "Existing approaches depend on multiple sequence alignments that are slow to build.",
    "We propose a graph neural network that predicts inter-residue contacts directly from sequence.",
    "The model is trained on the full PDB with a contrastive objective.",
    "It reaches 94% precision on CASP14 targets, outperforming the previous best by 7 points.",
    "Ablations show that the contrastive objective accounts for most of the gain.",
    "These results suggest that alignment-free prediction is within reach for orphan proteins.",
  ];

  it("marks two or three sentences of a seven-sentence abstract, including the number", () => {
    const marks = pickSkimMarks(seven);

    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(marks.length).toBeLessThanOrEqual(3);
    expect(marks).toContain(4);
    expect(marks).toEqual([...marks].sort((a, b) => a - b));
  });

  it("never marks the boilerplate opener", () => {
    expect(pickSkimMarks(seven)).not.toContain(0);
  });

  it("marks nothing in a two-sentence abstract", () => {
    expect(pickSkimMarks(seven.slice(2, 4))).toEqual([]);
  });

  it("collapses a three-sentence abstract to one mark under the ink cap", () => {
    const three = [
      "We propose a compact predictor for backbone geometry.",
      "It matches larger models on CASP15 with 40% fewer parameters.",
      "This suggests that scale is not the only route to accuracy.",
    ];

    expect(pickSkimMarks(three)).toHaveLength(1);
  });

  it("marks nothing when every sentence is about the field", () => {
    expect(
      pickSkimMarks([
        "Docking has attracted considerable attention in recent years.",
        "It remains a grand challenge in computational chemistry.",
        "Structure prediction plays a crucial role in drug discovery.",
      ]),
    ).toEqual([]);
  });
});
