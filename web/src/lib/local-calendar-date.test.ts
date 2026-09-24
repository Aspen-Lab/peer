import { afterEach, describe, expect, it, vi } from "vitest";
import { localCalendarDate, localIsoWeek } from "./local-calendar-date";

/**
 * ABC-freemium 1-19 · R-POOL-1, R-TEST-1.
 *
 * **The timezone stubbing is the point, not decoration.** The published form of
 * this calculation — `Math.ceil(((thursday - jan1) / 86400000 + 1) / 7)` — is
 * exact in every northern-hemisphere zone and wrong for roughly a seventh of the
 * year in southern-hemisphere DST zones, where 1 January falls inside DST. A
 * developer or a CI machine on UTC cannot catch it. Round-1 B found it by
 * sweeping 2019–2031 day by day in ten zones; the cases below pin the days that
 * sweep singled out.
 *
 * Setting `process.env.TZ` mid-process takes effect on subsequently constructed
 * `Date`s (probed on this Node), which is what makes this testable at all —
 * and `afterEach` restores it, or every later suite in the run inherits the
 * zone.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("localIsoWeek", () => {
  it("is exact in a southern-hemisphere DST zone", () => {
    // **THE ONE CASE THAT DECIDES THE IMPLEMENTATION.** The `Math.ceil` form
    // returns 2021-W15 here, for a day that is in W14.
    for (const tz of ["Pacific/Chatham", "America/Santiago"]) {
      vi.stubEnv("TZ", tz);
      expect(localIsoWeek(new Date(2021, 3, 5, 12, 0, 0)), tz).toBe("2021-W14");
    }
  });

  it("agrees with the northern-hemisphere zones too", () => {
    for (const tz of ["UTC", "Asia/Shanghai", "America/New_York", "Europe/Berlin"]) {
      vi.stubEnv("TZ", tz);
      expect(localIsoWeek(new Date(2021, 3, 5, 12, 0, 0)), tz).toBe("2021-W14");
    }
  });

  it("puts a late-December day in the NEXT ISO year when its Thursday is", () => {
    vi.stubEnv("TZ", "UTC");
    // 2025-12-29 is a Monday whose Thursday falls in 2026.
    expect(localIsoWeek(new Date(2025, 11, 29, 12, 0, 0))).toBe("2026-W01");
  });

  it("puts an early-January day in the PREVIOUS ISO year when its Thursday is", () => {
    vi.stubEnv("TZ", "UTC");
    expect(localIsoWeek(new Date(2021, 0, 1, 12, 0, 0))).toBe("2020-W53");
  });

  it("handles a 53-week ISO year", () => {
    vi.stubEnv("TZ", "UTC");
    expect(localIsoWeek(new Date(2026, 11, 31, 12, 0, 0))).toBe("2026-W53");
  });

  it("is constant across a week and changes on Monday", () => {
    vi.stubEnv("TZ", "UTC");
    const monday = localIsoWeek(new Date(2026, 6, 27, 0, 1, 0));
    const sunday = localIsoWeek(new Date(2026, 7, 2, 23, 59, 0));
    const nextMonday = localIsoWeek(new Date(2026, 7, 3, 0, 1, 0));

    expect(sunday).toBe(monday);
    expect(nextMonday).not.toBe(monday);
  });

  it("is derived from the same local components as localCalendarDate", () => {
    // An ISO week built from `getUTCDay()` would disagree with the daily key
    // near midnight, and the papers pool still uses the daily one.
    vi.stubEnv("TZ", "Asia/Shanghai");
    const lateLocal = new Date(2026, 6, 27, 23, 59, 0);

    expect(localCalendarDate(lateLocal)).toBe("2026-07-27");
    expect(localIsoWeek(lateLocal)).toBe("2026-W31");
  });
});
