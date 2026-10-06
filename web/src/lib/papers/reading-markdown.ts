// The reading page as Markdown — what `c` copies.
//
// The same sheet, in the same order, with the same honesty: the abstract with
// the ink marks as bold, every quote with the heading it came from, every
// model claim followed by its verified evidence, and a "Not on this page" list
// generated from `omitted` rather than typed. The frontmatter says what the
// text was read from (`basis`) so a note taken from an abstract is never later
// mistaken for one taken from the paper.

import type { Paper } from "@/types";
import { APP_VERSION } from "@/lib/version";
import { FOR_YOUR_QUESTIONS, MAP } from "@/components/reader/copy";
import { displayHeading, quoteAttribution } from "./reading";
import type { OmitReason, PaperReading, ReadingBlock, ReadingQuote } from "./reading";
import type { ReadingMap } from "./reading-map";

/** One model claim with the sentence that supports it. */
export interface MarkdownClaim {
  text: string;
  evidence?: string;
  /** "abstract" or the heading of the section the evidence came from. */
  evidenceWhere?: string;
}

/** A key result: a lead-in title, a detail sentence, and its evidence. */
export interface MarkdownKeyResult extends Omit<MarkdownClaim, "text"> {
  title: string;
  detail: string;
  /** Restored: what is new about this result. Peer's line, no evidence. */
  novelty?: string;
}

/** An answer to one of the reader's questions (P2-05): Peer's sentence, the
 *  paper's verbatim evidence for it, and where in the paper that sits. */
export interface MarkdownAnswer extends MarkdownClaim {
  /** The section that holds the evidence — resolved against the reading's map. */
  sectionId?: string;
  /** PDFs only: that section's page. */
  page?: number;
}

/** Pass 2's answer to one question (P2-05). Structurally `QuestionAnswers`;
 *  `question` is the reader's own text, which the server wrote back. */
export interface MarkdownQuestionAnswers {
  question: string;
  verdict: "answered" | "partly" | "not_addressed";
  answers: MarkdownAnswer[];
  readNext: { sectionId: string; why: string; kind: "answer" | "background" }[];
}

/**
 * The slice of a model report the export reads. Structurally a `PaperReport`
 * (the page passes one straight through); typed here so the export and the
 * report can change independently.
 */
export interface MarkdownReport {
  skim?: MarkdownClaim[];
  whatItProposes?: { summary?: string; methods?: MarkdownClaim[]; newHere?: string[] };
  resultsAndSignificance?: { summary?: string; keyResults?: MarkdownKeyResult[] };
  reviewContents?: { sections: { heading: string; summary: string }[] };
  /** S6 (2026-09): removed from every new report; kept only so an old cached
   *  wire shape still type-checks. Nothing reads it. */
  whyItFitsYou?: { reasons: string[]; keywords: string[] };
  limitations?: MarkdownClaim[];
  relationToYourWork?: { basedOn: string; items: MarkdownClaim[] };
  nextStep?: MarkdownClaim | null;
  /** P2-05: present only when the reader's questions were put to the report. */
  forYourQuestions?: MarkdownQuestionAnswers[];
  provenance?: { basis: "model-abstract" | "model-fulltext" };
}

const HEADING: Record<Exclude<ReadingBlock, "skim">, string> = {
  findings: "What they found, and how big",
  method: "How it was done",
  caveats: "Where it is thin",
  forYou: "For your project",
  nextStep: "Next step",
};

/** How a block is named in the "Not on this page" list. */
const BLOCK_NAME: Record<ReadingBlock, string> = {
  skim: "the skim",
  findings: "findings",
  method: "method",
  caveats: "caveats",
  forYou: "for your project",
  nextStep: "next step",
};

/** Why, in the "Not on this page" list; plural where blocks are listed together. */
const REASON_PHRASE: Record<OmitReason, { one: string; many: string }> = {
  no_abstract: {
    one: "no abstract is published where Peer can read it",
    many: "no abstract is published where Peer can read it",
  },
  not_in_abstract: { one: "not in the abstract", many: "not in the abstract" },
  no_section: {
    one: "no such section in the full text",
    many: "no such sections in the full text",
  },
  // P0-03: every PDF is read with pdf.js; what this reason marks now is a
  // PDF link with no text in it (the page: "the PDF carries no text to read
  // — it looks scanned"). The enum keeps its old name.
  pdf_only_hosted: {
    one: "the PDF carries no text to read",
    many: "the PDF carries no text to read",
  },
  pdf_empty: {
    one: "this PDF has no readable text",
    many: "this PDF has no readable text",
  },
  paywalled: {
    one: "the full text is behind access",
    many: "the full text is behind access",
  },
  needs_key: { one: "needs a key", many: "need a key" },
  needs_full_text: { one: "needs the full text", many: "need the full text" },
  no_profile: {
    one: "needs a current project in Profile",
    many: "need a current project in Profile",
  },
  no_verified_claim: {
    one: "the model gave no sentence for it that could be verified",
    many: "the model gave no sentences for them that could be verified",
  },
};

