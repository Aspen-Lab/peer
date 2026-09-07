"use client";

// The way forward: the next paper in the briefing, the whole row a link. On
// the last paper it goes back to the briefing; on a deep link, to today's.

import Link from "next/link";
import type { Paper } from "@/types";
import { NONE } from "@/lib/navigation/card-focus";
import type { PaperNav } from "@/lib/reader/paper-nav";
import { shortVenue } from "@/components/cards/paper-plate";
import { NEXT_ROW } from "./copy";

const ROW_CLASS =
  "block mt-16 py-5 -mx-2 px-2 rounded-2xl hover:bg-bg-secondary/60 transition-colors duration-150 ease-snap";
const LABEL_CLASS = "font-mono text-meta text-text-faint";
const TITLE_CLASS = "font-display text-title-lg leading-[1.3] text-heading mt-1 line-clamp-2";

export function NextRow({ nav, next }: { nav: PaperNav; next: Paper | null }) {
  if (nav.index === NONE) {
    return (
      <Link href="/" className={ROW_CLASS}>
        <span className={LABEL_CLASS}>{NEXT_ROW.deepLink}</span>
      </Link>
    );
  }
  if (!nav.nextId || !next) {
    return (
      <Link href="/" className={ROW_CLASS}>
        <span className={LABEL_CLASS}>{NEXT_ROW.last}</span>
      </Link>
    );
  }
  const venue = shortVenue(next.venue);
  return (
    <Link href={`/papers/${nav.nextId}`} className={ROW_CLASS}>
      <span className={LABEL_CLASS}>
        {NEXT_ROW.next(nav.index + 1, nav.total)}
        {venue ? ` · ${venue}` : ""}
      </span>
      <span className={TITLE_CLASS}>{next.title}</span>
    </Link>
  );
}
