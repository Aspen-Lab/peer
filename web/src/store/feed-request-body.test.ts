import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { useProfileStore } from "./profile";
import { useJevScreeningStore, type JevScreeningReport } from "./jev-screening";
import {
  activePaperTopicsKey,
  opportunityRequestBody,
  paperFeedRequestBody,
} from "./feed";
import { selectedSenseConcept } from "@/lib/feed/senses";
import { STARTER_TOPICS, STARTER_TOPICS_KEY } from "@/lib/feed/starter-topics";

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

  it("uses Tier 2 only with the user's selected provider and key, for a signed-in reader", () => {
    const byokProfile: UserProfile = {
      ...activeProfile,
      feedAiProvider: "openai",
      feedAiApiKey: "user-owned-key",
    };
    const papers = paperFeedRequestBody(
      byokProfile,
      advisorSeeds,
      true,
      [],
      "signed-in",
    );
    const events = opportunityRequestBody(
      byokProfile,
      "events",
      [],
      "signed-in",
    );

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

    // CHANGED (FIRST-VISIT RULING, see the next test's comment for the full
    // citation): the literal `topics` field is a separate, supplementary
    // signal from `project`/`challenge`/`intent` -- it is not the gate. With
    // no literal topics declared, `paperFeedRequestBody` now fills it from
    // the same starter list a genuinely-empty reader gets (`topicsOrStarter`,
    // main-authored), rather than leaving it empty. This is harmless: the
    // request is still driven primarily by `project`/`challenge`/`intent`
    // below (acceptance 1 -- "no dummy-keyword requirement"), which are
    // asserted unchanged.
    expect(paperFeedRequestBody(profile, advisorSeeds)).toMatchObject({
      topics: [...STARTER_TOPICS],
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

  it("sends the starter sample, not an empty request, for a genuinely empty browser intent", () => {
    // CHANGED (ABC-JEV-INTEGRATION.md §4 Round 3 "MERGE-B-FEED complete" FIRST-VISIT
    // RULING (a)): this used to assert `topics: []` / `activePaperTopicsKey === ""`
    // for a reader with nothing declared, on the theory that Jev should "ask
    // first" rather than guess. The merge adopts main's zero-setup first-run
    // design instead: a reader with NO declared project, challenge or topic at
    // all gets main's curated starter sample (never a blocking message), and
    // `activePaperTopicsKey` now falls back to `STARTER_TOPICS_KEY` rather than
    // the empty string so the auto-load effect in page.tsx actually fires. A
    // reader who HAS declared a project/challenge/topic still gets their own
    // intent-driven request, never the sample -- see the next test file's
    // "posts a 'project'-only..." case, and empty-reason.ts's `intentRequired`
    // guard, for the half of the ruling this file doesn't cover.
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
      topics: [...STARTER_TOPICS],
      intent: undefined,
    });
    expect(activePaperTopicsKey(emptyBrowserProfile)).toBe(STARTER_TOPICS_KEY);
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

/**
 * ABC-freemium 6-03 — retired with the forced-rebuild breaker.
 *
 * This block pinned **the ask itself**: `poolRefresh` went on the wire only when
 * the reader actually asked for a "Refresh now" rebuild of the jobs and events
 * pools, and the route decided whether to grant it against an entitlement and a
 * daily breaker on Peer's own model and search spend. Peer spends nothing of
 * either kind now, so the breaker, the entitlement and the route's decision are
 * all deleted, and so is the ask: no request body carries the field at all.
 */
describe("no forced-rebuild ask (6-03, retired)", () => {
  it("never puts a poolRefresh field on the wire, for any surface", () => {
    for (const surface of ["events", "jobs"] as const) {
      const body = opportunityRequestBody(
        activeProfile,
        surface,
        [],
        "signed-out",
      );
      expect(Object.keys(body)).not.toContain("poolRefresh");
    }
  });
});


// A Jev key is a second key the reader may bring. It travels as ONE top-level
// string, only for a reader the server can attribute it to, and only on the
// paper request: the digest, report and figure routes never use Jev, and the
// jobs and events requests do not carry it.
describe("a Jev key in the paper request", () => {
  // An invented string. It is not, and never was, a key.
  const JEV = "jev-test-sentinel-not-a-key-0000";
  const withKey: UserProfile = { ...activeProfile, jevApiKey: JEV };

  it("is sent as one top-level string for a signed-in reader", () => {
    const body = paperFeedRequestBody(withKey, advisorSeeds, false, [], "signed-in");
    expect(body.jevApiKey).toBe(JEV);
    expect(JSON.stringify(body).split(JEV)).toHaveLength(2);
  });

  it("is sent when sign-in is not configured at all (a self-hosted copy), as the model key is", () => {
    const body = paperFeedRequestBody(withKey, advisorSeeds, false, [], "unconfigured");
    expect(body.jevApiKey).toBe(JEV);
  });

  it.each(["signed-out", "unknown"] as const)(
    "is absent while the reader is %s, so a key that the server would refuse never leaves the browser",
    (auth) => {
      const body = paperFeedRequestBody(withKey, advisorSeeds, false, [], auth);
      expect(body.jevApiKey).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(JEV);
    },
  );

  it("is absent with the default (unknown) sign-in outcome", () => {
    const body = paperFeedRequestBody(withKey, advisorSeeds);
    expect(body.jevApiKey).toBeUndefined();
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", "  \t "],
  ])("is absent for %s", (_label, value) => {
    const body = paperFeedRequestBody(
      { ...activeProfile, jevApiKey: value },
      advisorSeeds,
      false,
      [],
      "signed-in",
    );
    expect(body.jevApiKey).toBeUndefined();
  });

  it("is trimmed", () => {
    const body = paperFeedRequestBody(
      { ...activeProfile, jevApiKey: `  ${JEV} ` },
      advisorSeeds,
      false,
      [],
      "signed-in",
    );
    expect(body.jevApiKey).toBe(JEV);
  });

  it("is not sent when it could not be a key (it has a space inside)", () => {
    const body = paperFeedRequestBody(
      { ...activeProfile, jevApiKey: "two words" },
      advisorSeeds,
      false,
      [],
      "signed-in",
    );
    expect(body.jevApiKey).toBeUndefined();
  });

  it("never sits inside llmOverride, and is sent without a model key and without the AI search pill (the two switches are the two keys)", () => {
    const body = paperFeedRequestBody(withKey, advisorSeeds, false, [], "signed-in");
    expect(body.llmOverride).toBeUndefined();
    expect(body.aiTier).toBe(0);
    expect(body.jevApiKey).toBe(JEV);

    const both = paperFeedRequestBody(
      { ...withKey, feedAiProvider: "openai", feedAiApiKey: "user-owned-key" },
      advisorSeeds,
      true,
      [],
      "signed-in",
    );
    expect(both.llmOverride).toEqual({ provider: "openai", apiKey: "user-owned-key" });
    expect(JSON.stringify(both.llmOverride)).not.toContain(JEV);
    expect(both.jevApiKey).toBe(JEV);
  });

  it("does not change what the request says about the reader's model key", () => {
    const without = paperFeedRequestBody(activeProfile, advisorSeeds, false, [], "signed-in");
    const withJev = paperFeedRequestBody(withKey, advisorSeeds, false, [], "signed-in");
    const { jevApiKey, ...rest } = withJev;
    void jevApiKey;
    expect(rest).toEqual({ ...without, jevApiKey: undefined });
  });

  it("is not carried by the jobs or events requests", () => {
    for (const surface of ["events", "jobs"] as const) {
      const body = opportunityRequestBody(withKey, surface, [], "signed-in");
      expect(body).not.toHaveProperty("jevApiKey");
      expect(JSON.stringify(body)).not.toContain(JEV);
    }
  });
});

// N1 of the branch review. A key Jev rejected is not cached as a day's pool (the
// reader may fix a mistyped key), so while the key stays wrong every load rebuilds
// the pool and, for a reader with a model key as well, re-runs the model rerank on
// their own account. The browser already knows: the last report says "rejected".
// So the request leaves the key out while that report stands, the server builds
// (and caches) the keyless pool once, and editing the key clears the report
// (`updateJevApiKey`), which makes the next load try the new one.
describe("a Jev key Jev has already rejected", () => {
  const REJECTED_KEY = "jev-rejected-sentinel-not-a-key-0000";
  const NEW_KEY = "jev-replacement-sentinel-not-a-key-1111";
  const rejected: JevScreeningReport = { status: "rejected", screened: 0, of: 50 };

  const bodyFor = (profile: UserProfile) => paperFeedRequestBody(profile, advisorSeeds, false, [], "signed-in");

  beforeEach(() => {
    useProfileStore.setState({ profile: { ...defaultProfile } });
    useJevScreeningStore.setState({ report: null });
  });

  afterEach(() => {
    useJevScreeningStore.setState({ report: null });
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });

  it("is left out of the request while the last report says Jev rejected it", () => {
    useJevScreeningStore.setState({ report: rejected });

    const body = bodyFor({ ...activeProfile, jevApiKey: REJECTED_KEY });

    expect(body.jevApiKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(REJECTED_KEY);
  });

  it("changes nothing else in the request", () => {
    const withKey = { ...activeProfile, jevApiKey: REJECTED_KEY };
    const normal = bodyFor(withKey);
    useJevScreeningStore.setState({ report: rejected });

    const suppressed = bodyFor(withKey);

    const { jevApiKey: sent, ...restNormal } = normal;
    void sent;
    expect(suppressed).toEqual({ ...restNormal, jevApiKey: undefined });
  });

  it.each<JevScreeningReport | null>([
    null,
    { status: "applied", screened: 50, of: 50 },
    { status: "partial", screened: 31, of: 50 },
    { status: "unavailable", screened: 0, of: 50 },
    { status: "unavailable", screened: 20, of: 50 },
  ])("still sends the key after any other report (%j)", (report) => {
    useJevScreeningStore.setState({ report });

    expect(bodyFor({ ...activeProfile, jevApiKey: REJECTED_KEY }).jevApiKey).toBe(REJECTED_KEY);
  });

  it("sends again once the key is changed, because updateJevApiKey clears the rejected report", () => {
    useProfileStore.getState().updateJevApiKey(REJECTED_KEY);
    useJevScreeningStore.setState({ report: rejected });
    expect(bodyFor(useProfileStore.getState().profile).jevApiKey).toBeUndefined();

    useProfileStore.getState().updateJevApiKey(NEW_KEY);

    expect(useJevScreeningStore.getState().report).toBeNull();
    expect(bodyFor(useProfileStore.getState().profile).jevApiKey).toBe(NEW_KEY);
  });

  it("sends again after the key is removed and put back (the other way to try the same key again)", () => {
    useProfileStore.getState().updateJevApiKey(REJECTED_KEY);
    useJevScreeningStore.setState({ report: rejected });

    useProfileStore.getState().updateJevApiKey("");
    useProfileStore.getState().updateJevApiKey(REJECTED_KEY);

    expect(bodyFor(useProfileStore.getState().profile).jevApiKey).toBe(REJECTED_KEY);
  });

  it("a rejected report does not make a signed-out reader's request carry the key either", () => {
    useJevScreeningStore.setState({ report: rejected });
    const body = paperFeedRequestBody({ ...activeProfile, jevApiKey: REJECTED_KEY }, advisorSeeds, false, [], "signed-out");
    expect(body.jevApiKey).toBeUndefined();
  });
});
