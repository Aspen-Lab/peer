import type {
  Paper,
  PreferenceConcept,
  PreferenceConceptSource,
  PreferenceLedger,
  PreferenceLedgerEntry,
} from "@/types";
import type { RawItem } from "@/lib/sources/types";

const HALF_LIFE_DAYS = 60;
export const FACET_PREFERENCE_HALF_LIFE_DAYS = 14;
const MAX_CONCEPTS_PER_ITEM = 16;
const POSITIVE_BOOST_MAX = 0.18;
// Heavier than the original 0.45: a concept you've repeatedly rejected drops to
// ×0.40 of base, so persistent dislikes are genuinely suppressed. A single
// dislike stays gentle thanks to the saturating curve below. Tunable.
const NEGATIVE_PENALTY_MAX = 0.6;

type PreferenceSignalKind = "positive" | "negative";

interface ApplyPreferenceSignalOptions {
  at?: string;
  requiredTopics?: string[];
}

/**
 * Entries that older builds recorded from the stopped events and jobs feeds
 * are stored under `event|…` / `job|…` keys and carry `origin: "event"` /
 * `"job"`. They counted for nothing on a paper (their influence there was 0),
 * and they must keep counting for nothing: **they are deleted whenever a
 * ledger is cleaned, never kept with the origin dropped.** An entry that lost
 * its origin is a paper entry, and one of these would lift a paper that shares
 * its concept by 0.1049 (of a 0.18 maximum). The namespace is checked as well
 * as the field, for an entry that reached the ledger without its origin.
 */
function isLegacyOpportunityEntry(key: string, origin: unknown): boolean {
  return origin === "event" || origin === "job" || /^(?:event|job)\|/.test(key);
}

export interface PreferenceMatchScore {
  boost: number;
  penalty: number;
  matchedPositive: string[];
  matchedNegative: string[];
}

export type PreferenceDocumentFrequency = Map<string, number>;

function daysBetween(fromIso: string | undefined, toMs: number): number {
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, (toMs - from) / 86_400_000);
}

