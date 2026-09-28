import type { RawItem } from "@/lib/sources/types";
import type {
  ScoringProfile,
  ScoreWeights,
  ScoredItem,
  ScoreBreakdown,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";
import {
  scoreKeyword,
  isShortOrAmbiguous,
  senseContextGate,
  selfDeclaresDifferentSense,
  SENSE_CONTEXT_DEMOTED_GROUNDING,
} from "./keyword";
import { buildIndex, scoreTfidf } from "./tfidf";
import { scoreRecency } from "./recency";
import { scoreSource } from "./source-weight";
import { generateReason } from "./reason";
import { shouldPushReviewPaper } from "./review-policy";
import { normalizePhrase } from "./tokenize";
import { canonicalize, termSpecificity } from "./term-expand";
import {
  buildPreferenceDocumentFrequency,
  prepareLedger,
  scorePreferenceMatch,
} from "@/lib/preferences/ledger";

/**
 * T4 (REQUIRED-GATE, ABC-JEV-INTEGRATION.md §1ao.1/§1ao.3) — tag-anchored
 * topical-similarity floors and ranking weight for the case where a
 * candidate matches no Required tag by T1 (literal)/T2 (self-declared
 * abbreviation)/T3 (source subject tag). Named and grep-able per the
 * ruling. Measured starting point (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md
 * §2.4, re-confirmed with tag-anchoring in
 * docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md §1): at these floors the
 * EMPTY-HOME-diagnosed case goes from 4/27 to 17/27 qualifying and the
 * measured biofilm/clinical false positive (an unanchored `simProject`
 * alone would have admitted it) is rejected.
 */
export const REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC = 0.15;
export const REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT = 0.05;
export const REQUIRED_TAG_T4_WEIGHT = 0.3;

function profileText(profile: ScoringProfile): string {
  return [
    ...profile.topics,
    ...(profile.methods ?? []),
    ...(profile.venues ?? []),
    ...(profile.seedTexts ?? []),
  ].join(" ");
}

/**
 * SENSE-CONTEXT (ABC-JEV-INTEGRATION.md §1ap AMENDMENT 2(i)) — the reader's
 * declared WORK only: project/challenge/advisor seed texts (`seedTexts`),
 * `methods`, `venues`. Deliberately excludes `profile.topics` — a reader's
 * OTHER Required tags must never count as each other's context. A real
 * regression, found live in ranking.test.ts, motivated this: with two
 * short, topically unrelated Required tags and no project text declared,
 * `profileText()` (above) made each tag the other's only "context," so
 * genuine matches for one topic got demoted for not relating to the other.
 * Also excludes `softTopics` (Explore tags) — never wired into the papers
 * `ScoringProfile` at all (confirmed by reading `pipeline.ts` in the
 * SENSE-CONTEXT investigation), so there is nothing to exclude in code, only
 * to not add. Reused by both `scoreKeyword`'s `senseContext` opts (below)
 * and the T4 loop's own gate check — the SAME text, so a tag's demote
 * threshold and its T4 admission threshold are judged against identical
 * context.
 */
function senseContextText(profile: ScoringProfile): string {
  return [
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
  const workText = senseContextText(profile);
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
    let kw = scoreKeyword(item, literalMustTopics, {
      grounded: true,
      selectedSenseConcepts,
      // REQUIRED-GATE §1ao — T2/T3 on for the Required gate only (never for
      // softTopics below, which is a ranking bonus, not the qualification
      // screen). See keyword.ts's own doc comment on this flag for why it
      // must default off for every other `scoreKeyword` caller.
      extendedRequiredMatch: true,
      // SENSE-CONTEXT §1ap + AMENDMENT 2(i)/4 — `workText` (declared work
      // only — NOT `pText`, which also carries every other Required topic
      // and would let a reader's own unrelated tags count against each
      // other). AMENDMENT 4: the gate itself is pool-independent now (a
      // fixed shipped table, not this file's pool-wide `index`), so no
      // index is passed here any more. keyword.ts's own bypass logic
      // handles a reader who has declared no work text at all (today's
      // behaviour). See keyword.ts's doc comment for why this is scoped to
      // this ONE call.
      senseContext: { contextText: workText },
    });
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
    // T4 (REQUIRED-GATE §1ao.1) — tag-anchored topical-similarity fallback,
    // tried only when T1/T2/T3 found nothing for every Required tag (T4
    // only ever ADDS candidates, never subtracts — it cannot lower a score
    // T1/T2/T3 already set). Reuses the SAME pool-wide `index` and `pText`
    // already built once per call above, at negligible extra cost.
    // TAG-ANCHORED: a paper needs at least some similarity to the tag
    // ITSELF (`simTopic > 0`) before general project-text similarity can
    // help it qualify — an unanchored version let a biofilm/clinical paper
    // into a battery "electrolyte" pool on generic scientific-vocabulary
    // overlap with the project text alone (the measured false positive;
    // confirmed rejected under this anchored rule,
    // docs/jev-abc/REQUIRED-GATE-C-20260928T163436Z.md §1). A T4-only
    // qualification adds NOTHING to `kw.matched` (§1ao.8 — never claim a
    // keyword the paper does not contain): only `kw.score` moves, and it
    // moves through the SAME raw/1.5 scale `scoreKeyword` itself uses, so a
    // full-strength T1 hit always outranks a full-strength T4-only hit at
    // equal specificity (mutation-tested, required-gate.test.ts).
    if (literalMustTopics.length > 0 && kw.score === 0) {
      let bestT4Score = 0;
      for (const topic of literalMustTopics) {
        const canonicalTopic = canonicalize(topic);
        if (!canonicalTopic) continue;
        // SENSE-CONTEXT rule (c) (§1ap AMENDMENT 4 ruling 4 / AMENDMENT 5 finding 1)
        // — runs FIRST, ahead of the statistical gate below, same order keyword.ts's
        // T1/T2/T3 path uses. AMENDMENT 5 HIGH-1: T4 runs precisely when
        // `kw.score === 0`, which is exactly the state rule (c) leaves an item in
        // when it fires on every literal Required tag — an item rule (c) correctly
        // flags as the wrong sense could fall straight through to T4 for the SAME
        // tag and be admitted there at full strength (confirmed by live execution,
        // A2's review, before this fix: a constructed self-declared "light cycle oil
        // (LCO)" item that also cleared the statistical gate was admitted with
        // score=0.6807, matchedKeywords=[] — a silent full-strength admission).
        // AMENDMENT 4.4's "contributes nothing for that paper" covers every tier,
        // not just the literal one — this closes that off for T4 too.
        if (selfDeclaresDifferentSense(item, topic).differs) continue;
        // SENSE-CONTEXT §1ap.4 — T4 has no literal evidence to soften, so a
        // short/ambiguous tag's admission is GATED here, not demoted: if
        // the stripped-context check fails (and isn't bypassed for a
        // reader with no other declared context), this topic contributes
        // nothing to T4. Long/specific tags are completely unaffected —
        // same gate keyword.ts's own T1/T2/T3 demote step uses, so a tag
        // that would fail here is exactly the tag whose literal hit (if
        // any) would already be demoted rather than trusted at face value.
        // AMENDMENT 4 — pool-independent now, so no `index` argument.
        if (isShortOrAmbiguous(topic)) {
          const gate = senseContextGate(item, topic, workText); // AMENDMENT 2(i) — workText, not pText
          if (!gate.bypass && !gate.pass) continue;
        }
        const simTopic = scoreTfidf(item.id, topic, index);
        const simProject = scoreTfidf(item.id, pText, index);
        // "margin = max over the admitting path(s)" (§1ao ruling 3) — only a
        // path that actually cleared its own floor contributes a margin.
        const margins: number[] = [];
        if (simTopic >= REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC) {
          margins.push(
            (simTopic - REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC) / (1 - REQUIRED_TAG_SIMILARITY_FLOOR_TOPIC),
          );
        }
        if (simTopic > 0 && simProject >= REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT) {
          margins.push(
            (simProject - REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT) / (1 - REQUIRED_TAG_SIMILARITY_FLOOR_PROJECT),
          );
        }
        if (margins.length === 0) continue; // neither path anchored/admitted this tag
        const margin = clamp01(Math.max(...margins));
        const candidateScore = Math.min(
          1,
          (REQUIRED_TAG_T4_WEIGHT * termSpecificity(canonicalTopic) * margin) / 1.5,
        );
        if (candidateScore > bestT4Score) bestT4Score = candidateScore;
      }
      if (bestT4Score > 0) kw = { ...kw, score: bestT4Score };
    }
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
    // SENSE-CONTEXT (§1ap AMENDMENT 2(ii)) — when EVERY Required-tag match
    // this item has failed its context check (`kw.fullyDemoted`), the
    // keyword-level demotion alone is not enough: an unstripped topicality
    // score can still be high (a paper that is centrally, extensively about
    // the ambiguous tag's own words shares heavy raw vocabulary with a
    // pText that repeats those same words) and rescue the item's overall
    // rank even though it has zero genuine context-agreeing evidence. This
    // additional penalty applies to `base` only — the same place
    // policyPenalty/legacyPenalty/preference.penalty already apply — never
    // to softBonus/preference.boost, which come from an unrelated signal
    // (Explore topics, the preference ledger) this item's Required-tag
    // demotion says nothing about.
    const senseContextPenalty = kw.fullyDemoted ? SENSE_CONTEXT_DEMOTED_GROUNDING : 1;
    const combined = clamp01(
      base * policyPenalty * legacyPenalty * preference.penalty * senseContextPenalty +
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
