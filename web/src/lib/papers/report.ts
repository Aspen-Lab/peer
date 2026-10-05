// The model report — what a reader's own key adds on top of the paper's words.
//
// Every claim on the wire is a `Claim`: one sentence of Peer's prose and one
// sentence of the paper's, copied character-for-character, that supports it.
// The sanitizer below only whitelists and caps; it fabricates nothing. A claim
// the model could not back with an `evidence` sentence is dropped here, and
// `evidence.ts` then drops every claim whose sentence is not actually in the
// text the model was given. Nothing unverified reaches the client, and absence
// is a typed omission the page names — never a placeholder sentence.
//
// The old fallback report ("Main result", "Key result 2", "Overview /
// Section N", "Connects to your stated focus on …") is gone on purpose: it
// relabelled abstract sentences as findings and invented fit reasons. The one
// report a reader gets without a model is `emptyReport`, and the page treats
// `noLlm` as "no model layer".

import type { Paper } from "@/types";
import { cleanDisplayText } from "@/lib/text/clean";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";

/**
 * One sentence of Peer's prose plus the verbatim sentence of the paper that
 * supports it. `evidenceWhere` is set by `verifyReportEvidence`: `"abstract"`
 * or the heading of the section the sentence was found in (numbering kept,
 * e.g. `"4.4 Results"`), so the page can attribute the quote.
 */
export interface Claim {
  text: string;
  evidence: string;
  evidenceWhere?: string;
  /** P2-02 (§1g.3): an answer's section — the id of the section that holds
   *  its evidence, set by `verifyReportEvidence` (absent for the abstract). */
  sectionId?: string;
  /** P2-02: that section's page, PDFs only. */
  page?: number;
}

/** P2-02 (§1g.3): whether THIS paper answers one of the reader's questions. */
export type QuestionVerdict = "answered" | "partly" | "not_addressed";

/** A section to read for a question: one that answers it, or `background`
 *  needed to understand an answer though it does not mention the question. */
export interface ReadNextItem {
  sectionId: string;
  why: string;
  kind: "answer" | "background";
}

/** Pass 2's answer to one of the reader's questions. `question` is always the
 *  reader's own text (the server's, by index — never the model's echo). */
export interface QuestionAnswers {
  question: string;
  verdict: QuestionVerdict;
  /** ≤3, each carrying a verbatim sentence of the paper. */
  answers: Claim[];
  /** ≤4, each naming a section of the paper's body. */
  readNext: ReadNextItem[];
}

/** A term the reader needs for the answers: the paper's own definition
 *  (`evidence`, verified), or Peer's words (`peer: true`, no evidence). */
export interface PaperTerm {
  term: string;
  definition: string;
  evidence?: string;
  evidenceWhere?: string;
  sectionId?: string;
  page?: number;
  peer?: true;
}

export interface PaperReportKeyResult {
  title: string;
  detail: string;
  /** Required: one verbatim sentence from the abstract or the full text. */
  evidence: string;
  evidenceWhere?: string;
  /**
   * Restored from the pre-2026-09 report: one sentence on what is new about
   * THIS result against prior work. Peer's reading, not a quote — it carries
   * no evidence sentence and the page labels it as Peer's.
   */
  novelty?: string;
  /**
   * Deep-report only: figure label this result should reference (e.g.
   * "Figure 3"), chosen by post-report figure binding. Null/absent when no
   * good figure match was found — UI shows no figure in that case.
   */
  figureLabel?: string | null;
  /**
   * Deep-report only: directly bound image URL chosen by figure-binding from
   * the candidate pool. When set, the UI renders this image directly without
   * a second `/api/figure` round-trip. May be a `data:image/...;base64,...`
   * URL (PDF-extracted) or a normal HTTP URL.
   */
  figureImageUrl?: string | null;
  /** Deep-report only: caption that goes with `figureImageUrl`. */
  figureCaption?: string | null;
  /** Deep-report only: source label for the bound figure. */
  figureSource?: string | null;
}

/** Report-generation depth used for the current response. */
export type PaperReportDepth = "deep" | "abstract" | "fallback";

