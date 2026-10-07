import { describe, expect, it } from "vitest";
import {
  QUESTION_TERM_WEIGHT,
  applyPreferenceSignal,
  applyQuestionTermSignal,
  cleanPreferenceLedger,
  prepareLedger,
  preferenceKey,
  questionSourceKey,
  questionTermsOf,
  scorePreferenceMatch,
  termConcept,
} from "./ledger";
import { questionTerms } from "./question-terms";
import type { PreferenceLedger } from "@/types";
import type { RawItem } from "@/lib/sources/types";

// P5-04 (S4, §1h.15 (d)): one question is one signal. A measured that every term of a question
// carried the full QUESTION_TERM_WEIGHT, so a five-term question on a candidate that holds all five
// words outweighed a like. A question's evidence now totals QUESTION_TERM_WEIGHT whatever its term
// count: each term of a question that has n specific terms gets QUESTION_TERM_WEIGHT / n; a term two
// questions of one paper both name takes the larger share, not the sum. The words are invented.

const T0 = "2026-01-01T00:00:00.000Z";
const T0_MS = Date.parse(T0);
const PAPER = "openalex:W321";
const OTHER = "arxiv:2402.00002";

// Twenty-one made-up words, none of them a stop or a generic word.
const WORDS = [
  "bexalt", "corvane", "dromil", "eskarn", "fyrmod", "galtrix", "hovane", "ixmera", "jaltrin", "kovrex",
  "lumbrel", "mervane", "nostrix", "olvane", "pyrmex", "quendal", "ravelt", "sorvex", "tamrin", "ulvane", "wexmar",
];
/** A question whose specific terms are exactly these words ("is" is not one). */
const asking = (words: readonly string[]) => `Is ${words.join(" ")}?`;
const names = (questions: string[], marked: string[] = []) => questionTerms(questions, marked).map((t) => t.term);
const sum = (shares: readonly { weight: number }[]) => shares.reduce((total, share) => total + share.weight, 0);

const item = (title: string, tags: string[] = []): RawItem => ({
  id: title, source: "openalex", title, authors: [], url: "", publishedAt: "", tags, metadata: {},
});

/** What the ledger holds as this paper's evidence on a candidate that carries `words`. */
function carried(ledger: PreferenceLedger, paperId: string, words: readonly string[]): number {
  const source = questionSourceKey(paperId);
  return Object.values(cleanPreferenceLedger(ledger))
    .filter((entry) => words.includes(entry.label))
    .reduce((total, entry) => total + (entry.questions?.[source]?.weight ?? 0), 0);
}

