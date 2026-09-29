import { describe, expect, it } from "vitest";
import { normalizeFeedIntent } from "./intent";
import { compileSearchBrief } from "./profile-compiler";
import { selectedSenseConcept } from "./senses";

// Reused verbatim from sense-context.test.ts / docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md
// so the ABBREV-RECALL tests below stay tied to the investigation's own reproduction fixture.
const BATTERY_PROJECT_TEXT =
  "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and " +
  "electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity and " +
  "interfacial stability between solid electrolytes and electrode materials while suppressing " +
  "dendrite growth.";

describe("compileSearchBrief tag-first intent lanes", () => {
  it("puts the Required tag ahead of project phrases, and still includes the project text", () => {
    const normalized = normalizeFeedIntent({
      project: "Stabilize sulfide electrolyte interfaces",
      challenge: "Lower interfacial resistance",
      topics: ["solid electrolyte"],
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: ["solid electrolyte"], intent: normalized.intent });

    expect(brief.project).toBe("Stabilize sulfide electrolyte interfaces");
    expect(brief.challenge).toBe("Lower interfacial resistance");
    // ABBREV-RECALL (ABC-JEV-INTEGRATION.md §1av): generatedQueries now leads
    // with the reader's own Required tag, ahead of project/challenge phrases
    // — a deliberate contract change from "project phrases first" (the order
    // this test asserted before), because a tag buried behind a long
    // project description never survived the source adapters' own
    // MAX_QUERIES truncation (2-3). The project text is still generated,
    // just no longer at index 0.
    expect(brief.generatedQueries[0]).toBe("solid electrolyte");
    expect(brief.generatedQueries).toContain("Stabilize sulfide electrolyte interfaces");
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

// ABBREV-RECALL (ABC-JEV-INTEGRATION.md §1av, docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md):
// B found that a Required tag never echoed in the reader's own project/challenge text (a real
// abbreviation like "LCO" is exactly this case — a reader states it as a tag, not as prose) was
// silently dropped before it ever reached a source: profile-compiler.ts's projectQueries put
// project-text phrases ahead of the Required tags, and every source adapter in web/src/lib/sources
// keeps only its own first MAX_QUERIES entries (2 for dblp/pubmed, 3 for openalex/semantic-scholar/
// arxiv). A tag past that cut is never searched for, every day, with no error shown. The fix only
// reorders generatedQueries (tags now lead, ahead of project phrases); it changes no query's text.
describe("compileSearchBrief ABBREV-RECALL: Required tags survive the adapters' query cap", () => {
  it("a 1-tag profile with project text keeps the tag within the adapters' MAX_QUERIES cut (2 and 3)", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: BATTERY_PROJECT_TEXT });

    expect(brief.generatedQueries.indexOf("LCO")).toBeGreaterThanOrEqual(0);
    expect(brief.generatedQueries.slice(0, 2)).toContain("LCO");
    expect(brief.generatedQueries.slice(0, 3)).toContain("LCO");
  });

  it("a 3-tag profile with project text puts every tag before any project-only phrase", () => {
    const topics = ["LCO", "LFP", "solid-state batteries"];
    const brief = compileSearchBrief({ topics, project: BATTERY_PROJECT_TEXT });

    // A "project-only phrase" is a generated query that is neither a bare tag
    // nor a tag+something combination (those are expected, and always come
    // later — this only checks that no plain project phrase cuts in line
    // ahead of a tag).
    const firstProjectPhraseIndex = brief.generatedQueries.findIndex(
      (q) => !topics.includes(q) && !topics.some((topic) => q.startsWith(`${topic} `)),
    );

    expect(firstProjectPhraseIndex).toBeGreaterThan(-1);
    for (const topic of topics) {
      expect(brief.generatedQueries.indexOf(topic)).toBeGreaterThanOrEqual(0);
      expect(brief.generatedQueries.indexOf(topic)).toBeLessThan(firstProjectPhraseIndex);
    }
  });

  // Mutation guard, computed from the HEAD code (before this fix) via direct execution so the
  // pinned arrays are exact, not hand-derived. If a future edit puts `...topics` back after the
  // project phrases, these two go red without needing the 1-tag/3-tag tests above to catch it.
  it("leaves the zero-topic tight-focus project lane byte-identical to before this fix", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      BATTERY_PROJECT_TEXT,
      "research",
      "solid-state",
      "battery",
      "materials",
      "focused",
    ]);
  });

  it("leaves tight focus with a topic present byte-identical to before this fix", () => {
    const brief = compileSearchBrief({
      topics: ["LCO"],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      "LCO",
      `LCO ${BATTERY_PROJECT_TEXT}`,
      "LCO research",
      "LCO solid-state",
    ]);
  });
});
