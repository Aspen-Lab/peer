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
import { displayHeading, quoteAttribution } from "./reading";
import type { OmitReason, PaperReading, ReadingBlock, ReadingQuote } from "./reading";

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
}

/**
 * The slice of a model report the export reads. Structurally a `PaperReport`
 * (the page passes one straight through); typed here so the export and the
 * report can change independently.
 */
export interface MarkdownReport {
  skim?: MarkdownClaim[];
  whatItProposes?: { methods?: MarkdownClaim[] };
  resultsAndSignificance?: { keyResults?: MarkdownKeyResult[] };
  limitations?: MarkdownClaim[];
  relationToYourWork?: { basedOn: string; items: MarkdownClaim[] };
  nextStep?: MarkdownClaim | null;
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
  pdf_only_hosted: {
    one: "the PDF is readable only by a self-hosted Peer",
    many: "the PDF is readable only by a self-hosted Peer",
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

function evidenceLine(claim: Omit<MarkdownClaim, "text">): string | null {
  if (!claim.evidence) return null;
  const where = claim.evidenceWhere
    ? claim.evidenceWhere === "abstract"
      ? "abstract"
      : `§${displayHeading(claim.evidenceWhere)}`
    : null;
  return where ? `> ${claim.evidence} — ${where}` : `> ${claim.evidence}`;
}

function claimBlock(lead: string, claim: Omit<MarkdownClaim, "text">): string[] {
  const evidence = evidenceLine(claim);
  return evidence ? [lead, "", evidence] : [lead];
}

/** Paragraph groups separated by one blank line. */
function spaced(groups: string[][]): string[] {
  return groups.flatMap((group, i) => (i < groups.length - 1 ? [...group, ""] : group));
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
 */
export function readingToMarkdown(
  paper: Paper,
  reading: PaperReading,
  report: MarkdownReport | null,
  sentences: string[],
  generatedAt: Date = new Date(),
): string {
  const basis = report?.provenance?.basis
    ?? (reading.provenance.fullText === "html" || reading.provenance.fullText === "pdf"
      ? "sections"
      : "abstract");

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

  const keyResults = report?.resultsAndSignificance?.keyResults?.filter((r) => r.title || r.detail) ?? [];
  if (keyResults.length > 0) {
    section(
      "findings",
      spaced(keyResults.map((result) => claimBlock(`**${result.title}.** ${result.detail}`.trim(), result))),
    );
  } else {
    section("findings", spaced(reading.findings.map((quote) => [quoteLine(quote)])));
  }

  const methods = report?.whatItProposes?.methods?.filter((claim) => claim.text) ?? [];
  if (methods.length > 0) {
    section("method", spaced(methods.map((claim) => claimBlock(claim.text, claim))));
  } else {
    section("method", spaced(reading.method.map((quote) => [quoteLine(quote)])));
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
