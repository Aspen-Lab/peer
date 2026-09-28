/**
 * JEV-DIRECT (§1aa point 6) — 4 FIXED, checked-in, non-secret synthetic
 * `DecisionRequest`s for the opt-in live Jev smoke runner. Never real user
 * data, mirroring `evaluation/live-channels/inputs.ts`'s own "fixed
 * synthetic inputs, checked in" convention:
 *
 *  1. Clear match — a paper and intent about the exact same thing.
 *     Exercises a confident, non-`unknown` Choice + Score answer.
 *  2. Clear mismatch — the same intent against an unrelated paper.
 *     Exercises a confident "does not match" answer — still not `unknown`.
 *  3. CJK — reuses the EXISTING fixture
 *     `decisions/__fixtures__/cjk-paper.json` (already used by
 *     `jev-contract.test.ts`'s CJK path) wrapped in a fixed synthetic
 *     matching intent, exercising the CJK truncation-budget path live
 *     (§1p.H(9)'s actual concern) instead of inventing a new CJK fixture.
 *  4. Ambiguous / thin abstract — designed to plausibly produce a
 *     low-confidence or `insufficient_information` answer, so the runner
 *     can prove it observes and reports an `unknown` result too, not only
 *     the happy path.
 */
import cjkPaperFixture from "@/lib/decisions/__fixtures__/cjk-paper.json";
import type { DecisionRequest } from "@/lib/decisions/types";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { selectedSenseConcept, type SelectedSenseConcept } from "@/lib/feed/senses";

function batteryIntent(overrides: Partial<NormalizedFeedIntent> = {}): NormalizedFeedIntent {
  return {
    version: FEED_INTENT_VERSION,
    project: {
      presence: "value",
      value: "Improve lithium-ion battery cathode cycling stability",
      provenance: "user",
    },
    challenge: {
      presence: "value",
      value: "Capacity fade after repeated charge/discharge cycles",
      provenance: "user",
    },
    requiredConcepts: ["battery", "cathode"],
    preferredConcepts: ["cycling stability"],
    exclusions: [],
    methods: [],
    selectedSenseConcepts: [],
    ...overrides,
  };
}

/** The closest real entry in Peer's finite local-sense catalog to a battery-materials context (`senses.ts`'s own catalog has no battery-specific sense; this is the nearest materials-science one, and the point here is exercising the wire path, not evaluating relevance). */
const MATERIALS_SENSE: SelectedSenseConcept = selectedSenseConcept("materials.scanning_electron_microscopy", {
  context: "characterizing cathode material microstructure and surface morphology after cycling, not electron-microscopy methodology in general",
});

export interface JevSmokeInput {
  id: string;
  label: string;
  request: DecisionRequest;
}

const CLEAR_MATCH: JevSmokeInput = {
  id: "clear-match",
  label: "Clear match — a battery-cathode cycling-stability paper against a matching intent",
  request: {
    paperId: "jev-smoke-clear-match",
    title: "Cycling Stability of High-Nickel Cathode Materials in Lithium-Ion Batteries",
    abstract:
      "We report a systematic study of capacity fade in high-nickel layered oxide cathodes over 500 charge-discharge cycles. Post-cycling scanning electron microscopy (SEM) imaging reveals particle cracking as the dominant degradation mechanism; a protective coating strategy improves cycling stability by 30% relative to the uncoated baseline.",
    intentCard: batteryIntent({ selectedSenseConcepts: [MATERIALS_SENSE] }),
    senseConcepts: [MATERIALS_SENSE],
    questions: ["sense_match", "core_vs_background", "project_help"],
  },
};

const CLEAR_MISMATCH: JevSmokeInput = {
  id: "clear-mismatch",
  label: "Clear mismatch — an unrelated paper against the same battery intent",
  request: {
    paperId: "jev-smoke-clear-mismatch",
    title: "Metrical Variation in Late Medieval English Alliterative Verse",
    abstract:
      "This paper analyzes stress-pattern variation across a corpus of fourteenth-century alliterative poems, arguing that regional dialect differences account for much of the observed metrical irregularity. No batteries, cathodes, or materials characterization of any kind are discussed.",
    intentCard: batteryIntent(),
    senseConcepts: [],
    questions: ["core_vs_background", "project_help"],
  },
};

const CJK_TRUNCATION: JevSmokeInput = {
  id: "cjk-truncation",
  label: "CJK truncation-budget path — the existing cjk-paper.json fixture against a matching battery intent",
  request: {
    paperId: cjkPaperFixture.paperId,
    title: cjkPaperFixture.title,
    abstract: cjkPaperFixture.abstract,
    venue: cjkPaperFixture.venue,
    intentCard: batteryIntent(),
    senseConcepts: [],
    questions: ["core_vs_background", "project_help"],
  },
};

const AMBIGUOUS_THIN: JevSmokeInput = {
  id: "ambiguous-thin-abstract",
  label: "Ambiguous, thin abstract — plausibly an unknown/insufficient_information answer",
  request: {
    paperId: "jev-smoke-ambiguous-thin",
    title: "Some Observations",
    abstract: "This paper presents several findings of potential interest to researchers in the field.",
    intentCard: batteryIntent(),
    senseConcepts: [],
    questions: ["core_vs_background", "project_help"],
  },
};

/** Exactly 4 — well under any sane ceiling (the runner's own default is 10). */
export const JEV_SMOKE_INPUTS: readonly JevSmokeInput[] = [
  CLEAR_MATCH,
  CLEAR_MISMATCH,
  CJK_TRUNCATION,
  AMBIGUOUS_THIN,
];