function decayFactor(
  fromIso: string | undefined,
  toMs: number,
  halfLifeDays = HALF_LIFE_DAYS,
): number {
  const days = daysBetween(fromIso, toMs);
  if (days <= 0) return 1;
  return Math.pow(0.5, days / halfLifeDays);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function normalizePreferenceLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bareOpenAlexId(value: string): string {
  return value.split("/").pop()?.toLowerCase() ?? value.toLowerCase();
}

// Canonicalization note: OpenAlex-sourced papers carry stable concept/topic IDs,
// so "LCO" and "LiCoO₂" papers that OpenAlex maps to the same concept merge by
// `source:id` key. Papers from arXiv/Semantic Scholar/PubMed have no such IDs and
// fall back to `text:<normalized label>`, so cross-source merging only happens
// when the surface labels match after normalization (see lookupLedgerEntries,
// which also matches on normalized label to bridge key/text entries).
export function preferenceKey(
  label: string,
  source: PreferenceConceptSource = "paper_keyword",
  id?: string,
): string {
  if (id && /^https?:\/\/openalex\.org\//i.test(id)) {
    return `${source}:${bareOpenAlexId(id)}`;
  }
  if (id && /^(?:(?:t|c|w)?\d+|[a-z0-9-]+)$/i.test(id.trim())) {
    return `${source}:${id.trim().toLowerCase()}`;
  }
  return `text:${normalizePreferenceLabel(label)}`;
}

export function normalizePreferenceConcepts(
  concepts: Array<Partial<PreferenceConcept> | null | undefined>,
): PreferenceConcept[] {
  const out: PreferenceConcept[] = [];
  const seen = new Set<string>();

  for (const rawConcept of concepts) {
    if (!rawConcept) continue;
    const label = rawConcept.label?.trim();
    if (!label) continue;
    const source = rawConcept.source ?? "paper_keyword";
    const key = rawConcept.key?.trim() || preferenceKey(label, source);
    const normalized: PreferenceConcept = {
      key,
      label,
      source,
      confidence:
        typeof rawConcept.confidence === "number"
          ? clamp01(rawConcept.confidence)
          : undefined,
      ...(typeof rawConcept.section === "string" ? { section: rawConcept.section.slice(0, 80) } : {}),
      ...(rawConcept.facet === "method" || rawConcept.facet === "material" || rawConcept.facet === "topic"
        ? { facet: rawConcept.facet } : {}),
      ...(typeof rawConcept.extractionVersion === "number" ? { extractionVersion: rawConcept.extractionVersion } : {}),
    };
    if (seen.has(normalized.key)) continue;
    seen.add(normalized.key);
    out.push(normalized);
    if (out.length >= MAX_CONCEPTS_PER_ITEM) break;
  }

  return out;
}

function fallbackConceptsFromKeywords(keywords: string[]): PreferenceConcept[] {
  return normalizePreferenceConcepts(
    keywords.map((label) => ({
      key: preferenceKey(label, "paper_keyword"),
      label,
      source: "paper_keyword",
    })),
  );
}

export function conceptsFromPaper(paper: Paper): PreferenceConcept[] {
  const direct = normalizePreferenceConcepts(paper.preferenceSignals ?? []);
  if (direct.length > 0) return direct;
  return fallbackConceptsFromKeywords(paper.summaryExperimentKeywords ?? []);
}

export function conceptsFromRawItem(item: RawItem): PreferenceConcept[] {
  const direct = normalizePreferenceConcepts(item.metadata.preferenceSignals ?? []);
  if (direct.length > 0) return direct;
  return fallbackConceptsFromKeywords(item.tags ?? []);
}

function conceptMatchesRequired(
  concept: PreferenceConcept | PreferenceLedgerEntry,
  requiredTopics: string[] = [],
): boolean {
  const label = normalizePreferenceLabel(concept.label);
  if (!label) return false;
  return requiredTopics.some((topic) => {
    const required = normalizePreferenceLabel(topic);
    return Boolean(
      required &&
        (label === required ||
          label.includes(required) ||
          required.includes(label)),
    );
  });
}

function decayedEntry(
  entry: PreferenceLedgerEntry,
  nowIso: string,
  nowMs: number,
): PreferenceLedgerEntry {
  const factor = decayFactor(entry.lastSeenAt, nowMs);
  const facetFactor = decayFactor(
    entry.lastFacetAt,
    nowMs,
    FACET_PREFERENCE_HALF_LIFE_DAYS,
  );
  if (factor === 1 && facetFactor === 1) {
    return { ...entry, lastSeenAt: nowIso };
  }
  return {
    ...entry,
    positive: entry.positive * factor,
    negative: entry.negative * factor,
    facetPositive:
      entry.facetPositive === undefined
        ? undefined
        : entry.facetPositive * facetFactor,
    lastSeenAt: nowIso,
  };
}

function cleanUploadEvidence(input: PreferenceLedgerEntry["uploads"]): NonNullable<PreferenceLedgerEntry["uploads"]> {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([key, value]) =>
    /^[a-f0-9]{64}$/.test(key) && value && Number.isFinite(Date.parse(value.at)) &&
    Number.isFinite(value.weight) && value.weight > 0,
  ).slice(-200).map(([key, value]) => [key, { at: value.at, weight: Math.min(2, value.weight) }]));
}

/** One document contributes once, including re-uploads and PDF supplements.
 * The separate evidence can be removed without erasing likes or dislikes. */
export function applyUploadPreferenceSignal(ledger: PreferenceLedger | undefined,
  concepts: PreferenceConcept[], documentKey: string, at = new Date().toISOString()): PreferenceLedger {
  const next = cleanPreferenceLedger(ledger);
  if (!/^[a-f0-9]{64}$/.test(documentKey)) return next;
  for (const concept of normalizePreferenceConcepts(concepts)) {
    const current = next[concept.key];
    if (current?.uploads?.[documentKey]) continue;
    next[concept.key] = {
      ...(current ?? { ...concept, positive: 0, negative: 0, lastSeenAt: at }),
      uploads: { ...current?.uploads, [documentKey]: { at, weight: 2 * (concept.confidence ?? 0.5) } },
    };
  }
  return next;
}

