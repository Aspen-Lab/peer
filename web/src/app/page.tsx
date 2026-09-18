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
import { useReveal } from "@/components/ui/reveal";
import { LoadingSkeleton } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { emptyReason } from "@/lib/feed/empty-reason";
import { briefingDeck } from "@/lib/briefing/deck";
import { briefingTileLines } from "@/lib/briefing/tile-lines";
import { buildLibraryGraph } from "@/lib/library/graph";
import type { Paper } from "@/types";
import { LibraryGraph } from "@/components/charts/library-graph";
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
  // The cards arrive as they are reached. `papers` is what changes which
  // cards exist; a card already revealed is never hidden again.
  useReveal([papers]);
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

  // The card's sentence, decided for the whole board: a sentence more than
  // half the day is carrying is suppressed everywhere it appears. See
  // lib/briefing/tile-lines.ts.
  const paperSummaries = useFeedStore((s) => s.paperSummaries);
  const tileLines = useMemo(
    () => briefingTileLines(papers, paperSummaries),
    [papers, paperSummaries],
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
      data-motion="reveal"
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

      {/* The library first: what you have read, with today's papers placed
          against it — so the day's cards arrive already knowing where they
          sit. It used to close the page, below ten cards, where the one view
          of everything read was the last thing on the screen anyone reached. */}
      {papers.length > 0 && (
        <ReadingStrip papers={papers} readerTopics={starter ? [] : profile.researchTopics} />
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
        // Two sections, each under its band: what you have read (above), and
        // today's papers — the day's shape, then the cards that are it. The
        // strip used to float between the two, under the graph's key and
        // beside the calendar, with nothing saying which of them it belonged to.
        <Band label={TODAY.heading} gap="none">
        <div className="mt-4">
          <DayStrip papers={papers} readIds={readItems} now={now} />
        </div>
        {/* Masonry, not a fixed grid. Roughly four papers in ten carry an
            extractable figure, so card heights genuinely differ; a uniform
            grid either ragged-edges every row or reserves dead space on the
            six cards with no image. CSS columns let each card be its own
            height. */}
        <div className="mt-6 columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {papers.map((paper, index) => (
            <div
              key={paper.id}
              id={`paper-${paper.id}`}
              data-paper-id={paper.id}
              // Each card arrives as it is reached — the reading page's approach
              // (globals.css, "The approach"), now on the board. The mount fade
              // it replaces played all ten on load, so the cards below the fold
              // had finished arriving before anyone scrolled to them. The first
              // screenful is still dealt in order, 40ms apart: `useReveal`
              // staggers the hosts that are already on screen when it runs.
              data-reveal
              className="rv mb-4 break-inside-avoid"
            >
              <FeedTile
                item={{ kind: "paper", data: paper }}
                plateTerms={plateTerms[paper.id]}
                line={tileLines[paper.id] ?? null}
                index={index}
                total={papers.length}
              />
            </div>
          ))}
        </div>
        </Band>
      )}
    </PageContainer>
  );
}

/** Eight weeks: two months is enough to see a habit and short enough to sit
 *  under the day's papers without becoming a second page. */
const STRIP_WEEKS = 8;

/** The day's section: its strip and its cards. */
const TODAY = { heading: "Today's papers" };

const READING_STRIP = {
  heading: "Your reading",
  // Weeks, not "of the last 53 days": the grid is calendar weeks and the one
  // in progress is partial, so a day count would be a number that changes its
  // denominator every morning.
  summary: (days: number, weeks: number, streak: number) =>
    `${days} ${days === 1 ? "day" : "days"} read in the last ${weeks} weeks` +
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
function ReadingStrip({ papers, readerTopics }: { papers: Paper[]; readerTopics: string[] }) {
  const cells = useReadingDays(STRIP_WEEKS);
  const library = useFeedStore((s) => s.library);
  const savedPapers = useFeedStore((s) => s.savedPapers);
  const readItems = useFeedStore((s) => s.readItems);
  // The library as a graph: what has been read or kept, joined wherever two
  // papers carry the same term — and today's papers placed against it. See
  // lib/library/graph.ts for what an edge is allowed to mean.
  const graph = useMemo(
    () =>
      buildLibraryGraph({
        library: Object.values(library ?? {}),
        saved: savedPapers,
        today: papers,
        readIds: readItems,
        readerTopics,
      }),
    [library, savedPapers, papers, readItems, readerTopics],
  );
  const hasLibrary = graph.counts.read + graph.counts.saved > 0;
  if (!cells && !hasLibrary) return null;
  const days = cells ? daysRead(cells) : 0;
  const streak = cells ? streakWeeks(cells, STRIP_WEEKS) : 0;

  return (
    <Band label={READING_STRIP.heading} gap="none">
      {hasLibrary && (
        <div className="mt-4">
          <LibraryGraph graph={graph} />
        </div>
      )}
      {cells && (
        // The reading rhythm, under the library it built: which days, not
        // which papers. Chart then sentence, left-aligned — the same figure as
        // the day's strip in the next section, so the two read as one system.
        <figure className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <ReadingCalendar cells={cells} weeks={STRIP_WEEKS} labels={false} showKey={false} />
          <figcaption className="annotation text-text-faint measure-mono self-end">
            {READING_STRIP.summary(days, STRIP_WEEKS, streak)}
          </figcaption>
        </figure>
      )}
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
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary/80 hover:text-text transition-[color,background-color,transform,scale] active:scale-90 disabled:opacity-50 disabled:cursor-wait"
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
