/**
 * Deterministic, inspectable local decision score from a paper's answered
 * dimensions — the same "inspectable parts" convention
 * `web/src/lib/scoring/combine.ts`'s `ScoreBreakdown` already uses for
 * retrieval scoring, applied to Jev decisions.
 *
 * Hard rule (ABC-JEV-INTEGRATION.md §1d, docs/jev-abc/P3-B-20260924T0525Z.md
 * DESIGN §2): an `unknown` dimension (per `jev-contract.ts`'s validator) is
 * always neutral — never a strong positive or negative, and never zeroes
 * the whole score, because it contributes exactly the neutral midpoint to
 * a weighted average alongside whatever other dimensions were answered. A
 * paper with no abstract, or whose Jev call degraded entirely (zero
 * answers), gets the same neutral treatment — this layer never excludes a
 * paper; exclusion, if any, is a decision for a caller far above this pure
 * function.
 */

import type { DecisionAnswer, DecisionQuestionId } from "./types";
import { DIMENSION_WEIGHTS, questionSpec } from "./rubric";

/** The midpoint of the [0,1] contribution scale — genuinely neutral, neither evidence for nor against. */
const NEUTRAL_VALUE = 0.5;

export interface DecisionDimensionContribution {
  /** Normalized [0,1] contribution actually used in the weighted average. Always `NEUTRAL_VALUE` when `unknown` is true, regardless of the raw answer's literal value. */
  value: number;
  unknown: boolean;
  /** This dimension's share of `combined`, re-normalized among whichever dimensions were actually present (population/method are not always asked). */
  weight: number;
}

export interface DecisionBreakdown {
  dimensions: Partial<Record<DecisionQuestionId, DecisionDimensionContribution>>;
  unknownDimensions: DecisionQuestionId[];
  /** [0,1]; `NEUTRAL_VALUE` when there were no answers at all (a fully degraded call, or a paper with nothing to judge it by). */
  combined: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_VALUE;
  return Math.max(0, Math.min(1, value));
}

function choicePositivity(questionId: DecisionQuestionId, value: string | number): number {
  const spec = questionSpec(questionId);
  if (!spec || spec.kind !== "choice" || typeof value !== "string") return NEUTRAL_VALUE;
  const positivity = spec.positivity[value];
  return typeof positivity === "number" ? clamp01(positivity) : NEUTRAL_VALUE;
}

function scorePositivity(questionId: DecisionQuestionId, value: string | number): number {
  const spec = questionSpec(questionId);
  if (!spec || spec.kind !== "score" || typeof value !== "number") return NEUTRAL_VALUE;
  const levelCount = spec.levels.length;
  if (levelCount <= 1) return NEUTRAL_VALUE;
  return clamp01(value / (levelCount - 1));
}

function dimensionValue(answer: DecisionAnswer): number {
  // Unknown is ALWAYS neutral, regardless of which literal value came back
  // — the whole point of the flag is that the value is not trustworthy
  // enough to count as real evidence either way.
  if (answer.unknown) return NEUTRAL_VALUE;
  return answer.kind === "choice"
    ? choicePositivity(answer.questionId, answer.value)
    : scorePositivity(answer.questionId, answer.value);
}

/**
 * Combines whichever dimensions were actually answered (never assumes all
 * 5 — population/method are conditionally asked, per `rubric.ts`'s
 * gating) into one deterministic `[0,1]` score plus an inspectable
 * per-dimension breakdown. Pure: same input always produces the same
 * output, never touches the clock, never throws.
 */
export function combineDecisionAnswers(answers: readonly DecisionAnswer[]): DecisionBreakdown {
  if (answers.length === 0) {
    return { dimensions: {}, unknownDimensions: [], combined: NEUTRAL_VALUE };
  }

  // Present-dimension weights, re-normalized to sum to 1 among only the
  // dimensions this paper was actually asked. Falls back to an equal split
  // if every present dimension were somehow missing from DIMENSION_WEIGHTS
  // (rubric/combiner drift) — keeps the result deterministic and finite
  // rather than NaN; never crashes on an unexpected questionId.
  const rawWeights = answers.map((answer) => DIMENSION_WEIGHTS[answer.questionId] ?? 0);
  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0);
  const fallbackWeight = 1 / answers.length;

  const dimensions: Partial<Record<DecisionQuestionId, DecisionDimensionContribution>> = {};
  const unknownDimensions: DecisionQuestionId[] = [];
  let combined = 0;

  answers.forEach((answer, i) => {
    const weight = totalWeight > 0 ? rawWeights[i] / totalWeight : fallbackWeight;
    const value = dimensionValue(answer);
    dimensions[answer.questionId] = { value, unknown: answer.unknown, weight };
    if (answer.unknown) unknownDimensions.push(answer.questionId);
    combined += value * weight;
  });

  return { dimensions, unknownDimensions, combined: clamp01(combined) };
}
