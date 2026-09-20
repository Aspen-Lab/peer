import type {
  Event,
  FeedItemKind,
  Job,
  OpportunityFacetSelection,
  Paper,
  PreferenceConcept,
  PreferenceConceptSource,
  PreferenceLedger,
  PreferenceLedgerEntry,
} from "@/types";
import type { RawItem } from "@/lib/sources/types";
import {
  opportunityFacetValues,
  type FacetableOpportunity,
  type FacetSurface,
} from "@/lib/opportunities/facets";

const HALF_LIFE_DAYS = 60;
export const FACET_PREFERENCE_HALF_LIFE_DAYS = 14;
const MAX_CONCEPTS_PER_ITEM = 16;
const POSITIVE_BOOST_MAX = 0.18;
export const FACET_PREFERENCE_BOOST_MAX = 0.04;
// Heavier than the original 0.45: a concept you've repeatedly rejected drops to
// ×0.40 of base, so persistent dislikes are genuinely suppressed. A single
// dislike stays gentle thanks to the saturating curve below. Tunable.
const NEGATIVE_PENALTY_MAX = 0.6;

type PreferenceSignalKind = "positive" | "negative";

interface ApplyPreferenceSignalOptions {
  at?: string;
  requiredTopics?: string[];
  /**
   * Surface the feedback came from. Non-paper origins are stored under
   * namespaced keys (`job|…` / `event|…`) so the same concept can carry
   * independent evidence per surface. Defaults to "paper" (legacy shape,
   * un-namespaced keys).
   */
  origin?: FeedItemKind;
}

interface ApplyOpportunityFacetSignalOptions {
  at?: string;
  origin: Exclude<FeedItemKind, "paper">;
}

export type OpportunityFacetGroup = keyof OpportunityFacetSelection;

/**
 * Directional influence matrix: how strongly an entry recorded on `origin`
 * counts when scoring items of `target`. Papers are the ground truth of the
 * user's research identity, so paper feedback flows into events (strongly —
 * same academic sphere) and jobs (moderately). Academic-event feedback leaks
 * weakly into jobs. Nothing flows back into papers, and job feedback stays
 * job-only, per product decision (2026-07).
 */
const ORIGIN_INFLUENCE: Record<FeedItemKind, Record<FeedItemKind, number>> = {
  paper: { paper: 1, event: 0, job: 0 },
  event: { paper: 0.8, event: 1, job: 0 },
  job: { paper: 0.5, event: 0.25, job: 1 },
};

/** Influence of an entry with `origin` on items of kind `target`. */
export function originInfluence(
  target: FeedItemKind,
  origin: FeedItemKind | undefined,
): number {
  return ORIGIN_INFLUENCE[target][origin ?? "paper"];
}

function entryOrigin(entry: PreferenceLedgerEntry): FeedItemKind {
  return entry.origin ?? "paper";
}

function namespacedKey(key: string, origin: FeedItemKind): string {
  return origin === "paper" ? key : `${origin}|${key}`;
}

