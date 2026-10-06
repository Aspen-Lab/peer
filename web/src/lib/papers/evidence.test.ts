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
