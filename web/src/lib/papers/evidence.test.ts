import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import type { PaperReport } from "./report";
import {
  evidenceSupported,
  normalizeForMatch,
  placeEvidence,
  verifyReportEvidence,
} from "./evidence";

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"),
  ) as T;
}

// arXiv 2609.02697: LaTeXML HTML, 16 sections including "Abstract" and
// "4.4 Results". The sentences below are copied from the fixture.
const doc = fixture<ExtractedDocument>("arxiv-2609.02697.doc.json");
const abstract = doc.sections.find((s) => s.canonical === "abstract")!.text;

const ABSTRACT_SENTENCE =
  "We propose a novel counterfactual-generation framework that requires no generative model.";
const RESULTS_SENTENCE =
  "On the brain MRI dataset, the CE approach outperformed the other approaches at lower distance thresholds, achieving an 85% success rate with distance thresholds of 0.25 in LPIPS and 0.2 in SSIM.";
const ABSTRACT_SENTENCES = abstract.split(/(?<=[.!?])\s+/);

function report(overrides: Partial<PaperReport> = {}): PaperReport {
  return {
    skim: [],
    whatItProposes: { summary: "", methods: [] },
    resultsAndSignificance: { summary: "", keyResults: [] },
    provenance: { basis: "model-fulltext", droppedClaims: 0 },
    ...overrides,
  };
}

describe("normalizeForMatch", () => {
  it("folds ligatures, curly quotes, dashes, soft hyphens, citation brackets, case and whitespace", () => {
    expect(
      normalizeForMatch("The ﬁrst “counter‐factual” — 12–15 %  gain­s [12], see [3–5]."),
    ).toBe(normalizeForMatch('The first "counter-factual" - 12-15 % gains, see.'));
  });
});

describe("evidenceSupported", () => {
  const corpus = abstract;

  it("matches a verbatim sentence", () => {
    expect(evidenceSupported(ABSTRACT_SENTENCE, corpus)).toBe(true);
  });

  it("still matches through a ligature, curly quotes, an en-dash and a trailing [12]", () => {
    const curly =
      "While often capable of producing visually realistic images, these methods explain one black-box model using another, making it difficult to separate the classifier’s decision-making process from the inductive biases of the generator.";
    expect(corpus).toContain(curly);
    const ligature = curly.replace("difficult", "difﬁcult");
    expect(ligature).not.toBe(curly);
    expect(evidenceSupported(ligature, corpus)).toBe(true);
    expect(evidenceSupported(curly.replace("’", "'"), corpus)).toBe(true);

    const enDash = "counterfactual–generation framework that requires no generative model.";
    expect(evidenceSupported(enDash, corpus)).toBe(true);

    expect(evidenceSupported(`${ABSTRACT_SENTENCE} [12]`, corpus)).toBe(true);
    expect(evidenceSupported(ABSTRACT_SENTENCE.replace(".", " [12]."), corpus)).toBe(true);
  });

  it("accepts a long quote whose middle differs when its first 80 and last 40 characters both match", () => {
    // The model kept an inline figure reference the extractor stripped; it
    // sits past the 80-char head and before the 40-char tail.
    const withReference = RESULTS_SENTENCE.replace(
      "achieving an 85% success rate",
      "achieving (Figure 3a) an 85% success rate",
    );
    expect(withReference.indexOf("(Figure 3a)")).toBeGreaterThan(80);
    expect(RESULTS_SENTENCE.length - withReference.indexOf("(Figure 3a)")).toBeGreaterThan(40);
    const body = doc.sections.map((s) => s.text).join(" ");
    expect(evidenceSupported(withReference, body)).toBe(true);
    // The same edit inside the head fails: the sentence was not copied.
    expect(
      evidenceSupported(RESULTS_SENTENCE.replace("MRI dataset", "MRI (Figure 3a) dataset"), body),
    ).toBe(false);
  });

  it("rejects a paraphrase", () => {
    expect(
      evidenceSupported(
        "We introduce a new framework for generating counterfactuals without any generative model.",
        corpus,
      ),
    ).toBe(false);
  });

  it("rejects a quote under 40 characters even when it is present", () => {
    const short = "requires no generative model.";
    expect(short.length).toBeLessThan(40);
    expect(corpus).toContain(short);
    expect(evidenceSupported(short, corpus)).toBe(false);
  });
});

