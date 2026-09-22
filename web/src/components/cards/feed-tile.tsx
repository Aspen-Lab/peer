"use client";

// Compact tile for the dense feed grid (Xiaohongshu-PC density).
// One component that switches on item kind. Rendered in a 1/2/3/4-col
// grid; designed for ~280–340px wide cards.

import Link from "next/link";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { formatDayAge } from "@/lib/format";
import { PaperPlate, shortVenue } from "@/components/cards/paper-plate";
import { SwipeableCard } from "@/components/cards/swipe-card";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import { topicMarkOf } from "@/lib/papers/topic-mark";
import { TopicMark } from "./topic-mark";

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
    cardShell({ padding: "none", entrance: "none" }),
    // The corner detail. Not a second ring inside the frame — the frame's own
    // last 12px into each corner, stepped up from `--nm-frame` to
    // `--nm-frame-hi`. See `@utility cropmarks` in globals.css.
    "cropmarks group/tile relative overflow-hidden",
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

// The kind mark. It used to be a tinted square box in tracked capitals at
// weight 600 — a "chip" whose own radius token is 0 — sitting two lines above
// a comment explaining that the venue line had been de-capitalised because it
// was the last small-caps label in the product. It still was one.
function KindMark() {
  return (
    <span className="eyebrow inline-flex items-center gap-1.5 text-text-muted shrink-0">
      <DiscussionIcon />
      Discussion
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
        "p-1.5 rounded-md transition-[color,background-color,border-color,scale] active:scale-90",
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


function PaperTile({ paper, isRead, selected, plateTerms = [], line, index, total = 0 }: { paper: Paper; isRead: boolean; selected?: boolean; plateTerms?: string[]; line?: string | null; index?: number; total?: number }) {
  const savePaper = useFeedStore((s) => s.savePaper);
  const unsavePaper = useFeedStore((s) => s.unsavePaper);
  const moreLikePaper = useFeedStore((s) => s.moreLikePaper);
  const notInterestedPaper = useFeedStore((s) => s.notInterestedPaper);

  const isLiked = paper.feedback === "moreLikeThis" || paper.feedback === "liked";

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  const kind = paperBadgeKind(paper);
  // What the paper is about, read off its own words — see
  // lib/papers/topic-mark.ts for why it is the subject and not the method.
  const mark = topicMarkOf({ title: paper.title, terms: plateTerms });
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
        className={cn(paperShellClass(isRead), "transition-colors")}
        // The transition belongs in the class string; only the tinted ground,
        // which is computed from the palette, has to be inline.
        style={selected ? { background: SELECTED_BG } : undefined}
      >
        <PaperPlate paper={paper} terms={plateTerms} />
        {/* `first:` — with no plate above it this block leads the card, and
            the top padding has to be the card's own rather than the shoulder
            under a picture. */}
        <div className="px-5 pt-4 pb-4 first:pt-5">
        {/* Venue and age lead, because they are what differs between two cards in
            the same briefing. The kind badge appears only for a "discussion" —
            the exception worth flagging, so a forum thread is never mistaken for
            peer-reviewed work. A "Paper" badge on every card of a papers-only
            feed said nothing, and it said it twice: `paper.source` repeated it
            at the bottom. */}
        <div className="flex items-center gap-2 mb-2 min-w-0">
          {kind !== "paper" && <KindMark />}
          {/* The card's place in today's briefing. The masonry is column-major,
              so nothing else on screen says the reading order runs down column
              one. A position, not a quality: `relevanceScore` is 55% a
              within-day percentile, is overwritten by the rerank and reordered
              past by `diversify`, so no percentage of it is a fact about this
              paper. Outside the truncated span, because a long venue must not
              eat it. */}
          {typeof index === "number" && total > 1 && (
            <>
              <span className="annotation text-text-faint tabular-nums shrink-0">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="annotation text-text-faint shrink-0" aria-hidden>
                ·
              </span>
            </>
          )}
          {/* Sentence case, in the mono the reading page uses for the same
              fact. Set in tracked capitals this was the last small-caps label
              in the product, and it shouted the one line on the card that is
              pure filing. */}
          <span className="annotation text-text-faint truncate">
            {metaBits.join(" · ")}
          </span>
          {/* The subject, at the far end of the filing line: the number and
              the venue say where this card sits, the mark says what is in
              it. Right-aligned so ten cards stack ten marks in a column the
              eye can run down without reading a word. */}
          <TopicMark
            topic={mark.key}
            label={mark.label}
            framed
            size={15}
            strokeWidth={1.5}
            className="ml-auto -my-1 group-hover/tile:text-accent"
          />
        </div>
        <h3 className="paper-line text-title-lg text-heading leading-[1.2] line-clamp-3">
          {paper.title}
        </h3>
        {/* One size, not `text-body-sm sm:text-meta` — that SHRANK to 12.5px
            at desktop width and sat a pixel above the 11.5px meta and author
            lines, so four bands of one grey with nothing loud and nothing
            quiet. The paper's own sentence stays in the paper's face; the
            affiliation that stands in for it is a field of the record, so it
            is Peer's. */}
        {line ? (
          <p className="text-body-sm text-text-muted mt-2 leading-[1.6] line-clamp-3 font-reading">
            {line}
          </p>
        ) : paper.leadAffiliation ? (
          <p className="text-body-sm text-text-faint mt-2 leading-[1.6] line-clamp-2">
            {paper.leadAffiliation}
          </p>
        ) : null}
        <div className="tile-chrome mt-4 flex items-center gap-1 min-w-0">
          {authorLine && (
            <span className="text-caption text-text-faint truncate mr-1">
              {authorLine}
            </span>
          )}
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
              "p-1.5 rounded-md transition-[color,background-color,border-color,scale] active:scale-90",
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
            className="p-1.5 rounded-md text-text-faint hover:text-red hover:bg-red/10 transition-[color,background-color,border-color,scale] active:scale-90"
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
  line,
  index,
  total,
}: {
  item: FeedItem;
  selected?: boolean;
  /** Allocated across the whole briefing — see lib/papers/plate-terms.ts. */
  plateTerms?: string[];
  /** Position in today's briefing, and how many there are. */
  index?: number;
  total?: number;
  /** Decided for the whole board — see lib/briefing/tile-lines.ts. A card
   *  cannot see that two other cards are carrying its sentence. */
  line?: string | null;
}) {
  const isRead = useFeedStore((s) => !!s.readItems[item.data.id]);
  return (
    <PaperTile
      paper={item.data}
      isRead={isRead}
      selected={selected}
      plateTerms={plateTerms}
      line={line}
      index={index}
      total={total}
    />
  );
}