/** What the model actually read: the abstract alone, or the full text. */
export type PaperReportBasis = "model-abstract" | "model-fulltext";

export interface PaperReportProvenance {
  basis: PaperReportBasis;
  /** Deep only: which extractor served the full text (`ExtractedDocument.source`). */
  sourceKind?: string;
  /** Deep only, PDFs only: pages the extractor saw. */
  pageCount?: number;
  /** Claims removed by `verifyReportEvidence` for lacking a verbatim sentence. */
  droppedClaims: number;
}

/** One major section of a review or survey, named as the paper names it. */
export interface PaperReportReviewSection {
  heading: string;
  summary: string;
}

export interface PaperReport {
  /** ≤3 sentences: Peer's skim, each carrying a sentence of the paper. */
  skim: Claim[];
  whatItProposes: {
    /** 2–3 sentences on the proposal or scope; the "Proposal" block. */
    summary: string;
    /** ≤4 concrete methods, each with evidence. */
    methods: Claim[];
    /**
     * S6 (2026-09): ≤2 short "new here" lines — the novelty, stated only
     * where it differs from `summary`. Folded into this one section along
     * with the old "What is new" block, which duplicated `summary`'s
     * content; Peer's reading, no evidence sentence.
     */
    newHere?: string[];
    /**
     * Deep-report only: figure label promoted to the proposal area. Used when
     * a figure is reused by multiple result cards, or when the proposal itself
     * has a strong figure match.
     */
    figureLabel?: string | null;
    /** Deep-report only: directly bound image URL for the proposal section. */
    figureImageUrl?: string | null;
    figureCaption?: string | null;
    figureSource?: string | null;
  };
  resultsAndSignificance: {
    /** 2–3 sentences on the headline result; the pull quote over the results. */
    summary: string;
    /** ≤4 results, each with evidence. */
    keyResults: PaperReportKeyResult[];
  };
  /**
   * Restored, review and survey papers only: the body's major sections, in
   * the paper's own headings. Rendered as "Paper contents" in place of the
   * results block when present.
   */
  reviewContents?: { sections: PaperReportReviewSection[] };
  /**
   * S6 (2026-09): removed from every new report — deleted from both prompts,
   * the page and the Markdown export. Stays optional here only so a report
   * cached under an older wire shape still type-checks; nothing reads it.
   */
  whyItFitsYou?: { reasons: string[]; keywords: string[] };
  /** Deep only, ≤3: what the authors themselves state as limits. */
  limitations?: Claim[];
  /**
   * Only when the profile has a project. `basedOn` is the reader's project
   * text the relation was drawn against; ≤3 items, each with evidence.
   */
  relationToYourWork?: { basedOn: string; items: Claim[] };
  /** Deep only: one concrete experiment or check the reader could run next. */
  nextStep?: Claim | null;
  /**
   * P2-02 (§1g.3): only when the reader asked questions — one entry per
   * question, by the request's index. Absent otherwise (the
   * `relationToYourWork` pattern: never asked, never kept).
   */
  forYourQuestions?: QuestionAnswers[];
  /** P2-02: ≤8 terms the answers need; only with questions. */
  terms?: PaperTerm[];
  provenance: PaperReportProvenance;
  /** True when no model produced this report; the page shows no model layer. */
  noLlm?: boolean;
  /** Which depth was used to produce this report. */
  depth?: PaperReportDepth;
  /** Set when deep was requested but failed (paywall / no PDF / no HTML). */
  paywallNotice?: string;
  /** Set on deep success: which source served the full text. */
  sourceKind?: string;
  /**
   * SPEND-CAP · R7 (ABC-JEV-INTEGRATION.md §1v) — set only when THIS route's
   * own model call was refused by the shared company-AI dollar budget
   * (`CompanySpendCapRefusedError`, `lib/usage/company-budget.ts`). Additive,
   * same idiom as `paywallNotice`/`noLlm` above: absent on every report this
   * campaign shipped before this field existed, and absent whenever the
   * budget mechanism itself is off (its default) or wasn't the reason this
   * particular call degraded.
   */
  quota?: QuotaSignal;
}

export interface PaperReportRequest {
  paper: Paper;
  contextHint?: string;
}

