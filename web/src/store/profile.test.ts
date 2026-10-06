import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import { selectedSenseConcept } from "@/lib/feed/senses";
import {
  exportProfileDocument,
  migrateProfileStore,
  parseExportedProfile,
  PROFILE_EXPORT_FORMAT,
  promoteSearchInputs,
  useProfileStore,
} from "./profile";

type SurfaceTopicField =
  | "eventRequiredTopics"
  | "eventExploreTopics"
  | "jobRequiredTopics"
  | "jobExploreTopics";

const profileFixture: UserProfile = {
  ...defaultProfile,
  researchTopics: ["paper-required"],
  softTopics: ["paper-explore"],
  eventRequiredTopics: ["event-required"],
  eventExploreTopics: ["event-explore"],
  jobRequiredTopics: ["job-required"],
  jobExploreTopics: ["job-explore"],
};

function expectOnlyTopicFieldChanged(
  field: SurfaceTopicField,
  update: (topics: string[]) => void,
) {
  const before = useProfileStore.getState().profile;
  const next = [`next-${field}`];

  update(next);

  expect(useProfileStore.getState().profile).toEqual({
    ...before,
    [field]: next,
  });
}

describe("profile per-surface topic setters", () => {
  beforeEach(() => {
    useProfileStore.setState({
      profile: {
        ...profileFixture,
        researchTopics: [...profileFixture.researchTopics],
        softTopics: [...(profileFixture.softTopics ?? [])],
        eventRequiredTopics: [...profileFixture.eventRequiredTopics],
        eventExploreTopics: [...profileFixture.eventExploreTopics],
        jobRequiredTopics: [...profileFixture.jobRequiredTopics],
        jobExploreTopics: [...profileFixture.jobExploreTopics],
      },
    });
  });

  it("writes each Events and Jobs topic field without changing another field", () => {
    const store = useProfileStore.getState();

    expectOnlyTopicFieldChanged(
      "eventRequiredTopics",
      store.updateEventTopics,
    );
    expectOnlyTopicFieldChanged(
      "eventExploreTopics",
      store.updateEventSoftTopics,
    );
    expectOnlyTopicFieldChanged("jobRequiredTopics", store.updateJobTopics);
    expectOnlyTopicFieldChanged("jobExploreTopics", store.updateJobSoftTopics);
  });
});

describe("research-focus field presence", () => {
  it("preserves an explicit project/challenge clear instead of collapsing it to omitted", () => {
    useProfileStore.setState({
      profile: { ...defaultProfile, currentProject: "Existing project", currentChallenges: "Existing challenge" },
    });

    useProfileStore.getState().updateCurrentProject("");
    useProfileStore.getState().updateCurrentChallenges("");

    expect(useProfileStore.getState().profile).toMatchObject({
      currentProject: "",
      currentChallenges: "",
    });
  });
});

describe("work authorisation countries", () => {
  beforeEach(() => {
    useProfileStore.setState({
      profile: {
        ...profileFixture,
        authorisedCountries: [],
      },
    });
  });

  it("defaults empty and updates multiple countries", () => {
    expect(defaultProfile.authorisedCountries).toEqual([]);

    useProfileStore
      .getState()
      .updateAuthorisedCountries(["Canada", "Germany"]);

    expect(useProfileStore.getState().profile.authorisedCountries).toEqual([
      "Canada",
      "Germany",
    ]);
  });

  it("hydrates work rights from another signed-in device without clearing local data when absent", () => {
    const store = useProfileStore.getState();
    store.updateAuthorisedCountries(["Canada"]);

    store.hydrateFromRemote({ authorisedCountries: ["Germany"] });
    expect(useProfileStore.getState().profile.authorisedCountries).toEqual([
      "Germany",
    ]);

    useProfileStore.getState().hydrateFromRemote({ authorisedCountries: undefined });
    expect(useProfileStore.getState().profile.authorisedCountries).toEqual([
      "Germany",
    ]);
  });
});

