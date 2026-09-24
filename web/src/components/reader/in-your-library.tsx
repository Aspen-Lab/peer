"use client";

// Where this paper sits among the reader's own.
//
// The last block of the column, under the record. The papers the reader has
// read or kept under the same topics, nearest first, each a link back into
// the reading; and the paper's topics themselves, each a search. On a paper
// Peer could not read the full text of, this is what stands where half a
// column of nothing used to; on one it could, it is the way onward.
//
// Client-side, from the stores: the library and the shelf are this browser's,
// and no request is made.

import Link from "next/link";
import { useMemo } from "react";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { relatedInLibrary, topicsOf } from "@/lib/library/related";
import { Band } from "@/components/ui/band";
import { LIBRARY } from "./copy";

const MAX_TOPICS = 6;

export function InYourLibrary({ paper }: { paper: Paper }) {
  const library = useFeedStore((s) => s.library);
  const saved = useFeedStore((s) => s.savedPapers);

  const related = useMemo(() => relatedInLibrary(paper, library, saved), [paper, library, saved]);
  const topics = useMemo(() => topicsOf(paper).slice(0, MAX_TOPICS), [paper]);

  if (related.length === 0 && topics.length === 0) return null;

  return (
    <Band label={LIBRARY.heading}>
      {related.length > 0 ? (
        <ul className="mt-4 space-y-3 measure-paper">
          {related.map((r) => (
            <li key={r.id} className="flex flex-col gap-1">
              <Link
                href={`/papers/${r.id}`}
                className="font-reading text-lead leading-[1.4] text-text transition-colors hover:text-heading"
              >
                {r.title}
              </Link>
              <span className="annotation text-text-faint">
                {LIBRARY.kind[r.kind]} · {LIBRARY.shares(r.shared)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="annotation mt-4 text-text-faint">{LIBRARY.none}</p>
      )}

      {topics.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow text-text-faint">{LIBRARY.topics}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {topics.map((t) => (
              <li key={t}>
                <Link
                  href={`/search?q=${encodeURIComponent(t)}`}
                  className="inline-flex items-center px-2 py-1 text-body-sm text-text-muted shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-colors hover:bg-bg-secondary/70 hover:text-heading"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Band>
  );
}
