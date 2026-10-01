import type { RawItem, SourceId } from "@/lib/sources/types";
import type { PreferenceLedger } from "@/types";
import type { SelectedSenseConcept } from "@/lib/feed/senses";

export interface ScoringProfile {
  topics: string[];
  /** Bonus-only topics: matching papers score higher but non-matching still appear. */
  softTopics?: string[];
  methods?: string[];
  venues?: string[];
  seedTexts?: string[];
  preferenceLedger?: PreferenceLedger;
  sourceWeights?: Partial<Record<SourceId, number>>;
  /** How a candidate entered the pool, preserved so non-literal channels survive Tier 0. */
  admissionChannels?: Partial<Record<string, FeedAdmissionChannel[]>>;
  /** Explicit user exclusions are hard eligibility, unlike legacy dislike feedback. */
  exclusions?: string[];
  /** Optional ISO lower date boundary for direct scoring callers. */
  minPublishedAt?: string;
  /** Explicit domain sense selections; bare legacy topic strings stay untyped. */
  selectedSenseConcepts?: SelectedSenseConcept[];
}

export type FeedAdmissionChannel = "keyword" | "semantic" | "positive-seed" | "citation" | "topic-field";

export interface ScoreWeights {
  keyword: number;
  tfidf: number;
  recency: number;
  source: number;
}

export interface ScoreBreakdown {
  keyword: number;
  /** Raw cosine against the profile text. Diagnostic: ranking uses `topicality`. */
  tfidf: number;
  /**
   * Where this paper's `tfidf` falls among today's candidates, 0…1.
   *
   * The raw cosine of two short documents lives in about 0.01–0.35, so as an
   * additive term weighted 0.3 it could move a score by at most 0.1 while
   * recency moved it by 0.17 — the pool ranked by age wearing relevance as
   * trim. The number that means something is not the cosine but its place in
   * the day's pool, and that uses the whole range.
   */
  topicality: number;
  recency: number;
  source: number;
  combined: number;
}

export interface ScoredItem extends RawItem {
  score: number;
  scoreBreakdown: ScoreBreakdown;
  matchedKeywords: string[];
  relevanceReason: string;
}

// Relevance leads; recency and source break ties.
//
// The old split (keyword .35, tfidf .30, recency .20, source .15) read as
// relevance-first and behaved as recency-first, because only tfidf varies
// much between papers and it was the term with the least room to move. On a
// real day it put an art installation about diffusion models and a paper on
// the C/O ratios of Uranus above the reader's own field. `tfidf` now weighs
// the pool-relative `topicality`, which uses its full range.
export const DEFAULT_WEIGHTS: ScoreWeights = {
  keyword: 0.3,
  tfidf: 0.55,
  source: 0.05,
  recency: 0.1,
};

export const DEFAULT_SOURCE_WEIGHTS: Record<SourceId, number> = {
  openalex: 1.0,
  semantic_scholar: 1.0,
  dblp: 0.95,
  pubmed: 1.0,
  arxiv: 0.9,
  web: 0.7,
  hn: 0.75,
};
