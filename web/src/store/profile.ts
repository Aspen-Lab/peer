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
import { type ClientEntitlement } from "@/lib/entitlement/allowance";
import {
  applyOpportunityFacetPreferenceSignal,
  applyPreferenceSignal,
  conceptsFromEvent,
  conceptsFromJob,
  conceptsFromPaper,
  type OpportunityFacetGroup,
} from "@/lib/preferences/ledger";

type PersistedUserProfile = Omit<Partial<UserProfile>, "colorTheme"> & {
  colorTheme?: string;
};

interface ProfileState {
  profile: UserProfile;
  /**
   * ABC-freemium 1-14 · R-ENT-3 — what the server says this reader may use.
   *
   * **Never derived on the client from the raw row.** D5 makes the server the
   * authority and expiry is computed at read time, so a browser that worked out
   * its own plan from `trial_ends_at` would be a second source of truth that
   * drifts. `GET /api/profile` computes it; the client only displays it.
   *
   * ── ABC-freemium 6-04 · Ruling 16 points 2-3 — **THREE STATES, NOT TWO** ──
   *
   * `null` means **not yet known**: nobody has asked the server, or the answer
   * has not come back. It is distinct from "known to be signed out", which is a
   * real `ANONYMOUS_CLIENT_ENTITLEMENT` object that `ProfileSync` sets once it
   * has established there is no session.
   *
   * This field used to *default* to that anonymous object, on the reasoning
   * that a real object with real zeroes meant no consumer needed a null branch
   * and a forgotten one could not fail open. That reasoning was wrong in one
   * direction and it shipped: **every reader looked free on the client until the
   * profile fetch returned, including a paid one**, while the server went on
   * granting what they had paid for. A paid reader who met the quota notice in
   * that window was served *and* told to upgrade — the exact thing Ruling 8
   * forbids, on the surface Ruling 8 was written for.
   *
   * `null` fails open for nobody, because the two kinds of consumer read it
   * differently and the compiler makes both choose:
   *  - a **capability** question takes `entitlementGrants(entitlement)`, which
   *    answers with the anonymous default and so grants nothing while ignorant;
   *  - an **upsell** takes the nullable value and renders **nothing** on `null`.
   *    An upsell needs positive evidence the reader is not entitled; absence of
   *    data is not evidence.
   *
   * **Deliberately NOT persisted** (see `partialize`): a `paid` entitlement
   * cached in localStorage would survive a downgrade. That is also why `null`
   * is the honest value on a cold load — the browser genuinely does not know.
   */
  entitlement: ClientEntitlement | null;
  setEntitlement: (entitlement: ClientEntitlement) => void;
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
  profile: UserProfile;
}

/**
 * A signed-out profile lives in one browser's localStorage and nowhere else,
 * so clearing site data or switching browsers loses it with no warning. Export
 * and import let a local tester move settings without an account.
 */
export function exportProfileDocument(
  profile: UserProfile,
): ExportedProfileDocument {
  return { format: PROFILE_EXPORT_FORMAT, profile };
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
  const known = Object.keys(defaultProfile) as Array<keyof UserProfile>;
  const source = profile as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of known) {
    if (key in source) result[key] = source[key];
  }
  return Object.keys(result).length > 0
    ? (result as Partial<UserProfile>)
    : null;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: defaultProfile,
      // ABC-freemium 6-04 — not yet known. `ProfileSync` replaces it with the
      // server's answer, or with `ANONYMOUS_CLIENT_ENTITLEMENT` once it has
      // established there is no session to ask about.
      entitlement: null,

      setEntitlement: (entitlement) => set({ entitlement }),

      updateDisplayName: (name) =>
        set((s) => ({
          profile: {
            ...s.profile,
            displayName: name.trim() || "Peer Member",
          },
        })),

      updateTopics: (topics) =>
        set((s) => ({ profile: { ...s.profile, researchTopics: topics } })),

      updateSoftTopics: (topics) =>
        set((s) => ({ profile: { ...s.profile, softTopics: topics } })),

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
          profile: { ...s.profile, preferredMethods: methods },
        })),

      updateSchool: (school) =>
        set((s) => ({
          profile: { ...s.profile, school: school.trim() || undefined },
        })),

      updateCurrentProject: (text) =>
        set((s) => ({
          profile: { ...s.profile, currentProject: text || undefined },
        })),

      updateCurrentChallenges: (text) =>
        set((s) => ({
          profile: { ...s.profile, currentChallenges: text || undefined },
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
        set((s) => ({ profile: { ...s.profile, ...parsed } }));
        if (parsed.colorTheme) applyColorTheme(parsed.colorTheme);
        return true;
      },

      logOut: () => {
        applyColorTheme(defaultProfile.colorTheme);
        set({ profile: defaultProfile });
      },
    }),
    // skipHydration: persisted state is rehydrated after mount via
    // <StoreHydrator/> so the first client render matches SSR defaults and
    // avoids a hydration mismatch. See store/ui.ts for the full rationale.
    {
      name: "peer-profile",
      skipHydration: true,
      // ABC-freemium 1-14 — the entitlement is server-authoritative and must
      // NOT be written to localStorage; a cached `paid` would survive a
      // downgrade. This is byte-identical to what was persisted before, because
      // `profile` was already the only non-function field in the state.
      partialize: (state) => ({ profile: state.profile }) as ProfileState,
      // v2: colorTheme became a "mode:accent" composite.
      // v3: Events and Jobs gained independent Required/Explore topic fields.
      // v4: work-authorisation countries became a persisted profile signal.
      version: 4,
      migrate: (persisted, version) =>
        migrateProfileStore(persisted, version) as ProfileState,
      // Build the promoted snapshot as part of the state installed by
      // hydration, so subscribers can never observe hydrated pending inputs
      // without the corresponding active inputs.
      merge: mergeHydratedProfileState,
    }
  )
);
