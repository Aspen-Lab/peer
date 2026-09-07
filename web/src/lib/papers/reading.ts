// The deterministic reading of a paper — what the reading page shows before,
// and without, a model.
//
// One document per paper for every reader: it is built from the paper record
// and the full text alone, never from a profile or a key, so the server can
// cache it and every reader sees the same sheet. Every sentence in it is the
// paper's own — the abstract as written with the claim and the numbers set in
// ink, and, when the full text was read, verbatim sentences from the results,
// methods and limitations sections with the heading each came from.
//
// Absence is typed, never faked. A block with nothing honest to show is not
// filled from a template; it is listed in `omitted` with the reason, and
// `describeAvailability` turns that list into the one plain sentence the
// Decision block shows. Nothing else on the page hand-writes a status string.

import type { Paper } from "@/types";
import type { ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import type { SourceLink } from "./source-links";
import {
  QUANTITY_STRICT,
  isBoilerplate,
  pickSkimMarks,
  scoreSentence,
  splitSentences,
} from "./skim";

export type ReadingBlock =
  | "skim"
  | "findings"
  | "method"
  | "caveats"
  | "forYou"
  | "nextStep";

export type OmitReason =
  /** Nothing published where Peer can read it. */
  | "no_abstract"
  /** Needs the full text. */
  | "not_in_abstract"
  /** Full text read; the paper has no such section, or nothing in it qualified. */
  | "no_section"
  /** A PDF exists; only a self-hosted Peer reads PDFs. */
  | "pdf_only_hosted"
  /** The publisher blocked the full text. */
  | "paywalled"
  /** Model-only block. */
  | "needs_key"
  /** Model present, abstract only. */
  | "needs_full_text"
  /** Needs a current project in Profile. */
  | "no_profile"
  /** The model ran and gave no sentence for this block that could be verified. */
  | "no_verified_claim";

export interface ReadingQuote {
  text: string;
  from: { kind: "section"; heading: string; canonical: string };
}

export interface ReadingProvenance {
  abstract: "full" | "none";
  abstractSentences: number;
  /** Semantic Scholar's TLDR — labelled as such on the page, never merged into the abstract. */
  tldr?: string;
  fullText: "none" | "html" | "pdf" | "pdf_unreadable_here" | "paywalled";
  /** "arXiv HTML" | "Zenodo PDF" | "PMC" | "publisher page" … */
  sourceLabel?: string;
  /** PDFs only. */
  pageCount?: number;
  /** Canonical buckets present, document order. */
  buckets: string[];
  paywallHost?: string;
}

export type ReadingSourceLabel =
  | "Open on arXiv"
  | "Open the PDF"
  | "Open at the publisher"
  | "Open the source";

export interface PaperReading {
  version: 1;
  paperId: string;
  builtAt: string;
  provenance: ReadingProvenance;
  abstract: { sentences: string[]; introCount: number; marks: number[] };
  /** ≤3 */
  findings: ReadingQuote[];
  /** ≤2 */
  method: ReadingQuote[];
  /** ≤3 */
  caveats: ReadingQuote[];
  omitted: { block: ReadingBlock; reason: OmitReason }[];
  source: { label: ReadingSourceLabel; url: string } | null;
}

/**
 * What `describeAvailability` needs to know about a model report. The page
 * adapts `PaperReport.provenance` (plus `sourceKind` / `pageCount`) into this;
 * the reading deliberately does not import the report type, so the two can
 * change independently.
 */
export interface AvailabilityReport {
  basis: "model-abstract" | "model-fulltext";
  droppedClaims: number;
  sourceKind?: string;
  pageCount?: number;
  /**
   * The reader asked for a deep report. An abstract-basis report then means
   * the full text was walled, unfound or unreadable — not that a setting is
   * off — and the sentence must say which, never "turn on deep reports".
   */
  deepRequested?: boolean;
}

// ── Sentence rules ────────────────────────────────────────────────────

/** A result stated against something: "…outperforms X by 7 points". */
const COMPARATIVE =
  /\b(outperform|surpass|exceed|improv|reduc|increas|decreas|achiev|gain|faster|slower|higher|lower|better|worse)\w*\b[^.]*\b(than|over|by|to|compared)\b/i;

/** A sentence that says what was done to what. */
const METHOD =
  /\b(we|were|was)\s+(use|used|train|trained|appl|fit|simulat|measur|collect|implement|comput|perform|conduct|evaluat|sampl|record|annotat)\w*|\b(dataset|benchmark|cohort|participants?|samples?|n\s?=\s?\d+|assay|protocol|instrument|microscop|sequenc)\b/i;

/** A hedge the authors wrote about their own work. */
const LIMITATION =
  /\b(limitation|limited (to|by)|cannot|could not|did not|does not (yet )?(capture|account|scale|generali[sz]e)|future work|remains? (unclear|open|to be)|beyond the scope|not (yet )?(address|explore|consider|evaluate)|caveat)\b|^however,/i;

const MAX_FINDINGS = 3;
const MAX_METHOD = 2;
const MAX_CAVEATS = 3;
const MIN_FINDING_CHARS = 40;
const MIN_METHOD_CHARS = 60;
const MIN_CAVEAT_CHARS = 40;
/**
 * A quote longer than this is a paragraph. PDF text runs sub-headings into
 * the sentence before them, and LaTeXML keeps whole equations inline; both
 * produce "sentences" of four hundred characters that no reader would call a
 * quote. The same budget as the card's skim line.
 */
const MAX_QUOTE_CHARS = 260;

interface SectionSentence {
  text: string;
  heading: string;
  canonical: string;
  /** Position across the whole pool, for document order. */
  order: number;
}

function sectionSentences(doc: ExtractedDocument, buckets: string[]): SectionSentence[] {
  const out: SectionSentence[] = [];
  for (const section of doc.sections) {
    if (!buckets.includes(section.canonical)) continue;
    for (const text of splitSentences(section.text)) {
      out.push({
        text,
        heading: section.heading,
        canonical: section.canonical,
        order: out.length,
      });
    }
  }
  return out;
}

function toQuote(sentence: SectionSentence): ReadingQuote {
  return {
    text: sentence.text,
    from: {
      kind: "section",
      heading: sentence.heading,
      canonical: sentence.canonical,
    },
  };
}

/**
 * A "sentence" that is not prose: LaTeXML leaves TeX macros and the
 * mathematical-alphanumeric block inline ("𝒫 \\mathcal{P} can be obtained…"),
 * and a PDF placeholder section opens with a bracket. Quoting these verbatim
 * is honest and unreadable; they are skipped, never repaired.
 */
const UNREADABLE = /\\[a-zA-Z]+|[\u{1D400}-\u{1D7FF}]|^[^A-Za-z0-9"“'(]/u;

function quotable(sentence: SectionSentence, min: number): boolean {
  return (
    sentence.text.length >= min &&
    sentence.text.length <= MAX_QUOTE_CHARS &&
    !UNREADABLE.test(sentence.text)
  );
}

/**
 * What they found, and how big: up to three sentences from the results
 * section that carry a number or a comparison. Discussion is added to the
 * pool only when results alone yields fewer than two — a thin results section
 * is often followed by the numbers in the discussion.
 */
export function pickFindings(doc: ExtractedDocument): ReadingQuote[] {
  const candidates = (buckets: string[]) =>
    sectionSentences(doc, buckets).filter(
      (sentence) =>
        quotable(sentence, MIN_FINDING_CHARS) &&
        !isBoilerplate(sentence.text) &&
        (QUANTITY_STRICT.test(sentence.text) || COMPARATIVE.test(sentence.text)),
    );
  let pool = candidates(["results"]);
  if (pool.length < 2) pool = candidates(["results", "discussion"]);

  const score = (sentence: SectionSentence) =>
    2 * (QUANTITY_STRICT.test(sentence.text) ? 1 : 0) +
    (COMPARATIVE.test(sentence.text) ? 1 : 0) +
    // Position in a section says nothing about a sentence's weight.
    scoreSentence(sentence.text, 0);

  return pool
    .map((sentence) => ({ sentence, score: score(sentence) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FINDINGS)
    .sort((a, b) => a.sentence.order - b.sentence.order)
    .map(({ sentence }) => toQuote(sentence));
}

/**
 * How it was done: the first two sentences of the methods section that say
 * what was done to what — a dataset, a cohort, "we trained".
 */
export function pickMethod(doc: ExtractedDocument): ReadingQuote[] {
  return sectionSentences(doc, ["methods"])
    .filter(
      (sentence) => quotable(sentence, MIN_METHOD_CHARS) && METHOD.test(sentence.text),
    )
    .slice(0, MAX_METHOD)
    .map(toQuote);
}

/**
 * Where it is thin: the authors' own limitations section when there is one,
 * else the hedges in the discussion or conclusion. No caveat is ever read out
 * of an abstract — a heading over an abstract sentence is a claim Peer makes
 * about it.
 */
export function pickCaveats(doc: ExtractedDocument): ReadingQuote[] {
  const stated = sectionSentences(doc, ["limitations"])
    .filter((sentence) => quotable(sentence, MIN_CAVEAT_CHARS))
    .slice(0, MAX_CAVEATS);
  if (stated.length > 0) return stated.map(toQuote);

  return sectionSentences(doc, ["discussion", "conclusion"])
    .filter(
      (sentence) =>
        quotable(sentence, MIN_CAVEAT_CHARS) && LIMITATION.test(sentence.text),
    )
    .slice(0, 2)
    .map(toQuote);
}

// ── Provenance ────────────────────────────────────────────────────────

/** The display name of the host a document came from. */
function sourceLabelFor(link: SourceLink): string {
  switch (link.label) {
    case "arxiv-html":
    case "ar5iv":
      return link.kind === "pdf" ? "arXiv PDF" : "arXiv HTML";
    case "zenodo":
      return "Zenodo PDF";
    case "pmc":
      return "PMC";
    case "europepmc":
      return "Europe PMC";
    case "biorxiv":
      return "bioRxiv";
    default:
      return link.kind === "pdf" ? "PDF" : "publisher page";
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The host that blocked the full text, from the attempt that hit the wall. */
function paywallHostOf(fullText: FullTextResult): string | undefined {
  const blocked = fullText.attempts.find((attempt) =>
    attempt.outcome.startsWith("paywalled"),
  );
  if (blocked) return hostOf(blocked.link.url);
  // `paywallReason` opens with the host when it knew one.
  const match = fullText.reason?.match(/^([\w.-]+\.[a-z]{2,}) requires\b/i);
  return match?.[1];
}

/**
 * On Vercel a PDF link is attempted and `pdf-text.ts` reports `no-python`
 * (no interpreter can be spawned) or `no-extractor` (the helper script is not
 * in the function bundle). Either is the one outcome the page must name
 * plainly: the PDF is there; this deployment cannot read it. Mapping only
 * one of them would tell a deployed reader the paper has no full text.
 */
function pdfUnreadableHere(fullText: FullTextResult): boolean {
  return fullText.attempts.some(
    (attempt) =>
      attempt.link.kind === "pdf" && /\bno-(python|extractor)\b/.test(attempt.outcome),
  );
}

function buildProvenance(
  paper: Paper,
  sentences: string[],
  fullText: FullTextResult | null,
): ReadingProvenance {
  const base: ReadingProvenance = {
    abstract: sentences.length > 0 ? "full" : "none",
    abstractSentences: sentences.length,
    fullText: "none",
    buckets: [],
  };
  if (paper.tldr) base.tldr = paper.tldr;
  if (!fullText) return base;

  if (fullText.status === "ok" && fullText.doc) {
    const doc = fullText.doc;
    base.fullText = doc.source === "pdf" ? "pdf" : "html";
    if (fullText.sourceLink) base.sourceLabel = sourceLabelFor(fullText.sourceLink);
    if (typeof doc.pageCount === "number") base.pageCount = doc.pageCount;
    base.buckets = Array.from(new Set(doc.sections.map((section) => section.canonical)));
    return base;
  }
  if (fullText.status === "paywalled") {
    base.fullText = "paywalled";
    const host = paywallHostOf(fullText);
    if (host) base.paywallHost = host;
    return base;
  }
  if (pdfUnreadableHere(fullText)) base.fullText = "pdf_unreadable_here";
  return base;
}

// ── The reading ───────────────────────────────────────────────────────

function pickSource(
  paper: Paper,
  fullText: FullTextResult | null,
): PaperReading["source"] {
  if (paper.linkArxiv) return { label: "Open on arXiv", url: paper.linkArxiv };
  // A PDF that was actually read is a link we know resolves to the paper.
  const link = fullText?.status === "ok" ? fullText.sourceLink : undefined;
  if (link?.kind === "pdf") return { label: "Open the PDF", url: link.url };
  if (paper.doi) {
    return { label: "Open at the publisher", url: `https://doi.org/${paper.doi}` };
  }
  if (paper.linkPaper) return { label: "Open the source", url: paper.linkPaper };
  return null;
}

/**
 * Build the reading. Synchronous and pure: `fullText` null means the abstract
 * alone, which is what the page renders at first paint before the server
 * reading arrives. `now` exists so tests can pin `builtAt`.
 */
export function buildReading(
  paper: Paper,
  fullText: FullTextResult | null,
  now: Date = new Date(),
): PaperReading {
  const intro = paper.summaryIntro?.trim() ?? "";
  const discussion = paper.summaryResultDiscussion?.trim() ?? "";
  const sentences = splitSentences([intro, discussion].filter(Boolean).join(" "));
  const introCount = intro ? splitSentences(intro).length : 0;
  const marks = pickSkimMarks(sentences);

  const provenance = buildProvenance(paper, sentences, fullText);
  const doc = fullText?.status === "ok" ? fullText.doc : undefined;

  const findings = doc ? pickFindings(doc) : [];
  const method = doc ? pickMethod(doc) : [];
  const caveats = doc ? pickCaveats(doc) : [];

  const omitted: PaperReading["omitted"] = [];
  if (provenance.abstract === "none") omitted.push({ block: "skim", reason: "no_abstract" });

  // Why a section block is absent depends on how far the full text got, and
  // the same reason applies to all three.
  const sectionReason = (): OmitReason => {
    if (doc) return "no_section";
    if (provenance.fullText === "pdf_unreadable_here") return "pdf_only_hosted";
    if (provenance.fullText === "paywalled") return "paywalled";
    return provenance.abstract === "none" ? "no_abstract" : "not_in_abstract";
  };
  if (findings.length === 0) omitted.push({ block: "findings", reason: sectionReason() });
  if (method.length === 0) omitted.push({ block: "method", reason: sectionReason() });
  if (caveats.length === 0) omitted.push({ block: "caveats", reason: sectionReason() });

  // Both model-only. Whether the reader has a project is the page's knowledge,
  // not the reading's — the reading is the same document for everyone.
  omitted.push({ block: "forYou", reason: "needs_key" });
  omitted.push({ block: "nextStep", reason: "needs_key" });

  return {
    version: 1,
    paperId: paper.id,
    builtAt: now.toISOString(),
    provenance,
    abstract: { sentences, introCount, marks },
    findings,
    method,
    caveats,
    omitted,
    source: pickSource(paper, fullText),
  };
}

/**
 * What `omitted` cannot know: the reading is the same document for every
 * reader, so it says `needs_key` for the model-only blocks. The page holds
 * the profile and the report, and names the nearer reason for the export —
 * no project set; the model read the abstract alone; or the model ran and
 * gave nothing for the block that survived verification. A reader who just
 * ran the model is never told the block needs a key.
 */
export function omittedForReader(
  reading: PaperReading,
  report: AvailabilityReport | null,
  profileHasProject: boolean,
): PaperReading["omitted"] {
  return reading.omitted.map((entry) => {
    if (entry.block === "forYou" && !profileHasProject) {
      return { ...entry, reason: "no_profile" };
    }
    if (
      report?.basis === "model-abstract" &&
      (entry.block === "caveats" || entry.block === "nextStep")
    ) {
      return { ...entry, reason: "needs_full_text" };
    }
    if (report && entry.reason === "needs_key") {
      return { ...entry, reason: "no_verified_claim" };
    }
    return entry;
  });
}

// ── For your project, without a key ───────────────────────────────────

/** The same normalisation `plate-terms.ts` applies before comparing terms. */
function normalizeTerm(term: string): string {
  return term.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * The plate terms that also appear in the reader's project text. Two or more
 * is a real overlap worth one line; one is a coincidence, so the answer is
 * then nothing at all.
 */
export function sharedTerms(plateTerms: string[], profileText: string): string[] {
  const profile = normalizeTerm(profileText);
  if (!profile) return [];
  const hits = plateTerms.filter((term) => {
    const key = normalizeTerm(term);
    return key.length > 0 && profile.includes(key);
  });
  return hits.length >= 2 ? hits : [];
}

// ── The Decision block's sentence ─────────────────────────────────────

/** How each block is named inside a sentence. */
const BLOCK_PHRASE: Record<ReadingBlock, string> = {
  skim: "the skim",
  findings: "findings",
  method: "method",
  caveats: "caveats",
  forYou: "what it means for your project",
  nextStep: "a next step",
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NO_ABSTRACT =
  "No abstract is published where Peer can read it — only the record. Open it at the source to judge it.";
const NO_ABSTRACT_TLDR =
  "No abstract is published where Peer can read it. The one-line TLDR above is Semantic Scholar's, not the authors'.";
const PROFILE_EMPTY =
  "Add your current project in Profile and Peer will relate this paper to it.";
const MODEL_FAILED =
  "Your model could not finish; what is below is the paper's own text.";

/** "Findings, method and caveats are below." */
function presentSentence(reading: PaperReading): string {
  const present: ReadingBlock[] = [];
  if (reading.findings.length > 0) present.push("findings");
  if (reading.method.length > 0) present.push("method");
  if (reading.caveats.length > 0) present.push("caveats");
  if (present.length === 0) {
    return "Nothing in it could be quoted as findings, method or caveats.";
  }
  if (present.length === 1 && present[0] === "method") return "The method is below.";
  return `${capitalize(joinList(present.map((block) => BLOCK_PHRASE[block])))} are below.`;
}

/**
 * "What it means for your project and a next step need a key." At the
 * abstract tier a next step needs the full text as well, so only the block a
 * key alone unlocks is named there.
 */
function keyClause(reading: PaperReading, sectionsRead: boolean): string {
  const blocks = reading.omitted
    .filter((entry) => entry.reason === "needs_key")
    .map((entry) => entry.block)
    .filter((block) => sectionsRead || block === "forYou");
  if (blocks.length === 0) return "";
  const verb = blocks.length > 1 ? "need" : "needs";
  return `${capitalize(joinList(blocks.map((block) => BLOCK_PHRASE[block])))} ${verb} a key.`;
}

function sourcePhrase(provenance: ReadingProvenance): string {
  if (provenance.fullText === "pdf") {
    return provenance.pageCount ? `a ${provenance.pageCount}-page PDF` : "a PDF";
  }
  return provenance.sourceLabel ?? "the full text";
}

/** The sentence about what Peer read, with no model in the picture. */
function readingSentence(reading: PaperReading, providerConfigured: boolean): string {
  const { provenance } = reading;
  const sectionsRead = provenance.fullText === "html" || provenance.fullText === "pdf";

  if (provenance.abstract === "none" && !sectionsRead) {
    return provenance.tldr ? NO_ABSTRACT_TLDR : NO_ABSTRACT;
  }

  // A configured key means the model, not the reader, is what the missing
  // blocks wait on; the model's own sentence takes over once it answers.
  const key = providerConfigured ? "" : keyClause(reading, sectionsRead);
  const withKey = (sentence: string) => (key ? `${sentence} ${key}` : sentence);

  if (sectionsRead) {
    const qualifier = provenance.buckets.includes("limitations")
      ? ", with a limitations section"
      : provenance.buckets.includes("methods")
        ? ""
        : " with no methods section";
    const lead =
      provenance.abstract === "none"
        ? "No abstract is published where Peer can read it, but the full text was:"
        : "Full text read:";
    return withKey(`${lead} ${sourcePhrase(provenance)}${qualifier}. ${presentSentence(reading)}`);
  }
  if (provenance.fullText === "pdf_unreadable_here") {
    return withKey("Abstract only; the PDF is there, but only a self-hosted Peer reads PDFs.");
  }
  if (provenance.fullText === "paywalled") {
    const host = provenance.paywallHost ?? "the publisher";
    return withKey(`Abstract only — ${host} keeps the full text behind access.`);
  }

  // Findings are not named: at this tier the numbers are already in ink in
  // the abstract, and "what they found" is not a promise the full text keeps.
  const needFullText = reading.omitted
    .filter((entry) => entry.reason === "not_in_abstract" && entry.block !== "findings")
    .map((entry) => BLOCK_PHRASE[entry.block]);
  if (providerConfigured) {
    return needFullText.length > 0
      ? `Abstract only. ${capitalize(joinList(needFullText))} need the full text.`
      : "Abstract only.";
  }
  const needKey = reading.omitted
    .filter((entry) => entry.reason === "needs_key" && entry.block === "forYou")
    .map((entry) => BLOCK_PHRASE[entry.block]);
  return `Abstract only. ${capitalize(joinList([...needFullText, ...needKey]))} need the full text and a key.`;
}

/** Map a report's `sourceKind` to the same names the reading uses. */
function sourceKindLabel(kind: string | undefined): string | undefined {
  switch (kind) {
    case "ar5iv":
      return "arXiv HTML";
    case "pmc":
      return "PMC";
    case "biorxiv":
      return "bioRxiv";
    case "generic-html":
      return "publisher page";
    case "pdf":
      return "PDF";
    default:
      return undefined;
  }
}

/**
 * Why an abstract-basis report has no caveats and no next step. With deep
 * off, the honest instruction is the setting. With deep on, the model got
 * the abstract because the full text was walled, unreadable here, unfound —
 * or read by Peer but not finished by the model — and the clause names that
 * wall instead of a setting the reader already turned on.
 */
function fullTextClause(reading: PaperReading, report: AvailabilityReport): string {
  const { provenance } = reading;
  if (!report.deepRequested) {
    return " Caveats and a next step need the full text — turn on deep reports in Profile.";
  }
  if (provenance.fullText === "paywalled") {
    const host = provenance.paywallHost ?? "the publisher";
    return ` Caveats and a next step need the full text — ${host} keeps it behind access.`;
  }
  if (provenance.fullText === "pdf_unreadable_here") {
    return " Caveats and a next step need the full text; the PDF is there, but only a self-hosted Peer reads PDFs.";
  }
  if (provenance.fullText === "html" || provenance.fullText === "pdf") {
    return " Caveats and a next step need the full text; your model's deep read of it did not finish.";
  }
  return " Caveats and a next step need the full text, which Peer could not find.";
}

function modelSentence(reading: PaperReading, report: AvailabilityReport): string {
  let sentence: string;
  if (report.basis === "model-abstract") {
    sentence =
      "Read by your model from the abstract; every claim below carries a sentence from it.";
    if (reading.caveats.length === 0) sentence += fullTextClause(reading, report);
  } else {
    const { provenance } = reading;
    const sectionsRead = provenance.fullText === "html" || provenance.fullText === "pdf";
    const label = sectionsRead
      ? provenance.sourceLabel
      : sourceKindLabel(report.sourceKind);
    const pages = sectionsRead ? provenance.pageCount : report.pageCount;
    const detail = [label, pages ? `${pages} pages` : undefined].filter(Boolean);
    const paren = detail.length > 0 ? ` (${detail.join(", ")})` : "";
    sentence = `Read by your model from the full text${paren}; every claim below carries a verbatim sentence.`;
  }
  if (report.droppedClaims > 0) {
    const n = report.droppedClaims;
    sentence += ` ${n} ${n === 1 ? "claim was" : "claims were"} dropped for lacking one.`;
  }
  return sentence;
}

/**
 * The Decision block's sentences, in order. One string per idea: what was
 * read (or what the model read), then, when a model answered, whether a
 * project is set. The page joins them; it never adds a sentence of its own.
 * `report` is null when there is no model layer — including a `noLlm` report.
 */
export function describeAvailability(input: {
  reading: PaperReading;
  report: AvailabilityReport | null;
  providerConfigured: boolean;
  profileHasProject: boolean;
  modelFailed: boolean;
}): string[] {
  const { reading, report, providerConfigured, profileHasProject, modelFailed } = input;
  if (report) {
    const out = [modelSentence(reading, report)];
    if (!profileHasProject) out.push(PROFILE_EMPTY);
    return out;
  }
  const out = [readingSentence(reading, providerConfigured)];
  if (modelFailed) out.push(MODEL_FAILED);
  return out;
}

const SMALL_WORDS = new Set(["and", "or", "of", "the", "in", "for", "on", "to", "a", "an", "with", "by"]);

/**
 * The heading as the attribution shows it. Headings are kept verbatim in the
 * data — "4.5 Limitations", "MATERIALS AND METHODS" — because they are the
 * paper's own. But a PDF's shouting is typesetting, not meaning, and it would
 * be the only capitals on a page that has none by rule; an all-caps heading
 * is set in title case for display and export, numbering untouched.
 */
export function displayHeading(heading: string): string {
  const trimmed = heading.trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/(\s+)/)
    .map((part, i) =>
      /^\s+$/.test(part) || (i > 0 && SMALL_WORDS.has(part))
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}
