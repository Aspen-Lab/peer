// P2-05 (§1g.6, §3d 12): the reader's questions and Peer's answers in the
// Markdown export. Same words and same order as the page's "For your
// questions" block (P2-04); the paper's words appear only as verbatim quotes.
// Every question here is synthetic.

import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { FOR_YOUR_QUESTIONS } from "@/components/reader/copy";
import { SectionLinks } from "@/components/reader/evidence-quote";
import { ForYourQuestions } from "@/components/reader/for-your-questions";
import { buildReading, describeAvailability } from "./reading";
import type { PaperReading } from "./reading";
import type { ReadingMap } from "./reading-map";
import type { PaperReport } from "./report";
import { readingToMarkdown, type MarkdownQuestionAnswers, type MarkdownReport } from "./reading-markdown";
import normalPaperJson from "./__fixtures__/abstract-normal-W7204479535.paper.json";

const normalPaper = normalPaperJson as unknown as Paper;
const NOW = new Date("2026-09-06T12:00:00.000Z");

const MAP: ReadingMap = {
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 2, words: 260, minutes: 2, paragraphs: [] },
    { id: "s2", heading: "2 Results", canonical: "results", role: "evidence", page: 7, words: 460, minutes: 3, paragraphs: [] },
    { id: "s3", heading: "3 Follow-up", canonical: "body", role: "body", page: 9, words: 520, minutes: 4, paragraphs: [] },
    // An HTML-sourced section has no page.
    { id: "s4", heading: "4 Appendix", canonical: "body", role: "body", words: 150, minutes: 1, paragraphs: [] },
  ],
  totalMinutes: 10,
};

const QUESTIONS = ["Does the method improve retention?", "Does it discuss recycling?"];