const REASON_ORDER: OmitReason[] = [
  "no_abstract",
  "not_in_abstract",
  "no_section",
  "pdf_only_hosted",
  "pdf_empty",
  "paywalled",
  "needs_full_text",
  "no_profile",
  "no_verified_claim",
  "needs_key",
];

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** YAML scalar: quoted, with the two characters that would break it escaped. */
function yaml(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return '""';
  if (typeof value === "number") return String(value);
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function quoteLine(quote: ReadingQuote): string {
  return `> ${quote.text} — ${quoteAttribution(quote.from)}`;
}

/** A quote's words with where they came from: "<sentence> — §Heading", and
 *  " · p.N" after it when the page is known (P2-05: an answer's evidence;
 *  every other quote has no page and reads as it always did). */
function evidenceText(claim: Omit<MarkdownClaim, "text"> & { page?: number }): string | null {
  if (!claim.evidence) return null;
  const where = claim.evidenceWhere
    ? claim.evidenceWhere === "abstract"
      ? "abstract"
      : `§${displayHeading(claim.evidenceWhere)}`
    : null;
  if (!where) return claim.evidence;
  return `${claim.evidence} — ${where}${typeof claim.page === "number" ? ` · ${MAP.page(claim.page)}` : ""}`;
}

function evidenceLine(claim: Omit<MarkdownClaim, "text"> & { page?: number }): string | null {
  const text = evidenceText(claim);
  return text === null ? null : `> ${text}`;
}

function claimBlock(lead: string, claim: Omit<MarkdownClaim, "text">): string[] {
  const evidence = evidenceLine(claim);
  return evidence ? [lead, "", evidence] : [lead];
}

/** Paragraph groups separated by one blank line. */
function spaced(groups: string[][]): string[] {
  return groups.flatMap((group, i) => (i < groups.length - 1 ? [...group, ""] : group));
}

/** One line: runs of whitespace (a newline in a typed question) become a space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The words of one question's answer, as the page's "For your questions" block
 *  says them (P2-05) — one place, so the Markdown export and the reading note
 *  cannot drift from each other or from the page. */
export interface QuestionEntryLines {
  /** "Answered", "Partly answered", or "This paper does not address: <question>." */
  verdict: string;
  /** Per answer: Peer's sentence, and the paper's — "<evidence> — §Heading · p.N"
   *  (null when the answer carries no evidence). */
  answers: { text: string; quote: string | null }[];
  /** "§Heading · p.N · M min — why", with " · background" for a background
   *  section. An id the map does not hold is left out, as the page leaves it out. */
  readNext: string[];
}

/**
 * `map` is the reading's: where an answer names no heading or page, the section
 * it points at supplies them, and "Read next" resolves its ids. Without a map
 * the answers read from their own fields and there is no "Read next".
 */
export function questionEntryLines(entry: MarkdownQuestionAnswers, map?: ReadingMap): QuestionEntryLines {
  const sections = new Map((map?.sections ?? []).map((section) => [section.id, section]));
  const verdict = (() => {
    switch (entry.verdict) {
      case "answered":
        return FOR_YOUR_QUESTIONS.answered;
      case "partly":
        return FOR_YOUR_QUESTIONS.partly;
      case "not_addressed":
        return FOR_YOUR_QUESTIONS.notAddressed(entry.question);
    }
  })();
  return {
    verdict,
    answers: entry.answers.map((answer) => {
      const section = answer.sectionId ? sections.get(answer.sectionId) : undefined;
      return {
        text: answer.text,
        quote: evidenceText({
          evidence: answer.evidence,
          evidenceWhere: answer.evidenceWhere ?? section?.heading ?? "abstract",
          page: typeof answer.page === "number" ? answer.page : section?.page,
        }),
      };
    }),
    readNext: entry.readNext.flatMap((item) => {
      const section = sections.get(item.sectionId);
      if (!section) return [];
      const label = [
        `§${section.heading}`,
        ...(typeof section.page === "number" ? [MAP.page(section.page)] : []),
        MAP.minutes(section.minutes),
        ...(item.kind === "background" ? [FOR_YOUR_QUESTIONS.background] : []),
      ].join(" · ");
      return [`${label} — ${item.why}`];
    }),
  };
}

/** The "For your questions" block's paragraphs: per question the question, the
 *  verdict, each answer's sentence then its quoted evidence, and "Read next". */
function questionGroups(entries: readonly MarkdownQuestionAnswers[], map?: ReadingMap): string[][] {
  const groups: string[][] = [];
  for (const entry of entries) {
    const lines = questionEntryLines(entry, map);
    groups.push([`**${oneLine(entry.question)}**`], [lines.verdict]);
    for (const answer of lines.answers) {
      if (answer.text) groups.push([answer.text]);
      if (answer.quote) groups.push([`> ${answer.quote}`]);
    }
    if (lines.readNext.length > 0) {
      groups.push([FOR_YOUR_QUESTIONS.readNext], lines.readNext.map((line) => `- ${line}`));
    }
  }
  return groups;
}

function abstractParagraphs(reading: PaperReading): string[] {
  const { sentences, introCount, marks } = reading.abstract;
  const inked = new Set(marks);
  const render = (from: number, to: number) =>
    sentences
      .slice(from, to)
      .map((sentence, offset) => (inked.has(from + offset) ? `**${sentence}**` : sentence))
      .join(" ");
  const paragraphs: string[] = [];
  const split = Math.min(Math.max(introCount, 0), sentences.length);
  if (split > 0) paragraphs.push(render(0, split));
  if (split < sentences.length) paragraphs.push(render(split, sentences.length));
  return paragraphs;
}

function extractYear(paper: Paper): number | null {
  if (paper.publishedDate) {
    const y = new Date(paper.publishedDate).getFullYear();
    if (!Number.isNaN(y)) return y;
  }
  const match = paper.venue.match(/\b(19|20)\d{2}\b/);
  if (match) return parseInt(match[0], 10);
  return null;
}

/** A BibTeX entry from the record. Moved here from the page; unchanged. */
export function buildBibTeX(paper: Paper): string {
  const year = extractYear(paper) ?? new Date().getFullYear();
  const firstAuthorLast =
    (paper.authors[0] ?? "unknown")
      .split(/\s+/)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") ?? "unknown";
  const firstTitleWord =
    paper.title
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/[^a-z]/g, "") || "paper";
  const key = `${firstAuthorLast}${year}${firstTitleWord}`;
  const authors = paper.authors.join(" and ");
  return `@inproceedings{${key},
  title={${paper.title}},
  author={${authors}},
  booktitle={${paper.venue}},
  year={${year}}${paper.linkArxiv ? `,\n  url={${paper.linkArxiv}}` : ""}
}`;
}

