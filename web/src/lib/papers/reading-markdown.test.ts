import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { ExtractedDocument } from "./html-text";
import { buildReading, describeAvailability, omittedForReader } from "./reading";
import type { PaperReading, ReadingQuote } from "./reading";
import { readingToMarkdown, type MarkdownReport } from "./reading-markdown";
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

// P7-12 (R3, the owner's order): the `c` copy carries the notes only — the title, one `DOI:` line
// under it when the paper has one, and the page's sections. No YAML front matter, no "Not on this
// page" list, no BibTeX block. Peer's Obsidian note template keeps its own front matter and is not
// this export.
describe("readingToMarkdown", () => {
  it("no abstract: the title, the DOI line and the availability line, and nothing about what is not on the page", () => {
    const reading = buildReading(noAbstractPaper, null, NOW);
    const sentences = describeAvailability({ reading, ...noModel });

    const md = readingToMarkdown(noAbstractPaper, reading, null, sentences);

    expect(
      md.startsWith(
        "# DiffKT: a diffusion model for fine-grained knowledge tracing\n\nDOI: 10.1007/s10489-026-07459-9\n\n",
      ),
    ).toBe(true);
    expect(md).toContain("No abstract is published where Peer can read it — only the record.");
    expect(md).not.toContain("## What they found");
    expect(md).not.toContain("## Not on this page");
    expect(md).not.toContain("```");
  });

  it("abstract only: the ink marks are bold, the paragraph break is the intro split", () => {
    const reading = buildReading(normalPaper, null, NOW);
    const sentences = describeAvailability({ reading, ...noModel });

    const md = readingToMarkdown(normalPaper, reading, null, sentences);

    const [first] = reading.abstract.marks;
    expect(md).toContain(`**${reading.abstract.sentences[first]}**`);
    // Intro is its own paragraph.
    expect(md).toContain(`${reading.abstract.sentences[0]}\n\n`);
    expect(md).toContain("*From the abstract · claim and numbers in ink*");
    expect(md).toContain("Abstract only. Method, caveats and what it means for your project need the full text and a key.");
    // The omissions list went with the front matter (P7-12): the copy says what it has, not what it lacks.
    expect(md).not.toContain("Not on this page");
    expect(md).not.toContain("not in the abstract");
  });

  it("sections: every quote carries its heading", () => {
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

    const md = readingToMarkdown(arxivPaper, reading, null, describeAvailability({ reading, ...noModel }));

    expect(md).toContain("## What they found, and how big");
    expect(md).toContain("## Where it is thin");
    expect(md).toContain(`> ${reading.caveats[0].text} — §4.5 Limitations`);
    expect(md).toContain(`> ${reading.findings[0].text} — §4.4 Results`);
    expect(md).not.toContain("## Not on this page");
    expect(md).not.toContain("- For your project and next step");
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

    const md = readingToMarkdown(normalPaper, reading, report, sentences);

    expect(md).toContain("Five predictors were benchmarked on three HIV-1 enzymes.\n\n*Peer's skim, from the full text*");
    expect(md).toContain("**AlphaFold leads.** AlphaFold-based models score best overall.\n\n> Our results show that AlphaFold-based models achieve strong overall performance. — §4 Results");
    expect(md).toContain("**RT is hardest.** Reverse transcriptase degrades every model.\n\n> Performance degrades markedly for RT. — §4 Results");
    expect(md).toContain("## How it was done\n\nPredictions were scored against post-cutoff crystal structures.\n\n> We evaluate predictions against a curated dataset. — §2 Methods");
    expect(md).toContain("## Where it is thin\n\nOnly three enzymes were covered.\n\n> We restrict the study to three enzymes. — §5 Discussion");
    expect(md).toContain("## For your project\n\n*Your project: I am benchmarking structure predictors on viral proteases for a resistance atlas that spans every cl…*");
    expect(md).toContain("The protease benchmark is directly reusable.\n\n> We evaluate predictions against a curated dataset. — abstract");
    expect(md).toContain("## Next step\n\nRe-run the docking analysis with the newest AlphaFold3 weights.\n\n> Finally, a docking analysis");
    expect(md).not.toContain("## Not on this page");
    expect(md).toContain("Read by your model from the full text (PDF, 12 pages)");
  });

  // The page still keeps its omissions (the reading carries them for the availability line); the copy
  // does not print them. This reading is the one the old "Not on this page" list said "the model gave no
  // sentences for them that could be verified" about — it must not say "need a key" either.
  it("deep report without a next step or relation: a reading that carries omissions still copies none of them", () => {
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
    const withOmissions = { ...reading, omitted: omittedForReader(reading, availability, true) };
    expect(withOmissions.omitted.length).toBeGreaterThan(0);

    const md = readingToMarkdown(normalPaper, withOmissions, report, sentences);

    expect(md).not.toContain("## Not on this page");
    expect(md).not.toContain("- Method — not in the abstract");
    expect(md).not.toContain("the model gave no sentences");
    expect(md).not.toContain("need a key");
    expect(md).not.toContain("needs a key");
    // What it does have is still there.
    expect(md).toContain("## Where it is thin");
  });

  // P0-03: every PDF is read with pdf.js, so "the PDF is readable only by a
  // self-hosted Peer" is no longer true of any PDF. What `pdf_only_hosted`
  // marks now is a PDF link with no text in it — the page already says so
  // ("the PDF carries no text to read — it looks scanned"); the copy carried the
  // same phrase in its omissions list, which P7-12 removed.
  it("a PDF link with no text layer: the copy has no omissions list, and never says only a self-hosted Peer reads it", () => {
    const reading = buildReading(
      normalPaper,
      {
        status: "no_full_text",
        reason: "No legal full-text source returned readable body text.",
        attempts: [{ link: { url: "https://zenodo.org/records/1/files/paper.pdf", kind: "pdf", label: "zenodo", rank: 30 }, outcome: "source_unavailable: no-text-layer" }],
      },
      NOW,
    );
    const sentences = describeAvailability({ reading, ...noModel });

    const md = readingToMarkdown(normalPaper, reading, null, sentences);

    expect(reading.provenance.fullText).toBe("pdf_unreadable_here");
    expect(reading.omitted.some((entry) => entry.reason === "pdf_only_hosted")).toBe(true);
    expect(md).not.toContain("## Not on this page");
    expect(md).not.toMatch(/^- .+ — the PDF carries no text to read$/m);
    expect(md).not.toContain("self-hosted");
  });

  it("copies a title with quotes as it is: there is no YAML to escape it for", () => {
    const paper = { ...normalPaper, title: 'The "best" model' };
    const reading = buildReading(paper, null, NOW);

    const md = readingToMarkdown(paper, reading, null, []);

    expect(md.startsWith('# The "best" model\n')).toBe(true);
    expect(md).not.toContain('\\"');
  });
});

