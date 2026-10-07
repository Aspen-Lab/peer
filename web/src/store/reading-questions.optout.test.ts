import { beforeEach, describe, expect, it } from "vitest";
import { notForRecommendations, useReadingQuestionsStore } from "./reading-questions";

// P5-02 (blueprint P5, brief commit 2): a question can be marked "Not for
// recommendations". The mark is per question, kept with the paper's questions in
// this browser, and an entry saved before it existed loads with nothing marked.
// The questions are invented for these tests.

const PAPER = "openalex:W9";
const AT = "2026-10-07T00:00:00.000Z";
const A = "Does annealing coarsen the grain boundaries?";
const B = "Is the electrolyte stable against dendrites?";

const entry = () => useReadingQuestionsStore.getState().byPaper[PAPER];
const store = () => useReadingQuestionsStore.getState();

describe("the not-for-recommendations mark", () => {
  beforeEach(() => useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null }));

  it("is kept with the questions it names, and only those", () => {
    store().set(PAPER, [A, B], false, AT, [B, "A question that is not here"]);
    expect(entry().notForRecs).toEqual([B]);
  });

  it("matches a question without regard to case or surrounding spaces, and keeps the question's own text", () => {
    store().set(PAPER, [A, B], false, AT, [`  ${B.toUpperCase()} `]);
    expect(entry().notForRecs).toEqual([B]);
  });

  it("is absent when nothing is marked, so an entry looks as it did before", () => {
    store().set(PAPER, [A, B], false, AT);
    expect("notForRecs" in entry()).toBe(false);
    store().set(PAPER, [A, B], false, AT, [B]);
    store().set(PAPER, [A, B], false, AT, []);
    expect("notForRecs" in entry()).toBe(false);
  });

  it("an entry saved before the mark existed loads unmarked", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [A], gist: false, updatedAt: AT, settled: [A] } },
    });
    expect(notForRecommendations(entry())).toEqual([]);
  });

  it("a set that does not say keeps the marks of the questions still there", () => {
    store().set(PAPER, [A, B], false, AT, [B]);
    store().set(PAPER, [B], false, AT);
    expect(entry().notForRecs).toEqual([B]);
    store().set(PAPER, [A], false, AT);
    expect("notForRecs" in entry()).toBe(false);
  });

  it("settling remembers which settled questions were marked", () => {
    store().set(PAPER, [A, B], false, AT, [A]);
    store().settle(PAPER);
    expect(entry().settled).toEqual([A, B]);
    expect(entry().settledNotForRecs).toEqual([A]);
  });

  it("a mark changed after settling changes what the next settle remembers", () => {
    store().set(PAPER, [A, B], false, AT, [A]);
    store().settle(PAPER);
    store().set(PAPER, [A, B], false, AT, []);
    expect(entry().settledNotForRecs).toEqual([A]);
    store().settle(PAPER);
    expect("settledNotForRecs" in entry()).toBe(false);
  });

  it("names both the live and the settled marks as the questions kept out of the ledger", () => {
    store().set(PAPER, [A, B], false, AT, [A]);
    store().settle(PAPER);
    store().set(PAPER, [A, B], false, AT, [B]);
    expect(notForRecommendations(entry()).sort()).toEqual([A, B]);
    expect(notForRecommendations(undefined)).toEqual([]);
  });
});