const ANSWERS: MarkdownQuestionAnswers[] = [
  {
    question: QUESTIONS[0],
    verdict: "answered",
    answers: [
      {
        text: "Peer says retention improved under the tested condition.",
        evidence: "Retention improved after the treatment.",
        evidenceWhere: "2 Results",
        sectionId: "s2",
        page: 7,
      },
      // The server sets `evidenceWhere` and `page`; a stale or hand-built answer
      // with only a section id still reads like the page does: heading and page
      // from the map.
      { text: "Peer says the gain held at follow-up.", evidence: "The gain held at follow-up.", sectionId: "s3" },
    ],
    readNext: [
      { sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" },
      { sectionId: "missing", why: "This must not render.", kind: "answer" },
    ],
  },
  {
    question: QUESTIONS[1],
    verdict: "not_addressed",
    answers: [],
    readNext: [
      { sectionId: "s1", why: "It explains the comparison baseline.", kind: "background" },
      { sectionId: "s4", why: "It lists the survey instrument.", kind: "background" },
    ],
  },
];

const BLOCK = [
  "## For your questions",
  "",
  "**Does the method improve retention?**",
  "",
  "Answered",
  "",
  "Peer says retention improved under the tested condition.",
  "",
  "> Retention improved after the treatment. — §2 Results · p.7",
  "",
  "Peer says the gain held at follow-up.",
  "",
  "> The gain held at follow-up. — §3 Follow-up · p.9",
  "",
  "Read next",
  "",
  "- §2 Results · p.7 · 3 min — It reports the measured retention result.",
  "",
  "**Does it discuss recycling?**",
  "",
  "This paper does not address: Does it discuss recycling?",
  "",
  "Read next",
  "",
  "- §1 Introduction · p.2 · 2 min · background — It explains the comparison baseline.",
  "- §4 Appendix · 1 min · background — It lists the survey instrument.",
  "",
  "",
].join("\n");

function fixture(overrides: Partial<MarkdownReport> = {}): {
  reading: PaperReading;
  report: MarkdownReport;
  sentences: string[];
} {
  const base = buildReading(normalPaper, null, NOW);
  const reading: PaperReading = { ...base, map: MAP };
  const report: MarkdownReport = {
    skim: [{ text: "Five predictors were benchmarked on three HIV-1 enzymes.", evidence: reading.abstract.sentences[1], evidenceWhere: "abstract" }],
    whatItProposes: { summary: "Peer's proposal summary." },
    limitations: [{ text: "Only three enzymes were covered.", evidence: "We restrict the study to three enzymes.", evidenceWhere: "5 Discussion" }],
    provenance: { basis: "model-fulltext" },
    ...overrides,
  };
  const sentences = describeAvailability({
    reading,
    report: { basis: "model-fulltext", droppedClaims: 0, sourceKind: "pdf", pageCount: 12 },
    providerConfigured: true,
    profileHasProject: true,
    modelFailed: false,
  });
  return { reading, report, sentences };
}

/** The frontmatter block, `---` to `---`, as lines. */
function frontmatter(md: string): string[] {
  const end = md.indexOf("\n---\n", 4);
  return md.slice(4, end).split("\n");
}

describe("readingToMarkdown with the reader's questions (P2-05)", () => {
  it("renders the For your questions block after the Decision line and before What it proposes, every string exact", () => {
    const { reading, report, sentences } = fixture({ forYourQuestions: ANSWERS });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW, QUESTIONS);

    const decision = md.indexOf(sentences.join(" "));
    const start = md.indexOf("## For your questions");
    const proposal = md.indexOf("## What it proposes");
    expect(decision).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(decision);
    expect(proposal).toBeGreaterThan(start);
    expect(md.slice(start, proposal)).toBe(BLOCK);
    // The unknown Read next id is dropped, as the page drops it.
    expect(md).not.toContain("This must not render.");
    // One heading, not two.
    expect(md.split("## For your questions")).toHaveLength(2);
  });

  it("puts the quoted evidence verbatim behind a > and Peer's own prose on lines of their own", () => {
    const { reading, report, sentences } = fixture({ forYourQuestions: ANSWERS });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW, QUESTIONS);
    const block = md.slice(md.indexOf("## For your questions"), md.indexOf("## What it proposes")).split("\n");

    for (const answer of ANSWERS[0].answers) {
      const quoted = block.filter((line) => line.startsWith(`> ${answer.evidence} — `));
      expect(quoted).toHaveLength(1);
      // Peer's prose is never quote-styled.
      expect(block).toContain(answer.text);
      expect(block).not.toContain(`> ${answer.text}`);
    }
    // Every quoted line in the block is one of the paper's evidence sentences.
    const quotes = block.filter((line) => line.startsWith("> "));
    expect(quotes).toHaveLength(2);
  });

  it("says in the page's words what the page says: every string of the block is on the rendered For your questions", () => {
    const html = renderToStaticMarkup(
      createElement(
        SectionLinks,
        { headings: MAP.sections.map((section) => section.heading) },
        createElement(ForYourQuestions, { report: { forYourQuestions: ANSWERS } as Pick<PaperReport, "forYourQuestions">, map: MAP }),
      ),
    );
    const page = html.replace(/<[^>]+>/g, "");
    const { reading, report, sentences } = fixture({ forYourQuestions: ANSWERS });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW, QUESTIONS);

    expect(page).toContain(FOR_YOUR_QUESTIONS.heading);
    expect(md).toContain(`## ${FOR_YOUR_QUESTIONS.heading}`);
    for (const entry of ANSWERS) {
      expect(page).toContain(entry.question);
      expect(md).toContain(entry.question);
      for (const answer of entry.answers) {
        expect(page).toContain(answer.text);
        expect(md).toContain(answer.text);
        expect(page).toContain(answer.evidence);
        expect(md).toContain(answer.evidence);
      }
    }
    for (const words of [
      FOR_YOUR_QUESTIONS.answered,
      FOR_YOUR_QUESTIONS.notAddressed(QUESTIONS[1]),
      FOR_YOUR_QUESTIONS.readNext,
      "§2 Results · p.7",
      "§3 Follow-up · p.9",
      "§2 Results · p.7 · 3 min",
      "§1 Introduction · p.2 · 2 min",
      "§4 Appendix · 1 min",
      "It reports the measured retention result.",
      "It explains the comparison baseline.",
      "It lists the survey instrument.",
    ]) {
      expect(page, `page: ${words}`).toContain(words);
      expect(md, `export: ${words}`).toContain(words);
    }
    expect(page).toContain(FOR_YOUR_QUESTIONS.background);
    expect(md).toContain(FOR_YOUR_QUESTIONS.background);
  });

  it("renders the partly verdict; an answer with no section reads 'abstract'; the page appears only when known; no map, no Read next", () => {
    const { reading, report, sentences } = fixture({
      forYourQuestions: [
        {
          question: "Does it cover manufacturing cost?",
          verdict: "partly",
          answers: [
            { text: "Peer says cost is a constraint.", evidence: "Cost remains a constraint for scale-up.", evidenceWhere: "2 Results" },
            { text: "Peer says the abstract names scale.", evidence: "Scale-up is the open problem." },
          ],
          readNext: [{ sectionId: "s2", why: "It reports cost.", kind: "answer" }],
        },
      ],
    });
    const unmapped: PaperReading = { ...reading, map: undefined };

    const md = readingToMarkdown(normalPaper, unmapped, report, sentences, NOW, ["Does it cover manufacturing cost?"]);

    const block = md.slice(md.indexOf("## For your questions"), md.indexOf("## What it proposes"));
    expect(block).toBe(
      [
        "## For your questions",
        "",
        "**Does it cover manufacturing cost?**",
        "",
        "Partly answered",
        "",
        "Peer says cost is a constraint.",
        "",
        "> Cost remains a constraint for scale-up. — §2 Results",
        "",
        "Peer says the abstract names scale.",
        "",
        "> Scale-up is the open problem. — abstract",
        "",
        "",
      ].join("\n"),
    );
    expect(md).not.toContain("Read next");
  });

  // P2-08b (§1g.21 (2)): an entry whose answers all failed verification prints
  // the page's own unverified line — no answers, the Read next rows kept — and
  // never "This paper does not address", which would be untrue of the paper.
  it("prints the unverified line, with no answers and the Read next rows kept, in the page's words (P2-08b)", () => {
    const entry: MarkdownQuestionAnswers = {
      question: QUESTIONS[0],
      verdict: "unverified",
      answers: [],
      readNext: [{ sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" }],
    };
    const { reading, report, sentences } = fixture({ forYourQuestions: [entry] });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW, [QUESTIONS[0]]);

    const block = md.slice(md.indexOf("## For your questions"), md.indexOf("## What it proposes"));
    expect(block).toBe(
      [
        "## For your questions",
        "",
        "**Does the method improve retention?**",
        "",
        "Peer could not verify an answer in the paper's own words.",
        "",
        "Read next",
        "",
        "- §2 Results · p.7 · 3 min — It reports the measured retention result.",
        "",
        "",
      ].join("\n"),
    );
    expect(block).not.toContain("does not address");

    const html = renderToStaticMarkup(
      createElement(
        SectionLinks,
        { headings: MAP.sections.map((section) => section.heading) },
        createElement(ForYourQuestions, { report: { forYourQuestions: [entry] } as Pick<PaperReport, "forYourQuestions">, map: MAP }),
      ),
    );
    // renderToStaticMarkup writes the apostrophe as an entity; the words are the same.
    expect(html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'")).toContain(FOR_YOUR_QUESTIONS.unverified);
    expect(md).toContain(FOR_YOUR_QUESTIONS.unverified);
  });

  it("an all-caps heading is set the way the other quotes of the export set it", () => {
    const { reading, report, sentences } = fixture({
      forYourQuestions: [
        {
          question: "Is it cheap?",
          verdict: "answered",
          answers: [{ text: "Peer says it is.", evidence: "It is cheap.", evidenceWhere: "RESULTS AND DISCUSSION", page: 3 }],
          readNext: [],
        },
      ],
    });

    const md = readingToMarkdown(normalPaper, reading, report, sentences, NOW, ["Is it cheap?"]);

    expect(md).toContain("> It is cheap. — §Results and Discussion · p.3");
  });

  it("is absent when the report carries no forYourQuestions or an empty list — and the export is byte-identical to today's", () => {
    // Pinned from the export as it stood before P2-05 (sha256 of the whole file
    // with the one version-dependent line fixed). Any change to a report
    // without questions turns this red.
    const { reading, report, sentences } = fixture();
    const deep: MarkdownReport = {
      ...report,
      whatItProposes: {
        summary: "Peer's proposal summary.",
        methods: [{ text: "Predictions were scored against post-cutoff crystal structures.", evidence: "We evaluate predictions against a curated dataset.", evidenceWhere: "2 Methods" }],
      },
      resultsAndSignificance: {
        keyResults: [
          { title: "AlphaFold leads", detail: "AlphaFold-based models score best overall.", evidence: "Our results show that AlphaFold-based models achieve strong overall performance.", evidenceWhere: "4 Results" },
        ],
      },
      nextStep: { text: "Re-run the docking analysis.", evidence: "Finally, a docking analysis indicates a binding pose.", evidenceWhere: "4 Results" },
    };
    const digest = (md: string) =>
      createHash("sha256")
        .update(md.replace(/^peer_version: .*$/m, 'peer_version: "x"'))
        .digest("hex");

    const today = readingToMarkdown(normalPaper, reading, deep, sentences, NOW);

    expect(today).not.toContain("For your questions");
    expect(today).not.toContain("questions:");
    expect(digest(today)).toBe("ab33609238827d2aa5c952035a7d7e87b0d1d6eb8d4e074774f0ef43a2f26613");
    // Empty list and no questions: the same bytes.
    expect(readingToMarkdown(normalPaper, reading, { ...deep, forYourQuestions: [] }, sentences, NOW, [])).toBe(today);
    expect(readingToMarkdown(normalPaper, reading, deep, sentences, NOW, [])).toBe(today);
    // Without a report at all, too.
    expect(readingToMarkdown(normalPaper, reading, null, sentences, NOW, [])).toBe(
      readingToMarkdown(normalPaper, reading, null, sentences, NOW),
    );
  });
});

