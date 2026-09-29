import type { ScoredItem } from "@/lib/scoring/types";
import { isReviewLike } from "@/lib/scoring/review-policy";
import { tokenize } from "@/lib/scoring/tokenize";
import { RERANK_DEFAULT_REASON } from "@/lib/reader/recommendation";
import type { SearchBrief } from "./profile-compiler";

function overlapScore(text: string, signals: string[]): number {
  const haystack = new Set(tokenize(text));
  const signalTokens = Array.from(new Set(signals.flatMap((s) => tokenize(s))));
  if (signalTokens.length === 0) return 0;
  const hits = signalTokens.filter((token) => haystack.has(token));
  return hits.length / signalTokens.length;
}

function itemText(item: ScoredItem): string {
  return [item.title, item.abstract ?? "", item.venue ?? "", ...(item.tags ?? [])].join(" ");
}

function topicKey(item: ScoredItem): string {
  return tokenize([item.title, ...(item.tags ?? [])].join(" ")).slice(0, 3).join(":");
}

function sourceLaneBoost(item: ScoredItem, brief: SearchBrief): number {
  const codeSignals = [item.url, item.abstract ?? "", ...(item.tags ?? [])].join(" ");
  const codeBoost = /github|gitlab|code|dataset|benchmark/i.test(codeSignals)
    ? 0.025 * brief.sourceMix.code
    : 0;
  if (item.source === "arxiv") return 0.03 * brief.sourceMix.preprints + codeBoost;
  if (
    item.source === "openalex" ||
    item.source === "semantic_scholar" ||
    item.source === "dblp" ||
    item.source === "pubmed"
  ) {
    return 0.03 * brief.sourceMix.published + codeBoost;
  }
  if (item.source === "hn" || item.source === "web") return 0.02 * brief.sourceMix.web + codeBoost;
  return codeBoost;
}

/**
 * SCORE-ZERO (ABC-JEV-INTEGRATION.md §1at ruling 3) — the review/avoid
 * demotion below (`avoid * 0.2 + reviewPenalty`) must never, by itself, sink
 * a shown item's score below this fraction of its OWN pre-rerank
 * (combine.ts) score. Mirrors SENSE-CONTEXT's own demotion-floor precedent
 * (`SENSE_CONTEXT_DEMOTED_GROUNDING`, keyword.ts): demotion is a ranking
 * preference, not a verdict that the paper has no relevance, so a demoted
 * item keeps a nonzero, visible relevance badge. The floor is proportional
 * to each item's own pre-rerank score (not a flat number), so several
 * demoted items still order among themselves the way their pre-rerank
 * scores did. `methodPenalty` below is a separate, pre-existing mechanism —
 * a reader-declared "must match method" control — and keeps its full,
 * unfloored power to reach exactly 0; only the review/avoid terms are
 * bounded by this floor.
 */
const REVIEW_AVOID_DEMOTION_FLOOR = 0.25;

function localScore(item: ScoredItem, brief: SearchBrief): number {
  const text = itemText(item);
  const must = overlapScore(text, brief.mustInclude);
  const nice = overlapScore(text, brief.niceToHave);
  const question = overlapScore(text, brief.activeQuestions);
  const method = overlapScore(text, brief.methods);
  const avoid = overlapScore(text, brief.avoid);
  const reviewPenalty = brief.controls.avoidReviews && isReviewLike(item) ? 0.16 : 0;
  const methodPenalty =
    brief.methods.length > 0 && brief.controls.methodMode === "mustMatch" && method === 0
      ? 0.18
      : 0;
  const methodBoost =
    brief.controls.methodMode === "any" ? 0 : method * 0.1;
  const citationBoost =
    brief.controls.importance === "highlyCited"
      ? Math.min(0.12, (item.metadata.citationCount ?? 0) / 1000)
      : brief.controls.importance === "rising"
        ? Math.min(0.1, (item.metadata.citationCount ?? 0) / 400) + item.scoreBreakdown.recency * 0.05
      : 0;

  const focusBoost =
    brief.controls.focus === "tight"
      ? must * 0.18 + question * 0.12
      : brief.controls.focus === "exploratory"
        ? nice * 0.08 + sourceLaneBoost(item, brief)
        : must * 0.1 + nice * 0.08 + question * 0.08;

  // Everything except the review/avoid demotion — methodPenalty (a distinct,
  // reader-declared mechanism) keeps its own unrestricted floor of 0 here.
  const beforeReviewAvoidDemotion =
    item.score +
    focusBoost +
    methodBoost +
    citationBoost +
    sourceLaneBoost(item, brief) -
    methodPenalty;
  const reviewAvoidDemotion = avoid * 0.2 + reviewPenalty;
  // Cap how much of THAT demotion may apply, so it alone never crosses the
  // floor. When there is no review/avoid signal (reviewAvoidDemotion === 0)
  // this caps at 0 and the result is byte-identical to the un-floored
  // formula — non-review, non-avoid items are unaffected.
  const cappedDemotion = Math.min(
    reviewAvoidDemotion,
    Math.max(0, beforeReviewAvoidDemotion - REVIEW_AVOID_DEMOTION_FLOOR * item.score),
  );

  return Math.max(0, Math.min(1, beforeReviewAvoidDemotion - cappedDemotion));
}

export function applyTier1Rerank(items: ScoredItem[], brief: SearchBrief): ScoredItem[] {
  const scored = items
    .map((item) => {
      const combined = localScore(item, brief);
      return {
        ...item,
        score: combined,
        scoreBreakdown: {
          ...item.scoreBreakdown,
          combined,
        },
        relevanceReason: item.relevanceReason || RERANK_DEFAULT_REASON,
      };
    })
    .sort((a, b) => b.score - a.score);

  return diversify(scored, brief);
}

/**
 * No single researcher should own the day's briefing. `topicKey` keys on the
 * first three title tokens, which does not catch one author publishing six
 * near-identical papers into the same repository — "Graph Neural Networks for
 * Protein Structure Prediction", "Quantum Machine Learning Protein Structure
 * Prediction", "Quantum Bioinformatics: Protein Structure Prediction..." all
 * hash to different keys while being the same submission cluster.
 */
const MAX_PER_AUTHOR = 2;

function firstAuthorKey(item: ScoredItem): string | null {
  const first = item.authors?.[0]?.trim().toLocaleLowerCase();
  return first && first.length > 0 ? first : null;
}

function diversify(items: ScoredItem[], brief: SearchBrief): ScoredItem[] {
  const maxPerTopic = brief.controls.discoveryMode === "core" ? 4 : 3;
  const seenTopic = new Map<string, number>();
  const seenAuthor = new Map<string, number>();
  const picked: ScoredItem[] = [];
  const deferred: ScoredItem[] = [];

  for (const item of items) {
    const topic = topicKey(item) || item.source;
    const author = firstAuthorKey(item);
    const topicCount = seenTopic.get(topic) ?? 0;
    const authorCount = author ? (seenAuthor.get(author) ?? 0) : 0;

    if (topicCount < maxPerTopic && authorCount < MAX_PER_AUTHOR) {
      picked.push(item);
      seenTopic.set(topic, topicCount + 1);
      if (author) seenAuthor.set(author, authorCount + 1);
    } else {
      deferred.push(item);
    }
  }

  return [...picked, ...deferred];
}