export function removeUploadPreferenceSignal(ledger: PreferenceLedger | undefined, documentKey: string): PreferenceLedger {
  const next = cleanPreferenceLedger(ledger);
  for (const [key, entry] of Object.entries(next)) {
    if (!entry.uploads?.[documentKey]) continue;
    const uploads = { ...entry.uploads };
    delete uploads[documentKey];
    if (!Object.keys(uploads).length && !entry.positive && !entry.negative && !entry.facetPositive) delete next[key];
    else next[key] = { ...entry, uploads };
  }
  return next;
}

/**
 * P5-02: the weight one settled question gives all its specific terms together.
 * An upload's concept enters at 2 x its confidence (0.9 at the least, 1.9 at the
 * most) and one explicit like adds 1; a question is the reader's own words but
 * one line, so it enters at a fifth of a like (about a quarter of an upload's
 * weakest). P5-04 (S4): that is the question's whole evidence, shared across its
 * specific terms (`QUESTION_TERM_WEIGHT / n` each), not a weight per term: at a
 * fifth per term a five-word question on a candidate holding all five words
 * outweighed a like. A question can now move a candidate's boost by about 0.013
 * at most, whatever its length, against a like's 0.05 (`POSITIVE_BOOST_MAX` 0.18,
 * 0.75 specificity), so one question cannot reorder a feed on its own, and it
 * takes several papers asking about the same word before the word counts for
 * much. The only new number of P5-02; every other ledger constant is as it was.
 */
export const QUESTION_TERM_WEIGHT = 0.2;

/** One specific term of a settled question and its share of the question's weight. */
export interface QuestionTerm {
  term: string;
  weight: number;
}

/**
 * An opaque, stable key for one paper's question evidence (FNV-1a over the
 * paper's id, 64 bits as 16 hex digits). The ledger syncs with the reader's
 * account, so the paper's id itself is not written into it; the key is only
 * there so one paper counts once and can be taken out again.
 */
export function questionSourceKey(paperId: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < paperId.length; i++) {
    const c = paperId.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c >>> 3) ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return "q" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function cleanedQuestionEvidence(input: PreferenceLedgerEntry["questions"]): { questions?: NonNullable<PreferenceLedgerEntry["questions"]> } {
  const kept = Object.entries(input ?? {}).filter(([key, value]) =>
    /^q[a-f0-9]{16}$/.test(key) && value && Number.isFinite(Date.parse(value.at)) &&
    Number.isFinite(value.weight) && value.weight > 0,
  ).slice(-200).map(([key, value]) => [key, { at: value.at, weight: Math.min(QUESTION_TERM_WEIGHT, value.weight) }] as const);
  return kept.length ? { questions: Object.fromEntries(kept) } : {};
}

/** The terms this paper's settled questions hold in the ledger (their labels). */
export function questionTermsOf(ledger: PreferenceLedger | undefined, paperId: string): string[] {
  const source = questionSourceKey(paperId);
  return Object.values(cleanPreferenceLedger(ledger)).filter((entry) => entry.questions?.[source]).map((entry) => entry.label);
}

/** The terms wanted as ledger concepts, each with its share (never above `QUESTION_TERM_WEIGHT`);
 *  a term given twice takes the larger share, one with no usable share is left out. */
function questionShares(terms: readonly QuestionTerm[]): Map<string, { concept: PreferenceConcept; weight: number }> {
  const shares = new Map<string, { concept: PreferenceConcept; weight: number }>();
  for (const { term, weight } of terms) {
    const [concept] = normalizePreferenceConcepts([{ ...termConcept(term), label: normalizePreferenceLabel(term) }]);
    const share = Math.min(QUESTION_TERM_WEIGHT, weight);
    if (!concept?.label || !(share > 0)) continue;
    const held = shares.get(concept.key);
    if (!held || share > held.weight) shares.set(concept.key, { concept, weight: share });
  }
  return shares;
}

/** Does the ledger already hold exactly these terms, at these shares, for the paper? */
export function holdsQuestionTerms(ledger: PreferenceLedger | undefined, paperId: string, terms: readonly QuestionTerm[]): boolean {
  const source = questionSourceKey(paperId);
  const wanted = questionShares(terms);
  const held = Object.values(cleanPreferenceLedger(ledger)).filter((entry) => entry.questions?.[source]);
  return held.length === wanted.size && held.every((entry) => wanted.get(entry.key)?.weight === entry.questions?.[source]?.weight);
}