describe("the frontmatter's questions (P2-05)", () => {
  it("lists the request's questions as a YAML list, between pages and generated, and omits the key otherwise", () => {
    const { reading, report, sentences } = fixture({ forYourQuestions: ANSWERS });

    const withQuestions = frontmatter(readingToMarkdown(normalPaper, reading, report, sentences, NOW, QUESTIONS));
    const without = frontmatter(readingToMarkdown(normalPaper, reading, report, sentences, NOW, []));
    const never = frontmatter(readingToMarkdown(normalPaper, reading, report, sentences, NOW));

    const at = withQuestions.findIndex((line) => line.startsWith("questions:"));
    expect(withQuestions[at]).toBe('questions: ["Does the method improve retention?", "Does it discuss recycling?"]');
    expect(withQuestions[at - 1]).toMatch(/^pages: /);
    expect(withQuestions[at + 1]).toMatch(/^generated: /);
    // Nothing else in the frontmatter moved.
    expect(withQuestions.filter((line) => !line.startsWith("questions:"))).toEqual(without);
    expect(without.some((line) => line.startsWith("questions:"))).toBe(false);
    expect(never).toEqual(without);
  });

  it("is independent of the block: questions with no report still list, a report's answers with no questions still render", () => {
    const { reading, sentences } = fixture();

    const noReport = readingToMarkdown(normalPaper, reading, null, sentences, NOW, QUESTIONS);

    expect(frontmatter(noReport).some((line) => line.startsWith("questions:"))).toBe(true);
    expect(noReport).not.toContain("## For your questions");

    const { report } = fixture({ forYourQuestions: ANSWERS });
    const noQuestions = readingToMarkdown(normalPaper, reading, report, sentences, NOW);
    expect(noQuestions).toContain("## For your questions");
    expect(frontmatter(noQuestions).some((line) => line.startsWith("questions:"))).toBe(false);
  });

  it("escapes quotes and backslashes, and keeps one question on one line", () => {
    const { reading, sentences } = fixture();

    const md = readingToMarkdown(normalPaper, reading, null, sentences, NOW, ['Why is "X" a\\b problem?', "Two\nlines\there?"]);

    expect(md).toContain('questions: ["Why is \\"X\\" a\\\\b problem?", "Two lines here?"]');
  });
});
