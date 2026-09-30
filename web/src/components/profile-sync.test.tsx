import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { dirtySingleValueFields, singleValueSnapshot } from "@/lib/profile/merge";
import {
  ProfileSync,
  remoteProfilePayload,
  reconcilePushPayload,
  planReconcile,
  nextSyncBaselines,
  type SyncBaselines,
  useProfileSyncStatus,
} from "./profile-sync";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1ah/§1aj) — this repo has no
// @testing-library/react and no test anywhere mounts a live effect (see
// web/src/lib/dashboard/use-batch-acknowledgement.test.ts's own header note
// on the same convention, and src/components/account/account-section.test.tsx
// for the presentational-render equivalent). The actual merge DECISION this
// component makes at sign-in (P1) is proven directly and headlessly in
// web/src/lib/profile/merge.test.ts — ProfileSync itself is a thin wrapper
// around that, entirely inside useEffect, which renderToStaticMarkup never
// runs (React server rendering skips effects entirely). What IS testable at
// this component's own boundary without a DOM: it renders without throwing,
// and the small pure/exported pieces it contributes to the fix — the closed
// credential-redaction gap (§1aj) and the visible push-failure status (P3).

describe("ProfileSync — SSR safety", () => {
  it("renders to nothing without throwing", () => {
    expect(() => renderToStaticMarkup(createElement(ProfileSync))).not.toThrow();
  });
});

// PROFILE-SYNC (§1bk.8 AMENDMENT) — the manager's check of round 1 found
// reconcilePushPayload only filtered the 14 SINGLE_VALUE_FIELDS + LIST_FIELDS
// and left every other scalar (the feed knobs) unconditionally in the
// payload. This enumerates EVERY key remoteProfilePayload actually emits for
// a fully populated profile — not just the UserProfile type on paper — so
// the classification in the checkpoint is grounded in real output, not
// memory. `fullyPopulatedProfile` gives every field (including the ones
// `defaultProfile` leaves genuinely absent: school, currentProject,
// currentChallenges, advisorName/advisorAuthorId/advisorAuthorLabel/
// advisorSeedWorkIds/advisorSeedTexts/advisorSeedsRefreshedAt,
// selectedSenseConcepts, activeSearchInputs) a real, non-default value, so
// no key is missing from the enumeration merely for being unset here.
const fullyPopulatedProfile: UserProfile = {
  ...defaultProfile,
  displayName: "Alice Chen",
  researchTopics: ["battery materials"],
  eventRequiredTopics: ["conference-topic"],
  eventExploreTopics: ["conference-explore"],
  jobRequiredTopics: ["job-topic"],
  jobExploreTopics: ["job-explore"],
  activeSearchInputs: {
    papers: { required: ["battery materials"], explore: [] },
    events: { required: ["conference-topic"], explore: ["conference-explore"] },
    jobs: { required: ["job-topic"], explore: ["job-explore"] },
    careerStage: "Postdoc",
    locationPreferences: ["Chicago"],
    promotedOn: "2026-09-29",
  },
  careerStage: "Postdoc",
  industryVsAcademia: "academia",
  locationPreferences: ["Chicago"],
  authorisedCountries: ["Canada"],
  preferredMethods: ["DFT"],
  phdYear: 5,
  school: "Example University",
  currentProject: "Fast-charging anodes",
  currentChallenges: "Dendrite suppression",
  selectedSenseConcepts: [],
  dislikedTopics: ["unrelated topic"],
  preferenceLedger: {
    "concept:a": {
      key: "concept:a",
      label: "A",
      source: "openalex_topic",
      positive: 1,
      negative: 0,
      lastSeenAt: "2026-09-01T00:00:00.000Z",
    },
  },
  softTopics: ["catalysis"],
  preferredJournals: ["Advanced Materials"],
  feedFocus: "tight",
  feedFreshness: "month",
  paperCount: 5,
  feedSourceMix: "preprints",
  feedImportance: "highlyCited",
  feedMethodMode: "mustMatch",
  feedDiscoveryMode: "adjacent",
  feedAvoidReviews: false,
  feedAvoidOldPapers: true,
  feedAvoidBroadSurveys: false,
  advisorName: "Dr. Morgan Example",
  advisorAuthorId: "A5012345678",
  advisorAuthorLabel: "Dr. Morgan Example (Example University)",
  advisorSeedWorkIds: ["W123"],
  advisorSeedTexts: ["seed text"],
  advisorSeedsRefreshedAt: "2026-09-01T00:00:00.000Z",
  digestEnabled: true,
  digestHourLocal: 19,
  digestTimezone: "America/Chicago",
  digestChannel: "email",
  digestFrequency: "weekly",
  digestEmail: "alice@example.edu",
  tavilyEnabled: true,
  tavilyApiKey: "tvly-secret",
  adzunaAppId: "adzuna-id",
  adzunaAppKey: "adzuna-secret",
  usajobsApiKey: "usajobs-secret",
  usajobsUserAgent: "me@example.test",
  feedAiProvider: "openai",
  feedAiApiKey: "sk-secret",
  deepReportEnabled: true,
  colorTheme: "dark:rose",
  onboardedAt: "2026-08-01T00:00:00.000Z",
};

