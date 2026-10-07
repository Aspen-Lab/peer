import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "./full-text";
import type { ExtractedDocument, ExtractedSection } from "./html-text";
import { buildReading } from "./reading";
import { GIST_QUESTION, readableSections } from "./reading-map";
import { REPORT_CAPS, type PaperTerm } from "./report";
import {
  MAX_DEFINITION_CHARS,
  MAX_TERMS,
  firstOccurrence,
  mergeTerms,
  paperDefinedTerms,
  paperDefinedTermsInReading,
  routeTermScope,
} from "./terms";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";
import type { Paper } from "@/types";

// P3-01 (ruling §1h.1; blueprint §3.5 ⑤ 词): the terms a paper defines in
// its own sentences (Tier 0), the merge with the model's, and where a term
// first stands in the body. Pure; no model, no DOM.

type Draft = Pick<ExtractedSection, "heading" | "canonical" | "text"> & { page?: number };

/** A document whose sections carry ids in order, as every extractor's do. */
function docOf(...sections: Draft[]): ExtractedDocument {
  return {
    source: "pdf",
    figureCaptions: [],
    sections: sections.map((section, index) => ({ ...section, id: `s${index}` })),
  };
}

const methods = (text: string, page?: number): Draft => ({ heading: "2 Methods", canonical: "methods", text, ...(page ? { page } : {}) });
const results = (text: string, page?: number): Draft => ({ heading: "3 Results", canonical: "results", text, ...(page ? { page } : {}) });
const intro = (text: string, page?: number): Draft => ({ heading: "1 Introduction", canonical: "introduction", text, ...(page ? { page } : {}) });
const conclusion = (text: string): Draft => ({ heading: "4 Conclusion", canonical: "conclusion", text });

const names = (terms: readonly PaperTerm[]) => terms.map((term) => term.term);

describe("paperDefinedTerms — the five patterns of blueprint §3.5", () => {
  it("X (ABBR): a long form followed by its abbreviation in brackets", () => {
    const sentence = "We run the circuits on Quantum Processing Units (QPU) after calibration.";
    const terms = paperDefinedTerms(docOf(methods(sentence, 4)));

    expect(terms).toEqual([
      {
        term: "QPU",
        definition: sentence,
        evidence: sentence,
        evidenceWhere: "2 Methods",
        sectionId: "s0",
        page: 4,
      },
    ]);
  });

  it("ABBR (X): an abbreviation followed by its long form in brackets", () => {
    const sentence = "The cathode is LCO (lithium cobalt oxide) cycled at room temperature.";
    const terms = paperDefinedTerms(docOf(methods(sentence)));

    expect(names(terms)).toEqual(["LCO"]);
    expect(terms[0].evidence).toBe(sentence);
  });

  it("X, defined as …", () => {
    const sentence = "The creep rate, defined as the strain accumulated per hour, rose with stress.";
    const terms = paperDefinedTerms(docOf(results(sentence)));

    expect(names(terms)).toEqual(["creep rate"]);
    expect(terms[0].definition).toBe(sentence);
  });

  it("X is defined as …, with the adverb a paper puts there", () => {
    const terms = paperDefinedTerms(docOf(results("The dwell penalty is then defined as the ratio of the two lives.")));

    expect(names(terms)).toEqual(["dwell penalty"]);
  });

  it("X refers to …", () => {
    const sentence = "Rafting refers to the directional coarsening of precipitates under load.";
    const terms = paperDefinedTerms(docOf(methods(sentence)));

    expect(names(terms)).toEqual(["Rafting"]);
    expect(terms[0].evidence).toBe(sentence);
  });

  it("we define X as …", () => {
    const sentence = "We define dwell fatigue as cycling with a hold at peak load.";
    const terms = paperDefinedTerms(docOf(methods(sentence)));

    expect(names(terms)).toEqual(["dwell fatigue"]);
    expect(terms[0].evidence).toBe(sentence);
  });

  it("each hit is one verbatim sentence of one rendered paragraph, with its section's heading, id and page", () => {
    const paragraph = "Samples were cut from one ingot. Rafting refers to the directional coarsening of precipitates under load. Twelve were tested.";
    const doc = docOf(intro("Nothing is defined here."), methods(`${paragraph}\n\nA second paragraph.`, 3));
    const [term] = paperDefinedTerms(doc);

    expect(term.evidence).toBe("Rafting refers to the directional coarsening of precipitates under load.");
    expect(term.definition).toBe(term.evidence);
    expect(paragraph.includes(term.evidence!)).toBe(true);
    expect(term.evidenceWhere).toBe("2 Methods");
    expect(term.sectionId).toBe("s1");
    expect(term.page).toBe(3);
  });

  it("has no page where the source has none (an HTML paper)", () => {
    const [term] = paperDefinedTerms(docOf(methods("Rafting refers to the directional coarsening of precipitates.")));

    expect(term).not.toHaveProperty("page");
  });

  it("finds several in one paragraph, in the order they stand", () => {
    const text =
      "Rafting refers to the directional coarsening of precipitates. We define dwell fatigue as cycling with a hold at peak load. " +
      "Specimens ran on Quantum Processing Units (QPU) overnight.";

    expect(names(paperDefinedTerms(docOf(methods(text))))).toEqual(["Rafting", "dwell fatigue", "QPU"]);
  });
});

