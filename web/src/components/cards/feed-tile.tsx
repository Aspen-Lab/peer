"use client";

// Compact tile for the dense feed grid (Xiaohongshu-PC density).
// One component that switches on item kind. Rendered in a 1/2/3/4-col
// grid; designed for ~280–340px wide cards.

import Link from "next/link";
import type { Paper, Event, Job } from "@/types";
import { useFeedStore } from "@/store/feed";
import { formatDayAge, formatDate, formatMatchPct } from "@/lib/format";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import { isOnlineOnly } from "@/lib/opportunities/facets";
import { chipTones } from "@/components/ui/chip";
import {
  OpportunityRelevanceBar,
  opportunityRelevanceCardProps,
} from "@/components/opportunities/opportunity-relevance-card";

type FeedItem =
  | { kind: "paper"; data: Paper }
  | { kind: "event"; data: Event }
  | { kind: "job"; data: Job };

interface RelevanceScored {
  relevanceScore?: number;
}

function tileShellClass(isRead: boolean) {
  return cn(
    cardShell({ radius: "xl", padding: "sm" }),
    "relative hover:-translate-y-[1px]",
    isRead && "opacity-70 hover:opacity-100",
  );
}

type BadgeKind = "paper" | "event" | "job" | "discussion";

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

function EventIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </svg>
  );
}

function JobIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}

// ── Inline metadata icons (10px) ──────────────────────────────

function CalendarMini() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function PinMini() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

function GlobeMini() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function BuildingMini() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
      <path d="M16 9h3a2 2 0 0 1 2 2v10" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </svg>
  );
}

// ── Badge / chip ──────────────────────────────────────────────

const KIND_ICON: Record<BadgeKind, () => React.ReactElement> = {
  paper: PaperIcon,
  event: EventIcon,
  job: JobIcon,
  discussion: DiscussionIcon,
};

const KIND_LABEL: Record<BadgeKind, string> = {
  paper: "Paper",
  event: "Event",
  job: "Job",
  discussion: "Discussion",
};

const KIND_TONE: Record<BadgeKind, string> = {
  paper: chipTones.accent,
  event: chipTones.tag,
  job: chipTones.link,
  discussion: "text-text-muted bg-bg-secondary/70",
};

