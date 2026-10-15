import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { defaultProfile } from "@/types";
import { useProfileStore } from "./profile";

// P7-16 (R12): `welcomeSkipped` is the persisted flag behind "the walkthrough
// opens once". Skipping the wizard, finishing it and choosing a field on the
// home page all go through `completeOnboarding`, so that is where it is set
// for them; `skipWelcome` is the same flag with nothing else attached, for the
// first-run gate to record that the reader has been shown the walkthrough.

describe("profile.welcomeSkipped — the flag", () => {
  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  it("a fresh profile has it unset, and no onboardedAt", () => {
    const { profile } = useProfileStore.getState();
    expect(profile.welcomeSkipped).toBeFalsy();
    expect(profile.onboardedAt).toBeNull();
  });

  it("skipWelcome sets it and touches nothing else", () => {
    const before = useProfileStore.getState().profile;
    useProfileStore.getState().skipWelcome();
    expect(useProfileStore.getState().profile).toEqual({ ...before, welcomeSkipped: true });
  });

  it("completeOnboarding sets it too: Skip setup, Enter Peer and a chosen field all end the first-visit redirect", () => {
    useProfileStore.getState().completeOnboarding();
    const { profile } = useProfileStore.getState();
    expect(profile.welcomeSkipped).toBe(true);
    expect(profile.onboardedAt).toEqual(expect.any(String));
  });

  it("resetOnboarding (Replay walkthrough) clears onboardedAt and leaves the flag: a replay never re-arms the redirect", () => {
    useProfileStore.getState().completeOnboarding();
    useProfileStore.getState().resetOnboarding();
    const { profile } = useProfileStore.getState();
    expect(profile.onboardedAt).toBeNull();
    expect(profile.welcomeSkipped).toBe(true);
  });
});

describe("profile.welcomeSkipped — storage", () => {
  async function rehydrateFrom(profile: Record<string, unknown>, version = 7) {
    let stored = JSON.stringify({ state: { profile, lastSynced: null, syncedAccountId: null }, version });
    const storage: StateStorage = {
      getItem: () => stored,
      setItem: (_name, value) => {
        stored = value;
      },
      removeItem: () => {
        stored = "";
      },
    };
    vi.stubGlobal("window", { localStorage: storage });
    vi.resetModules();
    const mod = await import("./profile");
    await mod.useProfileStore.persist.rehydrate();
    return { mod, read: () => JSON.parse(stored) as { version: number; state: { profile: Record<string, unknown> } } };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("an old stored profile without the flag loads with it unset and keeps its other fields", async () => {
    const { mod } = await rehydrateFrom({ ...defaultProfile, displayName: "Old Reader" });
    const profile = mod.useProfileStore.getState().profile;
    expect(profile.welcomeSkipped).toBeFalsy();
    expect(profile.displayName).toBe("Old Reader");
  });

  it("the flag is written to the stored profile and survives a reload, with no version change", async () => {
    const { mod, read } = await rehydrateFrom({ ...defaultProfile });
    mod.useProfileStore.getState().skipWelcome();
    // The store's current version (8 since the events/jobs fields were dropped, P9-32):
    // setting the flag itself does not move it.
    expect(read().version).toBe(8);
    expect(read().state.profile.welcomeSkipped).toBe(true);

    const again = await rehydrateFrom(read().state.profile);
    expect(again.mod.useProfileStore.getState().profile.welcomeSkipped).toBe(true);
  });
});

describe("the wizard's two ways out both go through completeOnboarding", () => {
  const source = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");

  it("'Skip setup →' (skipEverything) calls it", () => {
    expect(source).toMatch(/const skipEverything = \(\) => \{\s*completeOnboarding\(\);/);
    expect(source).toMatch(/onClick=\{skipEverything\}/);
  });

  it("the last step's 'Enter Peer' (finishToTour) calls it", () => {
    expect(source).toMatch(/const finishToTour = \(\) => \{\s*completeOnboarding\(\);/);
    expect(source).toMatch(/onClick=\{finishToTour\}/);
  });

  // P7-16c (§1h.35 (e)): the coachmark tour was removed in ffa6eded and nothing
  // has read a `tour` query parameter since (checked: no source file reads
  // one), so the wizard leaves to the home page itself, not to `/?tour=1`.
  it("both exits leave to / — not /?tour=1, a suffix nothing reads (§1h.35 (e))", () => {
    expect(source).toMatch(/const finishToTour = \(\) => \{\s*completeOnboarding\(\);\s*router\.push\("\/"\);\s*\};/);
    expect(source).toMatch(/const skipEverything = \(\) => \{\s*completeOnboarding\(\);\s*router\.push\("\/"\);\s*\};/);
    expect(source).not.toContain("tour=1");
  });

  it("no comment in the wizard still describes a coachmark tour that no longer exists (§1h.35 (e))", () => {
    expect(source).not.toMatch(/coachmark/i);
  });
});
