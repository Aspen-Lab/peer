"use client";

import Link from "next/link";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { Tag, Relevance, ActionBar } from "@/components/ui";
import { reviewPaperLabel } from "@/lib/papers/report";
import { cardShell } from "@/components/ui/card-shell";

const WORDS_PER_MINUTE = 220;
function readMinutes(p: Paper): number {
  const words = [p.summaryIntro, p.summaryResultDiscussion, p.relevanceReason]
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export function PaperCard({ paper }: { paper: Paper }) {
  const { savePaper, unsavePaper, notInterestedPaper, moreLikePaper } = useFeedStore();
  const minutes = readMinutes(paper);
  const typeLabel = reviewPaperLabel(paper);

  return (
    <Link
      href={`/papers/${paper.id}`}
      className={cardShell()}
    >
      {typeLabel && (
        <span
          className="eyebrow inline-block mb-2 px-2 py-0.5 rounded-md bg-tag-dim text-tag border border-tag/20"
        >
          {typeLabel}
        </span>
      )}
      <div className="flex items-start justify-between gap-4">
        <h3
          className="text-title-lg font-semibold text-heading leading-snug tracking-[-0.01em]"
        >
          {paper.title}
        </h3>
        <Relevance score={paper.relevanceScore} />
      </div>

      <p
        className="text-body-sm text-text-muted mt-2.5"
      >
        {paper.authors.slice(0, 3).join(", ")}
        {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
      </p>

      <div
        className="flex items-center flex-wrap gap-x-2.5 gap-y-1.5 mt-3.5 text-meta text-text-faint"
      >
        <Tag>{paper.venue}</Tag>
        <span className="text-border-strong" aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {minutes} min read
        </span>
      </div>

      <p className="text-body-lg text-text-muted mt-4 leading-[1.65] line-clamp-2">
        {paper.relevanceReason}
      </p>

      <ActionBar
        onSave={() => savePaper(paper)}
        onUnsave={() => unsavePaper(paper.id)}
        onDismiss={() => notInterestedPaper(paper)}
        onMore={() => moreLikePaper(paper)}
        isSaved={paper.isSaved}
      />
    </Link>
  );
}
