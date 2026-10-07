import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { applyPreferenceSignal, questionTermsOf, termConcept } from "@/lib/preferences/ledger";
import { useProfileStore } from "./profile";

// P5-02 (blueprint P5, brief commit 2): the profile store writes a paper's
// settled-question terms into the ledger, once per call, and touches nothing when
// there is nothing to change. Invented words only.

const PAPER = "openalex:W9";
const store = () => useProfileStore.getState();

describe("recordQuestionTerms", () => {
  beforeEach(() => useProfileStore.setState({ profile: { ...defaultProfile } }));

  it("puts the terms in the ledger and a second call with the same terms changes nothing", () => {
    store().recordQuestionTerms(PAPER, ["annealing", "grain"]);
    expect(questionTermsOf(store().profile.preferenceLedger, PAPER).sort()).toEqual(["annealing", "grain"]);
    const before = store().profile;
    store().recordQuestionTerms(PAPER, ["grain", "annealing"]);
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
    store().recordQuestionTerms(PAPER, ["grain", "annealing"]);
    store().recordQuestionTerms(PAPER, []);
    expect(questionTermsOf(store().profile.preferenceLedger, PAPER)).toEqual([]);
    expect(store().profile.preferenceLedger?.["text:grain"]?.positive).toBe(1);
    expect(store().profile.preferenceLedger?.["text:annealing"]).toBeUndefined();
  });
});