/**
 * Render the reading, and the model report when there is one, as Markdown.
 *
 * `sentences` are the Decision block's, from `describeAvailability`, so the
 * export says the same thing about what was read as the page does.
 * `generatedAt` exists so tests can pin the frontmatter.
 *
 * P2-05: `questions` are the reader's settled questions for this paper (never
 * the gist). With at least one, the frontmatter lists them; a report that
 * carries `forYourQuestions` adds the "For your questions" block, in the page's
 * place and words. Without either, the export is what it was.
 */
export function readingToMarkdown(
  paper: Paper,
  reading: PaperReading,
  report: MarkdownReport | null,
  sentences: string[],
  generatedAt: Date = new Date(),
  questions: readonly string[] = [],
): string {
  const basis = report?.provenance?.basis
    ?? (reading.provenance.fullText === "html" || reading.provenance.fullText === "pdf"
      ? "sections"
      : "abstract");
  const asked = questions.map(oneLine).filter(Boolean);

  const lines: string[] = [
    "---",
    `title: ${yaml(paper.title)}`,
    `authors: [${paper.authors.map((author) => yaml(author)).join(", ")}]`,
    `venue: ${yaml(paper.venue)}`,
    `date: ${yaml(paper.publishedDate)}`,
    `doi: ${yaml(paper.doi)}`,
    `url: ${yaml(reading.source?.url ?? paper.linkPaper)}`,
    `source: ${yaml(reading.provenance.sourceLabel)}`,
    `basis: ${basis}`,
    `pages: ${yaml(reading.provenance.pageCount)}`,
    ...(asked.length > 0 ? [`questions: [${asked.map((question) => yaml(question)).join(", ")}]`] : []),
    `generated: ${yaml(generatedAt.toISOString())}`,
    `peer_version: ${yaml(APP_VERSION)}`,
    "---",
    "",
    `# ${paper.title}`,
    "",
  ];

  // Which blocks the export has something for, so the omissions list below
  // does not name a block the model filled.
  const filled = new Set<ReadingBlock>();

  const skim = report?.skim?.filter((claim) => claim.text) ?? [];
  if (skim.length > 0) {
    lines.push(skim.map((claim) => claim.text).join(" "), "");
    lines.push(
      `*Peer's skim, from the ${basis === "model-fulltext" ? "full text" : "abstract"}*`,
      "",
    );
    filled.add("skim");
  }

  const paragraphs = abstractParagraphs(reading);
  if (paragraphs.length > 0) {
    for (const paragraph of paragraphs) lines.push(paragraph, "");
    lines.push("*From the abstract · claim and numbers in ink*", "");
    filled.add("skim");
  } else if (reading.provenance.tldr) {
    lines.push(reading.provenance.tldr, "");
    lines.push("*TLDR by Semantic Scholar — machine-written, not the authors' words*", "");
  }

  if (sentences.length > 0) lines.push(sentences.join(" "), "");

  const section = (block: Exclude<ReadingBlock, "skim">, body: string[]) => {
    if (body.length === 0) return;
    lines.push(`## ${HEADING[block]}`, "", ...body, "");
    filled.add(block);
  };
  // The restored sections have no slot in the omissions list: they are
  // Peer's reading, present when the model wrote them and silent otherwise.
  const extra = (heading: string, body: string[]) => {
    if (body.length === 0) return;
    lines.push(`## ${heading}`, "", ...body, "");
  };
  const PEERS = "*Peer's reading — not a quote*";

  // P2-05: the answers to the reader's questions, where the page puts them —
  // after the Decision block, before "What it proposes".
  const answered = report?.forYourQuestions ?? [];
  if (answered.length > 0) extra(FOR_YOUR_QUESTIONS.heading, spaced(questionGroups(answered, reading.map)));

  // The page's order: the proposal (merged with the old "what is new"
  // block — S6, they duplicated each other), the method, the results (or a
  // review's contents), then the rewrite's own blocks. "Why it fits you" is
  // deleted (S6).
  const proposal = report?.whatItProposes?.summary?.trim();
  const newHere = report?.whatItProposes?.newHere?.filter(Boolean) ?? [];
  if (proposal) {
    extra(
      "What it proposes",
      newHere.length > 0 ? [proposal, "", ...newHere, "", PEERS] : [proposal],
    );
  }

  const methods = report?.whatItProposes?.methods?.filter((claim) => claim.text) ?? [];
  if (methods.length > 0) {
    section("method", spaced(methods.map((claim) => claimBlock(claim.text, claim))));
  } else {
    section("method", spaced(reading.method.map((quote) => [quoteLine(quote)])));
  }

  const reviewSections = report?.reviewContents?.sections ?? [];
  const keyResults = report?.resultsAndSignificance?.keyResults?.filter((r) => r.title || r.detail) ?? [];
  const headline = report?.resultsAndSignificance?.summary?.trim();
  if (reviewSections.length > 0) {
    extra(
      "What the review covers",
      spaced(reviewSections.map((entry) => [`**${entry.heading}**`, entry.summary])),
    );
  } else if (keyResults.length > 0 || headline) {
    section("findings", [
      ...(headline ? [headline, ""] : []),
      ...spaced(
        keyResults.map((result) => [
          ...claimBlock(`**${result.title}.** ${result.detail}`.trim(), result),
          ...(result.novelty ? [`What is new here: ${result.novelty}`] : []),
        ]),
      ),
    ]);
  } else {
    section("findings", spaced(reading.findings.map((quote) => [quoteLine(quote)])));
  }

  const limitations = report?.limitations?.filter((claim) => claim.text) ?? [];
  if (limitations.length > 0) {
    section("caveats", spaced(limitations.map((claim) => claimBlock(claim.text, claim))));
  } else {
    section("caveats", spaced(reading.caveats.map((quote) => [quoteLine(quote)])));
  }

  const relation = report?.relationToYourWork;
  const relationItems = relation?.items.filter((claim) => claim.text) ?? [];
  if (relation && relationItems.length > 0) {
    const anchor = relation.basedOn.length > 100
      ? `${relation.basedOn.slice(0, 100)}…`
      : relation.basedOn;
    section("forYou", [
      `*Your project: ${anchor}*`,
      "",
      ...spaced(relationItems.map((claim) => claimBlock(claim.text, claim))),
    ]);
  }

  if (report?.nextStep?.text) {
    section("nextStep", claimBlock(report.nextStep.text, report.nextStep));
  }

  // "Not on this page", grouped by reason, in the reasons' own order.
  const missing = reading.omitted.filter((entry) => !filled.has(entry.block));
  if (missing.length > 0) {
    lines.push("## Not on this page", "");
    for (const reason of REASON_ORDER) {
      const blocks = missing.filter((entry) => entry.reason === reason).map((entry) => entry.block);
      if (blocks.length === 0) continue;
      const names = capitalize(joinList(blocks.map((block) => BLOCK_NAME[block])));
      const phrase = REASON_PHRASE[reason][blocks.length > 1 ? "many" : "one"];
      lines.push(`- ${names} — ${phrase}`);
    }
    lines.push("");
  }

  lines.push("```bibtex", buildBibTeX(paper), "```", "");
  return lines.join("\n");
}
