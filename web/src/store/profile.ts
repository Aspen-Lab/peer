"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { localCalendarDate } from "@/lib/local-calendar-date";
import { applyColorTheme, normalizeColorTheme } from "@/lib/theme";
import type {
  UserProfile,
  Paper,
  Event,
  Job,
  CareerStage,
  IndustryAcademiaPreference,
  DigestChannel,
  DigestFrequency,
  ColorTheme,
  FeedFocus,
  FeedFreshness,
  FeedSourceMix,
  FeedImportance,
  FeedMethodMode,
  FeedDiscoveryMode,
} from "@/types";
import { defaultProfile } from "@/types";
import { normalizePersistedFeedIntent } from "@/lib/feed/intent";
import { stripCredentialFields } from "@/lib/profile/merge";
import { useJevScreeningStore } from "@/store/jev-screening";
import { cleanQuestions } from "@/store/reading-questions";
import {
  applyOpportunityFacetPreferenceSignal,
  applyPreferenceSignal,
  applyUploadPreferenceSignal,
  removeUploadPreferenceSignal,
  conceptsFromEvent,
  conceptsFromJob,
  conceptsFromPaper,
  setTermLean,
  type OpportunityFacetGroup,
  type TermLean,
} from "@/lib/preferences/ledger";

type PersistedUserProfile = Omit<Partial<UserProfile>, "colorTheme"> & {
  colorTheme?: string;
};

