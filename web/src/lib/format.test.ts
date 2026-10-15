import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDate,
  formatDayAge,
  formatTimeAgo,
  parseDate,
} from "./format";

// P9-35 (§1h.60): ten exports of this module were read only by the stopped
// events and jobs feeds and went with them — formatDateRange,
// formatWeekdayRange, daysUntil, formatDayDistance, formatDaysLeft,
// formatDaysAgo, formatAgeInWords, formatMatchPct, dateClaimEndMs and the
// exported isMonthGranularity (the predicate lives on, private, behind
// `formatDate`). Their cases are deleted with them; what is left of a case that
// also pinned `formatDate` or `parseDate` is re-aimed below, by name.

describe("parseDate", () => {
  it("parses date-only strings as local dates (no UTC day-shift)", () => {
    const d = parseDate("2026-07-19")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(19); // would fail in US timezones with new Date("2026-07-19")
  });

  it("returns null for garbage and empty input", () => {
    expect(parseDate("not-a-date")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});

describe("formatDate", () => {
  it("renders each style", () => {
    expect(formatDate("2026-07-19", "medium")).toBe("Jul 19, 2026");
    expect(formatDate("2026-07-19", "short")).toBe("Jul 19");
    expect(formatDate("2026-07-19", "monthYear")).toBe("Jul 2026");
    expect(formatDate("2026-07-19", "full")).toContain("July 19, 2026");
  });
});

describe("formatTimeAgo", () => {
  const now = new Date(2026, 6, 19, 12, 0, 0).getTime();
  it("walks the granularity ladder", () => {
    expect(formatTimeAgo(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(formatTimeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(formatTimeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(formatTimeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
    expect(formatTimeAgo(new Date(2026, 6, 1).toISOString(), now)).toBe("Jul 1");
  });
});

describe("formatDayAge", () => {
  const now = new Date(2026, 6, 19, 12, 0, 0).getTime();
  it("matches the posted/published vocabulary", () => {
    expect(formatDayAge("2026-07-19", now)).toBe("Today");
    expect(formatDayAge("2026-07-18", now)).toBe("Yesterday");
    expect(formatDayAge("2026-07-10", now)).toBe("9d ago");
    expect(formatDayAge("2026-06-25", now)).toBe("3w ago");
    expect(formatDayAge("2026-01-05", now)).toBe("Jan 2026");
  });
});

describe("formatCount", () => {
  it("compacts", () => {
    expect(formatCount(842)).toBe("842");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(2000)).toBe("2k");
    expect(formatCount(34_500)).toBe("35k");
    expect(formatCount(1_100_000)).toBe("1.1M");
  });
});

// A23-02 / Ruling 62b. A date evidenced only to the month.
describe("month-granularity date claims", () => {
  // RE-AIMED (P9-35), NOT DELETED: was "recognises the shape and nothing else"
  // on the exported `isMonthGranularity`. The predicate is private now, so the
  // same shapes are asked of `formatDate`, which is what acts on them.
  it("recognises the shape and nothing else (asked of formatDate)", () => {
    expect(formatDate("2026-08")).toBe("Aug 2026");
    expect(formatDate("2026-08-11")).toBe("Aug 11, 2026");
    expect(formatDate("2026-13")).toBeNull();
    expect(formatDate(undefined)).toBeNull();
  });

  it("parses to the first of the month as a LOCAL date", () => {
    const d = parseDate("2026-08");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(7);
    expect(d?.getDate()).toBe(1);
  });
});

// A24-02 / Ruling 62b. THE GRANULARITY BRANCH NOW LIVES IN THE SHARED
// FORMATTER. Before round 24 only a card that has since been removed had it;
// the render sites that reached `format.ts` directly printed a day the page
// never stated. Each `it` below is the uniquely-red case for one clause of the
// fix. (P9-35: the clauses that were about date ranges and weekday sub-lines
// went with `formatDateRange` / `formatWeekdayRange`.)
describe("A24-02: month-granularity rendering in the shared formatter", () => {
  it("renders the month for EVERY style — no style may invent a day", () => {
    // Reverted, these read "Aug 1, 2026" (default/medium, the tile and the
    // hero), "Aug 1" (short, the deadline strip, feed tile and quick-hit) and
    // "Saturday, August 1, 2026" (full).
    expect(formatDate("2026-08")).toBe("Aug 2026");
    expect(formatDate("2026-08", "medium")).toBe("Aug 2026");
    expect(formatDate("2026-08", "short")).toBe("Aug 2026");
    expect(formatDate("2026-08", "full")).toBe("Aug 2026");
    expect(formatDate("2026-08", "monthYear")).toBe("Aug 2026");
  });

  it("keys on the SHAPE, never on the day happening to be the 1st", () => {
    // The single most likely wrong implementation, and a silent one: a real
    // event that genuinely starts on 1 August keeps its evidenced day.
    expect(formatDate("2026-08-01", "medium")).toBe("Aug 1, 2026");
    expect(formatDate("2026-08-01", "short")).toBe("Aug 1");
  });

  it("widens ONLY — a day-level value asked for monthYear still gets monthYear", () => {
    expect(formatDate("2026-09-15", "monthYear")).toBe("Sep 2026");
    expect(formatDate("2026-09-15", "medium")).toBe("Sep 15, 2026");
  });

  it("FILLS nothing — an unparseable value is still null, never a fallback", () => {
    // 62b's own named boundary: never a year-only fallback, never a bare month
    // with no year, never a placeholder. Null is what drops the tile entirely.
    expect(formatDate("not-a-date")).toBeNull();
    expect(formatDate("2026-13")).toBeNull();
    // ESCAPE CLAUSE, ROUND 24 C — RECORDED, NOT FIXED, NOT WIDENED.
    // A YEAR-ONLY value is a shape round 24 B's cases did not span, and it is
    // NOT null today: `formatDate("2026")` renders "Dec 31, 2025" in any
    // behind-UTC zone, because it falls past both `parseDate` branches into a
    // raw `new Date("2026")` = UTC midnight, 1 January. An invented day AND a
    // wrong year. It is LATENT (the extractor that could emit it was deleted
    // with the events feed). This assertion locks today's answer so the shape
    // cannot start moving unnoticed; it is not an endorsement of it.
    expect(formatDate("2026")).not.toBeNull();
  });
});
