import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  activePaperTopicsKey,
  opportunityRequestBody,
  paperFeedRequestBody,
} from "./feed";

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
});

/**
 * ABC-freemium 6-03 — **the ask itself, which nothing had ever exercised.**
 *
 * B grepped this while writing 6-03's guide and found the gap: every existing
 * call in this file uses the three-argument form, and `store/feed.test.ts` never
 * calls `loadFeed` with `poolRefresh`, so `feed.ts`'s
 * `poolRefresh: poolRefresh || undefined` had **never once been evaluated with
 * `true`** in the whole suite. The refusal now has a message on screen, so the
 * request that provokes it is worth pinning.
 *
 * The `|| undefined` is the part that matters and it is not tidiness: the route
 * reads `body.poolRefresh === true`, so an explicit `false` on the wire would be
 * a field that says something about a request that is not asking for anything.
 * Absent means "not asking".
 */
describe("the forced-rebuild ask (6-03)", () => {
  it("sends poolRefresh only when the reader actually asked", () => {
    for (const surface of ["events", "jobs"] as const) {
      const asked = opportunityRequestBody(
        activeProfile,
        surface,
        [],
        undefined,
        true,
      );
      expect(asked.poolRefresh).toBe(true);
    }
  });

  it("omits the field entirely on an ordinary load, never sending false", () => {
    for (const surface of ["events", "jobs"] as const) {
      const ordinary = opportunityRequestBody(activeProfile, surface, []);
      expect(ordinary.poolRefresh).toBeUndefined();
      // Not merely falsy — absent. The route tests `=== true`, and a `false` on
      // the wire is a claim about a request that made no claim.
      expect(Object.values(ordinary)).not.toContain(false);
    }
  });

  it("is only an ASK — the client never decides whether it is granted", () => {
    // The entitlement is the server's business (`feed.ts`'s own docblock says
    // so). A free reader's request carries the same `poolRefresh: true` as a
    // paid reader's; the route is what refuses. This is why 6-03's notice reads
    // the entitlement rather than the response.
    const asked = opportunityRequestBody(
      activeProfile,
      "jobs",
      [],
      { userId: null },
      true,
    );
    expect(asked.poolRefresh).toBe(true);
  });
});
