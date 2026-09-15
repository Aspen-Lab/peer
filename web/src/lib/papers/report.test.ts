import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import {
  REPORT_CAPS,
  emptyReport,
  reviewPaperLabel,
  sanitizePaperReport,
  withoutFigures,
} from "./report";

const evidence =
  "We measured a 12% improvement over the baseline on the held-out set.";

function claimsOf(n: number, prefix = "Claim") {
  return Array.from({ length: n }, (_, i) => ({
    text: `${prefix} ${i + 1}.`,
    evidence,
  }));
}

describe("sanitizePaperReport", () => {
  it("whitelists the report fields and passes text through the display cleaner", () => {
    const report = sanitizePaperReport({
      skim: [{ text: "  The method  works&nbsp;well. ", evidence }],
      whatItProposes: {
        summary: "A proposal.",
        methods: [{ text: "Trained on ImageNet.", evidence }],
        unknownField: "dropped",
      },
      resultsAndSignificance: {
        summary: "A result.",
        keyResults: [{ title: "Gain", detail: "12% better.", evidence }],
      },
      whyItFitsYou: { reasons: ["a restored field"], keywords: [] },
      noLlm: false,
      depth: "abstract",
    });

    expect(report.skim).toEqual([{ text: "The method works well.", evidence }]);
    expect(report.whatItProposes).toEqual({
      summary: "A proposal.",
      methods: [{ text: "Trained on ImageNet.", evidence }],
    });
    expect(report.resultsAndSignificance.keyResults).toEqual([
      { title: "Gain", detail: "12% better.", evidence },
    ]);
    expect(report.provenance).toEqual({ basis: "model-abstract", droppedClaims: 0 });
    expect(report.depth).toBe("abstract");
    expect(report.noLlm).toBeUndefined();
    // S6 (2026-09-15): "Why it fits you" is deleted from every new report and
    // no prompt asks for it any more, but sanitizePaperReport still whitelists
    // and caps the field when given one — the honest way to bound a v5-shaped
    // report replayed from an old cache without widening what a *new* report
    // can carry. Nothing on the page renders it any more.
    expect(report.whyItFitsYou).toEqual({ reasons: ["a restored field"], keywords: [] });
    expect("unknownField" in report.whatItProposes).toBe(false);
  });

  it("drops every claim and key result without a non-empty evidence string", () => {
    const report = sanitizePaperReport({
      skim: [
        { text: "Backed.", evidence },
        { text: "Unbacked." },
        { text: "Blank evidence.", evidence: "   " },
        { text: "Wrong type.", evidence: 42 },
      ],
      whatItProposes: {
        summary: "",
        methods: [{ text: "No receipt." }, { text: "Has one.", evidence }],
      },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          { title: "Kept", detail: "Detail.", evidence },
          { title: "Dropped", detail: "Detail." },
          { detail: "No title, no label invented.", evidence },
          { title: "No detail", evidence },
        ],
      },
      limitations: [{ text: "Small cohort." }, { text: "Single site.", evidence }],
      relationToYourWork: {
        basedOn: "My project",
        items: [{ text: "Unbacked relation." }],
      },
      nextStep: { text: "Run it on your data." },
    });

    expect(report.skim.map((c) => c.text)).toEqual(["Backed."]);
    expect(report.whatItProposes.methods.map((c) => c.text)).toEqual(["Has one."]);
    expect(report.resultsAndSignificance.keyResults.map((r) => r.title)).toEqual(["Kept"]);
    expect(report.limitations?.map((c) => c.text)).toEqual(["Single site."]);
    // A relation block that lost every item is absent, not an empty heading.
    expect(report.relationToYourWork).toBeUndefined();
    expect(report.nextStep).toBeUndefined();
  });

  it("applies the caps: skim 3 × 300, methods 4, keyResults 4, limitations 3, relation 3, evidence 400, basedOn 200, summaries 600", () => {
    const long = (n: number, ch = "x") => ch.repeat(n);
    const report = sanitizePaperReport({
      skim: claimsOf(5).map((c) => ({ ...c, text: long(500, "s") })),
      whatItProposes: {
        summary: long(900),
        methods: claimsOf(6),
      },
      resultsAndSignificance: {
        summary: long(900),
        keyResults: Array.from({ length: 6 }, (_, i) => ({
          title: `R${i}`,
          detail: "d",
          evidence: long(700, "e"),
        })),
      },
      limitations: claimsOf(5),
      relationToYourWork: { basedOn: long(300, "p"), items: claimsOf(5) },
    });

    expect(report.skim).toHaveLength(REPORT_CAPS.skim);
    expect(report.skim[0].text).toHaveLength(REPORT_CAPS.skimChars);
    expect(report.whatItProposes.methods).toHaveLength(REPORT_CAPS.methods);
    expect(report.whatItProposes.summary).toHaveLength(REPORT_CAPS.summaryChars);
    expect(report.resultsAndSignificance.summary).toHaveLength(REPORT_CAPS.summaryChars);
    expect(report.resultsAndSignificance.keyResults).toHaveLength(REPORT_CAPS.keyResults);
    expect(report.resultsAndSignificance.keyResults[0].evidence).toHaveLength(
      REPORT_CAPS.evidenceChars,
    );
    expect(report.limitations).toHaveLength(REPORT_CAPS.limitations);
    expect(report.relationToYourWork?.items).toHaveLength(REPORT_CAPS.relationItems);
    expect(report.relationToYourWork?.basedOn).toHaveLength(REPORT_CAPS.basedOnChars);
  });

  it("fabricates nothing for a garbage or empty input", () => {
    for (const raw of [null, undefined, "text", 3, [], {}]) {
      const report = sanitizePaperReport(raw);
      expect(report.skim).toEqual([]);
      expect(report.whatItProposes).toEqual({ summary: "", methods: [] });
      expect(report.resultsAndSignificance).toEqual({ summary: "", keyResults: [] });
      expect(report.limitations).toBeUndefined();
      expect(report.relationToYourWork).toBeUndefined();
      expect(report.nextStep).toBeUndefined();
      expect(report.provenance).toEqual({ basis: "model-abstract", droppedClaims: 0 });
      expect(report.noLlm).toBeUndefined();
      expect(report.depth).toBeUndefined();
      expect(report.paywallNotice).toBeUndefined();
    }
  });

  it("keeps the three figure-field states and never cleans a data: image URL", () => {
    const dataUrl = "data:image/png;base64,AAAA BBBB";
    const report = sanitizePaperReport({
      whatItProposes: {
        summary: "",
        methods: [],
        figureLabel: " Figure 2 ",
        figureImageUrl: dataUrl,
        figureCaption: null,
      },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          {
            title: "T",
            detail: "D",
            evidence,
            figureLabel: null,
            figureImageUrl: "   ",
          },
        ],
      },
    });

    expect(report.whatItProposes.figureLabel).toBe("Figure 2");
    expect(report.whatItProposes.figureImageUrl).toBe(dataUrl);
    expect(report.whatItProposes.figureCaption).toBeNull();
    expect("figureSource" in report.whatItProposes).toBe(false);
    const [result] = report.resultsAndSignificance.keyResults;
    expect(result.figureLabel).toBeNull();
    expect("figureImageUrl" in result).toBe(false);
  });

  it("keeps a figure URL only when it is https or a PDF-rendered data image", () => {
    // The binder produces exactly those two shapes; anything else is a string
    // the model typed, and it must not reach the plate as the paper's figure.
    const keyResult = (figureImageUrl: unknown) => ({
      title: "T",
      detail: "D",
      evidence,
      figureImageUrl,
    });
    const report = sanitizePaperReport({
      whatItProposes: { summary: "", methods: [], figureImageUrl: "http://example.org/fig1.png" },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          keyResult("https://arxiv.org/html/2609.02697v1/x1.png"),
          keyResult("data:image/png;base64,AAAA"),
          keyResult("javascript:alert(1)"),
          keyResult("figure 1"),
        ],
      },
    });

    expect("figureImageUrl" in report.whatItProposes).toBe(false);
    const [https, data, script, prose] = report.resultsAndSignificance.keyResults;
    expect(https.figureImageUrl).toBe("https://arxiv.org/html/2609.02697v1/x1.png");
    expect(data.figureImageUrl).toBe("data:image/png;base64,AAAA");
    expect("figureImageUrl" in script).toBe(false);
    expect("figureImageUrl" in prose).toBe(false);
  });

  it("carries a valid provenance through and keeps a verified evidenceWhere", () => {
    const report = sanitizePaperReport({
      skim: [{ text: "Kept.", evidence, evidenceWhere: "4.4 Results" }],
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-fulltext", sourceKind: "pdf", pageCount: 5, droppedClaims: 2 },
      depth: "deep",
      nextStep: null,
    });

    expect(report.provenance).toEqual({
      basis: "model-fulltext",
      sourceKind: "pdf",
      pageCount: 5,
      droppedClaims: 2,
    });
    expect(report.depth).toBe("deep");
    expect(report.nextStep).toBeNull();
    // evidenceWhere is verification's to set; the sanitizer does not keep a
    // model's own claim about where its sentence came from.
    expect(report.skim[0].evidenceWhere).toBeUndefined();
  });
});

