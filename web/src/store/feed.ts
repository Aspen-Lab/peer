"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Paper,
  Event,
  Job,
  ItemFeedback,
  OpportunityFacetCounts,
  UserProfile,
} from "@/types";
// Mock fixtures kept for use in unit tests / Storybook only — never wired
// into the live feed. Pre-2026-04-28 the store used `mockPapers` as a
// fallback when the real API returned 0 results, which silently surfaced
// battery-research demo data as the user's feed. Removed.
import { apiFetch } from "@/lib/api";
import { useProfileStore } from "@/store/profile";
import { scoredItemToPaper } from "@/lib/feed/mapper";
import { feedsUseAi, hasUserLlmOverride } from "@/lib/feed/ai-tier";
import type { FeedResponse } from "@/lib/feed/types";
import type { EventsFeedResponse } from "@/lib/events/types";
import type { JobsFeedResponse } from "@/lib/jobs/types";
import {
  DEFAULT_OPPORTUNITY_TOP_N,
  emptyOpportunityFacetCounts,
} from "@/lib/opportunities/facets";
import {
  feedbackSnapshotForEvent,
  feedbackSnapshotForJob,
  feedbackSnapshotForPaper,
} from "@/lib/preferences/ledger";

// ── Cloud-sync helpers (fire-and-forget) ────────────────────────
// All writes are optimistic: local state already changed before we call
// these. Failures are logged but never block the UI.

type ItemKind = "paper" | "event" | "job";
type CompletionKey = "appliedAt" | "registeredAt" | "submittedAt";

const COMPLETION_KEYS: CompletionKey[] = [
  "appliedAt",
  "registeredAt",
  "submittedAt",
];

function payloadTimestamp(
  payload: unknown,
  key: CompletionKey,
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function withCompletionPayload<T extends object>(
  item: T,
  completion: Partial<Record<CompletionKey, string | undefined>>,
): T {
  const payload = { ...item } as T & Partial<Record<CompletionKey, string>>;
  for (const key of COMPLETION_KEYS) {
    if (!(key in completion)) continue;
    const value = completion[key];
    if (value) payload[key] = value;
    else delete payload[key];
  }
  return payload;
}

function completionMap<TItem extends { id: string }>(
  items: TItem[],
  key: CompletionKey,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const item of items) {
    const timestamp = payloadTimestamp(item, key);
    if (timestamp) entries[item.id] = timestamp;
  }
  return entries;
}

async function cloudSave(itemId: string, itemKind: ItemKind, payload: unknown) {
  try {
    await apiFetch("/api/saved", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, payload }),
    });
  } catch (err) {
    console.warn("[feed] cloudSave failed", err);
  }
}

async function cloudUnsave(itemId: string) {
  try {
    await apiFetch(`/api/saved?itemId=${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("[feed] cloudUnsave failed", err);
  }
}

async function cloudMarkRead(itemId: string) {
  try {
    await apiFetch("/api/read", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
  } catch (err) {
    console.warn("[feed] cloudMarkRead failed", err);
  }
}

async function cloudMarkUnread(itemId: string) {
  try {
    await apiFetch(`/api/read?itemId=${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("[feed] cloudMarkUnread failed", err);
  }
}

async function cloudFeedback(
  itemId: string,
  itemKind: ItemKind,
  feedback: ItemFeedback,
  payload?: unknown,
) {
  try {
    await apiFetch("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, feedback, payload }),
    });
  } catch (err) {
    console.warn("[feed] cloudFeedback failed", err);
  }
}

// Recently-shown tracking.
//
// Rule: a paper that's already been surfaced in this user's feed shouldn't
// re-appear in subsequent loads for a while. We persist a {id -> timestamp}
// map in localStorage (via zustand persist), expire entries after 14 days,
// and pass the active IDs as `excludeIds` to the API. The pipeline filters
// those out AFTER scoring so we always return a full topN of fresh items.
//
// 14 days keeps the next two weeks of daily digests free of repeats while
// still allowing genuinely relevant older papers to surface eventually if
// the user's interests shift.
const RECENTLY_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RECENTLY_SHOWN_CAP = 1000;

function pruneRecentlyShown(
  map: Record<string, number>,
): Record<string, number> {
  const cutoff = Date.now() - RECENTLY_SHOWN_TTL_MS;
  const entries = Object.entries(map).filter(([, ts]) => ts >= cutoff);
  if (entries.length <= RECENTLY_SHOWN_CAP) return Object.fromEntries(entries);
  // Trim oldest first when we're over cap.
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, RECENTLY_SHOWN_CAP));
}

function dismissedOpportunityIds(
  feedbackById: Record<string, ItemFeedback>,
): Set<string> {
  return new Set(
    Object.entries(feedbackById)
      .filter(([, feedback]) => feedback === "notInterested")
      .map(([id]) => id),
  );
}

function activeRecentlyShownIds(map: Record<string, number>): string[] {
  const cutoff = Date.now() - RECENTLY_SHOWN_TTL_MS;
  return Object.entries(map)
    .filter(([, ts]) => ts >= cutoff)
    .map(([id]) => id);
}

const SEED_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // monthly

// Ensure advisor discovery seeds are present and fresh (recomputed at most
// monthly). Returns the seeds to use for this request; persists fresh ones to
// the profile store so the next load reuses them.
async function ensureAdvisorSeeds(
  profile: UserProfile,
): Promise<{ seedTexts: string[]; seedWorkIds: string[] }> {
  const authorId = profile.advisorAuthorId;
  if (!authorId) return { seedTexts: [], seedWorkIds: [] };

  const cachedTexts = profile.advisorSeedTexts ?? [];
  const cachedIds = profile.advisorSeedWorkIds ?? [];
  const refreshedAt = profile.advisorSeedsRefreshedAt
    ? new Date(profile.advisorSeedsRefreshedAt).getTime()
    : 0;
  const fresh = cachedTexts.length > 0 && Date.now() - refreshedAt < SEED_REFRESH_MS;
  if (fresh) return { seedTexts: cachedTexts, seedWorkIds: cachedIds };

  try {
    const params = new URLSearchParams({ authorId });
    const projectText = [profile.currentProject, profile.currentChallenges]
      .filter(Boolean)
      .join("\n");
    if (projectText) params.set("project", projectText);
    const data = await apiFetch<{ workIds?: string[]; texts?: string[] }>(
      `/api/affiliation/seeds?${params}`,
      { cache: "no-store" },
    );
    if (data.texts && data.texts.length > 0) {
      useProfileStore.getState().setAdvisorSeeds({
        workIds: data.workIds ?? [],
        texts: data.texts,
      });
      return { seedTexts: data.texts, seedWorkIds: data.workIds ?? [] };
    }
  } catch {
    // Network/API hiccup — fall back to whatever's cached (possibly empty).
  }
  return { seedTexts: cachedTexts, seedWorkIds: cachedIds };
}

