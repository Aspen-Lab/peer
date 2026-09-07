"use client";

// Compact tile for the dense feed grid (Xiaohongshu-PC density).
// One component that switches on item kind. Rendered in a 1/2/3/4-col
// grid; designed for ~280–340px wide cards.

import Link from "next/link";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { formatDayAge } from "@/lib/format";
import { pickSkimSentence } from "@/lib/papers/skim";
import { PaperPlate, shortVenue } from "@/components/cards/paper-plate";
import { SwipeableCard } from "@/components/cards/swipe-card";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import { chipTones } from "@/components/ui/chip";

type FeedItem = { kind: "paper"; data: Paper };


/**
 * The paper card is a cover card: the plate bleeds to the top edge and takes
 * the card's own corners, and the text block sits below it with real air.
 * No stripe — the 3px accent rail on the left edge encoded paper/event/job on a
 * mixed feed, and on a papers-only feed it was the same mark on every card,
 * i.e. decoration. No hairline in the footer: spacing separates.
 */
function paperShellClass(isRead: boolean) {
  return cn(
    cardShell({ radius: "2xl", padding: "none" }),
    "group/tile relative overflow-hidden",
    isRead && "tile-read",
  );
}

type BadgeKind = "paper" | "discussion";

// "Paper" is reserved for items from academic APIs (arXiv, OpenAlex).
// Anything else (HN today, future blog/social adapters) renders as
// "Discussion" so users don't mistake a thread for a peer-reviewed work.
// Allowlist by id prefix — strict on purpose.
const ACADEMIC_ID_PREFIXES = ["arxiv:", "openalex:"];

// `shortVenue` moved next to the plate (its other user); re-exported so the
// page and `short-venue.test.ts` keep importing it from here.
export { shortVenue };

function paperBadgeKind(paper: Paper): BadgeKind {
  const isAcademic = ACADEMIC_ID_PREFIXES.some((p) => paper.id.startsWith(p));
  return isAcademic ? "paper" : "discussion";
}

// ── Category icons (12px line, currentColor) ──────────────────

function PaperIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function DiscussionIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" />
      <circle cx="9" cy="12" r="0.6" fill="currentColor" />
      <circle cx="13" cy="12" r="0.6" fill="currentColor" />
      <circle cx="17" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

// ── Inline metadata icons (10px) ──────────────────────────────

// ── Badge / chip ──────────────────────────────────────────────

const KIND_ICON: Record<BadgeKind, () => React.ReactElement> = {
  paper: PaperIcon,
  discussion: DiscussionIcon,
};

const KIND_LABEL: Record<BadgeKind, string> = {
  paper: "Paper",
  discussion: "Discussion",
};

const KIND_TONE: Record<BadgeKind, string> = {
  paper: chipTones.accent,
  discussion: "text-text-muted bg-bg-secondary/70",
};