describe("questionTerms — one question, one signal", () => {
  it("returns each term with its share: QUESTION_TERM_WEIGHT / n of its own question", () => {
    const terms = questionTerms([asking(WORDS.slice(0, 4))]);
    expect(terms.map((t) => t.term)).toEqual(WORDS.slice(0, 4));
    for (const share of terms) expect(share.weight).toBeCloseTo(QUESTION_TERM_WEIGHT / 4, 12);
  });

  it("a 1-term, a 5-term and a 21-term question each total QUESTION_TERM_WEIGHT", () => {
    for (const n of [1, 5, 21]) {
      const terms = questionTerms([asking(WORDS.slice(0, n))]);
      expect(terms).toHaveLength(n);
      expect(sum(terms)).toBeCloseTo(QUESTION_TERM_WEIGHT, 12);
      for (const share of terms) expect(share.weight).toBeLessThanOrEqual(QUESTION_TERM_WEIGHT);
    }
  });

  it("and so does the ledger, on a candidate that carries all of a question's words", () => {
    for (const n of [1, 5, 21]) {
      const words = WORDS.slice(0, n);
      const ledger = applyQuestionTermSignal({}, PAPER, questionTerms([asking(words)]), T0);
      expect(carried(ledger, PAPER, words)).toBeCloseTo(QUESTION_TERM_WEIGHT, 12);
    }
  });

  it("two questions of one paper total at most twice that; a word both name takes the larger share, not the sum", () => {
    const apart = questionTerms([asking(WORDS.slice(0, 3)), asking(WORDS.slice(3, 8))]);
    expect(sum(apart)).toBeCloseTo(2 * QUESTION_TERM_WEIGHT, 12);

    const shared = questionTerms([asking(WORDS.slice(0, 3)), asking([WORDS[2], WORDS[3]])]);
    const byTerm = Object.fromEntries(shared.map((t) => [t.term, t.weight]));
    expect(byTerm[WORDS[2]]).toBeCloseTo(QUESTION_TERM_WEIGHT / 2, 12);
    expect(byTerm[WORDS[0]]).toBeCloseTo(QUESTION_TERM_WEIGHT / 3, 12);
    expect(sum(shared)).toBeLessThan(2 * QUESTION_TERM_WEIGHT);
    expect(sum(shared)).toBeLessThanOrEqual(0.4);
  });

  it("the order of the questions does not change a share", () => {
    const a = asking(WORDS.slice(0, 3));
    const b = asking([WORDS[2], WORDS[3]]);
    const byTerm = (list: { term: string; weight: number }[]) => Object.fromEntries(list.map((t) => [t.term, t.weight]));
    expect(byTerm(questionTerms([a, b]))).toEqual(byTerm(questionTerms([b, a])));
  });

  it("a repeated question is one question; a ticked one contributes nothing to the sharing", () => {
    const a = asking(WORDS.slice(0, 3));
    expect(questionTerms([a, a])).toEqual(questionTerms([a]));
    expect(questionTerms([a, asking(WORDS.slice(3, 5))], [a])).toEqual(questionTerms([asking(WORDS.slice(3, 5))]));
  });

  it("the shares count the terms the question kept, not the words it was typed with", () => {
    // A shape the rule drops (P5-04, S2) does not take a share of the question.
    const withKey = `Is ${WORDS.slice(0, 2).join(" ")} Fq83Lm20Zr45Tv91Xb70?`;
    const terms = questionTerms([withKey]);
    expect(terms.map((t) => t.term)).toEqual(WORDS.slice(0, 2));
    expect(sum(terms)).toBeCloseTo(QUESTION_TERM_WEIGHT, 12);
  });

  it("a question with nothing specific has no terms, and no share", () => {
    expect(names(["What about this?"])).toEqual([]);
  });
});

describe("applyQuestionTermSignal — the share is what the entry holds", () => {
  it("writes each term's share into its `questions` record, separate from likes and dislikes", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, questionTerms([asking(WORDS.slice(0, 5))]), T0);
    for (const word of WORDS.slice(0, 5)) {
      const entry = ledger[preferenceKey(word)];
      expect(entry.positive).toBe(0);
      expect(entry.questions?.[questionSourceKey(PAPER)]?.weight).toBeCloseTo(QUESTION_TERM_WEIGHT / 5, 12);
    }
    expect(questionTermsOf(ledger, PAPER).sort()).toEqual(WORDS.slice(0, 5).sort());
  });

  it("the cleaner keeps a share as it is, and still caps a weight at QUESTION_TERM_WEIGHT", () => {
    const base = applyQuestionTermSignal({}, PAPER, questionTerms([asking(WORDS.slice(0, 5))]), T0);
    expect(carried(JSON.parse(JSON.stringify(base)) as PreferenceLedger, PAPER, WORDS.slice(0, 5))).toBeCloseTo(QUESTION_TERM_WEIGHT, 12);
    const key = preferenceKey(WORDS[0]);
    const dirty = { [key]: { ...base[key], questions: { [questionSourceKey(PAPER)]: { at: T0, weight: 5 } } } } as PreferenceLedger;
    expect(cleanPreferenceLedger(dirty)[key].questions?.[questionSourceKey(PAPER)]?.weight).toBe(QUESTION_TERM_WEIGHT);
  });

  it("the same shares again change nothing; a changed share replaces the weight and keeps the first time", () => {
    const once = applyQuestionTermSignal({}, PAPER, questionTerms([asking(WORDS.slice(0, 2))]), T0);
    expect(applyQuestionTermSignal(once, PAPER, questionTerms([asking(WORDS.slice(0, 2))]), "2026-02-01T00:00:00.000Z")).toEqual(once);

    // The reader edits the question down to one word: that word's share grows, the other leaves.
    const narrowed = applyQuestionTermSignal(once, PAPER, questionTerms([asking([WORDS[0]])]), "2026-02-01T00:00:00.000Z");
    expect(narrowed[preferenceKey(WORDS[0])].questions?.[questionSourceKey(PAPER)]).toEqual({ at: T0, weight: QUESTION_TERM_WEIGHT });
    expect(narrowed[preferenceKey(WORDS[1])]).toBeUndefined();
  });

  it("two papers asking about one word are two pieces of evidence, each its own share", () => {
    let ledger = applyQuestionTermSignal({}, PAPER, questionTerms([asking([WORDS[0], WORDS[1]])]), T0);
    ledger = applyQuestionTermSignal(ledger, OTHER, questionTerms([asking([WORDS[0]])]), T0);
    const held = ledger[preferenceKey(WORDS[0])].questions ?? {};
    expect(held[questionSourceKey(PAPER)].weight).toBeCloseTo(QUESTION_TERM_WEIGHT / 2, 12);
    expect(held[questionSourceKey(OTHER)].weight).toBeCloseTo(QUESTION_TERM_WEIGHT, 12);
  });
});

