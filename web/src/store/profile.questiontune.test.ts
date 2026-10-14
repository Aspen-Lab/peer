import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { defaultProfile } from "@/types";
import { exportProfileDocument, parseExportedProfile, useProfileStore } from "./profile";

// P10-03 (round P10, ruling §1h.78; the owner's review 2.3, rubric A6): the one opt-out of what the reader's
// questions teach Peer is a switch on the Profile, `questionsTuneRecommendations` — an optional boolean, absent
// meaning on — replacing the per-question opt-out tick. It is kept with the profile as the other
// fields are: in the browser's profile store, in the backup file, and through a reload.

describe("profile.questionsTuneRecommendations — the setter", () => {
  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  it("a fresh profile has it absent, which is on", () => {
    expect(defaultProfile.questionsTuneRecommendations).toBeUndefined();
    expect("questionsTuneRecommendations" in useProfileStore.getState().profile).toBe(false);
  });

  it("turning it off stores false; turning it on takes the key away again, so the profile is as it was", () => {
    useProfileStore.getState().updateQuestionsTuneRecommendations(false);
    expect(useProfileStore.getState().profile.questionsTuneRecommendations).toBe(false);
    useProfileStore.getState().updateQuestionsTuneRecommendations(true);
    expect(useProfileStore.getState().profile.questionsTuneRecommendations).toBeUndefined();
    expect(useProfileStore.getState().profile).toEqual(defaultProfile);
  });

  it("touches no other profile field (it is not a feed intent input) and leaves the feed card alone", () => {
    const before = useProfileStore.getState().profile;
    useProfileStore.getState().updateQuestionsTuneRecommendations(false);
    expect(useProfileStore.getState().profile).toEqual({ ...before, questionsTuneRecommendations: false });
    expect(useProfileStore.getState().profile.feedIntent).toBe(before.feedIntent);
  });
});

describe("profile.questionsTuneRecommendations — storage and backup", () => {
  async function rehydrateFrom(profile: Record<string, unknown>, version = 8) {
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
    return { mod, read: () => stored };
  }

  it("an old stored profile without the field loads with it on and keeps its other fields", async () => {
    try {
      const { mod } = await rehydrateFrom({ ...defaultProfile, displayName: "Old Reader" });
      const profile = mod.useProfileStore.getState().profile;
      expect(profile.questionsTuneRecommendations).toBeUndefined();
      expect(profile.displayName).toBe("Old Reader");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an off switch survives a reload, with no version change", async () => {
    try {
      const { mod, read } = await rehydrateFrom({ ...defaultProfile, questionsTuneRecommendations: false });
      expect(mod.useProfileStore.getState().profile.questionsTuneRecommendations).toBe(false);
      mod.useProfileStore.getState().updateQuestionsTuneRecommendations(false);
      const written = JSON.parse(read());
      expect(written.version).toBe(8);
      expect(written.state.profile.questionsTuneRecommendations).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a backup file carries it and a restore reads it back; anything but a boolean is ignored", () => {
    const doc = exportProfileDocument({ ...defaultProfile, questionsTuneRecommendations: false });
    expect(doc.profile.questionsTuneRecommendations).toBe(false);
    expect(parseExportedProfile(JSON.parse(JSON.stringify(doc)))?.questionsTuneRecommendations).toBe(false);
    for (const junk of ["no", 0, null, ["false"], {}]) {
      const parsed = parseExportedProfile({ format: doc.format, profile: { ...doc.profile, questionsTuneRecommendations: junk } });
      expect(parsed?.questionsTuneRecommendations).toBeUndefined();
    }
  });
});
