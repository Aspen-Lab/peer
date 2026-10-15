import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { hasBeenSetUp, walkthroughAction } from "./first-visit";

// P7-16 (R12): a profile that has never been set up opens on the /welcome
// walkthrough once. These are the rules, with no React in them: what counts as
// "set up", and what the gate does on a page. P7-16c (§1h.35 (a)): it opens by
// itself from the home page only; a deep link is never redirected.

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

  // Re-aimed to §1h.35 (a) (P7-16c): this used to say a fresh profile is sent
  // to the walkthrough "there too", from any page. A shared paper link, a
  // search or any other route is left where it is; only "/" opens it.
  it.each([
    "/papers/abc",
    "/papers/openalex:W1",
    "/search",
    "/profile",
    "/saved",
    "/data-sources",
    "/changelog",
  ])("leaves a fresh profile on %s where it is: a deep link is never redirected (§1h.35 (a))", (pathname) => {
    expect(walkthroughAction(pathname, fresh)).toBeNull();
  });

  it("does not move a reader who is already on /welcome; it only records that they have been shown it", () => {
    expect(walkthroughAction("/welcome", fresh)).toBe("record");
  });

  it.each(["/privacy", "/persona", "/auth/error", "/api/feed", "/api"])(
    "never takes over %s",
    (pathname) => {
      expect(walkthroughAction(pathname, fresh)).toBeNull();
    },
  );

  // Re-aimed to §1h.35 (a) (P7-16c): this was "matches whole path segments:
  // /privacy-notes is an ordinary page", true of the exempt list the home-only
  // rule made unnecessary. What is left to prove is that only the path "/"
  // itself opens the walkthrough, not a path that starts or looks like it.
  it("only the path / itself opens it: /privacy-notes and the like are left where they are (§1h.35 (a))", () => {
    for (const pathname of ["/privacy-notes", "/welcome-back", "/index"]) {
      expect(walkthroughAction(pathname, fresh)).toBeNull();
    }
    expect(walkthroughAction("/", fresh)).toBe("redirect");
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