interface ProfileState {
  recordUploadPreference: (paper: Paper) => void;
  forgetUploadPreference: (documentKey: string) => void;
  profile: UserProfile;
  /**
   * PROFILE-SYNC (ABC-JEV-INTEGRATION.md §1bk) — per device, the
   * single-value profile fields this device last actually confirmed with
   * the account (the result of its own most recent successful
   * sign-in-reconcile or steady-state push). `null` means never confirmed
   * anything — `dirtySingleValueFields` (lib/profile/merge.ts) then
   * compares against `defaultProfile` instead (the bootstrap rule).
   * Persisted alongside `profile` (see `partialize`) — an in-memory ref
   * would reset on every reload and reintroduce the exact ping-pong bug
   * this field exists to fix (a stale device's own old value overwriting a
   * newer real edit made elsewhere, on every load).
   */
  lastSynced: Partial<UserProfile> | null;
  /** Replace the whole snapshot — never a per-field merge; see the field
   *  doc above and §1bk ruling 3 ("becomes the resulting snapshot"). */
  setLastSynced: (snapshot: Partial<UserProfile>) => void;
  /**
   * ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt point 1) — the account id
   * this device last confirmed sign-in with, mirroring the feed store's
   * already-shipped `syncedUserId` (store/feed.ts). `null` means "no owner
   * yet" — a fresh device, or a pre-§1bt blob that simply lacks the key
   * (the same "widen, don't rename" migration precedent `lastSynced`
   * itself used at v5/v6: no migration step writes a default, the missing
   * key IS the honest "no owner yet" answer). Set eagerly, the moment
   * `profile-sync.tsx`'s `onSession` confirms a real user id — before the
   * pull/merge/push even starts, same timing as that file's own
   * `authUserId` publish. A DIFFERENT non-null value at the next sign-in
   * means a different real person is now using this device/browser; that
   * comparison is what gates whether `logOut()` runs before today's
   * reconcile (see `onSession`, not this file — this field is only the
   * durable half of the mechanism). Persisted alongside `profile`/
   * `lastSynced` (see `partialize`) — an in-memory-only value would forget
   * the owner on every reload and never catch a switch that happens across
   * two separate visits.
   */
  syncedAccountId: string | null;
  /** Record the account id this device just confirmed sign-in with. See
   *  the field doc above; `logOut()` is what resets it back to null. */
  setSyncedAccountId: (id: string | null) => void;
  /** Replace the whole profile from an exported document. */
  importProfile: (document: unknown) => boolean;
  updateDisplayName: (name: string) => void;
  updateTopics: (topics: string[]) => void;
  updateSoftTopics: (topics: string[]) => void;
  updateEventTopics: (topics: string[]) => void;
  updateEventSoftTopics: (topics: string[]) => void;
  updateJobTopics: (topics: string[]) => void;
  updateJobSoftTopics: (topics: string[]) => void;
  updatePreferredJournals: (journals: string[]) => void;
  updateCareerStage: (stage: CareerStage) => void;
  updateIndustryPreference: (pref: IndustryAcademiaPreference) => void;
  updateLocations: (locations: string[]) => void;
  updateAuthorisedCountries: (countries: string[]) => void;
  updateMethods: (methods: string[]) => void;
  updateSchool: (school: string) => void;
  updateCurrentProject: (text: string) => void;
  updateCurrentChallenges: (text: string) => void;
  /** P5-01: the reader's standing questions, cleaned like any question (trimmed, distinct, five of 200). */
  updateStandingQuestions: (questions: readonly string[]) => void;
  recordPaperPreference: (
    paper: Paper,
    signal: "positive" | "negative",
    at?: string,
  ) => void;
  /** Event feedback: recorded under the `event` origin namespace — flows
   * weakly into job scoring, never back into papers. */
  recordEventPreference: (
    event: Event,
    signal: "positive" | "negative",
    at?: string,
  ) => void;
  /** Job feedback: recorded under the `job` origin namespace — job-only. */
  recordJobPreference: (
    job: Job,
    signal: "positive" | "negative",
    at?: string,
  ) => void;
  /** Facet clicks are weak, positive-only evidence under event/job origins. */
  recordOpportunityFacetPreference: (
    origin: "event" | "job",
    group: OpportunityFacetGroup,
    value: string,
    at?: string,
  ) => void;
  /** Wipe everything Peer has learned from likes/saves/dismissals. */
  resetPreferenceLedger: () => void;
  /** A deliberate lean on a term from the reading graph: more of it, less of
   *  it, or none. The ledger rides along with every feed request, so it
   *  applies from the next load — the board issues one straight away. See
   *  `setTermLean`. */
  leanOnTerm: (label: string, lean: TermLean | null) => void;
  /** Add a term to, or take it out of, the explore topics the briefing
   *  searches alongside the reader's own. Topic changes are promoted once a
   *  day (`promoteSearchInputs`), so this reaches tomorrow's briefing. */
  followTerm: (label: string, follow: boolean) => void;
  updateFeedFocus: (value: FeedFocus) => void;
  updateFeedFreshness: (value: FeedFreshness) => void;
  updatePaperCount: (value: 5 | 10) => void;
  updateFeedSourceMix: (value: FeedSourceMix) => void;
  updateFeedImportance: (value: FeedImportance) => void;
  updateFeedMethodMode: (value: FeedMethodMode) => void;
  updateFeedDiscoveryMode: (value: FeedDiscoveryMode) => void;
  updateFeedAvoidReviews: (value: boolean) => void;
  updateFeedAvoidOldPapers: (value: boolean) => void;
  updateFeedAvoidBroadSurveys: (value: boolean) => void;
  updateAdvisorName: (name: string) => void;
  /** Lock in the user-confirmed OpenAlex author identity for the advisor. */
  confirmAdvisorAuthor: (authorId: string, label: string) => void;
  /** Clear the confirmed advisor identity + its cached seeds (e.g. on "change"). */
  clearAdvisorAuthor: () => void;
  /** Store freshly recomputed advisor discovery seeds and stamp the refresh time. */
  setAdvisorSeeds: (seeds: { workIds: string[]; texts: string[] }) => void;
  updateDigestEnabled: (v: boolean) => void;
  updateDigestHourLocal: (h: number) => void;
  updateDigestTimezone: (tz: string) => void;
  updateDigestChannel: (c: DigestChannel) => void;
  updateDigestFrequency: (f: DigestFrequency) => void;
  updateDigestEmail: (email: string) => void;
  updateTavilyEnabled: (value: boolean) => void;
  updateTavilyApiKey: (value: string) => void;
  updateAdzunaKeys: (appId: string, appKey: string) => void;
  updateUsajobsKeys: (apiKey: string, userAgent: string) => void;
  updateFeedAiProvider: (value: UserProfile["feedAiProvider"]) => void;
  updateFeedAiApiKey: (value: string) => void;
  /** The reader's own Jev key: trimmed, blank clears it. Never synced. */
  updateJevApiKey: (value: string) => void;
  updateDeepReportEnabled: (value: boolean) => void;
  updateColorTheme: (theme: ColorTheme) => void;
  /** Mark first-run onboarding complete (defaults to now). */
  completeOnboarding: (at?: string) => void;
  /** Clear the onboarding flag so the welcome flow shows again (replay / dev). */
  resetOnboarding: () => void;
  /** Replace local state with a server snapshot. Undefined fields keep local values. */
  hydrateFromRemote: (remote: Partial<UserProfile>) => void;
  logOut: () => void;
}