function activeSurfaceTopics(
  profile: UserProfile,
  surface: "papers" | "events" | "jobs",
) {
  const activeTopics = profile.activeSearchInputs?.[surface];
  return {
    topics: (activeTopics?.required ?? []).filter(Boolean),
    softTopics: (activeTopics?.explore ?? []).filter(Boolean),
  };
}

export function activePaperTopicsKey(profile: UserProfile): string {
  return (profile.activeSearchInputs?.papers.required ?? [])
    .map((topic) => topic.trim())
    .filter(Boolean)
    .join("\n");
}

export function paperFeedRequestBody(
  profile: UserProfile,
  advisorSeeds: { seedTexts: string[]; seedWorkIds: string[] },
  aiPaperSearchEnabled = false,
  excludeIds: string[] = [],
): Record<string, unknown> {
  const { topics, softTopics } = activeSurfaceTopics(profile, "papers");
  const seedTexts = [
    profile.currentProject,
    profile.currentChallenges,
    ...advisorSeeds.seedTexts,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));
  const negativeTopics = (profile.dislikedTopics ?? []).filter(
    (s) => s.trim().length > 0,
  );
  const preferenceLedger = profile.preferenceLedger ?? {};
  const tavilyApiKey = profile.tavilyApiKey?.trim();
  const feedAiApiKey = profile.feedAiApiKey?.trim();
  const hasUserLlmOverride =
    aiPaperSearchEnabled &&
    profile.feedAiProvider !== "default" &&
    Boolean(feedAiApiKey);
  const hasLocalDeveloperProvider =
    aiPaperSearchEnabled &&
    process.env.NODE_ENV === "development" &&
    profile.feedAiProvider === "default";

  return {
    topics,
    softTopics: softTopics.length > 0 ? softTopics : undefined,
    methods: profile.preferredMethods,
    // Preferred journals double as a primary source filter (venue search)
    // and earn a relevance boost in the pipeline (see applyJournalBoost).
    venues:
      (profile.preferredJournals ?? []).length > 0
        ? profile.preferredJournals
        : undefined,
    seedTexts: seedTexts.length > 0 ? seedTexts : undefined,
    preferenceLedger:
      Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
    negativeTopics: negativeTopics.length > 0 ? negativeTopics : undefined,
    // Advisor citation-neighborhood discovery (new external work building on
    // the advisor's seeds). Only sent once an advisor has been confirmed.
    affiliation:
      profile.advisorAuthorId && advisorSeeds.seedWorkIds.length > 0
        ? {
            authorId: profile.advisorAuthorId,
            seedWorkIds: advisorSeeds.seedWorkIds,
          }
        : undefined,
    topN: profile.paperCount,
    aiTier: hasUserLlmOverride || hasLocalDeveloperProvider ? 2 : 0,
    searchConnectors: profile.tavilyEnabled
      ? {
          tavily: {
            enabled: true,
            apiKey: tavilyApiKey || undefined,
          },
        }
      : undefined,
    llmOverride: hasUserLlmOverride
      ? {
          provider: profile.feedAiProvider,
          apiKey: feedAiApiKey,
        }
      : undefined,
    controls: {
      focus: profile.feedFocus,
      freshness: profile.feedFreshness,
      paperCount: profile.paperCount,
      sourceMix: profile.feedSourceMix,
      importance: profile.feedImportance,
      methodMode: profile.feedMethodMode,
      discoveryMode: profile.feedDiscoveryMode,
      avoidReviews: profile.feedAvoidReviews,
      avoidOldPapers: profile.feedAvoidOldPapers,
      avoidBroadSurveys: profile.feedAvoidBroadSurveys,
    },
    excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
  };
}

async function fetchRealFeed(
  profile: UserProfile,
  aiPaperSearchEnabled = false,
  excludeIds: string[] = [],
): Promise<Paper[]> {
  const { topics } = activeSurfaceTopics(profile, "papers");
  if (topics.length === 0) return [];

  // Advisor / PI discovery seeds (recomputed monthly). Their text biases TF-IDF
  // scoring; their work IDs anchor the citation-neighborhood pull in the pipeline.
  const advisorSeeds = await ensureAdvisorSeeds(profile);
  try {
    const data = await apiFetch<FeedResponse>("/api/feed", {
      method: "POST",
      body: JSON.stringify(
        paperFeedRequestBody(
          profile,
          advisorSeeds,
          aiPaperSearchEnabled,
          excludeIds,
        ),
      ),
    });
    return data.items.map(scoredItemToPaper);
  } catch (err) {
    console.error("[feed] fetch failed:", err);
    // Rethrow so the papers lane can record it. Returning [] here made a
    // dead connection indistinguishable from "nothing new today".
    throw err;
  }
}

