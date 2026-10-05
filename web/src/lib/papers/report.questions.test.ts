import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { REPORT_CAPS, sanitizePaperReport, type PaperReport } from "./report";
import { verifyReportEvidence } from "./evidence";

// P2-02 (§1g.3; acceptance §3d 9, 10): the server's hand on the answers to
// the reader's questions. The model's `question` is never trusted (the
// request's own text by index), every cap holds, every answer's evidence is
// the paper's own sentence or the answer is gone and counted, a "Read next"
// names a real section, and a term is the paper's definition or labelled as
// Peer's words. Without questions, nothing about a report changes.

const ABSTRACT = "We charged quillwort cells fast and opened every one of them afterwards.";
const SENT = {
  intro: "Quillwort cathodes are used in small cells because they store a great deal of charge.",
  methods: "We cycled twelve quillwort cells at three charge rates for one month in a warm room.",
  results: "Cracking along the grain boundaries rose with the charge rate in every cell we opened.",
};
const DOC: ExtractedDocument = {
  source: "pdf",
  figureCaptions: [{ ordinal: 1, label: "Figure 1", caption: "Cracks along grain boundaries against the charge rate in twelve cells.", page: 4 }],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: ABSTRACT },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: SENT.intro, page: 1 },
    { id: "s2", heading: "2 Methods", canonical: "methods", text: SENT.methods, page: 2 },
    { id: "s3", heading: "3 Results", canonical: "results", text: SENT.results, page: 4 },
  ],
};

/** A model answer with every block — and, volunteered, the question blocks. */
const RAW = {
  skim: [
    { text: "Fast charging cracks quillwort cathodes.", evidence: SENT.results },
    { text: "Invented.", evidence: "A sentence that the paper never wrote anywhere at all, not even once." },
  ],
  whatItProposes: {
    summary: "It charges cells fast and looks for cracks.",
    methods: [{ text: "Twelve cells at three rates.", evidence: SENT.methods }],
    newHere: ["Cracks are counted cell by cell."],
  },
  resultsAndSignificance: {
    summary: "Cracking rose with the charge rate.",
    keyResults: [{ title: "Cracks", detail: "More cracks at higher rates.", evidence: SENT.results, novelty: "First count of cracks." }],
  },
  limitations: [{ text: "One month only.", evidence: SENT.methods }],
  nextStep: { text: "Cycle for a year.", evidence: SENT.intro },
  relationToYourWork: { basedOn: "my project", items: [{ text: "Relates.", evidence: SENT.intro }] },
  forYourQuestions: [{ question: "volunteered", verdict: "answered", answers: [{ text: "x", evidence: SENT.results, sectionId: "s3" }], readNext: [] }],
  terms: [{ term: "quillwort", definition: "a plant" }],
  provenance: { basis: "model-fulltext", droppedClaims: 0 },
};

/** `sanitizePaperReport(RAW)` and `verifyReportEvidence` of it, as the code
 *  before P2-02 (28fa8cd) produced them — captured by running it. */
