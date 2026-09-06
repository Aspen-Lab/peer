"use client";

// Compact tile for the dense feed grid (Xiaohongshu-PC density).
// One component that switches on item kind. Rendered in a 1/2/3/4-col
// grid; designed for ~280–340px wide cards.

import { useState } from "react";
import Link from "next/link";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { formatDayAge } from "@/lib/format";
import { pickSkimSentence } from "@/lib/papers/skim";
import { sourceLabel } from "@/lib/papers/plate-terms";
import { useResolvedFigure } from "@/components/paper-figure";
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

/**
 * Card venue label. OpenAlex returns the repository plus its host institution —
 * "Zenodo (CERN European Organization for Nuclear Research)", "HAL (Le Centre
 * pour la Communication Scientifique Directe)". At card width the parenthetical
 * ate the whole line and truncated mid-word, pushing the published date off the
 * end. The name before the bracket is the part that identifies the venue.
 */
export function shortVenue(venue: string | null | undefined): string | null {
  const raw = venue?.trim();
  if (!raw) return null;
  const withoutHost = raw.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return withoutHost.length > 0 ? withoutHost : raw;
}

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

/**
 * The paper's own figure, lazily resolved per card after the feed paints.
 *
 * Peer has had a rule-based figure extractor (`lib/figures/`) and a route built
 * for exactly this — `/api/figure`'s own header reads "hit per-card after feed
 * loads" — and no card had ever called it. The feed rendered ten identical
 * blocks of text. Nothing here needs a model key, so figures appear on a
 * deployment with no credentials configured.
 *
 * Renders nothing at all until an image resolves, so a paper without figures
 * keeps the plain card rather than showing a grey placeholder.
 */
// Colours are the plate's own ink, relative to the mat — not the card's text
// colours. On dark the mat is off-white, and the card's near-white heading
// colour would vanish on it.
const PLATE_TERM_CLASS = [
  "text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]",
  "text-[clamp(17px,5.8cqw,23px)] italic text-[var(--plate-ink-muted)]",
  "text-[clamp(14px,4.6cqw,18px)] text-[var(--plate-ink-faint)]",
];

/**
 * The plate — the card's visual element, present on every card at the same
 * offset and the same 16:9 ratio.
 *
 * When the extractor finds the paper's own figure, the figure fills it, matted
 * rather than bled: `object-contain` on a mat, because cropping a scientific
 * figure destroys its axis labels. When it does not, the window holds the
 * paper's own terms set in the display serif — a composition, not a picture, so
 * the card gains a visual without gaining ornament, and nothing on it is
 * invented. `terms` is allocated across the whole briefing by
 * `allocatePlateTerms` so the field's two failure modes (the reader's own query
 * echoed on all ten cards; the same concept headlining half of them) cannot
 * reach the page.
 */
function PaperPlate({ paper, terms }: { paper: Paper; terms: string[] }) {
  const figure = useResolvedFigure({
    itemId: paper.id,
    url: paper.linkPaper ?? paper.linkArxiv,
    doi: paper.doi,
    paperTitle: paper.title,
  });
  // Keyed on the URL rather than a boolean + effect, so a new figure resolving
  // for the same card clears the failure by itself. Finding a figure URL is not
  // the same as being able to show it — biorxiv answers 401 for every one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = figure.imageUrl;
  const showFigure = Boolean(src) && !figure.hideFigure && failedSrc !== src;

  const year = paper.publishedDate?.slice(0, 4);
  const fallbackVenue = shortVenue(paper.venue) ?? sourceLabel(paper.id);

  return (
    <div className="tile-cover overflow-hidden aspect-[16/9] @container">
      {showFigure ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src as string}
            alt={figure.caption ?? ""}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            // A cached image fires `load` before React attaches a handler, so
            // the ref checks `complete` too.
            ref={(node) => {
              if (node?.complete && node.naturalWidth > 0) {
                node.classList.remove("opacity-0");
              }
            }}
            onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
            onError={() => setFailedSrc(src)}
            className="h-full w-full object-contain opacity-0 transition-opacity duration-[320ms] ease-snap"
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col justify-center px-[7%] py-3">
          {terms.length > 0 ? (
            <>
              <div className="flex gap-[5%]">
                <div className="flex flex-col gap-[0.28em] pt-[0.34em] font-mono text-micro tabular-nums tracking-[0.1em] text-[var(--plate-ink-faint)]">
                  {terms.map((term, index) => (
                    <span key={term} className="leading-[1.5]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <div className="min-w-0 flex flex-col gap-[0.1em]">
                  {terms.map((term, index) => (
                    <span
                      key={term}
                      className={`font-display leading-[1.06] tracking-[-0.02em] truncate ${PLATE_TERM_CLASS[index]}`}
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
              <span
                aria-hidden
                className="mt-[0.7em] ml-[calc(5%+2.1em)] h-px w-[34%] bg-[var(--plate-ink-faint)]"
              />
            </>
          ) : (
            // Nothing usable to set. The venue is always available — every id
            // carries a "<source>:" prefix — so the plate is never empty.
            <div className="flex flex-col gap-[0.15em]">
              <span className="font-display italic leading-[1.06] tracking-[-0.02em] truncate text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]">
                {fallbackVenue}
              </span>
              {year && (
                <span className="font-mono tabular-nums tracking-[0.2em] text-[clamp(14px,4.6cqw,18px)] text-[var(--plate-ink-faint)]">
                  {year}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
          <span className="text-micro text-text-faint uppercase tracking-[0.13em] truncate">
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
