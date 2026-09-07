"use client";

import { useEffect, useState, useMemo, useCallback, useRef, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  Paper,
  Event,
  Job,
  OpportunityFacetSelection,
} from "@/types";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { aiModeChip, feedsUseAi } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import { apiFetch } from "@/lib/api";
import { formatTimeAgo } from "@/lib/format";
import { DotMatrixImage } from "@/components/dot-matrix-image";
import { useProfileStore } from "@/store/profile";
import { SearchResultCard } from "@/components/cards/search-result-card";
import { FeedTile } from "@/components/cards/feed-tile";
import { EventCard } from "@/components/cards/event-card";
import { JobCard } from "@/components/cards/job-card";
import { FeedMoreTile } from "@/components/cards/feed-more-tile";
import { PaperDigestLoader } from "@/components/digest/daily-digest";
import { SectionHeading, EmptyState, LoadingSkeleton } from "@/components/ui";
import { ConnectorPanel, connectedCount } from "@/components/profile/connector-panel";
import { SurfaceTopicsPanel } from "@/components/profile/surface-topics-panel";
import { FilterBar } from "@/components/search/filter-bar";
import {
  DEFAULT_FILTERS,
  filtersFromUrlParams,
  filtersToApiQuery,
  filtersToUrlParams,
  type Filters,
} from "@/lib/search/filters";
import { AiKeyFields, providerShortLabel } from "@/components/profile/ai-setup";
import { OnboardingTour } from "@/components/onboarding-tour";
import { iconButtonVariants } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import {
  JobFacetPanel,
  OpportunityFacetPanel,
} from "@/components/opportunities/opportunity-facet-panel";
import { OpportunityShowMore } from "@/components/opportunities/opportunity-show-more";
import {
  countJobFacets,
  DEFAULT_JOB_FACET_SELECTION,
  filterOpportunitiesByFacets,
  filterJobsByFacets,
  hasActiveJobFacets,
  hasActiveOpportunityFacets,
  mergeOpportunityFacetCounts,
  OPPORTUNITY_MIN_SCORE,
  type JobFacetSelection,
} from "@/lib/opportunities/facets";
import {
  nextOpportunityPageSize,
  OPPORTUNITY_PAGE_SIZE,
  paginateOpportunities,
} from "@/lib/opportunities/pagination";
import {
  filterEventsByOpportunityQuery,
  filterJobsByOpportunityQuery,
  shouldSearchOpportunities,
  shouldSearchPapers,
} from "@/lib/opportunities/search";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { DeadlinesBoard } from "@/components/dashboard/deadlines-board";
import {
  aggregateActivity,
  appendActivity,
  buildActivitySnapshot,
  type ActivityAggregate,
} from "@/lib/dashboard/activity-ledger";
import { localCalendarDate } from "@/lib/local-calendar-date";
import {
  feedTypeFromSearchParams,
  type FeedType,
} from "@/lib/navigation/feed-tab";
import { rememberFeedHistoryEntry } from "@/lib/navigation/feed-history";

interface SearchResult {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  venue: string;
  sourceType: "journal" | "conference" | "arxiv" | "repository" | null;
  isOpenAccess: boolean;
  publishedDate: string | null;
  citationCount: number;
  doi: string | null;
  url: string;
  source: string;
}

type BriefingItem =
  | { kind: "paper"; data: Paper }
  | { kind: "event"; data: Event }
  | { kind: "job"; data: Job };

function scoreOf(item: BriefingItem): number {
  return item.data.relevanceScore ?? 0;
}

export default function DiscoveryPageWrapper() {
  return (
    <Suspense fallback={null}>
      <DiscoveryPage />
    </Suspense>
  );
}