describe("profile persistence migration", () => {
  it("seeds empty per-surface fields from the v2 Papers topics", () => {
    const persistedV2 = {
      profile: {
        displayName: "Migrating member",
        researchTopics: ["solid-state battery"],
        softTopics: ["sodium-ion"],
        eventRequiredTopics: [],
        eventExploreTopics: [],
        jobRequiredTopics: [],
        jobExploreTopics: [],
        colorTheme: "lavender",
      },
    };

    const migrated = migrateProfileStore(persistedV2, 2);

    expect(migrated).toMatchObject({
      profile: {
        researchTopics: ["solid-state battery"],
        softTopics: ["sodium-ion"],
        eventRequiredTopics: ["solid-state battery"],
        eventExploreTopics: ["sodium-ion"],
        jobRequiredTopics: ["solid-state battery"],
        jobExploreTopics: ["sodium-ion"],
        colorTheme: "light:violet",
      },
    });
    expect(migrateProfileStore(migrated, 2)).toEqual(migrated);
  });

  it("does not overwrite user edits after the profile reaches v3", () => {
    const migrated = migrateProfileStore(
      {
        profile: {
          researchTopics: ["solid-state battery"],
          softTopics: ["sodium-ion"],
        },
      },
      2,
    ) as { profile: Record<string, unknown> };
    const editedV3 = {
      ...migrated,
      profile: {
        ...migrated.profile,
        eventRequiredTopics: ["electrochemistry conferences"],
        eventExploreTopics: [],
        jobRequiredTopics: ["battery scientist"],
        jobExploreTopics: ["national laboratory"],
      },
    };

    expect(migrateProfileStore(editedV3, 3)).toEqual(editedV3);
  });

  it("defaults a v3 profile with no work-authorisation field to empty", () => {
    expect(
      migrateProfileStore(
        {
          profile: {
            displayName: "Existing member",
          },
        },
        3,
      ),
    ).toMatchObject({
      profile: {
        authorisedCountries: [],
      },
    });
  });
});

describe("promoteSearchInputs", () => {
  it("creates the active snapshot on first run", () => {
    const promoted = promoteSearchInputs(
      profileFixture,
      new Date(2026, 6, 28, 8, 30),
    );

    expect(promoted.activeSearchInputs).toEqual({
      papers: {
        required: ["paper-required"],
        explore: ["paper-explore"],
      },
      events: {
        required: ["event-required"],
        explore: ["event-explore"],
      },
      jobs: {
        required: ["job-required"],
        explore: ["job-explore"],
      },
      careerStage: profileFixture.careerStage,
      locationPreferences: profileFixture.locationPreferences,
      promotedOn: "2026-07-28",
    });
  });

  it("returns the same profile object without refreshing on the same local day", () => {
    const promoted = promoteSearchInputs(
      profileFixture,
      new Date(2026, 6, 28, 0, 1),
    );
    const pendingEdit = {
      ...promoted,
      researchTopics: ["pending-paper-edit"],
      eventRequiredTopics: ["pending-event-edit"],
      jobRequiredTopics: ["pending-job-edit"],
    };

    expect(
      promoteSearchInputs(pendingEdit, new Date(2026, 6, 28, 23, 59)),
    ).toBe(pendingEdit);
  });

  it("promotes the latest pending values on the next local day", () => {
    const firstDay = promoteSearchInputs(
      profileFixture,
      new Date(2026, 6, 28, 23, 59),
    );
    const pendingEdit: UserProfile = {
      ...firstDay,
      researchTopics: ["next-paper"],
      softTopics: ["next-paper-explore"],
      eventRequiredTopics: ["next-event"],
      eventExploreTopics: ["next-event-explore"],
      jobRequiredTopics: ["next-job"],
      jobExploreTopics: ["next-job-explore"],
      careerStage: "Postdoc",
      locationPreferences: ["Chicago"],
    };

    expect(
      promoteSearchInputs(pendingEdit, new Date(2026, 6, 29, 0, 1))
        .activeSearchInputs,
    ).toEqual({
      papers: {
        required: ["next-paper"],
        explore: ["next-paper-explore"],
      },
      events: {
        required: ["next-event"],
        explore: ["next-event-explore"],
      },
      jobs: {
        required: ["next-job"],
        explore: ["next-job-explore"],
      },
      careerStage: "Postdoc",
      locationPreferences: ["Chicago"],
      promotedOn: "2026-07-29",
    });
  });
});