describe("sanitizePaperReport — the restored sections", () => {
  // These existed before the 2026-09 reader rewrite dropped them, and were
  // brought back on the founder's call. None carries an evidence sentence:
  // they are Peer's reading, and the page labels them so. S6 (2026-09-15)
  // merged the proposal's "novelty" into `newHere` and deleted the fit
  // block from every *new* report — sanitizePaperReport still accepts an
  // old-cached `whyItFitsYou` blob (see the "whitelists" test above) and a
  // legacy `novelty` key (below), but nothing writes either any more.
  it("keeps proposal newHere, per-result novelty and review contents", () => {
    const report = sanitizePaperReport({
      skim: [],
      whatItProposes: {
        summary: "A proposal.",
        methods: [],
        newHere: ["  First&nbsp;new thing. ", "Second new thing."],
      },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          { title: "Gain", detail: "It gained.", evidence, novelty: " Nobody had measured it. " },
        ],
      },
      reviewContents: {
        sections: [
          { heading: "2. Cathodes", summary: "What is known about cathodes." },
          { heading: "", summary: "dropped: no heading" },
          { heading: "3. Anodes", summary: "" },
        ],
      },
    });
    expect(report.whatItProposes.newHere).toEqual(["First new thing.", "Second new thing."]);
    expect(report.resultsAndSignificance.keyResults[0].novelty).toBe("Nobody had measured it.");
    expect(report.reviewContents).toEqual({
      sections: [{ heading: "2. Cathodes", summary: "What is known about cathodes." }],
    });
  });

  it("1-04: still reads a v5-shaped `novelty` key as `newHere`, for an old cached report", () => {
    const report = sanitizePaperReport({
      whatItProposes: { summary: "A proposal.", methods: [], novelty: ["Old-shaped field."] },
      resultsAndSignificance: { summary: "", keyResults: [] },
    });
    expect(report.whatItProposes.newHere).toEqual(["Old-shaped field."]);
  });

  it("leaves the restored sections absent rather than empty", () => {
    const report = sanitizePaperReport({
      whatItProposes: { summary: "", methods: [], newHere: [] },
      resultsAndSignificance: { summary: "", keyResults: [{ title: "T", detail: "D", evidence }] },
      reviewContents: { sections: [] },
    });
    expect(report.whatItProposes).not.toHaveProperty("newHere");
    expect(report.resultsAndSignificance.keyResults[0]).not.toHaveProperty("novelty");
    expect(report).not.toHaveProperty("reviewContents");
  });

  it("caps them: newHere 2 × 320, review sections 8", () => {
    const long = "x".repeat(1000);
    const report = sanitizePaperReport({
      whatItProposes: { summary: "", methods: [], newHere: [long, long, long] },
      resultsAndSignificance: {
        summary: "",
        keyResults: [{ title: "T", detail: "D", evidence, novelty: long }],
      },
      reviewContents: {
        sections: Array.from({ length: 12 }, (_, i) => ({ heading: `H${i}`, summary: long })),
      },
    });
    expect(report.whatItProposes.newHere).toHaveLength(REPORT_CAPS.novelty);
    expect(report.whatItProposes.newHere?.[0].length).toBe(REPORT_CAPS.noveltyChars);
    expect(report.resultsAndSignificance.keyResults[0].novelty?.length).toBe(REPORT_CAPS.noveltyChars);
    expect(report.reviewContents?.sections).toHaveLength(REPORT_CAPS.reviewSections);
    expect(report.reviewContents?.sections[0].summary.length).toBe(REPORT_CAPS.reviewSummaryChars);
  });

  it("1-04: still caps a legacy whyItFitsYou blob (reasons 3 × 320, keywords 8 × 40) though nothing writes one any more", () => {
    const long = "x".repeat(1000);
    const report = sanitizePaperReport({
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      whyItFitsYou: {
        reasons: [long, long, long, long],
        keywords: Array.from({ length: 12 }, (_, i) => `k${i}${long}`),
      },
    });
    expect(report.whyItFitsYou?.reasons).toHaveLength(REPORT_CAPS.fitReasons);
    expect(report.whyItFitsYou?.reasons[0].length).toBe(REPORT_CAPS.fitReasonChars);
    expect(report.whyItFitsYou?.keywords).toHaveLength(REPORT_CAPS.fitKeywords);
    expect(report.whyItFitsYou?.keywords[0].length).toBe(REPORT_CAPS.fitKeywordChars);
  });
});