// Vertical accent stripe on the left edge — at-a-glance category cue.
const KIND_STRIPE: Record<BadgeKind, string> = {
  paper: "bg-accent/55",
  event: "bg-tag/55",
  job: "bg-link/55",
  discussion: "bg-text-faint/40",
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

function KindStripe({ kind }: { kind: BadgeKind }) {
  return (
    <span
      aria-hidden
      className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r ${KIND_STRIPE[kind]}`}
    />
  );
}

function ScoreChip({ scored }: { scored: RelevanceScored }) {
  const pct = formatMatchPct(scored.relevanceScore);
  if (pct == null) return null;
  return (
    <span
      className="text-micro tabular-nums text-text-faint shrink-0"
    >
      {pct}%
    </span>
  );
}

function MetaItem({ icon: Icon, children }: { icon: () => React.ReactElement; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className="text-text-faint/80 shrink-0">
        <Icon />
      </span>
      <span className="truncate">{children}</span>
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
function FeedbackButtons({
  isLiked,
  onLike,
  onDismiss,
}: {
  isLiked: boolean;
  onLike: () => void;
  onDismiss: () => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
  return (
    <>
      <button
        type="button"
        onClick={stop(onLike)}
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
      <button
        type="button"
        onClick={stop(onDismiss)}
        aria-label="Not interested — show less like this"
        title="Not interested"
        className="p-1.5 rounded-md text-text-faint hover:text-red hover:bg-red/10 transition-colors active:scale-90"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
        </svg>
      </button>
    </>
  );
}

// ── Paper tile ────────────────────────────────────────────────

const SELECTED_BG = "color-mix(in srgb, var(--color-accent) 15%, var(--color-surface))";

export function resolvePaperTileSummary(
  paper: Pick<Paper, "summaryIntro" | "relevanceReason">,
  storedSummary?: string,
): string {
  const digestSentence = storedSummary?.trim();
  if (digestSentence) return digestSentence;

  const abstractSentences = paper.summaryIntro
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (abstractSentences) return abstractSentences;

  return paper.relevanceReason.trim() || "Open this paper for details.";
}

function PaperTile({ paper, isRead, selected }: { paper: Paper; isRead: boolean; selected?: boolean }) {
  const savePaper = useFeedStore((s) => s.savePaper);
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
    <Link
      href={`/papers/${paper.id}`}
      className={tileShellClass(isRead)}
      style={{
        ...(selected ? { background: SELECTED_BG, transition: "background 0.3s" } : { transition: "background 0.3s" }),
      }}
    >
      <KindStripe kind={kind} />
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
      <h3 className="text-body-lg font-semibold text-heading leading-[1.3] tracking-[-0.005em] line-clamp-2 min-h-[40px]">
        {paper.title}
      </h3>
      <p
        className="text-body-sm sm:text-meta text-text-muted mt-2 leading-[1.6] sm:leading-[1.55] line-clamp-3 font-reading"
      >
        {summary}
      </p>
      <div className="mt-3.5 pt-2.5 border-t border-border/60 flex items-center gap-1 min-w-0">
        <span className="text-caption text-text-faint truncate mr-1">
          {authorLine}
        </span>
        <span className="flex-1" aria-hidden />

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
          onSave={() => savePaper(paper)}
        />
      </div>
    </Link>
  );
}

// ── Event tile ────────────────────────────────────────────────

function EventTile({ event, isRead }: { event: Event; isRead: boolean }) {
  const saveEvent = useFeedStore((s) => s.saveEvent);
  const moreLikeEvent = useFeedStore((s) => s.moreLikeEvent);
  const notInterestedEvent = useFeedStore((s) => s.notInterestedEvent);
  const isSaved = useFeedStore((s) =>
    s.savedEvents.some((e) => e.id === event.id),
  );
  const feedback = useFeedStore(
    (s) => s.eventFeedback[event.id] ?? event.feedback,
  );
  const isLiked = feedback === "moreLikeThis" || feedback === "liked";
  return (
    <Link
      href={`/events/${event.id}`}
      className={tileShellClass(isRead)}
      {...opportunityRelevanceCardProps(event.relevanceScore)}
    >
      {!Number.isFinite(event.relevanceScore) ? (
        <KindStripe kind="event" />
      ) : (
        <OpportunityRelevanceBar score={event.relevanceScore} />
      )}
      <div className="flex items-center gap-2 mb-2.5">
        <KindBadge kind="event" />
        <span className="flex-1" aria-hidden />
        <ScoreChip scored={event} />
      </div>
      <h3 className="text-body-lg font-semibold text-heading leading-[1.3] tracking-[-0.005em] line-clamp-2 min-h-[40px]">
        {event.name}
      </h3>
      <div className="text-caption text-text-faint mt-2 flex items-center gap-2.5 min-w-0">
        <MetaItem icon={CalendarMini}>{formatDate(event.date, "short")}</MetaItem>
        {/* B20-01, render site 4 of 6. The ICON moves with the label on
            purpose: a globe beside "Rome, Italy" would be the fix
            contradicting itself one line up. */}
        {(event.isOnline || event.location) && (
          <MetaItem icon={isOnlineOnly(event) ? GlobeMini : PinMini}>
            {isOnlineOnly(event) ? "Online" : event.location}
          </MetaItem>
        )}
      </div>
      <p
        className="text-body-sm sm:text-meta text-text-muted mt-2.5 leading-[1.6] sm:leading-[1.55] line-clamp-3 font-reading"
      >
        {event.relevanceReason}
      </p>
      {event.facetPreferenceReason && (
        <p className="mt-2 text-caption font-semibold text-accent">
          {event.facetPreferenceReason}
        </p>
      )}
      <div className="mt-3.5 pt-2.5 border-t border-border/60 flex items-center gap-1">
        <span className="text-micro text-text-faint uppercase tracking-[0.14em] truncate mr-1">
          {event.type}
        </span>
        <span className="flex-1" aria-hidden />
        <FeedbackButtons
          isLiked={isLiked}
          onLike={() => moreLikeEvent(event)}
          onDismiss={() => notInterestedEvent(event)}
        />
        <SaveButton isSaved={isSaved} onSave={() => saveEvent(event)} />
      </div>
    </Link>
  );
}

// ── Job tile ──────────────────────────────────────────────────

function JobTile({ job, isRead }: { job: Job; isRead: boolean }) {
  const saveJob = useFeedStore((s) => s.saveJob);
  const moreLikeJob = useFeedStore((s) => s.moreLikeJob);
  const notInterestedJob = useFeedStore((s) => s.notInterestedJob);
  const isSaved = useFeedStore((s) =>
    s.savedJobs.some((j) => j.id === job.id),
  );
  const feedback = useFeedStore(
    (s) => s.jobFeedback[job.id] ?? job.feedback,
  );
  const isLiked = feedback === "moreLikeThis" || feedback === "liked";
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={tileShellClass(isRead)}
      {...opportunityRelevanceCardProps(job.relevanceScore)}
    >
      {!Number.isFinite(job.relevanceScore) ? (
        <KindStripe kind="job" />
      ) : (
        <OpportunityRelevanceBar score={job.relevanceScore} />
      )}
      <div className="flex items-center gap-2 mb-2.5">
        <KindBadge kind="job" />
        <span className="flex-1" aria-hidden />
        <ScoreChip scored={job} />
      </div>
      <h3 className="text-body-lg font-semibold text-heading leading-[1.3] tracking-[-0.005em] line-clamp-2 min-h-[40px]">
        {job.roleTitle}
      </h3>
      <div className="text-caption text-text-faint mt-2 flex items-center gap-2.5 min-w-0">
        {job.companyOrLab && <MetaItem icon={BuildingMini}>{job.companyOrLab}</MetaItem>}
        {(job.isRemote || job.location) && (
          <MetaItem icon={job.isRemote ? GlobeMini : PinMini}>
            {job.isRemote ? "Remote" : job.location}
          </MetaItem>
        )}
      </div>
      <p
        className="text-body-sm sm:text-meta text-text-muted mt-2.5 leading-[1.6] sm:leading-[1.55] line-clamp-3 font-reading"
      >
        {job.matchReason}
      </p>
      {job.facetPreferenceReason && (
        <p className="mt-2 text-caption font-semibold text-accent">
          {job.facetPreferenceReason}
        </p>
      )}
      <div className="mt-3.5 pt-2.5 border-t border-border/60 flex items-center gap-1">
        <span className="text-micro text-text-faint uppercase tracking-[0.14em] truncate mr-1">
          {job.keyRequirements[0] || "Role"}
        </span>
        <span className="flex-1" aria-hidden />
        <FeedbackButtons
          isLiked={isLiked}
          onLike={() => moreLikeJob(job)}
          onDismiss={() => notInterestedJob(job)}
        />
        <SaveButton isSaved={isSaved} onSave={() => saveJob(job)} />
      </div>
    </Link>
  );
}

// ── Public ────────────────────────────────────────────────────

export function FeedTile({ item, selected }: { item: FeedItem; selected?: boolean }) {
  const isRead = useFeedStore((s) => !!s.readItems[item.data.id]);
  if (item.kind === "paper") return <PaperTile paper={item.data} isRead={isRead} selected={selected} />;
  if (item.kind === "event") return <EventTile event={item.data} isRead={isRead} />;
  return <JobTile job={item.data} isRead={isRead} />;
}