const BEFORE = JSON.parse(
  '{"sanitized":{"skim":[{"text":"Fast charging cracks quillwort cathodes.","evidence":"Cracking along the grain boundaries rose with the charge rate in every cell we opened."},{"text":"Invented.","evidence":"A sentence that the paper never wrote anywhere at all, not even once."}],"whatItProposes":{"summary":"It charges cells fast and looks for cracks.","methods":[{"text":"Twelve cells at three rates.","evidence":"We cycled twelve quillwort cells at three charge rates for one month in a warm room."}],"newHere":["Cracks are counted cell by cell."]},"resultsAndSignificance":{"summary":"Cracking rose with the charge rate.","keyResults":[{"title":"Cracks","detail":"More cracks at higher rates.","evidence":"Cracking along the grain boundaries rose with the charge rate in every cell we opened.","novelty":"First count of cracks."}]},"provenance":{"basis":"model-fulltext","droppedClaims":0},"limitations":[{"text":"One month only.","evidence":"We cycled twelve quillwort cells at three charge rates for one month in a warm room."}],"relationToYourWork":{"basedOn":"my project","items":[{"text":"Relates.","evidence":"Quillwort cathodes are used in small cells because they store a great deal of charge."}]},"nextStep":{"text":"Cycle for a year.","evidence":"Quillwort cathodes are used in small cells because they store a great deal of charge."}},"verified":{"report":{"skim":[{"text":"Fast charging cracks quillwort cathodes.","evidence":"Cracking along the grain boundaries rose with the charge rate in every cell we opened.","evidenceWhere":"3 Results"}],"whatItProposes":{"summary":"It charges cells fast and looks for cracks.","methods":[{"text":"Twelve cells at three rates.","evidence":"We cycled twelve quillwort cells at three charge rates for one month in a warm room.","evidenceWhere":"2 Methods"}],"newHere":["Cracks are counted cell by cell."]},"resultsAndSignificance":{"summary":"Cracking rose with the charge rate.","keyResults":[{"title":"Cracks","detail":"More cracks at higher rates.","evidence":"Cracking along the grain boundaries rose with the charge rate in every cell we opened.","novelty":"First count of cracks.","evidenceWhere":"3 Results"}]},"provenance":{"basis":"model-fulltext","droppedClaims":1},"limitations":[{"text":"One month only.","evidence":"We cycled twelve quillwort cells at three charge rates for one month in a warm room.","evidenceWhere":"2 Methods"}],"relationToYourWork":{"basedOn":"my project","items":[{"text":"Relates.","evidence":"Quillwort cathodes are used in small cells because they store a great deal of charge.","evidenceWhere":"1 Introduction"}]},"nextStep":{"text":"Cycle for a year.","evidence":"Quillwort cathodes are used in small cells because they store a great deal of charge.","evidenceWhere":"1 Introduction"}},"dropped":1}}',
) as { sanitized: PaperReport; verified: { report: PaperReport; dropped: number } };

const Q = ["Does cracking rise with the charge rate?", "How many cells were cycled?", "Is the room temperature controlled?"];

function verify(raw: unknown, questions: readonly string[] = Q) {
  return verifyReportEvidence(sanitizePaperReport(raw, { questions }), { abstract: ABSTRACT, doc: DOC });
}

describe("a report without questions is the report it was (§1g.3)", () => {
  it("sanitizes byte-identically, and drops the question blocks the model volunteered", () => {
    expect(JSON.stringify(sanitizePaperReport(RAW))).toBe(JSON.stringify(BEFORE.sanitized));
    expect(JSON.stringify(sanitizePaperReport(RAW, { questions: [] }))).toBe(JSON.stringify(BEFORE.sanitized));
    expect(sanitizePaperReport(RAW)).not.toHaveProperty("forYourQuestions");
    expect(sanitizePaperReport(RAW)).not.toHaveProperty("terms");
  });

  it("verifies byte-identically", () => {
    const verified = verifyReportEvidence(sanitizePaperReport(RAW), { abstract: ABSTRACT, doc: DOC });
    expect(JSON.stringify(verified)).toBe(JSON.stringify(BEFORE.verified));
  });
});