describe("paperDefinedTerms — what is not a term", () => {
  const none = (text: string) => expect(paperDefinedTerms(docOf(methods(text)))).toEqual([]);

  it("rejects a bracket that is not an abbreviation of the words before it", () => {
    none("The effect was clear in the new method (CAT) and in the old one.");
    none("The rate is shown in Figure 2 (ABC) for every run.");
    none("The rate is shown in the second table (Table 2) for every run.");
    none("The sample (a) was cut first.");
  });

  it("rejects a pronoun or a one-word stoplist word as a term", () => {
    none("It refers to the thing above.");
    none("This, defined as the sum of the parts, is small.");
    none("Which refers to the other column.");
  });

  it("rejects a term shorter than two characters", () => {
    none("X refers to the horizontal axis of the plot.");
    none("We define x as the distance from the surface.");
  });

  it("rejects a generic word the route also ignores", () => {
    none("Data refers to everything the instrument wrote to disk.");
  });

  it("skips a sentence that carries a formula (the quote would show bare TeX), an equation's debris, or runs past the evidence cap", () => {
    none(`We define the loss ${MATH_OPEN}L = \\sum_i x_i${MATH_CLOSE} as the sum of the squared errors.`);
    // A PDF's equation arrives as characters in the sentence, not as a marked formula.
    none("The dwell penalty is then defined as D = t_h / t_c for every run in the set.");
    none("The sum \u2211 over runs, defined as the total of the squared errors, is small.");
    none("The cumulative probability is Fi \u2208 [0, 1] so Rafting refers to the directional coarsening of precipitates.");
    none(`Rafting refers to ${"the directional coarsening of precipitates ".repeat(12)}under load.`);
    expect(MAX_DEFINITION_CHARS).toBe(REPORT_CAPS.evidenceChars);
  });

  it("finds nothing in a paper that defines nothing", () => {
    expect(paperDefinedTerms(docOf(methods("Twelve samples were cut. They were cycled for a month.")))).toEqual([]);
  });
});

