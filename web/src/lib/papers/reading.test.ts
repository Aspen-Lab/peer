import { placeFigures, pdfFigureUrl } from "./reading";
import { blockMarker } from "@/lib/text/math";
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
  quoteAttribution,
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

function docWith(
  sections: ExtractedDocument["sections"],
  figureCaptions: ExtractedDocument["figureCaptions"] = [],
): ExtractedDocument {
  return { sections, figureCaptions, source: "generic-html" };
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
      { id: "s0", heading: "1 Introduction", canonical: "introduction", text: "We report a 40% gain over the baseline in this work." },
    ]);

    expect(pickFindings(doc)).toEqual([]);
  });

  it("falls back to the discussion when the results section is thin", () => {
    const doc = docWith([
      { id: "s0", heading: "4 Results", canonical: "results", text: "Table 1 lists every run we made across the two datasets." },
      { id: "s1", heading: "5 Discussion", canonical: "discussion", text: "Our model outperforms the previous best by 7 points on the held-out set. Latency also fell to 12 ms per query on one GPU." },
    ]);

    const findings = pickFindings(doc);

    expect(findings.map((quote) => quote.from.heading)).toEqual(["5 Discussion", "5 Discussion"]);
  });

  it("never quotes a TeX macro or a math-alphabet token as prose", () => {
    const doc = docWith([
      { id: "s0", heading: "4 Results", canonical: "results", text: "𝒫 \\mathcal{P} improves the score by 12% over the reference set. The plain baseline improves the score by 3% over the same reference set." },
    ]);

    const findings = pickFindings(doc);

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toMatch(/^The plain baseline/);
  });
});

describe("pickFindings — the last two pools", () => {
  const CAPTION = {
    ordinal: 6,
    label: "Figure 6",
    caption:
      "Mean-of-K TM-score achieved by FK-steering on 1CLL. Higher lambda increases the signal from the rewards and leads to better performance across budgets.",
  };

  it("reads an unlabelled document's body when no section calls itself results", () => {
    // A maths paper: numbered sections, none of whose headings say "results".
    const doc = docWith([
      { id: "s0", heading: "3 A Numerical Illustration", canonical: "body", text: "The proposed estimator reduces the error by 12% compared with the baseline on every run." },
    ]);

    const findings = pickFindings(doc);

    expect(findings).toHaveLength(1);
    expect(quoteAttribution(findings[0].from)).toBe("§3 A Numerical Illustration");
  });

  it("never reads a finding out of an introduction", () => {
    const doc = docWith([
      { id: "s0", heading: "1 Introduction", canonical: "introduction", text: "We report a 40% gain over the baseline in this work." },
    ]);

    expect(pickFindings(doc)).toEqual([]);
  });

  it("quotes a figure caption when the running text has nothing, and cites the figure", () => {
    const doc = docWith(
      [{ id: "s0", heading: "5 Results", canonical: "results", text: "Section 5.1 discusses the comparison of the four methods." }],
      [CAPTION],
    );

    const findings = pickFindings(doc);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].from.kind).toBe("figure");
    // A figure is cited by its label — no section mark on something that is
    // not a section.
    expect(quoteAttribution(findings[0].from)).toBe("Figure 6");
  });

  it("prefers the paper's prose to its captions", () => {
    const doc = docWith(
      [{ id: "s0", heading: "5 Results", canonical: "results", text: "Our model outperforms the previous best by 7 points on the held-out set." }],
      [CAPTION],
    );

    expect(pickFindings(doc)[0].from.kind).toBe("section");
  });

  it("does not quote rendered mathematics as prose", () => {
    const doc = docWith([
      {
        id: "s0",
        heading: "4 Results",
        canonical: "results",
        text: "h ( t , x 1 ) = p ( X T ( 1 ) = - 1 | X t ( 1 ) = x 1 ) , ( 14 ) and d = 3 here.",
      },
    ]);

    expect(pickFindings(doc)).toEqual([]);
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
      { id: "s0", heading: "4 Results", canonical: "results", text: "We trained the model on the full dataset and report the result here." },
    ]);

    expect(pickMethod(doc)).toEqual([]);
  });
});

