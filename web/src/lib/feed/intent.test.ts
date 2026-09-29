import { describe, expect, it } from "vitest";
import {
  browserFeedIntentCard,
  feedIntentEquals,
  normalizeFeedIntent,
  normalizePersistedFeedIntent,
  serializeFeedIntent,
} from "./intent";
import { selectedSenseConcept } from "./senses";

describe("NormalizedFeedIntent", () => {
  it("accepts a canonical explicit-empty card for persistence without weakening feed admission", () => {
    const card = {
      version: "feed-intent-v1",
      project: { presence: "explicit-empty" },
      challenge: { presence: "explicit-empty" },
      requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [],
    };
    expect(normalizeFeedIntent({ intent: card })).toEqual({ ok: false, reason: "intent_required" });
    expect(normalizePersistedFeedIntent(card)).toEqual({ ok: true, intent: card });
  });

  it("fails closed for malformed, unknown-sense, or administrative persistence cards", () => {
    expect(normalizePersistedFeedIntent({ version: "feed-intent-v1", project: { presence: "value" } })).toEqual({ ok: false });
    expect(normalizePersistedFeedIntent({ version: "feed-intent-v1", project: { presence: "omitted" }, challenge: { presence: "omitted" }, requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [{ senseId: "unknown" }] })).toEqual({ ok: false });
    expect(normalizePersistedFeedIntent({ version: "feed-intent-v1", project: { presence: "omitted" }, challenge: { presence: "omitted" }, requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [], plan: "paid" })).toEqual({ ok: false });
  });
  it("accepts project-only and challenge-only intent without inventing topics", () => {
    const project = normalizeFeedIntent({ project: "Stabilize sulfide electrolytes" });
    const challenge = normalizeFeedIntent({ challenge: "Lower interfacial resistance" });

    expect(project).toMatchObject({ ok: true, intent: { project: { presence: "value", value: "Stabilize sulfide electrolytes" } } });
    expect(challenge).toMatchObject({ ok: true, intent: { challenge: { presence: "value", value: "Lower interfacial resistance" } } });
  });

  it("keeps labeled project/challenge order and treats topic-only input as valid", () => {
    const result = normalizeFeedIntent({
      project: "Project comes first",
      challenge: "Challenge stays second",
      topics: ["solid electrolyte"],
    });

    expect(result).toMatchObject({
      ok: true,
      intent: {
        project: { presence: "value", value: "Project comes first" },
        challenge: { presence: "value", value: "Challenge stays second" },
        requiredConcepts: ["solid electrolyte"],
      },
    });
  });

  it("returns one stable intent_required outcome only when nothing usable exists", () => {
    expect(normalizeFeedIntent({ topics: [], project: "  ", challenge: "" })).toEqual({
      ok: false,
      reason: "intent_required",
    });
  });

  it("accepts a selected v1 sense alone but rejects an empty or invalid card", () => {
    const selectedOnly = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });

    expect(selectedOnly).toMatchObject({
      ok: true,
      intent: { selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] },
    });
    expect(normalizeFeedIntent({ intent: { version: "feed-intent-v1" } })).toEqual({
      ok: false,
      reason: "intent_required",
    });
    expect(normalizeFeedIntent({
      intent: { version: "feed-intent-v1", selectedSenseConcepts: [{ senseId: "unknown" }] },
    })).toEqual({ ok: false, reason: "intent_required" });
  });

  it("imports legacy null and blank rows as omitted, preserving explicit empty and exclusions", () => {
    const legacy = normalizeFeedIntent({ project: null, challenge: "", topics: null });
    const current = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        project: { presence: "explicit-empty" },
        challenge: { presence: "omitted" },
        exclusions: [{ kind: "exclude-term", value: "review" }],
        requiredConcepts: ["battery"],
      },
    });

    expect(legacy).toMatchObject({
      ok: false,
      reason: "intent_required",
    });
    // The result is invalid but its legacy import state remains inspectable by
    // retrying with a usable topic; a legacy blank is never historical proof
    // of an explicit user clear.
    const legacyWithTopic = normalizeFeedIntent({ project: null, challenge: "", topics: ["battery"] });
    expect(legacyWithTopic).toMatchObject({
      ok: true,
      intent: {
        project: { presence: "omitted", provenance: "legacy-import" },
        challenge: { presence: "omitted", provenance: "legacy-import" },
      },
    });
    expect(current).toMatchObject({
      ok: true,
      intent: {
        project: { presence: "explicit-empty" },
        challenge: { presence: "omitted" },
        exclusions: [{ kind: "exclude-term", value: "review" }],
      },
    });
  });

  it("keeps modern browser clears distinct from raw legacy profile blanks", () => {
    const browser = browserFeedIntentCard({
      project: "",
      challenge: "",
      topics: ["battery"],
    });
    const legacy = normalizeFeedIntent({
      project: "",
      challenge: "",
      topics: ["battery"],
    });

    expect(browser).toMatchObject({
      project: { presence: "explicit-empty" },
      challenge: { presence: "explicit-empty" },
    });
    expect(legacy).toMatchObject({
      ok: true,
      intent: {
        project: { presence: "omitted", provenance: "legacy-import" },
        challenge: { presence: "omitted", provenance: "legacy-import" },
      },
    });
    expect(browserFeedIntentCard({ project: "", challenge: "", topics: [] })).toBeUndefined();
  });

  it("round-trips canonical equality independently of object key order", () => {
    const first = normalizeFeedIntent({
      project: "Study interfaces",
      challenge: "Lower resistance",
      topics: ["battery"],
      exclusions: ["review"],
    });
    const second = normalizeFeedIntent({
      exclusions: ["review"],
      topics: ["battery"],
      challenge: "Lower resistance",
      project: "Study interfaces",
    });

    if (!first.ok || !second.ok) throw new Error("fixture must be valid");
    expect(feedIntentEquals(first.intent, second.intent)).toBe(true);
    expect(serializeFeedIntent(first.intent)).toBe(serializeFeedIntent(second.intent));
  });

  it("preserves only explicit selected local senses and versions them into intent equality", () => {
    const hr = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        requiredConcepts: ["conflict"],
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    const materials = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        requiredConcepts: ["SEM"],
        selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      },
    });
    const legacy = normalizeFeedIntent({ topics: ["conflict", "SEM"] });

    if (!hr.ok || !materials.ok || !legacy.ok) throw new Error("fixture must be valid");
    expect(hr.intent.selectedSenseConcepts).toEqual([selectedSenseConcept("hr.role_conflict")]);
    expect(legacy.intent.selectedSenseConcepts).toEqual([]);
    expect(feedIntentEquals(hr.intent, materials.intent)).toBe(false);
    expect(serializeFeedIntent(hr.intent)).not.toBe(serializeFeedIntent(materials.intent));
  });
});