describe("paperDefinedTerms — abbreviation logic reused from term-expand (not copied)", () => {
  it("accepts a bracket the abbreviation table knows, though its letters are not the initials", () => {
    // "lithium cobalt oxide" / "licoo2" is one ABBREVIATION_GROUPS entry; LiCoO2 is not an initialism of it.
    const terms = paperDefinedTerms(docOf(methods("The cathode is lithium cobalt oxide (LiCoO2) in every cell.")));

    expect(names(terms)).toEqual(["LiCoO2"]);
  });

  it("accepts an initialism of any long form, a plural abbreviation, and a hyphenated word that counts as two", () => {
    const text =
      "Classifiers include support vector machines (SVMs) and hidden Markov models (HMMs). " +
      "The scoring uses the Miyazawa-Jernigan (MJ) potentials. " +
      "A multi-layer perceptron (MLP) maps the embeddings.";

    expect(names(paperDefinedTerms(docOf(methods(text))))).toEqual(["SVMs", "HMMs", "MJ", "MLP"]);
  });

  it("takes the shortest run of words before the bracket that spells the abbreviation, leaving the sentence's other words out", () => {
    const terms = paperDefinedTerms(docOf(methods("Machine learning (ML) and artificial intelligence (AI) based methods are common.")));

    expect(names(terms)).toEqual(["ML", "AI"]);
  });
});

describe("paperDefinedTerms — scope (§1h.1)", () => {
  const doc = docOf(
    intro("Quantum Processing Units (QPU) are the target hardware."),
    methods("We define dwell fatigue as cycling with a hold at peak load."),
    results("The creep rate, defined as the strain accumulated per hour, rose with stress."),
    conclusion("Rafting refers to the directional coarsening of precipitates."),
  );

  it("with no scope, reads the methods and results sections only", () => {
    expect(names(paperDefinedTerms(doc))).toEqual(["dwell fatigue", "creep rate"]);
  });

  it("with a scope, reads exactly the sections it names, whatever their bucket", () => {
    expect(names(paperDefinedTerms(doc, { sectionIds: ["s0", "s3"] }))).toEqual(["QPU", "Rafting"]);
    expect(names(paperDefinedTerms(doc, { sectionIds: ["s1"] }))).toEqual(["dwell fatigue"]);
  });

  it("falls back to the whole body when the paper has no methods or results section", () => {
    const plain = docOf(intro("Quantum Processing Units (QPU) are the target hardware."), conclusion("Rafting refers to the directional coarsening."));

    expect(names(paperDefinedTerms(plain))).toEqual(["QPU", "Rafting"]);
  });

  it("an empty scope, or one naming no section of the paper, is no scope at all", () => {
    expect(names(paperDefinedTerms(doc, { sectionIds: [] }))).toEqual(["dwell fatigue", "creep rate"]);
    expect(names(paperDefinedTerms(doc, { sectionIds: ["s99"] }))).toEqual(["dwell fatigue", "creep rate"]);
  });

  it("never reads the abstract (the page sets it from the record, not from the body)", () => {
    const withAbstract = docOf(
      { heading: "Abstract", canonical: "abstract", text: "Rafting refers to the directional coarsening of precipitates." },
      methods("We define dwell fatigue as cycling with a hold at peak load."),
    );

    expect(names(paperDefinedTerms(withAbstract, { sectionIds: ["s0", "s1"] }))).toEqual(["dwell fatigue"]);
  });
});

describe("paperDefinedTerms — the cap and the first occurrence", () => {
  const abbreviations = [
    "Alpha Beta Gamma (ABG)", "Delta Epsilon Zeta (DEZ)", "Eta Theta Iota (ETI)", "Kappa Lambda Mu (KLM)",
    "Nu Xi Omicron (NXO)", "Pi Rho Sigma (PRS)", "Tau Upsilon Phi (TUP)", "Chi Psi Omega (CPO)",
    "Ant Bee Cat (ABC)", "Dog Eel Fox (DEF)",
  ];

  it("returns at most eight, the first eight in reading order", () => {
    const terms = paperDefinedTerms(docOf(methods(abbreviations.map((a) => `We use ${a} here.`).join(" "))));

    expect(MAX_TERMS).toBe(REPORT_CAPS.terms);
    expect(terms).toHaveLength(8);
    expect(names(terms)).toEqual(["ABG", "DEZ", "ETI", "KLM", "NXO", "PRS", "TUP", "CPO"]);
  });

  it("keeps the first definition of a term, whatever the case, and drops the later ones", () => {
    const first = "Rafting refers to the directional coarsening of precipitates under load.";
    const doc = docOf(methods(first), results("rafting refers to a different thing in this later section."));
    const terms = paperDefinedTerms(doc);

    expect(terms).toHaveLength(1);
    expect(terms[0].evidence).toBe(first);
    expect(terms[0].sectionId).toBe("s0");
  });

  it("counts a plural and a singular as one term", () => {
    const doc = docOf(methods("We use support vector machines (SVMs) here. A support vector machine (SVM) is trained."));

    expect(paperDefinedTerms(doc)).toHaveLength(1);
  });
});

