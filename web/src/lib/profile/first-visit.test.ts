import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { hasBeenSetUp, walkthroughAction } from "./first-visit";

// P7-16 (R12): a profile that has never been set up opens on the /welcome
// walkthrough once. These are the rules, with no React in them: what counts as
// "set up", which pages the walkthrough never takes over, and what the gate
// does on the rest.

const fresh: UserProfile = { ...defaultProfile };

const setUp: Array<[string, Partial<UserProfile>]> = [
  ["a research topic", { researchTopics: ["battery materials"] }],
  ["a project", { currentProject: "A study of solid electrolytes" }],
  ["a challenge", { currentChallenges: "Separating interface effects from bulk effects" }],
  ["a model key", { feedAiProvider: "openai", feedAiApiKey: "an-invented-key-for-the-test" }],
  ["onboardedAt", { onboardedAt: "2026-10-01T09:00:00.000Z" }],
  ["welcomeSkipped", { welcomeSkipped: true }],
];

describe("hasBeenSetUp — what counts as a profile that has been through setup", () => {
  it("a fresh profile has not", () => {
    expect(hasBeenSetUp(fresh)).toBe(false);
  });

  it("a profile stored before the flag existed carries no welcomeSkipped, and reads as not set up", () => {
    expect(fresh.welcomeSkipped).toBeUndefined();
    expect("welcomeSkipped" in fresh).toBe(false);
    expect(hasBeenSetUp(fresh)).toBe(false);
  });

  it.each(setUp)("%s alone is enough", (_name, patch) => {
    expect(hasBeenSetUp({ ...fresh, ...patch })).toBe(true);
  });

  it("empty and blank values are not setup", () => {
    expect(
      hasBeenSetUp({
        ...fresh,
        researchTopics: [],
        currentProject: "   ",
        currentChallenges: "",
        feedAiApiKey: "   ",
        onboardedAt: null,
        welcomeSkipped: false,
      }),
    ).toBe(false);
  });
});

describe("walkthroughAction — what the first-run gate does on a page", () => {
  it("sends a fresh profile on the home page to the walkthrough", () => {
    expect(walkthroughAction("/", fresh)).toBe("redirect");
  });

  it.each(["/search", "/profile", "/saved", "/papers/openalex:W1", "/changelog"])(
    "sends a fresh profile on %s there too",
    (pathname) => {
      expect(walkthroughAction(pathname, fresh)).toBe("redirect");
    },
  );

  it("does not move a reader who is already on /welcome; it only records that they have been shown it", () => {
    expect(walkthroughAction("/welcome", fresh)).toBe("record");
  });

  it.each(["/privacy", "/persona", "/auth/error", "/api/feed", "/api"])(
    "never takes over %s",
    (pathname) => {
      expect(walkthroughAction(pathname, fresh)).toBeNull();
    },
  );

  it("matches whole path segments: /privacy-notes is an ordinary page", () => {
    expect(walkthroughAction("/privacy-notes", fresh)).toBe("redirect");
  });

  it("does nothing before the path is known", () => {
    expect(walkthroughAction(null, fresh)).toBeNull();
  });

  it.each(setUp)("a profile with %s is left alone, on the home page and on /welcome", (_name, patch) => {
    const profile = { ...fresh, ...patch };
    expect(walkthroughAction("/", profile)).toBeNull();
    expect(walkthroughAction("/search", profile)).toBeNull();
    expect(walkthroughAction("/welcome", profile)).toBeNull();
  });
});