// ── Caps ─────────────────────────────────────────────────────────────
// Sizes the page lays out for; anything past them is cut, not summarised.

export const REPORT_CAPS = {
  skim: 3,
  skimChars: 300,
  methods: 4,
  keyResults: 4,
  limitations: 3,
  relationItems: 3,
  evidenceChars: 400,
  basedOnChars: 200,
  summaryChars: 600,
  claimChars: 600,
  novelty: 2, // bounds whatItProposes.newHere (S6 renamed the field; the cap name did not)
  noveltyChars: 320,
  // S6: whyItFitsYou is deleted from every new report. These four caps stay
  // only to bound sanitizePaperReport's legacy-cache branch below — do not
  // remove them while that branch reads a v5-shaped whyItFitsYou blob.
  fitReasons: 3,
  fitReasonChars: 320,
  fitKeywords: 8,
  fitKeywordChars: 40,
  reviewSections: 8,
  reviewHeadingChars: 120,
  reviewSummaryChars: 400,
  // P2-02 (§1g.3, D7): the answers to the reader's questions.
  questions: 5,
  answers: 3,
  answerChars: 360,
  readNext: 4,
  whyChars: 160,
  terms: 8,
  termChars: 60,
  definitionChars: 160,
} as const;

/**
 * Returns the display label for a review/survey paper, or null for regular
 * papers. Title only: the abstract and keywords of a normal paper say
 * "review" and "state-of-the-art" all the time ("we review prior work",
 * "state-of-the-art baselines"), and the old haystack test used to flip such
 * papers into the review branch of the report prompt.
 */
export function reviewPaperLabel(paper: Paper): "Review" | "Survey" | null {
  if (!/\b(review|survey|meta-analysis)\b/i.test(paper.title)) return null;
  return /\bsurvey\b/i.test(paper.title) ? "Survey" : "Review";
}

/**
 * The report a reader gets when no model ran: nothing, typed. `basis` is a
 * required field of the wire shape and names the tier the empty report stands
 * in for (nothing beyond the abstract was read); `noLlm` is the truth the page
 * reads, and a `noLlm` report is neither cached nor rendered.
 */
export function emptyReport(depth: PaperReportDepth): PaperReport {
  return {
    skim: [],
    whatItProposes: { summary: "", methods: [] },
    resultsAndSignificance: { summary: "", keyResults: [] },
    provenance: { basis: "model-abstract", droppedClaims: 0 },
    noLlm: true,
    depth,
  };
}

// ── Sanitizer ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cleaned display text, cut at `max` characters; "" when absent or not a string. */
function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const cleaned = cleanDisplayText(value);
  return cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
}

/**
 * A claim survives only with both a sentence of prose and a non-empty
 * evidence string. Missing evidence is not defaulted to "" and kept — the
 * claim is dropped, before verification ever sees it.
 */
function claim(value: unknown, maxChars: number = REPORT_CAPS.claimChars): Claim | null {
  if (!isRecord(value)) return null;
  const body = text(value.text, maxChars);
  const evidence = text(value.evidence, REPORT_CAPS.evidenceChars);
  if (!body || !evidence) return null;
  return { text: body, evidence };
}