describe("remoteProfilePayload — full field enumeration (§1bk.8 AMENDMENT)", () => {
  it("pins the exact key set emitted for a fully populated profile, so the classification table in the checkpoint is grounded in real output", () => {
    const payload = remoteProfilePayload(fullyPopulatedProfile);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "activeSearchInputs",
        "advisorAuthorId",
        "advisorAuthorLabel",
        "advisorName",
        "advisorSeedTexts",
        "advisorSeedWorkIds",
        "advisorSeedsRefreshedAt",
        "authorisedCountries",
        "careerStage",
        "colorTheme",
        "currentChallenges",
        "currentProject",
        "deepReportEnabled",
        "digestChannel",
        "digestEmail",
        "digestEnabled",
        "digestFrequency",
        "digestHourLocal",
        "digestTimezone",
        "dislikedTopics",
        "displayName",
        "eventExploreTopics",
        "eventRequiredTopics",
        "feedAvoidBroadSurveys",
        "feedAvoidOldPapers",
        "feedAvoidReviews",
        "feedDiscoveryMode",
        "feedFocus",
        "feedFreshness",
        "feedImportance",
        "feedIntent",
        "feedMethodMode",
        "feedSourceMix",
        "industryVsAcademia",
        "jobExploreTopics",
        "jobRequiredTopics",
        "locationPreferences",
        "onboardedAt",
        "paperCount",
        "phdYear",
        "preferenceLedger",
        "preferredJournals",
        "preferredMethods",
        "researchTopics",
        "school",
        "selectedSenseConcepts",
        "softTopics",
      ].sort(),
    );
    // Never present, regardless of how populated the profile is — the eight
    // fields remoteProfilePayload destructures out before recomputing
    // feedIntent (§1aj credential redaction, unaffected by this amendment).
    for (const credentialKey of [
      "tavilyEnabled",
      "tavilyApiKey",
      "adzunaAppId",
      "adzunaAppKey",
      "usajobsApiKey",
      "usajobsUserAgent",
      "feedAiProvider",
      "feedAiApiKey",
    ]) {
      expect(payload).not.toHaveProperty(credentialKey);
    }
  });
});

