import type { RawItem } from "@/lib/sources/types";
import type {
  ScoringProfile,
  ScoreWeights,
  ScoredItem,
  ScoreBreakdown,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";
import { scoreKeyword } from "./keyword";
import { buildIndex, scoreTfidf } from "./tfidf";
import { scoreRecency } from "./recency";
import { scoreSource } from "./source-weight";
import { generateReason } from "./reason";
import { shouldPushReviewPaper } from "./review-policy";
import { normalizePhrase } from "./tokenize";
import { canonicalize } from "./term-expand";
import {
  buildPreferenceDocumentFrequency,
  prepareLedger,
  scorePreferenceMatch,
} from "@/lib/preferences/ledger";

function profileText(profile: ScoringProfile): string {
  return [
    ...profile.topics,
    ...(profile.methods ?? []),
    ...(profile.venues ?? []),
    ...(profile.seedTexts ?? []),
  ].join(" ");
}

function normalizeWeights(w: ScoreWeights): ScoreWeights {
  const sum = w.keyword + w.tfidf + w.recency + w.source;
  if (sum <= 0) return DEFAULT_WEIGHTS;
  return {
    keyword: w.keyword / sum,
    tfidf: w.tfidf / sum,
    recency: w.recency / sum,
    source: w.source / sum,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Each value's place among the others, 0…1 — the share of the pool it beats.
 *
 * Ties share a value (every paper with no overlap at all sits at 0 together),
 * and one candidate is simply the most relevant one there is.
 */
export function poolPercentile(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    // Number of strictly smaller values, by binary search over the sorted copy.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (n - 1);
  });
}

function topicMatchesItem(item: RawItem, topic: string): boolean {
  const needle = normalizePhrase(topic);
  if (!needle) return false;
  const haystack = [item.title, item.abstract ?? "", (item.tags ?? []).join(" ")]
    .join(" ").toLowerCase();
  return haystack.includes(needle);
}

function isProtectedRequiredTopic(topic: string, requiredTopics: string[]): boolean {
  const needle = normalizePhrase(topic);
  if (!needle) return false;
  return requiredTopics.some((requiredTopic) => {
    const required = normalizePhrase(requiredTopic);
    return Boolean(
      required &&
        (needle === required ||
          needle.includes(required) ||
          required.includes(needle)),
    );
  });
}

function negativePenalty(item: RawItem, negativeTopics: string[]): number {
  if (negativeTopics.length === 0) return 1;
  const hit = negativeTopics.some((t) => topicMatchesItem(item, t));
  return hit ? 0.15 : 1;
}

function legacyDislikePenalty(
  item: RawItem,
  legacyNegativeTopics: string[],
  requiredTopics: string[],
): number {
  if (legacyNegativeTopics.length === 0) return 1;
  const hit = legacyNegativeTopics.some((t) => {
    if (isProtectedRequiredTopic(t, requiredTopics)) return false;
    return topicMatchesItem(item, t);
  });
  return hit ? 0.65 : 1;
}

export function scoreItems(
  items: RawItem[],
  profile: ScoringProfile,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  now = Date.now(),
): ScoredItem[] {
  if (items.length === 0) return [];
  const w = normalizeWeights(weights);
  const index = buildIndex(items);
  const pText = profileText(profile);
  const preferenceDocumentFrequency = buildPreferenceDocumentFrequency(items);
  // Clean + index the ledger once for the whole batch (was re-cleaned + scanned
  // per item before).
  const preparedLedger = prepareLedger(profile.preferenceLedger);

  const mustTopics = profile.topics;
  const selectedSenseConcepts = profile.selectedSenseConcepts ?? [];
  // A bare conflict/SEM is user free text, not a selected global sense. Once
  // a typed selection exists, do not let that ambiguous literal independently
  // open the required gate for a competing domain.
  const literalMustTopics = selectedSenseConcepts.length > 0
    ? mustTopics.filter((topic) => !["conflict", "sem"].includes(canonicalize(topic)))
    : mustTopics;
  const softTopics = profile.softTopics ?? [];
  const exclusions = profile.exclusions ?? [];

  // Pass 1: everything that can be judged from the paper alone.
  const passed: {
    item: RawItem;
    kw: ReturnType<typeof scoreKeyword>;
    softKw: ReturnType<typeof scoreKeyword>;
    tf: number;
  }[] = [];
  for (const item of items) {
    if (exclusions.some((term) => topicMatchesItem(item, term))) continue;
    if (profile.minPublishedAt && item.publishedAt < profile.minPublishedAt) continue;
    const kw = scoreKeyword(item, literalMustTopics, { grounded: true, selectedSenseConcepts });
    // P2-S3 — UNION of the item-level tag and the older, request-scoped
    // `profile.admissionChannels` lookup, not one overriding the other.
    // The item-level tag travels WITH the item through dedupe and the
    // cache, so it is still readable at a read-time rescore on a cache hit
    // and from the scheduled-digest path, neither of which shares this
    // call's `profile` with whichever build first tagged the item
    // (ABC-JEV-INTEGRATION.md §1p.A/G, F-A-P2-03). It must be a union rather
    // than "item-level wins, else profile": `buildPaperPool` now tags every
    // plain keyword-source item "keyword" too (so a dedupe merge with a
    // citation-admitted copy of the same paper keeps both channels — see
    // dedup.ts) — if that were allowed to eclipse `profile.admissionChannels`
    // entirely, an item a keyword source happened to fetch would silently
    // lose a legitimate request-scoped semantic/positive-seed/topic-field
    // tag declared for that same item id (regression caught by
    // paper-daily-cache.test.ts's "applies typed sense admission..." case).
    // Both sides are keyed by/attached to this exact item, so a union never
    // admits a different item — it only ever adds true information about
    // this one.
    const channels = [
      ...(item.admissionChannels ?? []),
      ...(profile.admissionChannels?.[item.id] ?? []),
    ];
    const admittedByNonLiteralChannel = channels.some((channel) =>
      channel === "semantic" || channel === "positive-seed" || channel === "citation" || channel === "topic-field",
    );
    // Required literals route/score candidate discovery. They cannot evict a
    // candidate already admitted by another declared retrieval channel.
    if ((literalMustTopics.length > 0 || selectedSenseConcepts.length > 0) && kw.score === 0 && !admittedByNonLiteralChannel) continue;
    passed.push({
      item,
      kw,
      softKw: scoreKeyword(item, softTopics, { grounded: true }),
      tf: clamp01(scoreTfidf(item.id, pText, index)),
    });
  }

  // Pass 2: relevance is only meaningful against the rest of the day, so the
  // pool has to be complete before anything can be ranked. The gate above
  // decides the pool: a paper that matched no required topic is not a
  // yardstick for the ones that did.
  const topicality = poolPercentile(passed.map((p) => p.tf));

  const scored: ScoredItem[] = [];
  passed.forEach(({ item, kw, softKw, tf }, i) => {
    const tp = topicality[i];
    const rc = clamp01(scoreRecency(item.publishedAt, now));
    const sr = clamp01(scoreSource(item.source, profile.sourceWeights));
    const policyPenalty = negativePenalty(item, profile.negativeTopics ?? []);
    const legacyPenalty = legacyDislikePenalty(
      item,
      profile.legacyNegativeTopics ?? [],
      mustTopics,
    );
    const preference = scorePreferenceMatch(
      item,
      preparedLedger,
      mustTopics,
      {
        now,
        documentFrequency: preferenceDocumentFrequency,
        corpusSize: items.length,
      },
    );
    // Soft topics add up to +0.18 bonus so papers the user is curious about
    // float above equal-relevance papers that lack those terms.
    const softBonus = softTopics.length > 0 ? softKw.score * 0.18 : 0;
    const base = w.keyword * kw.score + w.tfidf * tp + w.recency * rc + w.source * sr;
    const combined = clamp01(
      base * policyPenalty * legacyPenalty * preference.penalty +
        softBonus +
        preference.boost,
    );
    const breakdown: ScoreBreakdown = {
      keyword: kw.score,
      tfidf: tf,
      topicality: tp,
      recency: rc,
      source: sr,
      combined,
    };
    scored.push({
      ...item,
      score: combined,
      scoreBreakdown: breakdown,
      matchedKeywords: kw.matched,
      relevanceReason: generateReason(item, kw.matched, breakdown),
    });
  });

  return scored
    .filter((item) => shouldPushReviewPaper(item, profile.seedTexts))
    .sort((a, b) => b.score - a.score);
}