describe("the server's hand on forYourQuestions (§1g.3)", () => {
  it("writes the request's own question by index over the model's, and drops entries beyond the request's count", () => {
    const report = sanitizePaperReport(
      {
        forYourQuestions: [
          { question: "the model's paraphrase", verdict: "answered", answers: [{ text: "Yes.", evidence: SENT.results, sectionId: "s3" }], readNext: [] },
          { question: "", verdict: "partly", answers: [], readNext: [] },
          { question: "a question nobody asked", verdict: "answered", answers: [], readNext: [] },
          { question: "and another", verdict: "answered", answers: [], readNext: [] },
        ],
      },
      { questions: Q.slice(0, 2) },
    );

    expect(report.forYourQuestions?.map((entry) => entry.question)).toEqual(Q.slice(0, 2));
    expect(report.forYourQuestions).toHaveLength(2);
  });

  it("caps: 5 questions, 3 answers of ≤ 360 characters, 4 readNext with why ≤ 160, 8 terms with term ≤ 60 and definition ≤ 160", () => {
    const long = (n: number) => "w ".repeat(n).trim();
    const entry = {
      question: "q",
      verdict: "answered",
      answers: Array.from({ length: 6 }, () => ({ text: long(400), evidence: SENT.results, sectionId: "s3" })),
      readNext: Array.from({ length: 6 }, () => ({ sectionId: "s2", why: long(200), kind: "answer" })),
    };
    const report = sanitizePaperReport(
      {
        forYourQuestions: Array.from({ length: 7 }, () => entry),
        terms: Array.from({ length: 10 }, () => ({ term: long(80), definition: long(200) })),
      },
      { questions: ["1", "2", "3", "4", "5", "6", "7"] },
    );

    expect(REPORT_CAPS).toMatchObject({ questions: 5, answers: 3, readNext: 4, terms: 8, answerChars: 360, whyChars: 160, termChars: 60, definitionChars: 160 });
    expect(report.forYourQuestions).toHaveLength(5);
    for (const item of report.forYourQuestions ?? []) {
      expect(item.answers).toHaveLength(3);
      for (const answer of item.answers) expect(answer.text.length).toBeLessThanOrEqual(360);
      expect(item.readNext).toHaveLength(4);
      for (const next of item.readNext) expect(next.why.length).toBeLessThanOrEqual(160);
    }
    expect(report.terms).toHaveLength(8);
    for (const term of report.terms ?? []) {
      expect(term.term.length).toBeLessThanOrEqual(60);
      expect(term.definition.length).toBeLessThanOrEqual(160);
    }
  });

  it("keeps only the verdicts and kinds the schema names", () => {
    const report = sanitizePaperReport(
      {
        forYourQuestions: [
          { verdict: "maybe", answers: [], readNext: [] },
          { verdict: "partly", answers: [], readNext: [{ sectionId: "s2", why: "Counts.", kind: "aside" }, { sectionId: "s2", why: "Counts.", kind: "background" }] },
        ],
      },
      { questions: Q.slice(0, 2) },
    );

    expect(report.forYourQuestions?.map((entry) => entry.question)).toEqual([Q[1]]);
    expect(report.forYourQuestions?.[0].readNext).toEqual([{ sectionId: "s2", why: "Counts.", kind: "background" }]);
  });
});