describe("verifyReportEvidence", () => {
  it("keeps the two backed results, drops the paraphrase and counts it", () => {
    const { report: verified, dropped } = verifyReportEvidence(
      report({
        resultsAndSignificance: {
          summary: "",
          keyResults: [
            { title: "Success rate", detail: "85% on MRI.", evidence: RESULTS_SENTENCE },
            {
              title: "Paraphrased",
              detail: "Made up.",
              evidence:
                "The causal approach beat every baseline on the MRI data at small distances, reaching an 85 percent success rate.",
            },
            { title: "No generator", detail: "Needs no generative model.", evidence: ABSTRACT_SENTENCE },
          ],
        },
      }),
      { abstract, doc },
    );

    expect(dropped).toBe(1);
    expect(verified.provenance.droppedClaims).toBe(1);
    expect(verified.resultsAndSignificance.keyResults.map((r) => r.title)).toEqual([
      "Success rate",
      "No generator",
    ]);
  });

  it("sets evidenceWhere to the section heading or to abstract", () => {
    const { report: verified } = verifyReportEvidence(
      report({
        skim: [{ text: "Skim.", evidence: ABSTRACT_SENTENCE }],
        resultsAndSignificance: {
          summary: "",
          keyResults: [{ title: "R", detail: "D", evidence: RESULTS_SENTENCE }],
        },
      }),
      { abstract, doc },
    );

    expect(verified.skim[0].evidenceWhere).toBe("abstract");
    expect(verified.resultsAndSignificance.keyResults[0].evidenceWhere).toBe("4.4 Results");
  });

  it("verifies every field, removes an emptied relation and next step, and is abstract-only at Tier 1", () => {
    const { report: verified, dropped } = verifyReportEvidence(
      report({
        skim: [{ text: "S", evidence: ABSTRACT_SENTENCE }],
        whatItProposes: {
          summary: "",
          methods: [
            { text: "M1", evidence: ABSTRACT_SENTENCE },
            { text: "M2", evidence: RESULTS_SENTENCE },
          ],
        },
        limitations: [{ text: "L", evidence: RESULTS_SENTENCE }],
        relationToYourWork: {
          basedOn: "My project",
          items: [{ text: "Rel", evidence: "Not a sentence of the paper at all, just prose." }],
        },
        nextStep: { text: "Next", evidence: RESULTS_SENTENCE },
      }),
      // Tier 1: the abstract alone; the results sentence is not in it.
      { abstract },
    );

    expect(verified.skim).toHaveLength(1);
    expect(verified.whatItProposes.methods.map((m) => m.text)).toEqual(["M1"]);
    expect(verified.limitations).toEqual([]);
    expect(verified.relationToYourWork).toBeUndefined();
    expect(verified.nextStep).toBeUndefined();
    expect(dropped).toBe(4);
  });

  it("leaves a report with no claims untouched and counts nothing", () => {
    const { report: verified, dropped } = verifyReportEvidence(report(), { abstract });
    expect(dropped).toBe(0);
    expect(verified.provenance.droppedClaims).toBe(0);
  });
});

describe("placeEvidence", () => {
  it("returns a mark for an abstract sentence", () => {
    const index = ABSTRACT_SENTENCES.indexOf(ABSTRACT_SENTENCE);
    expect(index).toBeGreaterThan(0);
    expect(placeEvidence(ABSTRACT_SENTENCE, ABSTRACT_SENTENCES)).toEqual({
      kind: "mark",
      index,
    });
    // A fragment of a sentence, and a quote with a citation bracket, mark the
    // same sentence.
    expect(
      placeEvidence("a novel counterfactual-generation framework that requires no generative model", ABSTRACT_SENTENCES),
    ).toEqual({ kind: "mark", index });
    expect(placeEvidence(`${ABSTRACT_SENTENCE} [3]`, ABSTRACT_SENTENCES)).toEqual({
      kind: "mark",
      index,
    });
  });

  it("returns a quote for a section sentence, a paraphrase or a short fragment", () => {
    expect(placeEvidence(RESULTS_SENTENCE, ABSTRACT_SENTENCES)).toEqual({ kind: "quote" });
    expect(
      placeEvidence("We introduce a new framework without a generator.", ABSTRACT_SENTENCES),
    ).toEqual({ kind: "quote" });
    expect(placeEvidence("requires no generative model.", ABSTRACT_SENTENCES)).toEqual({
      kind: "quote",
    });
  });
});
