// Shared date / relative-time / count formatting.
//
// This is the ONLY place these live — do not hand-roll a formatter inside a
// page or card. Before this module existed the app had five relative-time
// vocabularies ("2d ago" vs "2 days ago" vs "in 2 days") drifting across
// adjacent surfaces.

const DAY_MS = 86_400_000;

/**
 * Parse an ISO string. Date-only strings ("2026-07-19") are parsed as LOCAL
 * dates — `new Date("2026-07-19")` parses as UTC midnight, which renders as
 * the previous day in western timezones. Publication dates must never shift
 * by a day.
 */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // A23-02 / Ruling 62b. A MONTH-GRANULARITY claim ("2026-08"): the month is
  // evidenced, the day is not. Built as a LOCAL date for the same reason the
  // date-only branch above is — `new Date("2026-08")` is UTC midnight, which
  // renders as the PREVIOUS MONTH in western timezones.
  const monthOnly = MONTH_GRANULARITY_RE.exec(iso.trim());
  const d = monthOnly
    ? new Date(Number(monthOnly[1]), Number(monthOnly[2]) - 1, 1)
    : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A23-02 / Ruling 62b. A date evidenced only to the MONTH ("2026-08"), nothing
 * finer. Not exported as a predicate: `formatDate` and `parseDate` are the two
 * places that act on it.
 */
export const MONTH_GRANULARITY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function isMonthGranularity(iso: string | null | undefined): boolean {
  return Boolean(iso && MONTH_GRANULARITY_RE.test(iso.trim()));
}

export type DateStyle = "full" | "medium" | "short" | "monthYear";

const DATE_STYLE_OPTS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric" },
  monthYear: { month: "short", year: "numeric" },
};

/**
 * Absolute date — "Sunday, July 19, 2026" / "Jul 19, 2026" / "Jul 19" / "Jul 2026".
 *
 * A24-02 / Ruling 62b. A MONTH-GRANULARITY claim ("2026-08") renders at the
 * granularity the page evidenced, whatever style the caller asked for.
 * `parseDate` deliberately materialises such a claim as the FIRST of the month
 * — that anchor is what every consumer needs and it does not move — but
 * PRINTING that anchor's day states a fact the page never made.
 *
 * Three properties this override must keep, each with its own test:
 *  - it keys on `MONTH_GRANULARITY_RE`, the shipped predicate, NEVER on "the
 *    date is the 1st" — a real event starting on 1 August still prints
 *    "Aug 1, 2026";
 *  - it is ONE-DIRECTIONAL, widening only: a day-level value asked for
 *    "monthYear" still gets "monthYear", and no day-level value moves a byte;
 *  - it FILLS nothing — an unparseable value still returns `null`.
 *
 * The branch lives here, once, as this module's header demands: before round
 * 24 it sat privately in a card that has since been removed, and the render
 * sites that reached this module directly printed an invented day.
 */
export function formatDate(
  iso: string | null | undefined,
  style: DateStyle = "medium",
): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const effective: DateStyle = isMonthGranularity(iso) ? "monthYear" : style;
  return d.toLocaleDateString("en-US", DATE_STYLE_OPTS[effective]);
}

/**
 * Clock-granularity past time for sync stamps and activity rows:
 * "just now", "12m ago", "3h ago", "5d ago", then the absolute date.
 */
export function formatTimeAgo(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const mins = Math.floor((nowMs - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso, "short");
}

/**
 * Day-granularity content age for posted/published stamps:
 * "Today", "Yesterday", "5d ago", "3w ago", then "Jul 2026".
 */
export function formatDayAge(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  const diff = Math.floor((nowMs - d.getTime()) / DAY_MS);
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 14) return `${diff}d ago`;
  if (diff < 60) return `${Math.floor(diff / 7)}w ago`;
  return formatDate(iso, "monthYear");
}

/** Compact count — 842, 1.2k, 34k, 1.1M. */
export function formatCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}