describe("withoutFigures", () => {
  it("strips every figure field from the proposal and each key result, leaving them absent", () => {
    // The abstract tier never binds a figure, so a Tier-1 raw object that
    // echoes figure keys yields a report with none — absent, the state that
    // says binding never ran, not null.
    const report = withoutFigures(
      sanitizePaperReport({
        whatItProposes: {
          summary: "S",
          methods: claimsOf(1),
          figureLabel: "Figure 1",
          figureImageUrl: "https://example.org/fig1.png",
          figureCaption: "A figure the model made up.",
          figureSource: "ar5iv",
        },
        resultsAndSignificance: {
          summary: "R",
          keyResults: [
            {
              title: "T",
              detail: "D",
              evidence,
              figureLabel: null,
              figureImageUrl: "https://example.org/fig2.png",
              figureCaption: null,
              figureSource: null,
            },
          ],
        },
      }),
    );

    for (const field of ["figureLabel", "figureImageUrl", "figureCaption", "figureSource"]) {
      expect(field in report.whatItProposes).toBe(false);
      expect(field in report.resultsAndSignificance.keyResults[0]).toBe(false);
    }
    expect(report.whatItProposes.methods).toHaveLength(1);
    expect(report.resultsAndSignificance.keyResults[0]).toEqual({ title: "T", detail: "D", evidence });
  });
});

