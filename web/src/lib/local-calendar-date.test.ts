import { afterEach, describe, expect, it, vi } from "vitest";
import { localCalendarDate } from "./local-calendar-date";

/**
 * The timezone stubbing is the point, not decoration: a developer or a CI
 * machine on UTC cannot tell a local day from a UTC slice. Setting
 * `process.env.TZ` mid-process takes effect on subsequently constructed `Date`s
 * (probed on this Node), and `afterEach` restores it, or every later suite in
 * the run inherits the zone.
 *
 * P9-35 (§1h.60): this file used to pin `localIsoWeek` too, the weekly period of
 * the jobs and events pools. Both are stopped and the helper is gone; its cases
 * went with it (named in the checkpoint). What stays is the one case that also
 * pinned `localCalendarDate`, re-aimed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("localCalendarDate", () => {
  // RE-AIMED, NOT DELETED (was "is derived from the same local components as
  // localCalendarDate"): the ISO-week half of that case is gone with the helper.
  it("is derived from the local components, never from a UTC slice", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    expect(localCalendarDate(new Date(2026, 6, 27, 23, 59, 0))).toBe("2026-07-27");
    // 00:30 on 5 January in Shanghai is 16:30 UTC on the 4th: a UTC slice says the 4th.
    expect(localCalendarDate(new Date(2026, 0, 5, 0, 30, 0))).toBe("2026-01-05");
  });

  it("pads the month and the day", () => {
    vi.stubEnv("TZ", "UTC");
    expect(localCalendarDate(new Date(2026, 2, 4, 12, 0, 0))).toBe("2026-03-04");
  });
});
