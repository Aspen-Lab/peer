// OWN-KEY lane 4 — the AI row of the wizard's closing summary. A reader with a
// saved key who is not signed in used to read "No key — reading without a
// model", which was false.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { aiStepSummary } from "./summary";

const keyed: UserProfile = { ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "user-owned-test-key" };

describe("aiStepSummary", () => {
  it("a saved key, signed out: names the provider and says to sign in", () => {
    expect(aiStepSummary(keyed, "signed-out")).toBe("Gemini key saved — sign in to use it");
  });

  it("a saved key while the sign-in check is unknown reads the same (no model runs yet)", () => {
    expect(aiStepSummary(keyed, "unknown")).toBe("Gemini key saved — sign in to use it");
  });

  it("a saved key, signed in: connected, unchanged", () => {
    expect(aiStepSummary(keyed, "signed-in")).toBe("Gemini key connected");
  });

  it("a saved key where sign-in is not configured: connected, unchanged", () => {
    expect(aiStepSummary(keyed, "unconfigured")).toBe("Gemini key connected");
  });

  it("names whichever provider is saved", () => {
    expect(aiStepSummary({ ...keyed, feedAiProvider: "openai" }, "signed-out")).toBe(
      "OpenAI key saved — sign in to use it",
    );
  });

  it("no key: reading without a model, signed in or not, unchanged", () => {
    for (const auth of ["signed-in", "signed-out", "unknown", "unconfigured"] as const) {
      expect(aiStepSummary(defaultProfile, auth)).toBe("No key — reading without a model");
    }
  });

  it("a provider picked with no key pasted, or a blank key, is still no key", () => {
    expect(aiStepSummary({ ...defaultProfile, feedAiProvider: "gemini" }, "signed-out")).toBe(
      "No key — reading without a model",
    );
    expect(aiStepSummary({ ...keyed, feedAiApiKey: "   " }, "signed-in")).toBe(
      "No key — reading without a model",
    );
  });

  it("never prints any piece of the key", () => {
    const KEY = "qW8eR2tY6uI4oP0aS9dF3gH7jK1lZ5xC2vB8nM4Q";
    const line = aiStepSummary({ ...keyed, feedAiApiKey: KEY }, "signed-out");
    for (let i = 0; i + 4 <= KEY.length; i++) expect(line).not.toContain(KEY.slice(i, i + 4));
  });

  it("is what the wizard's summary row uses (source)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");
    expect(page).toMatch(/case "ai":\s*return aiStepSummary\(profile, auth\);/);
  });
});
