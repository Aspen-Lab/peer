import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import {
  buildReading,
  describeAvailability,
  omittedForReader,
  pickCaveats,
  pickFindings,
  pickMethod,
  sharedTerms,
  type PaperReading,
  displayHeading,
} from "./reading";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import arxivPdfDocJson from "./__fixtures__/arxiv-2609.02113.doc.json";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";
import normalPaperJson from "./__fixtures__/abstract-normal-W7204479535.paper.json";
import noAbstractPaperJson from "./__fixtures__/no-abstract-W7204992910.paper.json";
import zenodoPaperJson from "./__fixtures__/zenodo-W7208807247.paper.json";
import arxivPaperJson from "./__fixtures__/arxiv-2609.02113.paper.json";

// The fixtures are real documents captured from `getFullText` run locally and
// real Paper objects from `/api/papers/[id]`; the JSON import loses the
// literal types, nothing else.
const arxivHtmlDoc = arxivHtmlDocJson as unknown as ExtractedDocument;
const arxivPdfDoc = arxivPdfDocJson as unknown as ExtractedDocument;
const zenodoDoc = zenodoDocJson as unknown as ExtractedDocument;
const normalPaper = normalPaperJson as unknown as Paper;
const noAbstractPaper = noAbstractPaperJson as unknown as Paper;
const zenodoPaper = zenodoPaperJson as unknown as Paper;
const arxivPaper = arxivPaperJson as unknown as Paper;

const NOW = new Date("2026-09-06T12:00:00.000Z");

function fullTextOk(
  doc: ExtractedDocument,
  sourceLink: FullTextResult["sourceLink"],
): FullTextResult {
  return { status: "ok", doc, sourceLink, attempts: [] };
}

const ARXIV_HTML_LINK = {
  url: "https://arxiv.org/html/2609.02697",
  kind: "html" as const,
  label: "arxiv-html" as const,
  rank: 5,
};
const ZENODO_LINK = {
  url: "https://zenodo.org/api/records/22316532/files/paper.pdf/content",
  kind: "pdf" as const,
  label: "zenodo" as const,
  rank: 12,
};

function docWith(sections: ExtractedDocument["sections"]): ExtractedDocument {
  return { sections, figureCaptions: [], source: "generic-html" };
}

function omittedReason(reading: PaperReading, block: string): string | undefined {
  return reading.omitted.find((entry) => entry.block === block)?.reason;
}

describe("pickFindings", () => {
  it("quotes three numeric or comparative sentences from the arXiv results section", () => {
    const findings = pickFindings(arxivHtmlDoc);

    expect(findings).toHaveLength(3);
    for (const quote of findings) {
      expect(quote.text).toMatch(/\d/);
      expect(quote.from.kind).toBe("section");
      expect(quote.from.heading).toMatch(/^4\./);
      expect(quote.from.canonical).toBe("results");
    }
    // Document order, not score order.
    expect(findings[0].text).toMatch(/^On the brain MRI dataset/);
  });

  it("quotes the results of a 40-page PDF with their numbers", () => {
    const findings = pickFindings(arxivPdfDoc);

    expect(findings).toHaveLength(3);
    expect(findings.map((quote) => quote.from.heading)).toEqual([
      "RESULTS",
      "RESULTS",
      "RESULTS",
    ]);
    expect(findings.some((quote) => /100% of custom-energy replicas/.test(quote.text))).toBe(true);
  });

  it("returns nothing for a results section that is a bracketed placeholder", () => {
    // The Zenodo notes' Results and Discussion are both "[Detailed results
    // would be presented here …]" — nothing carries a number or a comparison.
    expect(pickFindings(zenodoDoc)).toEqual([]);
  });

  it("returns nothing when there is no results bucket", () => {
    const doc = docWith([
      { heading: "1 Introduction", canonical: "introduction", text: "We report a 40% gain over the baseline in this work." },
    ]);

    expect(pickFindings(doc)).toEqual([]);
  });

  it("falls back to the discussion when the results section is thin", () => {
    const doc = docWith([
      { heading: "4 Results", canonical: "results", text: "Table 1 lists every run we made across the two datasets." },
      { heading: "5 Discussion", canonical: "discussion", text: "Our model outperforms the previous best by 7 points on the held-out set. Latency also fell to 12 ms per query on one GPU." },
    ]);

    const findings = pickFindings(doc);

    expect(findings.map((quote) => quote.from.heading)).toEqual(["5 Discussion", "5 Discussion"]);
  });

  it("never quotes a TeX macro or a math-alphabet token as prose", () => {
    const doc = docWith([
      { heading: "4 Results", canonical: "results", text: "𝒫 \\mathcal{P} improves the score by 12% over the reference set. The plain baseline improves the score by 3% over the same reference set." },
    ]);

    const findings = pickFindings(doc);

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toMatch(/^The plain baseline/);
  });
});