describe("paperDefinedTermsInReading — the browser's route to the same terms", () => {
  const paper: Paper = {
    id: "upload:00000000000000aa", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const readingOf = (doc: ExtractedDocument) =>
    buildReading(
      paper,
      { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } } as FullTextResult,
      new Date("2026-10-05T00:00:00.000Z"),
    );

  it("finds what the document route finds, with the page the map carries", () => {
    const doc = docOf(
      { heading: "Abstract", canonical: "abstract", text: "Nothing." },
      intro("Quantum Processing Units (QPU) are the target hardware.", 1),
      methods("We define dwell fatigue as cycling with a hold at peak load.", 2),
      results("The creep rate, defined as the strain accumulated per hour, rose with stress.", 3),
    );

    expect(paperDefinedTermsInReading(readingOf(doc))).toEqual(paperDefinedTerms(doc));
    expect(paperDefinedTermsInReading(readingOf(doc), { sectionIds: ["s1"] })).toEqual(paperDefinedTerms(doc, { sectionIds: ["s1"] }));
    expect(paperDefinedTermsInReading(readingOf(doc)).map((term) => term.page)).toEqual([2, 3]);
  });

  it("reads a page with no body as having no terms", () => {
    expect(paperDefinedTermsInReading({ body: [], map: undefined })).toEqual([]);
  });
});

const FIXTURES = join(__dirname, "__fixtures__");
const fixture = (name: string): ExtractedDocument => JSON.parse(readFileSync(join(FIXTURES, `${name}.doc.json`), "utf8")) as ExtractedDocument;

describe("the three committed fixtures", () => {
  // Each fixture holds an abbreviation or a definition the paper wrote in its
  // methods or results (the default scope), so each yields ≥ 1 term.
  const expected: Record<string, string[]> = {
    "arxiv-2609.02113": ["NERF", "QPU"],
    "arxiv-2609.02697": ["SSIM", "LPIPS"],
    "zenodo-W7208807247": ["GCN", "MLP"],
  };

  for (const [name, wanted] of Object.entries(expected)) {
    it(`${name} yields its own definitions, each a verbatim sentence of the body`, () => {
      const doc = fixture(name);
      const terms = paperDefinedTerms(doc);
      const paragraphs = readableSections(doc).flatMap((section) => section.paragraphs);

      expect(terms.length).toBeGreaterThanOrEqual(1);
      expect(terms.length).toBeLessThanOrEqual(MAX_TERMS);
      for (const wantedTerm of wanted) expect(names(terms)).toContain(wantedTerm);
      for (const term of terms) {
        expect(paragraphs.some((paragraph) => paragraph.includes(term.evidence!))).toBe(true);
        expect(term.evidence!.length).toBeLessThanOrEqual(MAX_DEFINITION_CHARS);
        expect(term.evidence).toContain(term.term.replace(/s$/, ""));
      }
      expect(new Set(names(terms).map((t) => t.toLowerCase().replace(/s$/, ""))).size).toBe(terms.length);
    });
  }
});

const tier0 = (term: string): PaperTerm => ({ term, definition: `${term} is defined here in the paper.`, evidence: `${term} is defined here in the paper.`, evidenceWhere: "2 Methods", sectionId: "s1" });

