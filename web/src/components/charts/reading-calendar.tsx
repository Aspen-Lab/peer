"use client";

// Peer's one chart: which days you read something.
//
// It lived inline on the profile and the briefing had none. Now it is one
// component in two sizes — the profile's labelled eighteen weeks, and a bare
// eight-week strip at the foot of the day's briefing — so there is one
// drawing of this and one set of rules for it.
//
// The form is a calendar heatmap because the question is "which days", not
// "how many": a bar chart of daily counts answers a question nobody asked and
// loses the weekday pattern that is the whole point. One series, so no
// legend box — the line above it names it — but the ramp gets its Less/More
// key, because a heatmap's steps are not self-evident.
//
// The ramp is the accent, light to dark: sequential magnitude is one hue, and
// the accent is the only hue Peer has. Zero is a neutral, not the palest step
// — a day with nothing read is not a small amount of reading.
//
// Nothing here is ever synthesized. This chart used to fall back to a seeded
// pseudo-random grid whenever the per-day API was unavailable — which is
// every signed-out visitor — and the streak was then counted off invented
// weeks and shown as fact. With no data it renders nothing at all.

import { useEffect, useMemo, useState } from "react";
import { useFeedStore } from "@/store/feed";
import { apiFetch } from "@/lib/api";

export const CAL_DAYS = 7;

/** The ramp: zero is neutral, then four steps of the one hue. */
const CELL_CLASS = [
  "bg-bg-secondary/60",
  "bg-accent/20",
  "bg-accent/40",
  "bg-accent/70",
  "bg-accent",
];

function levelOf(value: number, max: number): number {
  if (value <= 0) return 0;
  const ratio = value / Math.max(1, max);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** ISO day (UTC) `daysAgo` days before today. */
function dayKey(daysAgo: number): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function cellsFromCounts(byDate: Map<string, number>, weeks: number): number[] {
  const out = new Array<number>(weeks * CAL_DAYS).fill(0);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < CAL_DAYS; d++) {
      const daysAgo = (weeks - 1 - w) * 7 + (CAL_DAYS - 1 - d);
      out[w * CAL_DAYS + d] = byDate.get(dayKey(daysAgo)) ?? 0;
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

/** Consecutive weeks, counting back, in which something was read. */
export function streakWeeks(cells: number[], weeks: number): number {
  let streak = 0;
  for (let w = weeks - 1; w >= 0; w--) {
    let active = false;
    for (let d = 0; d < CAL_DAYS; d++) {
      if (cells[w * CAL_DAYS + d] > 0) {
        active = true;
        break;
      }
    }
    if (!active) break;
    streak++;
  }
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

  const monthMarkers = useMemo(() => {
    if (!labels) return [];
    const today = new Date();
    const out: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (weeks - 1 - w) * 7);
      if (d.getMonth() !== lastMonth) {
        out.push({ col: w, label: d.toLocaleDateString("en-US", { month: "short" }) });
        lastMonth = d.getMonth();
      }
    }
    return out;
  }, [labels, weeks]);

  const grid = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };

  return (
    <div>
      <div className="flex gap-2">
        {labels && (
          <div className="flex flex-col justify-between pt-3.5 shrink-0">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <span key={d} className="text-micro text-text-faint/70 h-[11px] leading-[11px]">
                {d === 1 ? "Mon" : d === 3 ? "Wed" : d === 5 ? "Fri" : " "}
              </span>
            ))}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {labels && (
            <div
              className="grid mb-1 text-micro text-text-faint/70 uppercase tracking-[0.1em]"
              style={grid}
            >
              {Array.from({ length: weeks }).map((_, w) => (
                <span key={w} className="truncate">
                  {monthMarkers.find((m) => m.col === w)?.label ?? ""}
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-[2px]" style={grid}>
            {Array.from({ length: weeks }).map((_, w) => (
              <div key={w} className="grid grid-rows-7 gap-[2px]">
                {Array.from({ length: CAL_DAYS }).map((__, d) => {
                  const value = cells[w * CAL_DAYS + d] ?? 0;
                  const daysAgo = (weeks - 1 - w) * 7 + (CAL_DAYS - 1 - d);
                  return (
                    <span
                      key={d}
                      className={`block aspect-square transition-colors ${CELL_CLASS[levelOf(value, max)]}`}
                      title={`${dayKey(daysAgo)} — ${value > 0 ? `${value} read` : "nothing read"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {showKey && (
        <div className="mt-3 flex items-center justify-end gap-1.5 text-micro text-text-faint/70">
          <span>Less</span>
          {CELL_CLASS.map((cls, l) => (
            <span key={l} className={`w-2.5 h-2.5 ${cls}`} aria-hidden />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  );
}
