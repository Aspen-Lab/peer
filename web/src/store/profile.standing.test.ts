import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { defaultProfile } from "@/types";
import { exportProfileDocument, parseExportedProfile, useProfileStore } from "./profile";

// P5-01 (blueprint P5; brief commit 1): a reader's standing questions live on the profile as
// `standingQuestions`, in the browser's profile store. The questions below are invented for the
// test; none is a real reader's.

const INVENTED = ["Which cohort was studied, and how large was it?", "Are negative findings reported?"];

describe("profile.standingQuestions — the setter", () => {
  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  it("a fresh profile has none", () => {
    expect(useProfileStore.getState().profile.standingQuestions ?? []).toEqual([]);
  });

  it("keeps the reader's words as typed, trimmed, with empty lines dropped", () => {
    useProfileStore.getState().updateStandingQuestions(["  " + INVENTED[0] + "  ", "", "   ", INVENTED[1]]);
    expect(useProfileStore.getState().profile.standingQuestions).toEqual(INVENTED);
  });

  it("keeps at most five, each at most 200 characters, distinct without regard to case", () => {
    const long = "x".repeat(260);
    useProfileStore.getState().updateStandingQuestions([long, "a?", "A?", "b?", "c?", "d?", "e?", "f?"]);
    const kept = useProfileStore.getState().profile.standingQuestions!;
    expect(kept).toHaveLength(5);
    expect(kept[0]).toHaveLength(200);
    expect(kept.slice(1)).toEqual(["a?", "b?", "c?", "d?"]);
  });

  it("touches no other profile field (it is not a feed intent input)", () => {
    const before = useProfileStore.getState().profile;
    useProfileStore.getState().updateStandingQuestions(INVENTED);
    expect(useProfileStore.getState().profile).toEqual({ ...before, standingQuestions: INVENTED });
  });

  it("an empty list leaves the profile with none", () => {
    useProfileStore.getState().updateStandingQuestions(INVENTED);
    useProfileStore.getState().updateStandingQuestions([]);
    expect(useProfileStore.getState().profile.standingQuestions ?? []).toEqual([]);
  });
});

describe("profile.standingQuestions — storage", () => {
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
    return { mod, read: () => stored };
  }

  it("an old stored profile without the field loads with none and keeps its other fields", async () => {
    try {
      const { mod } = await rehydrateFrom({ ...defaultProfile, displayName: "Old Reader" });
      const profile = mod.useProfileStore.getState().profile;
      expect(profile.standingQuestions ?? []).toEqual([]);
      expect(profile.displayName).toBe("Old Reader");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a stored list survives a reload, with no version change", async () => {
    try {
      const { mod } = await rehydrateFrom({ ...defaultProfile, standingQuestions: INVENTED });
      expect(mod.useProfileStore.getState().profile.standingQuestions).toEqual(INVENTED);
      mod.useProfileStore.getState().updateStandingQuestions([INVENTED[0]]);
      const written = JSON.parse(localStorageValue(mod));
      expect(written.version).toBe(7);
      expect(written.state.profile.standingQuestions).toEqual([INVENTED[0]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a backup file carries them and a restore reads them back (the reader's own file)", () => {
    const withThem = { ...defaultProfile, standingQuestions: INVENTED };
    const doc = exportProfileDocument(withThem);
    expect(doc.profile.standingQuestions).toEqual(INVENTED);
    expect(parseExportedProfile(JSON.parse(JSON.stringify(doc)))?.standingQuestions).toEqual(INVENTED);
  });
});

function localStorageValue(mod: typeof import("./profile")): string {
  void mod;
  return (globalThis as unknown as { window: { localStorage: StateStorage } }).window.localStorage.getItem("peer-profile") as string;
}
