import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { STEP_META, isStepDone } from "./completeness";

// Paper screening with the reader's own Jev key is a short optional block inside
// the wizard's existing `ai` step: no new step, and a Jev key alone does not make
// the `ai` step "done" (that step is about a model that will actually run).

describe("welcome wizard - the Jev block", () => {
  const source = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");

  it("adds no wizard step: the seven steps are the ones that were there", () => {
    expect(STEP_META.map((step) => step.key)).toEqual([
      "basics",
      "topics",
      "work",
      "radar",
      "ai",
      "connectors",
      "persona",
    ]);
  });

  it("mounts the short Jev block inside the ai step, after the model-key fields", () => {
    const aiStart = source.indexOf('key === "ai" && (');
    const aiEnd = source.indexOf('key === "connectors" && (');
    expect(aiStart).toBeGreaterThan(-1);
    expect(aiEnd).toBeGreaterThan(aiStart);
    const aiStep = source.slice(aiStart, aiEnd);
    expect(aiStep).toContain('<JevSetup variant="welcome"');
    expect(aiStep.indexOf("<AiKeyFields")).toBeGreaterThan(-1);
    expect(aiStep.indexOf("<JevSetup")).toBeGreaterThan(aiStep.indexOf("<AiKeyFields"));
    expect(source).toMatch(/import \{[^}]*\bJevSetup\b[^}]*\} from "@\/components\/profile\/jev-setup"/);
  });

  it("never reads or writes the key itself: the setup component owns it", () => {
    expect(source).not.toMatch(/jevApiKey|updateJevApiKey/);
  });

  it("a Jev key alone does not complete the ai step, with or without sign-in", () => {
    const withJevOnly = { ...defaultProfile, jevApiKey: "jev-wizard-test-not-a-key-0000" };
    expect(isStepDone("ai", withJevOnly, false, "signed-in")).toBe(false);
    expect(isStepDone("ai", withJevOnly, false, "unconfigured")).toBe(false);
  });

  it("a model key still completes it, and adding a Jev key changes nothing about that", () => {
    const withModelKey = { ...defaultProfile, feedAiProvider: "openai" as const, feedAiApiKey: "user-owned-key" };
    expect(isStepDone("ai", withModelKey, false, "signed-in")).toBe(true);
    expect(isStepDone("ai", { ...withModelKey, jevApiKey: "jev-wizard-test-not-a-key-0000" }, false, "signed-in")).toBe(true);
    expect(isStepDone("ai", withModelKey, false, "signed-out")).toBe(false);
  });
});

// N11 of the branch review: this step said Tavily web scouting "remains limited by
// Peer's daily search schedule", and no such schedule exists in the code now.
describe("welcome wizard - the ai step's note about search keys", () => {
  const flat = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8").replace(/\s+/g, " ");

  it("names no schedule of Peer's own, because Peer runs no search on a schedule", () => {
    expect(flat).not.toMatch(/search schedule|daily search/i);
  });

  it("still says what is true: Tavily web scouting uses its own separate search key", () => {
    expect(flat).toContain("AI keys power ranking, summaries, and Deep reports. Tavily web scouting uses its own separate search key.");
  });
});
