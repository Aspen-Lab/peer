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

import { useEffect, useMemo, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { feedsUseAi } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import { formatTimeAgo } from "@/lib/format";
import { useProfileStore } from "@/store/profile";
import { FeedTile } from "@/components/cards/feed-tile";
import { StarterStrip } from "@/components/briefing/starter-strip";
import { STARTER_TOPICS, isStarterFeed } from "@/lib/feed/starter-topics";
import { SearchBox } from "@/components/briefing/search-box";
import { UploadButton } from "@/components/briefing/upload-button";
import { Band } from "@/components/ui/band";
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
import { LibraryGraph, type GraphSteer } from "@/components/charts/library-graph";
import { termLean } from "@/lib/preferences/ledger";
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
          of everything read was the last thing on the screen anyone reached.
          At the right of the same line, the two ways out of it: upload your
          own PDF, or leave for /search rather than searching here (see
          briefing/search-box.tsx, briefing/upload-button.tsx). Both live in
          their own wrapper so `justify-between` pushes the *pair* to the
          right, not one to each end of the row. The pair stands even when
          the strip does not; looking for a paper does not depend on having
          read any yet. */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        {papers.length > 0 ? (
          <ReadingStrip papers={papers} readerTopics={starter ? [] : profile.researchTopics} />
        ) : (
          <span aria-hidden />
        )}
        {/* `ml-auto`: `ReadingStrip` renders nothing for a reader with no
            library yet, and a lone child under `justify-between` sits at the
            START — the pair would jump left on exactly the first visit. */}
        <div className="ml-auto flex items-start gap-2 sm:mt-2">
          <UploadButton />
          <SearchBox />
        </div>
      </div>

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
        // today's papers — the cards, straight under their band the way the
        // graph sits under its own. A bar chart of the day's match scores
        // stood between them until v0.33.1: ten near-equal grey bars whose
        // "shape of the day" was flat on most days, and whose "dim ones are
        // read" the deck already says in words.
        <Band label={TODAY.heading} gap="none">
        {/* Masonry, not a fixed grid. Roughly four papers in ten carry an
            extractable figure, so card heights genuinely differ; a uniform
            grid either ragged-edges every row or reserves dead space on the
            six cards with no image. CSS columns let each card be its own
            height. */}
        <div className="mt-4 board-columns gap-4 [column-fill:_balance]">
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

/** The day's section: its cards. */
const TODAY = { heading: "Today's papers" };

const READING_STRIP = { heading: "Your reading" };

/**
 * Your reading: the library graph — every paper read or kept, the terms that
 * join them, and today's papers placed against it.
 *
 * The eight-week reading calendar that sat under it is gone from the
 * briefing: it answered "which days", which the graph does not need and the
 * briefing did not either. /profile keeps its own, labelled version.
 *
 * Renders nothing until something has been read or kept — never a
 * placeholder.
 */
function ReadingStrip({ papers, readerTopics }: { papers: Paper[]; readerTopics: string[] }) {
  const library = useFeedStore((s) => s.library);
  const savedPapers = useFeedStore((s) => s.savedPapers);
  const readItems = useFeedStore((s) => s.readItems);
  // Steering from the graph — a lean on a term (the preference ledger, which
  // re-ranks today's papers at once) or following it (explore topics, from
  // tomorrow's search).
  const ledger = useProfileStore((s) => s.profile.preferenceLedger);
  const softTopics = useProfileStore((s) => s.profile.softTopics);
  const leanOnTerm = useProfileStore((s) => s.leanOnTerm);
  const followTerm = useProfileStore((s) => s.followTerm);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  // A lean answers on the board below, not tomorrow: the day's pool is
  // already built and the ledger is applied when it is read, so a plain load
  // re-ranks it — no search, no model call. Pressed three times in a second,
  // it loads once.
  const rerank = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (rerank.current) clearTimeout(rerank.current);
    },
    [],
  );
  const steer = useMemo<GraphSteer>(
    () => ({
      leanOf: (label) => termLean(ledger, label),
      followed: (label) =>
        (softTopics ?? []).some((t) => t.trim().toLowerCase() === label.trim().toLowerCase()),
      lean: (label, lean) => {
        leanOnTerm(label, lean);
        if (rerank.current) clearTimeout(rerank.current);
        rerank.current = setTimeout(() => void loadFeed({ lanes: ["papers"] }), 400);
      },
      follow: followTerm,
    }),
    [ledger, softTopics, leanOnTerm, followTerm, loadFeed],
  );
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
  if (graph.counts.read + graph.counts.saved === 0) return null;

  return (
    <Band label={READING_STRIP.heading} gap="none">
      <div className="mt-4">
        <LibraryGraph graph={graph} steer={steer} />
      </div>
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