// Shared request-shaping for the jobs/events feeds: both routes take the
// same profile projection.
export function opportunityRequestBody(
  profile: UserProfile,
  surface: "events" | "jobs",
  excludeIds: string[],
): Record<string, unknown> {
  const { topics, softTopics } = activeSurfaceTopics(profile, surface);
  const activeInputs = profile.activeSearchInputs;
  const preferenceLedger = profile.preferenceLedger ?? {};
  const tavilyApiKey = profile.tavilyApiKey?.trim();
  const feedAiApiKey = profile.feedAiApiKey?.trim();
  // RULING 68a: these two reads were inline here and duplicated, in different
  // words, at the dashboard chip — which is how the chip came to claim a tier
  // it does not govern. Same expressions, one home. `hasUserLlmOverride` is
  // still needed separately below because it alone may send an override.
  const userLlmOverride = hasUserLlmOverride(profile);
  return {
    topics,
    softTopics: softTopics.length > 0 ? softTopics : undefined,
    methods: profile.preferredMethods,
    seedTexts: [profile.currentProject, profile.currentChallenges].filter(
      (s): s is string => Boolean(s && s.trim().length > 0),
    ),
    preferenceLedger:
      Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
    careerStage: activeInputs?.careerStage,
    industryVsAcademia: profile.industryVsAcademia,
    locationPreferences: activeInputs?.locationPreferences ?? [],
    ...(surface === "jobs"
      ? { authorisedCountries: profile.authorisedCountries }
      : {}),
    currentProject: profile.currentProject,
    topN: DEFAULT_OPPORTUNITY_TOP_N,
    aiTier: feedsUseAi(profile) ? 2 : 0,
    searchConnectors: profile.tavilyEnabled
      ? { tavily: { enabled: true, apiKey: tavilyApiKey || undefined } }
      : undefined,
    // Bring-your-own job-source keys (ignored by the events route). Adzuna and
    // USAJobs unlock industry + US-federal research postings.
    apiKeys: {
      adzunaAppId: profile.adzunaAppId?.trim() || undefined,
      adzunaAppKey: profile.adzunaAppKey?.trim() || undefined,
      usajobsApiKey: profile.usajobsApiKey?.trim() || undefined,
      usajobsUserAgent: profile.usajobsUserAgent?.trim() || undefined,
    },
    // Unchanged: only the BYOK path may send an override. The local-developer
    // path deliberately sends none and lets the server resolve its own
    // provider, which is what keeps the key server-side.
    llmOverride: userLlmOverride
      ? { provider: profile.feedAiProvider, apiKey: feedAiApiKey }
      : undefined,
    excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
  };
}

async function fetchRealEvents(
  profile: UserProfile,
  excludeIds: string[] = [],
): Promise<OpportunityClientPool<Event>> {
  if (activeSurfaceTopics(profile, "events").topics.length === 0) {
    return emptyOpportunityClientPool<Event>();
  }
  try {
    const res = await fetch("/api/events/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        opportunityRequestBody(profile, "events", excludeIds),
      ),
    });
    if (!res.ok) {
      console.error("[feed] /api/events/feed returned", res.status);
      return emptyOpportunityClientPool<Event>();
    }
    const data = (await res.json()) as EventsFeedResponse;
    return {
      items: data.items ?? [],
      pool: data.pool ?? data.items ?? [],
      facetCounts: data.facetCounts ?? emptyOpportunityFacetCounts(),
    };
  } catch (err) {
    console.error("[feed] events fetch failed:", err);
    return emptyOpportunityClientPool<Event>();
  }
}

async function fetchRealJobs(
  profile: UserProfile,
  excludeIds: string[] = [],
): Promise<OpportunityClientPool<Job>> {
  if (activeSurfaceTopics(profile, "jobs").topics.length === 0) {
    return emptyOpportunityClientPool<Job>();
  }
  try {
    const res = await fetch("/api/jobs/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opportunityRequestBody(profile, "jobs", excludeIds)),
    });
    if (!res.ok) {
      console.error("[feed] /api/jobs/feed returned", res.status);
      return emptyOpportunityClientPool<Job>();
    }
    const data = (await res.json()) as JobsFeedResponse;
    return {
      items: data.items ?? [],
      pool: data.pool ?? data.items ?? [],
      facetCounts: data.facetCounts ?? emptyOpportunityFacetCounts(),
    };
  } catch (err) {
    console.error("[feed] jobs fetch failed:", err);
    return emptyOpportunityClientPool<Job>();
  }
}

interface OpportunityClientPool<TItem> {
  items: TItem[];
  pool: TItem[];
  facetCounts: OpportunityFacetCounts;
}

function emptyOpportunityClientPool<TItem>(): OpportunityClientPool<TItem> {
  return {
    items: [],
    pool: [],
    facetCounts: emptyOpportunityFacetCounts(),
  };
}

type DismissalKind = "paper" | "event" | "job";

interface PendingDismissal {
  id: string;
  kind: DismissalKind;
  item: Paper | Event | Job;
  previousFeedback?: ItemFeedback;
  wasInDisplay: boolean;
  wasInPool: boolean;
  wasSaved: boolean;
  expiresAt: number;
}

function restoreByScore<TItem extends { id: string; relevanceScore?: number }>(
  items: TItem[],
  item: TItem,
  shouldRestore: boolean,
): TItem[] {
  if (!shouldRestore || items.some((candidate) => candidate.id === item.id)) {
    return items;
  }
  return [item, ...items].sort(
    (left, right) =>
      (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0),
  );
}

function syncSavedState<
  TItem extends { id: string; isSaved?: boolean; feedback?: ItemFeedback },
>(
  items: TItem[],
  savedIds: Set<string>,
  feedbackById: Record<string, ItemFeedback>,
): TItem[] {
  return items.map((item) => {
    const isSaved = savedIds.has(item.id);
    const currentFeedback = feedbackById[item.id] ?? item.feedback;
    return {
      ...item,
      isSaved,
      feedback: isSaved
        ? currentFeedback ?? ("saved" as ItemFeedback)
        : currentFeedback === "saved"
          ? undefined
          : currentFeedback,
    };
  });
}

export type FeedLane = "papers" | "events" | "jobs";

export interface FeedLoadOptions {
  /**
   * Advance novelty only for an explicit refresh/load-more action. A plain
   * page open reads a feed without mutating the recently-shown clock.
   */
  advanceHistory?: boolean;
  /**
   * Which pipelines to run. The daily surface asks for `["papers"]` only:
   * events and jobs are once-a-year needs and used to run on every home-page
   * tick, taxing the latency of the one lane that is checked every morning.
   * Omitted means all three, so existing callers keep their behaviour.
   */
  lanes?: FeedLane[];
}

