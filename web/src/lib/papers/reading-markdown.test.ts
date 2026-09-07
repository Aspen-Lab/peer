import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { ExtractedDocument } from "./html-text";
import { buildReading, describeAvailability, omittedForReader } from "./reading";
import { buildBibTeX, readingToMarkdown, type MarkdownReport } from "./reading-markdown";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import normalPaperJson from "./__fixtures__/abstract-normal-W7204479535.paper.json";
import noAbstractPaperJson from "./__fixtures__/no-abstract-W7204992910.paper.json";
import arxivPaperJson from "./__fixtures__/arxiv-2609.02113.paper.json";

const arxivHtmlDoc = arxivHtmlDocJson as unknown as ExtractedDocument;
const normalPaper = normalPaperJson as unknown as Paper;
const noAbstractPaper = noAbstractPaperJson as unknown as Paper;
const arxivPaper = arxivPaperJson as unknown as Paper;

const NOW = new Date("2026-09-06T12:00:00.000Z");
const noModel = { report: null, providerConfigured: false, profileHasProject: false, modelFailed: false };

describe("readingToMarkdown", () => {
  it("no abstract: frontmatter, the record, the availability line and what is not on the page", () => {
    const reading = buildReading(noAbstractPaper, null, NOW);
    const sentences = describeAvailability({ reading, ...noModel });

    const md = readingToMarkdown(noAbstractPaper, reading, null, sentences, NOW);

    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "DiffKT: a diffusion model for fine-grained knowledge tracing"');
    expect(md).toContain('authors: ["R.D. Liu", "Yong Niu", "Hu Li"]');
    expect(md).toContain('doi: "10.1007/s10489-026-07459-9"');
    expect(md).toContain('url: "https://doi.org/10.1007/s10489-026-07459-9"');
    expect(md).toContain("basis: abstract");
    expect(md).toContain('pages: ""');
    expect(md).toContain('generated: "2026-09-06T12:00:00.000Z"');
    expect(md).toMatch(/peer_version: "\d+\.\d+\.\d+"/);
    expect(md).toContain("# DiffKT: a diffusion model for fine-grained knowledge tracing");
    expect(md).toContain("No abstract is published where Peer can read it — only the record.");
    expect(md).toContain("## Not on this page");
    expect(md).toContain("- The skim, findings, method and caveats — no abstract is published where Peer can read it");
    expect(md).toContain("- For your project and next step — need a key");
    expect(md).not.toContain("## What they found");
    expect(md).toContain("```bibtex\n@inproceedings{liu2026diffkt,");
    expect(md.trimEnd().endsWith("```")).toBe(true);
  });

  it("abstract only: the ink marks are bold, the paragraph break is the intro split", () => {
    const reading = buildReading(normalPaper, null, NOW);
    const sentences = describeAvailability({ reading, ...noModel });

    const md = readingToMarkdown(normalPaper, reading, null, sentences, NOW);

    const [first] = reading.abstract.marks;
    expect(md).toContain(`**${reading.abstract.sentences[first]}**`);
    // Intro is its own paragraph.
    expect(md).toContain(`${reading.abstract.sentences[0]}\n\n`);
    expect(md).toContain("*From the abstract · claim and numbers in ink*");
    expect(md).toContain("Abstract only. Method, caveats and what it means for your project need the full text and a key.");
    expect(md).toContain("- Findings, method and caveats — not in the abstract");
  });

  it("sections: every quote carries its heading, and the omissions list shrinks", () => {
    const reading = buildReading(
      arxivPaper,
      {
        status: "ok",
        doc: arxivHtmlDoc,
        sourceLink: { url: "https://arxiv.org/html/2609.02697", kind: "html", label: "arxiv-html", rank: 5 },
        attempts: [],
      },
      NOW,
    );

    const md = readingToMarkdown(arxivPaper, reading, null, describeAvailability({ reading, ...noModel }), NOW);

    expect(md).toContain("basis: sections");
    expect(md).toContain('source: "arXiv HTML"');
    expect(md).toContain("## What they found, and how big");
    expect(md).toContain("## Where it is thin");
    expect(md).toContain(`> ${reading.caveats[0].text} — §4.5 Limitations`);
    expect(md).toContain(`> ${reading.findings[0].text} — §4.4 Results`);
    expect(md).toContain("## Not on this page\n\n- For your project and next step — need a key\n");
  });

  it("deep report: every claim is followed by its evidence blockquote", () => {
    const reading = buildReading(normalPaper, null, NOW);
    const report: MarkdownReport = {
      skim: [{ text: "Five predictors were benchmarked on three HIV-1 enzymes.", evidence: reading.abstract.sentences[1], evidenceWhere: "abstract" }],
      whatItProposes: {
        methods: [{ text: "Predictions were scored against post-cutoff crystal structures.", evidence: "We evaluate predictions against a curated dataset.", evidenceWhere: "2 Methods" }],
      },
      resultsAndSignificance: {
        keyResults: [
          { title: "AlphaFold leads", detail: "AlphaFold-based models score best overall.", evidence: "Our results show that AlphaFold-based models achieve strong overall performance.", evidenceWhere: "4 Results" },
          { title: "RT is hardest", detail: "Reverse transcriptase degrades every model.", evidence: "Performance degrades markedly for RT.", evidenceWhere: "4 Results" },
        ],
      },
      limitations: [{ text: "Only three enzymes were covered.", evidence: "We restrict the study to three enzymes.", evidenceWhere: "5 Discussion" }],
      relationToYourWork: {
        basedOn: "I am benchmarking structure predictors on viral proteases for a resistance atlas that spans every clade we have sequenced so far.",
        items: [{ text: "The protease benchmark is directly reusable.", evidence: "We evaluate predictions against a curated dataset.", evidenceWhere: "abstract" }],
      },
      nextStep: { text: "Re-run the docking analysis with the newest AlphaFold3 weights.", evidence: "Finally, a docking analysis using protease inhibitor Darunavir indicates that AlphaFold3 most closely reproduces the binding pose.", evidenceWhere: "4 Results" },
      provenance: { basis: "model-fulltext" },
    };
    const sentences = describeAvailability({
      reading,
      report: { basis: "model-fulltext", droppedClaims: 0, sourceKind: "pdf", pageCount: 12 },
      providerConfigured: true,
      profileHasProject: true,
      modelFailed: false,
    });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW);

    expect(md).toContain("basis: model-fulltext");
    expect(md).toContain("Five predictors were benchmarked on three HIV-1 enzymes.\n\n*Peer's skim, from the full text*");
    expect(md).toContain("**AlphaFold leads.** AlphaFold-based models score best overall.\n\n> Our results show that AlphaFold-based models achieve strong overall performance. — §4 Results");
    expect(md).toContain("**RT is hardest.** Reverse transcriptase degrades every model.\n\n> Performance degrades markedly for RT. — §4 Results");
    expect(md).toContain("## How it was done\n\nPredictions were scored against post-cutoff crystal structures.\n\n> We evaluate predictions against a curated dataset. — §2 Methods");
    expect(md).toContain("## Where it is thin\n\nOnly three enzymes were covered.\n\n> We restrict the study to three enzymes. — §5 Discussion");
    expect(md).toContain("## For your project\n\n*Your project: I am benchmarking structure predictors on viral proteases for a resistance atlas that spans every cl…*");
    expect(md).toContain("The protease benchmark is directly reusable.\n\n> We evaluate predictions against a curated dataset. — abstract");
    expect(md).toContain("## Next step\n\nRe-run the docking analysis with the newest AlphaFold3 weights.\n\n> Finally, a docking analysis");
    // Every block is filled, so nothing is listed as missing.
    expect(md).not.toContain("## Not on this page");
    expect(md).toContain("Read by your model from the full text (PDF, 12 pages)");
  });

  it("deep report without a next step or relation: the omissions never say 'need a key'", () => {
    // The reader ran the model on their own key; the model produced no next
    // step and its relation was dropped in verification. The export's "Not
    // on this page" must say that, not that the blocks need a key.
    const reading = buildReading(normalPaper, null, NOW);
    const availability = { basis: "model-fulltext" as const, droppedClaims: 1, sourceKind: "pdf" };
    const report: MarkdownReport = {
      skim: [{ text: "Five predictors were benchmarked on three HIV-1 enzymes.", evidence: reading.abstract.sentences[1], evidenceWhere: "abstract" }],
      whatItProposes: { methods: [] },
      resultsAndSignificance: {
        keyResults: [
          { title: "AlphaFold leads", detail: "AlphaFold-based models score best overall.", evidence: "Our results show that AlphaFold-based models achieve strong overall performance.", evidenceWhere: "4 Results" },
        ],
      },
      limitations: [{ text: "Only three enzymes were covered.", evidence: "We restrict the study to three enzymes.", evidenceWhere: "5 Discussion" }],
      provenance: { basis: "model-fulltext" },
    };
    const sentences = describeAvailability({
      reading,
      report: availability,
      providerConfigured: true,
      profileHasProject: true,
      modelFailed: false,
    });

    const md = readingToMarkdown(
      normalPaper,
      { ...reading, omitted: omittedForReader(reading, availability, true) },
      report,
      sentences,
      NOW,
    );

    expect(md).toContain("## Not on this page");
    // The reading (abstract only here) still names its own reason for the
    // method; the two model-only blocks get the model's.
    expect(md).toContain("- Method — not in the abstract");
    expect(md).toContain(
      "- For your project and next step — the model gave no sentences for them that could be verified",
    );
    expect(md).not.toContain("need a key");
    expect(md).not.toContain("needs a key");
  });

  it("escapes quotes in frontmatter scalars", () => {
    const paper = { ...normalPaper, title: 'The "best" model' };
    const reading = buildReading(paper, null, NOW);

    const md = readingToMarkdown(paper, reading, null, [], NOW);

    expect(md).toContain('title: "The \\"best\\" model"');
  });
});

describe("buildBibTeX", () => {
  it("keys on first author, year and first title word, and carries the arXiv link", () => {
    expect(buildBibTeX(arxivPaper)).toBe(
      `@inproceedings{cumbo2026logarithmicscale,
  title={${arxivPaper.title}},
  author={${arxivPaper.authors.join(" and ")}},
  booktitle={arXiv},
  year={2026},
  url={https://arxiv.org/abs/2609.02113v1}
}`,
    );
  });
});
