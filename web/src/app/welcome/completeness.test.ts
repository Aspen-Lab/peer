import { describe, it, expect } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  STEP_META,
  connectorCount,
  firstIncompleteStep,
  isStepDone,
  stepIndexFromKey,
} from "./completeness";

function profileWith(patch: Partial<UserProfile>): UserProfile {
  return { ...defaultProfile, ...patch };
}

describe("stepIndexFromKey", () => {
  it("resolves the direct walkthrough step and ignores invalid values", () => {
    expect(stepIndexFromKey("ai")).toBe(STEP_META.findIndex((m) => m.key === "ai"));
    expect(stepIndexFromKey("unknown")).toBeNull();
    expect(stepIndexFromKey(null)).toBeNull();
  });
});

describe("isStepDone", () => {
  it("a fresh default profile has every step un-done", () => {
    for (const m of STEP_META) {
      expect(isStepDone(m.key, defaultProfile, false)).toBe(false);
    }
  });

  it("basics: done when the name, stage, or leaning deviates from defaults", () => {
    expect(isStepDone("basics", profileWith({ displayName: "Peter" }), false)).toBe(true);
    expect(isStepDone("basics", profileWith({ careerStage: "Postdoc" }), false)).toBe(true);
    expect(
      isStepDone("basics", profileWith({ industryVsAcademia: "academia" }), false),
    ).toBe(true);
  });

  it("topics: done only with at least one required topic", () => {
    expect(isStepDone("topics", profileWith({ softTopics: ["x"] }), false)).toBe(false);
    expect(
      isStepDone("topics", profileWith({ researchTopics: ["batteries"] }), false),
    ).toBe(true);
  });

  it("topics: Events and Jobs never change the Papers Required gate", () => {
    expect(
      isStepDone(
        "topics",
        profileWith({
          eventRequiredTopics: ["battery conferences"],
          jobRequiredTopics: ["battery scientist"],
        }),
        false,
      ),
    ).toBe(false);
    expect(
      isStepDone(
        "topics",
        profileWith({
          researchTopics: ["batteries"],
          eventRequiredTopics: [],
          eventExploreTopics: [],
          jobRequiredTopics: [],
          jobExploreTopics: [],
        }),
        false,
      ),
    ).toBe(true);
  });

  it("work: any of project/challenges/school/advisor marks it done", () => {
    expect(isStepDone("work", profileWith({ currentProject: "p" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ school: "MIT" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ advisorName: "A" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ advisorAuthorId: "A5" }), false)).toBe(true);
  });

  it("radar: deviation from any rendered default, or a preferred journal", () => {
    expect(isStepDone("radar", profileWith({ feedFocus: "tight" }), false)).toBe(true);
    expect(isStepDone("radar", profileWith({ paperCount: 5 }), false)).toBe(true);
    expect(
      isStepDone("radar", profileWith({ preferredJournals: ["Nature"] }), false),
    ).toBe(true);
    // feedMethodMode is not rendered by the wizard — must not count.
    expect(
      isStepDone("radar", profileWith({ feedMethodMode: "mustMatch" }), false),
    ).toBe(false);
  });

  it("ai: requires a non-default provider AND a key", () => {
    expect(isStepDone("ai", profileWith({ feedAiProvider: "openai" }), false)).toBe(false);
    expect(isStepDone("ai", profileWith({ feedAiApiKey: "sk-x" }), false)).toBe(false);
    expect(
      isStepDone("ai", profileWith({ feedAiProvider: "openai", feedAiApiKey: "sk-x" }), false),
    ).toBe(true);
  });

  it("connectors: only Tavily counts, and only when fully configured", () => {
    // Adzuna and USAJobs existed solely to widen JOB coverage; jobs are no
    // longer a product surface, so their keys no longer make the step done.
    expect(
      isStepDone(
        "connectors",
        profileWith({ adzunaAppId: "id", adzunaAppKey: "key" }),
        false,
      ),
    ).toBe(false);
    expect(
      isStepDone(
        "connectors",
        profileWith({ tavilyEnabled: true, tavilyApiKey: "tvly-x" }),
        false,
      ),
    ).toBe(true);
    // Tavily key without the toggle is not active.
    expect(
      isStepDone("connectors", profileWith({ tavilyApiKey: "tvly-x" }), false),
    ).toBe(false);
  });

  it("persona: driven by the passed-in flag", () => {
    expect(isStepDone("persona", defaultProfile, true)).toBe(true);
  });
});

describe("connectorCount", () => {
  it("counts Tavily once and ignores the retired job connectors", () => {
    expect(connectorCount(defaultProfile)).toBe(0);
    expect(
      connectorCount(
        profileWith({
          tavilyEnabled: true,
          tavilyApiKey: "t",
          adzunaAppId: "a",
          adzunaAppKey: "b",
          usajobsApiKey: "u",
          usajobsUserAgent: "e@x.com",
        }),
      ),
    ).toBe(1);
  });
});

describe("firstIncompleteStep", () => {
  it("a fresh profile starts at step 0", () => {
    expect(firstIncompleteStep(defaultProfile, false)).toBe(0);
  });

  it("skips completed leading steps — a finished step is never asked for again", () => {
    const p = profileWith({
      displayName: "Peter",
      authorisedCountries: ["United States"],
      researchTopics: ["solid state battery"],
      currentProject: "electrolyte modelling",
    });
    // basics, topics, work done → open on radar (index 3). The work-rights
    // step that used to sit between basics and topics is gone.
    expect(firstIncompleteStep(p, false)).toBe(3);
  });

  it("a fully set-up profile lands on the last step, not past the end", () => {
    const p = profileWith({
      displayName: "Peter",
      authorisedCountries: ["United States"],
      researchTopics: ["x"],
      school: "MIT",
      feedFocus: "tight",
      feedAiProvider: "openai",
      feedAiApiKey: "sk",
      tavilyEnabled: true,
      tavilyApiKey: "t",
    });
    expect(firstIncompleteStep(p, true)).toBe(STEP_META.length - 1);
  });
});