describe("bootstrap promotion — first-time onboarding", () => {
  const NOW = new Date("2026-07-29T12:00:00");
  const TOMORROW = new Date("2026-07-30T12:00:00");

  it("promotes topics entered after the day's promotion already ran on an empty profile", () => {
    // Hydration promotes while the profile is still empty.
    const firstOpen = promoteSearchInputs({ ...defaultProfile }, NOW);
    expect(firstOpen.activeSearchInputs?.papers.required).toEqual([]);

    // The user then completes onboarding the same day.
    const afterOnboarding = promoteSearchInputs(
      {
        ...firstOpen,
        researchTopics: ["battery"],
        eventRequiredTopics: ["battery"],
        jobRequiredTopics: ["battery"],
      },
      NOW,
    );

    expect(afterOnboarding.activeSearchInputs?.papers.required).toEqual(["battery"]);
    expect(afterOnboarding.activeSearchInputs?.events.required).toEqual(["battery"]);
  });

  it("still refuses a same-day promotion once real inputs exist", () => {
    const day1 = promoteSearchInputs(
      { ...defaultProfile, researchTopics: ["battery"] },
      NOW,
    );
    const edited = { ...day1, researchTopics: ["battery", "sodium-ion"] };
    const sameDay = promoteSearchInputs(edited, NOW);
    expect(sameDay.activeSearchInputs?.papers.required).toEqual(["battery"]);

    const nextDay = promoteSearchInputs(edited, TOMORROW);
    expect(nextDay.activeSearchInputs?.papers.required).toEqual([
      "battery",
      "sodium-ion",
    ]);
  });
});