describe("remoteProfilePayload — credential redaction (§1aj)", () => {
  it("never includes tavily*/adzuna*/usajobs*/feedAi*, even when the local profile holds real values for all of them", () => {
    const profile = {
      ...defaultProfile,
      tavilyEnabled: true,
      tavilyApiKey: "tvly-secret",
      adzunaAppId: "adzuna-id",
      adzunaAppKey: "adzuna-secret",
      usajobsApiKey: "usajobs-secret",
      usajobsUserAgent: "me@example.test",
      feedAiProvider: "openai" as const,
      feedAiApiKey: "sk-secret",
    };
    const payload = remoteProfilePayload(profile);
    for (const key of [
      "tavilyEnabled",
      "tavilyApiKey",
      "adzunaAppId",
      "adzunaAppKey",
      "usajobsApiKey",
      "usajobsUserAgent",
      "feedAiProvider",
      "feedAiApiKey",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("still carries ordinary profile fields through", () => {
    const profile = {
      ...defaultProfile,
      displayName: "Aspen",
      researchTopics: ["battery materials"],
    };
    const payload = remoteProfilePayload(profile);
    expect(payload.displayName).toBe("Aspen");
    expect(payload.researchTopics).toEqual(["battery materials"]);
  });
});

describe("useProfileSyncStatus (P3 — a failed push must be visible, not console-only)", () => {
  it("starts with pushFailed false", () => {
    expect(useProfileSyncStatus.getState().pushFailed).toBe(false);
  });
});

// PROFILE-SYNC (ABC-JEV-INTEGRATION.md §1bk) — same headless-testing
// convention as merge.test.ts (this repo has no @testing-library/react and
// no test mounts a live effect): the reconcile push's DECISION is pulled
// out into pure, exported functions (reconcilePushPayload, planReconcile),
// so it is proven directly rather than by mounting <ProfileSync/> and
// intercepting fetch.

describe("reconcilePushPayload — only dirty fields (plus a genuinely changed list) reach the account (§1bk ruling 2)", () => {
  it("includes a dirty single-value field and excludes every non-dirty one, even though several differ from an absent remote value — the exact original bug, generalized", () => {
    const merged: UserProfile = { ...defaultProfile, displayName: "Alice Chen" }; // only displayName is a real edit
    const remote: Partial<UserProfile> = {}; // the account row has nothing for these columns yet
    const payload = reconcilePushPayload(merged, remote, new Set(["displayName"]));
    expect(payload.displayName).toBe("Alice Chen");
    // MUTATION GUARD: without dirty-filtering, careerStage ("PhD Year 3"),
    // industryVsAcademia ("both"), phdYear (3), colorTheme, digestHourLocal,
    // digestChannel, digestFrequency would ALL differ from remote's missing
    // values too, and leak into the payload.
    for (const key of [
      "careerStage",
      "industryVsAcademia",
      "phdYear",
      "colorTheme",
      "digestHourLocal",
      "digestChannel",
      "digestFrequency",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("includes a list field only when the union actually added something new", () => {
    const remote: Partial<UserProfile> = { researchTopics: ["battery materials"] };
    const changed: UserProfile = { ...defaultProfile, researchTopics: ["battery materials", "new topic"] };
    expect(reconcilePushPayload(changed, remote, new Set()).researchTopics).toEqual([
      "battery materials",
      "new topic",
    ]);
    const unchanged: UserProfile = { ...defaultProfile, researchTopics: ["battery materials"] };
    expect(reconcilePushPayload(unchanged, remote, new Set())).not.toHaveProperty("researchTopics");
  });

  it("with remote === null (first-ever sync), still sends only the dirty fields and real list content — never the untouched defaults", () => {
    const local: UserProfile = {
      ...defaultProfile,
      displayName: "Alice Chen",
      researchTopics: ["battery materials"],
    };
    const dirty = dirtySingleValueFields(local, null);
    const payload = reconcilePushPayload(local, null, dirty);
    expect(payload.displayName).toBe("Alice Chen");
    expect(payload.researchTopics).toEqual(["battery materials"]);
    expect(payload).not.toHaveProperty("careerStage");
    expect(payload).not.toHaveProperty("colorTheme");
  });

  // PROFILE-SYNC (§1bk.8 AMENDMENT) — the exact leak the manager's check
  // found: a non-dirty feed knob must be excluded even though it differs
  // from an absent remote value, the same shape as the original-14 proof
  // above, now for the amendment's fields.
  it("(§1bk.8 AMENDMENT) excludes every non-dirty feed knob, even though several differ from an absent remote value", () => {
    const merged: UserProfile = { ...defaultProfile, paperCount: 5 }; // only paperCount is a real edit
    const remote: Partial<UserProfile> = {}; // the account row has nothing for these columns yet
    const payload = reconcilePushPayload(merged, remote, new Set(["paperCount"]));
    expect(payload.paperCount).toBe(5);
    // MUTATION GUARD: without the amendment's widened dirty set, feedFocus
    // ("balanced"), feedFreshness ("week"), feedSourceMix ("balanced"),
    // feedImportance ("new"), feedMethodMode ("relatedOk"),
    // feedDiscoveryMode ("core"), feedAvoidReviews (true),
    // feedAvoidOldPapers (false), feedAvoidBroadSurveys (true), and
    // digestEnabled (true) would ALL differ from remote's missing values
    // too, and leak into the payload exactly like the original bug.
    for (const key of [
      "feedFocus",
      "feedFreshness",
      "feedSourceMix",
      "feedImportance",
      "feedMethodMode",
      "feedDiscoveryMode",
      "feedAvoidReviews",
      "feedAvoidOldPapers",
      "feedAvoidBroadSurveys",
      "digestEnabled",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("(§1bk.8 AMENDMENT) includes preferenceLedger only when it genuinely differs from remote's own", () => {
    const remoteLedger = {
      "concept:a": {
        key: "concept:a",
        label: "A",
        source: "openalex_topic" as const,
        positive: 1,
        negative: 0,
        lastSeenAt: "2026-09-01T00:00:00.000Z",
      },
    };
    const remote: Partial<UserProfile> = { preferenceLedger: remoteLedger };

    const unchanged: UserProfile = { ...defaultProfile, preferenceLedger: { ...remoteLedger } };
    expect(reconcilePushPayload(unchanged, remote, new Set())).not.toHaveProperty("preferenceLedger");

    const changed: UserProfile = {
      ...defaultProfile,
      preferenceLedger: {
        ...remoteLedger,
        "concept:b": {
          key: "concept:b",
          label: "B",
          source: "openalex_topic" as const,
          positive: 1,
          negative: 0,
          lastSeenAt: "2026-09-02T00:00:00.000Z",
        },
      },
    };
    expect(reconcilePushPayload(changed, remote, new Set())).toHaveProperty("preferenceLedger");
  });
});

describe("planReconcile — the sign-in reconcile decision, headlessly (§1bk)", () => {
  it("(a) fresh device: patch adopts the account's real values; pushPayload is empty for them", () => {
    const local: UserProfile = { ...defaultProfile };
    const remote: Partial<UserProfile> = { displayName: "Alice Chen", careerStage: "Postdoc" };
    const { patch, pushPayload } = planReconcile(local, remote, null);
    expect(patch.displayName).toBe("Alice Chen");
    expect(pushPayload).not.toHaveProperty("displayName");
    expect(pushPayload).not.toHaveProperty("careerStage");
  });

  it("(b) stale device: patch adopts the account's newer value; pushPayload does not resend the stale one", () => {
    const local: UserProfile = { ...defaultProfile, displayName: "Alice", digestChannel: "email" };
    const lastSynced: Partial<UserProfile> = { displayName: "Alice", digestChannel: "email" };
    const remote: Partial<UserProfile> = { displayName: "Alice V2", digestChannel: "both" };
    const { patch, pushPayload } = planReconcile(local, remote, lastSynced);
    expect(patch.displayName).toBe("Alice V2");
    expect(patch.digestChannel).toBe("both");
    expect(pushPayload).not.toHaveProperty("displayName");
    expect(pushPayload).not.toHaveProperty("digestChannel");
  });

  it("(c) edits made while signed out (remote null, no lastSynced): the real edit reaches pushPayload", () => {
    const local: UserProfile = { ...defaultProfile, displayName: "Alice Chen" };
    expect(planReconcile(local, null, null).pushPayload.displayName).toBe("Alice Chen");
  });

  it("(d) two devices, different fields: this device's own edit is pushed, the other device's field is adopted but not re-pushed", () => {
    const local: UserProfile = { ...defaultProfile, displayName: "Alice V2", digestChannel: "email" };
    const lastSynced: Partial<UserProfile> = { displayName: "Alice", digestChannel: "email" };
    const remote: Partial<UserProfile> = { displayName: "Alice", digestChannel: "both" };
    const { patch, pushPayload } = planReconcile(local, remote, lastSynced);
    expect(patch.displayName).toBe("Alice V2");
    expect(patch.digestChannel).toBe("both");
    expect(pushPayload.displayName).toBe("Alice V2");
    expect(pushPayload).not.toHaveProperty("digestChannel");
  });

  it("merged is local with patch applied — the exact snapshot the caller persists as lastSynced on success", () => {
    const local: UserProfile = { ...defaultProfile, displayName: "Alice" };
    const remote: Partial<UserProfile> = { careerStage: "Postdoc" };
    const { merged } = planReconcile(local, remote, null);
    expect(merged.displayName).toBe("Alice"); // dirty, kept
    expect(merged.careerStage).toBe("Postdoc"); // not dirty, adopted
  });

  // PROFILE-SYNC (§1bk.8 AMENDMENT) — "prove... that a stale device cannot
  // shrink or roll back the account's copy" for feedIntent specifically.
  // feedIntent is never merged as its own structure; mergeProfileAtSignIn
  // clears it (patch.feedIntent = undefined) whenever an intent-input field
  // is touched, forcing remoteProfilePayload to recompute it fresh from
  // the JUST-reconciled flat fields via profileFeedIntentCard — so a stale
  // device's OWN stale currentProject text can never leak into what gets
  // pushed, once currentProject itself reconciles correctly (§1aj, round 1).
  it("(§1bk.8 AMENDMENT) a stale device's recomputed feedIntent reflects the account's newer project text, not this device's own stale one", () => {
    const local: UserProfile = { ...defaultProfile, currentProject: "Old project text" };
    const lastSynced: Partial<UserProfile> = { currentProject: "Old project text" }; // this device's own last-confirmed value
    const remote: Partial<UserProfile> = { currentProject: "New project text" }; // another device's newer edit, already on the account
    const { pushPayload } = planReconcile(local, remote, lastSynced);
    expect(pushPayload.currentProject).toBeUndefined(); // not dirty, correctly not pushed
    expect(pushPayload.feedIntent?.project).toMatchObject({ presence: "value", value: "New project text" });
  });
});

// PROFILE-SYNC-RETRY-TEST (ABC-JEV-INTEGRATION.md §1bk.9a) — the PROFILE-SYNC
// review (docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md, finding (a), MEDIUM)
// found that no test — shipped or its own 13-scenario probe — catches a
// failed push advancing `lastSynced`/`lastPushedRef`, because that guard lived
// only inside the `onSession`/debounced-push closures, which this repo's
// harness cannot mount (no @testing-library/react — see this file's header).
// `nextSyncBaselines` pulls the guard out into its own pure function so it is
// testable the same way `planReconcile`/`reconcilePushPayload` already are.
// "Both call shapes" below means: inputs shaped like `onSession`'s call
// (a freshly merged profile, no pre-existing lastPushed baseline) and inputs
// shaped like the debounced push's call (an ordinary profile edit, a
// lastPushed baseline already set by an earlier sync) — success and failure
// for each.
describe("nextSyncBaselines — the P3 retry guard as one pure function (§1bk.9a)", () => {
  it("(onSession shape) on success, both baselines advance to the profile's own pushed state", () => {
    const merged: UserProfile = { ...defaultProfile, displayName: "Alice Chen", paperCount: 5 };
    const previous: SyncBaselines = { lastSynced: null, lastPushed: null };
    const result = nextSyncBaselines(true, merged, previous);
    expect(result.lastSynced).toEqual(singleValueSnapshot(merged));
    expect(result.lastPushed).toEqual(remoteProfilePayload(merged));
    expect(result.lastSynced.displayName).toBe("Alice Chen");
    expect(result.lastPushed.paperCount).toBe(5);
  });

  it("(onSession shape) on failure, both baselines come back unchanged — the SAME object, not a copy", () => {
    const merged: UserProfile = { ...defaultProfile, displayName: "Alice Chen" };
    const previous: SyncBaselines = {
      lastSynced: { displayName: "Old value" },
      lastPushed: { displayName: "Old value" },
    };
    const result = nextSyncBaselines(false, merged, previous);
    expect(result).toBe(previous);
    expect(result.lastSynced).toBe(previous.lastSynced);
    expect(result.lastPushed).toBe(previous.lastPushed);
  });

  it("(debounced-push shape) on success, both baselines advance even when a lastPushed baseline already existed", () => {
    const profile: UserProfile = { ...defaultProfile, paperCount: 5 };
    const previous: SyncBaselines = {
      lastSynced: singleValueSnapshot(defaultProfile),
      lastPushed: remoteProfilePayload(defaultProfile),
    };
    const result = nextSyncBaselines(true, profile, previous);
    expect(result.lastSynced.paperCount).toBe(5);
    expect(result.lastPushed.paperCount).toBe(5);
  });

  it("(debounced-push shape) on failure, a fresh device's null baselines stay null — never invented from a partial attempt", () => {
    const profile: UserProfile = { ...defaultProfile, displayName: "Alice Chen" };
    const previous: SyncBaselines = { lastSynced: null, lastPushed: null };
    const result = nextSyncBaselines(false, profile, previous);
    expect(result.lastSynced).toBeNull();
    expect(result.lastPushed).toBeNull();
  });

  // The exact shape of PROFILE-SYNC-A's mutation 5 ("let a failed push
  // advance lastSynced anyway") — a device edits a field, the push for it
  // fails, and the OLD confirmed baseline must survive untouched so the new
  // edit stays dirty and is retried on the next attempt (§1aj P3).
  it("on failure, a profile that has since diverged from the last confirmed sync does not leak into the baselines (P3 — mutation guard)", () => {
    const previous: SyncBaselines = {
      lastSynced: { displayName: "Alice" },
      lastPushed: { displayName: "Alice" },
    };
    const editedButNotYetSynced: UserProfile = { ...defaultProfile, displayName: "Alice V2" };
    const result = nextSyncBaselines(false, editedButNotYetSynced, previous);
    expect(result.lastSynced).toEqual({ displayName: "Alice" });
    expect(result.lastPushed).toEqual({ displayName: "Alice" });
  });

  it("on success, lastPushed still excludes credentials — reuses remoteProfilePayload's redaction (§1aj)", () => {
    const profile: UserProfile = {
      ...defaultProfile,
      tavilyApiKey: "tvly-secret",
      feedAiApiKey: "sk-secret",
    };
    const result = nextSyncBaselines(true, profile, { lastSynced: null, lastPushed: null });
    expect(result.lastPushed).not.toHaveProperty("tavilyApiKey");
    expect(result.lastPushed).not.toHaveProperty("feedAiApiKey");
  });
});

// Source-text checks — this repo's own technique for effectful code it
// cannot mount (see store/profile.test.ts's `partialize` regex test and this
// file's own header note). Confirms BOTH push closures actually call
// `nextSyncBaselines` (rather than the pure-function tests above proving a
// property nothing in production uses), and that neither closure sets
// `lastSynced` any other way — i.e. `setLastSynced` is called exactly once
// in each, and that one call is fed by `nextSyncBaselines`'s own result.
describe("ProfileSync's closures actually use nextSyncBaselines (§1bk.9a) — source-text checks", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/profile-sync.tsx"),
    "utf8",
  );

  function closureBody(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    expect(start).toBeGreaterThan(-1); // marker itself must exist in the file
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("the sign-in reconcile (onSession) calls nextSyncBaselines, and its only setLastSynced call is fed by it", () => {
    const body = closureBody(
      "const onSession = async (userId: string | null) => {",
      "supabase.auth",
    );
    expect(body).toMatch(/nextSyncBaselines\(/);
    expect(body.match(/setLastSynced\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/setLastSynced\(\s*baselines\.lastSynced\s*\)/);
  });

  it("the steady-state debounced push calls nextSyncBaselines, and its only setLastSynced call is fed by it", () => {
    const body = closureBody(
      "debounceRef.current = setTimeout(async () => {",
      "}, DEBOUNCE_MS);",
    );
    expect(body).toMatch(/nextSyncBaselines\(/);
    expect(body.match(/setLastSynced\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/setLastSynced\(\s*baselines\.lastSynced\s*\)/);
  });
});
