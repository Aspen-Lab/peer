import { describe, expect, it } from "vitest";
import {
  QUESTION_TERM_WEIGHT,
  applyPreferenceSignal,
  applyQuestionTermSignal,
  applyUploadPreferenceSignal,
  cleanPreferenceLedger,
  preferenceKey,
  questionSourceKey,
  removeQuestionTermSignal,
  termConcept,
} from "./ledger";
import type { PreferenceLedger } from "@/types";

// P5-04 (S6, §1h.15 (f)): `removeQuestionTermSignal` deletes an entry only when nothing else holds
// it — no like, no dislike, no facet evidence, no upload. A measured that dropping the uploads
// clause, or the dislike clause, survived the whole suite: the existing "takes out exactly" test
// holds a like on the shared word, so it never reached the other clauses. The code was right; these
// pin it. The words and the paper are invented.

const T0 = "2026-01-01T00:00:00.000Z";
const PAPER = "openalex:W909";
const DOC = "e".repeat(64);
const full = (...words: string[]) => words.map((term) => ({ term, weight: QUESTION_TERM_WEIGHT }));
const GRAIN = preferenceKey("grain");

describe("removing a question's words keeps whatever else holds the entry", () => {
  it("an entry holding only an upload's evidence and a question's keeps the upload when the question goes", () => {
    let ledger: PreferenceLedger = applyUploadPreferenceSignal({}, [
      { key: GRAIN, label: "grain", source: "uploaded_article", confidence: 0.8 },
    ], DOC, T0);
    // The upload alone leaves no like and no dislike on the entry: the uploads clause is all that keeps it.
    expect(ledger[GRAIN].positive).toBe(0);
    expect(ledger[GRAIN].negative).toBe(0);
    ledger = applyQuestionTermSignal(ledger, PAPER, full("grain"), T0);
    expect(Object.keys(ledger[GRAIN].questions ?? {})).toEqual([questionSourceKey(PAPER)]);

    const after = removeQuestionTermSignal(ledger, PAPER);
    expect(after[GRAIN]).toBeDefined();
    expect(Object.keys(after[GRAIN].uploads ?? {})).toEqual([DOC]);
    expect(after[GRAIN].questions).toBeUndefined();
  });

  it("an entry holding only a dislike and a question's keeps the dislike when the question goes", () => {
    let ledger: PreferenceLedger = applyPreferenceSignal({}, [termConcept("grain")], "negative", { at: T0 });
    expect(ledger[GRAIN].positive).toBe(0);
    expect(ledger[GRAIN].negative).toBeGreaterThan(0);
    ledger = applyQuestionTermSignal(ledger, PAPER, full("grain"), T0);

    const after = removeQuestionTermSignal(ledger, PAPER);
    expect(after[GRAIN]).toBeDefined();
    expect(after[GRAIN].negative).toBe(ledger[GRAIN].negative);
    expect(after[GRAIN].questions).toBeUndefined();
  });

  it("an entry holding only a like and a question's keeps the like (the clause the earlier test reaches)", () => {
    let ledger: PreferenceLedger = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: T0 });
    ledger = applyQuestionTermSignal(ledger, PAPER, full("grain"), T0);
    const after = removeQuestionTermSignal(ledger, PAPER);
    expect(after[GRAIN].positive).toBe(1);
  });

  it("an entry holding facet evidence and a question's keeps it (a hand-built entry: facet entries are keyed apart, so only a ledger from outside can have both)", () => {
    const held = applyQuestionTermSignal({}, PAPER, full("grain"), T0);
    const ledger = { ...held, [GRAIN]: { ...held[GRAIN], facetPositive: 1, lastFacetAt: T0 } } as PreferenceLedger;
    expect(cleanPreferenceLedger(ledger)[GRAIN].facetPositive).toBe(1);

    const after = removeQuestionTermSignal(ledger, PAPER);
    expect(after[GRAIN]).toBeDefined();
    expect(after[GRAIN].facetPositive).toBe(1);
  });

  it("an entry only a question made still goes with it", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, full("grain"), T0);
    expect(removeQuestionTermSignal(ledger, PAPER)).toEqual({});
  });
});