function DiscoveryPage() {
  const {
    papers,
    events,
    jobs,
    eventPool,
    jobPool,
    eventFacetCounts,
    jobFacetCounts: opportunityJobFacetCounts,
    savedPapers,
    savedEvents,
    savedJobs,
    appliedAt,
    registeredAt,
    submittedAt,
    setJobApplied,
    setEventRegistered,
    setEventSubmitted,
    isLoading,
    papersLoading,
    eventsLoading,
    jobsLoading,
    lastRefresh,
    loadFeed,
    aiPaperSearchEnabled,
    setAiPaperSearchEnabled,
  } = useFeedStore();
  const readItems = useFeedStore((s) => s.readItems);
  const feedTopicsKey = useFeedStore((s) => s.feedTopicsKey);
  const profile = useProfileStore((s) => s.profile);
  const apiConnectorCount = connectedCount(profile);
  const updateFeedAiProvider = useProfileStore((s) => s.updateFeedAiProvider);
  const updateFeedAiApiKey = useProfileStore((s) => s.updateFeedAiApiKey);
  const updateDeepReportEnabled = useProfileStore((s) => s.updateDeepReportEnabled);
  const updateTopics = useProfileStore((s) => s.updateTopics);
  const updateSoftTopics = useProfileStore((s) => s.updateSoftTopics);
  const updateEventTopics = useProfileStore((s) => s.updateEventTopics);
  const updateEventSoftTopics = useProfileStore(
    (s) => s.updateEventSoftTopics,
  );
  const updateJobTopics = useProfileStore((s) => s.updateJobTopics);
  const updateJobSoftTopics = useProfileStore((s) => s.updateJobSoftTopics);
  const updateLocations = useProfileStore((s) => s.updateLocations);
  const recordOpportunityFacetPreference = useProfileStore(
    (s) => s.recordOpportunityFacetPreference,
  );
  const refreshFeed = useCallback(() => {
    void loadFeed({ advanceHistory: true });
  }, [loadFeed]);

  /**
   * ABC-freemium 1-18 · R-POOL-2 — the "refresh now" action, on the jobs and
   * events surfaces only.
   *
   * **This is what keeps the existing button honest after 1-17.** Those pools
   * rebuild weekly now, so a plain refetch reads the same cached pool all week
   * and "Refresh now" would do nothing visible. It asks for a rebuild instead.
   *
   * Asking is all it does: the route forwards the request only when the reader's
   * entitlement allows a forced rebuild and the daily forced-rebuild breaker has not
   * tripped, and refuses by serving the pool that is already there — no error,
   * no empty surface. Papers keep the plain refresh: D3 keeps that pool daily.
   */
  const refreshOpportunityPool = useCallback(() => {
    void loadFeed({ advanceHistory: true, poolRefresh: true });
  }, [loadFeed]);

  const searchParamsObj = useSearchParams();
  const incomingQuery = searchParamsObj?.get("q") ?? "";
  const incomingType = feedTypeFromSearchParams(searchParamsObj);

  const [query, setQuery] = useState(incomingQuery);
  const [activeType, setActiveType] = useState<FeedType>(incomingType);
  const [opportunityFacets, setOpportunityFacets] =
    useState<OpportunityFacetSelection>({});
  const [jobFacets, setJobFacets] = useState<JobFacetSelection>(() => ({
    ...DEFAULT_JOB_FACET_SELECTION,
    locations: [],
    roleKinds: [],
    visaStates: [],
  }));
  const [pageNowMs] = useState(Date.now);
  const [opportunityPagination, setOpportunityPagination] = useState({
    key: "",
    visibleCount: OPPORTUNITY_PAGE_SIZE,
  });
  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromUrlParams(searchParamsObj),
  );
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [openTool, setOpenTool] = useState<"ai" | "apis" | "deep" | null>(null);
  const [dashboardActivity, setDashboardActivity] =
    useState<ActivityAggregate>({
      days: [],
      totals: { papers: 0, events: 0, jobs: 0 },
      requiredTopicHits: {},
      savedItems: [],
    });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attemptedAutoLoadKeyRef = useRef<string | null>(null);
  const normalizedQuery = query.trim();
  const hasSearchQuery = normalizedQuery.length >= 2;
  const searchScope = activeType === "dashboard" ? "all" : activeType;
  const activeTabSearchesPapers =
    activeType === "dashboard" || activeType === "papers";
  const isPaperSearchMode = shouldSearchPapers(searchScope, normalizedQuery);
  const isOpportunitySearchMode = shouldSearchOpportunities(
    searchScope,
    normalizedQuery,
  );
  const isSearchMode = hasSearchQuery;

  // Hydrate from ?q= on navigation (e.g. clicking an author / keyword / venue).
  useEffect(() => {
    if (incomingQuery && incomingQuery !== query) {
      setQuery(incomingQuery);
    }
  }, [incomingQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (incomingType !== activeType) {
      setActiveType(incomingType);
    }
  }, [incomingType]); // eslint-disable-line react-hooks/exhaustive-deps

  const feedAutoLoadKey = useMemo(
    () => activePaperTopicsKey(profile),
    [profile],
  );
  const activityRequiredTopics = useMemo(
    () => ({
      papers:
        profile.activeSearchInputs?.papers.required ?? profile.researchTopics,
      events:
        profile.activeSearchInputs?.events.required ??
        profile.eventRequiredTopics,
      jobs:
        profile.activeSearchInputs?.jobs.required ?? profile.jobRequiredTopics,
    }),
    [
      profile.activeSearchInputs,
      profile.eventRequiredTopics,
      profile.jobRequiredTopics,
      profile.researchTopics,
    ],
  );
  const dashboardRequiredTopics = useMemo(
    () => [
      ...activityRequiredTopics.papers,
      ...activityRequiredTopics.events,
      ...activityRequiredTopics.jobs,
    ],
    [activityRequiredTopics],
  );

  useEffect(() => {
    if (!feedAutoLoadKey || isLoading) return;
    // Reload when the loaded feed's active day-locked Papers topics differ.
    // Pending edits intentionally do not change this key until promotion on
    // the next local day.
    if (feedTopicsKey === feedAutoLoadKey) return;
    if (attemptedAutoLoadKeyRef.current === feedAutoLoadKey) return;

    attemptedAutoLoadKeyRef.current = feedAutoLoadKey;
    void loadFeed();
  }, [feedAutoLoadKey, feedTopicsKey, isLoading, loadFeed]);

  useEffect(() => {
    const now = new Date();
    const snapshot = buildActivitySnapshot({
      papers,
      events,
      jobs,
      savedPapers,
      savedEvents,
      savedJobs,
      readItems,
      appliedAt,
      registeredAt,
      submittedAt,
      requiredTopics: activityRequiredTopics,
    });
    appendActivity({ ...snapshot, now });

    const fromDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 13,
      12,
    );
    setDashboardActivity(
      aggregateActivity({
        from: localCalendarDate(fromDate),
        through: localCalendarDate(now),
      }),
    );
  }, [
    activityRequiredTopics,
    appliedAt,
    events,
    jobs,
    papers,
    readItems,
    registeredAt,
    savedEvents,
    savedJobs,
    savedPapers,
    submittedAt,
  ]);

  // Monotonic token: a slow older response must never overwrite a newer one.
  const searchSeqRef = useRef(0);
  const searchPapers = useCallback(async (q: string, f: Filters) => {
    if (q.length < 2) {
      searchSeqRef.current++;
      setSearchResults([]);
      return;
    }
    const requestId = ++searchSeqRef.current;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const apiParams = filtersToApiQuery(f);
      apiParams.set("q", q);
      apiParams.set("per_page", "12");
      const data = await apiFetch<{ results?: unknown[] }>(
        `/api/papers/search?${apiParams.toString()}`,
      );
      if (requestId !== searchSeqRef.current) return;
      setSearchResults((data.results as never[]) || []);
    } catch {
      if (requestId === searchSeqRef.current) setSearchResults([]);
    } finally {
      if (requestId === searchSeqRef.current) setIsSearching(false);
    }
  }, []);

  // Explicit submit: bypass the 400ms debounce. Fired by the send button
  // and by Enter inside the input.
  const handleSearchSubmit = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isPaperSearchMode) void searchPapers(normalizedQuery, filters);
  }, [filters, isPaperSearchMode, normalizedQuery, searchPapers]);

  // Sync URL with current query + filters (replaceState to avoid history pollution).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const next = filtersToUrlParams(filters);
    if (query) next.set("q", query);
    next.set("tab", activeType);
    // Preserve any unrelated existing params (none today, but defensive).
    const reserved = new Set([
      "q", "tab", "year", "from", "to", "sort", "oa", "cites", "src", "venue",
    ]);
    url.searchParams.forEach((_, key) => {
      if (reserved.has(key)) url.searchParams.delete(key);
    });
    next.forEach((v, k) => url.searchParams.set(k, v));
    const target = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
    if (target !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", target);
    }
    rememberFeedHistoryEntry(window);
  }, [activeType, query, filters]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isPaperSearchMode) {
      debounceRef.current = setTimeout(
        () => searchPapers(normalizedQuery, filters),
        400,
      );
    } else {
      searchSeqRef.current++;
      setSearchResults([]);
      setIsSearching(false);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, isPaperSearchMode, normalizedQuery, searchPapers]);

  const hasOpportunityFacets = hasActiveOpportunityFacets(opportunityFacets);
  const hasJobFacets = hasActiveJobFacets(jobFacets);
  const authorisedCountries = profile.authorisedCountries;
  const jobFilterPool = jobPool.length > 0 ? jobPool : jobs;
  const jobFilterCounts = useMemo(
    () => countJobFacets(jobFilterPool, pageNowMs),
    [jobFilterPool, pageNowMs],
  );
  const eligibleEvents = useMemo(() => {
    const pool = eventPool.length > 0 ? eventPool : events;
    const filtered = filterOpportunitiesByFacets(
      "events",
      pool,
      opportunityFacets,
    );
    return hasOpportunityFacets
      ? filtered
      : filtered.filter(
          (event) =>
            (event.relevanceScore ?? 0) >= OPPORTUNITY_MIN_SCORE,
        );
  }, [eventPool, events, hasOpportunityFacets, opportunityFacets]);
  const eligibleJobs = useMemo(() => {
    if (activeType === "jobs") {
      const filtered = filterJobsByFacets(jobFilterPool, jobFacets, {
        authorisedCountries,
        nowMs: pageNowMs,
      });
      return hasJobFacets
        ? filtered
        : filtered.filter(
            (job) => (job.relevanceScore ?? 0) >= OPPORTUNITY_MIN_SCORE,
          );
    }

    const filtered = filterOpportunitiesByFacets(
      "jobs",
      jobFilterPool,
      opportunityFacets,
    );
    return hasOpportunityFacets
      ? filtered
      : filtered.filter(
          (job) => (job.relevanceScore ?? 0) >= OPPORTUNITY_MIN_SCORE,
        );
  }, [
    activeType,
    authorisedCountries,
    hasJobFacets,
    hasOpportunityFacets,
    jobFacets,
    jobFilterPool,
    opportunityFacets,
    pageNowMs,
  ]);
  const searchedEvents = useMemo(
    () =>
      filterEventsByOpportunityQuery(
        eligibleEvents,
        isOpportunitySearchMode ? normalizedQuery : "",
      ),
    [eligibleEvents, isOpportunitySearchMode, normalizedQuery],
  );
  const searchedJobs = useMemo(
    () =>
      filterJobsByOpportunityQuery(
        eligibleJobs,
        isOpportunitySearchMode ? normalizedQuery : "",
      ),
    [eligibleJobs, isOpportunitySearchMode, normalizedQuery],
  );
  const opportunityFacetCounts = useMemo(() => {
    if (activeType === "events") return eventFacetCounts;
    if (activeType === "jobs") return opportunityJobFacetCounts;
    return mergeOpportunityFacetCounts(
      eventFacetCounts,
      opportunityJobFacetCounts,
    );
  }, [activeType, eventFacetCounts, opportunityJobFacetCounts]);
  const opportunityFacetScope =
    activeType === "events"
      ? "events"
      : activeType === "jobs"
        ? "jobs"
        : "events & jobs";
  const opportunityPoolCount =
    activeType === "events"
      ? eventPool.length
      : activeType === "jobs"
        ? jobPool.length
        : eventPool.length + jobPool.length;
  const showOpportunityFacets =
    (activeType === "events" ||
      (activeType === "dashboard" && isSearchMode)) &&
    opportunityPoolCount > 0;

  // Dashboard is an overview until a query turns it into combined search.
  const showFeedTiles = activeType !== "dashboard" || isSearchMode;
  // RULING 66a / 68a. This was a hand-written copy of `store/feed.ts`'s tier
  // expression, and a copy is exactly what let the chip and the feeds disagree.
  // Same value, one home — `lib/feed/ai-tier.ts` — so the chip's tier text and
  // the feeds' `aiTier` are now provably the same boolean.
  // ABC-freemium 6-04 — `null` until the profile fetch answers. Both readings
  // below are CAPABILITY questions (does the feed ask for tier 2, and what does
  // the mode chip say), so they take the anonymous view while unknown: AI off
  // and the chip reading "Free", which is exactly what shipped before 6-04 and
  // is the right direction to fail. The raw nullable value is what an upsell
  // would have to read, and no upsell lives on this page.
  const entitlement = useProfileStore((state) => state.entitlement);
  const grants = entitlementGrants(entitlement);
  const canUseAiTools = feedsUseAi(profile, grants);
  const aiSearchActive = aiPaperSearchEnabled && canUseAiTools;
  // RULING 68a. The chip's three strings are computed in `lib/feed/ai-tier.ts`
  // so they can be asserted; the JSX below only places them.
  const aiChip = aiModeChip({
    feedsUseAi: canUseAiTools,
    aiSearchActive,
    entitlement: grants,
  });
  const shouldLoadPaperDigest =
    !isSearchMode &&
    activeType === "papers" &&
    papers.length > 0 &&
    canUseAiTools;
  const digestLlmOverride = useMemo(
    () =>
      profile.feedAiProvider !== "default" && profile.feedAiApiKey?.trim()
        ? {
            provider: profile.feedAiProvider,
            apiKey: profile.feedAiApiKey.trim(),
          }
        : undefined,
    [profile.feedAiApiKey, profile.feedAiProvider],
  );
  const digestContextHint = useMemo(
    () =>
      [
        profile.researchTopics.length > 0
          ? `Required interests (every paper below matches at least one — name the matching one in your sentence): ${profile.researchTopics.join(", ")}`
          : "",
        profile.currentProject,
        profile.currentChallenges,
      ]
        .filter((value) => value && value.trim().length > 0)
        .join("\n\n"),
    [
      profile.currentChallenges,
      profile.currentProject,
      profile.researchTopics,
    ],
  );

  const opportunityItems = useMemo<BriefingItem[]>(() => {
    const eventItems: BriefingItem[] =
      activeType === "dashboard" || activeType === "events"
        ? searchedEvents.map((event) => ({ kind: "event", data: event }))
        : [];
    const jobItems: BriefingItem[] =
      activeType === "dashboard" || activeType === "jobs"
        ? searchedJobs.map((job) => ({ kind: "job", data: job }))
        : [];
    return [...eventItems, ...jobItems];
  }, [activeType, searchedEvents, searchedJobs]);
  const opportunityPageKey = useMemo(
    () =>
      JSON.stringify([
        activeType,
        opportunityFacets.location ?? [],
        opportunityFacets.month ?? [],
        opportunityFacets.format ?? [],
        activeType === "jobs" ? jobFacets : undefined,
        isOpportunitySearchMode ? normalizedQuery.toLocaleLowerCase() : "",
        lastRefresh,
      ]),
    [
      activeType,
      isOpportunitySearchMode,
      jobFacets,
      lastRefresh,
      normalizedQuery,
      opportunityFacets,
    ],
  );
  const visibleOpportunityCount =
    opportunityPagination.key === opportunityPageKey
      ? opportunityPagination.visibleCount
      : OPPORTUNITY_PAGE_SIZE;
  const opportunityPage = useMemo(
    () =>
      paginateOpportunities(
        opportunityItems,
        visibleOpportunityCount,
        scoreOf,
      ),
    [opportunityItems, visibleOpportunityCount],
  );
  const showMoreOpportunities = useCallback(() => {
    setOpportunityPagination((current) => {
      const currentVisibleCount =
        current.key === opportunityPageKey
          ? current.visibleCount
          : OPPORTUNITY_PAGE_SIZE;
      return {
        key: opportunityPageKey,
        visibleCount: nextOpportunityPageSize(
          currentVisibleCount,
          opportunityPage.total,
        ),
      };
    });
  }, [opportunityPage.total, opportunityPageKey]);

  const handleOpportunityFacetChange = useCallback(
    (next: OpportunityFacetSelection) => {
      const origins: Array<"event" | "job"> =
        activeType === "events"
          ? ["event"]
          : activeType === "jobs"
            ? ["job"]
            : activeType === "dashboard"
              ? ["event", "job"]
              : [];
      const groups = ["location", "month", "format"] as const;

      for (const group of groups) {
        const previous = new Set(
          (opportunityFacets[group] ?? []).map((value) =>
            value.trim().toLocaleLowerCase(),
          ),
        );
        for (const value of next[group] ?? []) {
          if (previous.has(value.trim().toLocaleLowerCase())) continue;
          for (const origin of origins) {
            recordOpportunityFacetPreference(origin, group, value);
          }
        }
      }
      setOpportunityFacets(next);
    },
    [activeType, opportunityFacets, recordOpportunityFacetPreference],
  );
  const handleJobLocationAdded = useCallback(
    (location: string) => {
      const key = location.trim().toLocaleLowerCase();
      if (
        profile.locationPreferences.some(
          (candidate) => candidate.trim().toLocaleLowerCase() === key,
        )
      ) {
        return;
      }
      updateLocations([...profile.locationPreferences, location]);
    },
    [profile.locationPreferences, updateLocations],
  );

  const briefingItems = useMemo<BriefingItem[]>(() => {
    const paperItems: BriefingItem[] =
      !hasSearchQuery &&
      (activeType === "dashboard" || activeType === "papers")
        ? papers.map((p) => ({ kind: "paper", data: p }))
        : [];
    return [...paperItems, ...opportunityPage.items].sort(
      (left, right) => scoreOf(right) - scoreOf(left),
    );
  }, [activeType, hasSearchQuery, opportunityPage.items, papers]);

  const firstPaperId = briefingItems.find((i) => i.kind === "paper")?.data.id;
  const totalItems = papers.length + eventPool.length + jobPool.length;
  const paperSearchResultCount = isPaperSearchMode
    ? searchResults.length
    : 0;
  const opportunitySearchResultCount = isOpportunitySearchMode
    ? opportunityPage.total
    : 0;
  const searchResultCount =
    paperSearchResultCount + opportunitySearchResultCount;
  const opportunitySearchLabel =
    activeType === "events"
      ? "Events"
      : activeType === "jobs"
        ? "Jobs"
        : "Opportunities";
  const searchPlaceholder =
    activeType === "events"
      ? "Filter today’s events by title, place, or tag…"
      : activeType === "jobs"
        ? "Filter today’s jobs by title, place, or skill…"
        : activeType === "papers"
          ? "Search papers across OpenAlex…"
          : "Search papers, events, jobs…";
  const unreadCount = briefingItems.filter((i) => !readItems[i.data.id]).length;
  const briefingClosed =
    !isSearchMode && briefingItems.length > 0 && unreadCount === 0;
  const isEmpty =
    activeType !== "dashboard" &&
    !isLoading &&
    totalItems === 0 &&
    !isSearchMode;
  const feedProgressPct =
    35 + (eventsLoading ? 0 : 15) + (jobsLoading ? 0 : 15);

  const typeChips: { key: FeedType; label: string; count: number; icon: string }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      count: totalItems,
      icon: "/logo-mark.png",
    },
    { key: "papers", label: "Papers", count: papers.length, icon: "/icon-papers.svg" },
    { key: "events", label: "Events", count: eventPool.length, icon: "/icon-events.svg" },
    { key: "jobs", label: "Jobs", count: jobPool.length, icon: "/icon-jobs.svg" },
  ];
  const selectedActiveTopics =
    activeType === "dashboard"
      ? undefined
      : profile.activeSearchInputs?.[activeType];
  const dashboardToday =
    dashboardActivity.days[dashboardActivity.days.length - 1]?.counts ?? {
      papers: 0,
      events: 0,
      jobs: 0,
    };
  const dashboardDate =
    dashboardActivity.days[dashboardActivity.days.length - 1]?.date;
  const dashboardNowMs = dashboardDate
    ? new Date(`${dashboardDate}T12:00:00`).getTime()
    : undefined;

  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <PaperDigestLoader
        papers={papers}
        contextHint={digestContextHint}
        enabled={shouldLoadPaperDigest}
        llmOverride={digestLlmOverride}
      />
      {!isSearchMode && papersLoading && (
        <ProgressBar
          pct={feedProgressPct}
          label="Finding today’s papers"
        />
      )}
      <div className="mx-auto max-w-[820px]">
      <header className="mb-8 flex items-end gap-3 sm:gap-6">
        <div className="min-w-0">
          <Greeting
            isSearchMode={isSearchMode}
            searchScope={activeType}
            displayName={profile.displayName}
            lastRefresh={lastRefresh}
          />
          {!isSearchMode && (
            <MetaRow profile={profile} />
          )}
        </div>
        {/* Brand mark — hands + pear as a colored dot matrix (aspenlab.io
            halftone treatment, in the artwork's own colors). Hidden on
            phones where the greeting needs the room. */}
        {!isSearchMode && (
          <div
            aria-hidden
            className="hidden sm:block shrink-0 w-[250px] lg:w-[330px] translate-y-[4px]"
          >
            <DotMatrixImage src="/logo.png" aspectRatio={1254 / 356} pitch={4} />
          </div>
        )}
      </header>

      {/* ── Search ── */}
      <div className="mb-6">
        {/* One glass console: status row + input + tool pills live on a
            single surface — no stacked bars, no hairlines between rows. */}
        <div data-tour="search" className="rounded-3xl glass shadow-card focus-within:shadow-card-hover transition-[box-shadow] duration-200">
          {!isSearchMode && briefingItems.length > 0 && (
            <BriefingStatus
              total={briefingItems.length}
              unread={unreadCount}
              lastRefresh={lastRefresh}
              closed={briefingClosed}
              onRefresh={refreshFeed}
              isRefreshing={isLoading}
            />
          )}
          {/* Input row */}
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              id="peer-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearchSubmit();
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent py-4 pl-11 pr-12 text-body text-text placeholder:text-text-faint/70 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearchResults([]);
                }}
                aria-label="Clear search"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-text-faint/70 hover:bg-bg-secondary hover:text-text transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            )}
          </div>

          {/* Tools row — left: modes pills · right: send action */}
          <div
            className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-0.5"
          >
            <div data-tour="ai-tools" className="flex items-center flex-wrap gap-1.5 min-w-0">
            {/* Auto / AI search toggle */}
            <button
              type="button"
              onClick={() => setAiPaperSearchEnabled(!aiSearchActive)}
              disabled={isLoading || !canUseAiTools}
              aria-pressed={aiSearchActive}
              // RULING 66a / 68a. The tooltip's third branch read "Auto search
              // uses Tier 0 fixed scoring and no AI API." — FALSE for jobs and
              // events whenever a provider is reachable. This button toggles
              // `aiPaperSearchEnabled`, a PAPERS control, but the job and event
              // feeds send their tier from the provider state alone and never
              // read the papers toggle at all.
              title={aiChip.title}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta transition-[color,background-color,box-shadow,transform] duration-150 ease-snap active:scale-[0.94] disabled:opacity-55 disabled:cursor-wait ${
                aiSearchActive
                  ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
                  : "bg-bg-secondary/55 text-text-muted hover:text-heading hover:bg-bg-secondary"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2l1.5 5L19 8.5 14.5 11 13 16l-2.5-4.5L6 10l4.5-1.5z" />
              </svg>
              {/* The LABEL is this button's own pressed state and stays on the
                  papers toggle. The TIER TEXT is a claim about the whole mode,
                  so RULING 68a moves it onto `feedsUseAi` — the same predicate
                  `store/feed.ts` sends the feeds' `aiTier` from. It read
                  `aiSearchActive`, the papers toggle ANDed with that, so it
                  showed "Tier 0" while jobs and events ran Tier 2. */}
              <span className="font-medium">{aiChip.label}</span>
              {/* ABC-freemium 1-24 · R-UI-1 — the plan, and whether AI is on.
                  Two facts, because the tier number said neither. */}
              <span className="opacity-60 text-micro">{aiChip.plan}</span>
              <span className="opacity-60 text-micro">{aiChip.ai}</span>
            </button>

            {/* AI key hookup */}
            <button
              type="button"
              onClick={() => setOpenTool((cur) => (cur === "ai" ? null : "ai"))}
              aria-expanded={openTool === "ai"}
              title="Configure your own AI provider key"
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta transition-colors active:scale-[0.96] ${
                openTool === "ai"
                  ? "bg-bg-secondary text-heading shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
                  : profile.feedAiProvider !== "default"
                    ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
                    : "bg-bg-secondary/55 text-text-muted hover:text-heading hover:bg-bg-secondary"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="8" cy="14" r="4" />
                <path d="M11 11l7-7M16 6l3 3M14 8l3 3" />
              </svg>
              <span className="font-medium">
                {providerShortLabel(profile.feedAiProvider)}
              </span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={`opacity-60 transition-transform duration-200 ${openTool === "ai" ? "rotate-180" : ""}`} aria-hidden>
                <path d="M2 4l4 4 4-4" />
              </svg>
            </button>

            {/* Deep Report toggle — requires user AI key to be filled in */}
            <button
              type="button"
              onClick={() => setOpenTool((cur) => (cur === "deep" ? null : "deep"))}
              aria-expanded={openTool === "deep"}
              title="Deep report — read each paper's full text before writing the report (uses your own AI key)."
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta transition-colors active:scale-[0.96] ${
                openTool === "deep"
                  ? "bg-bg-secondary text-heading shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
                  : profile.deepReportEnabled
                    ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
                    : "bg-bg-secondary/55 text-text-muted hover:text-heading hover:bg-bg-secondary"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span className="font-medium">{profile.deepReportEnabled ? "Deep report on" : "Deep report"}</span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={`opacity-60 transition-transform duration-200 ${openTool === "deep" ? "rotate-180" : ""}`} aria-hidden>
                <path d="M2 4l4 4 4-4" />
              </svg>
            </button>

            {/* Data APIs (Tavily / Adzuna / USAJobs) */}
            <button
              type="button"
              onClick={() => setOpenTool((cur) => (cur === "apis" ? null : "apis"))}
              aria-expanded={openTool === "apis"}
              title="Data APIs — widen events & jobs coverage"
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta transition-colors active:scale-[0.96] ${
                openTool === "apis"
                  ? "bg-bg-secondary text-heading shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
                  : apiConnectorCount > 0
                    ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
                    : "bg-bg-secondary/55 text-text-muted hover:text-heading hover:bg-bg-secondary"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
              </svg>
              <span className="font-medium">
                {apiConnectorCount > 0 ? `Data APIs · ${apiConnectorCount}` : "Data APIs"}
              </span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={`opacity-60 transition-transform duration-200 ${openTool === "apis" ? "rotate-180" : ""}`} aria-hidden>
                <path d="M2 4l4 4 4-4" />
              </svg>
            </button>
            </div>

            {/* Right zone — send action */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleSearchSubmit}
                disabled={normalizedQuery.length < 2 || isSearching}
                aria-label="Search"
                title={
                  activeTabSearchesPapers
                    ? "Search now (Enter)"
                    : "Opportunity results filter as you type"
                }
                className={cn(
                  iconButtonVariants({ size: "lg" }),
                  normalizedQuery.length >= 2 && !isSearching
                    ? "bg-accent text-bg shadow-card hover:bg-accent/90"
                    : "bg-bg-secondary text-text-faint/70 cursor-not-allowed",
                )}
              >
                {isSearching ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.2-8.55" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Expanded panel — only one tool at a time */}
          {openTool === "ai" && (
            <div
              className={`px-3.5 pb-3.5 space-y-3 border-t border-border/50 pt-3 ${aiSearchActive ? "" : "opacity-60"}`}
            >
              <p className="text-caption leading-relaxed text-text-muted">
                Peer&apos;s AI is included. Choose an AI company and add your own key to send these calls to your own account instead.
              </p>
              <AiKeyFields
                provider={profile.feedAiProvider}
                apiKey={profile.feedAiApiKey ?? ""}
                onProviderChange={updateFeedAiProvider}
                onApiKeyChange={updateFeedAiApiKey}
                idPrefix="feed-ai"
              />
              <p className="text-micro leading-relaxed text-text-faint">
                {/* ABC-freemium 1-14 · R-ENT-3 — this fork asked the BROWSER
                    whether it had been built in development, which Next inlines
                    at build time. It now asks what the reader actually has. */}
                {aiSearchActive
                  ? profile.feedAiProvider === "default"
                    ? canUseAiTools
                      ? "Peer's AI is included, so search uses it without a key of your own."
                      : "Sign in to use Peer's AI. Until then search runs on fixed scoring and makes no AI model call."
                    : "Peer sends model calls only to the AI key you entered here."
                  : "Fixed scoring is active. It does not call an AI model or spend any AI account."}
              </p>
            </div>
          )}

          {openTool === "deep" && (
            <div
              className={`px-3.5 pb-3.5 space-y-3 border-t border-border/50 pt-3 ${canUseAiTools ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-caption leading-relaxed text-text-muted">
                  Read each paper&apos;s full text (HTML when available, PDF as fallback) before writing the report. Burns more tokens per paper but produces specific, paper-grounded reports instead of summarizing the abstract.
                </p>
                <Toggle
                  checked={profile.deepReportEnabled}
                  onChange={(next) => updateDeepReportEnabled(next)}
                  disabled={!canUseAiTools}
                  className="mt-0.5"
                  aria-label="Deep report"
                />
              </div>
              <p className="text-micro leading-relaxed text-text-faint">
                {profile.feedAiProvider === "default"
                  ? canUseAiTools
                    ? "Deep report runs on Peer's included AI. Adding your own key sends these calls to your account instead."
                    : "Sign in to use Peer's AI, or add your own key. Without either, Peer shows the report it can build without a model."
                  : !profile.feedAiApiKey?.trim()
                  ? "Set your own AI provider and key in the AI key panel first. Deep report uses your key — both a cheap model (classify) and a smart model (extract) get called per paper."
                  : "When on, Peer downloads each paper's HTML or legal PDF, runs a two-pass read (cheap classify + smart extract), and grounds every result in the body text. Paywalled papers fall back to the abstract with a notice."}
              </p>
            </div>
          )}

          {openTool === "apis" && <ConnectorPanel />}
        </div>

        {activeType !== "dashboard" && (
          <SurfaceTopicsPanel
            key={activeType}
            surface={activeType}
            activeRequired={selectedActiveTopics?.required ?? []}
            activeExplore={selectedActiveTopics?.explore ?? []}
            required={
              activeType === "papers"
                ? profile.researchTopics
                : activeType === "events"
                  ? profile.eventRequiredTopics
                  : profile.jobRequiredTopics
            }
            explore={
              activeType === "papers"
                ? (profile.softTopics ?? [])
                : activeType === "events"
                  ? profile.eventExploreTopics
                  : profile.jobExploreTopics
            }
            onChangeRequired={
              activeType === "papers"
                ? updateTopics
                : activeType === "events"
                  ? updateEventTopics
                  : updateJobTopics
            }
            onChangeExplore={
              activeType === "papers"
                ? updateSoftTopics
                : activeType === "events"
                  ? updateEventSoftTopics
                  : updateJobSoftTopics
            }
            defaultExpanded={activeType === "papers"}
          >
            {activeType === "jobs" && (
              <JobFacetPanel
                counts={jobFilterCounts}
                selection={jobFacets}
                onChange={setJobFacets}
                onLocationAdded={handleJobLocationAdded}
                usesAuthorisationDefault={authorisedCountries.length > 0}
              />
            )}
          </SurfaceTopicsPanel>
        )}

        {/* ── Paper-only filters stay attached to the server search. ── */}
        {isPaperSearchMode && (
          <FilterBar
            filters={filters}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        )}

        {/* Keep tabs available while searching so the same box can switch
            between server-side papers and client-side opportunity pools. */}
        {(totalItems > 0 || isSearchMode) && (
          <div
            className="flex items-center flex-wrap gap-2.5 mt-6"
          >
            {typeChips.map(({ key, label, count, icon }) => {
              const active = activeType === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveType(key)}
                  aria-pressed={active}
                  className={[
                    "group relative inline-flex items-center h-12 rounded-full pl-1.5 pr-5 gap-2",
                    "transition-all duration-300 ease-out active:scale-[0.97]",
                    active
                      ? "bg-heading text-bg shadow-card-hover scale-[1.03]"
                      : "bg-surface text-text shadow-card hover:shadow-card-hover hover:-translate-y-[1px] hover:text-heading",
                  ].join(" ")}
                >
                  <span className="relative inline-flex items-center justify-center w-[40px] h-[40px] shrink-0">
                    {/* Burst pulse behind icon on activation — remounted per activeType */}
                    {active && (
                      <span
                        key={`burst-${activeType}`}
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-full bg-accent/40 animate-tab-burst"
                      />
                    )}
                    <Image
                      key={`icon-${key}-${active ? "on" : "off"}`}
                      src={icon}
                      alt=""
                      width={40}
                      height={40}
                      className={[
                        "relative w-full h-full object-contain",
                        active
                          ? "animate-stamp drop-shadow-[0_2px_6px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                          : "transition-transform duration-300 ease-out group-hover:scale-[1.08] group-hover:-rotate-3 group-active:scale-95",
                      ].join(" ")}
                    />
                  </span>
                  <span className="text-body font-medium tracking-[-0.005em]">
                    {label}
                  </span>
                  <span
                    className={`text-meta tabular-nums transition-colors ${
                      active ? "text-bg/55" : "text-text-faint"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Search status ── */}
        {showOpportunityFacets && (
          <OpportunityFacetPanel
            counts={opportunityFacetCounts}
            selection={opportunityFacets}
            onChange={handleOpportunityFacetChange}
            scopeLabel={opportunityFacetScope}
          />
        )}

        {isSearchMode && (
          <p
            className="text-meta text-text-faint mt-4"
          >
            {isSearching && searchResultCount === 0
              ? "searching papers…"
              : isSearching
                ? `${opportunitySearchResultCount} opportunity ${opportunitySearchResultCount === 1 ? "result" : "results"} · searching papers…`
                : searchResultCount > 0
                  ? `${searchResultCount} ${searchResultCount === 1 ? "result" : "results"} for \u201c${normalizedQuery}\u201d`
                  : `no results for \u201c${normalizedQuery}\u201d`}
          </p>
        )}
      </div>
      </div>{/* /max-w-[820px] inner header wrapper */}

      {activeType === "dashboard" && !isSearchMode && (
        <DashboardOverview
          today={dashboardToday}
          days={dashboardActivity.days}
          savedItems={dashboardActivity.savedItems}
          requiredTopics={dashboardRequiredTopics}
          requiredTopicHits={dashboardActivity.requiredTopicHits}
        >
          <DeadlinesBoard
            savedJobs={savedJobs}
            savedEvents={savedEvents}
            appliedAt={appliedAt}
            registeredAt={registeredAt}
            submittedAt={submittedAt}
            onJobApplied={setJobApplied}
            onEventRegistered={setEventRegistered}
            onEventSubmitted={setEventSubmitted}
            nowMs={dashboardNowMs}
          />
        </DashboardOverview>
      )}

      {/* Papers keep their existing server-side search. */}
      {isPaperSearchMode && (
        <>
          {isSearching &&
            searchResults.length === 0 &&
            opportunitySearchResultCount === 0 && (
            <div className="mx-auto max-w-[820px]"><LoadingSkeleton /></div>
          )}
          {searchResults.length > 0 && (
            <>
              <div className="mx-auto max-w-[820px]">
                <SectionHeading count={searchResults.length}>Papers</SectionHeading>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchResults.map((r) => (
                  <SearchResultCard key={r.id} result={r} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Daily feed, plus client-filtered event/job search results. */}
      {(!isSearchMode || isOpportunitySearchMode) && (
        <>
          {!isSearchMode &&
            activeType !== "dashboard" &&
            isLoading &&
            briefingItems.length === 0 && (
            <div className="mx-auto max-w-[820px]"><LoadingSkeleton /></div>
          )}

          {isEmpty && (
            <div className="mx-auto max-w-[820px]">
              <EmptyState
                title="Your briefing is still waking up."
                description="Tell Peer what you're working on — topics, methods, venues — and tomorrow's briefing will be built around that. Peer keeps your settings in this browser only, so signing in is what carries them to another device."
                action={
                  <Link
                    href="/profile"
                    className="group inline-flex items-center gap-1.5 text-body-sm text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/70 underline-offset-4 transition-all duration-200 ease-out active:scale-[0.97]"
                  >
                    Set up profile
                    <span className="text-caption opacity-70 transition-transform duration-200 ease-out group-hover:translate-x-[2px]">→</span>
                  </Link>
                }
              />
            </div>
          )}

          {showFeedTiles && briefingItems.length > 0 && (
            <>
              {isOpportunitySearchMode && (
                <div className="mx-auto max-w-[820px]">
                  <SectionHeading count={opportunitySearchResultCount}>
                    {opportunitySearchLabel}
                  </SectionHeading>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {briefingItems.map((item) => (
                  <div
                    key={item.data.id}
                    id={item.kind === "paper" ? `paper-${item.data.id}` : undefined}
                    data-tour={item.data.id === firstPaperId ? "paper-card" : undefined}
                    className="rounded-3xl transition-shadow"
                  >
                    {item.kind === "paper" ? (
                      <FeedTile item={item} />
                    ) : item.kind === "event" ? (
                      <EventCard event={item.data} />
                    ) : (
                      <JobCard job={item.data} />
                    )}
                  </div>
                ))}
                {opportunityPage.remaining > 0 ? (
                  <OpportunityShowMore
                    remaining={opportunityPage.remaining}
                    onClick={showMoreOpportunities}
                  />
                ) : !isSearchMode ? (
                  <FeedMoreTile
                    itemCount={briefingItems.length}
                    topics={profile.researchTopics}
                    onRefresh={
                      activeType === "papers"
                        ? refreshFeed
                        : refreshOpportunityPool
                    }
                    isLoading={isLoading}
                  />
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      {isSearchMode && !isSearching && searchResultCount === 0 && (
        <div className="mx-auto max-w-[820px]">
          <EmptyState
            title="Nothing turned up."
            description={
              isOpportunitySearchMode
                ? "Try a title, place, company, event type, or skill from today’s opportunity pool."
                : "Try different keywords, or broaden the paper search."
            }
          />
        </div>
      )}
      <OnboardingTour />
    </article>
  );
}

function Greeting({
  isSearchMode,
  searchScope,
  displayName,
  lastRefresh,
}: {
  isSearchMode: boolean;
  searchScope: FeedType;
  displayName: string;
  lastRefresh: string | null;
}) {
  if (isSearchMode) {
    const description =
      searchScope === "events"
        ? "Filter today’s event pool by title, description, place, or type."
        : searchScope === "jobs"
          ? "Filter today’s job pool by title, company, place, or skill."
          : searchScope === "papers"
            ? "Search papers across OpenAlex — 250M+ academic works."
            : "Search papers and filter today’s event and job pools together.";
    return (
      <>
        <h1
          className="text-[24px] lg:text-[28px] font-semibold text-heading tracking-[-0.02em] leading-[1.1]"
        >
          Search
        </h1>
        <p className="text-text-muted mt-2 text-body leading-relaxed max-w-[56ch]">
          {description}
        </p>
      </>
    );
  }

  const firstName =
    displayName && displayName !== "Peer Member"
      ? displayName.trim().split(/\s+/)[0]
      : "";

  const now = lastRefresh ? new Date(lastRefresh) : new Date();
  const hour = now.getHours();
  const greet =
    hour < 5
      ? "Still up"
      : hour < 12
      ? "Good morning"
      : hour < 17
      ? "Good afternoon"
      : hour < 22
      ? "Good evening"
      : "Hello";

  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <p
        className="text-micro font-semibold uppercase tracking-[0.22em] text-accent/90 mb-2"
      >
        <span className="inline-block w-4 h-[1.5px] bg-accent/70 align-middle mr-2" />
        Daily briefing
      </p>
      <h1
        className="text-[34px] lg:text-[42px] font-display font-light text-heading tracking-[-0.01em] leading-[1.05]"
        // The greeting word is derived from the current clock, which can differ
        // between the server render and the browser (timezone / hour boundary).
        suppressHydrationWarning
      >
        {firstName ? (
          <>
            {greet},{" "}
            <span className="italic font-medium font-reading">
              {firstName}
            </span>
            <span className="text-text-faint/70">.</span>
          </>
        ) : (
          <>
            {greet}
            <span className="text-text-faint/70">.</span>
          </>
        )}
      </h1>
      <div
        className="mt-2 flex items-baseline gap-2 text-text-muted font-reading"
      >
        <span
          className="text-body lg:text-body-lg italic text-heading/80 tracking-tight leading-none"
          suppressHydrationWarning
        >
          {weekday}
        </span>
        <span className="text-border-strong text-meta leading-none" aria-hidden>·</span>
        <span className="text-body-sm lg:text-body leading-none" suppressHydrationWarning>{monthDay}</span>
      </div>
    </>
  );
}

function formatSynced(lastRefresh: string | null): string {
  return formatTimeAgo(lastRefresh) ?? "not synced yet";
}

function BriefingStatus({
  total,
  unread,
  lastRefresh,
  closed,
  onRefresh,
  isRefreshing,
}: {
  total: number;
  unread: number;
  lastRefresh: string | null;
  closed: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  // First row INSIDE the glass console — plain text on the shared surface,
  // separated from the input by spacing alone (no pill, no hairline).
  const wrapper =
    "flex items-center gap-2.5 pl-4.5 pr-2.5 pt-3 -mb-1 text-meta";
  const refreshBtn = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label="Refresh briefing"
      title="Refresh briefing"
      className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary/80 hover:text-text transition-[color,background-color,transform] duration-150 ease-snap active:scale-90 disabled:opacity-50 disabled:cursor-wait"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={isRefreshing ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v6h-6" />
      </svg>
    </button>
  );
  if (closed) {
    return (
      <div className={wrapper}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        <span className="text-heading font-medium whitespace-nowrap">Briefing closed</span>
        <span className="text-text-faint hidden sm:inline">·</span>
        <span className="text-text-muted truncate hidden sm:inline">
          {total} reviewed · back tomorrow
        </span>
        {refreshBtn}
      </div>
    );
  }
  return (
    <div className={wrapper}>
      <span className="relative h-1.5 w-1.5 shrink-0" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-accent" />
        <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-ping [animation-duration:2.4s]" />
      </span>
      <span className="tabular-nums text-text-muted whitespace-nowrap">
        <span className="text-heading font-medium">{total}</span> item{total === 1 ? "" : "s"}
      </span>
      <span className="text-border-strong">·</span>
      <span className="tabular-nums text-text-muted whitespace-nowrap">
        <span className="text-accent font-medium">{unread}</span> unread
      </span>
      <span className="text-border-strong hidden sm:inline">·</span>
      <span className="text-text-faint truncate hidden sm:inline">
        synced {formatSynced(lastRefresh)}
      </span>
      {refreshBtn}
    </div>
  );
}

// ── Icons for typed signal badges ─────────────────────────────

function TopicIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
    </svg>
  );
}
function MethodIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2v6L4 20a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 20L14 8V2" />
      <path d="M9 2h6" />
    </svg>
  );
}
function VenueIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

type SignalKind = "topic" | "method" | "venue";

function SignalBadge({ kind, label }: { kind: SignalKind; label: string }) {
  const tone =
    kind === "topic"
      ? "text-accent bg-accent-dim"
      : kind === "method"
        ? "text-tag bg-tag-dim"
        : "text-link bg-link-dim";

  const Icon = kind === "topic" ? TopicIcon : kind === "method" ? MethodIcon : VenueIcon;

  return (
    <span
      className={`inline-flex items-center gap-1 h-5 pl-1.5 pr-2 rounded text-caption font-medium tracking-[0.005em] ${tone}`}
    >
      <Icon />
      {label}
    </span>
  );
}

function MetaRow({
  profile,
}: {
  profile: { researchTopics: string[]; preferredMethods: string[] };
}) {
  const { researchTopics, preferredMethods } = profile;
  const typedSignals: { kind: SignalKind; label: string }[] = [
    ...researchTopics.slice(0, 3).map((label) => ({ kind: "topic" as const, label })),
    ...preferredMethods.slice(0, 2).map((label) => ({ kind: "method" as const, label })),
  ];
  const hasAny = typedSignals.length > 0;
  const missingTopics = researchTopics.length === 0;

  if (!hasAny) {
    return (
      <Link
        href="/profile"
        className="group mt-6 inline-flex items-center gap-2 rounded-full bg-bg-secondary/50 hover:bg-bg-secondary pl-2 pr-3.5 py-1.5 text-meta text-text-muted hover:text-heading transition-colors duration-200 ease-out active:scale-[0.98]"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-bg transition-transform duration-200 ease-out group-hover:rotate-90">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        Set up your profile
        <span className="text-micro opacity-60 transition-transform duration-200 ease-out group-hover:translate-x-[2px]">→</span>
      </Link>
    );
  }

  // Only show first 5 chips inline; rest become "+N more" so the row
  // stays single-line on most viewports without sacrificing context.
  const VISIBLE = 5;
  const overflow = Math.max(0, typedSignals.length - VISIBLE);

  return (
    <Link
      href="/profile"
      aria-label="Edit profile signals"
      className="group mt-4 inline-flex items-center flex-wrap gap-x-1.5 gap-y-1 transition-colors"
    >
      <span className="text-micro font-semibold uppercase tracking-[0.16em] text-text-faint/80 mr-1">
        Tuned for
      </span>
      {typedSignals.slice(0, VISIBLE).map((s) => (
        <SignalBadge key={`${s.kind}:${s.label}`} kind={s.kind} label={s.label} />
      ))}
      {overflow > 0 && (
        <span className="text-caption text-text-faint/80 tabular-nums">
          +{overflow}
        </span>
      )}
      <span
        className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-text-faint/60 group-hover:text-accent group-hover:bg-accent-dim transition-all duration-200 ease-out active:scale-90"
        aria-hidden
        title="Edit signals"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 ease-out group-hover:-rotate-12">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </span>
      {missingTopics && (
        <div className="basis-full flex items-center gap-1 text-micro text-text-faint/70 mt-0.5">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="text-accent/80" aria-hidden>
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span>Add research topics for sharper picks</span>
          <span className="text-accent/80 transition-transform duration-200 ease-out group-hover:translate-x-[2px]">→</span>
        </div>
      )}
    </Link>
  );
}
