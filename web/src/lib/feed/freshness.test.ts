import { describe, expect, it } from "vitest";
import { dropStale, isStale, staleAfterDays } from "./freshness";

const NOW = Date.parse("2026-09-07T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("staleAfterDays", () => {
  it("is generous about the reader's window, and defaults to the week's", () => {
    expect(staleAfterDays("today")).toBe(30);
    expect(staleAfterDays("week")).toBe(60);
    expect(staleAfterDays("month")).toBe(180);
    expect(staleAfterDays(undefined)).toBe(60);
  });
});

describe("isStale", () => {
  it("keeps this week's papers and the ones just past the window", () => {
    expect(isStale(daysAgo(2), "week", NOW)).toBe(false);
    expect(isStale(daysAgo(30), "week", NOW)).toBe(false);
  });

  it("drops the classics a date-blind source answers with", () => {
    // The two that reached a "today" pool from Semantic Scholar.
    expect(isStale("2000-06-01", "week", NOW)).toBe(true); // PSIPRED
    expect(isStale("2020-01-15", "week", NOW)).toBe(true); // AlphaFold
    expect(isStale(daysAgo(194), "week", NOW)).toBe(true);
  });

  it("never judges a paper whose date the source did not give", () => {
    expect(isStale(undefined, "week", NOW)).toBe(false);
    expect(isStale("", "week", NOW)).toBe(false);
    expect(isStale("not a date", "week", NOW)).toBe(false);
  });

  it("follows the window a reader chose", () => {
    expect(isStale(daysAgo(120), "month", NOW)).toBe(false);
    expect(isStale(daysAgo(120), "week", NOW)).toBe(true);
    expect(isStale(daysAgo(45), "today", NOW)).toBe(true);
  });
});

describe("dropStale", () => {
  it("keeps the order and only removes what is too old", () => {
    const items = [
      { id: "fresh", publishedAt: daysAgo(1) },
      { id: "classic", publishedAt: "2000-06-01" },
      { id: "undated", publishedAt: undefined },
      { id: "recent", publishedAt: daysAgo(20) },
    ];
    expect(dropStale(items, "week", NOW).map((i) => i.id)).toEqual([
      "fresh",
      "undated",
      "recent",
    ]);
  });
});