describe("gradual: a question with many words does not outweigh a like", () => {
  const rival = item("Notes on annealing schedules");
  const five = WORDS.slice(0, 5);
  // A candidate carrying all five words of the five-term question — the fixture A measured. A like
  // is matched through a tag; a question's words are matched in the title's own words.
  const target = item(`A survey of ${five.join(" ")} in thin films`, [five[0]]);
  const boostOf = (ledger: PreferenceLedger, candidate: RawItem = target) =>
    scorePreferenceMatch(candidate, prepareLedger(ledger), [], { now: T0_MS }).boost;

  it("on A's fixture a like flips the top result and the five-term question does not", () => {
    const like = applyPreferenceSignal({}, [termConcept(five[0])], "positive", { at: T0 });
    const question = applyQuestionTermSignal({}, PAPER, questionTerms([asking(five)]), T0);
    const likeBoost = boostOf(like);
    const questionBoost = boostOf(question);
    expect(likeBoost).toBeGreaterThan(0);
    expect(questionBoost).toBeLessThan(likeBoost);

    // The rival leads by a gap that sits between the two boosts.
    const gap = likeBoost / 2 + questionBoost / 2;
    const top = (ledger: PreferenceLedger) => {
      const prepared = prepareLedger(ledger);
      const score = (it: RawItem, base: number) => base + scorePreferenceMatch(it, prepared, [], { now: T0_MS }).boost;
      return score(target, 0.5 - gap) > score(rival, 0.5) ? "target" : "rival";
    };
    expect(top({})).toBe("rival");
    expect(top(question)).toBe("rival");
    expect(top(like)).toBe("target");
  });

  it("whatever its length, a question moves a candidate that carries all its words by under a third of one like", () => {
    const like = boostOf(applyPreferenceSignal({}, [termConcept(WORDS[0])], "positive", { at: T0 }), item(`On ${WORDS[0]}`, [WORDS[0]]));
    for (const n of [1, 2, 3, 5, 8, 21]) {
      const words = WORDS.slice(0, n);
      const ledger = applyQuestionTermSignal({}, PAPER, questionTerms([asking(words)]), T0);
      expect(boostOf(ledger, item(`On ${words.join(" ")}`))).toBeLessThan(like / 3);
    }
  });

  it("five settled questions of one paper, on a candidate carrying every word, stay far below the cap; only many papers reach it", () => {
    // 0.18 is the ledger's POSITIVE_BOOST_MAX; one like is worth about 0.053 here (0.75 specificity).
    const threeEach = [0, 1, 2, 3, 4].map((i) => asking(WORDS.slice(i * 3, i * 3 + 3)));
    const onePaper = applyQuestionTermSignal({}, PAPER, questionTerms(threeEach), T0);
    const all = item(`On ${WORDS.slice(0, 15).join(" ")}`);
    expect(boostOf(onePaper, all)).toBeLessThan(0.18 / 2);

    let manyPapers: PreferenceLedger = {};
    for (let i = 0; i < 40; i++) manyPapers = applyQuestionTermSignal(manyPapers, `openalex:W${i}`, questionTerms([asking(WORDS.slice(0, 3))]), T0);
    expect(boostOf(manyPapers, item(`On ${WORDS.slice(0, 3).join(" ")}`))).toBeCloseTo(0.18, 9);
  });
});