describe("blocks do not quote the same sentence twice", () => {
  it("gives a sentence to the first block that claims it", () => {
    // One `body` section, reachable by both last-resort pools.
    const paper = { ...normalPaper, id: "openalex:W1" } as Paper;
    const doc = docWith([
      {
        id: "s0",
        heading: "3 Experiments",
        canonical: "body",
        text: "We trained the model on 40,000 labelled samples and it outperforms the baseline by 7 points.",
      },
    ]);

    const reading = buildReading(paper, fullTextOk(doc, ARXIV_HTML_LINK), NOW);
    const texts = [...reading.findings, ...reading.method, ...reading.caveats].map((q) => q.text);

    expect(new Set(texts).size).toBe(texts.length);
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
      { id: "s0", heading: "4 Results", canonical: "results", text: "Accuracy reached 91% on the held-out set." },
      { id: "s1", heading: "6 Conclusion", canonical: "conclusion", text: "We presented a method for counterfactual generation. However, the approach cannot yet handle three-dimensional volumes, and scaling it remains open." },
    ]);

    const caveats = pickCaveats(doc);

    expect(caveats).toHaveLength(1);
    expect(caveats[0].from.heading).toBe("6 Conclusion");
    expect(caveats[0].text).toMatch(/^However, the approach cannot yet handle/);
  });

  it("does not read a negated requirement as a caveat", () => {
    const doc = docWith([
      { id: "s0", heading: "5 Discussion", canonical: "discussion", text: "Our method does not require labels, which keeps annotation cost at zero for every cohort." },
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

    // 1-28/1-31: bumped 3 -> 4 — a new `ReadingProvenance.fullText` value
    // (`"pdf_empty"`) is a shape change per this field's own bump rule, even
    // though no field was added. The follow-up branch made this identical
    // change independently (same string, same reason); main's own later
    // 4 -> 5 (math rendering) is the one this merge keeps, since the
    // follow-up branch never touched that shape. P1-04 (§1e.9, §1f.12):
    // 5 -> 6 — body sections carry their id and the reading carries the map.
    expect(reading.version).toBe(6);
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

  // P0-03: rewritten. This was "a PDF that only a self-hosted Peer can read
  // is named as such", fed a `no-python` outcome — the reason the Python
  // text helper gave when it could not run. Every PDF is read with pdf.js
  // now and that reason no longer exists; what `pdf_unreadable_here` names
  // is a PDF link whose text layer is empty (a scan), `no-text-layer`.
  it("a PDF link whose text layer is empty (a scan) is named as such", () => {
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [
        { link: { url: "https://doi.org/10.5281/zenodo.22316532", kind: "html", label: "doi", rank: 90 }, outcome: "no_full_text: Page reached but did not look like full text." },
        { link: ZENODO_LINK, outcome: "source_unavailable: no-text-layer" },
      ],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_unreadable_here");
    expect(omittedReason(reading, "method")).toBe("pdf_only_hosted");
    // Nothing was read, so the DOI, not the unread PDF, is the way in.
    expect(reading.source?.label).toBe("Open at the publisher");
  });

  // P0-03: rewritten. This was "a PDF whose extractor script is missing
  // from the bundle is unreadable here too, not absent", fed `no-extractor`
  // (Vercel with the Python helper untraced). There is no helper to miss any
  // more. The same intent — a PDF that was reached but yielded nothing is
  // named, not reported as absent — now covers an outline with no sections;
  // and a stray `no-python` / `no-extractor` is no longer a claim about the
  // PDF at all.
  it("a PDF whose text layer yields no sections is unreadable here too, not absent", () => {
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [{ link: ZENODO_LINK, outcome: "source_unavailable: no-sections" }],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_unreadable_here");
    expect(omittedReason(reading, "findings")).toBe("pdf_only_hosted");

    for (const gone of ["no-python", "no-extractor"]) {
      const stale = buildReading(
        zenodoPaper,
        { ...fullText, attempts: [{ link: ZENODO_LINK, outcome: `source_unavailable: ${gone}` }] },
        NOW,
      );
      expect(stale.provenance.fullText).toBe("none");
    }
  });

  it("P0-03: an uploaded scan read by pdf.js is pdf_empty, not 'unreadable here', though its reason names the empty text layer", () => {
    // `extractPdfTextFromPath` marks a scan `pdf-empty: no-text-layer`. The
    // `pdf-empty` marker is the upload's own, and it wins: the page shows the
    // "no readable text" notice for an upload, as it always has.
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "pdf-empty: no-text-layer",
      attempts: [{
        link: { url: "/api/papers/upload/0123456789abcdef/file", kind: "pdf", label: "upload", rank: 0 },
        outcome: "no_full_text: pdf-empty: no-text-layer",
      }],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_empty");
    expect(omittedReason(reading, "findings")).toBe("pdf_empty");
  });

  it("1-28/1-31: a PDF with genuinely no extractable text is named distinctly from 'unreadable here'", () => {
    // Not a deployment limit (Python ran fine) and not "Peer never found a
    // copy" — the file itself has no text layer, true on every deployment.
    const fullText: FullTextResult = {
      status: "no_full_text",
      reason: "pdf-empty: PDF text extractor produced no sections.",
      attempts: [{
        link: { url: "/api/papers/upload/0123456789abcdef/file", kind: "pdf", label: "upload", rank: 0 },
        outcome: "no_full_text: pdf-empty: PDF text extractor produced no sections.",
      }],
    };

    const reading = buildReading(zenodoPaper, fullText, NOW);

    expect(reading.provenance.fullText).toBe("pdf_empty");
    expect(reading.provenance.fullText).not.toBe("pdf_unreadable_here");
    expect(omittedReason(reading, "findings")).toBe("pdf_empty");
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
      "Abstract only; the PDF carries no text to read — it looks scanned. What it means for your project needs a key.",
    ]);
  });

  it("PDF has no readable text — no key clause, since a key cannot fix an empty file", () => {
    const reading: PaperReading = {
      ...abstractOnly,
      provenance: { ...abstractOnly.provenance, fullText: "pdf_empty" },
      omitted: abstractOnly.omitted.map((entry) =>
        entry.reason === "not_in_abstract" ? { ...entry, reason: "pdf_empty" as const } : entry,
      ),
    };

    expect(describeAvailability({ reading, ...noModel })).toEqual([
      "This PDF has no readable text — Peer could not extract anything from it.",
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
      `${lead} Caveats and a next step need the full text; the PDF carries no text to read — it looks scanned.`,
    ]);
    expect(describeAvailability({ reading: at("pdf_empty"), ...withModel })).toEqual([
      `${lead} Caveats and a next step need the full text; this PDF has no readable text to read.`,
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

  // P2-08b (§1g.19 d, F8): when the server REFUSED the deep read (a quota or an
  // outage, which the page's notice says), "your model's deep read of it did not
  // finish" — or "turn on deep reports" — is false beside that notice: the read
  // was never run. The page passes `refused` when the hook holds a quota.
  it("model from the abstract with the deep read refused says it was not run, whatever the wall or the setting", () => {
    const lead =
      "Read by your model from the abstract; every claim below carries a sentence from it.";
    const refused = " Caveats and a next step need the full text; the deep read was not run.";
    const at = (fullText: PaperReading["provenance"]["fullText"], paywallHost?: string) => ({
      ...abstractOnly,
      provenance: { ...abstractOnly.provenance, fullText, paywallHost },
    });
    for (const deepRequested of [true, false]) {
      const withModel = {
        report: { basis: "model-abstract" as const, droppedClaims: 0, deepRequested },
        providerConfigured: true,
        profileHasProject: true,
        modelFailed: false,
        refused: true,
      };
      const readings: Array<[string, PaperReading]> = [
        ["paywalled with a host", at("paywalled", "nature.com")],
        ["paywalled", at("paywalled")],
        ["a scanned PDF", at("pdf_unreadable_here")],
        ["an empty PDF", at("pdf_empty")],
        ["no full text", at("none")],
        // Peer read the PDF, but the deep read was refused before the model ran.
        ["a PDF Peer read", { ...sectionsPdf, caveats: [] }],
      ];
      for (const [name, reading] of readings) {
        const sentences = describeAvailability({ reading, ...withModel });
        expect(sentences, `${name}, deepRequested ${deepRequested}`).toEqual([`${lead}${refused}`]);
        expect(sentences.join(" ")).not.toMatch(/did not finish|turn on deep reports/);
      }
      // With caveats already quoted from the sections, no clause is needed.
      expect(describeAvailability({ reading: sectionsHtml, ...withModel })).toEqual([lead]);
    }
  });

  it("a refused flag changes nothing without it, and adds no clause to a report from the full text", () => {
    const base = {
      providerConfigured: true,
      profileHasProject: true,
      modelFailed: false,
    };
    const abstractReport = { basis: "model-abstract" as const, droppedClaims: 0, deepRequested: true };
    // Absent or false: the sentence the page has always had.
    expect(describeAvailability({ reading: { ...sectionsPdf, caveats: [] }, report: abstractReport, ...base })).toEqual(
      describeAvailability({ reading: { ...sectionsPdf, caveats: [] }, report: abstractReport, ...base, refused: false }),
    );
    expect(
      describeAvailability({ reading: { ...sectionsPdf, caveats: [] }, report: abstractReport, ...base }).join(" "),
    ).toMatch(/did not finish/);
    // A report written from the full text was not refused: the flag adds nothing.
    const fullTextReport = { basis: "model-fulltext" as const, droppedClaims: 0 };
    expect(describeAvailability({ reading: sectionsPdf, report: fullTextReport, ...base, refused: true })).toEqual(
      describeAvailability({ reading: sectionsPdf, report: fullTextReport, ...base }),
    );
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


describe("placeFigures", () => {
  // P1-04: a ReadingSection carries its id; these tests do not look at it.
  const section = (heading: string, ...paragraphs: string[]) => ({ id: `s:${heading}`, heading, canonical: "body", paragraphs });
  const cap = (n: number, extra: Record<string, unknown> = {}) => ({
    ordinal: n - 1,
    label: `Figure ${n}`,
    caption: `caption ${n}`,
    ...extra,
  });

  it("puts a figure after the paragraph that first names it", () => {
    const placed = placeFigures(
      [section("Intro", "We begin.", "As Figure 2 shows, it works.", "Later."), section("Method", "Fig. 1 is the model.")],
      [cap(1, { imageUrl: "https://x/1.png" }), cap(2, { imageUrl: "https://x/2.png" })],
      null,
    );
    expect(placed[0].figures).toEqual([{ ordinal: 1, label: "Figure 2", caption: "caption 2", after: 1, imageUrl: "https://x/2.png" }]);
    expect(placed[1].figures).toEqual([{ ordinal: 0, label: "Figure 1", caption: "caption 1", after: 0, imageUrl: "https://x/1.png" }]);
  });

  it("does not mistake Figure 12 for Figure 1", () => {
    const placed = placeFigures([section("A", "See Figure 12."), section("B", "See Figure 1.")], [cap(1)], null);
    expect(placed[0].figures).toBeUndefined();
    expect(placed[1].figures?.[0].after).toBe(0);
  });

  it("lands an unmentioned figure at the end of the section where the caption sat", () => {
    const placed = placeFigures(
      [section("A", "a".repeat(100)), section("B", "b".repeat(100), "bb"), section("C", "c".repeat(100))],
      [cap(7, { at: 0.5 })],
      null,
    );
    expect(placed[1].figures?.[0]).toMatchObject({ label: "Figure 7", after: 1 });
    expect(placed[0].figures).toBeUndefined();
    expect(placed[2].figures).toBeUndefined();
  });

  it("leaves tables out: a table's caption without its table says nothing", () => {
    const placed = placeFigures([section("A", "See Table 1 and Figure 1.")], [
      { ordinal: 0, label: "Table 1", caption: "numbers" },
      cap(1),
    ], null);
    expect(placed[0].figures?.map((f) => f.label)).toEqual(["Figure 1"]);
  });

  it("offers a PDF page's picture only when the page holds one figure", () => {
    const placed = placeFigures(
      [section("A", "Figure 1 and Figure 2 and Figure 3.")],
      [cap(1, { page: 3 }), cap(2, { page: 5 }), cap(3, { page: 5 })],
      { paperId: "openalex:W1" },
    );
    const byLabel = Object.fromEntries((placed[0].figures ?? []).map((f) => [f.label, f]));
    expect(byLabel["Figure 1"].imageUrl).toBe(pdfFigureUrl("openalex:W1", 3));
    expect(byLabel["Figure 1"].page).toBe(3);
    expect(byLabel["Figure 2"].imageUrl).toBeUndefined();
    expect(byLabel["Figure 3"].imageUrl).toBeUndefined();
  });

  // P0-07 (§1e.5, A's F5): an uploaded PDF's captions carry pages since
  // P0-03, and the page-image route serves public papers only — for an
  // `upload:` id it answers 404, a wasted request per figure. Until
  // BACKLOG-01 serves uploads, an upload's figure is its caption and page,
  // with no picture URL; the page already sets that as "caption · p.N".
  it("offers no page picture for an uploaded PDF — the caption and its page stand alone", () => {
    const uploadPaper = { ...normalPaper, id: "upload:0123456789abcdef" } as Paper;
    const doc = docWith(
      [{ id: "s0", heading: "1 Results", canonical: "results", text: "Figure 1 shows the creep rate against boundary density." }],
      [{ ordinal: 1, label: "Figure 1", caption: "Creep rate against boundary density.", page: 2, at: 0.5 }],
    );
    const pdfDoc = { ...doc, source: "pdf" as const, pageCount: 4 };
    const uploadLink = { url: "/api/papers/upload/0123456789abcdef/file", kind: "pdf" as const, label: "upload" as const, rank: 0 };

    const uploaded = buildReading(uploadPaper, fullTextOk(pdfDoc, uploadLink), NOW);
    const figure = uploaded.body[0].figures?.[0];

    expect(figure).toMatchObject({ label: "Figure 1", caption: "Creep rate against boundary density.", page: 2 });
    expect(figure?.imageUrl).toBeUndefined();
    expect(JSON.stringify(uploaded.body)).not.toContain("figure-image");

    // Directly: an upload id gets no picture; a public paper's PDF still does.
    const placed = placeFigures(
      [section("A", "Figure 1 is here.")],
      [cap(1, { page: 2 })],
      { paperId: "upload:0123456789abcdef" },
    );
    expect(placed[0].figures?.[0].imageUrl).toBeUndefined();
    expect(placeFigures([section("A", "Figure 1 is here.")], [cap(1, { page: 2 })], { paperId: "openalex:W1" })[0].figures?.[0].imageUrl)
      .toBe(pdfFigureUrl("openalex:W1", 2));
  });

  it("places each figure once, and leaves a section without figures untouched", () => {
    const placed = placeFigures([section("A", "Figure 1. Figure 1 again.")], [cap(1), cap(1)], null);
    expect(placed[0].figures).toHaveLength(1);
    expect("figures" in placeFigures([section("A", "nothing")], [], null)[0]).toBe(false);
  });
});


describe("equations in the body", () => {
  it("stands a lifted equation after the paragraph it followed, and drops the marker", () => {
    const doc = docWith([
      { id: "s0", heading: "3 Attention", canonical: "methods", text: `We compute\n\n${blockMarker(0)}\n\nwhere d is the key size.\n\n${blockMarker(1)}` },
    ]);
    doc.equations = [{ latex: "\\mathrm{softmax}(QK^T)V", number: "(1)" }, { text: "L = a + b" }];
    const reading = buildReading(normalPaper, fullTextOk(doc, ARXIV_HTML_LINK), NOW);
    expect(reading.body[0].paragraphs).toEqual(["We compute", "where d is the key size."]);
    expect(reading.body[0].equations).toEqual([
      { latex: "\\mathrm{softmax}(QK^T)V", number: "(1)", after: 0 },
      { text: "L = a + b", after: 1 },
    ]);
  });

  it("keeps a marker with no equation behind it out of the text", () => {
    const doc = docWith([{ id: "s0", heading: "A", canonical: "body", text: `Only words.\n\n${blockMarker(7)}` }]);
    const reading = buildReading(normalPaper, fullTextOk(doc, ARXIV_HTML_LINK), NOW);
    expect(reading.body[0].paragraphs).toEqual(["Only words."]);
    expect(reading.body[0].equations).toBeUndefined();
  });
});

// P1-04 (§1f.12): the reading carries the map, computed on the server where
// the document is — the browser never holds the document — and each body
// section carries the section's id, so map row k, body section k and the
// route's keys all name the same section.
describe("buildReading — the reading map and section ids (P1-04)", () => {
  it("carries the map of the body it renders, and each section's id", () => {
    const reading = buildReading(zenodoPaper, fullTextOk(zenodoDoc, ZENODO_LINK), NOW);
    const ids = zenodoDoc.sections.map((_, i) => `s${i}`).filter((_, i) => zenodoDoc.sections[i].canonical !== "abstract");

    expect(reading.map).toBeDefined();
    expect(reading.body.map((s) => s.id)).toEqual(ids);
    expect(reading.map?.sections.map((s) => s.id)).toEqual(ids);
    expect(reading.map?.sections.map((s) => s.heading)).toEqual(reading.body.map((s) => s.heading));
    reading.body.forEach((section, k) => {
      expect(reading.map?.sections[k].paragraphs.map((p) => p.index)).toEqual(section.paragraphs.map((_, i) => i));
    });
    expect(reading.map?.totalMinutes).toBeGreaterThan(0);
  });

  it("uses the document's own ids where it has them", () => {
    const doc = docWith([
      { id: "s4", heading: "4 Results", canonical: "results", text: "Accuracy reached 91% on the held-out set." },
      { id: "s7", heading: "7 Conclusion", canonical: "conclusion", text: "We presented a method." },
    ]);
    const reading = buildReading(normalPaper, fullTextOk(doc, ARXIV_HTML_LINK), NOW);

    expect(reading.body.map((s) => s.id)).toEqual(["s4", "s7"]);
    expect(reading.map?.sections.map((s) => s.id)).toEqual(["s4", "s7"]);
  });

  it("has no map without a body: the abstract alone, or full text with nothing to render", () => {
    expect("map" in buildReading(normalPaper, null, NOW)).toBe(false);
    const abstractOnly = docWith([{ id: "s0", heading: "Abstract", canonical: "abstract", text: "Only an abstract." }]);
    const reading = buildReading(normalPaper, fullTextOk(abstractOnly, ARXIV_HTML_LINK), NOW);
    expect(reading.body).toEqual([]);
    expect("map" in reading).toBe(false);
  });
});