interface FeedState {
  papers: Paper[];
  events: Event[];
  jobs: Job[];
  /** Full daily pools power facets without expanding the default feed slice. */
  eventPool: Event[];
  jobPool: Job[];
  eventFacetCounts: OpportunityFacetCounts;
  jobFacetCounts: OpportunityFacetCounts;
  savedPapers: Paper[];
  savedEvents: Event[];
  savedJobs: Job[];
  isLoading: boolean;
  /** Per-lane flags let papers render (and the digest start) without waiting
   * for the slower standing-opportunity lanes. */
  papersLoading: boolean;
  eventsLoading: boolean;
  jobsLoading: boolean;
  lastRefresh: string | null;
  /**
   * Why the last paper load produced nothing, when it failed rather than
   * came back empty. A network failure and a genuinely empty result used to
   * be the same `[]` — the UI then told a user with a dead connection to
   * "set up your profile", under a header reading "synced just now".
   * Transient: not persisted.
   */
  feedError: string | null;
  /** The required-topics signature the current `papers` were built from. When
   *  it diverges from the profile's topics, the feed page reloads automatically. */
  feedTopicsKey: string | null;
  aiPaperSearchEnabled: boolean;
  readItems: Record<string, true>;
  appliedAt: Record<string, string>;
  registeredAt: Record<string, string>;
  submittedAt: Record<string, string>;
  paperSummaries: Record<string, string>;
  /** id -> ms timestamp. Drives the "don't repeat papers" exclude list. */
  recentlyShownIds: Record<string, number>;
  pendingDismissal: PendingDismissal | null;
  /** id -> feedback. Tracks save/like/dismiss state for any paper the user
   * has interacted with, even ones not in the current feed (e.g. searched). */
  paperFeedback: Record<string, ItemFeedback>;
  /** id -> feedback for events the user has interacted with. */
  eventFeedback: Record<string, ItemFeedback>;
  /** id -> feedback for jobs the user has interacted with. */
  jobFeedback: Record<string, ItemFeedback>;

  loadFeed: (options?: FeedLoadOptions) => Promise<void>;
  setAiPaperSearchEnabled: (enabled: boolean) => Promise<void>;
  setPaperSummaries: (
    bullets: { paperId: string; text: string }[],
  ) => void;
  savePaper: (paper: Paper) => void;
  notInterestedPaper: (paper: Paper) => void;
  moreLikePaper: (paper: Paper) => void;
  saveEvent: (event: Event) => void;
  notInterestedEvent: (event: Event) => void;
  moreLikeEvent: (event: Event) => void;
  saveJob: (job: Job) => void;
  notInterestedJob: (job: Job) => void;
  moreLikeJob: (job: Job) => void;
  unsavePaper: (id: string) => void;
  unsaveEvent: (id: string) => void;
  unsaveJob: (id: string) => void;
  submitFeedback: (
    itemId: string,
    type: string,
    feedback: ItemFeedback,
    payload?: unknown,
  ) => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  setJobApplied: (job: Job, applied: boolean, at?: string) => void;
  setEventRegistered: (
    event: Event,
    registered: boolean,
    at?: string,
  ) => void;
  setEventSubmitted: (event: Event, submitted: boolean, at?: string) => void;
  undoDismiss: () => void;
  commitDismiss: () => void;
  /**
   * Replace saved lists and readItems with a server snapshot. Called by
   * FeedSync on login. Local-only changes that haven't been flushed yet
   * are merged in (see FeedSync for the merge pass).
   */
  hydrateFromRemote: (remote: {
    savedPapers?: Paper[];
    savedEvents?: Event[];
    savedJobs?: Job[];
    readItems?: Record<string, true>;
  }) => void;
  /** Reset local state — called on sign-out so the next user starts clean. */
  resetLocal: () => void;
}

