import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  activePaperTopicsKey,
  opportunityRequestBody,
  paperFeedRequestBody,
} from "./feed";
import { selectedSenseConcept } from "@/lib/feed/senses";

const activeProfile: UserProfile = {
  ...defaultProfile,
  researchTopics: ["pending-paper"],
  softTopics: ["pending-paper-explore"],
  eventRequiredTopics: ["pending-event"],
  eventExploreTopics: ["pending-event-explore"],
  jobRequiredTopics: ["pending-job"],
  jobExploreTopics: ["pending-job-explore"],
  careerStage: "Postdoc",
  locationPreferences: ["Pending location"],
  authorisedCountries: ["United States"],
  activeSearchInputs: {
    papers: {
      required: ["active-paper"],
      explore: ["active-paper-explore"],
    },
    events: {
      required: ["active-event"],
      explore: ["active-event-explore"],
    },
    jobs: {
      required: ["active-job"],
      explore: ["active-job-explore"],
    },
    careerStage: "PhD Year 4",
    locationPreferences: ["Active location"],
    promotedOn: "2026-07-29",
  },
};

const advisorSeeds = {
  seedTexts: [],
  seedWorkIds: [],
};

function buildSearchRequests(profile: UserProfile) {
  return {
    papers: paperFeedRequestBody(profile, advisorSeeds),
    events: opportunityRequestBody(profile, "events", []),
    jobs: opportunityRequestBody(profile, "jobs", []),
  };
}

describe("active feed request inputs", () => {
  it("defaults every surface to Tier 0 with no model override", () => {
    const requests = buildSearchRequests(activeProfile);

    expect(requests.papers.aiTier).toBe(0);
    expect(requests.events.aiTier).toBe(0);
    expect(requests.jobs.aiTier).toBe(0);
    expect(requests.papers.llmOverride).toBeUndefined();
    expect(requests.events.llmOverride).toBeUndefined();
    expect(requests.jobs.llmOverride).toBeUndefined();
  });

  it("uses Tier 2 only with the user's selected provider and key", () => {
    const byokProfile: UserProfile = {
      ...activeProfile,
      feedAiProvider: "openai",
      feedAiApiKey: "user-owned-key",
    };
    const papers = paperFeedRequestBody(byokProfile, advisorSeeds, true);
    const events = opportunityRequestBody(byokProfile, "events", []);

    expect(papers.aiTier).toBe(2);
    expect(papers.llmOverride).toEqual({
      provider: "openai",
      apiKey: "user-owned-key",
    });
    expect(events.aiTier).toBe(2);
    expect(events.llmOverride).toEqual({
      provider: "openai",
      apiKey: "user-owned-key",
    });
  });

  it("keeps every request body unchanged when pending search inputs mutate", () => {
    const before = buildSearchRequests(activeProfile);
    const beforeAutoLoadKey = activePaperTopicsKey(activeProfile);
    const editedPending: UserProfile = {
      ...activeProfile,
      researchTopics: ["edited-pending-paper"],
      softTopics: ["edited-pending-paper-explore"],
      eventRequiredTopics: ["edited-pending-event"],
      eventExploreTopics: ["edited-pending-event-explore"],
      jobRequiredTopics: ["edited-pending-job"],
      jobExploreTopics: ["edited-pending-job-explore"],
      careerStage: "Research Scientist",
      locationPreferences: ["Edited pending location"],
    };

    expect(buildSearchRequests(editedPending)).toEqual(before);
    expect(activePaperTopicsKey(editedPending)).toBe(beforeAutoLoadKey);
  });

  it("routes Events and Jobs active topics only to their matching requests", () => {
    const events = opportunityRequestBody(activeProfile, "events", []);
    const jobs = opportunityRequestBody(activeProfile, "jobs", []);

    expect(events).toMatchObject({
      topics: ["active-event"],
      softTopics: ["active-event-explore"],
    });
    expect(jobs).toMatchObject({
      topics: ["active-job"],
      softTopics: ["active-job-explore"],
      authorisedCountries: ["United States"],
    });
    expect(events).not.toHaveProperty("authorisedCountries");
    expect(events.topics).not.toEqual(
      activeProfile.activeSearchInputs?.papers.required,
    );
    expect(jobs.topics).not.toEqual(
      activeProfile.activeSearchInputs?.papers.required,
    );
  });

  it("routes only the active Papers topics to the paper request", () => {
    const papers = paperFeedRequestBody(activeProfile, advisorSeeds);

    expect(papers).toMatchObject({
      topics: ["active-paper"],
      softTopics: ["active-paper-explore"],
    });
    expect(papers.topics).not.toEqual(
      activeProfile.activeSearchInputs?.events.required,
    );
    expect(papers.topics).not.toEqual(
      activeProfile.activeSearchInputs?.jobs.required,
    );
  });

  it("keeps a project-only paper request usable and separately labeled", () => {
    const profile: UserProfile = {
      ...activeProfile,
      researchTopics: [],
      activeSearchInputs: { ...activeProfile.activeSearchInputs!, papers: { required: [], explore: [] } },
      currentProject: "Reduce sulfide interface resistance",
      currentChallenges: "Avoid dendrite formation",
    };

    expect(paperFeedRequestBody(profile, advisorSeeds)).toMatchObject({
      topics: [],
      project: "Reduce sulfide interface resistance",
      challenge: "Avoid dendrite formation",
      intent: {
        version: "feed-intent-v1",
        project: { presence: "value", value: "Reduce sulfide interface resistance" },
        challenge: { presence: "value", value: "Avoid dendrite formation" },
      },
    });
  });

  it("keeps browser clears explicit and makes the paper current-key include intent", () => {
    const withTopic: UserProfile = {
      ...activeProfile,
      currentProject: "",
      currentChallenges: "",
    };
    const changedProject: UserProfile = {
      ...activeProfile,
      currentProject: "Investigate interface resistance",
    };

    expect(paperFeedRequestBody(withTopic, advisorSeeds)).toMatchObject({
      intent: {
        project: { presence: "explicit-empty" },
        challenge: { presence: "explicit-empty" },
      },
    });
    expect(activePaperTopicsKey(changedProject)).not.toBe(
      activePaperTopicsKey(activeProfile),
    );
  });

  it("keeps an empty browser intent out of the request path", () => {
    const emptyBrowserProfile: UserProfile = {
      ...activeProfile,
      currentProject: "",
      currentChallenges: "",
      activeSearchInputs: {
        ...activeProfile.activeSearchInputs!,
        papers: { required: [], explore: [] },
      },
    };

    expect(paperFeedRequestBody(emptyBrowserProfile, advisorSeeds)).toMatchObject({
      topics: [],
      intent: undefined,
    });
    expect(activePaperTopicsKey(emptyBrowserProfile)).toBe("");
  });

  it("carries an explicitly selected local sense in the browser v1 card without classifying legacy topics", () => {
    const profile: UserProfile = {
      ...activeProfile,
      researchTopics: ["conflict"],
      activeSearchInputs: { ...activeProfile.activeSearchInputs!, papers: { required: ["conflict"], explore: [] } },
      selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
    };

    expect(paperFeedRequestBody(profile, advisorSeeds)).toMatchObject({
      intent: { selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] },
    });
  });
});
