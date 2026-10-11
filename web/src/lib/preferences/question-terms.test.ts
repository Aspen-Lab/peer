import { describe, expect, it } from "vitest";
import { specificTerms } from "@/lib/papers/reading-map";
import { questionTerms } from "./question-terms";

// P5-04 (S4): `questionTerms` returns each term with its share; these P5-02 cases are about which
// words come out, so they read the names (the shares are `ledger.questions.share.test.ts`).
const names = (questions: readonly string[], marked: readonly string[] = []) => questionTerms(questions, marked).map((t) => t.term);

// P5-02 (blueprint P5, brief): the terms of a settled question that may enter the
// preference ledger. Only the reading map's own specific terms (`specificTerms`:
// `tokenize` minus the generic and route-stoplist words), lower-cased, one per
// canonical form, across the paper's questions — never the question's text. The
// sentences below are invented for these tests.

const GRAIN = "Does annealing coarsen the grain boundaries in copper films?";
const VAGUE = "What do the results say about the method?";

describe("questionTerms", () => {
  it("is the reading map's specific terms, nothing else", () => {
    expect(names([GRAIN])).toEqual(specificTerms(GRAIN));
    expect(names([GRAIN]).length).toBeGreaterThanOrEqual(3);
  });

  it("leaves the generic and question words out", () => {
    const terms = names([VAGUE, GRAIN]);
    for (const generic of ["what", "results", "result", "method", "say", "does", "about"]) {
      expect(terms).not.toContain(generic);
    }
    expect(names([VAGUE])).toEqual(specificTerms(VAGUE));
  });

  // P9-05 (X12): `questionTerms` calls `specificTerms`, so a function word is no more a ledger term
  // than it is a tint's term — the same narrowing, one list.
  it("leaves the function words out of the ledger as it leaves them out of the tints (P9-05, X12)", () => {
    const question = "How does the film change after 80 cycles?";

    expect(names([question])).toEqual(["film", "change", "cycles"]);
    expect(names([question])).toEqual(specificTerms(question));
    for (const word of ["after", "before", "during", "between", "within", "through", "across", "against", "among", "without", "also", "only", "very", "more", "most", "less", "than", "then", "when", "where", "while", "however", "therefore", "which", "whose"]) {
      expect(names([`film ${word} cycles`]), word).toEqual(["film", "cycles"]);
    }
  });

  it("is lower case, one word each, and never carries the question's text", () => {
    const terms = names([GRAIN]);
    for (const term of terms) {
      expect(term).toBe(term.toLowerCase());
      expect(term).not.toMatch(/\s/);
      expect(term.length).toBeLessThan(GRAIN.length);
    }
    expect(terms.join(" ")).not.toContain(GRAIN.toLowerCase());
  });

  it("counts a term once across a paper's questions", () => {
    const again = "Do annealing temperatures change grain size?";
    const terms = names([GRAIN, again]);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.filter((t) => t === "annealing")).toHaveLength(1);
    expect(terms.filter((t) => t === "grain")).toHaveLength(1);
  });

  it("a repeated question gives the same terms as one", () => {
    expect(names([GRAIN, GRAIN])).toEqual(names([GRAIN]));
  });

  it("leaves out a question marked not for recommendations, matched on trimmed, case-folded text", () => {
    const other = "Is the electrolyte stable against lithium dendrites?";
    expect(names([GRAIN, other], [`  ${GRAIN.toUpperCase()} `])).toEqual(names([other]));
    expect(names([GRAIN, other], [GRAIN, other])).toEqual([]);
  });

  it("a term shared with a question that is not opted out stays", () => {
    const other = "Do annealing temperatures change grain size?";
    const kept = names([GRAIN, other], [GRAIN]);
    expect(kept).toEqual(names([other]));
    expect(kept).toContain("annealing");
  });

  it("is empty with no questions, or only vague ones", () => {
    expect(names([])).toEqual([]);
    expect(names(["", "   "])).toEqual([]);
    expect(names(["What about this?"])).toEqual([]);
  });
});