// P7-12 (R3): what the copy no longer carries, and the one line it keeps from the record.
describe("readingToMarkdown carries the notes only (P7-12, R3)", () => {
  const deepReport = (reading: ReturnType<typeof buildReading>): MarkdownReport => ({
    skim: [{ text: "Five predictors were benchmarked on three HIV-1 enzymes.", evidence: reading.abstract.sentences[1], evidenceWhere: "abstract" }],
    whatItProposes: { summary: "Peer's proposal summary." },
    limitations: [{ text: "Only three enzymes were covered.", evidence: "We restrict the study to three enzymes.", evidenceWhere: "5 Discussion" }],
    provenance: { basis: "model-fulltext" },
  });
  const cases = () => {
    const normal = buildReading(normalPaper, null, NOW);
    const noAbstract = buildReading(noAbstractPaper, null, NOW);
    const sections = buildReading(
      arxivPaper,
      {
        status: "ok",
        doc: arxivHtmlDoc,
        sourceLink: { url: "https://arxiv.org/html/2609.02697", kind: "html", label: "arxiv-html", rank: 5 },
        attempts: [],
      },
      NOW,
    );
    const sentencesOf = (reading: ReturnType<typeof buildReading>) => describeAvailability({ reading, ...noModel });
    return [
      { name: "abstract only", paper: normalPaper, reading: normal, report: null, sentences: sentencesOf(normal) },
      { name: "no abstract", paper: noAbstractPaper, reading: noAbstract, report: null, sentences: sentencesOf(noAbstract) },
      { name: "sections from arXiv HTML", paper: arxivPaper, reading: sections, report: null, sentences: sentencesOf(sections) },
      { name: "a deep report", paper: normalPaper, reading: normal, report: deepReport(normal), sentences: sentencesOf(normal) },
    ];
  };

  it.each(cases().map((c) => [c.name, c] as const))("%s: starts with # <title>, has no front matter, no omissions list and no BibTeX", (_name, c) => {
    const md = readingToMarkdown(c.paper, c.reading, c.report, c.sentences);

    expect(md.startsWith(`# ${c.paper.title}\n`)).toBe(true);
    expect(md).not.toMatch(/^---$/m);
    for (const key of ["title:", "authors:", "venue:", "date:", "url:", "source:", "basis:", "pages:", "questions:", "generated:", "peer_version:"]) {
      expect(md, key).not.toMatch(new RegExp(`^${key}`, "m"));
    }
    expect(md).not.toContain("Not on this page");
    expect(md).not.toContain("```bibtex");
    expect(md).not.toContain("```");
    expect(md).not.toContain("@inproceedings");
  });

  it.each(cases().map((c) => [c.name, c] as const))("%s: ends with one newline, not a fence and not a blank line", (_name, c) => {
    const md = readingToMarkdown(c.paper, c.reading, c.report, c.sentences);

    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("puts one DOI line right under the title when the paper has a DOI", () => {
    const reading = buildReading(normalPaper, null, NOW);

    const md = readingToMarkdown(normalPaper, reading, null, describeAvailability({ reading, ...noModel }));

    const lines = md.split("\n");
    expect(lines[0]).toBe(`# ${normalPaper.title}`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("DOI: 10.1038/s41598-026-64923-9");
    expect(lines[3]).toBe("");
    expect(lines.filter((line) => line.startsWith("DOI:"))).toHaveLength(1);
    // The old front matter wrote a lowercase `doi:` key; that line is gone.
    expect(md).not.toMatch(/^doi:/m);
  });

  it("has no DOI line for a paper with no DOI, and the sections follow the title directly", () => {
    const reading = buildReading(arxivPaper, null, NOW);
    expect(arxivPaper.doi).toBeFalsy();

    const md = readingToMarkdown(arxivPaper, reading, null, describeAvailability({ reading, ...noModel }));

    expect(md).not.toContain("DOI");
    expect(md.startsWith(`# ${arxivPaper.title}\n\n`)).toBe(true);
    expect(md.split("\n")[2]).not.toBe("");
  });

  it("keeps the skim, the abstract and its footer, the Decision sentences and the report's sections", () => {
    const reading = buildReading(normalPaper, null, NOW);
    const report: MarkdownReport = {
      ...deepReport(reading),
      nextStep: { text: "Re-run the docking analysis.", evidence: "Finally, a docking analysis indicates a binding pose.", evidenceWhere: "4 Results" },
    };
    const sentences = describeAvailability({
      reading,
      report: { basis: "model-fulltext", droppedClaims: 0, sourceKind: "pdf", pageCount: 12 },
      providerConfigured: true,
      profileHasProject: true,
      modelFailed: false,
    });

    const md = readingToMarkdown(normalPaper, reading, report, sentences);

    expect(md).toContain("*Peer's skim, from the full text*");
    expect(md).toContain("*From the abstract · claim and numbers in ink*");
    expect(md).toContain(sentences.join(" "));
    for (const heading of ["## What it proposes", "## Where it is thin", "## Next step"]) expect(md).toContain(heading);
    // Title, DOI, skim, abstract, Decision, sections — in the page's order.
    const at = (text: string) => md.indexOf(text);
    expect(at("DOI:")).toBeGreaterThan(at("# "));
    expect(at("*Peer's skim")).toBeGreaterThan(at("DOI:"));
    expect(at("*From the abstract")).toBeGreaterThan(at("*Peer's skim"));
    expect(at(sentences.join(" "))).toBeGreaterThan(at("*From the abstract"));
    expect(at("## What it proposes")).toBeGreaterThan(at(sentences.join(" ")));
  });
});

// P9-06 (the feature walk's X11): the clipboard's abstract came out as three paragraphs where the page
// shows one block. A PDF abstract keeps the line breaks of its text layer inside a sentence (the splitter
// breaks only after `.`, `!` or `?`), a `<p>` on the page collapses them and Markdown does not, and one of
// them fell right after an opening `**` — a bold run that opens on a line break is not bold. The copy now
// prints every piece of the paper's text on one line. Every sentence here is invented.
describe("readingToMarkdown prints the paper's text on one line (P9-06)", () => {
  const inventedPaper: Paper = {
    ...normalPaper,
    title: "Annealing texture in an invented oxide",
    doi: "",
    summaryIntro: "Quillium films were annealed for two hours at 600 K. The peak grew by 40 % after annealing.",
    summaryResultDiscussion: "",
  };
  const base = buildReading(inventedPaper, null, NOW);
  const withAbstract = (
    sentences: string[],
    introCount: number,
    marks: number[],
    over: Partial<PaperReading> = {},
  ): PaperReading => ({ ...base, abstract: { sentences, introCount, marks }, ...over });
  /** Everything between the title and the abstract's footer line. */
  const abstractBlock = (md: string) => md.slice(md.indexOf("\n\n") + 2, md.indexOf("\n\n*From the abstract"));
  /** The text of every bold run in a block. */
  const boldRuns = (block: string) => [...block.matchAll(/\*\*(.+?)\*\*/gs)].map((match) => match[1]);
  const quote = (text: string, heading = "2 Methods"): ReadingQuote => ({
    text,
    from: { kind: "section", heading, canonical: "methods" },
  });

  const BROKEN = [
    "Quillium films were annealed for two hours at 600 K.",
    "The \u27E8003\u27E9\n\n||ND texture of each film sharpened with annealing.",
    "\n  The \u27E8003\u27E9 peak grew by 40 % after\nannealing.\n",
    "Lattice strain stayed below 0.1 %.",
  ];

  it("a sentence that holds line breaks prints on one line, and a marked sentence's bold run is tight", () => {
    const reading = withAbstract(BROKEN, BROKEN.length, [2]);

    const md = readingToMarkdown(inventedPaper, reading, null, []);

    expect(abstractBlock(md)).toBe(
      [
        "Quillium films were annealed for two hours at 600 K.",
        "The \u27E8003\u27E9 ||ND texture of each film sharpened with annealing.",
        "**The \u27E8003\u27E9 peak grew by 40 % after annealing.**",
        "Lattice strain stayed below 0.1 %.",
      ].join(" "),
    );
    expect(abstractBlock(md)).not.toContain("\n");
  });

  it("a bold run never opens or closes on whitespace, wherever the break was", () => {
    // The break right after the sentence's start, and one right before its end.
    const sentences = ["\n\u27E8003\u27E9 reflections were sharp.\n\n", "A second sentence stayed plain."];

    const md = readingToMarkdown(inventedPaper, withAbstract(sentences, 2, [0]), null, []);

    expect(boldRuns(abstractBlock(md))).toEqual(["\u27E8003\u27E9 reflections were sharp."]);
  });

  it("the two paragraphs by introCount are kept, each on one line", () => {
    const reading = withAbstract(BROKEN, 2, [2]);

    const md = readingToMarkdown(inventedPaper, reading, null, []);

    expect(md).toContain(
      "\n\nQuillium films were annealed for two hours at 600 K. The \u27E8003\u27E9 ||ND texture of each film sharpened with annealing.\n\n" +
        "**The \u27E8003\u27E9 peak grew by 40 % after annealing.** Lattice strain stayed below 0.1 %.\n\n*From the abstract",
    );
  });

  it("an abstract already on one line prints exactly as it did", () => {
    const sentences = [
      "Quillium films were annealed for two hours at 600 K.",
      "The \u27E8003\u27E9 peak grew by 40 % after annealing.",
      "Lattice strain stayed below 0.1 %.",
    ];

    const md = readingToMarkdown(inventedPaper, withAbstract(sentences, 1, [1]), null, []);

    expect(md).toBe(
      [
        "# Annealing texture in an invented oxide",
        "",
        sentences[0],
        "",
        `**${sentences[1]}** ${sentences[2]}`,
        "",
        "*From the abstract \u00B7 claim and numbers in ink*",
        "",
      ].join("\n"),
    );
  });

  it("the line breaks an upload's abstract carries from the PDF are gone from the copy, bold runs tight", () => {
    // The route stores the abstract section's text as it is (`abstractLine` returns what fits as it
    // is), and `splitSentences` breaks only after `.`, `!` or `?`: a break after a `\u27E9` stays inside.
    const paper: Paper = {
      ...inventedPaper,
      summaryIntro:
        "Quillium films were annealed for two hours at 600 K. We index the \u27E8003\u27E9\n\n||ND texture of each film.\n" +
        "The \u27E8003\u27E9 peak sharpened by 40 % after\nannealing, and lattice strain stayed below 0.1 %.",
      summaryResultDiscussion: "",
    };
    const reading = buildReading(paper, null, NOW);
    expect(reading.abstract.sentences.length).toBeGreaterThan(1);

    const md = readingToMarkdown(paper, reading, null, []);

    const block = abstractBlock(md);
    expect(block).not.toMatch(/\s{2}|[\t\r\n]/);
    expect(block.replace(/\*\*/g, "")).toBe(reading.abstract.sentences.map((s) => s.replace(/\s+/g, " ").trim()).join(" "));
    for (const run of boldRuns(block)) expect(run).toBe(run.trim());
  });

  it("a marked sentence with nothing in it prints nothing, never an empty bold run", () => {
    const sentences = ["Quillium films were annealed for two hours at 600 K.", " \n ", "Lattice strain stayed below 0.1 %."];

    const md = readingToMarkdown(inventedPaper, withAbstract(sentences, 3, [1]), null, []);

    expect(abstractBlock(md)).toBe("Quillium films were annealed for two hours at 600 K. Lattice strain stayed below 0.1 %.");
    expect(md).not.toContain("****");
  });

  it("a report's evidence quotes print on one line, with where they came from", () => {
    const report: MarkdownReport = {
      whatItProposes: {
        methods: [{ text: "Films were annealed.", evidence: "We anneal\nthe films at\n\n600 K.", evidenceWhere: "2 Methods" }],
      },
      resultsAndSignificance: {
        keyResults: [{ title: "Sharper peak", detail: "The peak sharpened.", evidence: "The \u27E8003\u27E9\npeak sharpened.", evidenceWhere: "4 Results" }],
      },
      limitations: [{ text: "One alloy only.", evidence: "Only one\nalloy was grown.", evidenceWhere: "5 Discussion" }],
      nextStep: { text: "Grow a second alloy.", evidence: "A second alloy\nis planned.", evidenceWhere: "abstract" },
      provenance: { basis: "model-fulltext" },
    };

    const md = readingToMarkdown(inventedPaper, base, report, []);

    expect(md).toContain("\n\n> We anneal the films at 600 K. \u2014 \u00A72 Methods\n");
    expect(md).toContain("\n\n> The \u27E8003\u27E9 peak sharpened. \u2014 \u00A74 Results\n");
    expect(md).toContain("\n\n> Only one alloy was grown. \u2014 \u00A75 Discussion\n");
    expect(md).toContain("\n\n> A second alloy is planned. \u2014 abstract\n");
    // No quote left a tail on the next line.
    for (const tail of ["600 K.", "peak sharpened.", "alloy was grown.", "is planned.", "the films at"]) {
      expect(md.split("\n").some((line) => line.startsWith(tail)), tail).toBe(false);
    }
  });

  it("the reading's own quotes, its TLDR and the title print on one line", () => {
    const reading: PaperReading = {
      ...base,
      abstract: { sentences: [], introCount: 0, marks: [] },
      provenance: { ...base.provenance, tldr: "A machine\nsummary of an invented\n\npaper." },
      findings: [quote("The peak grew\nby 40 %.", "4 Results")],
      method: [quote("Films were\n annealed at 600 K.")],
      caveats: [quote("Only one\r\nalloy.", "5 Discussion")],
    };
    const paper: Paper = { ...inventedPaper, title: "Annealing texture\nin an invented oxide" };

    const md = readingToMarkdown(paper, reading, null, []);

    expect(md.startsWith("# Annealing texture in an invented oxide\n\nA machine summary of an invented paper.\n\n")).toBe(true);
    expect(md).toContain("> The peak grew by 40 %. \u2014 \u00A74 Results\n");
    expect(md).toContain("> Films were annealed at 600 K. \u2014 \u00A72 Methods\n");
    expect(md).toContain("> Only one alloy. \u2014 \u00A75 Discussion\n");
  });
});