/**
 * P5-02 (blueprint P5): the specific terms of a paper's settled questions
 * (`question-terms.ts`) as a low-weight signal of declared interest, through the
 * mechanism an upload's concepts use: separate evidence, once per source, that
 * can be taken out without erasing likes or dislikes. The paper's terms are
 * REPLACED: a term the reader's later questions no longer hold is removed, a
 * term already held keeps its first time (a repeated question counts once).
 * P5-04 (S4): each term enters at its share of its question's weight, so a
 * question is one signal however many terms it has; a held term whose share
 * changed (the question was edited) takes the new share.
 * Nothing but the terms is written; never the question.
 */
export function applyQuestionTermSignal(ledger: PreferenceLedger | undefined,
  paperId: string, terms: readonly QuestionTerm[], at = new Date().toISOString()): PreferenceLedger {
  const wanted = questionShares(terms);
  const source = questionSourceKey(paperId);
  const next = removeQuestionTermSignal(ledger, paperId, new Set(wanted.keys()));
  for (const [key, { concept, weight }] of wanted) {
    const current = next[key];
    const held = current?.questions?.[source];
    if (held && held.weight === weight) continue;
    next[key] = {
      ...(current ?? { ...concept, positive: 0, negative: 0, lastSeenAt: at }),
      questions: { ...current?.questions, [source]: { at: held?.at ?? at, weight } },
    };
  }
  return next;
}

/** The paper's question evidence out of every entry (except those in `keep`); an
 *  entry nothing else holds goes with it. Likes, dislikes, facets and uploads stay. */
export function removeQuestionTermSignal(ledger: PreferenceLedger | undefined, paperId: string,
  keep: ReadonlySet<string> = new Set()): PreferenceLedger {
  const next = cleanPreferenceLedger(ledger);
  const source = questionSourceKey(paperId);
  for (const [key, entry] of Object.entries(next)) {
    if (!entry.questions?.[source] || keep.has(key)) continue;
    const questions = { ...entry.questions };
    delete questions[source];
    const { questions: _gone, ...rest } = entry;
    void _gone;
    if (Object.keys(questions).length) next[key] = { ...rest, questions };
    else if (!entry.positive && !entry.negative && !entry.facetPositive && !Object.keys(entry.uploads ?? {}).length) delete next[key];
    else next[key] = rest;
  }
  return next;
}

export function uploadInterestTerms(ledger: PreferenceLedger | undefined, now = Date.now()): string[] {
  return Object.values(cleanPreferenceLedger(ledger)).filter((entry) => Object.keys(entry.uploads ?? {}).length > 0)
    .map((entry) => ({ entry, net: decayedCounts(entry, now).positive - decayedCounts(entry, now).negative }))
    .filter(({ net }) => net > 0.5).sort((a, b) => b.net - a.net).slice(0, 3).map(({ entry }) => entry.label);
}

export function cleanPreferenceLedger(
  input: PreferenceLedger | null | undefined,
): PreferenceLedger {
  if (!input || typeof input !== "object") return {};
  const out: PreferenceLedger = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== "object") continue;
    // `origin` is not part of the entry any more; an older build wrote it.
    const entry = raw as Partial<PreferenceLedgerEntry> & { origin?: unknown };
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    if (!label) continue;
    const source = entry.source ?? "paper_keyword";
    const normalizedKey =
      typeof entry.key === "string" && entry.key.trim()
        ? entry.key.trim()
        : key || preferenceKey(label, source);
    if (
      isLegacyOpportunityEntry(normalizedKey, entry.origin) ||
      isLegacyOpportunityEntry(key, undefined)
    ) {
      continue;
    }
    out[normalizedKey] = {
      key: normalizedKey,
      label,
      source,
      ...(typeof entry.section === "string" ? { section: entry.section.slice(0, 80) } : {}),
      ...(entry.facet === "method" || entry.facet === "material" || entry.facet === "topic"
        ? { facet: entry.facet } : {}),
      ...(typeof entry.extractionVersion === "number" ? { extractionVersion: entry.extractionVersion } : {}),
      confidence:
        typeof entry.confidence === "number"
          ? clamp01(entry.confidence)
          : undefined,
      positive:
        typeof entry.positive === "number" && Number.isFinite(entry.positive)
          ? Math.max(0, entry.positive)
          : 0,
      negative:
        typeof entry.negative === "number" && Number.isFinite(entry.negative)
          ? Math.max(0, entry.negative)
          : 0,
      lastPositiveAt:
        typeof entry.lastPositiveAt === "string"
          ? entry.lastPositiveAt
          : undefined,
      lastNegativeAt:
        typeof entry.lastNegativeAt === "string"
          ? entry.lastNegativeAt
          : undefined,
      facetPositive:
        typeof entry.facetPositive === "number" &&
        Number.isFinite(entry.facetPositive)
          ? Math.max(0, entry.facetPositive)
          : undefined,
      lastFacetAt:
        typeof entry.lastFacetAt === "string"
          ? entry.lastFacetAt
          : undefined,
      lastSeenAt:
        typeof entry.lastSeenAt === "string"
          ? entry.lastSeenAt
          : new Date().toISOString(),
      ...(entry.uploads ? { uploads: cleanUploadEvidence(entry.uploads) } : {}),
      ...cleanedQuestionEvidence(entry.questions),
      // Kept through cleaning, or the exemption it grants would vanish the
      // first time the ledger is normalised — on the server, every request.
      explicit: entry.explicit === true ? true : undefined,
    };
  }

  return out;
}

