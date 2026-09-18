"use client";

// Which days you read something — drawn on /profile, eighteen weeks labelled.
//
// It lived inline on the profile, then became a component in two sizes when
// the briefing carried an eight-week copy under the reading graph. That copy
// is gone (v0.32.5): it answered "which days", which the briefing does not
// need. The component stays one drawing with one set of rules.
//
// The form is a calendar heatmap because the question is "which days", not
// "how many": a bar chart of daily counts answers a question nobody asked and
// loses the weekday pattern that is the whole point. One series, so no
// legend box — the line above it names it — but the ramp gets its Less/More
// key, because a heatmap's steps are not self-evident.
//
// The ramp is neutral, light to dark. In this palette the hue is a signal, and
// how much was read is data — this chart used to state the opposite, spending
// 126 accent cells on /profile, by area the largest use of the hue anywhere in
// the product. Zero is the ground, not the palest step: a day with nothing
// read is not a small amount of reading.
//
// Nothing here is ever synthesized. This chart used to fall back to a seeded
// pseudo-random grid whenever the per-day API was unavailable — which is
// every signed-out visitor — and the streak was then counted off invented
// weeks and shown as fact. With no data it renders nothing at all.

import { useEffect, useMemo, useState } from "react";
import { useFeedStore } from "@/store/feed";
import { apiFetch } from "@/lib/api";

export const CAL_DAYS = 7;

/** A cell after today, in the week still in progress. Not drawn, not counted. */
export const FUTURE = -1;

const DAY_MS = 86_400_000;

/**
 * One size, fixed: 12px marks, 3px apart.
 *
 * It used to be `repeat(weeks, minmax(0, 1fr))` with `aspect-square` cells,
 * which is a chart sized by its container: on the briefing's 1232px board
 * eight columns made 150px squares, seven rows of them a thousand pixels tall,
 * and the one day read was a white slab in the corner of an empty field. A
 * cell is a glyph, not a layout region.
 */
const CELL = 12;
const GAP = 3;

/**
 * The ramp. Zero is an EMPTY SLOT — outlined, unfilled — not the palest step:
 * a day with nothing read is not a small amount of reading. It used to be
 * `bg-bg-secondary/60`, which in dark is #181818 at 60% over #111, so the
 * fifty-five empty days of a new reader's grid were the same colour as the
 * page and the grid itself disappeared. The slot is what gives the one filled
 * cell a place to be in.
 */
const CELL_CLASS = [
  "shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
  "bg-text-faint/40",
  "bg-text-faint",
  "bg-text-muted",
  "bg-heading",
];

function levelOf(value: number, max: number): number {
  if (value <= 0) return 0;
  const ratio = value / Math.max(1, max);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function utcMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** ISO day (UTC) `daysAgo` days before `now`'s day. */
function dayKey(daysAgo: number, now: number = Date.now()): string {
  return new Date(utcMidnight(now) - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Columns are calendar weeks, Sunday at the top — which is what the profile's
 * Mon/Wed/Fri row labels have always claimed. They were not: the grid used to
 * end on TODAY in the bottom row, whatever day today was, so on a Thursday the
 * row marked "Mon" was a Saturday. The weekday pattern is the reason this is a
 * calendar and not a bar chart, and it was mislabelled.
 *
 * The last column is the week in progress; its days after today are FUTURE.
 */
export function cellsFromCounts(
  byDate: Map<string, number>,
  weeks: number,
  now: number = Date.now(),
): number[] {
  const today = utcMidnight(now);
  const weekday = new Date(today).getUTCDay();
  const out = new Array<number>(weeks * CAL_DAYS).fill(0);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < CAL_DAYS; d++) {
      const daysAgo = (weeks - 1 - w) * CAL_DAYS + (weekday - d);
      out[w * CAL_DAYS + d] =
        daysAgo < 0 ? FUTURE : (byDate.get(dayKey(daysAgo, now)) ?? 0);
    }
  }
  return out;
}

/**
 * The reading days, server first and this browser second.
 *
 * `/api/read?aggregate=daily` is the whole history across a reader's devices
 * and answers 401 without a session. `readAt` in the feed store is this
 * browser's own record of the same thing, which is what a self-hosted,
 * signed-out Peer has — and it is why the briefing can carry this chart at
 * all. Null until something has been read: the callers render nothing.
 */
export function useReadingDays(weeks: number): number[] | null {
  const [remote, setRemote] = useState<Map<string, number> | null>(null);
  const readAt = useFeedStore((s) => s.readAt);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ daily: { date: string; count: number }[] }>(
          "/api/read?aggregate=daily",
          { cache: "no-store" },
        );
        if (!cancelled) setRemote(new Map(data.daily.map((d) => [d.date, d.count])));
      } catch {
        // Signed out, or the endpoint is unreachable: the local record stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const local = new Map<string, number>();
    for (const date of Object.values(readAt ?? {})) {
      local.set(date, (local.get(date) ?? 0) + 1);
    }
    const source = remote && remote.size > 0 ? remote : local;
    if (source.size === 0) return null;
    return cellsFromCounts(source, weeks);
  }, [remote, readAt, weeks]);
}

