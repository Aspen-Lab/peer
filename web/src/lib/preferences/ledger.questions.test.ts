import { describe, expect, it } from "vitest";
import {
  QUESTION_TERM_WEIGHT,
  applyPreferenceSignal,
  applyQuestionTermSignal,
  applyUploadPreferenceSignal,
  cleanPreferenceLedger,
  prepareLedger,
  preferenceKey,
  questionSourceKey,
  questionTermsOf,
  removeQuestionTermSignal,
  scorePreferenceMatch,
  summarizePreferenceLedger,
  termConcept,
} from "./ledger";
import type { PreferenceLedger } from "@/types";
import type { RawItem } from "@/lib/sources/types";

// P5-02 (blueprint P5, brief): a settled question's specific terms enter the ledger as
// a low-weight signal of declared interest, through the mechanism an upload's concepts
// use (separate, removable evidence, once per source), with the weight of one named
// constant. The papers and words here are invented.

const T0 = "2026-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);
const PAPER = "openalex:W111";
const OTHER = "arxiv:2401.00001";

const item = (title: string, tags: string[] = []): RawItem => ({
  id: title, source: "openalex", title, authors: [], url: "", publishedAt: "", tags, metadata: {},
});

describe("QUESTION_TERM_WEIGHT", () => {
  it("is below the weakest an upload's concept gets and far below one explicit like", () => {
    // An upload's evidence is 2 x confidence, confidence from 0.45 up; a like adds 1.
    expect(QUESTION_TERM_WEIGHT).toBeGreaterThan(0);
    expect(QUESTION_TERM_WEIGHT).toBeLessThan(2 * 0.45);
    expect(QUESTION_TERM_WEIGHT).toBeLessThanOrEqual(1 / 4);
  });
});

describe("questionSourceKey", () => {
  it("is an opaque, stable key that does not carry the paper's id", () => {
    const key = questionSourceKey(PAPER);
    expect(key).toMatch(/^q[a-f0-9]{16}$/);
    expect(key).toBe(questionSourceKey(PAPER));
    expect(questionSourceKey(OTHER)).not.toBe(key);
    expect(key).not.toContain("W111");
  });
});

describe("applyQuestionTermSignal", () => {
  it("adds evidence of exactly QUESTION_TERM_WEIGHT per term, separate from likes and dislikes", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, ["annealing", "grain"], T0);
    const entry = ledger[preferenceKey("grain")];
    expect(entry.positive).toBe(0);
    expect(entry.negative).toBe(0);
    expect(entry.questions).toEqual({ [questionSourceKey(PAPER)]: { at: T0, weight: QUESTION_TERM_WEIGHT } });
    expect(questionTermsOf(ledger, PAPER).sort()).toEqual(["annealing", "grain"]);
  });

  it("counts a paper once: the same terms again change nothing, and the first time stays", () => {
    const once = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    const twice = applyQuestionTermSignal(once, PAPER, ["grain"], "2026-02-01T00:00:00.000Z");
    expect(twice).toEqual(once);
  });

  it("two papers asking about one term add two pieces of evidence", () => {
    let ledger = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    ledger = applyQuestionTermSignal(ledger, OTHER, ["grain"], T0);
    expect(Object.keys(ledger[preferenceKey("grain")].questions ?? {})).toHaveLength(2);
  });

  it("replaces the paper's terms: one a later settle dropped is taken out, the others stay", () => {
    let ledger = applyQuestionTermSignal({}, PAPER, ["annealing", "grain"], T0);
    ledger = applyQuestionTermSignal(ledger, OTHER, ["annealing"], T0);
    ledger = applyQuestionTermSignal(ledger, PAPER, ["grain"], T0);
    expect(questionTermsOf(ledger, PAPER)).toEqual(["grain"]);
    expect(questionTermsOf(ledger, OTHER)).toEqual(["annealing"]);
    expect(ledger[preferenceKey("annealing")].questions).toEqual({
      [questionSourceKey(OTHER)]: { at: T0, weight: QUESTION_TERM_WEIGHT },
    });
  });

  it("no terms and no earlier evidence leaves the ledger as it was", () => {
    const likes = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    expect(applyQuestionTermSignal(likes, PAPER, [], T0)).toEqual(cleanPreferenceLedger(likes));
  });
});