export function applyPreferenceSignal(
  ledger: PreferenceLedger | undefined,
  concepts: PreferenceConcept[],
  signal: PreferenceSignalKind,
  options: ApplyPreferenceSignalOptions = {},
): PreferenceLedger {
  const nowIso = options.at ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const clean = cleanPreferenceLedger(ledger);
  const next: PreferenceLedger = { ...clean };

  for (const concept of normalizePreferenceConcepts(concepts)) {
    if (
      signal === "negative" &&
      conceptMatchesRequired(concept, options.requiredTopics)
    ) {
      continue;
    }
    const current = next[concept.key];
    const base: PreferenceLedgerEntry = current
      ? decayedEntry(current, nowIso, safeNowMs)
      : {
          ...concept,
          positive: 0,
          negative: 0,
          lastSeenAt: nowIso,
        };

    next[concept.key] =
      signal === "positive"
        ? {
            ...base,
            ...concept,
            positive: base.positive + 1,
            lastPositiveAt: nowIso,
            lastSeenAt: nowIso,
          }
        : {
            ...base,
            ...concept,
            negative: base.negative + 1,
            lastNegativeAt: nowIso,
            lastSeenAt: nowIso,
          };
  }

  return next;
}

function conceptFrequencyKeys(concept: PreferenceConcept): string[] {
  return [concept.key, `label:${normalizePreferenceLabel(concept.label)}`];
}

export function buildPreferenceDocumentFrequency(
  items: RawItem[],
): PreferenceDocumentFrequency {
  const frequencies: PreferenceDocumentFrequency = new Map();
  for (const item of items) {
    const itemKeys = new Set<string>();
    for (const concept of conceptsFromRawItem(item)) {
      for (const key of conceptFrequencyKeys(concept)) itemKeys.add(key);
    }
    for (const key of itemKeys) {
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
  }
  return frequencies;
}

export interface PreparedLedger {
  byKey: PreferenceLedger;
  byLabel: Map<string, PreferenceLedgerEntry[]>;
  size: number;
}

/**
 * Clean + index a ledger ONCE so the per-item scorer does O(1) key/label lookups
 * instead of cleaning the whole ledger and scanning every entry for every concept
 * of every candidate paper (which was O(items × concepts × ledger)).
 */
export function prepareLedger(
  ledger: PreferenceLedger | null | undefined,
): PreparedLedger {
  const clean = cleanPreferenceLedger(ledger);
  const byLabel = new Map<string, PreferenceLedgerEntry[]>();
  for (const entry of Object.values(clean)) {
    const label = normalizePreferenceLabel(entry.label);
    if (!label) continue;
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(entry);
    else byLabel.set(label, [entry]);
  }
  return { byKey: clean, byLabel, size: Object.keys(clean).length };
}

function lookupLedgerEntries(
  prepared: PreparedLedger,
  concept: PreferenceConcept,
): PreferenceLedgerEntry[] {
  const matches: PreferenceLedgerEntry[] = [];
  const seen = new Set<string>();
  const exact = prepared.byKey[concept.key];
  if (exact) {
    seen.add(exact.key);
    matches.push(exact);
  }
  // Also match by normalized label so a text-keyed entry and an OpenAlex-keyed
  // entry for the same concept name bridge across sources.
  const labelMatches = prepared.byLabel.get(normalizePreferenceLabel(concept.label));
  if (labelMatches) {
    for (const entry of labelMatches) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      matches.push(entry);
    }
  }
  return matches;
}

