"use client";

import type { ItemDetailRoute } from "@/lib/navigation/item-routes";
import Link from "next/link";
import type { Paper, Event, Job } from "@/types";
import { useFeedStore } from "@/store/feed";
import { Tag, Relevance, ActionBar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PaperFigure } from "@/components/paper-figure";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";
import { isOnlineOnly } from "@/lib/opportunities/facets";

export type HeroItem =
  | { kind: "paper"; data: Paper }
  | { kind: "event"; data: Event }
  | { kind: "job"; data: Job };

export function BriefingHero({ item }: { item: HeroItem }) {
  const {
    savePaper,
    notInterestedPaper,
    moreLikePaper,
    saveEvent,
    notInterestedEvent,
    saveJob,
    notInterestedJob,
  } = useFeedStore();

  // ABC-freemium 9-05 — annotated, not cast. A ternary of template literals is
  // widened to `string`, so the annotation is what makes Next check all three
  // branches against the real route tree; `/paperz/${id}` stops compiling.
  const detail: ItemDetailRoute =
    item.kind === "paper"
      ? `/papers/${item.data.id}`
      : item.kind === "event"
        ? `/events/${item.data.id}`
        : `/jobs/${item.data.id}`;

  const title =
    item.kind === "paper"
      ? item.data.title
      : item.kind === "event"
        ? item.data.name
        : item.data.roleTitle;

  const score =
    item.kind === "paper"
      ? item.data.relevanceScore
      : item.kind === "event"
        ? item.data.relevanceScore
        : item.data.relevanceScore;

  const relevanceReason =
    item.kind === "paper"
      ? item.data.relevanceReason
      : item.kind === "event"
        ? item.data.relevanceReason
        : item.data.matchReason;

  return (
    <Link
      href={detail}
      className={cn(cardShell({ radius: "3xl", padding: "xl" }), "relative lg:p-10 overflow-hidden")}
    >
      <span
        className="absolute left-0 top-8 bottom-8 w-[3px] rounded-r-full bg-accent/80"
        aria-hidden
      />

      <p
        className="text-micro font-semibold uppercase tracking-[0.22em] text-accent mb-4"
      >
        Top pick today
      </p>

      <div className="flex items-start justify-between gap-5">
        <h2
          className="text-[26px] lg:text-[30px] font-semibold text-heading leading-[1.15] tracking-[-0.015em]"
        >
          {title}
        </h2>
        <Relevance score={score} />
      </div>

      {item.kind === "paper" && (
        <>
          <p
            className="text-body text-text-muted mt-3"
          >
            {item.data.authors.slice(0, 3).join(", ")}
            {item.data.authors.length > 3 && ` +${item.data.authors.length - 3}`}
          </p>
          <div className="flex items-center flex-wrap gap-2 mt-4">
            <Tag>Paper</Tag>
            <Tag>{item.data.venue}</Tag>
          </div>
          <PaperFigure
            itemId={item.data.id}
            url={item.data.linkPaper ?? item.data.linkArxiv}
            alt={item.data.title}
            variant="hero"
          />
          <p className="text-title text-text mt-5 leading-[1.7]">
            {item.data.relevanceReason}
          </p>
          <p className="text-body-lg text-text-muted mt-3 leading-[1.65] line-clamp-3">
            {item.data.summaryIntro}
          </p>
        </>
      )}

      {item.kind === "event" && (
        <>
          <p
            className="text-body text-text-muted mt-3"
          >
            {/* B20-01, render site 5 of 6. */}
            {formatDate(item.data.date)} ·{" "}
            {isOnlineOnly(item.data) ? "Online" : item.data.location}
          </p>
          <div className="flex items-center flex-wrap gap-2 mt-4">
            <Tag>Event</Tag>
            <Tag>{item.data.type}</Tag>
          </div>
          <p className="text-title text-text mt-5 leading-[1.7]">
            {item.data.relevanceReason}
          </p>
          <p className="text-body-lg text-text-muted mt-3 leading-[1.65] line-clamp-2">
            {item.data.shortDescription}
          </p>
        </>
      )}

      {item.kind === "job" && (
        <>
          <p
            className="text-body text-text-muted mt-3"
          >
            {[item.data.companyOrLab, item.data.isRemote ? "Remote" : item.data.location]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="flex items-center flex-wrap gap-2 mt-4">
            <Tag>Role</Tag>
            {item.data.keyRequirements.slice(0, 3).map((req) => (
              <span
                key={req}
                className="text-caption text-text-muted bg-bg-secondary/70 px-2 py-[3px] rounded-md"
              >
                {req}
              </span>
            ))}
          </div>
          <p className="text-title text-text mt-5 leading-[1.7]">
            {relevanceReason}
          </p>
        </>
      )}

      {item.kind === "paper" && (
        <ActionBar
          onSave={() => savePaper(item.data)}
          onDismiss={() => notInterestedPaper(item.data)}
          onMore={() => moreLikePaper(item.data)}
          isSaved={item.data.isSaved}
        />
      )}
      {item.kind === "event" && (
        <ActionBar
          onSave={() => saveEvent(item.data)}
          onDismiss={() => notInterestedEvent(item.data)}
        />
      )}
      {item.kind === "job" && (
        <ActionBar
          onSave={() => saveJob(item.data)}
          onDismiss={() => notInterestedJob(item.data)}
        />
      )}
    </Link>
  );
}
