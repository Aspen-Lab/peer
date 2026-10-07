import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { QUESTION_TERM_WEIGHT, applyPreferenceSignal, questionTermsOf, termConcept } from "@/lib/preferences/ledger";
import { useProfileStore } from "./profile";

// P5-02 (blueprint P5, brief commit 2): the profile store writes a paper's
// settled-question terms into the ledger, once per call, and touches nothing when
// there is nothing to change. Invented words only.

const PAPER = "openalex:W9";
// P5-04 (S4): the store takes terms with their shares; these P5-02 cases are about when it writes, so
// each term comes at the whole weight (the sharing is `ledger.questions.share.test.ts`).
const full = (...words: string[]) => words.map((term) => ({ term, weight: QUESTION_TERM_WEIGHT }));
const store = () => useProfileStore.getState();

describe("recordQuestionTerms", () => {
  beforeEach(() => useProfileStore.setState({ profile: { ...defaultProfile } }));

  it("puts the terms in the ledger and a second call with the same terms changes nothing", () => {
    store().recordQuestionTerms(PAPER, full("annealing", "grain"));
    expect(questionTermsOf(store().profile.preferenceLedger, PAPER).sort()).toEqual(["annealing", "grain"]);
    const before = store().profile;
    store().recordQuestionTerms(PAPER, full("grain", "annealing"));
    expect(store().profile).toBe(before);
  });

  it("with no terms and nothing held leaves the profile, and its ledger, untouched", () => {
    const before = store().profile;
    store().recordQuestionTerms(PAPER, []);
    expect(store().profile).toBe(before);
    expect(JSON.stringify(store().profile.preferenceLedger)).toBe(JSON.stringify(before.preferenceLedger));
  });

  it("takes the paper's terms out when none are left, and leaves a like alone", () => {
    const liked = applyPreferenceSignal({}, [termConcept("grain")], "positive", { at: "2026-10-01T00:00:00.000Z" });
    useProfileStore.setState({ profile: { ...defaultProfile, preferenceLedger: liked } });
    store().recordQuestionTerms(PAPER, full("grain", "annealing"));
    store().recordQuestionTerms(PAPER, []);
    expect(questionTermsOf(store().profile.preferenceLedger, PAPER)).toEqual([]);
    expect(store().profile.preferenceLedger?.["text:grain"]?.positive).toBe(1);
    expect(store().profile.preferenceLedger?.["text:annealing"]).toBeUndefined();
  });
});
