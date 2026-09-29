import { describe, expect, it } from "vitest";
import { combineDecisionAnswers } from "./combine";
import type { DecisionAnswer } from "./types";

function answer(overrides: Partial<DecisionAnswer> & Pick<DecisionAnswer, "questionId" | "kind" | "value">): DecisionAnswer {
  return { confidence: 0.9, unknown: false, ...overrides };
}

describe("combineDecisionAnswers — determinism", () => {
  it("produces byte-identical output for the same input, called twice", () => {
    const answers: DecisionAnswer[] = [
      answer({ questionId: "sense_match", kind: "choice", value: "matches_target_sense" }),
      answer({ questionId: "core_vs_background", kind: "choice", value: "core" }),
      answer({ questionId: "project_help", kind: "score", value: 3 }),
    ];
    const first = combineDecisionAnswers(answers);
    const second = combineDecisionAnswers([...answers]); // a structurally-equal but distinct array
    expect(second).toEqual(first);
  });

  it("never touches the clock or any other hidden input — running it 100 times gives the same combined score", () => {
    const answers: DecisionAnswer[] = [
      answer({ questionId: "population_match", kind: "choice", value: "population_mismatch" }),
      answer({ questionId: "method_outcome_match", kind: "choice", value: "method_match" }),
    ];
    const results = Array.from({ length: 100 }, () => combineDecisionAnswers(answers).combined);
    expect(new Set(results).size).toBe(1);
  });
});

describe("combineDecisionAnswers — unknown neutrality", () => {
  it("gives an unknown dimension exactly the neutral contribution, never a strong positive or negative", () => {
    const breakdown = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "matches_target_sense", unknown: true }),
    ]);
    expect(breakdown.dimensions.sense_match?.value).toBe(0.5);
    expect(breakdown.dimensions.sense_match?.unknown).toBe(true);
    expect(breakdown.unknownDimensions).toEqual(["sense_match"]);
  });

  it("keeps the unknown contribution neutral even when the literal returned value looks strongly positive", () => {
    const knownPositive = combineDecisionAnswers([
      answer({ questionId: "core_vs_background", kind: "choice", value: "core", unknown: false }),
    ]);
    const unknownSameValue = combineDecisionAnswers([
      answer({ questionId: "core_vs_background", kind: "choice", value: "core", unknown: true }),
    ]);
    expect(knownPositive.combined).toBeGreaterThan(unknownSameValue.combined);
    expect(unknownSameValue.combined).toBe(0.5);
  });

  it("never lets a single unknown dimension zero the whole score — other real dimensions still count", () => {
    const breakdown = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "matches_target_sense", unknown: false }), // strong positive
      answer({ questionId: "core_vs_background", kind: "choice", value: "core", unknown: false }), // strong positive
      answer({ questionId: "project_help", kind: "score", value: 3, unknown: true }), // unknown — must not drag this to 0
    ]);
    expect(breakdown.combined).toBeGreaterThan(0.5);
  });

  it("treats every dimension unknown as fully neutral overall (0.5), not zero and not one", () => {
    const breakdown = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "different_sense", unknown: true }),
      answer({ questionId: "core_vs_background", kind: "choice", value: "background", unknown: true }),
      answer({ questionId: "project_help", kind: "score", value: 0, unknown: true }),
    ]);
    expect(breakdown.combined).toBe(0.5);
    expect(breakdown.unknownDimensions.sort()).toEqual(["core_vs_background", "project_help", "sense_match"]);
  });
});

describe("combineDecisionAnswers — never crashes, never excludes by itself", () => {
  it("returns a neutral score for zero answers (a fully degraded call, or a paper with nothing to judge it by)", () => {
    const breakdown = combineDecisionAnswers([]);
    expect(breakdown.combined).toBe(0.5);
    expect(breakdown.dimensions).toEqual({});
    expect(breakdown.unknownDimensions).toEqual([]);
  });

  it("does not throw on an answer for a question id the rubric does not recognize (defensive, never crashes)", () => {
    const bogus = answer({ questionId: "not_a_real_question" as DecisionAnswer["questionId"], kind: "choice", value: "whatever" });
    expect(() => combineDecisionAnswers([bogus])).not.toThrow();
    const breakdown = combineDecisionAnswers([bogus]);
    expect(Number.isFinite(breakdown.combined)).toBe(true);
  });

  it("clamps to [0,1] even from an unexpected numeric value", () => {
    const weirdScore = answer({ questionId: "project_help", kind: "score", value: 999 });
    const breakdown = combineDecisionAnswers([weirdScore]);
    expect(breakdown.combined).toBeGreaterThanOrEqual(0);
    expect(breakdown.combined).toBeLessThanOrEqual(1);
  });
});

describe("combineDecisionAnswers — weighting and inspectable parts", () => {
  it("weighs project_help/core_vs_background most, matching the rubric's stated priority, without needing all 5 dimensions present", () => {
    const allPositive = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "matches_target_sense" }),
      answer({ questionId: "core_vs_background", kind: "choice", value: "core" }),
      answer({ questionId: "population_match", kind: "choice", value: "population_match" }),
      answer({ questionId: "method_outcome_match", kind: "choice", value: "method_match" }),
      answer({ questionId: "project_help", kind: "score", value: 3 }),
    ]);
    expect(allPositive.combined).toBeCloseTo(1, 10);

    const allNegative = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "different_sense" }),
      answer({ questionId: "core_vs_background", kind: "choice", value: "background" }),
      answer({ questionId: "population_match", kind: "choice", value: "population_mismatch" }),
      answer({ questionId: "method_outcome_match", kind: "choice", value: "method_mismatch" }),
      answer({ questionId: "project_help", kind: "score", value: 0 }),
    ]);
    expect(allNegative.combined).toBeLessThan(0.2);
  });

  it("re-normalizes weights among only the dimensions actually present (population/method are conditionally asked)", () => {
    const breakdown = combineDecisionAnswers([
      answer({ questionId: "core_vs_background", kind: "choice", value: "core" }),
      answer({ questionId: "project_help", kind: "score", value: 3 }),
    ]);
    const totalWeight = Object.values(breakdown.dimensions).reduce((sum, d) => sum + (d?.weight ?? 0), 0);
    expect(totalWeight).toBeCloseTo(1, 10);
    // Only 2 dimensions were asked; both known+positive, so the combined score is a full 1.
    expect(breakdown.combined).toBeCloseTo(1, 10);
  });

  it("exposes one inspectable entry per answered dimension, keyed by questionId", () => {
    const breakdown = combineDecisionAnswers([
      answer({ questionId: "sense_match", kind: "choice", value: "matches_target_sense" }),
      answer({ questionId: "project_help", kind: "score", value: 1 }),
    ]);
    expect(Object.keys(breakdown.dimensions).sort()).toEqual(["project_help", "sense_match"]);
    expect(breakdown.dimensions.project_help?.value).toBeCloseTo(1 / 3, 10);
  });
});