describe("pickMethod", () => {
  it("quotes what was done from the arXiv methods section, skipping inline math", () => {
    const method = pickMethod(arxivHtmlDoc);

    expect(method.length).toBeGreaterThanOrEqual(1);
    expect(method.length).toBeLessThanOrEqual(2);
    for (const quote of method) {
      expect(quote.from.heading).toBe("3.2 Our Solution");
      expect(quote.from.canonical).toBe("methods");
      expect(quote.text).not.toMatch(/\\[a-z]+/);
    }
  });

  it("quotes the dataset sentences of the Zenodo methodology, in document order", () => {
    const method = pickMethod(zenodoDoc);

    expect(method).toHaveLength(2);
    expect(method[0].text).toMatch(/^We evaluate our approach on a benchmark dataset/);
    expect(method[1].text).toMatch(/^We use a subset of proteins/);
    expect(method.every((quote) => quote.from.heading === "Methodology")).toBe(true);
  });

  it("returns nothing without a methods bucket", () => {
    const doc = docWith([
      { heading: "4 Results", canonical: "results", text: "We trained the model on the full dataset and report the result here." },
    ]);

    expect(pickMethod(doc)).toEqual([]);
  });
});

describe("pickCaveats", () => {
  it("takes the authors' own limitations section first", () => {
    const caveats = pickCaveats(arxivHtmlDoc);

    expect(caveats).toHaveLength(3);
    expect(caveats.every((quote) => quote.from.heading === "4.5 Limitations")).toBe(true);
    expect(caveats[0].text).toMatch(/^An important caveat of our approach/);
  });

  it("falls back to a hedge in the conclusion, attributed to it", () => {
    const doc = docWith([
      { heading: "4 Results", canonical: "results", text: "Accuracy reached 91% on the held-out set." },
      { heading: "6 Conclusion", canonical: "conclusion", text: "We presented a method for counterfactual generation. However, the approach cannot yet handle three-dimensional volumes, and scaling it remains open." },
    ]);

    const caveats = pickCaveats(doc);

    expect(caveats).toHaveLength(1);
    expect(caveats[0].from.heading).toBe("6 Conclusion");
    expect(caveats[0].text).toMatch(/^However, the approach cannot yet handle/);
  });

  it("does not read a negated requirement as a caveat", () => {
    const doc = docWith([
      { heading: "5 Discussion", canonical: "discussion", text: "Our method does not require labels, which keeps annotation cost at zero for every cohort." },
    ]);

    expect(pickCaveats(doc)).toEqual([]);
  });

  it("returns nothing for a PDF with neither limitations nor discussion", () => {
    expect(pickCaveats(arxivPdfDoc)).toEqual([]);
  });
});