/**
 * Consecutive calendar weeks, counting back, in which something was read.
 *
 * The week in progress gets one grace: if nothing has been read in it YET it
 * is skipped rather than counted as a break — on a Sunday morning the week is
 * one day old, and a streak that resets at midnight on Saturday is a streak
 * that punishes reading on the weekend.
 */
export function streakWeeks(cells: number[], weeks: number): number {
  const active = (w: number) => {
    for (let d = 0; d < CAL_DAYS; d++) if (cells[w * CAL_DAYS + d] > 0) return true;
    return false;
  };
  let w = weeks - 1;
  if (w >= 0 && !active(w)) w--;
  let streak = 0;
  for (; w >= 0 && active(w); w--) streak++;
  return streak;
}

/** Days with anything read, out of the days drawn. */
export function daysRead(cells: number[]): number {
  return cells.filter((v) => v > 0).length;
}

export function ReadingCalendar({
  cells,
  weeks,
  labels = true,
  showKey = true,
}: {
  cells: number[];
  weeks: number;
  /** Weekday and month rules. Off for the briefing's strip. */
  labels?: boolean;
  showKey?: boolean;
}) {
  const max = Math.max(1, ...cells);
  const now = Date.now();
  const weekday = new Date(utcMidnight(now)).getUTCDay();

  /** A month's name over the first column whose Sunday is in it. */
  const monthMarkers = useMemo(() => {
    if (!labels) return new Map<number, string>();
    const out = new Map<number, string>();
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const sunday = new Date(
        utcMidnight(now) - ((weeks - 1 - w) * CAL_DAYS + weekday) * DAY_MS,
      );
      if (sunday.getUTCMonth() !== lastMonth) {
        out.set(w, sunday.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }));
        lastMonth = sunday.getUTCMonth();
      }
    }
    return out;
    // `now` moves every render; the markers only move when the day does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, weeks, weekday]);

  // One grid with fixed tracks, so the labels and the cells cannot drift apart
  // and nothing stretches. `inline-grid`: as wide as its weeks, never the
  // container's width.
  const col0 = labels ? 2 : 1;
  const row0 = labels ? 2 : 1;
  const grid: React.CSSProperties = {
    gridTemplateColumns: `${labels ? "auto " : ""}repeat(${weeks}, ${CELL}px)`,
    gridTemplateRows: `${labels ? "auto " : ""}repeat(${CAL_DAYS}, ${CELL}px)`,
    gap: GAP,
  };

  return (
    <div className="inline-flex flex-col">
      <div className="inline-grid" style={grid}>
        {labels &&
          [...monthMarkers].map(([w, label]) => (
            // Wider than its 12px track on purpose: it overhangs into the empty
            // label cells to its right, which is what those cells are for.
            <span
              key={`m${w}`}
              className="eyebrow text-text-faint whitespace-nowrap"
              style={{ gridColumn: col0 + w, gridRow: 1 }}
            >
              {label}
            </span>
          ))}
        {labels &&
          (["Mon", "Wed", "Fri"] as const).map((name, i) => (
            <span
              key={name}
              className="annotation text-text-faint pr-1"
              style={{ gridColumn: 1, gridRow: row0 + 1 + i * 2, lineHeight: `${CELL}px` }}
            >
              {name}
            </span>
          ))}
        {cells.map((value, i) => {
          if (value === FUTURE) return null;
          const w = Math.floor(i / CAL_DAYS);
          const d = i % CAL_DAYS;
          const daysAgo = (weeks - 1 - w) * CAL_DAYS + (weekday - d);
          return (
            <span
              key={i}
              className={`block ${CELL_CLASS[levelOf(value, max)]}`}
              style={{ gridColumn: col0 + w, gridRow: row0 + d }}
              title={`${dayKey(daysAgo, now)} — ${value > 0 ? `${value} read` : "nothing read"}`}
            />
          );
        })}
      </div>
      {showKey && (
        <div className="mt-3 flex items-center justify-end gap-1.5 annotation text-text-faint">
          <span>Less</span>
          {CELL_CLASS.map((cls, l) => (
            <span key={l} className={`w-3 h-3 ${cls}`} aria-hidden />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  );
}
