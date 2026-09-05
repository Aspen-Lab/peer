"use client";

import Link from "next/link";
import type { Paper } from "@/types";
import { Relevance } from "@/components/ui";
import { useFeedStore } from "@/store/feed";

export type QuickHitItem = { kind: "paper"; data: Paper };

export function BriefingQuickHit({ item }: { item: QuickHitItem }) {
  const isRead = useFeedStore((s) => !!s.readItems[item.data.id]);
  const paper = item.data;

  return (
    <Link
      href={`/papers/${paper.id}`}
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
        className={`flex-1 min-w-0 text-body-lg truncate transition-colors ${
          isRead
            ? "text-text-faint group-hover:text-text-muted"
            : "text-heading group-hover:text-accent"
        }`}
      >
        {paper.title}
      </span>

      <span
        className={`hidden sm:inline text-meta truncate max-w-[38%] ${
          isRead ? "text-text-faint/60" : "text-text-faint"
        }`}
      >
        {paper.venue}
      </span>

      <Relevance score={paper.relevanceScore} />
    </Link>
  );
}
