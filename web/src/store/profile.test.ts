import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
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

describe("profile export and import", () => {
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