// Monotonic token so overlapping loadFeed calls (refresh + topics auto-load +
// AI-toggle) can't interleave: only the newest request commits its result.
let feedLoadSeq = 0;

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      papers: [],
      events: [],
      jobs: [],
      eventPool: [],
      jobPool: [],
      eventFacetCounts: emptyOpportunityFacetCounts(),
      jobFacetCounts: emptyOpportunityFacetCounts(),
      savedPapers: [],
      savedEvents: [],
      savedJobs: [],
      isLoading: false,
      papersLoading: false,
      eventsLoading: false,
      jobsLoading: false,
      lastRefresh: null,
      feedTopicsKey: null,
      aiPaperSearchEnabled: false,
      readItems: {},
      appliedAt: {},
      registeredAt: {},
      submittedAt: {},
      paperSummaries: {},
      recentlyShownIds: {},
      pendingDismissal: null,
      feedError: null,
      paperFeedback: {},
      eventFeedback: {},
      jobFeedback: {},

      loadFeed: async (options) => {
        const requestId = ++feedLoadSeq;
        const advanceHistory = options?.advanceHistory === true;
        // Papers only by default. Events and jobs are no longer product surfaces;
        // their lanes stay callable for now but nothing asks for them.
        const lanes = options?.lanes ?? ["papers"];
        const wantsPapers = lanes.includes("papers");
        const wantsEvents = lanes.includes("events");
        const wantsJobs = lanes.includes("jobs");
        set({
          isLoading: true,
          papersLoading: wantsPapers,
          eventsLoading: wantsEvents,
          jobsLoading: wantsJobs,
          ...(wantsPapers ? { feedError: null } : {}),
        });
        const {
          papers: displayedPapers,
          savedPapers,
          recentlyShownIds,
          eventFeedback,
          jobFeedback,
        } = get();
        const savedIds = new Set(savedPapers.map((p) => p.id));
        const aiPaperSearchEnabled = get().aiPaperSearchEnabled;
        const profile = useProfileStore.getState().profile;
        // Signature of the required topics this load is built from — must match
        // the feed page's auto-load key so the page knows the feed is current.
        const topicsKey = activePaperTopicsKey(profile);

        // Papers are consume-once: exclude any already shown recently (within
        // TTL) so the briefing brings fresh reading each load. Saved papers are
        // allowed back — the user bookmarked them.
        const paperExcludeIds = Array.from(
          new Set([
            ...activeRecentlyShownIds(recentlyShownIds),
            ...(advanceHistory
              ? displayedPapers.map((paper) => paper.id)
              : []),
          ]),
        ).filter((id) => !savedIds.has(id));

        // Events and jobs are STANDING opportunities, not consume-once items: a
        // conference is relevant every day until its deadline passes, so it
        // should keep surfacing rather than being suppressed after one view.
        // Exclude only the ones the user explicitly dismissed so dismissals
        // stick without starving either small opportunity pool.
        const dismissedEventIds = Array.from(
          dismissedOpportunityIds(eventFeedback),
        );
        const dismissedJobIds = Array.from(
          dismissedOpportunityIds(jobFeedback),
        );

        // Start all three pipelines together, but let each lane publish as
        // soon as it settles. allSettled below coordinates only the shared
        // refresh lifecycle; it is not a render barrier. Each helper degrades
        // to an empty pool on failure so one surface never blanks the others.
        const papersLane = (async () => {
          if (!wantsPapers) return;
          try {
            const realPapers = await fetchRealFeed(
              profile,
              aiPaperSearchEnabled,
              paperExcludeIds,
            );
            // A newer load started while this lane was in flight — drop it.
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedPapers.map((paper) => paper.id),
              );
              const papers = realPapers.map((paper) =>
                currentSavedIds.has(paper.id)
                  ? {
                      ...paper,
                      isSaved: true,
                      feedback:
                        state.paperFeedback[paper.id] ??
                        ("saved" as ItemFeedback),
                    }
                  : {
                      ...paper,
                      feedback:
                        state.paperFeedback[paper.id] ?? paper.feedback,
                    },
              );

              const paperUpdate: Partial<FeedState> = {
                papers,
                papersLoading: false,
                feedTopicsKey: topicsKey,
              };
              if (advanceHistory) {
                // Record shown PAPERS so the next load skips them, but only
                // for deliberate refresh/load-more actions. Opening today's
                // feed must not extend timestamps or change the next cached
                // briefing's exclusion set. Events/jobs are deliberately NOT
                // recorded — they're standing opportunities that should keep
                // appearing until their deadline passes or the user acts.
                const now = Date.now();
                const nextShown: Record<string, number> = {
                  ...state.recentlyShownIds,
                };
                for (const paper of [...state.papers, ...papers]) {
                  nextShown[paper.id] = now;
                }
                paperUpdate.recentlyShownIds = pruneRecentlyShown(nextShown);
              }
              return paperUpdate;
            });
          } catch (err) {
            if (requestId === feedLoadSeq) {
              set({
                feedError: err instanceof Error ? err.message : String(err),
              });
            }
          } finally {
            // Never let a stale lane clear a newer load's progress flag.
            if (requestId === feedLoadSeq && get().papersLoading) {
              set({ papersLoading: false });
            }
          }
        })();

        const eventsLane = (async () => {
          if (!wantsEvents) return;
          try {
            const realEvents = await fetchRealEvents(profile, dismissedEventIds);
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedEvents.map((event) => event.id),
              );
              // Re-read dismissals from the latest state, not the snapshot the
              // request was built from: the user may have dismissed something
              // while this lane was in flight, and a stale response must not
              // resurrect it.
              const currentDismissedIds = dismissedOpportunityIds(
                state.eventFeedback,
              );
              const decorate = (event: Event): Event => ({
                ...event,
                isSaved: currentSavedIds.has(event.id),
                feedback:
                  state.eventFeedback[event.id] ??
                  (currentSavedIds.has(event.id)
                    ? ("saved" as ItemFeedback)
                    : undefined),
              });
              const keep = (event: Event) => !currentDismissedIds.has(event.id);
              return {
                events: realEvents.items.filter(keep).map(decorate),
                eventPool: realEvents.pool.filter(keep).map(decorate),
                eventFacetCounts: realEvents.facetCounts,
                eventsLoading: false,
              };
            });
          } finally {
            if (requestId === feedLoadSeq && get().eventsLoading) {
              set({ eventsLoading: false });
            }
          }
        })();

        const jobsLane = (async () => {
          if (!wantsJobs) return;
          try {
            const realJobs = await fetchRealJobs(profile, dismissedJobIds);
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedJobs.map((job) => job.id),
              );
              const currentDismissedIds = dismissedOpportunityIds(
                state.jobFeedback,
              );
              const decorate = (job: Job): Job => ({
                ...job,
                isSaved: currentSavedIds.has(job.id),
                feedback:
                  state.jobFeedback[job.id] ??
                  (currentSavedIds.has(job.id)
                    ? ("saved" as ItemFeedback)
                    : undefined),
              });
              const keep = (job: Job) => !currentDismissedIds.has(job.id);
              return {
                jobs: realJobs.items.filter(keep).map(decorate),
                jobPool: realJobs.pool.filter(keep).map(decorate),
                jobFacetCounts: realJobs.facetCounts,
                jobsLoading: false,
              };
            });
          } finally {
            if (requestId === feedLoadSeq && get().jobsLoading) {
              set({ jobsLoading: false });
            }
          }
        })();

        await Promise.allSettled([papersLane, eventsLane, jobsLane]);
        if (requestId !== feedLoadSeq) return;
        set({
          isLoading: false,
          papersLoading: false,
          eventsLoading: false,
          jobsLoading: false,
          // A failed paper load is not a sync; keep the previous stamp so the
          // header cannot read "synced just now" over an error.
          lastRefresh: get().feedError ? get().lastRefresh : new Date().toISOString(),
        });
      },

      setAiPaperSearchEnabled: async (enabled) => {
        set({ aiPaperSearchEnabled: enabled });
        await get().loadFeed({ advanceHistory: true });
      },

      setPaperSummaries: (bullets) => {
        set((state) => ({
          paperSummaries: {
            ...state.paperSummaries,
            ...Object.fromEntries(
              bullets.map(({ paperId, text }) => [paperId, text]),
            ),
          },
        }));
      },

      savePaper: (paper) => {
        const alreadySaved = get().savedPapers.some((p) => p.id === paper.id);
        const previousFeedback = get().paperFeedback[paper.id] ?? paper.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = { ...paper, isSaved: true, feedback: savedFeedback };
        set((s) => ({
          papers: s.papers.map((p) =>
            p.id === paper.id ? saved : p
          ),
          savedPapers: s.savedPapers.some((p) => p.id === paper.id)
            ? s.savedPapers.map((p) => (p.id === paper.id ? saved : p))
            : [saved, ...s.savedPapers],
          paperFeedback: { ...s.paperFeedback, [paper.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordPaperPreference(saved, "positive");
        }
        cloudSave(paper.id, "paper", saved);
        get().submitFeedback(
          paper.id,
          "paper",
          "saved",
          feedbackSnapshotForPaper(saved),
        );
      },

      notInterestedPaper: (paper) => {
        // Commit any previous pending dismissal before starting a new one.
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().paperFeedback[paper.id] ?? paper.feedback;

        set((s) => ({
          papers: s.papers.filter((p) => p.id !== paper.id),
          savedPapers: s.savedPapers.filter((p) => p.id !== paper.id),
          paperFeedback: { ...s.paperFeedback, [paper.id]: "notInterested" },
          pendingDismissal: {
            id: paper.id,
            kind: "paper",
            item: paper,
            previousFeedback,
            wasInDisplay: s.papers.some((item) => item.id === paper.id),
            wasInPool: false,
            wasSaved: s.savedPapers.some((item) => item.id === paper.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikePaper: (paper) => {
        const previous = get().paperFeedback[paper.id] ?? paper.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          papers: s.papers.map((p) =>
            p.id === paper.id ? { ...p, feedback: "moreLikeThis" as ItemFeedback } : p
          ),
          savedPapers: s.savedPapers.map((p) =>
            p.id === paper.id
              ? { ...p, feedback: "moreLikeThis" as ItemFeedback }
              : p,
          ),
          paperFeedback: { ...s.paperFeedback, [paper.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordPaperPreference(paper, "positive");
        }
        get().submitFeedback(
          paper.id,
          "paper",
          "moreLikeThis",
          feedbackSnapshotForPaper(paper),
        );
      },

      saveEvent: (event) => {
        const alreadySaved = get().savedEvents.some((e) => e.id === event.id);
        const previousFeedback = get().eventFeedback[event.id] ?? event.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = withCompletionPayload(
          { ...event, isSaved: true, feedback: savedFeedback },
          {
            registeredAt: get().registeredAt[event.id],
            submittedAt: get().submittedAt[event.id],
          },
        );
        set((s) => ({
          events: s.events.map((e) => (e.id === event.id ? saved : e)),
          eventPool: s.eventPool.map((e) =>
            e.id === event.id ? saved : e,
          ),
          savedEvents: alreadySaved
            ? s.savedEvents.map((e) => (e.id === event.id ? saved : e))
            : [saved, ...s.savedEvents],
          eventFeedback: { ...s.eventFeedback, [event.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordEventPreference(saved, "positive");
        }
        cloudSave(event.id, "event", saved);
        get().submitFeedback(
          event.id,
          "event",
          "saved",
          feedbackSnapshotForEvent(saved),
        );
      },

      notInterestedEvent: (event) => {
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().eventFeedback[event.id] ?? event.feedback;

        set((s) => ({
          events: s.events.filter((e) => e.id !== event.id),
          eventPool: s.eventPool.filter((e) => e.id !== event.id),
          savedEvents: s.savedEvents.filter((e) => e.id !== event.id),
          eventFeedback: { ...s.eventFeedback, [event.id]: "notInterested" },
          pendingDismissal: {
            id: event.id,
            kind: "event",
            item: withCompletionPayload(event, {
              registeredAt: s.registeredAt[event.id],
              submittedAt: s.submittedAt[event.id],
            }),
            previousFeedback,
            wasInDisplay: s.events.some((item) => item.id === event.id),
            wasInPool: s.eventPool.some((item) => item.id === event.id),
            wasSaved: s.savedEvents.some((item) => item.id === event.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikeEvent: (event) => {
        const previous = get().eventFeedback[event.id] ?? event.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          events: s.events.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          savedEvents: s.savedEvents.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          eventPool: s.eventPool.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          eventFeedback: { ...s.eventFeedback, [event.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordEventPreference(event, "positive");
        }
        get().submitFeedback(
          event.id,
          "event",
          "moreLikeThis",
          feedbackSnapshotForEvent(event),
        );
      },

      saveJob: (job) => {
        const alreadySaved = get().savedJobs.some((j) => j.id === job.id);
        const previousFeedback = get().jobFeedback[job.id] ?? job.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = withCompletionPayload(
          { ...job, isSaved: true, feedback: savedFeedback },
          { appliedAt: get().appliedAt[job.id] },
        );
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === job.id ? saved : j)),
          jobPool: s.jobPool.map((j) => (j.id === job.id ? saved : j)),
          savedJobs: alreadySaved
            ? s.savedJobs.map((j) => (j.id === job.id ? saved : j))
            : [saved, ...s.savedJobs],
          jobFeedback: { ...s.jobFeedback, [job.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordJobPreference(saved, "positive");
        }
        cloudSave(job.id, "job", saved);
        get().submitFeedback(job.id, "job", "saved", feedbackSnapshotForJob(saved));
      },

      notInterestedJob: (job) => {
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().jobFeedback[job.id] ?? job.feedback;

        set((s) => ({
          jobs: s.jobs.filter((j) => j.id !== job.id),
          jobPool: s.jobPool.filter((j) => j.id !== job.id),
          savedJobs: s.savedJobs.filter((j) => j.id !== job.id),
          jobFeedback: { ...s.jobFeedback, [job.id]: "notInterested" },
          pendingDismissal: {
            id: job.id,
            kind: "job",
            item: withCompletionPayload(job, {
              appliedAt: s.appliedAt[job.id],
            }),
            previousFeedback,
            wasInDisplay: s.jobs.some((item) => item.id === job.id),
            wasInPool: s.jobPool.some((item) => item.id === job.id),
            wasSaved: s.savedJobs.some((item) => item.id === job.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikeJob: (job) => {
        const previous = get().jobFeedback[job.id] ?? job.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          jobPool: s.jobPool.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          savedJobs: s.savedJobs.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          jobFeedback: { ...s.jobFeedback, [job.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordJobPreference(job, "positive");
        }
        get().submitFeedback(
          job.id,
          "job",
          "moreLikeThis",
          feedbackSnapshotForJob(job),
        );
      },

      unsavePaper: (id) => {
        set((s) => {
          const nextFeedback = { ...s.paperFeedback };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          return {
            papers: s.papers.map((p) =>
              p.id === id
                ? {
                    ...p,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : p
            ),
            savedPapers: s.savedPapers.filter((p) => p.id !== id),
            paperFeedback: nextFeedback,
          };
        });
        cloudUnsave(id);
      },

      unsaveEvent: (id) => {
        set((s) => {
          const nextFeedback = { ...s.eventFeedback };
          const nextRegisteredAt = { ...s.registeredAt };
          const nextSubmittedAt = { ...s.submittedAt };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          delete nextRegisteredAt[id];
          delete nextSubmittedAt[id];
          return {
            events: s.events.map((e) =>
              e.id === id
                ? {
                    ...e,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : e,
            ),
            eventPool: s.eventPool.map((e) =>
              e.id === id
                ? {
                    ...e,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved"
                        ? undefined
                        : currentFeedback,
                  }
                : e,
            ),
            savedEvents: s.savedEvents.filter((e) => e.id !== id),
            eventFeedback: nextFeedback,
            registeredAt: nextRegisteredAt,
            submittedAt: nextSubmittedAt,
          };
        });
        cloudUnsave(id);
      },

      unsaveJob: (id) => {
        set((s) => {
          const nextFeedback = { ...s.jobFeedback };
          const nextAppliedAt = { ...s.appliedAt };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          delete nextAppliedAt[id];
          return {
            jobs: s.jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : j,
            ),
            jobPool: s.jobPool.map((j) =>
              j.id === id
                ? {
                    ...j,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved"
                        ? undefined
                        : currentFeedback,
                  }
                : j,
            ),
            savedJobs: s.savedJobs.filter((j) => j.id !== id),
            jobFeedback: nextFeedback,
            appliedAt: nextAppliedAt,
          };
        });
        cloudUnsave(id);
      },

      submitFeedback: (itemId, type, feedback, payload) => {
        console.log(`[Peer] Feedback: ${type} ${itemId} → ${feedback}`);
        const kind =
          type === "paper" || type === "event" || type === "job"
            ? (type as ItemKind)
            : null;
        if (kind) cloudFeedback(itemId, kind, feedback, payload);
      },

      markRead: (id) => {
        set((s) =>
          s.readItems[id] ? s : { readItems: { ...s.readItems, [id]: true } },
        );
        cloudMarkRead(id);
      },

      markUnread: (id) => {
        set((s) => {
          if (!s.readItems[id]) return s;
          const next = { ...s.readItems };
          delete next[id];
          return { readItems: next };
        });
        cloudMarkUnread(id);
      },

      setJobApplied: (job, applied, at) => {
        const timestamp = applied
          ? get().appliedAt[job.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextAppliedAt = { ...s.appliedAt };
          if (timestamp) nextAppliedAt[job.id] = timestamp;
          else delete nextAppliedAt[job.id];
          return {
            appliedAt: nextAppliedAt,
            savedJobs: s.savedJobs.map((savedJob) =>
              savedJob.id === job.id
                ? withCompletionPayload(savedJob, { appliedAt: timestamp })
                : savedJob,
            ),
          };
        });

        const saved = get().savedJobs.find(({ id }) => id === job.id);
        if (saved) cloudSave(job.id, "job", saved);
        else if (applied) get().saveJob(job);
      },

      setEventRegistered: (event, registered, at) => {
        const timestamp = registered
          ? get().registeredAt[event.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextRegisteredAt = { ...s.registeredAt };
          if (timestamp) nextRegisteredAt[event.id] = timestamp;
          else delete nextRegisteredAt[event.id];
          return {
            registeredAt: nextRegisteredAt,
            savedEvents: s.savedEvents.map((savedEvent) =>
              savedEvent.id === event.id
                ? withCompletionPayload(savedEvent, {
                    registeredAt: timestamp,
                  })
                : savedEvent,
            ),
          };
        });

        const saved = get().savedEvents.find(({ id }) => id === event.id);
        if (saved) cloudSave(event.id, "event", saved);
        else if (registered) get().saveEvent(event);
      },

      setEventSubmitted: (event, submitted, at) => {
        const timestamp = submitted
          ? get().submittedAt[event.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextSubmittedAt = { ...s.submittedAt };
          if (timestamp) nextSubmittedAt[event.id] = timestamp;
          else delete nextSubmittedAt[event.id];
          return {
            submittedAt: nextSubmittedAt,
            savedEvents: s.savedEvents.map((savedEvent) =>
              savedEvent.id === event.id
                ? withCompletionPayload(savedEvent, {
                    submittedAt: timestamp,
                  })
                : savedEvent,
            ),
          };
        });

        const saved = get().savedEvents.find(({ id }) => id === event.id);
        if (saved) cloudSave(event.id, "event", saved);
        else if (submitted) get().saveEvent(event);
      },

      undoDismiss: () => {
        const pending = get().pendingDismissal;
        if (!pending) return;
        set((s) => {
          if (pending.kind === "paper") {
            const paper = pending.item as Paper;
            const nextFeedback = { ...s.paperFeedback };
            if (pending.previousFeedback) {
              nextFeedback[pending.id] = pending.previousFeedback;
            } else {
              delete nextFeedback[pending.id];
            }
            return {
              papers: restoreByScore(
                s.papers,
                paper,
                pending.wasInDisplay,
              ),
              savedPapers: restoreByScore(
                s.savedPapers,
                paper,
                pending.wasSaved,
              ),
              paperFeedback: nextFeedback,
              pendingDismissal: null,
            };
          }
          if (pending.kind === "event") {
            const event = pending.item as Event;
            const nextEventFeedback = { ...s.eventFeedback };
            if (pending.previousFeedback) {
              nextEventFeedback[pending.id] = pending.previousFeedback;
            } else {
              delete nextEventFeedback[pending.id];
            }
            return {
              events: restoreByScore(
                s.events,
                event,
                pending.wasInDisplay,
              ),
              eventPool: restoreByScore(
                s.eventPool,
                event,
                pending.wasInPool,
              ),
              savedEvents: restoreByScore(
                s.savedEvents,
                event,
                pending.wasSaved,
              ),
              eventFeedback: nextEventFeedback,
              pendingDismissal: null,
            };
          }
          const job = pending.item as Job;
          const nextJobFeedback = { ...s.jobFeedback };
          if (pending.previousFeedback) {
            nextJobFeedback[pending.id] = pending.previousFeedback;
          } else {
            delete nextJobFeedback[pending.id];
          }
          return {
            jobs: restoreByScore(
              s.jobs,
              job,
              pending.wasInDisplay,
            ),
            jobPool: restoreByScore(
              s.jobPool,
              job,
              pending.wasInPool,
            ),
            savedJobs: restoreByScore(
              s.savedJobs,
              job,
              pending.wasSaved,
            ),
            jobFeedback: nextJobFeedback,
            pendingDismissal: null,
          };
        });
      },

      commitDismiss: () => {
        const pending = get().pendingDismissal;
        if (!pending) return;
        if (pending.kind === "paper") {
          const paper = pending.item as Paper;
          useProfileStore.getState().recordPaperPreference(paper, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForPaper(paper),
          );
        } else if (pending.kind === "event") {
          const event = pending.item as Event;
          useProfileStore.getState().recordEventPreference(event, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForEvent(event),
          );
        } else {
          const job = pending.item as Job;
          useProfileStore.getState().recordJobPreference(job, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForJob(job),
          );
        }
        if (pending.wasSaved) cloudUnsave(pending.id);
        set((s) => {
          if (pending.kind === "event") {
            const nextRegisteredAt = { ...s.registeredAt };
            const nextSubmittedAt = { ...s.submittedAt };
            delete nextRegisteredAt[pending.id];
            delete nextSubmittedAt[pending.id];
            return {
              registeredAt: nextRegisteredAt,
              submittedAt: nextSubmittedAt,
              pendingDismissal: null,
            };
          }
          if (pending.kind === "job") {
            const nextAppliedAt = { ...s.appliedAt };
            delete nextAppliedAt[pending.id];
            return {
              appliedAt: nextAppliedAt,
              pendingDismissal: null,
            };
          }
          return { pendingDismissal: null };
        });
      },

      hydrateFromRemote: (remote) => {
        set((s) => {
          const nextSavedPapers = remote.savedPapers ?? s.savedPapers;
          const nextSavedEvents = remote.savedEvents ?? s.savedEvents;
          const nextSavedJobs = remote.savedJobs ?? s.savedJobs;
          const savedPaperIds = new Set(
            nextSavedPapers.map((paper) => paper.id),
          );
          const savedEventIds = new Set(
            nextSavedEvents.map((event) => event.id),
          );
          const savedJobIds = new Set(nextSavedJobs.map((job) => job.id));
          const nextPaperFeedback = { ...s.paperFeedback };
          const nextEventFeedback = { ...s.eventFeedback };
          const nextJobFeedback = { ...s.jobFeedback };

          for (const [id, feedback] of Object.entries(nextPaperFeedback)) {
            if (feedback === "saved" && !savedPaperIds.has(id)) {
              delete nextPaperFeedback[id];
            }
          }
          for (const [id, feedback] of Object.entries(nextEventFeedback)) {
            if (feedback === "saved" && !savedEventIds.has(id)) {
              delete nextEventFeedback[id];
            }
          }
          for (const [id, feedback] of Object.entries(nextJobFeedback)) {
            if (feedback === "saved" && !savedJobIds.has(id)) {
              delete nextJobFeedback[id];
            }
          }

          return {
            papers: syncSavedState(
              s.papers,
              savedPaperIds,
              nextPaperFeedback,
            ),
            events: syncSavedState(
              s.events,
              savedEventIds,
              nextEventFeedback,
            ),
            eventPool: syncSavedState(
              s.eventPool,
              savedEventIds,
              nextEventFeedback,
            ),
            jobs: syncSavedState(s.jobs, savedJobIds, nextJobFeedback),
            jobPool: syncSavedState(
              s.jobPool,
              savedJobIds,
              nextJobFeedback,
            ),
            savedPapers: syncSavedState(
              nextSavedPapers,
              savedPaperIds,
              nextPaperFeedback,
            ),
            savedEvents: syncSavedState(
              nextSavedEvents,
              savedEventIds,
              nextEventFeedback,
            ),
            savedJobs: syncSavedState(
              nextSavedJobs,
              savedJobIds,
              nextJobFeedback,
            ),
            paperFeedback: nextPaperFeedback,
            eventFeedback: nextEventFeedback,
            jobFeedback: nextJobFeedback,
            readItems: remote.readItems ?? s.readItems,
            appliedAt:
              remote.savedJobs === undefined
                ? s.appliedAt
                : completionMap(nextSavedJobs, "appliedAt"),
            registeredAt:
              remote.savedEvents === undefined
                ? s.registeredAt
                : completionMap(nextSavedEvents, "registeredAt"),
            submittedAt:
              remote.savedEvents === undefined
                ? s.submittedAt
                : completionMap(nextSavedEvents, "submittedAt"),
          };
        });
      },

      resetLocal: () => {
        feedLoadSeq += 1;
        set({
          papers: [],
          events: [],
          jobs: [],
          eventPool: [],
          jobPool: [],
          eventFacetCounts: emptyOpportunityFacetCounts(),
          jobFacetCounts: emptyOpportunityFacetCounts(),
          isLoading: false,
          lastRefresh: null,
          feedTopicsKey: null,
          savedPapers: [],
          savedEvents: [],
          savedJobs: [],
          readItems: {},
          appliedAt: {},
          registeredAt: {},
          submittedAt: {},
          paperSummaries: {},
          recentlyShownIds: {},
          pendingDismissal: null,
          paperFeedback: {},
          eventFeedback: {},
          jobFeedback: {},
          aiPaperSearchEnabled: false,
        });
      },
    }),
    {
      name: "peer-feed",
      version: 1,
      // skipHydration: rehydrated after mount via <StoreHydrator/> so the
      // first client render matches SSR defaults (empty feed / no saves) and
      // doesn't mismatch the server markup. See store/ui.ts for rationale.
      skipHydration: true,
      partialize: (state) => ({
        savedPapers: state.savedPapers,
        savedEvents: state.savedEvents,
        savedJobs: state.savedJobs,
        readItems: state.readItems,
        appliedAt: state.appliedAt,
        registeredAt: state.registeredAt,
        submittedAt: state.submittedAt,
        paperSummaries: state.paperSummaries,
        aiPaperSearchEnabled: state.aiPaperSearchEnabled,
        recentlyShownIds: state.recentlyShownIds,
        paperFeedback: state.paperFeedback,
        eventFeedback: state.eventFeedback,
        jobFeedback: state.jobFeedback,
      }),
      migrate: (persistedState, version) => {
        const persisted = persistedState as Partial<FeedState> & {
          oppFeedback?: Record<string, ItemFeedback>;
        };
        if (version >= 1 || !persisted.oppFeedback) return persisted as FeedState;

        const { oppFeedback, ...current } = persisted;
        return {
          ...current,
          // Older builds shared one source-namespaced map. Copying it into
          // both typed maps preserves every dismissal without guessing an
          // adapter's id prefix; ids cannot collide across opportunity kinds.
          eventFeedback: { ...oppFeedback, ...current.eventFeedback },
          jobFeedback: { ...oppFeedback, ...current.jobFeedback },
        } as FeedState;
      },
    }
  )
);
