/**
 * The single pinned source of truth for "what a Jev decision call asks, and
 * what each possible answer means." Every constant here is versioned
 * together (`DECISION_RUBRIC_VERSION`) so a future wording/weighting change
 * is a new version, never a silent in-place edit — the decision cache
 * (P3-S3) keys on this version specifically so a rubric bump invalidates
 * exactly the cache entries it should and no others.
 *
 * Binding facts this file encodes (ABC-JEV-INTEGRATION.md §1d, §1p.H;
 * docs/jev-abc/P3-B-20260924T0525Z.md JEV CONTRACT + DESIGN §2):
 * - Model is pinned to the literal string, never the `jev-latest`/
 *   `jev-preview` aliases (an alias is a moving target by definition).
 * - Jev has no native "unknown" answer. Every Choice question therefore
 *   carries an explicit `insufficient_information` option (a real, typed
 *   escape hatch) IN ADDITION to a confidence-threshold fallback: even when
 *   `insufficient_information` was NOT the literal choice, a confidence
 *   below the pinned threshold still marks the answer locally unknown.
 *   Score (project_help) has no non-ordered slot to inject an unknown
 *   level without corrupting the ordered scale, so its unknown derivation
 *   is confidence-threshold-only — a real, documented asymmetry, not an
 *   oversight.
 * - Noul is never used for any dimension: it returns no `confidence` field
 *   at all, so its only unknown signal would be proximity to 0.5 in the raw
 *   probability — strictly weaker than Choice's explicit-option-plus-
 *   confidence combination, for a primitive otherwise interchangeable with
 *   a 2-option Choice.
 * - Every question's `instructions` is a fixed, pre-written plain-English
 *   string with zero runtime templating. Jev's `instructions` field
 *   supports an object/backtick grammar for referencing nested `state`
 *   data, but the exact grammar is UNVERIFIED by any fetched doc page —
 *   avoided entirely per the spec's own recommendation. All paper/intent/
 *   sense content instead travels only in the wire request's `state`
 *   object, as data, never concatenated into an instruction string.
 */

import type { DecisionQuestionId } from "./types.ts";

/** Pin the literal resolved id, never an alias — the validator asserts the response echoes exactly this. */
export const JEV_MODEL_ID = "jev-1.13.0" as const;

export const DECISION_QUESTION_SET_VERSION = "peer-decisions-questions-v1" as const;
export const DECISION_SCHEMA_VERSION = "peer-decisions-schema-v1" as const;
export const DECISION_RUBRIC_VERSION = "peer-decisions-rubric-v1" as const;

/**
 * Official guidance (docs.typesafe.ai/confidence.md, VERIFIED): "if
 * confidence < 0.5 ... don't guess." Versioned with the rubric — never
 * changed silently mid-version; a new threshold is a new
 * `DECISION_RUBRIC_VERSION`.
 */
export const UNKNOWN_CONFIDENCE_THRESHOLD = 0.5;

/** The one, universal typed-unknown option every Choice question's criteria must include. */
export const INSUFFICIENT_INFORMATION_KEY = "insufficient_information" as const;

export interface ChoiceQuestionSpec {
  id: DecisionQuestionId;
  kind: "choice";
  /** Fixed plain-English instructions sent verbatim — no templating. */
  instructions: string;
  /** Criteria key -> plain-English description shown to Jev. Always includes `insufficient_information`. */
  criteria: Record<string, string>;
  /**
   * Local-only: normalized [0,1] "how positive/relevant" each NON-unknown
   * criteria key is, read by `combine.ts`. Deliberately excludes
   * `insufficient_information` — that key is handled generically as
   * neutral/unknown, never looked up here.
   */
  positivity: Record<string, number>;
}

export interface ScoreQuestionSpec {
  id: DecisionQuestionId;
  kind: "score";
  instructions: string;
  /** Ordered level descriptions, 2-10 per the Jev contract (VERIFIED). Index doubles as the valid `score` range: `[0, levels.length - 1]`. */
  levels: string[];
}

export type DecisionQuestionSpec = ChoiceQuestionSpec | ScoreQuestionSpec;

const SENSE_MATCH: ChoiceQuestionSpec = {
  id: "sense_match",
  kind: "choice",
  instructions:
    "The paper's title, abstract and venue are provided in the accompanying data under \"paper\". The user's selected domain sense definitions are provided under \"senses\". Decide whether this paper is actually about the same specific meaning the user selected, not just a shared word or phrase. If the paper's title and abstract do not contain enough information to judge which sense is meant, choose insufficient_information rather than guessing.",
  criteria: {
    matches_target_sense: "The paper is about the exact sense/meaning the user selected.",
    different_sense: "The paper uses the same word or phrase but means something else.",
    insufficient_information: "There is not enough information in the title and abstract to tell which sense is meant.",
  },
  positivity: {
    matches_target_sense: 1,
    different_sense: 0,
  },
};

const CORE_VS_BACKGROUND: ChoiceQuestionSpec = {
  id: "core_vs_background",
  kind: "choice",
  instructions:
    "The user's project and challenge are provided in the accompanying data under \"intent\". Decide whether this paper is core to that project and challenge, or only background/tangentially related. If the paper's title and abstract do not contain enough information to judge, choose insufficient_information rather than guessing.",
  criteria: {
    core: "The paper is directly central to the user's project and challenge.",
    background: "The paper is only tangentially or generally related to the user's project and challenge.",
    insufficient_information: "There is not enough information to judge how central this paper is.",
  },
  positivity: {
    core: 1,
    background: 0.35,
  },
};