function distinctiveness(
  concept: PreferenceConcept,
  documentFrequency: PreferenceDocumentFrequency | undefined,
  corpusSize: number,
): number {
  if (!documentFrequency || corpusSize <= 1) return 0.75;
  const keys = conceptFrequencyKeys(concept);
  const df = Math.max(...keys.map((key) => documentFrequency.get(key) ?? 0), 1);
  const rawIdf = Math.log((corpusSize + 1) / (df + 1)) / Math.log(corpusSize + 1);
  return 0.35 + 0.65 * clamp01(rawIdf);
}

function decayedCounts(
  entry: PreferenceLedgerEntry,
  nowMs: number,
  withQuestions = true,
): { positive: number; negative: number } {
  const factor = decayFactor(entry.lastSeenAt, nowMs);
  const evidenceSum = (evidence: PreferenceLedgerEntry["uploads"]) =>
    Object.values(evidence ?? {}).reduce((total, e) => total + e.weight * decayFactor(e.at, nowMs), 0);
  return {
    positive: entry.positive * factor + evidenceSum(entry.uploads) +
      (withQuestions ? evidenceSum(entry.questions) : 0),
    negative: entry.negative * factor,
  };
}

export function scorePreferenceMatch(
  item: RawItem,
  prepared: PreparedLedger | undefined,
  requiredTopics: string[] = [],
  options: {
    now?: number;
    documentFrequency?: PreferenceDocumentFrequency;
    corpusSize?: number;
  } = {},
): PreferenceMatchScore {
  if (!prepared || prepared.size === 0) {
    return {
      boost: 0,
      penalty: 1,
      matchedPositive: [],
      matchedNegative: [],
    };
  }

  const now = options.now ?? Date.now();
  let boost = 0;
  let penaltyLoss = 0;
  const matchedPositive = new Set<string>();
  const matchedNegative = new Set<string>();

  const concepts = conceptsFromRawItem(item);
  // Uploaded phrases have no OpenAlex taxonomy ID. Match their actual words
  // in candidate titles/abstracts too, using boundaries rather than substrings.
  const text = ` ${normalizePreferenceLabel([item.title, item.abstract, ...(item.tags ?? [])].filter(Boolean).join(" "))} `;
  const seenLabels = new Set(concepts.map((c) => normalizePreferenceLabel(c.label)));
  for (const entry of Object.values(prepared.byKey)) {
    const label = normalizePreferenceLabel(entry.label);
    if ((entry.uploads || entry.questions) && label && !seenLabels.has(label) && text.includes(` ${label} `)) {
      concepts.push(entry); seenLabels.add(label);
    }
  }
  for (const concept of concepts) {
    const entries = lookupLedgerEntries(prepared, concept);
    if (entries.length === 0) continue;
    const specificity = distinctiveness(
      concept,
      options.documentFrequency,
      options.corpusSize ?? 0,
    );

    for (const entry of entries) {
      const { positive, negative } = decayedCounts(entry, now);
      const net = positive - negative;
      if (net > 0.05) {
        const magnitude = 1 - Math.exp(-net / 2);
        boost += POSITIVE_BOOST_MAX * magnitude * specificity;
        matchedPositive.add(entry.label);
      } else if (
        net < -0.05 &&
        (entry.explicit === true ||
          !conceptMatchesRequired(concept, requiredTopics))
      ) {
        const magnitude = 1 - Math.exp(-Math.abs(net) / 2);
        penaltyLoss += NEGATIVE_PENALTY_MAX * magnitude * specificity;
        matchedNegative.add(entry.label);
      }
    }
  }

  return {
    boost: Math.min(POSITIVE_BOOST_MAX, boost),
    penalty: Math.max(1 - NEGATIVE_PENALTY_MAX, 1 - Math.min(NEGATIVE_PENALTY_MAX, penaltyLoss)),
    matchedPositive: Array.from(matchedPositive),
    matchedNegative: Array.from(matchedNegative),
  };
}

