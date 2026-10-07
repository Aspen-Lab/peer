import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import type { PaperReport } from "./report";
import {
  evidenceSupported,
  locateSection,
  normalizeForMatch,
  placeEvidence,
  sectionCorpus,
  shapeEvidenceQuote,
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

  it("1-17: folds an inline fraction slash the same way on both sides of the PDF extraction artifact", () => {
    // PyMuPDF reorders a stacked "L/d" into "Ld" + U+2044 (FRACTION SLASH)
    // when lifting text from a PDF's glyph layout — a real paper's own
    // wording, garbled by extraction, not a paraphrase.
    expect(normalizeForMatch("L/d = 0.67")).toBe(normalizeForMatch("Ld ⁄ = 0.67"));
    expect(normalizeForMatch("L/d = 0.67")).toBe("ld = 0.67");
  });

  it("2-02: folds a hyphenated PDF line-break the same way on both sides", () => {
    // PyMuPDF re-joins a word that wrapped across a line break with a
    // hyphen AND an inserted space ("high- energy") where the clean text
    // has neither reason for one ("high-energy") — a real extraction
    // artifact, not a paraphrase.
    expect(normalizeForMatch("high-energy")).toBe(normalizeForMatch("high- energy"));
    expect(normalizeForMatch("high-energy")).toBe("highenergy");
  });

  // P2-08b (§1g.16): the ruling names bracketed author-year citations as the
  // one leniency the head/tail rule was written for, next to `[12]`; so they
  // fold on both sides, and only citations do.
  it("P2-08b: folds an author-year citation like a numeric one, and leaves every other parenthesis alone", () => {
    const bare = normalizeForMatch("The cathodes crack under fast charging in every cell we opened.");
    const cited = (inside: string) => normalizeForMatch(`The cathodes crack (${inside}) under fast charging in every cell we opened.`);
    for (const citation of [
      "Smith et al., 2020",
      "Smith and Jones, 2019; Lee, 2021a",
      "Smith & Lee 2020",
      "Müller, 2018",
      "O’Brien et al., 2020",
    ]) {
      expect(cited(citation), citation).toBe(normalizeForMatch("The cathodes crack under fast charging in every cell we opened."));
    }
    for (const notACitation of ["2020", "Figure 3a", "n = 12", "Table 2", "see Smith, 2020", "Smith, 2020, p. 5", "e.g., Smith, 2020"]) {
      expect(cited(notACitation), notACitation).not.toBe(bare);
    }
    // A narrative citation keeps its year: it is the sentence's own words.
    expect(normalizeForMatch("Smith et al. (2020) showed that cathodes crack.")).toContain("(2020)");
  });

  it("2-02: still tells two different hyphenated words apart", () => {
    expect(normalizeForMatch("state-of-the-art")).not.toBe(normalizeForMatch("well-known"));
  });

  it("4-02: folds a zero-width space the same way on both sides of an ar5iv math-rendering artifact", () => {
    // ar5iv's MathML-to-text rendering can emit U+200B where a genuine
    // word-boundary space belongs, mid-token — the model's own copied
    // quote has an ordinary space there instead.
    expect(normalizeForMatch("learning rate of 4\u200Be - 4")).toBe(
      normalizeForMatch("learning rate of 4 e - 4"),
    );
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

  // P2-08b (§1g.16, F1): this test used to assert the opposite — that a long
  // quote with an inline "(Figure 3a)" inserted past character 80 is accepted
  // because its first 80 and last 40 characters both match. That head-and-tail
  // leniency is what the ruling removes (a quote is the paper's own words only
  // when the whole of it is in one section), so the assertion is tightened, not
  // loosened: the same input, the same preconditions, now rejected, with four
  // more ways to alter the middle.
  it("rejects a long quote whose middle differs, even when its first 80 and last 40 characters both match (P2-08b, §1g.16)", () => {
    const body = doc.sections.map((s) => s.text).join(" ");
    const bodyNormal = normalizeForMatch(body);
    const altered: Record<string, string> = {
      "a number flipped": RESULTS_SENTENCE.replace("an 85% success rate", "a 15% success rate"),
      "a clause invented": RESULTS_SENTENCE.replace("achieving an", "achieving, in every single trial, an"),
      "an inline reference the extractor stripped, kept": RESULTS_SENTENCE.replace(
        "achieving an 85% success rate",
        "achieving (Figure 3a) an 85% success rate",
      ),
      "the head, an invented sentence, the tail": `${RESULTS_SENTENCE.slice(0, 80)} The control arm failed in every single trial of the study. ${RESULTS_SENTENCE.slice(-40)}`,
      "an ellipsis in the middle": `${RESULTS_SENTENCE.slice(0, 100)} … ${RESULTS_SENTENCE.slice(-60)}`,
    };
    const withReference = altered["an inline reference the extractor stripped, kept"];
    expect(withReference.indexOf("(Figure 3a)")).toBeGreaterThan(80);
    expect(RESULTS_SENTENCE.length - withReference.indexOf("(Figure 3a)")).toBeGreaterThan(40);

    for (const [what, quote] of Object.entries(altered)) {
      // Precondition: the old rule would have accepted it — its head and its
      // tail are both in the body — so a red here is the old rule, not a typo.
      const normal = normalizeForMatch(quote);
      expect(normal.length, what).toBeGreaterThan(80);
      expect(bodyNormal, `${what}: head`).toContain(normal.slice(0, 80));
      expect(bodyNormal, `${what}: tail`).toContain(normal.slice(-40));
      expect(evidenceSupported(quote, body), what).toBe(false);
      expect(locateSection(quote, sectionCorpus(doc)), what).toBeNull();
    }
    // The same edit inside the head fails: the sentence was not copied.
    expect(
      evidenceSupported(RESULTS_SENTENCE.replace("MRI dataset", "MRI (Figure 3a) dataset"), body),
    ).toBe(false);
  });

  it("rejects the head of one sentence spliced to the tail of another in the same section, at 120 and 121 characters (P2-08b, §1g.16)", () => {
    const other =
      "Additionally, the diffusion model (DM) method differed from the causal approaches, producing successful counterfactuals but which were significantly farther from their original images.";
    const results = doc.sections.find((s) => s.heading === "4.4 Results")!;
    expect(results.text).toContain(RESULTS_SENTENCE);
    expect(results.text).toContain(other);
    for (const tail of [40, 41]) {
      const splice = `${RESULTS_SENTENCE.slice(0, 80)}${other.slice(-tail)}`;
      expect(splice.length).toBe(80 + tail);
      // Head and tail each sit in the section — the old rule accepted it.
      const section = normalizeForMatch(results.text);
      expect(section).toContain(normalizeForMatch(splice).slice(0, 80));
      expect(section).toContain(normalizeForMatch(splice).slice(-40));
      expect(evidenceSupported(splice, results.text)).toBe(false);
      expect(locateSection(splice, sectionCorpus(doc))).toBeNull();
    }
  });

  it("still accepts, over 120 characters, whatever the folding allows: exact, case, a trailing period, citations, two sentences run together (P2-08b, §1g.16)", () => {
    const body = doc.sections.map((s) => s.text).join(" ");
    const sentence = RESULTS_SENTENCE;
    expect(sentence.length).toBeGreaterThan(120);
    const accepted: Record<string, string> = {
      exact: sentence,
      "lower-cased": sentence.toLowerCase(),
      "trailing period removed": sentence.replace(/\.$/, ""),
      "a numeric citation past character 80": sentence.replace("achieving", "achieving [12]"),
      "a numeric list inside the first 80": sentence.replace("the CE approach", "the CE approach [3, 4]"),
      // The one that needs the author-year fold; the corpus has no such
      // citation, the model kept one the extractor had removed.
      "an author-year citation inside the first 80": sentence.replace("the CE approach", "the CE approach (Smith et al., 2020)"),
      "a hyphen-break space": sentence.replace("distance thresholds,", "dis- tance thresholds,"),
    };
    for (const [what, quote] of Object.entries(accepted)) {
      expect(evidenceSupported(quote, body), what).toBe(true);
      expect(locateSection(quote, sectionCorpus(doc)), what).not.toBeNull();
    }
    // Two consecutive sentences of one section, run together, are still verbatim.
    const results = doc.sections.find((s) => s.heading === "4.4 Results")!.text;
    const at = results.indexOf(sentence);
    const next = results.slice(at + sentence.length).trim();
    expect(next.length).toBeGreaterThan(40);
    expect(evidenceSupported(`${sentence} ${next.slice(0, 120)}`, results)).toBe(true);
  });

  // P2-10 (§1g.21 (6), A's N1). A's mutation M2 at P2-08c — compare only the
  // first 120 normalised characters of a quote (`corpus.includes(quote)` →
  // `corpus.includes(quote.slice(0, 120))`) — left the whole suite green: every
  // alteration above falls at or before character 117 (a number flipped, an
  // invented clause, an ellipsis, a splice at 80), so a 120-character prefix
  // still saw each one. These two alter a long quote's TAIL, past character 120,
  // and append to it: only the whole-quote rule rejects them. Each asserts, as
  // the P2-08b tests do, that a prefix-only rule WOULD accept it (the prefix is
  // the section's own words), so a red under M2 is that rule and not a typo.
  describe("the whole quote, tail included, on a quote past 120 characters (P2-10, A's N1)", () => {
    // A synthetic section: one long sentence, then another.
    const LONG =
      "Across all twelve specimens held at 1100 degrees for five hundred hours, the coarsened precipitate fraction rose steadily with applied stress and then levelled off near the highest load tested.";
    const NEXT = "The untreated controls showed no such plateau within the same window.";
    const section = `${LONG} ${NEXT}`;
    const sectionDoc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [{ id: "s0", heading: "3 Results", canonical: "results", text: section }],
    };
    const firstDifference = (a: string, b: string) => {
      let at = 0;
      while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
      return at;
    };

    /** What a prefix-only rule would accept: the quote's first 120 normalised
     *  characters are in the section, and the quote itself is not. */
    function expectPastTheHead(quote: string, what: string) {
      const normal = normalizeForMatch(quote);
      expect(normal.length, what).toBeGreaterThan(120);
      expect(normalizeForMatch(section), `${what}: head`).toContain(normal.slice(0, 120));
      expect(firstDifference(normalizeForMatch(LONG), normal), `${what}: first changed character`).toBeGreaterThanOrEqual(120);
    }

    it("starts from a quote that really is long, and accepts it whole, and with the next sentence run on", () => {
      expect(normalizeForMatch(LONG).length).toBeGreaterThan(150);
      expect(evidenceSupported(LONG, section)).toBe(true);
      expect(evidenceSupported(`${LONG} ${NEXT}`, section)).toBe(true);
      expect(locateSection(LONG, sectionCorpus(sectionDoc))).not.toBeNull();
    });

    it("rejects a long quote whose last words were altered, though its first 120 characters are the section's", () => {
      const altered: Record<string, string> = {
        "the last three words swapped": LONG.replace("the highest load tested", "the lowest load measured"),
        "the last word changed": LONG.replace("tested.", "applied."),
        "the closing clause reversed": LONG.replace("levelled off near the highest load tested", "tested the highest load near levelled off"),
      };
      for (const [what, quote] of Object.entries(altered)) {
        expect(quote, what).not.toBe(LONG);
        expectPastTheHead(quote, what);
        expect(evidenceSupported(quote, section), what).toBe(false);
        expect(locateSection(quote, sectionCorpus(sectionDoc)), what).toBeNull();
      }
    });

    it("rejects a long quote with a clause appended after its last word, though its first 120 characters are the section's", () => {
      const appended: Record<string, string> = {
        "a clause after the last word": LONG.replace(/\.$/, ", and the control arm failed in every single trial."),
        "a second sentence after the full stop": `${LONG} The control arm failed in every single trial.`,
        "a trailing fragment": `${LONG} and`,
      };
      for (const [what, quote] of Object.entries(appended)) {
        expect(quote, what).not.toBe(LONG);
        expectPastTheHead(quote, what);
        expect(evidenceSupported(quote, section), what).toBe(false);
        expect(locateSection(quote, sectionCorpus(sectionDoc)), what).toBeNull();
      }
    });
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

  it("1-17: a model's verbatim-correct quote matches a corpus garbled by the fraction-slash artifact", () => {
    // The corpus is what PyMuPDF actually extracted from the PDF (the
    // artifact); the quote is how a human — and the model — would
    // transcribe the same sentence. Neither side is edited to make them
    // match; normalizeForMatch's symmetric fold does that.
    const garbledCorpus =
      "we find that the ahts with ld ⁄ = 0.67 and 0.78 lie above el for all temperatures measured.";
    const modelQuote =
      "We find that the AHTS with L/d = 0.67 and 0.78 lie above EL for all temperatures measured.";
    expect(evidenceSupported(modelQuote, garbledCorpus)).toBe(true);
  });

  it("1-17: the fraction fold does not turn a paraphrase into a match", () => {
    const garbledCorpus =
      "we find that the ahts with ld ⁄ = 0.67 and 0.78 lie above el for all temperatures measured.";
    const paraphrase =
      "The AHTS samples with a length-to-diameter ratio of 0.67 and 0.78 sit above the EL curve.";
    expect(evidenceSupported(paraphrase, garbledCorpus)).toBe(false);
  });

  it("2-02: a model's clean quote matches a corpus garbled by a hyphenated PDF line-break", () => {
    // Real defect found on openalex:W7207740551: PyMuPDF's extraction joins
    // "high-energy" wrapped across a line break as "high- energy" (hyphen,
    // then a space) — the model's own quote has no reason to reproduce that
    // space, so the verbatim match must still be found.
    const garbledCorpus =
      "all four superlattices were grown by molecular beam epitaxy (mbe) on lasralo4 (001) " +
      "substrates, with the assembly of each monolayer monitored in real time using reflection " +
      "high- energy electron diffraction (rheed).";
    const modelQuote =
      "All four superlattices were grown by molecular beam epitaxy (MBE) on LaSrAlO4 (001) " +
      "substrates, with the assembly of each monolayer monitored in real time using reflection " +
      "high-energy electron diffraction (RHEED).";
    expect(evidenceSupported(modelQuote, garbledCorpus)).toBe(true);
  });

  it("2-02: the hyphenation fold does not turn a paraphrase into a match", () => {
    const garbledCorpus =
      "all four superlattices were grown by molecular beam epitaxy (mbe) on lasralo4 (001) " +
      "substrates, with the assembly of each monolayer monitored in real time using reflection " +
      "high- energy electron diffraction (rheed).";
    const paraphrase =
      "Every superlattice sample was fabricated via MBE growth and checked in situ with RHEED.";
    expect(evidenceSupported(paraphrase, garbledCorpus)).toBe(false);
  });

  it("4-02: a model's clean quote matches a corpus garbled by an ar5iv zero-width-space artifact", () => {
    // ar5iv's MathML-to-text rendering emits a zero-width space (U+200B)
    // where a genuine word-boundary space belongs, e.g. splitting a
    // learning-rate value from the exponent notation around it — the
    // model's own copied quote has an ordinary space there instead.
    const garbledCorpus =
      "we trained every model with a learning rate of 4\u200Be - 4 and a batch size of 32, " +
      "annealed over 100 epochs using a cosine schedule.";
    const modelQuote =
      "We trained every model with a learning rate of 4 e - 4 and a batch size of 32, " +
      "annealed over 100 epochs using a cosine schedule.";
    expect(evidenceSupported(modelQuote, garbledCorpus)).toBe(true);
  });

  it("4-02: the zero-width-space fold does not turn a paraphrase into a match", () => {
    const garbledCorpus =
      "we trained every model with a learning rate of 4\u200Be - 4 and a batch size of 32, " +
      "annealed over 100 epochs using a cosine schedule.";
    const paraphrase =
      "Training used a small learning rate and a moderate batch size, with a gradually " +
      "decreasing schedule across the run.";
    expect(evidenceSupported(paraphrase, garbledCorpus)).toBe(false);
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

  // P2-08b (§1g.16, F1): the verifier holds every claim to the whole quote —
  // a flipped number past character 80 is not the paper's sentence, and the
  // page must not print it, italic and linked, as if it were.
  it("drops and counts a key result whose middle was altered, beside an exact one it keeps (P2-08b, §1g.16)", () => {
    const flipped = RESULTS_SENTENCE.replace("an 85% success rate", "a 15% success rate");
    const { report: verified, dropped } = verifyReportEvidence(
      report({
        resultsAndSignificance: {
          summary: "",
          keyResults: [
            { title: "Exact", detail: "85% on MRI.", evidence: RESULTS_SENTENCE },
            { title: "Flipped", detail: "15% on MRI.", evidence: flipped },
          ],
        },
        skim: [{ text: "Flipped skim.", evidence: flipped }],
      }),
      { abstract, doc },
    );

    expect(dropped).toBe(2);
    expect(verified.provenance.droppedClaims).toBe(2);
    expect(verified.resultsAndSignificance.keyResults.map((r) => r.title)).toEqual(["Exact"]);
    expect(verified.skim).toEqual([]);
  });

  it("1-17: a verbatim figure-caption quote is kept — buildCorpus now includes figureCaptions", () => {
    // A minimal doc of our own (not the shared fixture): the caption
    // sentence appears nowhere else, so this proves buildCorpus reads
    // figureCaptions and not some other section that happens to repeat it.
    const captionSentence =
      "The superconducting dome narrows sharply as the layer ratio approaches its critical value.";
    const miniDoc: ExtractedDocument = {
      sections: [
        { id: "s0", heading: "Introduction", canonical: "introduction", text: "This paper studies a layered superlattice." },
      ],
      figureCaptions: [{ ordinal: 0, label: "Figure 7", caption: captionSentence }],
      source: "pdf",
    };
    const { report: verified, dropped } = verifyReportEvidence(
      report({
        resultsAndSignificance: {
          summary: "",
          keyResults: [
            { title: "Dome narrowing", detail: "Seen in the figure.", evidence: captionSentence },
          ],
        },
      }),
      { abstract: "", doc: miniDoc },
    );

    expect(dropped).toBe(0);
    expect(verified.resultsAndSignificance.keyResults).toHaveLength(1);
    expect(verified.resultsAndSignificance.keyResults[0].evidenceWhere).toBe("Figure 7");
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

// P2-01 (§1g.1): the question pass's sentences are checked against the
// document by section — the same forgiving verbatim match, answering with
// the id of the section that holds the sentence.
describe("locateSection — which section holds a verbatim sentence (P2-01)", () => {
  const small: ExtractedDocument = {
    source: "pdf",
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "Abstract", canonical: "abstract", text: "We charged quillwort cells fast and opened every one of them." },
      { id: "s1", heading: "1 Methods", canonical: "methods", text: "We cycled twelve quillwort cells at three charge rates for one month." },
      { id: "s2", heading: "2 Results", canonical: "results", text: "Cracking along the grain boundaries rose with the charge rate [4] in every cell." },
    ],
  };
  const corpus = sectionCorpus(small);

  it("finds the section, preferring the one the model named when it holds the sentence", () => {
    expect(locateSection("We cycled twelve quillwort cells at three charge rates for one month.", corpus)).toBe("s1");
    expect(locateSection("Cracking along the grain boundaries rose with the charge rate in every cell.", corpus, "s2")).toBe("s2");
    // A wrong id is corrected by where the sentence actually is.
    expect(locateSection("We cycled twelve quillwort cells at three charge rates for one month.", corpus, "s2")).toBe("s1");
  });

  it("finds nothing for a paraphrase or a fragment too short to trust", () => {
    expect(locateSection("We cycled a dozen cells at several rates for about a month.", corpus)).toBeNull();
    expect(locateSection("Cracking rose.", corpus)).toBeNull();
  });

  it("names a section that has no id the way withSectionIds would", () => {
    const noIds = { ...small, sections: small.sections.map(({ heading, canonical, text }) => ({ heading, canonical, text })) } as unknown as ExtractedDocument;
    expect(locateSection("We cycled twelve quillwort cells at three charge rates for one month.", sectionCorpus(noIds))).toBe("s1");
  });
});

// ── P4-04 (§1h.8 (8), BACKLOG-13's open half): one function shows a verified quote to its sentence boundaries ──
// All text below is invented. `shapeEvidenceQuote(sectionText, quote, cap)` takes the section as the paper
// has it and a quote the verifier accepts; it returns the text to show — the paper's own characters, the
// quote extended to the sentence's start and end when the whole fits `cap`, else the quote as it is with "…"
// at each end that is a cut — or null when the quote cannot be found in the section's own characters.

describe("shapeEvidenceQuote (P4-04)", () => {
  const CAP = 400;
  const S1 = "Intro sentence is here to open the section.";
  const S2 = "The alloy softened at 300 K under the load applied by the press.";
  const S3 = "After that it held for the rest of the run.";
  const SECTION = `${S1} ${S2} ${S3}`;

  it("extends a quote that starts inside a sentence to that sentence's start", () => {
    expect(shapeEvidenceQuote(SECTION, "softened at 300 K under the load applied by the press.", CAP)).toBe(S2);
  });

  it("extends a quote that stops inside a sentence to that sentence's end", () => {
    expect(shapeEvidenceQuote(SECTION, "The alloy softened at 300 K under the load", CAP)).toBe(S2);
  });

  it("extends both ends at once", () => {
    expect(shapeEvidenceQuote(SECTION, "softened at 300 K under the load", CAP)).toBe(S2);
  });

  it("leaves a quote that is already a whole sentence as it is, and one that is several whole sentences", () => {
    expect(shapeEvidenceQuote(SECTION, S2, CAP)).toBe(S2);
    expect(shapeEvidenceQuote(SECTION, `${S2} ${S3}`, CAP)).toBe(`${S2} ${S3}`);
  });

  it("takes in the sentence's closing full stop when the quote stopped just before it, and marks no cut", () => {
    expect(shapeEvidenceQuote(SECTION, S2.slice(0, -1), S2.length)).toBe(S2);
    // The full stop does not fit the cap: still not a cut, nothing but punctuation is left out.
    expect(shapeEvidenceQuote(SECTION, S2.slice(0, -1), S2.length - 1)).toBe(S2.slice(0, -1));
  });

  it("extends a quote that spans two sentences at both outer ends", () => {
    expect(shapeEvidenceQuote(SECTION, "under the load applied by the press. After that it held", CAP)).toBe(`${S2} ${S3}`);
  });

  it("keeps the paper's own white space collapsed, whatever line breaks the section has", () => {
    const wrapped = `${S1}\n\nThe alloy softened at 300 K\nunder the load applied by the press.\n\n${S3}`;
    expect(shapeEvidenceQuote(wrapped, "softened at 300 K under the load", CAP)).toBe(S2);
  });

  describe("over the cap: the quote as it is, the cut marked at each end that is a cut", () => {
    const LONG = "The first clause of this long sentence says that the alloy softened at 300 K under load, but the second clause reverses it and says the alloy hardened again once the press was released and the run was over.";
    const SEC = `${S1} ${LONG} ${S3}`;
    const CAP2 = 120;

    it("marks the end that stops inside the sentence", () => {
      const quote = "The first clause of this long sentence says that the alloy softened at 300 K under load,";
      const shown = shapeEvidenceQuote(SEC, quote, CAP2);
      expect(shown).toBe(`${quote}…`);
    });

    it("marks the start that begins inside the sentence", () => {
      const quote = "the second clause reverses it and says the alloy hardened again once the press was released and the run was over.";
      expect(shapeEvidenceQuote(SEC, quote, CAP2)).toBe(`…${quote}`);
    });

    it("marks both ends when both are cuts", () => {
      const quote = "the alloy softened at 300 K under load, but the second clause reverses it";
      expect(shapeEvidenceQuote(SEC, quote, CAP2)).toBe(`…${quote}…`);
    });

    it("marks only the cut end of a quote that starts on the sentence's start", () => {
      const quote = "The first clause of this long sentence says that the alloy softened at 300 K under load, but";
      const shown = shapeEvidenceQuote(SEC, quote, CAP2) as string;
      expect(shown.startsWith("…")).toBe(false);
      expect(shown.endsWith("…")).toBe(true);
    });

    it("binds the whole shown text, ellipses included, to the cap", () => {
      const quote = "the alloy softened at 300 K under load, but the second clause reverses it and says the alloy hardened";
      const shown = shapeEvidenceQuote(SEC, quote, 80) as string;
      expect(shown.length).toBeLessThanOrEqual(80);
      expect(shown.startsWith("…")).toBe(true);
      expect(shown.endsWith("…")).toBe(true);
      expect(quote.includes(shown.slice(1, -1).trim())).toBe(true);
    });

    it("extends when the whole sentence fits exactly, and marks the cut when it is one character over", () => {
      const quote = "The first clause of this long sentence says that the alloy softened";
      expect(shapeEvidenceQuote(SEC, quote, LONG.length)).toBe(LONG);
      expect(shapeEvidenceQuote(SEC, quote, LONG.length - 1)).toBe(`${quote}…`);
    });
  });

  describe("abbreviations and decimals do not end a sentence", () => {
    const SENT = "Fig. 3 shows 0.4 V across the cell, as Smith et al. reported in a note e.g. for the early run.";
    const SEC = `Before this came a short line. ${SENT} After it came another.`;

    it("extends back past 'Fig.' and a decimal to the true start", () => {
      expect(shapeEvidenceQuote(SEC, "across the cell, as Smith et al. reported in a note e.g. for the early run.", CAP)).toBe(SENT);
    });

    it("extends forward past 'et al.' and 'e.g.' to the true end", () => {
      expect(shapeEvidenceQuote(SEC, "Fig. 3 shows 0.4 V across the cell, as Smith et al.", CAP)).toBe(SENT);
      expect(shapeEvidenceQuote(SEC, "shows 0.4 V across the cell, as Smith et al. reported in a note e.g.", CAP)).toBe(SENT);
    });
  });

  describe("the paper's own characters, citation brackets and notation included", () => {
    it("shows the paper's brackets when the model's quote left them out", () => {
      const sec = "Opening line of the section stands here. The value of f_cell was measured [12] at 300 K [3, 4] under the load. Closing line stands here.";
      const shown = shapeEvidenceQuote(sec, "f_cell was measured at 300 K under the load.", CAP);
      expect(shown).toBe("The value of f_cell was measured [12] at 300 K [3, 4] under the load.");
    });

    it("shows `f_cell` and `α_1` when the model's copy lost the underscore", () => {
      const sec = "Opening line of the section stands here. The slope α_1 tracked f_cell closely across every specimen run. Closing line.";
      expect(shapeEvidenceQuote(sec, "slope α1 tracked fcell closely across every specimen", CAP)).toBe("The slope α_1 tracked f_cell closely across every specimen run.");
    });

    it("never invents a character: the shown text is a stretch of the section", () => {
      const sec = "Opening line of the section stands here. The value of f_cell was measured [12] at 300 K under the load. Closing line.";
      const flat = sec.replace(/\s+/g, " ");
      for (const quote of ["value of f_cell was measured at 300 K", "f_cell was measured [12] at 300 K under the load.", "was measured"]) {
        for (const cap of [30, 60, 400]) {
          const shown = shapeEvidenceQuote(sec, quote, cap);
          if (shown === null) continue;
          expect(flat.includes(shown.replace(/^…/, "").replace(/…$/, "").trim()), `${quote} @ ${cap}`).toBe(true);
        }
      }
    });
  });

  it("returns null for a quote that is not in the section, so the caller falls back; never extends one", () => {
    expect(shapeEvidenceQuote(SECTION, "the alloy hardened at 300 K under the load applied by the press", CAP)).toBeNull();
    expect(shapeEvidenceQuote("", "softened at 300 K", CAP)).toBeNull();
    expect(shapeEvidenceQuote(SECTION, "", CAP)).toBeNull();
  });

  it("finds a quote that is cased or spaced differently from the section, and shows the section's text", () => {
    expect(shapeEvidenceQuote(SECTION, "the ALLOY softened   at 300 K under the load", CAP)).toBe(S2);
  });
});
