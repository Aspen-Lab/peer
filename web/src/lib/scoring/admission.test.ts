import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { scoreItems } from "./combine";
import { selectedSenseConcept } from "@/lib/feed/senses";

const now = Date.parse("2026-09-22T00:00:00Z");
const item = (id: string, title: string): RawItem => ({
  id,
  source: "openalex",
  title,
  authors: [],
  url: `https://example.test/${id}`,
  publishedAt: "2026-09-20",
  metadata: {},
});

describe("candidate admission provenance", () => {
  it("retains semantic/seed/citation/topic-field literal misses but rejects no-channel misses", () => {
    const candidates = [
      item("semantic", "A latent representation study"),
      item("seed", "Electrochemical interface paper"),
      item("citation", "Adjacent prior work"),
      item("topic-field", "Materials discovery"),
      item("none", "Unrelated astronomy"),
    ];
    const scored = scoreItems(candidates, {
      topics: ["solid electrolyte"],
      admissionChannels: {
        semantic: ["semantic"],
        seed: ["positive-seed"],
        citation: ["citation"],
        "topic-field": ["topic-field"],
      },
    }, undefined, now);

    expect(scored.map((candidate) => candidate.id)).toEqual([
      "semantic", "seed", "citation", "topic-field",
    ]);
  });

  it("keeps explicit exclusions and date limits as hard eligibility", () => {
    const excluded = item("excluded", "Solid electrolyte review");
    const old = { ...item("old", "Solid electrolyte history"), publishedAt: "2020-01-01" };
    const current = item("current", "Solid electrolyte interface");
    const scored = scoreItems([excluded, old, current], {
      topics: ["solid electrolyte"],
      exclusions: ["review"],
      minPublishedAt: "2026-01-01",
    }, undefined, now);

    expect(scored.map((candidate) => candidate.id)).toEqual(["current"]);
  });

  it("uses selected sense evidence for admission while retaining nonliteral provenance and hard policy", () => {
    const candidates = [
      item("hr", "Role conflict and employee wellbeing"),
      item("boilerplate", "Conflict of interest statement"),
      item("software", "Dependency conflict resolution"),
      item("semantic", "A workplace identity study"),
      item("excluded", "Role conflict review"),
    ];
    const scored = scoreItems(candidates, {
      topics: ["conflict"],
      selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      admissionChannels: { semantic: ["semantic"] },
      exclusions: ["review"],
    }, undefined, now);

    expect(scored.map((candidate) => candidate.id)).toEqual(["hr", "semantic"]);
  });
});