function claims(value: unknown, max: number, maxChars: number = REPORT_CAPS.claimChars): Claim[] {
  if (!Array.isArray(value)) return [];
  const out: Claim[] = [];
  for (const item of value) {
    const c = claim(item, maxChars);
    if (!c) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Cleaned, non-empty strings, capped in count and length. */
function strings(value: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const t = text(item, maxChars);
    if (!t) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function keyResult(value: unknown): PaperReportKeyResult | null {
  if (!isRecord(value)) return null;
  const title = text(value.title, 120);
  const detail = text(value.detail, REPORT_CAPS.claimChars);
  const evidence = text(value.evidence, REPORT_CAPS.evidenceChars);
  // No "Key result N" label is invented for a result the model left unnamed,
  // and no result without its receipt survives.
  if (!title || !detail || !evidence) return null;
  const novelty = text(value.novelty, REPORT_CAPS.noveltyChars);
  return {
    title,
    detail,
    evidence,
    ...(novelty ? { novelty } : {}),
    ...figureFields(value),
  };
}

function reviewSections(value: unknown): PaperReportReviewSection[] {
  const raw = isRecord(value) ? value.sections : undefined;
  if (!Array.isArray(raw)) return [];
  const out: PaperReportReviewSection[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const heading = text(item.heading, REPORT_CAPS.reviewHeadingChars);
    const summary = text(item.summary, REPORT_CAPS.reviewSummaryChars);
    if (!heading || !summary) continue;
    out.push({ heading, summary });
    if (out.length >= REPORT_CAPS.reviewSections) break;
  }
  return out;
}

/** An image the page may show as the paper's own: served over TLS, or rendered from its PDF. */
const FIGURE_URL = /^(https:\/\/\S+|data:image\/)/;

/**
 * Figure fields carry three states the UI distinguishes: a string (bound),
 * `null` (binding ran and found nothing) and absent (binding never ran).
 */
function figureFields(value: Record<string, unknown>): {
  figureLabel?: string | null;
  figureImageUrl?: string | null;
  figureCaption?: string | null;
  figureSource?: string | null;
} {
  const out: ReturnType<typeof figureFields> = {};
  if (typeof value.figureLabel === "string") {
    out.figureLabel = cleanDisplayText(value.figureLabel) || null;
  } else if (value.figureLabel === null) {
    out.figureLabel = null;
  }
  // figureImageUrl is allowed to be a data: URL (potentially long), so don't
  // run it through cleanDisplayText (which collapses whitespace and could
  // mangle base64). Only the two shapes the binder produces are kept — an
  // https URL from the pool or a PDF-rendered data image; anything else is a
  // string the model typed, and it is dropped rather than rendered as the
  // paper's figure.
  if (typeof value.figureImageUrl === "string" && FIGURE_URL.test(value.figureImageUrl)) {
    out.figureImageUrl = value.figureImageUrl;
  } else if (value.figureImageUrl === null) {
    out.figureImageUrl = null;
  }
  if (typeof value.figureCaption === "string") {
    out.figureCaption = cleanDisplayText(value.figureCaption) || null;
  } else if (value.figureCaption === null) {
    out.figureCaption = null;
  }
  if (typeof value.figureSource === "string") {
    out.figureSource = cleanDisplayText(value.figureSource) || null;
  } else if (value.figureSource === null) {
    out.figureSource = null;
  }
  return out;
}

/**
 * The report with no figure on it. A figure is bound by `figure-binding.ts`
 * from the paper's own caption pool, and only the deep path runs that; at
 * the abstract tier the sanitizer still carries the fields through (models
 * echo any key they have seen in a schema), so a URL the model typed would
 * reach the plate as the paper's figure. The abstract tier strips them all —
 * absent, the state that says binding never ran.
 */
export function withoutFigures(report: PaperReport): PaperReport {
  const proposes = { ...report.whatItProposes };
  delete proposes.figureLabel;
  delete proposes.figureImageUrl;
  delete proposes.figureCaption;
  delete proposes.figureSource;
  return {
    ...report,
    whatItProposes: proposes,
    resultsAndSignificance: {
      ...report.resultsAndSignificance,
      keyResults: report.resultsAndSignificance.keyResults.map((result) => {
        const bare = { ...result };
        delete bare.figureLabel;
        delete bare.figureImageUrl;
        delete bare.figureCaption;
        delete bare.figureSource;
        return bare;
      }),
    },
  };
}

// ── The answers to the reader's questions (P2-02, §1g.3) ───────────────

const VERDICTS: readonly QuestionVerdict[] = ["answered", "partly", "not_addressed"];
const READ_NEXT_KINDS: readonly ReadNextItem["kind"][] = ["answer", "background"];

/** A section id as the prompt gave it (`s3`, or an extractor's own). */
function sectionIdOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.:-]{1,60}$/.test(value.trim()) ? value.trim() : undefined;
}

function answerClaims(value: unknown): Claim[] {
  if (!Array.isArray(value)) return [];
  const out: Claim[] = [];
  for (const item of value) {
    const c = claim(item, REPORT_CAPS.answerChars);
    if (!c) continue;
    const sectionId = isRecord(item) ? sectionIdOf(item.sectionId) : undefined;
    out.push({ ...c, ...(sectionId ? { sectionId } : {}) });
    if (out.length >= REPORT_CAPS.answers) break;
  }
  return out;
}

function readNextItems(value: unknown): ReadNextItem[] {
  if (!Array.isArray(value)) return [];
  const out: ReadNextItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const sectionId = sectionIdOf(item.sectionId);
    const why = text(item.why, REPORT_CAPS.whyChars);
    const kind = item.kind as ReadNextItem["kind"];
    if (!sectionId || !why || !READ_NEXT_KINDS.includes(kind)) continue;
    out.push({ sectionId, why, kind });
    if (out.length >= REPORT_CAPS.readNext) break;
  }
  return out;
}

