import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  ANONYMOUS_CLIENT_ENTITLEMENT,
  type ClientEntitlement,
} from "@/lib/entitlement/allowance";
import { defaultProfile, type UserProfile } from "@/types";
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

/**
 * ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 — **the entitlement has a
 * third state, and the store starts in it.**
 *
 * This is the root of the fix rather than a restatement of the component
 * cases. The two upsell surfaces can only stay silent while the plan is unknown
 * if "unknown" is representable here at all — and for three rounds it was not:
 * the store opened on `ANONYMOUS_CLIENT_ENTITLEMENT`, so a **paid** reader
 * looked free from the first render until `GET /api/profile` came back, and was
 * upsold in that window while the server went on granting what they paid for.
 *
 * Planting the old default back — `entitlement: ANONYMOUS_CLIENT_ENTITLEMENT`
 * at the store's initialiser — fails the first case here and the unhydrated
 * cases in both component suites.
 */
describe("the client entitlement's third state (6-04)", () => {
  it("starts as null — not known yet, not known to be anonymous", () => {
    expect(useProfileStore.getState().entitlement).toBeNull();
  });

  it("holds whatever the server sent once setEntitlement runs", () => {
    // The negative twin: a store that returned `null` forever would pass the
    // case above and break every plan-aware surface in the product.
    const paid: ClientEntitlement = {
      plan: "paid",
      effectivePlan: "paid",
      systemSearchAllowed: false,
      poolRefreshAllowed: true,
      trialEndsAt: null,
      userId: "user-1",
      source: "supabase",
      unlimited: true,
      deepReportsRemaining: 0,
    };

    useProfileStore.getState().setEntitlement(paid);

    expect(useProfileStore.getState().entitlement).toEqual(paid);
  });

  it("can be told the reader is anonymous, which is a different answer", () => {
    // `ProfileSync` sets this once it has established there is no session. It
    // is the `known + anonymous` state: a fact, not the absence of one, and the
    // difference is what lets a signed-out reader be told to sign in while a
    // reader mid-hydration is told nothing.
    useProfileStore.getState().setEntitlement(ANONYMOUS_CLIENT_ENTITLEMENT);

    const held = useProfileStore.getState().entitlement;
    expect(held).not.toBeNull();
    expect(held?.source).toBe("anonymous");
    expect(held?.poolRefreshAllowed).toBe(false);
  });

  it("still writes only the profile to storage (the entitlement never persists)", () => {
    // Unchanged contract, re-asserted at the point the type changed: a cached
    // `paid` would survive a downgrade, and a cached `null` would be a lie the
    // moment the reader signed in on another tab. A source assertion because
    // `partialize` is a persist-middleware option with no runtime seam here;
    // whitespace-tolerant because the tree is CRLF on disk (Ruling 10 point 2c).
    const text = readFileSync(
      join(process.cwd(), "src/store/profile.ts"),
      "utf8",
    );
    // The positive form is the whole guard: `profile` is the ONLY key in the
    // persisted object, so adding `entitlement` to it cannot help but change
    // this shape and redden this line.
    expect(text).toMatch(
      /partialize:\s*\(state\)\s*=>\s*\(\{\s*profile:\s*state\.profile\s*\}\)/,
    );
  });
});
