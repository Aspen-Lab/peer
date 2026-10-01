import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { dirtySingleValueFields, singleValueSnapshot } from "@/lib/profile/merge";
import {
  ProfileSync,
  remoteProfilePayload,
  reconcilePushPayload,
  planReconcile,
  planReconcileForSignIn,
  isAccountSwitch,
  nextSyncBaselines,
  pullMergeAndPush,
  runSyncSerialized,
  hasSignOutCookie,
  deleteSignOutCookie,
  shouldClearOnConfirmedSignOut,
  processConfirmedSignOutCookie,
  SIGN_OUT_COOKIE_NAME,
  flushBeforeSignOut,
  type SyncBaselines,
  type PullBeforePushDeps,
  type SyncSerializationFlags,
  type FlushBeforeSignOutDeps,
  type ProcessConfirmedSignOutCookieDeps,
  useProfileSyncStatus,
  type AuthOutcome,
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

// ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt point 1; the guide's Q3 option
// (i) and Q5 owner-key tests 1-5) — when account A signs out on a shared
// browser and account B signs in, A's unsynced profile edits (and, even
// with nothing unsynced, A's already-synced preference ledger — §1bq.6(a),
// confirmed by docs/jev-abc/ACCOUNT-SWITCH-B-20260930T103019Z.md Q2 (b)-ii)
// must never reach B's account. `isAccountSwitch`/`planReconcileForSignIn`
// are pure, so the decision is proven headlessly, the same convention as
// `planReconcile` above — no DOM, no real store.
describe("isAccountSwitch (§1bt point 1)", () => {
  it("no owner yet (a fresh device) is never a switch", () => {
    expect(isAccountSwitch(null, "user-b")).toBe(false);
  });
  it("the same owner signing back in is never a switch", () => {
    expect(isAccountSwitch("user-a", "user-a")).toBe(false);
  });
  it("a different, real owner IS a switch", () => {
    expect(isAccountSwitch("user-a", "user-b")).toBe(true);
  });
});

describe("planReconcileForSignIn — the owner-key gate composed into the sign-in reconcile (§1bt point 1)", () => {
  it("1. same-account re-entry unaffected: A's own unsynced edit still reaches A's own account (re-run of Q2 scenario (c))", () => {
    const local: UserProfile = { ...defaultProfile, currentProject: "construction-a-UNSYNCED-project-text" };
    const remote: Partial<UserProfile> = { displayName: "construction-a-real-name" };
    const { patch, pushPayload } = planReconcileForSignIn("user-a", "user-a", local, remote, null);
    // Dirty (differs from the bootstrap baseline) → local wins outright, so
    // `patch` has no opinion on it (nothing to overwrite locally) and
    // `pushPayload` carries it up to A's own account instead — same
    // "patch adopts the account's value; pushPayload carries the device's
    // own dirty edit" shape `planReconcile`'s own tests above pin.
    expect(patch.currentProject).toBeUndefined();
    expect(pushPayload.currentProject).toBe("construction-a-UNSYNCED-project-text");
    // MUTATION GUARD: removing the "same account / no owner yet → normal
    // merge" branch (always treating sign-in as a switch) would wrongly
    // discard this via an unwanted logOut() — this assertion would fail
    // (patch/pushPayload would be empty of it).
  });

  it("2. a different-account switch closes the leak: NONE of A's unsynced topic, project text, or ledger entry reach B's push payload (re-run of Q2 scenario (a), the task's explicit regression case)", () => {
    const local: UserProfile = {
      ...defaultProfile,
      researchTopics: ["construction-b-real-topic", "construction-a-UNSYNCED-topic"],
      currentProject: "construction-a-UNSYNCED-project-text",
      preferenceLedger: {
        "construction-a-UNSYNCED-concept": {
          key: "construction-a-UNSYNCED-concept",
          label: "construction-a-UNSYNCED-concept",
          source: "openalex_topic",
          positive: 0,
          negative: 1,
          lastSeenAt: "2026-09-30T00:00:00.000Z",
        },
      },
    };
    const bRemote: Partial<UserProfile> = {
      researchTopics: ["construction-b-real-topic"],
      preferenceLedger: {},
    };
    const { patch, pushPayload } = planReconcileForSignIn("user-a", "user-b", local, bRemote, null);
    expect(patch.researchTopics).toEqual(["construction-b-real-topic"]);
    expect(patch.currentProject).toBeUndefined();
    expect(patch.preferenceLedger).toEqual({});
    expect(pushPayload.researchTopics).toBeUndefined();
    expect(pushPayload.currentProject).toBeUndefined();
    expect(pushPayload.preferenceLedger).toBeUndefined();
    // MUTATION GUARD: removing the owner-key comparison entirely (revert to
    // today's code, i.e. always take the `local`/`lastSynced` branch) is
    // exactly Q2's own (a) leak — this test goes red.
  });

  it("3. ledger isolation specifically: a different account signing in after A's ledger-only, FULLY SYNCED state leaves B's ledger exactly B's own (re-run of Q2 scenario (b)-ii)", () => {
    const local: UserProfile = {
      ...defaultProfile,
      preferenceLedger: {
        "construction-a3-synced-concept": {
          key: "construction-a3-synced-concept",
          label: "construction-a3-synced-concept",
          source: "openalex_topic",
          positive: 1,
          negative: 0,
          lastSeenAt: "2026-09-30T00:00:00.000Z",
        },
      },
    };
    // Fully synced: lastSynced matches local exactly for every scalar, so
    // nothing is "dirty" — the ledger leak Q2 (b)-ii found reaches B even
    // with zero unsynced edits anywhere else.
    const aLastSynced: Partial<UserProfile> = { ...local };
    const bRemote: Partial<UserProfile> = { preferenceLedger: {} };
    const { pushPayload } = planReconcileForSignIn("user-a", "user-b", local, bRemote, aLastSynced);
    expect(pushPayload.preferenceLedger).toBeUndefined();
    expect(pushPayload).not.toHaveProperty("researchTopics");
    expect(pushPayload).not.toHaveProperty("currentProject");
    // MUTATION GUARD: a partial fix that gates SINGLE_VALUE_FIELDS/
    // LIST_FIELDS on the owner key but leaves `local`'s own preferenceLedger
    // flowing through unchanged (i.e. only defaultProfile's scalars/lists
    // are substituted, not its ledger) would still leak A's synced concept
    // into B — this test goes red.
  });

  it("4. bootstrap/first-sign-in unaffected, both remote shapes (re-run of Q2 scenario (d))", () => {
    const local: UserProfile = { ...defaultProfile, currentProject: "construction-first-signin-project" };
    // (d)-1: remote === null (brand-new auth user, no profile row at all).
    const fresh1 = planReconcileForSignIn(null, "user-new", local, null, null);
    expect(fresh1.pushPayload.currentProject).toBe("construction-first-signin-project");
    // (d)-2: remote = a genuinely empty existing row.
    const fresh2 = planReconcileForSignIn(null, "user-new", local, {}, null);
    expect(fresh2.pushPayload.currentProject).toBe("construction-first-signin-project");
    // MUTATION GUARD: treating `syncedAccountId === null` as "a different
    // account" (refusing to merge, e.g. substituting defaultProfile here
    // too) would discard the reader's own signed-out edit on their very
    // first sign-in — this test goes red.
  });
});

// Source-text check — this file's own established technique for effectful
// code the harness cannot mount (see the header note, and the
// nextSyncBaselines source-text checks near the end of this file). Confirms
// the REAL onSession closure actually performs the owner-key gate's two
// required side effects (logOut() before setSyncedAccountId, both before
// the existing didInitialPullRef early-return) rather than only the pure
// functions above proving a property nothing in production wires up.
describe("ProfileSync's onSession performs the owner-key gate (§1bt point 1) — source-text check", () => {
  const source = readFileSync(join(process.cwd(), "src/components/profile-sync.tsx"), "utf8");
  const start = source.indexOf('useSyncGate.setState({ authUserId: userId, authOutcome: "signed-in" });');
  const end = source.indexOf("if (didInitialPullRef.current || pullInFlightRef.current) return;");

  it("markers exist and are in the right order", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = source.slice(start, end);

  it("checks isAccountSwitch against the CURRENT store's syncedAccountId before falling through", () => {
    expect(body).toMatch(/isAccountSwitch\(\s*useProfileStore\.getState\(\)\.syncedAccountId,\s*userId\s*\)/);
  });

  it("calls the real logOut() inside that branch, before setSyncedAccountId", () => {
    const switchBranch = body.slice(body.indexOf("isAccountSwitch("));
    const logOutIdx = switchBranch.indexOf("useProfileStore.getState().logOut()");
    const setOwnerIdx = switchBranch.indexOf("useProfileStore.getState().setSyncedAccountId(userId)");
    expect(logOutIdx).toBeGreaterThan(-1);
    expect(setOwnerIdx).toBeGreaterThan(logOutIdx);
  });

  it("setSyncedAccountId runs unconditionally before the didInitialPullRef early-return, not only inside the switch branch", () => {
    expect(body.indexOf("useProfileStore.getState().setSyncedAccountId(userId)")).toBeGreaterThan(-1);
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

// LIST-REMOVAL-SYNC (§1bq.3) — `pullMergeAndPush` is the lost-update
// mitigation for the steady-state debounced push. Tested with fakes,
// headlessly, same convention as `planReconcile`/`nextSyncBaselines` above.
describe("pullMergeAndPush — the lost-update mitigation (§1bq.3)", () => {
  interface FakeResult {
    deps: PullBeforePushDeps;
    pushedPayloads: Partial<UserProfile>[];
    appliedPatches: Partial<UserProfile>[];
    baselineCalls: SyncBaselines[];
    failedCount: () => number;
    clearedCount: () => number;
  }

  function fakeDeps(opts: {
    remote: { ok: true; profile: Partial<UserProfile> | null } | { ok: false };
    local: UserProfile;
    lastSynced: Partial<UserProfile> | null;
    lastPushed?: Partial<UserProfile> | null;
    pushResult?: boolean;
  }): FakeResult {
    const pushedPayloads: Partial<UserProfile>[] = [];
    const appliedPatches: Partial<UserProfile>[] = [];
    const baselineCalls: SyncBaselines[] = [];
    let failed = 0;
    let cleared = 0;
    let lastPushed = opts.lastPushed ?? null;
    const deps: PullBeforePushDeps = {
      getRemote: async () => opts.remote,
      readLocal: () => ({ profile: opts.local, lastSynced: opts.lastSynced }),
      applyPatch: (patch) => {
        appliedPatches.push(patch);
      },
      push: async (payload) => {
        pushedPayloads.push(payload);
        return opts.pushResult ?? true;
      },
      setBaselines: (baselines) => {
        baselineCalls.push(baselines);
        lastPushed = baselines.lastPushed;
      },
      markPushFailed: () => {
        failed += 1;
      },
      clearPushFailed: () => {
        cleared += 1;
      },
      getLastPushed: () => lastPushed,
    };
    return {
      deps,
      pushedPayloads,
      appliedPatches,
      baselineCalls,
      failedCount: () => failed,
      clearedCount: () => cleared,
    };
  }

  // docs/jev-abc/LIST-REMOVAL-SYNC-B-20260930T082019Z.md Q3's exact race:
  // device 1 already added "device1-addition" and pushed successfully (the
  // account AND device 1's own base both hold it). Device 2 never reloaded,
  // so it does not know about it; it independently removed a different,
  // pre-existing item ("device2-removed") and its own debounced push now
  // fires. WITHOUT the mitigation (a bare push of device 2's stale list),
  // the addition is silently lost. WITH it, both survive correctly.
  it("WITH the mitigation: keeps another device's concurrent addition AND still drops this device's own genuine removal — never a bare list key", async () => {
    const { deps, pushedPayloads, baselineCalls } = fakeDeps({
      remote: { ok: true, profile: { researchTopics: ["kept-a", "kept-b", "device1-addition"] } },
      local: { ...defaultProfile, researchTopics: ["kept-a"] }, // device 2 deliberately removed "kept-b"
      lastSynced: { researchTopics: ["kept-a", "kept-b"] }, // device 2's own base — predates device 1's addition
    });

    const outcome = await pullMergeAndPush(deps);

    expect(outcome).toEqual({ status: "pulled-and-pushed" });
    expect(pushedPayloads).toHaveLength(1);
    // Device 1's concurrent addition survives...
    expect(pushedPayloads[0].researchTopics).toEqual(["kept-a", "device1-addition"]);
    // ...and device 2's own genuine removal of "kept-b" still sticks.
    expect(pushedPayloads[0].researchTopics).not.toContain("kept-b");
    // Never a bare list key: feedIntent is recomputed fresh from the SAME
    // merged list (researchTopics is an INTENT_LIST_FIELDS member), proving
    // the push went through remoteProfilePayload/reconcilePushPayload, not
    // a hand-rolled `{ researchTopics: [...] }` patch.
    expect(pushedPayloads[0].feedIntent?.requiredConcepts).toEqual(["kept-a", "device1-addition"]);
    expect(baselineCalls).toHaveLength(1);
    expect(baselineCalls[0].lastSynced?.researchTopics).toEqual(["kept-a", "device1-addition"]);
  });

  it("a failed pull never pushes blind: marks push-failed and pushes nothing, so the next change retries", async () => {
    const { deps, pushedPayloads, failedCount } = fakeDeps({
      remote: { ok: false },
      local: { ...defaultProfile, researchTopics: ["kept-a"] },
      lastSynced: { researchTopics: ["kept-a", "kept-b"] },
    });

    const outcome = await pullMergeAndPush(deps);

    expect(outcome).toEqual({ status: "pull-failed" });
    expect(pushedPayloads).toHaveLength(0);
    expect(failedCount()).toBe(1);
  });

  // `authorisedCountries` (not an INTENT_LIST_FIELDS member, unlike
  // researchTopics/softTopics) isolates "nothing NEW for this list" from
  // feedIntent's own unconditional-resend policy (reconcilePushPayload's
  // own doc comment: feedIntent "inherits safety... left unconditional" —
  // proven separately by the mitigation test above). A REAL, empty
  // `reconcilePushPayload` output is not reachable with a real
  // `defaultProfile`-shaped profile (PROFILE-SYNC-A's own Check 3 finding:
  // several no-server-column fields, e.g. eventRequiredTopics/
  // deepReportEnabled/onboardedAt, are always present, harmlessly, in every
  // payload) — so this proves the REACHABLE half of "nothing to push" (the
  // list itself is excluded) rather than a literal `{}`, and the baselines
  // still advance exactly like a real push's success (§1bk ruling 3, same
  // as onSession).
  it("when the merge finds nothing new for a list, that list is not resent — though the call still completes (the always-present no-column fields go out harmlessly) and baselines advance", async () => {
    const { deps, pushedPayloads, baselineCalls, clearedCount } = fakeDeps({
      remote: { ok: true, profile: { authorisedCountries: ["Canada"] } },
      local: { ...defaultProfile, authorisedCountries: ["Canada"] },
      lastSynced: { authorisedCountries: ["Canada"] },
    });

    const outcome = await pullMergeAndPush(deps);

    expect(outcome.status).toBe("pulled-and-pushed");
    expect(pushedPayloads).toHaveLength(1);
    expect(pushedPayloads[0]).not.toHaveProperty("authorisedCountries");
    expect(pushedPayloads[0]).not.toHaveProperty("feedIntent"); // nothing intent-related touched either
    expect(baselineCalls).toHaveLength(1);
    expect(clearedCount()).toBe(1);
  });

  it("the account genuinely has no row yet (first-ever sync): still merges and pushes local's own list, nothing to merge against", async () => {
    const { deps, pushedPayloads } = fakeDeps({
      remote: { ok: true, profile: null },
      local: { ...defaultProfile, researchTopics: ["brand-new"] },
      lastSynced: null,
    });

    const outcome = await pullMergeAndPush(deps);

    expect(outcome).toEqual({ status: "pulled-and-pushed" });
    expect(pushedPayloads[0].researchTopics).toEqual(["brand-new"]);
  });

  it("a push failure after a successful pull marks push-failed and never advances the baselines", async () => {
    const { deps, baselineCalls, failedCount } = fakeDeps({
      remote: { ok: true, profile: { researchTopics: ["kept-a", "device1-addition"] } },
      local: { ...defaultProfile, researchTopics: ["kept-a"] },
      lastSynced: { researchTopics: ["kept-a", "kept-b"] },
      pushResult: false,
    });

    const outcome = await pullMergeAndPush(deps);

    expect(outcome).toEqual({ status: "push-failed" });
    expect(baselineCalls).toHaveLength(0);
    expect(failedCount()).toBe(1);
  });

  // The guide's own long-open-tab scenario (§1bq.4 test 7 / the manager's
  // Q4 addition): computer 2 loaded BEFORE computer 1's addition (so its own
  // base predates it), then edits the same list — the addition must survive
  // on the account AND on computer 1's next load. Chains the real
  // `planReconcile` (computer 1's push) with `pullMergeAndPush` (computer
  // 2's mitigated push) against one shared in-memory "account".
  it("long-open-tab: computer 2 (loaded before computer 1's addition) edits the same list — the addition survives on the account and on computer 1's next load", async () => {
    let account: Partial<UserProfile> = { researchTopics: ["shared-a", "shared-b"] };

    // Computer 1: fresh sync, adds "computer1-topic", pushes for real
    // (mirrors onSession's own sequence with the real planReconcile).
    const computer1Local: UserProfile = {
      ...defaultProfile,
      researchTopics: ["shared-a", "shared-b", "computer1-topic"],
    };
    const computer1LastSynced: Partial<UserProfile> = { researchTopics: ["shared-a", "shared-b"] };
    const plan1 = planReconcile(computer1Local, account, computer1LastSynced);
    account = { ...account, researchTopics: plan1.pushPayload.researchTopics };
    expect(account.researchTopics).toEqual(["shared-a", "shared-b", "computer1-topic"]);

    // Computer 2: its OWN base predates computer 1's addition (it loaded
    // earlier and has not reloaded since) — then it removes "shared-b".
    const computer2 = fakeDeps({
      remote: { ok: true, profile: account },
      local: { ...defaultProfile, researchTopics: ["shared-a"] }, // "shared-b" deliberately removed
      lastSynced: { researchTopics: ["shared-a", "shared-b"] }, // predates computer 1's addition
    });
    const outcome2 = await pullMergeAndPush(computer2.deps);
    expect(outcome2).toEqual({ status: "pulled-and-pushed" });
    account = { ...account, researchTopics: computer2.pushedPayloads[0].researchTopics };
    // Computer 1's addition survives on the account, AND computer 2's own
    // removal of "shared-b" sticks.
    expect(account.researchTopics).toEqual(["shared-a", "computer1-topic"]);

    // Computer 1's NEXT load: sees "shared-b" gone (computer 2's removal)
    // and its own addition still present.
    const plan1Next = planReconcile(
      { ...defaultProfile, researchTopics: ["shared-a", "shared-b", "computer1-topic"] },
      account,
      { researchTopics: ["shared-a", "shared-b", "computer1-topic"] }, // computer 1's own base, from its earlier push
    );
    expect(plan1Next.patch.researchTopics).toEqual(["shared-a", "computer1-topic"]);
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

  // LIST-REMOVAL-SYNC (§1bq.3) — the debounced-push closure must route a
  // list-carrying patch through `pullMergeAndPush` BEFORE it would ever
  // reach the ordinary bare `pushRemote(patch)` call a few lines below (the
  // one the test above pins). `listPullDeps` is deliberately a NAMED
  // top-level function (see its own header note) precisely so this
  // wiring adds no second `setLastSynced(` text inside the closure region —
  // confirmed by the test above still passing unmodified.
  //
  // ACCOUNT-SWITCH (§1bt point 4) — CHANGED ASSERTION: the list-carrying
  // branch now calls `runSyncSerialized(listPullDeps(lastPushedRef), ...)`
  // instead of calling `pullMergeAndPush` directly, so the literal call
  // text this test matches on moved one level out. The property under test
  // is unchanged and, if anything, strengthened: a list-carrying patch
  // still reaches `pullMergeAndPush` before the ordinary push path — now
  // additionally serialized against a concurrent sync (§1bq.6(b)) — proven
  // by `runSyncSerialized`'s own tests below, not re-proven here.
  it("the steady-state debounced push routes a list-carrying patch through the serialized pull-before-push path, before the ordinary push path", () => {
    const body = closureBody(
      "debounceRef.current = setTimeout(async () => {",
      "}, DEBOUNCE_MS);",
    );
    expect(body).toMatch(/carriesListChange/);
    expect(body).toMatch(/runSyncSerialized\(\s*listPullDeps\(lastPushedRef\)/);
    // The list-carrying branch returns before the ordinary push path, so
    // runSyncSerialized's call site textually precedes the bare pushRemote
    // call this describe block's other test pins.
    expect(body.indexOf("runSyncSerialized(")).toBeLessThan(body.indexOf("if (await pushRemote(patch))"));
  });
});

// ACCOUNT-SWITCH (§1bt point 4; the guide's Q4) — runSyncSerialized proven
// headlessly with fakes, same convention as pullMergeAndPush above.
//
// `waitForNextGetRemote` below POLLS the microtask queue (rather than
// assuming a fixed number of `await Promise.resolve()` hops) for the next
// `getRemote()` call to actually register, then resolves that ONE call
// FIFO. The real `pullMergeAndPush` crosses several internal `await`
// boundaries (the pull itself, the fake `push`, its own return) between
// "the previous getRemote() resolved" and "the next getRemote() is
// called" — hard-coding a tick count made this suite flaky/hanging in an
// earlier draft; polling for the actual call removes that assumption
// entirely and still resolves near-instantly (no real delay is ever
// awaited, only empty microtask turns).
describe("runSyncSerialized — an in-flight guard plus one coalesced follow-up (§1bt point 4)", () => {
  function freshFlags(): SyncSerializationFlags {
    return {
      inFlight: { current: false },
      queued: { current: false },
      current: { current: null },
    };
  }

  function controllableDeps(local: () => UserProfile = () => ({
    ...defaultProfile,
    researchTopics: ["first-edit"],
  })): {
    deps: PullBeforePushDeps;
    /** Waits until the next getRemote() call is actually pending, then
     *  resolves that one call (FIFO order). */
    waitForNextGetRemote: () => Promise<void>;
    pushedPayloads: Partial<UserProfile>[];
    activeCount: () => number;
    maxActive: () => number;
    callCount: () => number;
  } {
    let active = 0;
    let max = 0;
    let calls = 0;
    const pending: Array<() => void> = [];
    const pushedPayloads: Partial<UserProfile>[] = [];
    const deps: PullBeforePushDeps = {
      getRemote: () =>
        new Promise((resolve) => {
          calls += 1;
          active += 1;
          max = Math.max(max, active);
          pending.push(() => {
            active -= 1;
            resolve({ ok: true, profile: {} });
          });
        }),
      readLocal: () => ({ profile: local(), lastSynced: null }),
      applyPatch: () => {},
      push: async (payload) => {
        pushedPayloads.push(payload);
        return true;
      },
      setBaselines: () => {},
      markPushFailed: () => {},
      clearPushFailed: () => {},
      getLastPushed: () => null,
    };
    return {
      deps,
      waitForNextGetRemote: async () => {
        for (let i = 0; i < 1000 && pending.length === 0; i++) {
          await Promise.resolve();
        }
        if (pending.length === 0) {
          throw new Error("waitForNextGetRemote: no call arrived — the guard likely never re-ran");
        }
        pending.shift()!();
      },
      pushedPayloads,
      activeCount: () => active,
      maxActive: () => max,
      callCount: () => calls,
    };
  }

  it("the invariant itself: two overlapping triggers never run pullMergeAndPush concurrently — mutation: call pullMergeAndPush directly (no guard) → activeCount would reach 2", async () => {
    const ctrl = controllableDeps();
    const flags = freshFlags();
    const first = runSyncSerialized(ctrl.deps, flags);
    // A second trigger arrives while the first is still mid-pull.
    const second = runSyncSerialized(ctrl.deps, flags);
    expect(ctrl.activeCount()).toBe(1); // never 2 — the guard coalesced the second call
    await ctrl.waitForNextGetRemote(); // let the first pull settle
    await ctrl.waitForNextGetRemote(); // the coalesced follow-up's own pull, then settle it
    await Promise.all([first, second]);
    expect(ctrl.maxActive()).toBe(1); // at no point were two attempts active together
    expect(ctrl.callCount()).toBe(2); // the real attempt, plus exactly one coalesced follow-up
  });

  it("coalescing finds nothing new to push in the common case: two triggers while busy still push at most once more", async () => {
    // A fixed local value (never edited mid-flight) — the coalesced
    // follow-up's own diff has nothing new, matching "usually finds
    // nothing to push" (it still runs — see the invariant test above for
    // the call count — it just has nothing new to send).
    const ctrl = controllableDeps();
    const flags = freshFlags();
    const first = runSyncSerialized(ctrl.deps, flags);
    const second = runSyncSerialized(ctrl.deps, flags);
    await ctrl.waitForNextGetRemote();
    await ctrl.waitForNextGetRemote();
    await Promise.all([first, second]);
    expect(ctrl.callCount()).toBe(2); // one real attempt + one coalesced follow-up, never more
  });

  it("a genuine edit arriving mid-flight is not dropped: the coalesced run re-reads live state and its own push reflects it — mutation: drop the coalesced re-run (if (inFlight) return with no queueing) → the edit is silently lost", async () => {
    let local: UserProfile = { ...defaultProfile, researchTopics: ["before-edit"] };
    const ctrl = controllableDeps(() => local);
    const flags = freshFlags();
    const first = runSyncSerialized(ctrl.deps, flags);
    const second = runSyncSerialized(ctrl.deps, flags); // coalesces — queued.current = true
    // A genuine local edit lands while the first pull is still in flight.
    local = { ...defaultProfile, researchTopics: ["before-edit", "mid-flight-edit"] };
    await ctrl.waitForNextGetRemote(); // settle the first attempt (still the OLD edit)
    await ctrl.waitForNextGetRemote(); // settle the coalesced follow-up (re-reads readLocal() live)
    await Promise.all([first, second]);
    expect(
      ctrl.pushedPayloads.some((p) => p.researchTopics?.includes("mid-flight-edit")),
    ).toBe(true);
  });

  it("bounded, not unbounded: three triggers arriving while one run is in flight still produce at most ONE extra run — mutation: queue a counter instead of a boolean → an extra, unnecessary third run occurs", async () => {
    const ctrl = controllableDeps();
    const flags = freshFlags();
    const first = runSyncSerialized(ctrl.deps, flags);
    const second = runSyncSerialized(ctrl.deps, flags);
    const third = runSyncSerialized(ctrl.deps, flags);
    const fourth = runSyncSerialized(ctrl.deps, flags);
    expect(ctrl.activeCount()).toBe(1); // only the first ever actually started a pull
    await ctrl.waitForNextGetRemote(); // settle the first real attempt
    await ctrl.waitForNextGetRemote(); // settle the ONE coalesced follow-up
    await Promise.all([first, second, third, fourth]);
    expect(ctrl.callCount()).toBe(2); // never a third or fourth run
    expect(ctrl.maxActive()).toBe(1); // never more than one attempt in flight at a time
  });
});

// ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — REPLACES the §1bt.7 AMENDMENT's
// URL-parameter marker (`hasSignedOutMarker`/`urlWithoutSignedOutMarker`/
// `shouldClearOnThisLoad`, and the mount effect that wired them, all
// removed from profile-sync.tsx — not merely bypassed) with a short-lived,
// first-party COOKIE bound to a CONFIRMED signed-out auth outcome. Every
// test below is a rewritten form of this describe block's §1bt.7-era
// predecessor: same scenarios, same product invariants (a guest keeps
// their settings; an involuntary loss keeps local data; a deliberate
// sign-out clears exactly once; a different account after a loss starts
// clean), proven against the NEW mechanism, because the fresh review
// (docs/jev-abc/ACCOUNT-SWITCH-A-20260930T123154Z.md, CHECK 4) proved the
// URL marker alone could be forged, shared, or bookmarked to trigger the
// same clear a real sign-out does — closed here structurally: the new
// decision function does not even take a URL/search string as an input.
describe("hasSignOutCookie / deleteSignOutCookie / shouldClearOnConfirmedSignOut (§1bt.8 AMENDMENT (b))", () => {
  it("hasSignOutCookie: true only for an exact 'peer_signed_out=1' among document.cookie's semicolon-separated pairs", () => {
    expect(hasSignOutCookie(`${SIGN_OUT_COOKIE_NAME}=1`)).toBe(true);
    expect(hasSignOutCookie(`other=x; ${SIGN_OUT_COOKIE_NAME}=1; another=y`)).toBe(true);
    expect(hasSignOutCookie("")).toBe(false);
    expect(hasSignOutCookie("other=x")).toBe(false);
    expect(hasSignOutCookie(`${SIGN_OUT_COOKIE_NAME}=0`)).toBe(false);
    // A similarly-prefixed but different cookie name must not be misread.
    expect(hasSignOutCookie(`${SIGN_OUT_COOKIE_NAME}_decoy=1`)).toBe(false);
  });

  it("deleteSignOutCookie: sets document.cookie with Max-Age=0 and the matching Path, so the browser actually removes it (not merely an unrelated expired cookie)", () => {
    let assigned = "";
    const fakeDocument = {
      get cookie() {
        return assigned;
      },
      set cookie(value: string) {
        assigned = value;
      },
    };
    vi.stubGlobal("document", fakeDocument);
    try {
      deleteSignOutCookie();
      expect(assigned).toContain(`${SIGN_OUT_COOKIE_NAME}=`);
      expect(assigned).toContain("Max-Age=0");
      expect(assigned).toContain("Path=/");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shouldClearOnConfirmedSignOut: ALL THREE must hold — cookie present, authOutcome CONFIRMED 'signed-out', and an owner recorded", () => {
    expect(shouldClearOnConfirmedSignOut(true, "signed-out", "user-a")).toBe(true);
    // No cookie → false regardless of anything else (closes the forged-link
    // vector — see the dedicated scenario test below).
    expect(shouldClearOnConfirmedSignOut(false, "signed-out", "user-a")).toBe(false);
    // A guest with no recorded owner → nothing to clear.
    expect(shouldClearOnConfirmedSignOut(true, "signed-out", null)).toBe(false);
  });

  // MUTATION GUARD (drop the "session confirmed gone" condition): a
  // signed-in reader (authOutcome !== "signed-out") must never clear, even
  // with the cookie present and an owner recorded — this is the exact
  // shape §1bt.8's own required test names ("a signed-in reader with the
  // cookie present → no clear"). Also covers "an unresolved auth check
  // with the cookie → no clear" (authOutcome "unknown" — a check still in
  // flight, or REJECTED, per the file's own P4-S5b-FIX3 convention right
  // above onSession in the real code) and the "unconfigured" outcome.
  it("never clears for any non-confirmed authOutcome, even with the cookie present and an owner recorded", () => {
    const nonConfirmed: AuthOutcome[] = ["signed-in", "unknown", "unconfigured"];
    for (const outcome of nonConfirmed) {
      expect(shouldClearOnConfirmedSignOut(true, outcome, "user-a")).toBe(false);
    }
  });
});

describe("processConfirmedSignOutCookie — decide, clear if warranted, then always consume the cookie (§1bt.8 AMENDMENT (b))", () => {
  function fakeDeps(overrides: Partial<ProcessConfirmedSignOutCookieDeps> = {}) {
    let logOutCalls = 0;
    let deleteCalls = 0;
    const deps: ProcessConfirmedSignOutCookieDeps = {
      cookiePresent: true,
      authOutcome: "signed-out",
      syncedAccountId: "user-a",
      logOut: () => {
        logOutCalls += 1;
      },
      deleteCookie: () => {
        deleteCalls += 1;
      },
      ...overrides,
    };
    return { deps, logOutCalls: () => logOutCalls, deleteCalls: () => deleteCalls };
  }

  it("a signed-out load with the cookie and an owner → clears AND consumes the cookie", () => {
    const { deps, logOutCalls, deleteCalls } = fakeDeps();
    processConfirmedSignOutCookie(deps);
    expect(logOutCalls()).toBe(1);
    expect(deleteCalls()).toBe(1);
  });

  it("a signed-out load with the cookie but no owner (a guest) → no clear, but the cookie is STILL consumed", () => {
    const { deps, logOutCalls, deleteCalls } = fakeDeps({ syncedAccountId: null });
    processConfirmedSignOutCookie(deps);
    expect(logOutCalls()).toBe(0);
    expect(deleteCalls()).toBe(1);
  });

  it("no cookie at all → nothing happens, not even a delete call (nothing was ever read)", () => {
    const { deps, logOutCalls, deleteCalls } = fakeDeps({ cookiePresent: false });
    processConfirmedSignOutCookie(deps);
    expect(logOutCalls()).toBe(0);
    expect(deleteCalls()).toBe(0);
  });

  it("an unresolved auth check (authOutcome 'unknown') with the cookie present → no clear (the cookie is still consumed, since it WAS present)", () => {
    const { deps, logOutCalls, deleteCalls } = fakeDeps({ authOutcome: "unknown" });
    processConfirmedSignOutCookie(deps);
    expect(logOutCalls()).toBe(0);
    expect(deleteCalls()).toBe(1);
  });
});

// §1bt.7's four required scenarios, re-proven against the cookie mechanism
// (never deleted — see this block's own header note above), plus the new
// forged-link scenario that motivated the whole AMENDMENT.
describe("§1bt.8 scenarios (re-run of §1bt.7's four, plus the forged-link case CHECK 4 found)", () => {
  it("a guest's settings survive repeated signed-out loads (no cookie, ever — a guest never POSTs to /auth/signout)", () => {
    for (let i = 0; i < 5; i++) {
      expect(shouldClearOnConfirmedSignOut(false, "signed-out", null)).toBe(false);
    }
  });

  it("an involuntary session loss (no cookie — nobody navigated through the sign-out route) keeps local data — a later same-account sign-in still merges it", () => {
    // The loss itself: no cookie, so nothing clears, regardless of owner.
    expect(shouldClearOnConfirmedSignOut(false, "signed-out", "user-a")).toBe(false);
    // The later same-account sign-in: isAccountSwitch("user-a","user-a") is
    // false (Part A), so the owner-key gate also leaves local data alone —
    // re-run of owner-key test 1's exact shape.
    const local: UserProfile = { ...defaultProfile, currentProject: "construction-involuntary-loss-edit" };
    const { pushPayload } = planReconcileForSignIn("user-a", "user-a", local, {}, null);
    expect(pushPayload.currentProject).toBe("construction-involuntary-loss-edit");
  });

  // THE key new scenario (§1bt.8 AMENDMENT (b), CHECK 4's own finding,
  // inverted into a regression test): a forged, shared, or bookmarked link
  // carrying the OLD "?signed-out=1" text has NO cookie behind it (only a
  // real POST to /auth/signout can create one) — so even a signed-in
  // reader with a genuine unsynced edit is completely unaffected. Proven
  // structurally, not just by return value: shouldClearOnConfirmedSignOut
  // does not accept a URL/search string parameter at all — there is
  // nothing for a link to influence.
  it("a forged/shared/bookmarked link (URL text alone, no real cookie) does nothing at all", () => {
    expect(shouldClearOnConfirmedSignOut(false, "signed-out", "user-a")).toBe(false);
    const { deps, logOutCalls } = (() => {
      let logOutCalls = 0;
      const deps: ProcessConfirmedSignOutCookieDeps = {
        cookiePresent: false, // the link carries text, but no real Set-Cookie ever happened
        authOutcome: "signed-out",
        syncedAccountId: "user-a",
        logOut: () => {
          logOutCalls += 1;
        },
        deleteCookie: () => {},
      };
      return { deps, logOutCalls: () => logOutCalls };
    })();
    processConfirmedSignOutCookie(deps);
    expect(logOutCalls()).toBe(0);
  });

  it("the cookie is consumed exactly once per confirmed sign-out — a later, unrelated page load this session sees no cookie left over", () => {
    const deleteCalls: number[] = [];
    const deps: ProcessConfirmedSignOutCookieDeps = {
      cookiePresent: true,
      authOutcome: "signed-out",
      syncedAccountId: "user-a",
      logOut: () => {},
      deleteCookie: () => deleteCalls.push(1),
    };
    processConfirmedSignOutCookie(deps);
    expect(deleteCalls).toHaveLength(1);
  });

  it("a different account after an involuntary loss starts clean (the owner key, not the cookie, is what catches this)", () => {
    // The loss leaves syncedAccountId at the OLD owner (never cleared, no
    // cookie involved) — a different account signing in afterward is
    // exactly Part A's switch case, re-run here under the involuntary-loss
    // framing: A's unsynced edit must not reach B.
    const aLocal: UserProfile = { ...defaultProfile, currentProject: "construction-a-leftover-after-loss" };
    const { pushPayload } = planReconcileForSignIn("user-a", "user-b", aLocal, {}, null);
    expect(pushPayload.currentProject).toBeUndefined();
  });

  // The guide's own test 9, re-verified end-to-end against the COMBINED
  // design (owner key + cookie clear + flush together, not any one
  // mechanism alone) — the exact sequence a real "Sign out anyway" click
  // now produces: a successful Part D flush reaches A's OWN account BEFORE
  // the cookie-driven clear wipes local state, so A signing back in loses
  // nothing, even though this device's local copy really was wiped in
  // between. Mutation: skip the flush step, clear immediately on every
  // sign-out → this test goes red, because A's edit would never have
  // reached the account before local state was wiped.
  it("combined-design scenario: a successful flush + the cookie-driven clear + A signing back in loses nothing", () => {
    const aAccountAfterFlush: Partial<UserProfile> = {
      currentProject: "construction-flushed-before-clear",
    };
    const localAfterClear = defaultProfile;
    const syncedAccountIdAfterClear = null;
    const { patch } = planReconcileForSignIn(
      syncedAccountIdAfterClear,
      "user-a",
      localAfterClear,
      aAccountAfterFlush,
      null,
    );
    expect(patch.currentProject).toBe("construction-flushed-before-clear");
  });
});

// Source-text check — the real onSession wiring cannot run in this repo's
// harness (no DOM). Confirms the cookie is read and processed at exactly
// the CONFIRMED "signed-out" point (never earlier, never via the URL), and
// that the old marker-driven mount effect no longer exists at all.
describe("ProfileSync's onSession wires the cookie-driven clear at the confirmed signed-out point (§1bt.8 AMENDMENT (b)) — source-text check", () => {
  const source = readFileSync(join(process.cwd(), "src/components/profile-sync.tsx"), "utf8");
  const start = source.indexOf('useSyncGate.setState({ authUserId: null, authOutcome: "signed-out" });');
  const end = source.indexOf("markSyncSettled();", start);

  it("markers exist and are in the right order", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = source.slice(start, end);

  // MUTATION GUARD (read the URL parameter again): the cookie check must
  // come from document.cookie via hasSignOutCookie, never from
  // window.location/search — a URL cannot forge document.cookie, but it
  // COULD forge whatever a naive re-read of window.location would see.
  it("reads document.cookie via hasSignOutCookie — never window.location/search — for cookiePresent", () => {
    expect(body).toMatch(/cookiePresent:\s*hasSignOutCookie\(document\.cookie\)/);
    expect(body).not.toMatch(/window\.location/);
  });

  it("passes the literal confirmed authOutcome and the CURRENT store's syncedAccountId, calling processConfirmedSignOutCookie", () => {
    expect(body).toMatch(/processConfirmedSignOutCookie\(/);
    expect(body).toMatch(/authOutcome:\s*"signed-out"/);
    expect(body).toMatch(/syncedAccountId:\s*useProfileStore\.getState\(\)\.syncedAccountId/);
  });

  it("wires the real logOut() and deleteSignOutCookie as the injected deps", () => {
    expect(body).toMatch(/logOut:\s*\(\)\s*=>\s*useProfileStore\.getState\(\)\.logOut\(\)/);
    expect(body).toMatch(/deleteCookie:\s*deleteSignOutCookie/);
  });

  // Checks for actual CODE (a definition or a call), not the explanatory
  // prose above that names the old functions on purpose to say why they
  // are gone — a bare substring match would also flag that prose.
  it("the old §1bt.7 marker mechanism is no longer DEFINED or CALLED anywhere in this file — replaced, not merely bypassed", () => {
    expect(source).not.toMatch(/function hasSignedOutMarker\(/);
    expect(source).not.toMatch(/function urlWithoutSignedOutMarker\(/);
    expect(source).not.toMatch(/function shouldClearOnThisLoad\(/);
    expect(source).not.toMatch(/hasSignedOutMarker\(search/);
    expect(source).not.toMatch(/shouldClearOnThisLoad\(search/);
    expect(source).not.toMatch(/window\.history\.replaceState/);
  });
});

// ACCOUNT-SWITCH (§1bt point 3) — "flush first, warn only on failure."
// flushBeforeSignOut is pure/DI-only (the same shape as PullBeforePushDeps
// above), tested with fakes; the real dependencies (account-section.tsx's
// actual entry point, requestProfileFlush) live inside ProfileSync and can
// only be checked by source text (no DOM in this repo's harness).
describe("flushBeforeSignOut — flush first, warn only on failure (§1bt point 3)", () => {
  it("nothing unsynced → sign out immediately: neither cancelDebounce nor attemptPush is ever called", async () => {
    let cancelCalls = 0;
    let attemptCalls = 0;
    const deps: FlushBeforeSignOutDeps = {
      pushFailed: false,
      pendingPatch: () => ({}),
      cancelDebounce: () => {
        cancelCalls += 1;
      },
      attemptPush: async () => {
        attemptCalls += 1;
      },
      stillDirty: () => false,
    };
    const result = await flushBeforeSignOut(deps, 2000);
    expect(result).toBe(true);
    expect(cancelCalls).toBe(0);
    expect(attemptCalls).toBe(0);
  });

  it("something unsynced, success case: cancels the debounce THEN attempts the push, reports caught-up — mutation: drop the flush (return !stillDirty() without ever calling cancelDebounce/attemptPush) → this test goes red", async () => {
    const calls: string[] = [];
    const deps: FlushBeforeSignOutDeps = {
      pushFailed: false,
      pendingPatch: () => ({ currentProject: "construction-unsynced-edit" }),
      cancelDebounce: () => calls.push("cancel"),
      attemptPush: async () => {
        calls.push("attempt");
      },
      stillDirty: () => false, // the attempt succeeded — nothing left dirty
    };
    const result = await flushBeforeSignOut(deps, 2000);
    expect(result).toBe(true);
    // cancel BEFORE attempt, never the other order — attempting first risks
    // the live debounce firing its OWN concurrent push mid-flush.
    expect(calls).toEqual(["cancel", "attempt"]);
  });

  it("bounded, never blocks sign-out: an attempt that never resolves still returns within the time bound, reporting not-caught-up", async () => {
    const start = Date.now();
    const deps: FlushBeforeSignOutDeps = {
      pushFailed: false,
      pendingPatch: () => ({ currentProject: "construction-unsynced-edit" }),
      cancelDebounce: () => {},
      attemptPush: () => new Promise<void>(() => {}), // never resolves
      stillDirty: () => true, // never got the chance to land
    };
    const result = await flushBeforeSignOut(deps, 30); // short bound for a fast test — the real call site uses 2000ms
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1000); // nowhere near hanging indefinitely
  });

  it("a failed attempt (settles quickly, but nothing actually landed) also warns — not only a timeout does", async () => {
    const deps: FlushBeforeSignOutDeps = {
      pushFailed: false,
      pendingPatch: () => ({ currentProject: "construction-unsynced-edit" }),
      cancelDebounce: () => {},
      attemptPush: async () => {}, // settles quickly...
      stillDirty: () => true, // ...but the push itself failed
    };
    expect(await flushBeforeSignOut(deps, 2000)).toBe(false);
  });

  it("an already-failed push alone (pushFailed=true, empty pendingPatch) still triggers a flush attempt", async () => {
    let attemptCalls = 0;
    const deps: FlushBeforeSignOutDeps = {
      pushFailed: true,
      pendingPatch: () => ({}),
      cancelDebounce: () => {},
      attemptPush: async () => {
        attemptCalls += 1;
      },
      stillDirty: () => false,
    };
    await flushBeforeSignOut(deps, 2000);
    expect(attemptCalls).toBe(1);
  });
});

// Source-text check — requestProfileFlush's real registration (no DOM
// harness for the effect itself). Confirms ProfileSync actually registers
// a flush implementation built from flushBeforeSignOut, using the SAME
// serialized list path (runSyncSerialized) point 4 established, and that
// requestProfileFlush falls back to true (never blocks) when nothing is
// registered.
describe("requestProfileFlush / ProfileSync's flush registration (§1bt point 3) — source-text check", () => {
  const source = readFileSync(join(process.cwd(), "src/components/profile-sync.tsx"), "utf8");

  it("requestProfileFlush resolves true when no ProfileSync has registered (never blocks sign-out on a component that isn't there)", () => {
    expect(source).toMatch(
      /export function requestProfileFlush\(\): Promise<boolean> \{\s*return activeFlush \? activeFlush\(\) : Promise\.resolve\(true\)/,
    );
  });

  it("ProfileSync's own registered flush calls flushBeforeSignOut and routes a list-carrying patch through the serialized path", () => {
    const start = source.indexOf("async function requestFlush(): Promise<boolean> {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("activeFlush = requestFlush;");
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toMatch(/flushBeforeSignOut\(/);
    expect(body).toMatch(/runSyncSerialized\(\s*listPullDeps\(lastPushedRef\)/);
  });
});
