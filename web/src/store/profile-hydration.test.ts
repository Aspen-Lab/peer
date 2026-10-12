import { describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { localCalendarDate } from "@/lib/local-calendar-date";
import { defaultProfile } from "@/types";

describe("profile hydration", () => {
  it("installs promoted inputs before an immediate feed request is built", async () => {
    // A device that saved this profile before the events and jobs feeds were
    // stopped still holds their topic lists; hydration installs the Papers
    // inputs only (P9-32).
    const persistedProfile = {
      ...defaultProfile,
      researchTopics: ["paper-required"],
      softTopics: ["paper-explore"],
      eventRequiredTopics: ["event-required"],
      eventExploreTopics: ["event-explore"],
      jobRequiredTopics: ["job-required"],
      jobExploreTopics: ["job-explore"],
      locationPreferences: ["Chicago"],
      activeSearchInputs: undefined,
    };
    let stored = JSON.stringify({
      state: { profile: persistedProfile },
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
    const { useProfileStore } = await import("./profile");
    const { paperFeedRequestBody } = await import("./feed");

    await useProfileStore.persist.rehydrate();

    const hydrated = useProfileStore.getState().profile;
    expect(hydrated.activeSearchInputs).toEqual({
      papers: {
        required: ["paper-required"],
        explore: ["paper-explore"],
      },
      careerStage: defaultProfile.careerStage,
      locationPreferences: ["Chicago"],
      promotedOn: localCalendarDate(),
    });
    expect(hydrated).not.toHaveProperty("eventRequiredTopics");
    expect(hydrated).not.toHaveProperty("jobRequiredTopics");

    const request = paperFeedRequestBody(hydrated, {
      seedTexts: [],
      seedWorkIds: [],
    });
    expect(request.topics).toEqual(hydrated.activeSearchInputs?.papers.required);
    expect(request.softTopics).toEqual(
      hydrated.activeSearchInputs?.papers.explore,
    );
    vi.unstubAllGlobals();
  });
});