const POPULATION_MATCH: ChoiceQuestionSpec = {
  id: "population_match",
  kind: "choice",
  instructions:
    "The user's intent specifies a target population or subject group, provided in the accompanying data under \"intent\". Decide whether this paper's studied population matches the one the user specified. If the paper's title and abstract do not contain enough information to judge, choose insufficient_information rather than guessing.",
  criteria: {
    population_match: "The paper's studied population matches what the user specified.",
    population_mismatch: "The paper's studied population is different from what the user specified.",
    insufficient_information: "There is not enough information to tell which population this paper studies.",
  },
  positivity: {
    population_match: 1,
    population_mismatch: 0,
  },
};

const METHOD_OUTCOME_MATCH: ChoiceQuestionSpec = {
  id: "method_outcome_match",
  kind: "choice",
  instructions:
    "The user's intent specifies a required method or outcome, provided in the accompanying data under \"intent\". Decide whether this paper's method or reported outcome matches what the user specified. If the paper's title and abstract do not contain enough information to judge, choose insufficient_information rather than guessing.",
  criteria: {
    method_match: "The paper's method or outcome matches what the user specified.",
    method_mismatch: "The paper's method or outcome is different from what the user specified.",
    insufficient_information: "There is not enough information to tell whether the method or outcome matches.",
  },
  positivity: {
    method_match: 1,
    method_mismatch: 0,
  },
};

const PROJECT_HELP: ScoreQuestionSpec = {
  id: "project_help",
  kind: "score",
  instructions:
    "The user's project and challenge are provided in the accompanying data under \"intent\". Rate how much this paper would help the user make progress on that project and challenge, from not helpful at all to directly enabling the project.",
  levels: [
    "not helpful - unrelated to the project",
    "slightly helpful - tangential background",
    "moderately helpful - relevant supporting evidence or method",
    "directly helpful - central to advancing the project",
  ],
};

const QUESTION_SPECS: Record<DecisionQuestionId, DecisionQuestionSpec> = {
  sense_match: SENSE_MATCH,
  core_vs_background: CORE_VS_BACKGROUND,
  population_match: POPULATION_MATCH,
  method_outcome_match: METHOD_OUTCOME_MATCH,
  project_help: PROJECT_HELP,
};

export function questionSpec(id: DecisionQuestionId): DecisionQuestionSpec {
  return QUESTION_SPECS[id];
}

export function allQuestionIds(): DecisionQuestionId[] {
  return Object.keys(QUESTION_SPECS) as DecisionQuestionId[];
}

/**
 * How much each dimension counts toward the combined decision score
 * (`combine.ts`), re-normalized among whichever dimensions were actually
 * asked for a given paper. `project_help` weighs most because the user's
 * project/challenge is primary (ABC-JEV-INTEGRATION.md §1c, cited by
 * DESIGN §2's dimension-5 gating note).
 */
export const DIMENSION_WEIGHTS: Record<DecisionQuestionId, number> = {
  project_help: 0.35,
  core_vs_background: 0.25,
  sense_match: 0.2,
  population_match: 0.1,
  method_outcome_match: 0.1,
};

/**
 * Which of the 5 dimensions to ask for one paper. `core_vs_background` and
 * `project_help` are always asked; `sense_match` only when the paper has
 * selected sense concepts; `population_match`/`method_outcome_match` only
 * when the user's intent specifies them ("没有说明就不问" — never asked
 * otherwise, per the spec).
 *
 * NOTE — deliberately not auto-derived from `NormalizedFeedIntent` for
 * population: `intent.methods.length > 0` is a direct, VERIFIED mapping for
 * "the user specified a method" (see `intentSpecifiesMethodOutcome` below),
 * but `NormalizedFeedIntent` has no equivalent population field today.
 * Rather than guess an unverified heuristic (e.g. reusing
 * `requiredConcepts`), callers pass `intentSpecifiesPopulation` explicitly.
 * Left open for whoever builds the P3-S5 pipeline wiring; not required by
 * P3-S1/S2's own offline acceptance, which only needs this function to gate
 * correctly given the flags it is handed.
 */
export function selectQuestionsForRequest(input: {
  hasSenseConcepts: boolean;
  intentSpecifiesPopulation: boolean;
  intentSpecifiesMethodOutcome: boolean;
}): DecisionQuestionId[] {
  const ids: DecisionQuestionId[] = [];
  if (input.hasSenseConcepts) ids.push("sense_match");
  ids.push("core_vs_background");
  if (input.intentSpecifiesPopulation) ids.push("population_match");
  if (input.intentSpecifiesMethodOutcome) ids.push("method_outcome_match");
  ids.push("project_help");
  return ids;
}

/** `NormalizedFeedIntent.methods` is a real, existing field — a direct, non-heuristic mapping for "the user's intent specifies a method/outcome requirement." */
export function intentSpecifiesMethodOutcome(methods: readonly string[]): boolean {
  return methods.length > 0;
}
