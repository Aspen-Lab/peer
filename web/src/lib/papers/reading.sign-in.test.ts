import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import { buildReading, describeAvailability, type PaperReading } from "./reading";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";
import normalPaperJson from "./__fixtures__/abstract-normal-W7204479535.paper.json";
import noAbstractPaperJson from "./__fixtures__/no-abstract-W7204992910.paper.json";
import zenodoPaperJson from "./__fixtures__/zenodo-W7208807247.paper.json";
import arxivPaperJson from "./__fixtures__/arxiv-2609.02113.paper.json";

// A reader with a key saved who is signed out gets no model (`aiAvailability`:
// "none"), and the Decision block's sentence told them the blocks "need a key" —
// a key they already have. For exactly that state (`keyNeedsSignIn`) the
// sentence says the blocks need them to sign in; every other state keeps its
// words. The fixtures and the expected key sentences are reading.test.ts's own.

const arxivHtmlDoc = arxivHtmlDocJson as unknown as ExtractedDocument;
const zenodoDoc = zenodoDocJson as unknown as ExtractedDocument;
const normalPaper = normalPaperJson as unknown as Paper;
const noAbstractPaper = noAbstractPaperJson as unknown as Paper;
const zenodoPaper = zenodoPaperJson as unknown as Paper;
const arxivPaper = arxivPaperJson as unknown as Paper;

const NOW = new Date("2026-09-06T12:00:00.000Z");

function fullTextOk(doc: ExtractedDocument, sourceLink: FullTextResult["sourceLink"]): FullTextResult {
  return { status: "ok", doc, sourceLink, attempts: [] };
}

const ARXIV_HTML_LINK = { url: "https://arxiv.org/html/2609.02697", kind: "html" as const, label: "arxiv-html" as const, rank: 5 };
const ZENODO_LINK = {
  url: "https://zenodo.org/api/records/22316532/files/paper.pdf/content",
  kind: "pdf" as const,
  label: "zenodo" as const,
  rank: 12,
};

const abstractOnly = buildReading(normalPaper, null, NOW);
const noAbstract = buildReading(noAbstractPaper, null, NOW);
const sectionsHtml = buildReading(arxivPaper, fullTextOk(arxivHtmlDoc, ARXIV_HTML_LINK), NOW);
const sectionsPdf = buildReading(zenodoPaper, fullTextOk(zenodoDoc, ZENODO_LINK), NOW);
const unreadable: PaperReading = {
  ...abstractOnly,
  provenance: { ...abstractOnly.provenance, fullText: "pdf_unreadable_here" },
  omitted: abstractOnly.omitted.map((entry) =>
    entry.reason === "not_in_abstract" ? { ...entry, reason: "pdf_only_hosted" as const } : entry,
  ),
};
const empty: PaperReading = {
  ...abstractOnly,
  provenance: { ...abstractOnly.provenance, fullText: "pdf_empty" },
  omitted: abstractOnly.omitted.map((entry) =>
    entry.reason === "not_in_abstract" ? { ...entry, reason: "pdf_empty" as const } : entry,
  ),
};
const paywalled: PaperReading = {
  ...abstractOnly,
  provenance: { ...abstractOnly.provenance, fullText: "paywalled", paywallHost: "nature.com" },
};

const noModel = { report: null, providerConfigured: false, profileHasProject: false, modelFailed: false };

