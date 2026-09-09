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

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { feedsUseAi } from "@/lib/feed/ai-tier";
import { formatTimeAgo } from "@/lib/format";
import { useProfileStore } from "@/store/profile";
import { FeedTile } from "@/components/cards/feed-tile";
import { DayStrip } from "@/components/briefing/day-strip";
import { Band } from "@/components/ui/band";
import {
  ReadingCalendar,
  daysRead,
  streakWeeks,
  useReadingDays,
} from "@/components/charts/reading-calendar";
import { PaperDigestLoader } from "@/components/digest/daily-digest";
import { LoadingSkeleton } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { emptyReason } from "@/lib/feed/empty-reason";
import { briefingDeck } from "@/lib/briefing/deck";
import { dayLine } from "@/lib/shell/masthead";
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
  // One clock per mount — the reading page's pattern. `Date.now()` in render
  // is impure and re-reads on every re-render.
  const [now] = useState(() => Date.now());
  const feedTopicsKey = useFeedStore((s) => s.feedTopicsKey);
  const feedError = useFeedStore((s) => s.feedError);
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
  const empty = emptyReason({
    isLoading,
    papersCount: papers.length,
    topicsCount: profile.researchTopics.length,
    feedError,
  });

  return (
    // The board uses the whole window now that nothing pads <main>; on a
    // 2000px display it sits 360px from both edges. The page opens with its
    // own front — the dateline and the deck — and the masthead states nothing
    // here, so the day is said once, at display size.
    <article className="mx-auto max-w-[1280px] px-6 pt-0 md:pt-5 pb-16 lg:pb-20">
      <PaperDigestLoader
        papers={papers}
        contextHint={digestContextHint}
        enabled={shouldLoadPaperDigest}
        llmOverride={digestLlmOverride}
      />

      <BriefingHead
        date={dayLine(new Date())}
        total={papers.length}
        unread={unreadCount}
        topics={profile.researchTopics}
        loading={papersLoading && papers.length === 0}
        failed={Boolean(feedError)}
        lastRefresh={lastRefresh}
        onRefresh={refreshFeed}
        isRefreshing={isLoading}
      />

      {/* The day's shape, between the sentence that says what today is and
          the cards that are it. */}
      {papers.length > 0 && (
        <DayStrip papers={papers} readIds={readItems} now={now} />
      )}

      {/* The deck already says what is being looked for. */}
      {papersLoading && papers.length === 0 && <LoadingSkeleton label={null} />}

      {empty && (
        <div className="mx-auto max-w-[820px]">
          <BriefingEmpty
            reason={empty}
            errorDetail={feedError}
            onRetry={() => void loadFeed({ lanes: ["papers"] })}
            onRefresh={refreshFeed}
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

      {/* After the day's papers, not before them: the brief opens on what
          there is to read and closes on what has been read. */}
      {papers.length > 0 && <ReadingStrip />}
    </article>
  );
}

/** Eight weeks: two months is enough to see a habit and short enough to sit
 *  under the day's papers without becoming a second page. */
const STRIP_WEEKS = 8;

const READING_STRIP = {
  heading: "Your reading",
  summary: (days: number, of: number, streak: number) =>
    `${days} of the last ${of} days` +
    (streak > 0 ? ` \u00b7 ${streak}-week streak` : ""),
};

/**
 * Peer's own chart, at the foot of the brief — the eight weeks behind today.
 *
 * The briefing had no chart at all and the profile had the only one, which is
 * the wrong way round: the reading habit belongs on the page you open every
 * day, and the profile is where you go to change a setting. It is the same
 * component the profile draws, at eight weeks instead of eighteen and with
 * its rules off.
 *
 * Renders nothing until something has been read — never a placeholder grid,
 * and never a streak counted off invented weeks.
 */
function ReadingStrip() {
  const cells = useReadingDays(STRIP_WEEKS);
  if (!cells) return null;
  const days = daysRead(cells);
  const streak = streakWeeks(cells, STRIP_WEEKS);

  return (
    <Band label={READING_STRIP.heading} className="mt-16">
      <p className="font-mono text-caption text-text-faint mt-3 mb-3">
        {READING_STRIP.summary(days, STRIP_WEEKS * 7, streak)}
      </p>
      <ReadingCalendar cells={cells} weeks={STRIP_WEEKS} labels={false} />
    </Band>
  );
}

// The page's front: the date as the headline, one sentence of reading type
// under it, and the sync state at the right — the only small item, because
// it is status. Two lines of small print used to stand here (the masthead's
// counts and a mono "matching … · synced 4m ago"); a front page opens with a
// dateline, not a status bar. A failed load still says so, in red, and never
// "synced just now" (feed.ts keeps the old lastRefresh on error).
function BriefingHead({
  date,
  total,
  unread,
  topics,
  loading,
  failed = false,
  lastRefresh,
  onRefresh,
  isRefreshing,
}: {
  date: string;
  total: number;
  unread: number;
  topics: string[];
  loading: boolean;
  /** The last paper load failed; say so instead of a sync time. */
  failed?: boolean;
  lastRefresh: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const deck = briefingDeck({ total, unread, topics, loading });
  return (
    // One flex container, three children, two arrangements: from sm the
    // status sits at the right of the dateline and the deck runs under both;
    // on a phone the dateline takes the whole width (beside a 150px status
    // cluster it broke into three lines), the deck follows, and the status
    // closes the front on its own line at the right.
    <header className="mt-2 md:mt-4 flex flex-wrap items-end gap-x-4">
      {/* The date is computed on the server too; the timezones can differ
          around midnight, and a warning would not change what is shown. */}
      <h1
        suppressHydrationWarning
        className="w-full sm:w-auto sm:min-w-0 font-display font-normal text-display sm:text-display-lg leading-[1.05] tracking-[-0.02em] text-heading text-balance"
      >
        {date}
      </h1>
      <div className="order-3 sm:order-none ml-auto mt-3 sm:mt-0 flex shrink-0 items-center gap-1 sm:pb-1 font-mono text-meta text-text-faint whitespace-nowrap">
          {failed ? (
            <span className="text-red">sync failed</span>
          ) : lastRefresh ? (
            <span>synced {formatTimeAgo(lastRefresh)}</span>
          ) : (
            <span>not synced yet</span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh briefing"
            title="Refresh briefing (r)"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary/80 hover:text-text transition-[color,background-color,transform] duration-150 ease-snap active:scale-90 disabled:opacity-50 disabled:cursor-wait"
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
      </div>
      {/* Why these papers are here and how far along the day is, as one
          sentence. It used to be repeated on every card as "Why you · <your
          own topic>", which made the loudest element on all ten cards the
          reader's own query read back to them. */}
      {deck.length > 0 && (
        // `w-full` on the paragraph, the measure on a span inside it: a
        // max-width on the flex item itself caps its hypothetical size, and
        // at 62ch it no longer forced a new row — it slid up beside the date.
        <p className="order-2 sm:order-none w-full mt-3 font-display text-title-lg leading-[1.4] text-text-muted">
          <span className="block measure text-balance">
            {deck.map((segment, i) => (
              <span key={i} className={segment.tone === "heading" ? "text-heading" : undefined}>
                {segment.text}
              </span>
            ))}
          </span>
        </p>
      )}
    </header>
  );
}

// Nothing to show — and three different reasons for it, each with its own
// answer. This replaces a single "Your briefing is still waking up… Set up
// profile" that was shown for all three, including to a reader whose topics
// were set and whose connection had simply dropped. Display serif, one line,
// a real button; left-aligned in the header's column rather than floating in
// the middle of an empty page.
function BriefingEmpty({
  reason,
  errorDetail,
  onRetry,
  onRefresh,
}: {
  reason: "no-topics" | "error" | "empty";
  errorDetail: string | null;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const copy = {
    "no-topics": {
      title: "What are you working on?",
      line: "Peer builds tomorrow’s briefing from your topics.",
    },
    error: {
      title: "Couldn’t reach the paper sources.",
      line: "Check your connection, then try again.",
    },
    empty: {
      title: "Nothing new for these topics today.",
      line: "Peer only sends what is new and relevant. Refresh to look again, or widen your topics.",
    },
  }[reason];

  return (
    <section className="mt-16 measure">
      <h2 className="font-display text-display-sm font-normal leading-[1.15] tracking-[-0.015em] text-heading text-balance">
        {copy.title}
      </h2>
      <p className="mt-3 text-body-sm text-text-muted leading-relaxed">{copy.line}</p>
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {reason === "no-topics" && (
          <Link href="/profile" className={buttonVariants({ tone: "primary", size: "lg" })}>
            Set up profile
          </Link>
        )}
        {reason === "error" && (
          <>
            <button
              type="button"
              onClick={onRetry}
              title={errorDetail ?? undefined}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              Try again
            </button>
            <Link href="/profile" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              Edit topics
            </Link>
          </>
        )}
        {reason === "empty" && (
          <>
            <button
              type="button"
              onClick={onRefresh}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              Refresh
            </button>
            <Link href="/profile" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              Widen topics
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
