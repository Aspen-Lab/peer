import { describe, expect, it } from "vitest";
import { normalizeFeedIntent } from "./intent";
import { compileSearchBrief } from "./profile-compiler";
import { selectedSenseConcept } from "./senses";

describe("compileSearchBrief project-first intent lanes", () => {
  it("keeps project and challenge labeled and gives project phrases the first lane", () => {
    const normalized = normalizeFeedIntent({
      project: "Stabilize sulfide electrolyte interfaces",
      challenge: "Lower interfacial resistance",
      topics: ["solid electrolyte"],
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: ["solid electrolyte"], intent: normalized.intent });

    expect(brief.project).toBe("Stabilize sulfide electrolyte interfaces");
    expect(brief.challenge).toBe("Lower interfacial resistance");
    expect(brief.generatedQueries[0]).toContain("Stabilize sulfide electrolyte interfaces");
    expect(brief.currentProjectSummary).toBe("Stabilize sulfide electrolyte interfaces");
  });

  it("uses only the catalog's exact canonical phrase for a selected sense-only query", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: [], intent: normalized.intent });

    expect(brief.generatedQueries).toEqual(["scanning electron microscopy"]);
    expect(brief.generatedQueries).not.toContain("SEM");
  });

  it("keeps the exact selected HR sense query in tight focus without topics", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: [],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["role conflict"]);
    expect(brief.generatedQueries).not.toContain("conflict");
  });

  it("keeps only the canonical materials sense query in tight focus without topics", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: [],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["scanning electron microscopy"]);
    expect(brief.generatedQueries).not.toContain("SEM");
  });

  it("keeps selected senses alongside topic-anchored tight queries", () => {
    const normalized = normalizeFeedIntent({
      topics: ["organizational behavior"],
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: ["organizational behavior"],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["role conflict", "organizational behavior"]);
  });

  it("keeps declared project and challenge terms in tight focus when topics are absent", () => {
    const project = compileSearchBrief({
      topics: [],
      project: "employee retention",
      controls: { focus: "tight" },
    });
    const challenge = compileSearchBrief({
      topics: [],
      challenge: "reduce turnover",
      controls: { focus: "tight" },
    });

    expect(project.generatedQueries).toContain("employee retention");
    expect(challenge.generatedQueries).toContain("reduce turnover");
  });

  it("keeps empty intent invalid and topic-present ordinary tight queries topic-filtered", () => {
    const empty = normalizeFeedIntent({});
    expect(empty).toMatchObject({ ok: false, reason: "intent_required" });

    const brief = compileSearchBrief({
      topics: ["organizational behavior"],
      project: "employee retention",
      challenge: "reduce turnover",
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).not.toContain("employee retention");
    expect(brief.generatedQueries).not.toContain("reduce turnover");
    expect(brief.generatedQueries).toContain("organizational behavior employee retention");
    expect(brief.generatedQueries.every((query) => query.includes("organizational behavior"))).toBe(true);
  });
});