/**
 * One entry per question of the request, by index: the model's i-th entry
 * answers the request's i-th question, and its `question` is overwritten with
 * the request's own text. Entries past the request's count are dropped; an
 * entry with a verdict the schema does not name is dropped (the question then
 * has no entry — nothing is said for it rather than a verdict invented).
 */
function questionAnswers(value: unknown, questions: readonly string[]): QuestionAnswers[] {
  if (!Array.isArray(value)) return [];
  const out: QuestionAnswers[] = [];
  const count = Math.min(value.length, questions.length, REPORT_CAPS.questions);
  for (let i = 0; i < count; i += 1) {
    const item = value[i];
    if (!isRecord(item)) continue;
    const verdict = item.verdict as QuestionVerdict;
    if (!VERDICTS.includes(verdict)) continue;
    out.push({
      question: questions[i],
      verdict,
      answers: answerClaims(item.answers),
      readNext: readNextItems(item.readNext),
    });
  }
  return out;
}

/** ≤8 terms. One with an `evidence` sentence is the paper's definition (the
 *  verifier holds it to that); one without is Peer's words, and says so. */
function paperTerms(value: unknown): PaperTerm[] {
  if (!Array.isArray(value)) return [];
  const out: PaperTerm[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const term = text(item.term, REPORT_CAPS.termChars);
    const definition = text(item.definition, REPORT_CAPS.definitionChars);
    if (!term || !definition) continue;
    const evidence = text(item.evidence, REPORT_CAPS.evidenceChars);
    const sectionId = sectionIdOf(item.sectionId);
    out.push(evidence ? { term, definition, evidence, ...(sectionId ? { sectionId } : {}) } : { term, definition, peer: true });
    if (out.length >= REPORT_CAPS.terms) break;
  }
  return out;
}

const DEPTHS: readonly PaperReportDepth[] = ["deep", "abstract", "fallback"];
const BASES: readonly PaperReportBasis[] = ["model-abstract", "model-fulltext"];

/**
 * Whitelist a raw model object (or an already-shaped report) into a
 * `PaperReport`. Unknown keys are dropped, every string passes through
 * `cleanDisplayText`, the caps in `REPORT_CAPS` apply, and any claim or key
 * result without a non-empty `evidence` string is removed. No field is ever
 * filled with a default sentence; empty arrays are the honest shape.
 *
 * Provenance is the caller's to set (`generateShallowReport` /
 * `generateDeepReport` know what the model read); the sanitizer only carries
 * a valid one through, and otherwise marks the abstract basis with zero drops
 * so the shape is complete for `verifyReportEvidence` to count into.
 *
 * P2-02 (§1g.3): `forYourQuestions` and `terms` are kept only when the
 * request carried `questions` — the model was asked for them then and only
 * then — with each entry's `question` the request's own text by index. With
 * no questions both are dropped, so such a report is exactly what it was.
 */
