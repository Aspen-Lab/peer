"use client";

// A narrow rail and a long column.
//
// The shelf and the profile were one 820px column down the middle of the
// window: on a 1920 screen that is a third of the page holding everything and
// two thirds holding nothing, and the page's own name — "Saved", "Your
// signals" — scrolled away with the first card.
//
// So from xl they are two columns, and the proportion is the point: the rail
// is NARROW and fixed, the column is LONG and takes every pixel the window
// adds. The rail holds what the page IS — its name, its counts, its one
// command, the way between its sections — and it is sticky, so it is still
// there at the bottom of a long shelf. The column holds the page's things.
//
// This is not the reading spread (`reader/spread.ts`). That one is sized by
// the measure — a line of prose stops getting better after about 70
// characters — and its two tracks are 5fr/7fr because both of them hold
// reading. Here only the right track holds anything that grows.
//
// Below xl: the rail's contents render first, then the column's, in one
// column, exactly as the page read before.

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 15rem of rail, then everything else. The gap widens once, at 2xl, because
 *  at 1600+ a 56px gutter stops reading as a gutter and starts reading as a
 *  mistake. */
const GRID =
  "xl:grid xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:gap-x-14 2xl:gap-x-20 xl:items-start";

/** Sticky under the masthead: 48px of bar and 16px of air, the same offset
 *  the reader's panel uses. */
const RAIL = "xl:sticky xl:top-16 xl:self-start xl:min-w-0";

export function PageSpread({
  rail,
  children,
  className,
}: {
  /** The page's name, counts and commands. Kept short — it is 240px wide. */
  rail: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(GRID, className)}>
      <div className={RAIL}>{rail}</div>
      <div className="xl:min-w-0">{children}</div>
    </div>
  );
}

/** A link between the page's own sections, for the rail. Only from xl: below
 *  it the sections are already one after another and a jump is no shorter
 *  than a scroll. */
export function RailLink({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count?: number;
}) {
  return (
    <a
      href={href}
      className="flex items-baseline justify-between gap-3 py-1.5 text-body-sm text-text-muted transition-colors hover:text-heading"
    >
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="annotation tabular-nums text-text-faint">{count}</span>
      )}
    </a>
  );
}