describe("mergeTerms — Tier 2 after Tier 0 (§1h.1)", () => {
  it("returns the Tier 0 terms alone when the model gave none", () => {
    expect(mergeTerms([tier0("QPU")], undefined)).toEqual([tier0("QPU")]);
    expect(mergeTerms([tier0("QPU")], [])).toEqual([tier0("QPU")]);
    expect(mergeTerms([], undefined)).toEqual([]);
  });

  it("puts the Tier 0 terms first, then the model's that are not already there, whatever the case", () => {
    const model: PaperTerm[] = [
      { term: "qpu", definition: "A quantum chip.", peer: true },
      { term: "Ansatz", definition: "A trial circuit.", peer: true },
    ];

    expect(names(mergeTerms([tier0("QPU"), tier0("NERF")], model))).toEqual(["QPU", "NERF", "Ansatz"]);
  });

  it("keeps a verified model term as it came, and marks one without evidence as Peer's", () => {
    const verified: PaperTerm = { term: "Ansatz", definition: "A trial circuit.", evidence: "The ansatz is a parametrised circuit of rotations.", evidenceWhere: "2 Methods", sectionId: "s1", page: 4 };
    const bare = { term: "Qubit", definition: "A two-state quantum system." } as PaperTerm;
    const merged = mergeTerms([], [verified, bare]);

    expect(merged[0]).toEqual(verified);
    expect(merged[0]).not.toHaveProperty("peer");
    expect(merged[1]).toEqual({ term: "Qubit", definition: "A two-state quantum system.", peer: true });
  });

  it("never exceeds eight in all, and drops a model term that repeats another model term", () => {
    const six = ["Ant", "Bee", "Cat", "Dog", "Eel", "Fox"].map(tier0);
    const model: PaperTerm[] = ["Gnu", "gnu", "Hen", "Ibis"].map((term) => ({ term, definition: "d", peer: true }));

    expect(names(mergeTerms(six, model))).toEqual(["Ant", "Bee", "Cat", "Dog", "Eel", "Fox", "Gnu", "Hen"]);
    expect(mergeTerms(["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8", "I9"].map(tier0), model)).toHaveLength(8);
  });
});

