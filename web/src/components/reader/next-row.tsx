"use client";

// The way forward: the next paper in the briefing, the whole row a link. On
// the last paper it goes back to the briefing; on a deep link, to today's.
//
// It is a band, not a line. As a 12.5px label over a 19.5px title it was the
// quietest thing on a page that ends early, and the bottom of the reading
// column read as the page having run out rather than as it having an end. A
// rule above it, the title at the size a heading is, and the arrow the whole
// band moves under a pointer, make the end of the paper a place.

import Link from "next/link";
import type { Paper } from "@/types";
import { NONE } from "@/lib/navigation/card-focus";
import type { PaperNav } from "@/lib/reader/paper-nav";
import { shortVenue } from "@/components/cards/paper-plate";
import { IconArrowRight } from "@/components/icons";
import { NEXT_ROW } from "./copy";

const ROW_CLASS =
  "group block mt-16 border-t border-border pt-6 -mx-3 px-3 pb-4 rounded-2xl hover:bg-bg-secondary/50 transition-colors duration-150 ease-snap";
const LABEL_CLASS = "font-mono text-meta text-text-faint";
const TITLE_CLASS =
  "font-display text-display-xs leading-[1.25] text-heading mt-1.5 line-clamp-2 measure-lede";
const GO_CLASS =
  "inline-flex items-center gap-1.5 font-sans text-body-sm text-text-muted mt-3 group-hover:text-heading transition-colors duration-150 ease-snap";

/** The arrow travels a couple of pixels under a pointer — the band's own tell. */
function Go({ label }: { label: string }) {
  return (
    <span className={GO_CLASS}>
      {label}
      <span className="transition-transform duration-150 ease-snap group-hover:translate-x-0.5 motion-reduce:transition-none">
        <IconArrowRight size={13} />
      </span>
    </span>
  );
}

export function NextRow({ nav, next }: { nav: PaperNav; next: Paper | null }) {
  if (nav.index === NONE) {
    return (
      <Link href="/" className={ROW_CLASS}>
        <Go label={NEXT_ROW.deepLink} />
      </Link>
    );
  }
  if (!nav.nextId || !next) {
    return (
      <Link href="/" className={ROW_CLASS}>
        <Go label={NEXT_ROW.last} />
      </Link>
    );
  }
  const venue = shortVenue(next.venue);
  return (
    <Link href={`/papers/${nav.nextId}`} className={ROW_CLASS}>
      <span className={LABEL_CLASS}>
        {NEXT_ROW.next(nav.index + 1, nav.total)}
        {venue ? ` \u00b7 ${venue}` : ""}
      </span>
      <span className={TITLE_CLASS}>{next.title}</span>
      <Go label={NEXT_ROW.read} />
    </Link>
  );
}