describe("buildReading", () => {
  it("abstract only: marks set, section blocks omitted as not_in_abstract, model blocks as needs_key", () => {
    const reading = buildReading(normalPaper, null, NOW);

    expect(reading.version).toBe(2);
    expect(reading.paperId).toBe("openalex:W7204479535");
    expect(reading.builtAt).toBe("2026-09-06T12:00:00.000Z");
    expect(reading.provenance).toEqual({
      abstract: "full",
      abstractSentences: 11,
      fullText: "none",
      buckets: [],
    });
    expect(reading.abstract.sentences).toHaveLength(11);
    expect(reading.abstract.introCount).toBe(1);
    expect(reading.abstract.marks.length).toBeGreaterThan(0);
    expect(reading.findings).toEqual([]);
    expect(reading.omitted).toEqual([
      { block: "findings", reason: "not_in_abstract" },
      { block: "method", reason: "not_in_abstract" },
      { block: "caveats", reason: "not_in_abstract" },
      { block: "forYou", reason: "needs_key" },
      { block: "nextStep", reason: "needs_key" },
    ]);
    expect(reading.source).toEqual({
      label: "Open at the publisher",
      url: "https://doi.org/10.1038/s41598-026-64923-9",
    });
  });

  it("no abstract: the skim is omitted as no_abstract and nothing is marked", () => {
    const reading = buildReading(noAbstractPaper, null, NOW);

    expect(reading.provenance.abstract).toBe("none");
    expect(reading.provenance.abstractSentences).toBe(0);
    expect(reading.abstract).toEqual({ sentences: [], introCount: 0, marks: [] });
    expect(reading.omitted[0]).toEqual({ block: "skim", reason: "no_abstract" });
    expect(omittedReason(reading, "findings")).toBe("no_abstract");
  });

  it("carries a Semantic Scholar TLDR in provenance, never in the abstract", () => {
    const reading = buildReading(
      { ...noAbstractPaper, tldr: "A diffusion model for knowledge tracing." },
      null,
      NOW,
    );

    expect(reading.provenance.tldr).toBe("A diffusion model for knowledge tracing.");
    expect(reading.abstract.sentences).toEqual([]);
    expect(reading.provenance.abstract).toBe("none");
  });

  it("Zenodo PDF: pageCount 5, findings and caveats omitted as no_section, the PDF as the source", () => {
    const reading = buildReading(zenodoPaper, fullTextOk(zenodoDoc, ZENODO_LINK), NOW);

    expect(reading.provenance.fullText).toBe("pdf");
    expect(reading.provenance.pageCount).toBe(5);
    expect(reading.provenance.sourceLabel).toBe("Zenodo PDF");
    expect(reading.provenance.buckets).toEqual([
      "abstract",
      "introduction",
      "related_work",
      "methods",
      "results",
      "discussion",
      "conclusion",
    ]);
    expect(reading.method).toHaveLength(2);
    expect(omittedReason(reading, "findings")).toBe("no_section");
    expect(omittedReason(reading, "caveats")).toBe("no_section");
    expect(omittedReason(reading, "method")).toBeUndefined();
    expect(reading.source).toEqual({ label: "Open the PDF", url: ZENODO_LINK.url });
  });

  it("arXiv HTML: caveats present and the buckets include limitations", () => {
    const reading = buildReading(arxivPaper, fullTextOk(arxivHtmlDoc, ARXIV_HTML_LINK), NOW);

    expect(reading.provenance.fullText).toBe("html");
    expect(reading.provenance.sourceLabel).toBe("arXiv HTML");
    expect(reading.provenance.pageCount).toBeUndefined();
    expect(reading.provenance.buckets).toContain("limitations");
    expect(reading.caveats.length).toBeGreaterThanOrEqual(1);
    expect(reading.findings).toHaveLength(3);
    expect(reading.omitted).toEqual([
      { block: "forYou", reason: "needs_key" },
      { block: "nextStep", reason: "needs_key" },
    ]);
    expect(reading.source).toEqual({ label: "Open on arXiv", url: arxivPaper.linkArxiv });
  });

  it("paywalled: names the host that blocked the full text", () => {
    const fullText: FullTextResult = {
      status: "paywalled",
      reason: "www.nature.com requires paid or institutional access — Peer could not read the full paper, so the report falls back to the abstract.",
      attempts: [
        {
          link: { url: "https://www.nature.com/articles/s41598-026-64923-9", kind: "html", label: "publisher-html", rank: 30 },
          outcome: "paywalled: www.nature.com requires paid or institutional access — …",
        },
      ],
    };

    const reading = buildReading(normalPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("paywalled");
    expect(reading.provenance.paywallHost).toBe("nature.com");
    expect(omittedReason(reading, "findings")).toBe("paywalled");
    expect(omittedReason(reading, "caveats")).toBe("paywalled");
  });

  it("a PDF that only a self-hosted Peer can read is named as such", () => {
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [
        { link: { url: "https://doi.org/10.5281/zenodo.22316532", kind: "html", label: "doi", rank: 90 }, outcome: "no_full_text: Page reached but did not look like full text." },
        { link: ZENODO_LINK, outcome: "source_unavailable: no-python" },
      ],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_unreadable_here");
    expect(omittedReason(reading, "method")).toBe("pdf_only_hosted");
    // Nothing was read, so the DOI, not the unread PDF, is the way in.
    expect(reading.source?.label).toBe("Open at the publisher");
  });

  it("a PDF whose extractor script is missing from the bundle is unreadable here too, not absent", () => {
    // Vercel with the helper untraced: `pdf-text.ts` reports `no-extractor`.
    // Mapping only `no-python` told the deployed reader the paper had no
    // full text.
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [{ link: ZENODO_LINK, outcome: "source_unavailable: no-extractor" }],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_unreadable_here");
    expect(omittedReason(reading, "findings")).toBe("pdf_only_hosted");
  });

  it("a full-text attempt that found nothing leaves provenance at none", () => {
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [
        { link: { url: "https://doi.org/10.1038/x", kind: "html", label: "doi", rank: 90 }, outcome: "source_unavailable: Fetch returned 404" },
      ],
    };

    const reading = buildReading(normalPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("none");
    expect(omittedReason(reading, "method")).toBe("not_in_abstract");
  });

  it("falls back from DOI to the paper link, and to no source at all", () => {
    const withLink = buildReading({ ...normalPaper, doi: undefined }, null, NOW);
    expect(withLink.source).toEqual({ label: "Open the source", url: normalPaper.linkPaper });

    const bare = buildReading({ ...normalPaper, doi: undefined, linkPaper: undefined }, null, NOW);
    expect(bare.source).toBeNull();
  });
});

describe("omittedForReader", () => {
  const reading = buildReading(normalPaper, null, NOW);
  const reason = (omitted: PaperReading["omitted"], block: string) =>
    omitted.find((entry) => entry.block === block)?.reason;

  it("without a model, only the missing project is renamed", () => {
    const omitted = omittedForReader(reading, null, false);
    expect(reason(omitted, "forYou")).toBe("no_profile");
    expect(reason(omitted, "nextStep")).toBe("needs_key");
    expect(reason(omitted, "method")).toBe("not_in_abstract");
  });

  it("with an abstract-tier model, caveats and the next step need the full text", () => {
    const omitted = omittedForReader(reading, { basis: "model-abstract", droppedClaims: 0 }, true);
    expect(reason(omitted, "caveats")).toBe("needs_full_text");
    expect(reason(omitted, "nextStep")).toBe("needs_full_text");
    // A project is set and the model ran: whatever it did not verify is not "needs a key".
    expect(reason(omitted, "forYou")).toBe("no_verified_claim");
  });

  it("with a deep model, nothing left over is 'needs a key' — the key was used", () => {
    const omitted = omittedForReader(reading, { basis: "model-fulltext", droppedClaims: 1 }, true);
    expect(reason(omitted, "nextStep")).toBe("no_verified_claim");
    expect(reason(omitted, "forYou")).toBe("no_verified_claim");
    expect(omitted.some((entry) => entry.reason === "needs_key")).toBe(false);
  });
});

describe("sharedTerms", () => {
  it("returns both terms when two appear in the profile text", () => {
    const shared = sharedTerms(
      ["Cryo-EM", "diffusion prior", "Ribosome"],
      "I am building a diffusion prior for cryo-EM density maps of the spliceosome.",
    );

    expect(shared).toEqual(["Cryo-EM", "diffusion prior"]);
  });

  it("returns nothing for a single coincidence", () => {
    expect(sharedTerms(["Cryo-EM", "diffusion prior"], "Working on cryo-EM data.")).toEqual([]);
  });

  it("returns nothing for an empty profile", () => {
    expect(sharedTerms(["Cryo-EM", "diffusion prior"], "   ")).toEqual([]);
  });
});

describe("describeAvailability", () => {
  const abstractOnly = buildReading(normalPaper, null, NOW);
  const noAbstract = buildReading(noAbstractPaper, null, NOW);
  const sectionsHtml = buildReading(arxivPaper, fullTextOk(arxivHtmlDoc, ARXIV_HTML_LINK), NOW);
  const sectionsPdf = buildReading(zenodoPaper, fullTextOk(zenodoDoc, ZENODO_LINK), NOW);

  const noModel = { report: null, providerConfigured: false, profileHasProject: false, modelFailed: false };

  it("abstract only, no key", () => {
    expect(describeAvailability({ reading: abstractOnly, ...noModel })).toEqual([
      "Abstract only. Method, caveats and what it means for your project need the full text and a key.",
    ]);
  });

  it("abstract only, a key configured and the model still working", () => {
    expect(
      describeAvailability({ reading: abstractOnly, ...noModel, providerConfigured: true }),
    ).toEqual(["Abstract only. Method and caveats need the full text."]);
  });

  it("PDF unreadable here", () => {
    const reading: PaperReading = {
      ...abstractOnly,
      provenance: { ...abstractOnly.provenance, fullText: "pdf_unreadable_here" },
      omitted: abstractOnly.omitted.map((entry) =>
        entry.reason === "not_in_abstract" ? { ...entry, reason: "pdf_only_hosted" as const } : entry,
      ),
    };

    expect(describeAvailability({ reading, ...noModel })).toEqual([
      "Abstract only; the PDF is there, but only a self-hosted Peer reads PDFs. What it means for your project needs a key.",
    ]);
  });

  it("paywalled, with and without a known host", () => {
    const reading: PaperReading = {
      ...abstractOnly,
      provenance: { ...abstractOnly.provenance, fullText: "paywalled", paywallHost: "nature.com" },
    };

    expect(describeAvailability({ reading, ...noModel })).toEqual([
      "Abstract only — nature.com keeps the full text behind access. What it means for your project needs a key.",
    ]);
    expect(
      describeAvailability({
        reading: { ...reading, provenance: { ...reading.provenance, paywallHost: undefined } },
        ...noModel,
      })[0],
    ).toMatch(/^Abstract only — the publisher keeps the full text behind access\./);
  });

  it("no abstract, with and without a TLDR", () => {
    expect(describeAvailability({ reading: noAbstract, ...noModel })).toEqual([
      "No abstract is published where Peer can read it — only the record. Open it at the source to judge it.",
    ]);
    const withTldr: PaperReading = {
      ...noAbstract,
      provenance: { ...noAbstract.provenance, tldr: "A diffusion model for knowledge tracing." },
    };
    expect(describeAvailability({ reading: withTldr, ...noModel })).toEqual([
      "No abstract is published where Peer can read it. The one-line TLDR above is Semantic Scholar's, not the authors'.",
    ]);
  });

  it("sections from arXiv HTML with a limitations section", () => {
    expect(describeAvailability({ reading: sectionsHtml, ...noModel })).toEqual([
      "Full text read: arXiv HTML, with a limitations section. Findings, method and caveats are below. What it means for your project and a next step need a key.",
    ]);
  });

  it("sections from a short PDF whose results are a placeholder", () => {
    expect(describeAvailability({ reading: sectionsPdf, ...noModel })).toEqual([
      "Full text read: a 5-page PDF. The method is below. What it means for your project and a next step need a key.",
    ]);
  });

  it("sections from a PDF with no methods section", () => {
    const reading: PaperReading = {
      ...sectionsPdf,
      method: [],
      findings: sectionsHtml.findings,
      provenance: { ...sectionsPdf.provenance, buckets: ["introduction", "results", "conclusion"] },
      omitted: [{ block: "method", reason: "no_section" }, ...sectionsPdf.omitted.filter((e) => e.block !== "findings")],
    };

    expect(describeAvailability({ reading, ...noModel })[0]).toBe(
      "Full text read: a 5-page PDF with no methods section. Findings are below. What it means for your project and a next step need a key.",
    );
  });

  it("model from the abstract, project set", () => {
    expect(
      describeAvailability({
        reading: abstractOnly,
        report: { basis: "model-abstract", droppedClaims: 0 },
        providerConfigured: true,
        profileHasProject: true,
        modelFailed: false,
      }),
    ).toEqual([
      "Read by your model from the abstract; every claim below carries a sentence from it. Caveats and a next step need the full text — turn on deep reports in Profile.",
    ]);
  });

  it("model from the abstract with deep on names the wall, never the setting", () => {
    // Deep was requested and the report still came from the abstract: the
    // full text was walled, unreadable here, unfound, or read by Peer but
    // not finished by the model. "Turn on deep reports" would be false.
    const withModel = {
      report: { basis: "model-abstract" as const, droppedClaims: 0, deepRequested: true },
      providerConfigured: true,
      profileHasProject: true,
      modelFailed: false,
    };
    const lead =
      "Read by your model from the abstract; every claim below carries a sentence from it.";
    const at = (fullText: PaperReading["provenance"]["fullText"], paywallHost?: string) => ({
      ...abstractOnly,
      provenance: { ...abstractOnly.provenance, fullText, paywallHost },
    });

    expect(describeAvailability({ reading: at("paywalled", "nature.com"), ...withModel })).toEqual([
      `${lead} Caveats and a next step need the full text — nature.com keeps it behind access.`,
    ]);
    expect(describeAvailability({ reading: at("paywalled"), ...withModel })).toEqual([
      `${lead} Caveats and a next step need the full text — the publisher keeps it behind access.`,
    ]);
    expect(describeAvailability({ reading: at("pdf_unreadable_here"), ...withModel })).toEqual([
      `${lead} Caveats and a next step need the full text; the PDF is there, but only a self-hosted Peer reads PDFs.`,
    ]);
    expect(describeAvailability({ reading: at("none"), ...withModel })).toEqual([
      `${lead} Caveats and a next step need the full text, which Peer could not find.`,
    ]);
    // Peer read the PDF (no caveats in it) but the model's deep step failed.
    expect(
      describeAvailability({ reading: { ...sectionsPdf, caveats: [] }, ...withModel }),
    ).toEqual([
      `${lead} Caveats and a next step need the full text; your model's deep read of it did not finish.`,
    ]);
    // With caveats already quoted from the sections, no clause is needed.
    expect(describeAvailability({ reading: sectionsHtml, ...withModel })).toEqual([lead]);
    for (const sentence of describeAvailability({ reading: at("paywalled"), ...withModel })) {
      expect(sentence).not.toMatch(/turn on deep reports/);
    }
  });

  it("model from the full text, with dropped claims and no project", () => {
    expect(
      describeAvailability({
        reading: sectionsPdf,
        report: { basis: "model-fulltext", droppedClaims: 2 },
        providerConfigured: true,
        profileHasProject: false,
        modelFailed: false,
      }),
    ).toEqual([
      "Read by your model from the full text (Zenodo PDF, 5 pages); every claim below carries a verbatim sentence. 2 claims were dropped for lacking one.",
      "Add your current project in Profile and Peer will relate this paper to it.",
    ]);
  });

  it("model from the full text names the source from the report when the reading has not arrived", () => {
    expect(
      describeAvailability({
        reading: abstractOnly,
        report: { basis: "model-fulltext", droppedClaims: 1, sourceKind: "ar5iv" },
        providerConfigured: true,
        profileHasProject: true,
        modelFailed: false,
      }),
    ).toEqual([
      "Read by your model from the full text (arXiv HTML); every claim below carries a verbatim sentence. 1 claim was dropped for lacking one.",
    ]);
  });

  it("model failed: the paper's own text stands", () => {
    expect(
      describeAvailability({
        reading: sectionsHtml,
        report: null,
        providerConfigured: true,
        profileHasProject: true,
        modelFailed: true,
      }),
    ).toEqual([
      "Full text read: arXiv HTML, with a limitations section. Findings, method and caveats are below.",
      "Your model could not finish; what is below is the paper's own text.",
    ]);
  });

  it("no sentence is uppercase", () => {
    const all = [
      ...describeAvailability({ reading: abstractOnly, ...noModel }),
      ...describeAvailability({ reading: noAbstract, ...noModel }),
      ...describeAvailability({ reading: sectionsHtml, ...noModel }),
    ];
    for (const sentence of all) {
      expect(sentence).not.toBe(sentence.toUpperCase());
    }
  });
});

describe("displayHeading", () => {
  it("sets a PDF's all-caps heading in title case, numbering untouched", () => {
    expect(displayHeading("MATERIALS AND METHODS")).toBe("Materials and Methods");
    expect(displayHeading("4 RESULTS")).toBe("4 Results");
    expect(displayHeading("RESULTS")).toBe("Results");
  });
  it("leaves mixed-case headings exactly as written", () => {
    expect(displayHeading("4.5 Limitations")).toBe("4.5 Limitations");
    expect(displayHeading("Results and Discussion")).toBe("Results and Discussion");
    expect(displayHeading("ReX")).toBe("ReX");
  });
});
