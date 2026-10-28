import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";
import { aiAvailability, keyNeedsSignIn } from "./ai-tier";

// `keyNeedsSignIn`: the one state where a reader told "no model" already has a
// key — it is saved, and the reader is confirmed signed out. The paper page then
// asks for a sign-in, not a key.

const KEYED: UserProfile = { ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "  not-a-real-key  " };
const NO_KEY: UserProfile = { ...defaultProfile, feedAiProvider: "default", feedAiApiKey: "" };
const COMPANY_NO_KEY: UserProfile = { ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "   " };
const KEY_NO_COMPANY: UserProfile = { ...defaultProfile, feedAiProvider: "default", feedAiApiKey: "not-a-real-key" };

const OUTCOMES: AuthOutcome[] = ["unknown", "signed-in", "signed-out", "unconfigured"];

describe("keyNeedsSignIn", () => {
  it("a key saved and the reader signed out: true", () => {
    expect(keyNeedsSignIn(KEYED, "signed-out")).toBe(true);
  });

  it.each(["unknown", "signed-in", "unconfigured"] as const)("a key saved, %s: false", (outcome) => {
    expect(keyNeedsSignIn(KEYED, outcome)).toBe(false);
  });

  it.each(OUTCOMES)("no usable key (none, a blank one, or a key with no company), %s: false", (outcome) => {
    for (const profile of [NO_KEY, COMPANY_NO_KEY, KEY_NO_COMPANY]) {
      expect(keyNeedsSignIn(profile, outcome)).toBe(false);
    }
  });

  it.each(OUTCOMES)("%s: true only where the model is off although a key is saved", (outcome) => {
    for (const profile of [KEYED, NO_KEY, COMPANY_NO_KEY, KEY_NO_COMPANY]) {
      if (keyNeedsSignIn(profile, outcome)) expect(aiAvailability(profile, outcome)).toBe("none");
    }
  });
});
