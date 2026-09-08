"use client";

import type { ItemDetailRoute } from "@/lib/navigation/item-routes";
import Link from "next/link";
import type { Paper, Event, Job } from "@/types";
import { Relevance } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useFeedStore } from "@/store/feed";
import { isOnlineOnly } from "@/lib/opportunities/facets";

export type QuickHitItem =
  | { kind: "paper"; data: Paper }
  | { kind: "event"; data: Event }
  | { kind: "job"; data: Job };

const KIND_LABEL: Record<QuickHitItem["kind"], string> = {
  paper: "Paper",
  event: "Event",
  job: "Role",
};

export function BriefingQuickHit({ item }: { item: QuickHitItem }) {
  const isRead = useFeedStore((s) => !!s.readItems[item.data.id]);

  // ABC-freemium 9-05 — annotated, not cast. See `briefing-hero.tsx`.
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

  const meta =
    item.kind === "paper"
      ? item.data.venue
      : item.kind === "event"
        ? // B20-01, render site 6 of 6.
          `${formatDate(item.data.date, "short")} · ${isOnlineOnly(item.data) ? "Online" : item.data.location}`
        : [item.data.companyOrLab, item.data.isRemote ? "Remote" : undefined]
            .filter(Boolean)
            .join(" · ");

  return (
    <Link
      href={detail}
      data-read={isRead || undefined}
      className="group flex items-center gap-3 py-3.5 px-2 -mx-2 rounded-lg transition-colors hover:bg-surface/70 active:bg-surface"
    >
      {/* Read/unread dot */}
      <span
        className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5"
        aria-hidden
      >
        <span
          className={`block w-[7px] h-[7px] rounded-full transition-colors ${
            isRead ? "bg-transparent border border-border-strong" : "bg-accent"
          }`}
        />
      </span>

      <span
        className={`shrink-0 text-micro font-semibold uppercase tracking-[0.14em] w-[46px] ${
          isRead ? "text-text-faint/60" : "text-text-faint"
        }`}
      >
        {KIND_LABEL[item.kind]}
      </span>

      <span
        className={`flex-1 min-w-0 text-body-lg truncate transition-colors ${
          isRead
            ? "text-text-faint group-hover:text-text-muted"
            : "text-heading group-hover:text-accent"
        }`}
      >
        {title}
      </span>

      <span
        className={`hidden sm:inline text-meta truncate max-w-[38%] ${
          isRead ? "text-text-faint/60" : "text-text-faint"
        }`}
      >
        {meta}
      </span>

      <Relevance score={score} />
    </Link>
  );
}
