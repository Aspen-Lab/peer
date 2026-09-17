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
import { entitlementGrants } from "@/lib/entitlement/allowance";
import { formatTimeAgo } from "@/lib/format";
import { useProfileStore } from "@/store/profile";
import { FeedTile } from "@/components/cards/feed-tile";
import { DayStrip } from "@/components/briefing/day-strip";
import { StarterStrip } from "@/components/briefing/starter-strip";
import { STARTER_TOPICS, isStarterFeed } from "@/lib/feed/starter-topics";
import { Band } from "@/components/ui/band";
import {
  ReadingCalendar,
  daysRead,
  streakWeeks,
  useReadingDays,
} from "@/components/charts/reading-calendar";
import { PaperDigestLoader } from "@/components/digest/daily-digest";
import { PageContainer } from "@/components/ui/page-container";
import { LoadingSkeleton } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { emptyReason } from "@/lib/feed/empty-reason";
import { briefingDeck } from "@/lib/briefing/deck";
import { SYNC, BRIEFING_EMPTY } from "@/lib/briefing/copy";
import { EmptyState } from "@/components/ui/empty-state";
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
  const entitlement = useProfileStore((s) => s.entitlement);

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

  const canUseAiTools = feedsUseAi(profile, entitlementGrants(entitlement));
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
  // The banned list is "the query, read back at the reader". In starter mode
  // the query is the sample's own fields, so they are what must not headline
  // every card — without this each plate said "molecular biology".
  // Nothing chosen yet: the briefing is the starter sample, and the strip below
  // the dateline is where it becomes the reader's own.
  const starter = isStarterFeed(profile.researchTopics);

  const plateTerms = useMemo(
    () =>
      allocatePlateTerms(
        papers,
        starter ? [...STARTER_TOPICS] : profile.researchTopics,
      ),
    [papers, starter, profile.researchTopics],
  );

  const unreadCount = papers.filter((p) => !readItems[p.id]).length;
  // Nothing chosen yet: the briefing is the starter sample, and the strip below
  // the dateline is where it becomes the reader's own.
  const empty = emptyReason({
    isLoading,
    papersCount: papers.length,
    feedError,
  });

  return (
    // The board uses the whole window now that nothing pads <main>; on a
    // 2000px display it sits 360px from both edges. The page opens with its
    // own front — the dateline and the deck — and the masthead states nothing
    // here, so the day is said once, at display size.
    // The board is the one documented exception to `PageContainer`'s page
    // rhythm: its top is the masthead's own edge and its sections are
    // heterogeneous, so the gaps belong to the container. `space-y-*`
    // compiles to `> * + * { margin-top }` — do not restate it as a class.
    <PageContainer
      width="board"
      rhythm="none"
      className="pt-0 md:pt-5 pb-16 lg:pb-20 space-y-8 sm:space-y-10 lg:space-y-12"
    >
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
        // The sample's fields are not the reader's interests, so the deck
        // does not name them. The strip below says what they are.
        topics={starter ? [] : profile.researchTopics}
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

      {/* Setup, above the papers it is about — and only until it is done. */}
      {starter && <StarterStrip />}

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
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {papers.map((paper, index) => (
            <div
              key={paper.id}
              id={`paper-${paper.id}`}
              data-paper-id={paper.id}
              // Today's papers arrive as a stack dealt in reading order. All
              // ten used to fade up on the identical frame, which reads as the
              // page reflowing rather than as a delivery. globals.css already
              // carried the plumbing — `[style*="--i"]` in the Motion block —
              // but the delay landed on this wrapper while `animate-fade-in-up`
              // landed on the <Link> two levels down, and `animation-delay`
              // does not inherit, so all ten still arrived on one frame. Both
              // go on one element, the way the skeleton already does it.
              // Capped at 9 so the tail never exceeds 360ms.
              style={{ "--i": Math.min(index, 9) } as React.CSSProperties}
              className="mb-4 break-inside-avoid animate-fade-in-up"
            >
              <FeedTile
                item={{ kind: "paper", data: starter ? { ...paper, relevanceReason: "" } : paper }}
                plateTerms={plateTerms[paper.id]}
              />
            </div>
          ))}
        </div>
      )}

      {/* After the day's papers, not before them: the brief opens on what
          there is to read and closes on what has been read. */}
      {papers.length > 0 && <ReadingStrip />}
    </PageContainer>
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
    <Band label={READING_STRIP.heading} gap="none">
      <p className="annotation text-text-faint mt-3 mb-3">
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
    <header className="flex flex-wrap items-end gap-x-4">
      {/* The date is computed on the server too; the timezones can differ
          around midnight, and a warning would not change what is shown. */}
      <h1
        suppressHydrationWarning
        className="w-full sm:w-auto sm:min-w-0 display-line text-display sm:text-display-lg leading-[1.05] text-heading text-balance"
      >
        {date}
      </h1>
      <div className="order-3 sm:order-none ml-auto mt-3 sm:mt-0 flex shrink-0 items-center gap-1 sm:pb-1 annotation text-meta text-text-faint whitespace-nowrap">
          {isRefreshing ? (
            <span>{SYNC.syncing}</span>
          ) : failed ? (
            <span className="text-red">{SYNC.failed}</span>
          ) : lastRefresh ? (
            <span>{SYNC.synced(formatTimeAgo(lastRefresh))}</span>
          ) : (
            <span>{SYNC.never}</span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-busy={isRefreshing}
            aria-label="Refresh briefing"
            title="Refresh briefing (r)"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary/80 hover:text-text transition-[color,background-color,transform] active:scale-90 disabled:opacity-50 disabled:cursor-wait"
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
        <p className="order-2 sm:order-none w-full mt-3 font-sans text-title-lg leading-[1.45] tracking-[-0.01em] text-text-muted">
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

// Nothing to show — and two different reasons for it, each with its own
// answer. This replaced a single "Your briefing is still waking up… Set up
// profile" shown for both, including to a reader whose topics were set and
// whose connection had simply dropped. The words live in `copy.ts` with the
// rest of the briefing's fixed words; the shape is the product's one empty
// state, shared with /saved, /search, /error and /not-found.
function BriefingEmpty({
  reason,
  errorDetail,
  onRetry,
  onRefresh,
}: {
  reason: "error" | "empty";
  errorDetail: string | null;
  onRetry: () => void;
  onRefresh: () => void;
}) {
  const copy = BRIEFING_EMPTY[reason];
  return (
    <EmptyState
      title={copy.title}
      line={copy.line}
      actions={
        reason === "error" ? (
          <>
            <button
              type="button"
              onClick={onRetry}
              title={errorDetail ?? undefined}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              {BRIEFING_EMPTY.error.retry}
            </button>
            <Link href="/profile" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              {BRIEFING_EMPTY.error.edit}
            </Link>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRefresh}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              {BRIEFING_EMPTY.empty.refresh}
            </button>
            <Link href="/profile" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              {BRIEFING_EMPTY.empty.widen}
            </Link>
          </>
        )
      }
    />
  );
}
