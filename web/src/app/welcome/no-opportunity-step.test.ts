import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SURFACE_TOPIC_DESCRIPTIONS } from "@/lib/profile/topic-copy";
import { STEP_META, stepIndexFromKey } from "./completeness";

// P9-32 (rulings 60, R1 and R2): Peer stopped fetching, storing and showing event
// and job listings, so the first-run wizard no longer asks for or advertises
// them. The "Data" step (a Tavily key for the events and jobs feeds), the
// "Turn on Events & Jobs" title and the topic mirroring that copied the paper
// topics into event and job lists are gone; Career stage and Looking toward stay.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("src/app/welcome/page.tsx");

describe("the welcome wizard asks for no events or jobs", () => {
  // OWN-KEY lane 4: Account joined the list, first; the property pinned here
  // (no Data step, and the paper steps in their order) is unchanged.
  it("has no Data step: Account then six steps, in order, none labelled Data", () => {
    expect(STEP_META.map((step) => step.key)).toEqual([
      "account",
      "basics",
      "topics",
      "work",
      "radar",
      "ai",
      "persona",
    ]);
    expect(STEP_META.map((step) => step.label)).toEqual([
      "Account",
      "Basics",
      "Topics",
      "Work",
      "Radar",
      "AI",
      "Persona",
    ]);
    expect(stepIndexFromKey("connectors")).toBeNull();
  });

  it("the page and the step list name no event, no job and no data-source line", () => {
    for (const path of ["src/app/welcome/page.tsx", "src/app/welcome/completeness.ts"]) {
      const text = read(path);
      expect(text, path).not.toMatch(/\b(events?|jobs?)\b/i);
      expect(text, path).not.toMatch(/Data APIs|connector|sources connected|of 3 sources/i);
    }
  });

  it("the Papers field writes straight to the paper topics: nothing is copied into another list", () => {
    expect(page).toContain("store.updateTopics([...profile.researchTopics, topic])");
    expect(page).toContain("onChange={store.updateSoftTopics}");
    expect(page).not.toMatch(/Mirroring|updateEvent|updateJob/);
  });

  it("the modules only the Data step and the mirroring used are gone", () => {
    for (const path of [
      "src/components/profile/connector-panel.tsx",
      "src/app/welcome/topic-mirroring.ts",
      "src/app/welcome/topic-mirroring.test.ts",
    ]) {
      expect(existsSync(join(process.cwd(), path)), path).toBe(false);
    }
  });

  it("the topic hint copy keeps the Papers line only", () => {
    expect(Object.keys(SURFACE_TOPIC_DESCRIPTIONS)).toEqual(["papers"]);
  });

  it("still asks for Career stage and Looking toward (the reader's own words, kept by ruling R2)", () => {
    expect(page).toContain('label="Career stage"');
    expect(page).toContain('label="Looking toward"');
    expect(page).toContain("store.updateCareerStage");
    expect(page).toContain("store.updateIndustryPreference");
  });
});