describe("verbatim verification of the answers (§1g.3)", () => {
  it("locates each answer: evidenceWhere and page from its section; the model's sectionId kept when right, corrected when wrong", () => {
    const { report, dropped } = verify({
      forYourQuestions: [
        {
          verdict: "answered",
          answers: [
            { text: "It rises.", evidence: SENT.results, sectionId: "s3" },
            { text: "Twelve.", evidence: SENT.methods, sectionId: "s3" },
            { text: "From the abstract.", evidence: ABSTRACT, sectionId: "s2" },
          ],
          readNext: [{ sectionId: "s3", why: "The counts.", kind: "answer" }],
        },
      ],
    });

    expect(dropped).toBe(0);
    expect(report.forYourQuestions?.[0].answers).toEqual([
      { text: "It rises.", evidence: SENT.results, evidenceWhere: "3 Results", sectionId: "s3", page: 4 },
      { text: "Twelve.", evidence: SENT.methods, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
      // The abstract is quoted as itself: no section, no page.
      { text: "From the abstract.", evidence: ABSTRACT, evidenceWhere: "abstract" },
    ]);
    expect(report.forYourQuestions?.[0].verdict).toBe("answered");
  });

  it("drops an answer whose evidence is not the paper's and counts it; with every answer gone the verdict is not_addressed", () => {
    const { report, dropped } = verify({
      forYourQuestions: [
        {
          verdict: "answered",
          answers: [
            { text: "Paraphrased.", evidence: "Cracks went up when the cells were charged faster than before.", sectionId: "s3" },
            { text: "Invented.", evidence: "The cells were kept at exactly twenty degrees for the whole month.", sectionId: "s2" },
          ],
          readNext: [],
        },
        { verdict: "partly", answers: [{ text: "Kept.", evidence: SENT.methods, sectionId: "s2" }, { text: "Gone.", evidence: "Nothing like this sentence is anywhere in the paper at all, really." }], readNext: [] },
      ],
    });

    expect(report.forYourQuestions?.[0]).toMatchObject({ question: Q[0], verdict: "not_addressed", answers: [] });
    expect(report.forYourQuestions?.[1]).toMatchObject({ question: Q[1], verdict: "partly" });
    expect(report.forYourQuestions?.[1].answers.map((answer) => answer.text)).toEqual(["Kept."]);
    expect(dropped).toBe(3);
    expect(report.provenance.droppedClaims).toBe(3);
  });

  it("an answered verdict with no answer at all is not_addressed; a not_addressed verdict carries no answers", () => {
    const { report, dropped } = verify({
      forYourQuestions: [
        { verdict: "answered", answers: [], readNext: [] },
        { verdict: "not_addressed", answers: [{ text: "But here.", evidence: SENT.results }], readNext: [] },
      ],
    });

    expect(report.forYourQuestions?.map((entry) => [entry.verdict, entry.answers.length])).toEqual([
      ["not_addressed", 0],
      ["not_addressed", 0],
    ]);
    expect(dropped).toBe(0);
  });

  it("drops and counts a readNext whose section is not a section of the paper's body", () => {
    const { report, dropped } = verify({
      forYourQuestions: [
        {
          verdict: "partly",
          answers: [{ text: "Twelve.", evidence: SENT.methods, sectionId: "s2" }],
          readNext: [
            { sectionId: "s2", why: "How it was done.", kind: "answer" },
            { sectionId: "s9", why: "Nowhere.", kind: "answer" },
            { sectionId: "s0", why: "The abstract is not a section to read next.", kind: "background" },
            { sectionId: "s1", why: "What a quillwort cathode is.", kind: "background" },
          ],
        },
      ],
    });

    expect(report.forYourQuestions?.[0].readNext.map((next) => next.sectionId)).toEqual(["s2", "s1"]);
    expect(dropped).toBe(2);
  });
});

describe("terms (§1g.3)", () => {
  it("keeps a term the paper defines, verified and placed; labels one without evidence as Peer's words; drops one whose evidence is not the paper's", () => {
    const { report, dropped } = verify({
      forYourQuestions: [{ verdict: "partly", answers: [{ text: "Twelve.", evidence: SENT.methods, sectionId: "s2" }], readNext: [] }],
      terms: [
        { term: "quillwort cathode", definition: "The cathode these cells use.", evidence: SENT.intro },
        { term: "charge rate", definition: "How fast a cell is charged." },
        { term: "grain boundary", definition: "Where crystals meet.", evidence: "A grain boundary is where two crystals of the cathode meet each other." },
      ],
    });

    expect(report.terms).toEqual([
      { term: "quillwort cathode", definition: "The cathode these cells use.", evidence: SENT.intro, evidenceWhere: "1 Introduction", sectionId: "s1", page: 1 },
      { term: "charge rate", definition: "How fast a cell is charged.", peer: true },
    ]);
    expect(dropped).toBe(1);
  });

  it("leaves terms absent when none survives", () => {
    const { report } = verify({
      forYourQuestions: [{ verdict: "partly", answers: [{ text: "Twelve.", evidence: SENT.methods }], readNext: [] }],
      terms: [{ term: "grain boundary", definition: "Where crystals meet.", evidence: "A grain boundary is where two crystals of the cathode meet each other." }],
    });
    expect(report).not.toHaveProperty("terms");
  });
});