function KindBadge({ kind }: { kind: BadgeKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.14em] pl-1.5 pr-2 py-[3px] rounded-md ${KIND_TONE[kind]}`}
    >
      <Icon />
      {KIND_LABEL[kind]}
    </span>
  );
}


function SaveButton({
  isSaved,
  onSave,
}: {
  isSaved: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSave();
      }}
      aria-label={isSaved ? "Unsave" : "Save"}
      className={[
        "p-1.5 rounded-md transition-colors active:scale-90",
        isSaved
          ? "text-accent bg-accent-dim/60 hover:bg-accent-dim"
          : "text-text-faint hover:text-heading hover:bg-bg-secondary/60",
      ].join(" ")}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill={isSaved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
    </button>
  );
}

// Like + Not-interested pair shared by the event/job tiles (papers keep
// their original inline markup).

// ── Paper tile ────────────────────────────────────────────────

const SELECTED_BG = "color-mix(in srgb, var(--color-accent) 15%, var(--color-surface))";

export function resolvePaperTileSummary(
  paper: Pick<
    Paper,
    "summaryIntro" | "summaryResultDiscussion" | "relevanceReason"
  >,
  storedSummary?: string,
): string {
  // A real digest sentence still wins when a key is configured.
  const digestSentence = storedSummary?.trim();
  if (digestSentence) return digestSentence;

  // Without one, read the whole abstract and pick the sentence that says what
  // the paper did. This used to take `summaryIntro` — the first one or two
  // sentences — which for an academic abstract is the motivation, and reads
  // identically across every paper in a field.
  const skim = pickSkimSentence(
    paper.summaryIntro,
    paper.summaryResultDiscussion,
  );
  if (skim) return skim;

  return paper.relevanceReason.trim() || "Open this paper for details.";
}

function PaperTile({ paper, isRead, selected, plateTerms = [] }: { paper: Paper; isRead: boolean; selected?: boolean; plateTerms?: string[] }) {
  const savePaper = useFeedStore((s) => s.savePaper);
  const unsavePaper = useFeedStore((s) => s.unsavePaper);
  const moreLikePaper = useFeedStore((s) => s.moreLikePaper);
  const notInterestedPaper = useFeedStore((s) => s.notInterestedPaper);
  const storedSummary = useFeedStore((s) => s.paperSummaries[paper.id]);

  const isLiked = paper.feedback === "moreLikeThis" || paper.feedback === "liked";
  const summary = resolvePaperTileSummary(paper, storedSummary);

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  const kind = paperBadgeKind(paper);
  const authorLine =
    paper.authors.slice(0, 2).join(", ") +
    (paper.authors.length > 2 ? ` +${paper.authors.length - 2}` : "");
  // The meta line carries what actually differs between two cards in the same
  // briefing: where it was published and how old it is. `paper.source` used to
  // own a slot here — a six-value enum ("arxiv" | four ML conferences |
  // "other") that resolves to the literal string "other" for everything
  // outside those venues, i.e. most of biology, chemistry and physics.
  const age = formatDayAge(paper.publishedDate);
  const metaBits = [shortVenue(paper.venue), age].filter(Boolean) as string[];

  return (
    <SwipeableCard
      onSwipeRight={() => (paper.isSaved ? unsavePaper(paper.id) : savePaper(paper))}
      onSwipeLeft={() => notInterestedPaper(paper)}
      rightLabel={paper.isSaved ? "Unsave" : "Save"}
      leftLabel="Not interested"
      rightActive={paper.isSaved}
    >
      <Link
        href={`/papers/${paper.id}`}
        className={paperShellClass(isRead)}
        style={{
          ...(selected ? { background: SELECTED_BG, transition: "background 0.3s" } : { transition: "background 0.3s" }),
        }}
      >
        <PaperPlate paper={paper} terms={plateTerms} />
        <div className="px-5 pt-4 pb-4">
        {/* Venue and age lead, because they are what differs between two cards in
            the same briefing. The kind badge appears only for a "discussion" —
            the exception worth flagging, so a forum thread is never mistaken for
            peer-reviewed work. A "Paper" badge on every card of a papers-only
            feed said nothing, and it said it twice: `paper.source` repeated it
            at the bottom. */}
        <div className="flex items-baseline gap-2 mb-2 min-w-0">
          {kind !== "paper" && <KindBadge kind={kind} />}
          {/* Sentence case, in the mono the reading page uses for the same
              fact. Set in tracked capitals this was the last small-caps label
              in the product, and it shouted the one line on the card that is
              pure filing. */}
          <span className="font-mono text-caption text-text-faint truncate">
            {metaBits.join(" · ")}
          </span>
        </div>
        <h3 className="font-display text-[19px] font-normal text-heading leading-[1.2] tracking-[-0.015em] line-clamp-3">
          {paper.title}
        </h3>
        <p
          className="text-body-sm sm:text-meta text-text-muted mt-2 leading-[1.6] sm:leading-[1.55] line-clamp-3 font-reading"
        >
          {summary}
        </p>
        <div className="tile-chrome mt-4 flex items-center gap-1 min-w-0">
          <span className="text-caption text-text-faint truncate mr-1">
            {authorLine}
          </span>
          <span className="flex-1" aria-hidden />
          <span className="tile-actions flex items-center gap-1">

          {/* Like */}
          <button
            type="button"
            onClick={stop(() => moreLikePaper(paper))}
            aria-pressed={isLiked}
            aria-label="Like — show more like this"
            title="Like"
            className={[
              "p-1.5 rounded-md transition-colors active:scale-90",
              isLiked
                ? "text-accent bg-accent-dim/60"
                : "text-text-faint hover:text-accent hover:bg-accent-dim/60",
            ].join(" ")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zM7 10l4-7a2 2 0 0 1 2 2v3h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 19H7" />
            </svg>
          </button>

          {/* Dislike */}
          <button
            type="button"
            onClick={stop(() => notInterestedPaper(paper))}
            aria-label="Not interested — show less like this"
            title="Not interested"
            className="p-1.5 rounded-md text-text-faint hover:text-red hover:bg-red/10 transition-colors active:scale-90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
            </svg>
          </button>

          <SaveButton
            isSaved={!!paper.isSaved}
            // savePaper is an idempotent save — it never unsaves — so this
            // button's "Unsave" state used to re-save. Same branch the
            // keyboard's `s` and the swipe use.
            onSave={() =>
              paper.isSaved ? unsavePaper(paper.id) : savePaper(paper)
            }
          />
          </span>
        </div>
        </div>
      </Link>
    </SwipeableCard>
  );
}

// ── Event tile ────────────────────────────────────────────────

export function FeedTile({
  item,
  selected,
  plateTerms,
}: {
  item: FeedItem;
  selected?: boolean;
  /** Allocated across the whole briefing — see lib/papers/plate-terms.ts. */
  plateTerms?: string[];
}) {
  const isRead = useFeedStore((s) => !!s.readItems[item.data.id]);
  return (
    <PaperTile
      paper={item.data}
      isRead={isRead}
      selected={selected}
      plateTerms={plateTerms}
    />
  );
}
