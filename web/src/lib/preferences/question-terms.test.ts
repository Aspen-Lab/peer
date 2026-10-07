import { describe, expect, it } from "vitest";
import { specificTerms } from "@/lib/papers/reading-map";
import { questionTerms } from "./question-terms";

// P5-02 (blueprint P5, brief): the terms of a settled question that may enter the
// preference ledger. Only the reading map's own specific terms (`specificTerms`:
// `tokenize` minus the generic and route-stoplist words), lower-cased, one per
// canonical form, across the paper's questions — never the question's text. The
// sentences below are invented for these tests.

const GRAIN = "Does annealing coarsen the grain boundaries in copper films?";
const VAGUE = "What do the results say about the method?";

describe("questionTerms", () => {
  it("is the reading map's specific terms, nothing else", () => {
    expect(questionTerms([GRAIN])).toEqual(specificTerms(GRAIN));
    expect(questionTerms([GRAIN]).length).toBeGreaterThanOrEqual(3);
  });

  it("leaves the generic and question words out", () => {
    const terms = questionTerms([VAGUE, GRAIN]);
    for (const generic of ["what", "results", "result", "method", "say", "does", "about"]) {
      expect(terms).not.toContain(generic);
    }
    expect(questionTerms([VAGUE])).toEqual(specificTerms(VAGUE));
  });

  it("is lower case, one word each, and never carries the question's text", () => {
    const terms = questionTerms([GRAIN]);
    for (const term of terms) {
      expect(term).toBe(term.toLowerCase());
      expect(term).not.toMatch(/\s/);
      expect(term.length).toBeLessThan(GRAIN.length);
    }
    expect(terms.join(" ")).not.toContain(GRAIN.toLowerCase());
  });

  it("counts a term once across a paper's questions", () => {
    const again = "Do annealing temperatures change grain size?";
    const terms = questionTerms([GRAIN, again]);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.filter((t) => t === "annealing")).toHaveLength(1);
    expect(terms.filter((t) => t === "grain")).toHaveLength(1);
  });

  it("a repeated question gives the same terms as one", () => {
    expect(questionTerms([GRAIN, GRAIN])).toEqual(questionTerms([GRAIN]));
  });

  it("leaves out a question marked not for recommendations, matched on trimmed, case-folded text", () => {
    const other = "Is the electrolyte stable against lithium dendrites?";
    expect(questionTerms([GRAIN, other], [`  ${GRAIN.toUpperCase()} `])).toEqual(questionTerms([other]));
    expect(questionTerms([GRAIN, other], [GRAIN, other])).toEqual([]);
  });

  it("a term shared with a question that is not opted out stays", () => {
    const other = "Do annealing temperatures change grain size?";
    const kept = questionTerms([GRAIN, other], [GRAIN]);
    expect(kept).toEqual(questionTerms([other]));
    expect(kept).toContain("annealing");
  });

  it("is empty with no questions, or only vague ones", () => {
    expect(questionTerms([])).toEqual([]);
    expect(questionTerms(["", "   "])).toEqual([]);
    expect(questionTerms(["What about this?"])).toEqual([]);
  });
});