describe("work authorisation persistence", () => {
  it("defaults a v3 profile and round-trips selected countries", async () => {
    let stored = JSON.stringify({
      state: {
        profile: {
          ...defaultProfile,
          authorisedCountries: undefined,
        },
      },
      version: 3,
    });
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

    try {
      vi.resetModules();
      const firstModule = await import("./profile");
      await firstModule.useProfileStore.persist.rehydrate();
      expect(
        firstModule.useProfileStore.getState().profile.authorisedCountries,
      ).toEqual([]);

      firstModule.useProfileStore
        .getState()
        .updateAuthorisedCountries(["Canada", "Germany"]);
      expect(
        (
          JSON.parse(stored) as {
            state: { profile: UserProfile };
          }
        ).state.profile.authorisedCountries,
      ).toEqual(["Canada", "Germany"]);

      vi.resetModules();
      const secondModule = await import("./profile");
      await secondModule.useProfileStore.persist.rehydrate();
      expect(
        secondModule.useProfileStore.getState().profile.authorisedCountries,
      ).toEqual(["Canada", "Germany"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// PROFILE-SYNC (ABC-JEV-INTEGRATION.md §1bk) — lastSynced, a per-device
// snapshot of the single-value fields' last-confirmed values (store version
// 4 → 5). Same rehydration pattern as "work authorisation persistence"
// above: a real localStorage-backed round trip, not just the pure
// migrateProfileStore function in isolation, since the property being
// proven ("survives a reload") is specifically about the persist pipeline.
describe("lastSynced (§1bk, store version 4 → 5)", () => {
  it("a pre-v5 blob has no lastSynced after rehydration — the bootstrap rule applies on its first post-fix sync", async () => {
    let stored = JSON.stringify({
      state: { profile: { ...defaultProfile, displayName: "Alice Chen" } },
      version: 4,
    });
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
    try {
      vi.resetModules();
      const mod = await import("./profile");
      await mod.useProfileStore.persist.rehydrate();
      expect(mod.useProfileStore.getState().lastSynced).toBeFalsy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("survives a reload once set (persistence round-trip)", async () => {
    let stored = JSON.stringify({ state: { profile: defaultProfile }, version: 5 });
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
    try {
      vi.resetModules();
      const firstModule = await import("./profile");
      await firstModule.useProfileStore.persist.rehydrate();
      firstModule.useProfileStore.getState().setLastSynced({ displayName: "Alice Chen" });
      expect(
        (
          JSON.parse(stored) as {
            state: { lastSynced?: Partial<UserProfile> };
          }
        ).state.lastSynced,
      ).toEqual({ displayName: "Alice Chen" });

      vi.resetModules();
      const secondModule = await import("./profile");
      await secondModule.useProfileStore.persist.rehydrate();
      expect(secondModule.useProfileStore.getState().lastSynced).toEqual({
        displayName: "Alice Chen",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // LIST-REMOVAL-SYNC (§1bq.1, store version 5 → 6) — lastSynced now ALSO
  // folds in the LIST_FIELDS entries (the three-way merge's per-device
  // "base"), through the SAME persisted object and the same
  // setLastSynced/singleValueSnapshot path — no new store field, no new
  // write path.
  it("(§1bq.1) a list-field lastSynced entry survives a reload too, under store version 6", async () => {
    let stored = JSON.stringify({ state: { profile: defaultProfile }, version: 6 });
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
    try {
      vi.resetModules();
      const firstModule = await import("./profile");
      await firstModule.useProfileStore.persist.rehydrate();
      firstModule.useProfileStore.getState().setLastSynced({ researchTopics: ["battery materials"] });
      expect(
        (
          JSON.parse(stored) as {
            state: { lastSynced?: Partial<UserProfile> };
          }
        ).state.lastSynced,
      ).toEqual({ researchTopics: ["battery materials"] });

      vi.resetModules();
      const secondModule = await import("./profile");
      await secondModule.useProfileStore.persist.rehydrate();
      expect(secondModule.useProfileStore.getState().lastSynced).toEqual({
        researchTopics: ["battery materials"],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // A device already on v5 (real SINGLE_VALUE_FIELDS entries, no list
  // entries yet) must not crash or lose its scalar baselines on the v5→v6
  // upgrade — it just has no list baseline yet, which is the ordinary
  // no-base/bootstrap case downstream, not a migration failure.
  it("(§1bq.1) a real v5 lastSynced (scalars only, no list entries yet) survives the v5→v6 upgrade untouched", async () => {
    let stored = JSON.stringify({
      state: { profile: defaultProfile, lastSynced: { displayName: "Alice Chen" } },
      version: 5,
    });
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
    try {
      vi.resetModules();
      const mod = await import("./profile");
      await mod.useProfileStore.persist.rehydrate();
      expect(mod.useProfileStore.getState().lastSynced).toEqual({ displayName: "Alice Chen" });
      expect(mod.useProfileStore.getState().lastSynced).not.toHaveProperty("researchTopics");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setLastSynced replaces the previous snapshot rather than merging into it", () => {
    useProfileStore.getState().setLastSynced({ displayName: "Alice", careerStage: "Postdoc" });
    useProfileStore.getState().setLastSynced({ displayName: "Alice V2" });
    expect(useProfileStore.getState().lastSynced).toEqual({ displayName: "Alice V2" });
  });

  it("logOut() also clears lastSynced, so a later sign-in starts from the bootstrap rule, not a stale snapshot", () => {
    useProfileStore.getState().setLastSynced({ displayName: "Alice Chen" });
    useProfileStore.getState().logOut();
    expect(useProfileStore.getState().lastSynced).toBeNull();
  });
});

// ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt point 1, store version 6 → 7)
// — syncedAccountId, the device's recorded owner. Same rehydration pattern
// as "lastSynced" above: a real localStorage-backed round trip, since the
// property being proven ("survives a reload", "a pre-v7 blob reads as no
// owner yet") is specifically about the persist pipeline.
describe("syncedAccountId (§1bt point 1, store version 6 → 7)", () => {
  it("5. a pre-v7 blob (no syncedAccountId key at all) rehydrates as null — 'no owner yet', not a forced switch", async () => {
    let stored = JSON.stringify({
      state: { profile: defaultProfile, lastSynced: { displayName: "construction-existing-value" } },
      version: 6,
    });
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
    try {
      vi.resetModules();
      const mod = await import("./profile");
      await mod.useProfileStore.persist.rehydrate();
      expect(mod.useProfileStore.getState().syncedAccountId).toBeNull();
      // The pre-existing v6 lastSynced survives untouched alongside it.
      expect(mod.useProfileStore.getState().lastSynced).toEqual({ displayName: "construction-existing-value" });
    } finally {
      vi.unstubAllGlobals();
    }
    // MUTATION GUARD: defaulting a missing field to any non-null sentinel
    // (instead of leaving the creator's own `null` in place) would make
    // every existing user's very next sign-in wrongly read as an account
    // switch — this assertion goes red.
  });

  it("survives a reload once set (persistence round-trip)", async () => {
    let stored = JSON.stringify({ state: { profile: defaultProfile }, version: 7 });
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
    try {
      vi.resetModules();
      const firstModule = await import("./profile");
      await firstModule.useProfileStore.persist.rehydrate();
      firstModule.useProfileStore.getState().setSyncedAccountId("user-a");
      expect(
        (JSON.parse(stored) as { state: { syncedAccountId?: string | null } }).state.syncedAccountId,
      ).toBe("user-a");

      vi.resetModules();
      const secondModule = await import("./profile");
      await secondModule.useProfileStore.persist.rehydrate();
      expect(secondModule.useProfileStore.getState().syncedAccountId).toBe("user-a");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("logOut() also clears syncedAccountId, so the next sign-in on this device starts from 'no owner yet'", () => {
    useProfileStore.getState().setSyncedAccountId("user-a");
    useProfileStore.getState().logOut();
    expect(useProfileStore.getState().syncedAccountId).toBeNull();
  });
});

// PROFILE-UNSYNCED-FIELDS (§1bp.2) — once `feedIntent` holds a value
// (installed by `hydrateFromRemote`, the one production trigger — the
// Profile page's email-confirm redirect), `profileFeedIntentCard`
// (lib/feed/intent.ts) re-validates that EXISTING card instead of
// recomputing it from softTopics/researchTopics/etc., so a same-session
// edit to any of those inputs would silently never reach the pushed
// feedIntent unless the input's own setter clears it. Table-driven over
// every store `set()` call found by grepping this file for the five
// INTENT_LIST_FIELDS/INTENT_SINGLE_FIELDS names (lib/profile/merge.ts) —
// not copied from docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-20260930T074850Z.md's
// own POLICY list, which named updateTopics/updateSoftTopics/updateMethods/
// updateCurrentProject/updateCurrentChallenges/"dislikedTopics's setter" but
// missed `followTerm` (it writes softTopics too, independently of
// updateSoftTopics, for the reading-page "follow this term" control).
// dislikedTopics itself has no setter anywhere in this file (confirmed by
// the same grep — zero matches for any `updateDislikedTopics`-shaped name),
// so there is nothing to add a case for.
describe("intent-input setters invalidate a stale feedIntent (§1bp.2)", () => {
  const staleFeedIntent = {
    version: "feed-intent-v1" as const,
    project: { presence: "omitted" as const },
    challenge: { presence: "omitted" as const },
    requiredConcepts: ["stale-required"],
    preferredConcepts: ["stale-preferred"],
    exclusions: [],
    methods: ["stale-method"],
    selectedSenseConcepts: [],
  };

  beforeEach(() => {
    useProfileStore.setState({
      profile: { ...defaultProfile, feedIntent: staleFeedIntent },
    });
  });

  const cases: Array<[string, () => void]> = [
    ["updateTopics (researchTopics)", () => useProfileStore.getState().updateTopics(["fresh-topic"])],
    ["updateSoftTopics (softTopics)", () => useProfileStore.getState().updateSoftTopics(["fresh-explore"])],
    ["updateMethods (preferredMethods)", () => useProfileStore.getState().updateMethods(["fresh-method"])],
    [
      "updateCurrentProject (currentProject)",
      () => useProfileStore.getState().updateCurrentProject("fresh project text"),
    ],
    [
      "updateCurrentChallenges (currentChallenges)",
      () => useProfileStore.getState().updateCurrentChallenges("fresh challenge text"),
    ],
    [
      "followTerm (softTopics, the setter the investigation guide's own enumeration missed)",
      () => useProfileStore.getState().followTerm("fresh-followed-term", true),
    ],
  ];

  it.each(cases)("%s clears feedIntent so the next push recomputes it fresh", (_label, act) => {
    act();
    expect(useProfileStore.getState().profile.feedIntent).toBeUndefined();
  });

  it("followTerm's own no-op path (already following) makes no profile change at all, so it correctly leaves feedIntent untouched", () => {
    useProfileStore.setState({
      profile: { ...defaultProfile, softTopics: ["already-followed"], feedIntent: staleFeedIntent },
    });
    useProfileStore.getState().followTerm("already-followed", true);
    expect(useProfileStore.getState().profile.feedIntent).toBe(staleFeedIntent);
  });
});

describe("profile export and import", () => {
  it("preserves a canonical explicit clear or selected-sense card while rejecting forged cards", () => {
    const cleared = {
      version: "feed-intent-v1" as const,
      project: { presence: "explicit-empty" as const }, challenge: { presence: "omitted" as const },
      requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [],
    };
    expect(parseExportedProfile({ format: PROFILE_EXPORT_FORMAT, profile: { feedIntent: cleared } })?.feedIntent).toEqual(cleared);
    const selected = { ...cleared, selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] };
    expect(parseExportedProfile({ format: PROFILE_EXPORT_FORMAT, profile: { feedIntent: selected } })?.feedIntent).toEqual(selected);
    expect(parseExportedProfile({ format: PROFILE_EXPORT_FORMAT, profile: { feedIntent: { ...cleared, ownerId: "forged" }, plan: "paid", entitlement: {} } })).toBeNull();
  });

  // A signed-out profile lives in one browser's localStorage and nowhere else.
  // Clearing site data or opening a different browser loses it with no warning,
  // so a local tester needs a way to carry settings across without an account.
  it("round-trips a profile through an exported document", () => {
    const original: UserProfile = {
      ...defaultProfile,
      displayName: "Peter",
      researchTopics: ["LCO", "molten salt"],
      careerStage: "PhD Year 3",
    };

    const document = exportProfileDocument(original);
    expect(document.format).toBe(PROFILE_EXPORT_FORMAT);

    const restored = parseExportedProfile(
      JSON.parse(JSON.stringify(document)) as unknown,
    );
    expect(restored?.displayName).toBe("Peter");
    expect(restored?.researchTopics).toEqual(["LCO", "molten salt"]);
    expect(restored?.careerStage).toBe("PhD Year 3");
  });

  it("refuses anything that is not an exported profile", () => {
    for (const bad of [
      null,
      undefined,
      "not json",
      42,
      [],
      {},
      { format: "something/else", profile: { displayName: "X" } },
      { format: PROFILE_EXPORT_FORMAT },
      { format: PROFILE_EXPORT_FORMAT, profile: null },
      { format: PROFILE_EXPORT_FORMAT, profile: [] },
    ]) {
      expect(parseExportedProfile(bad)).toBeNull();
    }
  });

  it("ignores unknown keys rather than writing them into the profile", () => {
    const restored = parseExportedProfile({
      format: PROFILE_EXPORT_FORMAT,
      profile: { displayName: "Peter", somethingInvented: "should not survive" },
    });
    expect(restored).toEqual({ displayName: "Peter" });
  });

  it("leaves the existing profile untouched when the import is malformed", () => {
    const before = useProfileStore.getState().profile;
    expect(useProfileStore.getState().importProfile({ nonsense: true })).toBe(
      false,
    );
    expect(useProfileStore.getState().profile).toEqual(before);
  });
});

/**
 * The store holds no plan. Peer has no paid tier, so there is no entitlement for
 * a browser to keep, and the one question the client still asks ("is this
 * reader signed in?") is answered by `useSyncGate`, not by this store.
 */
describe("the profile store holds no plan", () => {
  it("has no entitlement field and no setter for one", () => {
    const state = useProfileStore.getState() as unknown as Record<string, unknown>;
    expect(state).not.toHaveProperty("entitlement");
    expect(state).not.toHaveProperty("setEntitlement");
  });

  // ACCOUNT-SWITCH (§1bt) — the persisted shape widened to a third key,
  // syncedAccountId (store v6→7); the regex below is the changed assertion
  // (comment required by that ruling). The property under test is
  // unchanged: nothing but those three keys is ever written to storage.
  it("still writes only the profile, lastSynced and syncedAccountId to storage [PROFILE-SYNC (§1bk): lastSynced added to the persisted shape; ACCOUNT-SWITCH (§1bt): syncedAccountId added too]", () => {
    // `lastSynced` is deliberately persisted (PROFILE-SYNC, §1bk): an
    // in-memory-only baseline is exactly the ping-pong bug it exists to fix.
    // `syncedAccountId` (ACCOUNT-SWITCH, §1bt) joins it for the same reason: an
    // in-memory-only owner id would forget whose device this is on every
    // reload.
    // A source assertion because `partialize` is a persist-middleware option
    // with no runtime seam here; whitespace-tolerant because the tree is
    // CRLF on disk (Ruling 10 point 2c).
    const text = readFileSync(
      join(process.cwd(), "src/store/profile.ts"),
      "utf8",
    );
    // The positive form is the whole guard: `profile`, `lastSynced` and
    // `syncedAccountId` are the ONLY keys in the persisted object, so
    // adding another key to it cannot help but change this shape and redden
    // this line.
    expect(text).toMatch(
      /partialize:\s*\(state\)\s*=>\s*\(\{\s*profile:\s*state\.profile,\s*lastSynced:\s*state\.lastSynced,\s*syncedAccountId:\s*state\.syncedAccountId,?\s*\}\)/,
    );
  });
});

// 9-23 (A9-07): the upload-button's own success callback is a one-shot,
// browser-only write — a navigation or offline gap between a successful
// upload and the next profile sync can lose it. The uploads-list load and
// the standalone reading-page load both call `recordUploadPreference`
// again as a recovery path; both rely on it being genuinely idempotent per
// `documentKey`, not merely "probably fine to call twice".
describe("recordUploadPreference — idempotent recovery merge (9-23)", () => {
  const uploadedPaper: Paper = {
    id: "upload:aaaa000000000000",
    title: "A private upload",
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: ["solid electrolyte"],
    preferenceSignals: [
      { key: "text:solid electrolyte", label: "solid electrolyte", source: "uploaded_article", confidence: 0.8 },
    ],
    summaryResultDiscussion: "",
    isSaved: false,
    uploadDocumentKey: "a".repeat(64),
  };

  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile, preferenceLedger: {} } });
  });

  it("recording the same upload twice (list load + button callback) yields one weight, not two", () => {
    // Fake timers + an explicit time advance between the two calls: without
    // this, `recordUploadPreference` computes `at` fresh via
    // `new Date().toISOString()` inside the same test tick, so two calls
    // can coincidentally produce byte-identical timestamps and pass even if
    // the underlying per-documentKey dedup were broken. Advancing real wall
    // time between calls is what actually exercises the guarantee.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-19T00:00:00.000Z"));
      useProfileStore.getState().recordUploadPreference(uploadedPaper);
      const once = useProfileStore.getState().profile.preferenceLedger;

      vi.setSystemTime(new Date("2026-09-19T01:00:00.000Z"));
      useProfileStore.getState().recordUploadPreference(uploadedPaper);
      const twice = useProfileStore.getState().profile.preferenceLedger;

      const entry = twice?.["text:solid electrolyte"];
      expect(entry?.uploads?.[uploadedPaper.uploadDocumentKey!]).toBeDefined();
      expect(Object.keys(entry?.uploads ?? {})).toHaveLength(1);
      expect(twice).toEqual(once);
    } finally {
      vi.useRealTimers();
    }
  });
});

// 9-23 (A9-07): confirm the field survives the actual round trip the app
// puts it through — the server cleans on PUT and again on GET
// (`app/api/profile/route.ts`), and the client's own `hydrateFromRemote`
// installs whatever comes back verbatim (no re-cleaning at hydrate time).
describe("a ledger with uploads survives clean -> server -> hydrate (9-23)", () => {
  it("keeps the uploads evidence through two cleanPreferenceLedger passes and a hydrate", () => {
    const raw = {
      "text:solid electrolyte": {
        key: "text:solid electrolyte", label: "solid electrolyte", source: "uploaded_article" as const,
        positive: 0, negative: 0, lastSeenAt: "2026-09-19T00:00:00.000Z",
        uploads: { [("b").repeat(64)]: { at: "2026-09-19T00:00:00.000Z", weight: 1.6 } },
      },
    };
    // PUT then GET, exactly as the server route does on each side of a sync.
    const afterPut = cleanPreferenceLedger(raw);
    const afterGet = cleanPreferenceLedger(afterPut);

    useProfileStore.setState({ profile: { ...defaultProfile, preferenceLedger: {} } });
    useProfileStore.getState().hydrateFromRemote({ preferenceLedger: afterGet });

    const hydrated = useProfileStore.getState().profile.preferenceLedger;
    expect(hydrated?.["text:solid electrolyte"]?.uploads).toEqual(raw["text:solid electrolyte"].uploads);
  });
});