export function migrateProfileStore(
  persisted: unknown,
  version: number,
): unknown {
  if (!persisted || typeof persisted !== "object") return persisted;

  const state = persisted as {
    profile?: PersistedUserProfile;
    [key: string]: unknown;
  };
  if (!state.profile || typeof state.profile !== "object") return persisted;

  const profile: PersistedUserProfile = { ...state.profile };
  if (profile.colorTheme !== undefined) {
    profile.colorTheme = normalizeColorTheme(profile.colorTheme);
  }

  if (version < 3) {
    const requiredTopics = Array.isArray(profile.researchTopics)
      ? profile.researchTopics
      : [];
    const exploreTopics = Array.isArray(profile.softTopics)
      ? profile.softTopics
      : [];

    if (
      !Array.isArray(profile.eventRequiredTopics) ||
      profile.eventRequiredTopics.length === 0
    ) {
      profile.eventRequiredTopics = [...requiredTopics];
    }
    if (
      !Array.isArray(profile.eventExploreTopics) ||
      profile.eventExploreTopics.length === 0
    ) {
      profile.eventExploreTopics = [...exploreTopics];
    }
    if (
      !Array.isArray(profile.jobRequiredTopics) ||
      profile.jobRequiredTopics.length === 0
    ) {
      profile.jobRequiredTopics = [...requiredTopics];
    }
    if (
      !Array.isArray(profile.jobExploreTopics) ||
      profile.jobExploreTopics.length === 0
    ) {
      profile.jobExploreTopics = [...exploreTopics];
    }
  }

  const authorisedCountries = (
    profile as PersistedUserProfile & {
      authorisedCountries?: unknown;
    }
  ).authorisedCountries;
  profile.authorisedCountries = Array.isArray(authorisedCountries)
    ? Array.from(
        new Map(
          authorisedCountries
            .filter((country): country is string => typeof country === "string")
            .map((country) => country.trim())
            .filter(Boolean)
            .map((country) => [country.toLocaleLowerCase(), country]),
        ).values(),
      )
    : [];

  return { ...state, profile };
}

/**
 * True when the active snapshot has no usable topics on any surface but the
 * pending fields do — i.e. we have never once locked in a real search input.
 *
 * This is the bootstrap case, and it has to bypass the once-a-day rule.
 * Promotion normally runs at hydration, which for a brand-new user happens
 * *before* they complete onboarding — so the day's snapshot gets stamped while
 * the profile is still empty, and everything they then enter would sit unused
 * until the next calendar day. A first-time user would finish setup and be
 * shown an empty feed with no explanation.
 *
 * It cannot be used to sidestep the day-lock later: once a surface has active
 * topics this is false, and editing pending values never empties the snapshot.
 */
function hasNoActiveInputsYet(profile: UserProfile): boolean {
  const active = profile.activeSearchInputs;
  if (!active) return true;
  const activeCount =
    active.papers.required.length +
    active.events.required.length +
    active.jobs.required.length;
  if (activeCount > 0) return false;
  const pendingCount =
    profile.researchTopics.length +
    profile.eventRequiredTopics.length +
    profile.jobRequiredTopics.length;
  return pendingCount > 0;
}

export function promoteSearchInputs(
  profile: UserProfile,
  now: Date,
): UserProfile {
  const today = localCalendarDate(now);
  if (
    profile.activeSearchInputs?.promotedOn === today &&
    !hasNoActiveInputsYet(profile)
  ) {
    return profile;
  }

  return {
    ...profile,
    activeSearchInputs: {
      papers: {
        required: [...profile.researchTopics],
        explore: [...(profile.softTopics ?? [])],
      },
      events: {
        required: [...profile.eventRequiredTopics],
        explore: [...profile.eventExploreTopics],
      },
      jobs: {
        required: [...profile.jobRequiredTopics],
        explore: [...profile.jobExploreTopics],
      },
      careerStage: profile.careerStage,
      locationPreferences: [...profile.locationPreferences],
      promotedOn: today,
    },
  };
}

function mergeHydratedProfileState(
  persisted: unknown,
  current: ProfileState,
): ProfileState {
  const persistedState =
    persisted && typeof persisted === "object"
      ? (persisted as Partial<ProfileState>)
      : {};
  const persistedProfile =
    persistedState.profile && typeof persistedState.profile === "object"
      ? persistedState.profile
      : {};

  return {
    ...current,
    ...persistedState,
    profile: promoteSearchInputs(
      {
        ...current.profile,
        ...persistedProfile,
      },
      new Date(),
    ),
  };
}

export const PROFILE_EXPORT_FORMAT = "peer.profile/v1" as const;

interface ExportedProfileDocument {
  format: typeof PROFILE_EXPORT_FORMAT;
  profile: Partial<UserProfile>;
}

/**
 * A signed-out profile lives in one browser's localStorage and nowhere else,
 * so clearing site data or switching browsers loses it with no warning. Export
 * and import let a local tester move settings without an account.
 *
 * **A backup file carries no credential.** The reader's Jev key, their model
 * key and every other credential-like field (`stripCredentialFields`, the same
 * list a restore refuses to install) are left out of the document: a file the
 * reader may email, sync or paste is the wrong place for a secret, and a
 * restore could not use it anyway.
 */