/** Each reading a reader can reach with no model, and its sentence today ("needs a key") and signed out with a key. */
const CASES: { name: string; reading: PaperReading; withoutKey: string; signedOutWithKey: string }[] = [
  {
    name: "abstract only",
    reading: abstractOnly,
    withoutKey: "Abstract only. Method, caveats and what it means for your project need the full text and a key.",
    signedOutWithKey:
      "Abstract only. Method, caveats and what it means for your project need the full text and you to sign in.",
  },
  {
    name: "PDF unreadable here",
    reading: unreadable,
    withoutKey:
      "Abstract only; the PDF carries no text to read — it looks scanned. What it means for your project needs a key.",
    signedOutWithKey:
      "Abstract only; the PDF carries no text to read — it looks scanned. What it means for your project needs you to sign in.",
  },
  {
    name: "paywalled",
    reading: paywalled,
    withoutKey: "Abstract only — nature.com keeps the full text behind access. What it means for your project needs a key.",
    signedOutWithKey:
      "Abstract only — nature.com keeps the full text behind access. What it means for your project needs you to sign in.",
  },
  {
    name: "sections from arXiv HTML",
    reading: sectionsHtml,
    withoutKey:
      "Full text read: arXiv HTML, with a limitations section. Findings, method and caveats are below. What it means for your project and a next step need a key.",
    signedOutWithKey:
      "Full text read: arXiv HTML, with a limitations section. Findings, method and caveats are below. What it means for your project and a next step need you to sign in.",
  },
  {
    name: "sections from a short PDF",
    reading: sectionsPdf,
    withoutKey:
      "Full text read: a 5-page PDF. The method is below. What it means for your project and a next step need a key.",
    signedOutWithKey:
      "Full text read: a 5-page PDF. The method is below. What it means for your project and a next step need you to sign in.",
  },
];

describe("describeAvailability - a key saved, the reader signed out (keyNeedsSignIn)", () => {
  it.each(CASES)("$name: the blocks need you to sign in, not a key", ({ reading, signedOutWithKey }) => {
    const out = describeAvailability({ reading, ...noModel, keyNeedsSignIn: true });
    expect(out).toEqual([signedOutWithKey]);
    expect(out.join(" ")).not.toMatch(/\ba key\b/);
  });

  it.each(CASES)("$name: with no key (keyNeedsSignIn false or absent), word for word as before", ({ reading, withoutKey }) => {
    expect(describeAvailability({ reading, ...noModel })).toEqual([withoutKey]);
    expect(describeAvailability({ reading, ...noModel, keyNeedsSignIn: false })).toEqual([withoutKey]);
  });

  it("changes only what the blocks wait on: the rest of each sentence is the same", () => {
    for (const { withoutKey, signedOutWithKey } of CASES) {
      expect(signedOutWithKey).toBe(withoutKey.replace(/a key\.$/, "you to sign in."));
    }
  });

  it("a sentence that names no key is unchanged: no abstract (with and without a TLDR), and a PDF with no text", () => {
    const withTldr: PaperReading = {
      ...noAbstract,
      provenance: { ...noAbstract.provenance, tldr: "A diffusion model for knowledge tracing." },
    };
    for (const reading of [noAbstract, withTldr, empty]) {
      expect(describeAvailability({ reading, ...noModel, keyNeedsSignIn: true })).toEqual(
        describeAvailability({ reading, ...noModel }),
      );
    }
    expect(describeAvailability({ reading: empty, ...noModel, keyNeedsSignIn: true })).toEqual([
      "This PDF has no readable text — Peer could not extract anything from it.",
    ]);
  });

  it("with a model configured, or a model's report on the page, the flag changes nothing", () => {
    for (const { reading } of CASES) {
      const configured = { ...noModel, providerConfigured: true };
      expect(describeAvailability({ reading, ...configured, keyNeedsSignIn: true })).toEqual(
        describeAvailability({ reading, ...configured }),
      );
      const reported = {
        report: { basis: "model-abstract" as const, droppedClaims: 0 },
        providerConfigured: true,
        profileHasProject: false,
        modelFailed: false,
      };
      expect(describeAvailability({ reading, ...reported, keyNeedsSignIn: true })).toEqual(
        describeAvailability({ reading, ...reported }),
      );
    }
  });

  it("the model-failed line still follows, unchanged", () => {
    expect(
      describeAvailability({ reading: sectionsHtml, ...noModel, modelFailed: true, keyNeedsSignIn: true }),
    ).toEqual([CASES[3].signedOutWithKey, "Your model could not finish; what is below is the paper's own text."]);
  });
});
