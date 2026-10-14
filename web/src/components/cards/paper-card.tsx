"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { Tag, Relevance, ActionBar } from "@/components/ui";
import { reviewPaperLabel } from "@/lib/papers/report";
import { cardShell } from "@/components/ui/card-shell";
import { buildReadingKey } from "@/components/reader/use-reading";

const WORDS_PER_MINUTE = 220;
/** The summary's own length — what the card said before it knew the paper's body. */
function summaryMinutes(p: Paper): number {
  const words = [p.summaryIntro, p.summaryResultDiscussion, p.relevanceReason]
    .filter(Boolean)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * P10-11 rule 5 (two blind readers costed an uploaded 50-minute paper at 0.5): the card's minutes are the paper's
 * when its body is known — `map.totalMinutes` of the reading the reading page keeps in this browser
 * (`use-reading.ts`: localStorage `peer-reading-v2`, keyed by `buildReadingKey`, the same number the map's header
 * shows) — and the summary's words otherwise. Read from the browser's own storage: the card never fetches.
 */
export function cardMinutes(p: Paper, bodyMinutes: number | null): number {
  return bodyMinutes !== null && bodyMinutes > 0 ? bodyMinutes : summaryMinutes(p);
}

const READING_CACHE_KEY = "peer-reading-v2";
type StoredReadings = Record<string, { reading?: { map?: { totalMinutes?: unknown } } } | undefined>;

// The whole cache is parsed once per change of its text, not once per card per render.
let parsedFrom: string | null = null;
let parsed: StoredReadings = {};
function storedReadings(raw: string | null): StoredReadings {
  if (raw !== parsedFrom) {
    parsedFrom = raw;
    try {
      const value: unknown = raw ? JSON.parse(raw) : {};
      parsed = value && typeof value === "object" ? (value as StoredReadings) : {};
    } catch {
      parsed = {};
    }
  }
  return parsed;
}

/** The map's total for a paper whose reading is in this browser's cache; null when it is not (or storage is unreadable). */
export function bodyMinutesOf(p: Pick<Paper, "id" | "fullTextUploadId" | "revision">, storage?: Pick<Storage, "getItem">): number | null {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!store) return null;
    const total = storedReadings(store.getItem(READING_CACHE_KEY))[buildReadingKey(p.id, p.fullTextUploadId, p.revision)]?.reading?.map?.totalMinutes;
    return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export function PaperCard({ paper }: { paper: Paper }) {
  const { savePaper, unsavePaper, notInterestedPaper, moreLikePaper } = useFeedStore();
  // The server (and a hydrating first render) has no storage: the summary's minutes, then the paper's once known.
  const bodyMinutes = useSyncExternalStore(subscribeToStorage, () => bodyMinutesOf(paper), () => null);
  const minutes = cardMinutes(paper, bodyMinutes);
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