export function exportProfileDocument(
  profile: UserProfile,
): ExportedProfileDocument {
  return { format: PROFILE_EXPORT_FORMAT, profile: stripCredentialFields(profile) };
}

/** Returns the profile from an exported document, or null if it is not one. */
export function parseExportedProfile(
  document: unknown,
): Partial<UserProfile> | null {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return null;
  }
  const record = document as Record<string, unknown>;
  if (record.format !== PROFILE_EXPORT_FORMAT) return null;
  const profile = record.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  // Malformed input must leave the existing profile untouched, so only known
  // keys survive and anything else in the file is ignored.
  // `standingQuestions` is absent from `defaultProfile` (an optional field), so it is named here.
  const known = [...Object.keys(defaultProfile), "feedIntent", "standingQuestions"] as Array<keyof UserProfile>;
  const source = profile as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of known) {
    if (!(key in source)) continue;
    if (key === "feedIntent") {
      const intent = normalizePersistedFeedIntent(source[key]);
      if (intent.ok) result[key] = intent.intent;
      continue;
    }
    if (key === "standingQuestions") {
      // The reader's own questions, kept as typed; anything that is not a list of text is ignored.
      const list = source[key];
      if (Array.isArray(list)) result[key] = cleanQuestions(list.filter((q): q is string => typeof q === "string"));
      continue;
    }
    result[key] = source[key];
  }
  return Object.keys(result).length > 0
    ? (result as Partial<UserProfile>)
    : null;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: defaultProfile,
      // PROFILE-SYNC (§1bk) — never confirmed anything with any account yet;
      // see the field doc above.
      lastSynced: null,
      // ACCOUNT-SWITCH (§1bt point 1) — no owner recorded yet; see the
      // field doc above.
      syncedAccountId: null,

      setLastSynced: (snapshot) => set({ lastSynced: snapshot }),
      setSyncedAccountId: (id) => set({ syncedAccountId: id }),

      recordUploadPreference: (paper) => set((s) => ({ profile: { ...s.profile,
        preferenceLedger: applyUploadPreferenceSignal(s.profile.preferenceLedger,
          conceptsFromPaper(paper), paper.uploadDocumentKey ?? ""),
      } })),
      forgetUploadPreference: (key) => set((s) => ({ profile: { ...s.profile,
        preferenceLedger: removeUploadPreferenceSignal(s.profile.preferenceLedger, key),
      } })),

      updateDisplayName: (name) =>
        set((s) => ({
          profile: {
            ...s.profile,
            displayName: name.trim() || "Peer Member",
          },
        })),

      // PROFILE-UNSYNCED-FIELDS (§1bp.2) — every setter below that changes
      // an intent input (researchTopics/softTopics/preferredMethods/
      // currentProject/currentChallenges — the fields lib/profile/merge.ts's
      // INTENT_LIST_FIELDS/INTENT_SINGLE_FIELDS name) also clears feedIntent
      // in the SAME set(), so the next push recomputes it fresh instead of
      // `profileFeedIntentCard` (lib/feed/intent.ts) re-validating a stale
      // stored card. Without this, an edit made after `hydrateFromRemote`
      // installs a defined feedIntent (the one production trigger: the
      // Profile page's email-confirm redirect) never reaches the account
      // this session — proved by docs/jev-abc/PROFILE-UNSYNCED-FIELDS-B-20260930T074850Z.md
      // Q2b. Enumerated by grepping this file for every `set()` call that
      // writes one of these five field names — not copied from that
      // investigation's own list, which missed `followTerm` below (it also
      // writes softTopics, independently of updateSoftTopics).
      updateTopics: (topics) =>
        set((s) => ({ profile: { ...s.profile, researchTopics: topics, feedIntent: undefined } })),

      updateSoftTopics: (topics) =>
        set((s) => ({ profile: { ...s.profile, softTopics: topics, feedIntent: undefined } })),

      updateEventTopics: (topics) =>
        set((s) => ({
          profile: { ...s.profile, eventRequiredTopics: topics },
        })),

      updateEventSoftTopics: (topics) =>
        set((s) => ({
          profile: { ...s.profile, eventExploreTopics: topics },
        })),

      updateJobTopics: (topics) =>
        set((s) => ({
          profile: { ...s.profile, jobRequiredTopics: topics },
        })),

      updateJobSoftTopics: (topics) =>
        set((s) => ({
          profile: { ...s.profile, jobExploreTopics: topics },
        })),

      updatePreferredJournals: (journals) =>
        set((s) => ({ profile: { ...s.profile, preferredJournals: journals } })),


      updateCareerStage: (stage) =>
        set((s) => ({ profile: { ...s.profile, careerStage: stage } })),

      updateIndustryPreference: (pref) =>
        set((s) => ({ profile: { ...s.profile, industryVsAcademia: pref } })),

      updateLocations: (locations) =>
        set((s) => ({
          profile: { ...s.profile, locationPreferences: locations },
        })),

      updateAuthorisedCountries: (countries) =>
        set((s) => ({
          profile: { ...s.profile, authorisedCountries: countries },
        })),

      updateMethods: (methods) =>
        set((s) => ({
          // PROFILE-UNSYNCED-FIELDS (§1bp.2) — see updateTopics's note above.
          profile: { ...s.profile, preferredMethods: methods, feedIntent: undefined },
        })),

      updateSchool: (school) =>
        set((s) => ({
          profile: { ...s.profile, school: school.trim() || undefined },
        })),

      updateCurrentProject: (text) =>
        set((s) => ({
          // Empty is a deliberate clear, not proof this field was never set.
          // PROFILE-UNSYNCED-FIELDS (§1bp.2) — see updateTopics's note above.
          profile: { ...s.profile, currentProject: text, feedIntent: undefined },
        })),

      updateCurrentChallenges: (text) =>
        set((s) => ({
          // Empty is a deliberate clear, not proof this field was never set.
          // PROFILE-UNSYNCED-FIELDS (§1bp.2) — see updateTopics's note above.
          profile: { ...s.profile, currentChallenges: text, feedIntent: undefined },
        })),

      updateStandingQuestions: (questions) =>
        set((s) => ({
          profile: { ...s.profile, standingQuestions: cleanQuestions(questions) },
        })),

      recordPaperPreference: (paper, signal, at) =>
        set((s) => ({
          profile: {
            ...s.profile,
            preferenceLedger: applyPreferenceSignal(
              s.profile.preferenceLedger,
              conceptsFromPaper(paper),
              signal,
              {
                at,
                requiredTopics: s.profile.researchTopics,
              },
            ),
          },
        })),

      recordEventPreference: (event, signal, at) =>
        set((s) => ({
          profile: {
            ...s.profile,
            preferenceLedger: applyPreferenceSignal(
              s.profile.preferenceLedger,
              conceptsFromEvent(event),
              signal,
              { at, origin: "event" },
            ),
          },
        })),

      recordJobPreference: (job, signal, at) =>
        set((s) => ({
          profile: {
            ...s.profile,
            preferenceLedger: applyPreferenceSignal(
              s.profile.preferenceLedger,
              conceptsFromJob(job),
              signal,
              { at, origin: "job" },
            ),
          },
        })),

      recordOpportunityFacetPreference: (origin, group, value, at) =>
        set((s) => ({
          profile: {
            ...s.profile,
            preferenceLedger: applyOpportunityFacetPreferenceSignal(
              s.profile.preferenceLedger,
              group,
              value,
              { at, origin },
            ),
          },
        })),

      resetPreferenceLedger: () =>
        set((s) => ({ profile: { ...s.profile, preferenceLedger: {} } })),

      leanOnTerm: (label, lean) =>
        set((s) => ({
          profile: {
            ...s.profile,
            preferenceLedger: setTermLean(s.profile.preferenceLedger, label, lean),
          },
        })),

      followTerm: (label, follow) =>
        set((s) => {
          const current = s.profile.softTopics ?? [];
          const key = label.trim().toLowerCase();
          const has = current.some((t) => t.trim().toLowerCase() === key);
          if (follow === has) return s;
          return {
            profile: {
              ...s.profile,
              softTopics: follow
                ? [...current, label.trim()]
                : current.filter((t) => t.trim().toLowerCase() !== key),
              // PROFILE-UNSYNCED-FIELDS (§1bp.2) — this setter also writes
              // softTopics (alongside updateSoftTopics above), found by
              // grepping this file rather than trusting the investigation
              // guide's own enumeration, which missed it. See updateTopics's
              // note above; the early return two lines up already covers
              // the "nothing actually changed" no-op case.
              feedIntent: undefined,
            },
          };
        }),

      updateFeedFocus: (value) =>
        set((s) => ({ profile: { ...s.profile, feedFocus: value } })),
      updateFeedFreshness: (value) =>
        set((s) => ({ profile: { ...s.profile, feedFreshness: value } })),
      updatePaperCount: (value) =>
        set((s) => ({ profile: { ...s.profile, paperCount: value } })),
      updateFeedSourceMix: (value) =>
        set((s) => ({ profile: { ...s.profile, feedSourceMix: value } })),
      updateFeedImportance: (value) =>
        set((s) => ({ profile: { ...s.profile, feedImportance: value } })),
      updateFeedMethodMode: (value) =>
        set((s) => ({ profile: { ...s.profile, feedMethodMode: value } })),
      updateFeedDiscoveryMode: (value) =>
        set((s) => ({ profile: { ...s.profile, feedDiscoveryMode: value } })),
      updateFeedAvoidReviews: (value) =>
        set((s) => ({ profile: { ...s.profile, feedAvoidReviews: value } })),
      updateFeedAvoidOldPapers: (value) =>
        set((s) => ({ profile: { ...s.profile, feedAvoidOldPapers: value } })),
      updateFeedAvoidBroadSurveys: (value) =>
        set((s) => ({ profile: { ...s.profile, feedAvoidBroadSurveys: value } })),

      updateAdvisorName: (name) =>
        set((s) => {
          // Do NOT trim here — trimming on every keystroke eats spaces while
          // the user is still typing. The find() call in AdvisorField trims
          // before it actually searches.
          return {
            profile: {
              ...s.profile,
              advisorName: name || undefined,
              advisorAuthorId: undefined,
              advisorAuthorLabel: undefined,
              advisorSeedWorkIds: undefined,
              advisorSeedTexts: undefined,
              advisorSeedsRefreshedAt: null,
            },
          };
        }),
      confirmAdvisorAuthor: (authorId, label) =>
        set((s) => ({
          profile: {
            ...s.profile,
            advisorAuthorId: authorId,
            advisorAuthorLabel: label,
            // Force a seed recompute on next feed load.
            advisorSeedsRefreshedAt: null,
          },
        })),
      clearAdvisorAuthor: () =>
        set((s) => ({
          profile: {
            ...s.profile,
            advisorAuthorId: undefined,
            advisorAuthorLabel: undefined,
            advisorSeedWorkIds: undefined,
            advisorSeedTexts: undefined,
            advisorSeedsRefreshedAt: null,
          },
        })),
      setAdvisorSeeds: ({ workIds, texts }) =>
        set((s) => ({
          profile: {
            ...s.profile,
            advisorSeedWorkIds: workIds,
            advisorSeedTexts: texts,
            advisorSeedsRefreshedAt: new Date().toISOString(),
          },
        })),

      updateDigestEnabled: (v) =>
        set((s) => ({ profile: { ...s.profile, digestEnabled: v } })),
      updateDigestHourLocal: (h) =>
        set((s) => ({ profile: { ...s.profile, digestHourLocal: h } })),
      updateDigestTimezone: (tz) =>
        set((s) => ({ profile: { ...s.profile, digestTimezone: tz } })),
      updateDigestChannel: (c) =>
        set((s) => ({ profile: { ...s.profile, digestChannel: c } })),
      updateDigestFrequency: (f) =>
        set((s) => ({ profile: { ...s.profile, digestFrequency: f } })),
      updateDigestEmail: (email) =>
        set((s) => ({ profile: { ...s.profile, digestEmail: email } })),
      updateTavilyEnabled: (value) =>
        set((s) => ({ profile: { ...s.profile, tavilyEnabled: value } })),
      updateTavilyApiKey: (value) =>
        set((s) => ({
          profile: { ...s.profile, tavilyApiKey: value.trim() || undefined },
        })),
      updateAdzunaKeys: (appId, appKey) =>
        set((s) => ({
          profile: {
            ...s.profile,
            adzunaAppId: appId.trim() || undefined,
            adzunaAppKey: appKey.trim() || undefined,
          },
        })),
      updateUsajobsKeys: (apiKey, userAgent) =>
        set((s) => ({
          profile: {
            ...s.profile,
            usajobsApiKey: apiKey.trim() || undefined,
            usajobsUserAgent: userAgent.trim() || undefined,
          },
        })),
      updateFeedAiProvider: (value) =>
        set((s) => ({
          profile: {
            ...s.profile,
            feedAiProvider: value,
            feedAiApiKey:
              value === "default" ? undefined : s.profile.feedAiApiKey,
          },
        })),
      updateFeedAiApiKey: (value) =>
        set((s) => ({
          profile: { ...s.profile, feedAiApiKey: value.trim() || undefined },
        })),
      updateJevApiKey: (value) => {
        const before = get().profile.jevApiKey?.trim() ?? "";
        const next = value.trim() || undefined;
        set((s) => ({ profile: { ...s.profile, jevApiKey: next } }));
        // What Jev did last time describes the key that produced it: a key that
        // was set and is now replaced or removed ends it. A first key (nothing
        // before it) leaves it alone, so does an edit that changes nothing.
        if (before !== "" && before !== (next ?? "")) useJevScreeningStore.getState().clear();
      },
      updateDeepReportEnabled: (value) =>
        set((s) => ({ profile: { ...s.profile, deepReportEnabled: value } })),
      updateColorTheme: (theme) => {
        applyColorTheme(theme);
        set((s) => ({ profile: { ...s.profile, colorTheme: theme } }));
      },

      completeOnboarding: (at) =>
        set((s) => ({
          // Promote here as well as at hydration. For a first-time user the
          // hydration promotion happened before they had entered anything, so
          // without this their brand-new topics would not reach a search until
          // the next calendar day and their first feed would be empty.
          // promoteSearchInputs only acts when the snapshot has never held real
          // inputs, so this cannot bypass the day-lock for a returning user.
          profile: promoteSearchInputs(
            { ...s.profile, onboardedAt: at ?? new Date().toISOString() },
            new Date(),
          ),
        })),
      resetOnboarding: () =>
        set((s) => ({ profile: { ...s.profile, onboardedAt: null } })),

      hydrateFromRemote: (remote) =>
        set((s) => {
          const merged: UserProfile = { ...s.profile };
          if (remote.displayName !== undefined) merged.displayName = remote.displayName;
          if (remote.researchTopics !== undefined) merged.researchTopics = remote.researchTopics;
          if (remote.preferredMethods !== undefined) merged.preferredMethods = remote.preferredMethods;
          if (remote.locationPreferences !== undefined) merged.locationPreferences = remote.locationPreferences;
          if (remote.authorisedCountries !== undefined) merged.authorisedCountries = remote.authorisedCountries;
          if (remote.careerStage !== undefined) merged.careerStage = remote.careerStage;
          if (remote.industryVsAcademia !== undefined) merged.industryVsAcademia = remote.industryVsAcademia;
          if (remote.phdYear !== undefined) merged.phdYear = remote.phdYear;
          if (remote.school !== undefined) merged.school = remote.school;
          if (remote.currentProject !== undefined) merged.currentProject = remote.currentProject;
          if (remote.currentChallenges !== undefined) merged.currentChallenges = remote.currentChallenges;
          if (remote.feedIntent !== undefined) merged.feedIntent = remote.feedIntent;
          if (remote.dislikedTopics !== undefined) merged.dislikedTopics = remote.dislikedTopics;
          if (remote.preferenceLedger !== undefined) merged.preferenceLedger = remote.preferenceLedger;
          if (remote.softTopics !== undefined) merged.softTopics = remote.softTopics;
          if (remote.preferredJournals !== undefined) merged.preferredJournals = remote.preferredJournals;
          if (remote.feedFocus !== undefined) merged.feedFocus = remote.feedFocus;
          if (remote.feedFreshness !== undefined) merged.feedFreshness = remote.feedFreshness;
          if (remote.paperCount !== undefined) merged.paperCount = remote.paperCount;
          if (remote.feedSourceMix !== undefined) merged.feedSourceMix = remote.feedSourceMix;
          if (remote.feedImportance !== undefined) merged.feedImportance = remote.feedImportance;
          if (remote.feedMethodMode !== undefined) merged.feedMethodMode = remote.feedMethodMode;
          if (remote.feedDiscoveryMode !== undefined) merged.feedDiscoveryMode = remote.feedDiscoveryMode;
          if (remote.feedAvoidReviews !== undefined) merged.feedAvoidReviews = remote.feedAvoidReviews;
          if (remote.feedAvoidOldPapers !== undefined) merged.feedAvoidOldPapers = remote.feedAvoidOldPapers;
          if (remote.feedAvoidBroadSurveys !== undefined) merged.feedAvoidBroadSurveys = remote.feedAvoidBroadSurveys;
          if (remote.advisorName !== undefined) merged.advisorName = remote.advisorName;
          if (remote.digestEnabled !== undefined) merged.digestEnabled = remote.digestEnabled;
          if (remote.digestHourLocal !== undefined) merged.digestHourLocal = remote.digestHourLocal;
          if (remote.digestTimezone !== undefined) merged.digestTimezone = remote.digestTimezone;
          if (remote.digestChannel !== undefined) merged.digestChannel = remote.digestChannel;
          if (remote.digestEmail !== undefined) merged.digestEmail = remote.digestEmail;
          if (remote.digestFrequency !== undefined) merged.digestFrequency = remote.digestFrequency;
          if (remote.tavilyEnabled !== undefined) merged.tavilyEnabled = remote.tavilyEnabled;
          if (remote.tavilyApiKey !== undefined) merged.tavilyApiKey = remote.tavilyApiKey;
          if (remote.feedAiProvider !== undefined) merged.feedAiProvider = remote.feedAiProvider;
          if (remote.feedAiApiKey !== undefined) merged.feedAiApiKey = remote.feedAiApiKey;
          if (remote.deepReportEnabled !== undefined) merged.deepReportEnabled = remote.deepReportEnabled;
          if (remote.colorTheme !== undefined) {
            // The server may still hold a pre-v2 single-name theme
            // ("black", "lavender", …) — normalize BEFORE storing, or the
            // picker's mode/accent split chokes on the legacy value.
            const normalized = normalizeColorTheme(remote.colorTheme);
            merged.colorTheme = normalized;
            applyColorTheme(normalized);
          }
          return { profile: merged };
        }),

      importProfile: (document) => {
        const parsed = parseExportedProfile(document);
        if (!parsed) return false;
        // A file that carries a credential (an older backup) cannot install
        // it: the same refusal `mergeProfileFromBackup` makes on a restore.
        const installable = stripCredentialFields(parsed);
        set((s) => ({ profile: { ...s.profile, ...installable } }));
        if (installable.colorTheme) applyColorTheme(installable.colorTheme);
        return true;
      },

      logOut: () => {
        // A confirmed sign-out resets the profile, and with it the Jev key, so
        // the report about that key goes too.
        useJevScreeningStore.getState().clear();
        applyColorTheme(defaultProfile.colorTheme);
        // PROFILE-SYNC (§1bk) — lastSynced describes what THIS account
        // confirmed with THIS device; once profile itself resets to
        // defaultProfile, a stale lastSynced from the previous account
        // would make every default look "dirty" relative to it on the next
        // sign-in (the same person signing back in, or — a shared computer
        // — someone else), reintroducing the overwrite bug through a
        // different door. Reset together.
        // ACCOUNT-SWITCH (§1bt point 1) — syncedAccountId resets together
        // with them: a stale owner id surviving a wipe would make the very
        // next sign-in (even the SAME account signing back in) look like a
        // no-op "same owner" match against a profile that is actually
        // already clean, which is harmless, OR — if logOut() ran for a
        // reason other than a confirmed switch — would leave the wrong
        // owner recorded. Simplest correct rule: nobody is confirmed to
        // own this device's data the instant it is wiped.
        set({
          profile: defaultProfile,
          lastSynced: null,
          syncedAccountId: null,
        });
      },
    }),
    // skipHydration: persisted state is rehydrated after mount via
    // <StoreHydrator/> so the first client render matches SSR defaults and
    // avoids a hydration mismatch. See store/ui.ts for the full rationale.
    {
      name: "peer-profile",
      skipHydration: true,
      // PROFILE-SYNC (§1bk) — `lastSynced` is deliberately persisted alongside
      // `profile`: an in-memory-only baseline is exactly the ping-pong bug
      // this field exists to fix. ACCOUNT-SWITCH (§1bt point 1) —
      // `syncedAccountId` joins them for the same reason: an in-memory-only
      // owner id would forget who this device belongs to on every reload,
      // and never catch a switch spanning two separate visits.
      partialize: (state) => ({
        profile: state.profile,
        lastSynced: state.lastSynced,
        syncedAccountId: state.syncedAccountId,
      }) as ProfileState,
      // v2: colorTheme became a "mode:accent" composite.
      // v3: Events and Jobs gained independent Required/Explore topic fields.
      // v4: work-authorisation countries became a persisted profile signal.
      // v5: PROFILE-SYNC (§1bk) — lastSynced, a per-device snapshot of the
      //     single-value fields' last-confirmed values. The migration adds
      //     none for a pre-v5 blob (deliberately — see
      //     dirtySingleValueFields's bootstrap rule): its first sync under
      //     the fixed code compares against defaultProfile instead of
      //     assuming everything is already synced.
      // v6: LIST-REMOVAL-SYNC (§1bq) — lastSynced ALSO folds in each
      //     LIST_FIELDS entry now (the widened singleValueSnapshot), the
      //     per-device "base" the three-way list merge compares against.
      //     Same reasoning as v5, extended to lists: the migration adds
      //     none for a pre-v6 blob — a device with a real v5 lastSynced but
      //     no list-field entries in it yet reads as "no baseline for this
      //     list on this device" (threeWayMergeList's own no-base case),
      //     i.e. plain union, once, automatically, per list field, per
      //     device — the same "whichever loads first after the fix wins,
      //     once" transition §1bk.3 already shipped for scalars.
      // v7: ACCOUNT-SWITCH (§1bt point 1) — syncedAccountId, the device's
      //     recorded owner. The migration adds none for a pre-v7 blob — a
      //     missing key reads as "no owner yet" (mergeHydratedProfileState
      //     spreads the persisted object over the creator's own initial
      //     `syncedAccountId: null`, so an absent key simply leaves that
      //     null in place — the same widen-don't-rename shape v5/v6 used),
      //     which is exactly correct: a device already mid-session under
      //     the old code has not "switched" accounts merely because this
      //     fix shipped, so its very next sign-in must not be treated as
      //     one.
      version: 7,
      migrate: (persisted, version) =>
        migrateProfileStore(persisted, version) as ProfileState,
      // Build the promoted snapshot as part of the state installed by
      // hydration, so subscribers can never observe hydrated pending inputs
      // without the corresponding active inputs.
      merge: mergeHydratedProfileState,
    }
  )
);