export function feedbackSnapshotForPaper(paper: Paper) {
  return {
    title: paper.title,
    concepts: conceptsFromPaper(paper),
  };
}

export interface LedgerSummaryRow {
  label: string;
  /** Decayed net strength (always positive in its list). */
  weight: number;
  /**
   * 9-24 (A9-12): true when at least one ledger entry aggregated into this
   * row carries `uploads` evidence — the profile screen uses this to caption
   * the entry "from your upload" so a signal's source is never a mystery.
   */
  fromUpload: boolean;
}

/**
 * Human-facing summary of what the ledger has learned, for the profile screen.
 * Aggregates entries by normalized label (so duplicate surface forms collapse),
 * applies time decay, and splits into "leaning toward" vs "easing off".
 */
export function summarizePreferenceLedger(
  ledger: PreferenceLedger | null | undefined,
  now: number = Date.now(),
  limit = 6,
): { liked: LedgerSummaryRow[]; disliked: LedgerSummaryRow[] } {
  const clean = cleanPreferenceLedger(ledger);
  const byLabel = new Map<string, { label: string; net: number; fromUpload: boolean }>();
  for (const entry of Object.values(clean)) {
    const key = normalizePreferenceLabel(entry.label);
    if (!key) continue;
    // P5-02: what a question holds is not shown as something the ledger learned.
    const { positive, negative } = decayedCounts(entry, now, false);
    const net = positive - negative;
    const fromUpload = Object.keys(entry.uploads ?? {}).length > 0;
    const prev = byLabel.get(key);
    if (prev) { prev.net += net; prev.fromUpload = prev.fromUpload || fromUpload; }
    else byLabel.set(key, { label: entry.label, net, fromUpload });
  }
  const rows = Array.from(byLabel.values());
  const liked = rows
    .filter((r) => r.net > 0.05)
    .sort((a, b) => b.net - a.net)
    .slice(0, limit)
    .map((r) => ({ label: r.label, weight: r.net, fromUpload: r.fromUpload }));
  const disliked = rows
    .filter((r) => r.net < -0.05)
    .sort((a, b) => a.net - b.net)
    .slice(0, limit)
    .map((r) => ({ label: r.label, weight: -r.net, fromUpload: r.fromUpload }));
  return { liked, disliked };
}

export type TermLean = "more" | "less";

/** The concept a term on the reading graph stands for. Text-keyed: the
 *  ledger's lookup bridges by normalised label, so it reaches papers carrying
 *  the same term under an OpenAlex id as well. */
export function termConcept(label: string): PreferenceConcept {
  return { key: preferenceKey(label, "paper_keyword"), label, source: "paper_keyword" };
}

/**
 * A deliberate lean on one term, or none. Writes a single explicit entry worth
 * two likes (or two dismissals) — enough to move the briefing, not enough to
 * drown the reader's own topics — and replaces whatever lean was there, so
 * "more" after "less" means more, not neutral. `null` removes the lean. It
 * decays like any other evidence; a lean nobody renews fades over months.
 */
export function setTermLean(
  ledger: PreferenceLedger | undefined,
  label: string,
  lean: TermLean | null,
  at: string = new Date().toISOString(),
): PreferenceLedger {
  const next = { ...cleanPreferenceLedger(ledger) };
  const concept = termConcept(label);
  if (lean === null) {
    delete next[concept.key];
    return next;
  }
  next[concept.key] = {
    ...concept,
    explicit: true,
    positive: lean === "more" ? 2 : 0,
    negative: lean === "less" ? 2 : 0,
    lastPositiveAt: lean === "more" ? at : undefined,
    lastNegativeAt: lean === "less" ? at : undefined,
    lastSeenAt: at,
  };
  return next;
}

/** The lean the reader set on a term, if any. */
export function termLean(ledger: PreferenceLedger | undefined, label: string): TermLean | null {
  const entry = ledger?.[termConcept(label).key];
  if (!entry?.explicit) return null;
  if (entry.positive > entry.negative) return "more";
  if (entry.negative > entry.positive) return "less";
  return null;
}