describe("removeQuestionTermSignal", () => {
  it("takes out exactly what the paper added and no other signal", () => {
    let ledger: PreferenceLedger = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    ledger = applyUploadPreferenceSignal(ledger, [
      { key: preferenceKey("grain"), label: "grain", source: "uploaded_article", confidence: 0.8 },
    ], "d".repeat(64), T0);
    ledger = applyQuestionTermSignal(ledger, PAPER, ["grain", "annealing"], T0);
    ledger = applyQuestionTermSignal(ledger, OTHER, ["grain"], T0);
    const before = cleanPreferenceLedger(ledger);

    const after = removeQuestionTermSignal(ledger, PAPER);
    const grain = after[preferenceKey("grain")];
    expect(grain.positive).toBe(1);
    expect(Object.keys(grain.uploads ?? {})).toEqual(["d".repeat(64)]);
    expect(Object.keys(grain.questions ?? {})).toEqual([questionSourceKey(OTHER)]);
    expect(after[preferenceKey("annealing")]).toBeUndefined();
    expect(questionTermsOf(after, PAPER)).toEqual([]);
    // Everything but the two removed pieces is as it was.
    expect({ ...after[preferenceKey("grain")], questions: undefined }).toEqual({ ...before[preferenceKey("grain")], questions: undefined });
  });

  it("an entry that was a like keeps being one, and an entry only a question made is gone", () => {
    const liked = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    const both = applyQuestionTermSignal(liked, PAPER, ["grain"], T0);
    const back = removeQuestionTermSignal(both, PAPER);
    expect(back).toEqual(cleanPreferenceLedger(liked));
    expect(removeQuestionTermSignal(applyQuestionTermSignal({}, PAPER, ["grain"], T0), PAPER)).toEqual({});
  });

  it("without evidence for the paper the ledger comes back as the cleaned one", () => {
    const likes = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    expect(removeQuestionTermSignal(likes, PAPER)).toEqual(cleanPreferenceLedger(likes));
  });
});

describe("cleanPreferenceLedger and the evidence", () => {
  it("a ledger with no question evidence has no `questions` key anywhere (byte-identical to before)", () => {
    const likes = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    expect(JSON.stringify(cleanPreferenceLedger(likes))).not.toContain("questions");
    const removed = removeQuestionTermSignal(applyQuestionTermSignal(likes, PAPER, ["grain"], T0), PAPER);
    expect(JSON.stringify(removed)).toBe(JSON.stringify(cleanPreferenceLedger(likes)));
  });

  it("keeps good evidence through cleaning, caps its weight, and drops a malformed one", () => {
    const base = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    const key = preferenceKey("grain");
    const dirty = {
      [key]: {
        ...base[key],
        questions: {
          [questionSourceKey(PAPER)]: { at: T0, weight: 5 },
          [questionSourceKey(OTHER)]: { at: "not a date", weight: QUESTION_TERM_WEIGHT },
          "not-a-key": { at: T0, weight: QUESTION_TERM_WEIGHT },
          [questionSourceKey("x")]: { at: T0, weight: -1 },
        },
      },
    } as PreferenceLedger;
    expect(cleanPreferenceLedger(dirty)[key].questions).toEqual({
      [questionSourceKey(PAPER)]: { at: T0, weight: QUESTION_TERM_WEIGHT },
    });
  });
});

describe("gradual: one settled question does not reorder what an explicit like would", () => {
  const rival = item("Notes on annealing schedules", []);
  const target = item("A survey of grain refinement", ["grain"]);

  it("moves the boost by far less than a like and below the gap that a like crosses", () => {
    const like = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    const question = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    const boostOf = (ledger: PreferenceLedger) =>
      scorePreferenceMatch(target, prepareLedger(ledger), [], { now: T0_MS }).boost;
    const likeBoost = boostOf(like);
    const questionBoost = boostOf(question);
    expect(questionBoost).toBeGreaterThan(0);
    expect(questionBoost).toBeLessThan(likeBoost / 3);

    // Rival leads the target by a gap between the two boosts: a like flips the top
    // result, one settled question does not.
    const gap = (likeBoost + questionBoost) / 2;
    const base = { rival: 0.5, target: 0.5 - gap };
    const top = (ledger: PreferenceLedger) => {
      const prepared = prepareLedger(ledger);
      const score = (it: RawItem, b: number) => b + scorePreferenceMatch(it, prepared, [], { now: T0_MS }).boost;
      return score(target, base.target) > score(rival, base.rival) ? "target" : "rival";
    };
    expect(top({})).toBe("rival");
    expect(top(question)).toBe("rival");
    expect(top(like)).toBe("target");
  });

  it("matches the words of a candidate's title at a word boundary, like an upload's concept", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    const prepared = prepareLedger(ledger);
    expect(scorePreferenceMatch(item("On grain growth"), prepared, [], { now: T0_MS }).boost).toBeGreaterThan(0);
    expect(scorePreferenceMatch(item("On migraine growth"), prepared, [], { now: T0_MS }).boost).toBe(0);
  });

  it("fades with the ledger's half-life like every other evidence", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    const prepared = prepareLedger(ledger);
    const fresh = scorePreferenceMatch(target, prepared, [], { now: T0_MS }).boost;
    const old = scorePreferenceMatch(target, prepared, [], { now: Date.parse("2027-01-01T00:00:00.000Z") }).boost;
    expect(old).toBeLessThan(fresh);
  });
});

describe("the profile screen's summary", () => {
  it("does not list a term only a question holds", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, ["grain"], T0);
    expect(summarizePreferenceLedger(ledger, T0_MS)).toEqual({ liked: [], disliked: [] });
  });
});
