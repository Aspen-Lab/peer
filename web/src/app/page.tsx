"use client";

// The daily surface.
//
// This page used to be 1,588 lines rendering four different pages behind a tab
// row: a metrics dashboard (the default landing tab, containing zero items of
// content), a paper feed, an event feed and a job feed — with papers, events
// and jobs sorted into ONE list by relevance score and written into ONE grid,
// so a once-a-year job posting occupied the same cell as today's key paper.
// Stacked on top of that push feed were eleven manual composers exposing
// fourteen typeable fields: a search box that deleted the briefing when you
// typed in it, an AI-provider key form, a Data-API key form, a deep-report
// toggle, a topic editor whose own footer admitted "Changes take effect in
// tomorrow's search", and three filter systems.
//
// It is now one thing: today's papers. Search lives at /search, events at
// /events, jobs at /jobs, and every credential form lives on /profile.

import { useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { feedsUseAi } from "@/lib/feed/ai-tier";
import { formatTimeAgo } from "@/lib/format";
import { useProfileStore } from "@/store/profile";
import { FeedTile } from "@/components/cards/feed-tile";
import { PaperDigestLoader } from "@/components/digest/daily-digest";
import { EmptyState, LoadingSkeleton } from "@/components/ui";
import { allocatePlateTerms } from "@/lib/papers/plate-terms";

export default function DailyBriefingPageWrapper() {
  return (
    <Suspense fallback={null}>
      <DailyBriefingPage />
    </Suspense>
  );
}

function DailyBriefingPage() {
  const papers = useFeedStore((s) => s.papers);
  const isLoading = useFeedStore((s) => s.isLoading);
  const papersLoading = useFeedStore((s) => s.papersLoading);
  const lastRefresh = useFeedStore((s) => s.lastRefresh);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const readItems = useFeedStore((s) => s.readItems);
  const feedTopicsKey = useFeedStore((s) => s.feedTopicsKey);
  const profile = useProfileStore((s) => s.profile);

  // Papers only. Events and jobs used to run on every home-page tick — the
  // progress bar labelled "Finding today's papers" was 30% driven by
  // conference scrapers and job boards. They now load on their own routes.
  const refreshFeed = useCallback(() => {
    void loadFeed({ advanceHistory: true, lanes: ["papers"] });
  }, [loadFeed]);

  const feedAutoLoadKey = useMemo(
    () => activePaperTopicsKey(profile),
    [profile],
  );

  useEffect(() => {
    if (!feedAutoLoadKey || isLoading) return;
    // Reload when the loaded feed's active day-locked Papers topics differ.
    // Pending edits intentionally do not change this key until promotion on
    // the next local day.
    if (feedTopicsKey === feedAutoLoadKey) return;
    void loadFeed({ lanes: ["papers"] });
  }, [feedAutoLoadKey, feedTopicsKey, isLoading, loadFeed]);

  const canUseAiTools = feedsUseAi(profile);
  const shouldLoadPaperDigest = papers.length > 0 && canUseAiTools;
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

  // Allocated once across the whole briefing, not per card: the source field is
  // `matchedKeywords ∪ tags`, so per-card selection would put the reader's own
  // query on all ten plates and let one concept headline half of them.
  const plateTerms = useMemo(
    () => allocatePlateTerms(papers, profile.researchTopics),
    [papers, profile.researchTopics],
  );

  const unreadCount = papers.filter((p) => !readItems[p.id]).length;
  const briefingClosed = papers.length > 0 && unreadCount === 0;
  const isEmpty = !isLoading && papers.length === 0;

  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <PaperDigestLoader
        papers={papers}
        contextHint={digestContextHint}
        enabled={shouldLoadPaperDigest}
        llmOverride={digestLlmOverride}
      />

      <div className="mx-auto max-w-[820px]">
        <BriefingHeader
          total={papers.length}
          unread={unreadCount}
          lastRefresh={lastRefresh}
          closed={briefingClosed}
          onRefresh={refreshFeed}
          isRefreshing={isLoading}
          topics={profile.researchTopics}
        />
      </div>

      {papersLoading && papers.length === 0 && <LoadingSkeleton />}

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
                <span className="text-caption opacity-70 transition-transform duration-200 ease-out group-hover:translate-x-[2px]">
                  →
                </span>
              </Link>
            }
          />
        </div>
      )}

      {papers.length > 0 && (
        // Masonry, not a fixed grid. Roughly four papers in ten carry an
        // extractable figure, so card heights genuinely differ; a uniform grid
        // either ragged-edges every row or reserves dead space on the six cards
        // with no image. CSS columns let each card be its own height.
        <div className="mt-8 columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {papers.map((paper, index) => (
            <div
              key={paper.id}
              id={`paper-${paper.id}`}
              data-paper-id={paper.id}
              // Today's papers arrive as a stack dealt in reading order. All
              // ten used to fade up on the identical frame, which reads as the
              // page reflowing rather than as a delivery. globals.css already
              // carried the plumbing — `[style*="--i"]` at :375 — and the feed
              // had never used it. Capped at 9 so the tail never exceeds 360ms.
              style={{ "--i": Math.min(index, 9) } as React.CSSProperties}
              className="mb-4 break-inside-avoid rounded-3xl transition-shadow"
            >
              <FeedTile
                item={{ kind: "paper", data: paper }}
                plateTerms={plateTerms[paper.id]}
              />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// The briefing readout — how many papers arrived, how many are unopened, when
// the fetch last ran. This was the only genuinely daily, genuinely changing
// thing on the old page, and it was rendered at caption size buried inside the
// search console. It is the page header now.
function BriefingHeader({
  total,
  unread,
  lastRefresh,
  closed,
  onRefresh,
  isRefreshing,
  topics,
}: {
  total: number;
  unread: number;
  lastRefresh: string | null;
  closed: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  topics: string[];
}) {
  const today = new Date();
  const dateLine = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const refreshBtn = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      aria-label="Refresh briefing"
      title="Refresh briefing"
      className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary/80 hover:text-text transition-[color,background-color,transform] duration-150 ease-snap active:scale-90 disabled:opacity-50 disabled:cursor-wait"
    >
      <svg
        width="15"
        height="15"
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

  return (
    <header className="mb-2">
      <p className="text-meta text-text-faint">{dateLine}</p>
      <div className="mt-1.5 flex items-center gap-2.5">
        {closed ? (
          <>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              aria-hidden
            />
            <h1 className="text-title font-medium text-heading">
              Briefing closed
            </h1>
            <span className="text-border-strong hidden sm:inline">·</span>
            <span className="text-body-sm text-text-muted hidden sm:inline">
              {total} reviewed · back tomorrow
            </span>
          </>
        ) : (
          <>
            <span className="relative h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-accent" />
              <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-ping [animation-duration:2.4s]" />
            </span>
            <h1 className="text-title font-medium text-heading tabular-nums">
              {total} paper{total === 1 ? "" : "s"} today
            </h1>
            {total > 0 && (
              <>
                <span className="text-border-strong">·</span>
                <span className="text-body-sm text-text-muted tabular-nums">
                  <span className="text-accent font-medium">{unread}</span>{" "}
                  unread
                </span>
              </>
            )}
          </>
        )}
        {refreshBtn}
      </div>
      {/* Why these papers are here. This is one statement about the whole
          briefing, so it belongs at the level where it is true — it used to be
          repeated on every card as "Why you · <your own topic>", which meant
          the loudest element on all ten cards was the reader's own query read
          back to them. */}
      <p className="mt-1 text-meta text-text-faint">
        {topics.length > 0 && (
          <>
            matching{" "}
            <span className="text-text-muted">{topics.join(", ")}</span>
            <span className="mx-1.5 text-border-strong">·</span>
          </>
        )}
        synced {formatTimeAgo(lastRefresh) ?? "not synced yet"}
      </p>
    </header>
  );
}