export function sanitizePaperReport(
  raw: unknown,
  options: { questions?: readonly string[] } = {},
): PaperReport {
  const r = isRecord(raw) ? raw : {};
  const proposes = isRecord(r.whatItProposes) ? r.whatItProposes : {};
  const results = isRecord(r.resultsAndSignificance) ? r.resultsAndSignificance : {};
  const relation = isRecord(r.relationToYourWork) ? r.relationToYourWork : null;
  const provenance = isRecord(r.provenance) ? r.provenance : {};

  const keyResults: PaperReportKeyResult[] = [];
  if (Array.isArray(results.keyResults)) {
    for (const item of results.keyResults) {
      const kr = keyResult(item);
      if (!kr) continue;
      keyResults.push(kr);
      if (keyResults.length >= REPORT_CAPS.keyResults) break;
    }
  }

  const relationItems = relation ? claims(relation.items, REPORT_CAPS.relationItems) : [];
  const basedOn = relation ? text(relation.basedOn, REPORT_CAPS.basedOnChars) : "";

  const nextStep = claim(r.nextStep);

  // S6: the model's field is `newHere`; a v5-shaped cached/replayed object
  // may still carry the old `novelty` key, so accept either while nothing
  // new is ever asked to produce it.
  const newHere = strings(
    proposes.newHere ?? proposes.novelty,
    REPORT_CAPS.novelty,
    REPORT_CAPS.noveltyChars,
  );

  const report: PaperReport = {
    skim: claims(r.skim, REPORT_CAPS.skim, REPORT_CAPS.skimChars),
    whatItProposes: {
      summary: text(proposes.summary, REPORT_CAPS.summaryChars),
      methods: claims(proposes.methods, REPORT_CAPS.methods),
      ...(newHere.length > 0 ? { newHere } : {}),
      ...figureFields(proposes),
    },
    resultsAndSignificance: {
      summary: text(results.summary, REPORT_CAPS.summaryChars),
      keyResults,
    },
    provenance: {
      basis: BASES.includes(provenance.basis as PaperReportBasis)
        ? (provenance.basis as PaperReportBasis)
        : "model-abstract",
      ...(typeof provenance.sourceKind === "string" && provenance.sourceKind
        ? { sourceKind: cleanDisplayText(provenance.sourceKind) }
        : {}),
      ...(typeof provenance.pageCount === "number" && Number.isFinite(provenance.pageCount)
        ? { pageCount: Math.max(0, Math.round(provenance.pageCount)) }
        : {}),
      droppedClaims:
        typeof provenance.droppedClaims === "number" && Number.isFinite(provenance.droppedClaims)
          ? Math.max(0, Math.round(provenance.droppedClaims))
          : 0,
    },
  };

  // Review contents and fit are present only with something in them: an
  // empty heading is the shape this page refuses.
  const sections = reviewSections(r.reviewContents);
  if (sections.length > 0) report.reviewContents = { sections };
  if (isRecord(r.whyItFitsYou)) {
    const reasons = strings(r.whyItFitsYou.reasons, REPORT_CAPS.fitReasons, REPORT_CAPS.fitReasonChars);
    const keywords = strings(r.whyItFitsYou.keywords, REPORT_CAPS.fitKeywords, REPORT_CAPS.fitKeywordChars);
    if (reasons.length > 0 || keywords.length > 0) report.whyItFitsYou = { reasons, keywords };
  }

  if (Array.isArray(r.limitations)) {
    report.limitations = claims(r.limitations, REPORT_CAPS.limitations);
  }
  // A relation block with nothing to say is absent, not an empty heading.
  if (relation && relationItems.length > 0) {
    report.relationToYourWork = { basedOn, items: relationItems };
  }
  if (nextStep) report.nextStep = nextStep;
  else if (r.nextStep === null) report.nextStep = null;

  const questions = options.questions ?? [];
  if (questions.length > 0) {
    const answered = questionAnswers(r.forYourQuestions, questions);
    if (answered.length > 0) report.forYourQuestions = answered;
    const terms = paperTerms(r.terms);
    if (terms.length > 0) report.terms = terms;
  }

  if (r.noLlm === true) report.noLlm = true;
  if (DEPTHS.includes(r.depth as PaperReportDepth)) report.depth = r.depth as PaperReportDepth;
  const paywallNotice = text(r.paywallNotice, REPORT_CAPS.summaryChars);
  if (paywallNotice) report.paywallNotice = paywallNotice;
  const sourceKind = text(r.sourceKind, 40);
  if (sourceKind) report.sourceKind = sourceKind;

  return report;
}
