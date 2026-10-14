import { beforeEach, describe, expect, it } from "vitest";
import * as questions from "./reading-questions";
import { MAX_QUESTIONS, useReadingQuestionsStore, type PaperQuestions } from "./reading-questions";

// P5-02 (blueprint P5, brief commit 2) gave each question an opt-out mark, kept with the paper's
// questions. P10-03 (round P10, review 2.3) takes the mark away: the one opt-out is a switch on the Profile
// (`profile.questionsTuneRecommendations`, ruling §1h.78). The mark's storage keys are ignored, not migrated: an
// entry saved with them loads, is read as if they were not there, and a write drops them. The tests of the mark —
// "is kept with the questions it names", "matches a question without regard to case", "is absent when nothing is
// marked", "an entry saved before the mark existed loads unmarked", "a set that does not say keeps the marks",
// "settling remembers which settled questions were marked", "a mark changed after settling …" and "names both the
// live and the settled marks" — are re-aimed below to the contract that replaced them. The questions are invented.

const PAPER = "openalex:W9";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";

const entry = () => useReadingQuestionsStore.getState().byPaper[PAPER];
const store = () => useReadingQuestionsStore.getState();
/** An entry as an earlier version of the app saved it, marks and all. */
const legacy = (extra: Record<string, unknown> = {}) =>
  ({ items: [A, B], gist: false, updatedAt: AT, settled: [A, B], notForRecs: [B], settledNotForRecs: [A], ...extra }) as unknown as PaperQuestions;

describe("the per-question mark is gone from the store", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  it("exports no mark reader, and `set` takes no marks", () => {
    expect("notForRecommendations" in questions).toBe(false);
    expect(store().set.length).toBeLessThanOrEqual(4);
  });

  it("an entry saved with marks loads, and the marks are read by nothing: the questions are as they were", () => {
    useReadingQuestionsStore.setState({ byPaper: { [PAPER]: legacy() } });
    expect(questions.settledQuestions(entry())).toEqual([A, B]);
    expect(entry().items).toEqual([A, B]);
  });

  it("a write drops the stored marks: `set` keeps no notForRecs, and the settled marks go with the next settle", () => {
    useReadingQuestionsStore.setState({ byPaper: { [PAPER]: legacy() } });
    store().set(PAPER, [A, B], false, AT);
    expect("notForRecs" in entry()).toBe(false);
    expect("settledNotForRecs" in entry()).toBe(false);
    // `settle` rebuilds the entry field by field, so a legacy mark cannot survive it either.
    useReadingQuestionsStore.setState({ byPaper: { [PAPER]: legacy({ settled: undefined }) } });
    store().settle(PAPER);
    expect(Object.keys(entry()).sort()).toEqual(["gist", "items", "settled", "updatedAt"]);
    expect(entry().settled).toEqual([A, B]);
  });

  it("settling twice with the same questions changes nothing, with or without legacy marks", () => {
    store().set(PAPER, [A], false, AT);
    store().settle(PAPER);
    const first = entry();
    store().settle(PAPER);
    expect(entry()).toBe(first);
    useReadingQuestionsStore.setState({ byPaper: { [PAPER]: legacy({ items: [A], settled: [A] }) } });
    const before = store().byPaper;
    store().settle(PAPER);
    expect(store().byPaper).toBe(before);
  });

  it("still keeps five stored questions: MAX_QUESTIONS stays 5 for data stored before the one-question bar", () => {
    expect(MAX_QUESTIONS).toBe(5);
    const six = ["a one?", "b two?", "c three?", "d four?", "e five?", "f six?"];
    store().set(PAPER, six, false, AT);
    expect(entry().items).toEqual(six.slice(0, 5));
  });
});