describe("firstOccurrence — where a term first stands in the body", () => {
  const body = [
    { id: "s1", paragraphs: ["Creep limits the life of hot parts.", "Rafting is seen after long holds."] },
    { id: "s2", paragraphs: ["Twelve samples were cut.", "More rafting followed, and rafting spread."] },
  ];

  it("names the section, the paragraph and the offset of the earliest occurrence, in body order", () => {
    const hit = firstOccurrence(body, "rafting");

    expect(hit).toMatchObject({ sectionId: "s1", sectionIndex: 0, paragraphIndex: 1, offset: 0, length: 7 });
    expect(body[0].paragraphs[1].slice(hit!.offset, hit!.offset + hit!.length)).toBe("Rafting");
  });

  it("finds the term inside a longer paragraph at the right offset", () => {
    const hit = firstOccurrence(body, "life");

    expect(hit).toMatchObject({ sectionId: "s1", paragraphIndex: 0 });
    expect(body[0].paragraphs[0].slice(hit!.offset, hit!.offset + hit!.length)).toBe("life");
  });

  it("matches whole words only", () => {
    expect(firstOccurrence([{ id: "s1", paragraphs: ["The separate runs ran apart."] }], "rate")).toBeNull();
    expect(firstOccurrence([{ id: "s1", paragraphs: ["The rates rose."] }], "rate")).toMatchObject({ offset: 4, length: 5 });
  });

  it("is case-sensitive for an acronym and case-blind for a word", () => {
    const paragraphs = ["The nerf was gentle.", "The NERF algorithm runs."];
    const hit = firstOccurrence([{ id: "s1", paragraphs }], "NERF");

    expect(hit).toMatchObject({ paragraphIndex: 1 });
    expect(firstOccurrence([{ id: "s1", paragraphs }], "Nerf")).toMatchObject({ paragraphIndex: 0 });
  });

  it("finds a plural by its singular and a hyphen by a space", () => {
    expect(firstOccurrence([{ id: "s1", paragraphs: ["We trained SVMs."] }], "SVM")).toMatchObject({ length: 4 });
    const hit = firstOccurrence([{ id: "s1", paragraphs: ["Along each grain-boundary the strain rose."] }], "grain boundary");

    expect(hit).toMatchObject({ offset: 11, length: 14 });
  });

  it("finds the abbreviation the paper wrote for a term, by the abbreviation table", () => {
    const hit = firstOccurrence([{ id: "s1", paragraphs: ["The cells use an LCO cathode.", "Lithium cobalt oxide is brittle."] }], "lithium cobalt oxide");

    expect(hit).toMatchObject({ paragraphIndex: 0 });
  });

  it("never lands inside a formula", () => {
    const paragraph = `The load ${MATH_OPEN}QPU_{k}${MATH_CLOSE} is applied to the QPU twice.`;
    const hit = firstOccurrence([{ id: "s1", paragraphs: [paragraph] }], "QPU");

    expect(hit!.offset).toBe(paragraph.lastIndexOf("QPU"));
    expect(firstOccurrence([{ id: "s1", paragraphs: [`A ${MATH_OPEN}QPU${MATH_CLOSE} only`] }], "QPU")).toBeNull();
  });

  it("does not match across a formula that stands between two words", () => {
    expect(firstOccurrence([{ id: "s1", paragraphs: [`grain ${MATH_OPEN}x${MATH_CLOSE} boundary`] }], "grain boundary")).toBeNull();
  });

  it("returns null for a term the body never uses, and for an empty term", () => {
    expect(firstOccurrence(body, "ansatz")).toBeNull();
    expect(firstOccurrence(body, "  ")).toBeNull();
    expect(firstOccurrence([], "rafting")).toBeNull();
  });

  it("is the same on the document's rendered sections as on the page's body", () => {
    const doc = docOf(intro("Hot parts creep.\n\nRafting is seen after long holds."), results("More rafting followed."));
    const hit = firstOccurrence(readableSections(doc), "rafting");

    expect(hit).toMatchObject({ sectionId: "s0", paragraphIndex: 1, offset: 0 });
  });
});

describe("routeTermScope — the sections the route marks read or background", () => {
  const entry = (question: string, sections: Record<string, { tier: string }>, vague = false) => ({ question, vague, sections });

  it("is undefined with no route, a vague route or no marked section (the default scope then applies)", () => {
    expect(routeTermScope(undefined)).toBeUndefined();
    expect(routeTermScope({ vague: true, byQuestion: [entry("q", {}, true)] })).toBeUndefined();
    expect(routeTermScope({ vague: false, byQuestion: [entry("q", { s1: { tier: "skim" }, s2: { tier: "none" } })] })).toBeUndefined();
  });

  it("names every section any question reads or marks as background, and no skim or none", () => {
    const scope = routeTermScope({
      vague: false,
      byQuestion: [
        entry("Q1", { s1: { tier: "read" }, s2: { tier: "skim" } }),
        entry("Q2", { s2: { tier: "background" }, s3: { tier: "none" }, s4: { tier: "read" } }),
      ],
    });

    expect([...scope!.sectionIds].sort()).toEqual(["s1", "s2", "s4"]);
  });

  it("ignores a vague question and the gist (which is not a question a section could answer)", () => {
    const scope = routeTermScope({
      vague: false,
      byQuestion: [
        entry("Q1", { s9: { tier: "read" } }, true),
        entry(GIST_QUESTION, { s8: { tier: "read" } }),
        entry("Q3", { s1: { tier: "read" } }),
      ],
    });

    expect(scope).toEqual({ sectionIds: ["s1"] });
  });
});