describe("emptyReport", () => {
  it("is empty, typed and marked noLlm", () => {
    expect(emptyReport("fallback")).toEqual({
      skim: [],
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-abstract", droppedClaims: 0 },
      noLlm: true,
      depth: "fallback",
    });
  });
});

describe("reviewPaperLabel", () => {
  const base: Paper = {
    id: "p",
    title: "",
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: false,
  };

  it("reads the title only", () => {
    expect(reviewPaperLabel({ ...base, title: "A survey of graph learning" })).toBe("Survey");
    expect(reviewPaperLabel({ ...base, title: "Protein folding: a review" })).toBe("Review");
    expect(reviewPaperLabel({ ...base, title: "A meta-analysis of trials" })).toBe("Review");
    expect(reviewPaperLabel({ ...base, title: "Peer review dynamics" })).toBe("Review");
  });

  it("is not triggered by the abstract, the keywords or state-of-the-art", () => {
    expect(
      reviewPaperLabel({
        ...base,
        title: "Fast folding with diffusion",
        summaryIntro: "We review prior work and survey the field before presenting our method.",
        summaryExperimentKeywords: ["survey", "review"],
      }),
    ).toBeNull();
    expect(
      reviewPaperLabel({ ...base, title: "State-of-the-art folding with diffusion" }),
    ).toBeNull();
  });
});