export interface PreferenceMatchScore {
  boost: number;
  facetBoost: number;
  penalty: number;
  matchedPositive: string[];
  matchedFacetPositive: string[];
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

export function opportunityFacetPreferenceConcept(
  group: OpportunityFacetGroup,
  value: string,
): PreferenceConcept | undefined {
  const label = value.trim().replace(/\s+/g, " ");
  const normalized = normalizePreferenceLabel(label);
  if (!normalized) return undefined;
  return {
    key: `facet:${group}:${normalized}`,
    label,
    source: "opportunity_facet",
  };
}

export function opportunityFacetPreferenceConcepts(
  surface: FacetSurface,
  item: FacetableOpportunity,
): PreferenceConcept[] {
  const values = opportunityFacetValues(surface, item);
  const formats =
    values.format === "hybrid"
      ? ["hybrid", "online", "in-person"]
      : [values.format];
  return normalizePreferenceConcepts([
    opportunityFacetPreferenceConcept("location", values.location ?? ""),
    opportunityFacetPreferenceConcept("month", values.month ?? ""),
    ...formats.map((format) =>
      opportunityFacetPreferenceConcept("format", format),
    ),
  ]);
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

export function conceptsFromJob(job: Job): PreferenceConcept[] {
  const direct = normalizePreferenceConcepts(job.preferenceSignals ?? []);
  if (direct.length > 0) return direct;
  return normalizePreferenceConcepts(
    (job.keyRequirements ?? []).map((label) => ({
      key: preferenceKey(label, "job_tag"),
      label,
      source: "job_tag" as const,
    })),
  );
}

export function conceptsFromEvent(event: Event): PreferenceConcept[] {
  const direct = normalizePreferenceConcepts(event.preferenceSignals ?? []);
  if (direct.length > 0) return direct;
  // Fallback: the event name itself. Too specific to generalize much, but a
  // dismissal of "NeurIPS 2026" should at least suppress re-surfacing it.
  return normalizePreferenceConcepts([
    {
      key: preferenceKey(event.name, "event_topic"),
      label: event.name,
      source: "event_topic" as const,
    },
  ]);
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
    const entry = raw as Partial<PreferenceLedgerEntry>;
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    if (!label) continue;
    const source = entry.source ?? "paper_keyword";
    const normalizedKey =
      typeof entry.key === "string" && entry.key.trim()
        ? entry.key.trim()
        : key || preferenceKey(label, source);
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
      origin:
        entry.origin === "event" || entry.origin === "job"
          ? entry.origin
          : undefined,
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
  const origin = options.origin ?? "paper";
  const clean = cleanPreferenceLedger(ledger);
  const next: PreferenceLedger = { ...clean };

  for (const concept of normalizePreferenceConcepts(concepts)) {
    // Required-topic protection only guards the paper surface: dismissing ML
    // *jobs* must be allowed to suppress ML jobs even when ML is a required
    // research topic (job entries never flow back into paper scoring anyway).
    if (
      signal === "negative" &&
      origin === "paper" &&
      conceptMatchesRequired(concept, options.requiredTopics)
    ) {
      continue;
    }
    const storageKey = namespacedKey(concept.key, origin);
    const current = next[storageKey];
    const base: PreferenceLedgerEntry = current
      ? decayedEntry(current, nowIso, safeNowMs)
      : {
          ...concept,
          positive: 0,
          negative: 0,
          lastSeenAt: nowIso,
        };

    next[storageKey] =
      signal === "positive"
        ? {
            ...base,
            ...concept,
            key: storageKey,
            origin: origin === "paper" ? undefined : origin,
            positive: base.positive + 1,
            lastPositiveAt: nowIso,
            lastSeenAt: nowIso,
          }
        : {
            ...base,
            ...concept,
            key: storageKey,
            origin: origin === "paper" ? undefined : origin,
            negative: base.negative + 1,
            lastNegativeAt: nowIso,
            lastSeenAt: nowIso,
          };
  }

  return next;
}

/**
 * Store a facet click in the existing preference ledger without promoting it
 * to explicit save/like evidence. Event and job namespaces stay independent.
 */
export function applyOpportunityFacetPreferenceSignal(
  ledger: PreferenceLedger | undefined,
  group: OpportunityFacetGroup,
  value: string,
  options: ApplyOpportunityFacetSignalOptions,
): PreferenceLedger {
  const concept = opportunityFacetPreferenceConcept(group, value);
  if (!concept) return cleanPreferenceLedger(ledger);

  const nowIso = options.at ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const clean = cleanPreferenceLedger(ledger);
  const next: PreferenceLedger = { ...clean };
  const storageKey = namespacedKey(concept.key, options.origin);
  const current = next[storageKey];
  const base: PreferenceLedgerEntry = current
    ? decayedEntry(current, nowIso, safeNowMs)
    : {
        ...concept,
        positive: 0,
        negative: 0,
        lastSeenAt: nowIso,
      };

  next[storageKey] = {
    ...base,
    ...concept,
    key: storageKey,
    origin: options.origin,
    facetPositive: (base.facetPositive ?? 0) + 1,
    lastFacetAt: nowIso,
    lastSeenAt: nowIso,
  };
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
  // Exact key hits across every origin namespace (paper entries are stored
  // un-namespaced; event/job entries under `event|…` / `job|…`).
  for (const key of [
    concept.key,
    namespacedKey(concept.key, "event"),
    namespacedKey(concept.key, "job"),
  ]) {
    const entry = prepared.byKey[key];
    if (entry && !seen.has(entry.key)) {
      seen.add(entry.key);
      matches.push(entry);
    }
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
): { positive: number; negative: number } {
  const factor = decayFactor(entry.lastSeenAt, nowMs);
  return {
    positive: entry.positive * factor + Object.values(entry.uploads ?? {}).reduce(
      (total, evidence) => total + evidence.weight * decayFactor(evidence.at, nowMs), 0),
    negative: entry.negative * factor,
  };
}

function decayedFacetPositive(
  entry: PreferenceLedgerEntry,
  nowMs: number,
): number {
  return (
    (entry.facetPositive ?? 0) *
    decayFactor(
      entry.lastFacetAt,
      nowMs,
      FACET_PREFERENCE_HALF_LIFE_DAYS,
    )
  );
}

export function scorePreferenceMatch(
  item: RawItem,
  prepared: PreparedLedger | undefined,
  requiredTopics: string[] = [],
  options: {
    now?: number;
    documentFrequency?: PreferenceDocumentFrequency;
    corpusSize?: number;
    /**
     * The surface being scored. Controls how much each ledger entry counts
     * via the directional influence matrix. Defaults to "paper", which zeroes
     * out event/job entries — existing paper scoring is unaffected.
     */
    targetKind?: FeedItemKind;
  } = {},
): PreferenceMatchScore {
  if (!prepared || prepared.size === 0) {
    return {
      boost: 0,
      facetBoost: 0,
      penalty: 1,
      matchedPositive: [],
      matchedFacetPositive: [],
      matchedNegative: [],
    };
  }

  const now = options.now ?? Date.now();
  const targetKind = options.targetKind ?? "paper";
  let boost = 0;
  let facetBoost = 0;
  let penaltyLoss = 0;
  const matchedPositive = new Set<string>();
  const matchedFacetPositive = new Set<string>();
  const matchedNegative = new Set<string>();

  const concepts = conceptsFromRawItem(item);
  // Uploaded phrases have no OpenAlex taxonomy ID. Match their actual words
  // in candidate titles/abstracts too, using boundaries rather than substrings.
  const text = ` ${normalizePreferenceLabel([item.title, item.abstract, ...(item.tags ?? [])].filter(Boolean).join(" "))} `;
  const seenLabels = new Set(concepts.map((c) => normalizePreferenceLabel(c.label)));
  for (const entry of Object.values(prepared.byKey)) {
    const label = normalizePreferenceLabel(entry.label);
    if (entry.uploads && label && !seenLabels.has(label) && text.includes(` ${label} `)) {
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
      const influence = originInfluence(targetKind, entryOrigin(entry));
      if (influence <= 0) continue;
      const { positive, negative } = decayedCounts(entry, now);
      const net = positive - negative;
      if (net > 0.05) {
        const magnitude = 1 - Math.exp(-net / 2);
        boost += POSITIVE_BOOST_MAX * magnitude * specificity * influence;
        matchedPositive.add(entry.label);
      } else if (
        net < -0.05 &&
        // Required-topic protection guards the paper feed only; on job/event
        // surfaces a repeatedly-dismissed core topic should genuinely sink.
        (targetKind !== "paper" || !conceptMatchesRequired(concept, requiredTopics))
      ) {
        const magnitude = 1 - Math.exp(-Math.abs(net) / 2);
        penaltyLoss += NEGATIVE_PENALTY_MAX * magnitude * specificity * influence;
        matchedNegative.add(entry.label);
      }

      const facetPositive = decayedFacetPositive(entry, now);
      const facetInfluence =
        targetKind !== "paper" && entryOrigin(entry) === targetKind ? 1 : 0;
      if (facetPositive > 0.05 && facetInfluence > 0) {
        const magnitude = 1 - Math.exp(-facetPositive / 2);
        facetBoost +=
          FACET_PREFERENCE_BOOST_MAX *
          magnitude *
          specificity *
          facetInfluence;
        matchedFacetPositive.add(entry.label);
      }
    }
  }

  const cappedFacetBoost =
    matchedNegative.size > 0
      ? 0
      : Math.min(FACET_PREFERENCE_BOOST_MAX, facetBoost);
  return {
    boost: Math.min(POSITIVE_BOOST_MAX, boost) + cappedFacetBoost,
    facetBoost: cappedFacetBoost,
    penalty: Math.max(1 - NEGATIVE_PENALTY_MAX, 1 - Math.min(NEGATIVE_PENALTY_MAX, penaltyLoss)),
    matchedPositive: Array.from(matchedPositive),
    matchedFacetPositive:
      cappedFacetBoost > 0 ? Array.from(matchedFacetPositive) : [],
    matchedNegative: Array.from(matchedNegative),
  };
}

export function materiallyChangedByFacetPreference(
  baselineIndex: number,
  finalIndex: number,
  topN = 10,
): boolean {
  if (baselineIndex < 0 || finalIndex < 0 || finalIndex >= baselineIndex) {
    return false;
  }
  return (
    baselineIndex - finalIndex >= 2 ||
    (baselineIndex >= topN && finalIndex < topN)
  );
}

export function facetPreferenceReason(
  matchedLabels: string[],
): string | undefined {
  const label = matchedLabels.find((value) => value.trim())?.trim();
  return label ? `Because you often view ${label}` : undefined;
}

export function feedbackSnapshotForPaper(paper: Paper) {
  return {
    title: paper.title,
    concepts: conceptsFromPaper(paper),
  };
}

export function feedbackSnapshotForJob(job: Job) {
  return {
    title: [job.roleTitle, job.companyOrLab].filter(Boolean).join(" — "),
    concepts: conceptsFromJob(job),
  };
}

export function feedbackSnapshotForEvent(event: Event) {
  return {
    title: event.name,
    concepts: conceptsFromEvent(event),
  };
}

export interface LedgerSummaryRow {
  label: string;
  /** Decayed net strength (always positive in its list). */
  weight: number;
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
  const byLabel = new Map<string, { label: string; net: number }>();
  for (const entry of Object.values(clean)) {
    const key = normalizePreferenceLabel(entry.label);
    if (!key) continue;
    const { positive, negative } = decayedCounts(entry, now);
    const net = positive - negative;
    const prev = byLabel.get(key);
    if (prev) prev.net += net;
    else byLabel.set(key, { label: entry.label, net });
  }
  const rows = Array.from(byLabel.values());
  const liked = rows
    .filter((r) => r.net > 0.05)
    .sort((a, b) => b.net - a.net)
    .slice(0, limit)
    .map((r) => ({ label: r.label, weight: r.net }));
  const disliked = rows
    .filter((r) => r.net < -0.05)
    .sort((a, b) => a.net - b.net)
    .slice(0, limit)
    .map((r) => ({ label: r.label, weight: -r.net }));
  return { liked, disliked };
}
