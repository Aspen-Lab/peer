import { afterEach, describe, expect, it, vi } from "vitest";
import { dateInTimezone, hourInTimezone, utcInstantForLocalWallClock } from "./timezone";
import { localCalendarDate } from "@/lib/local-calendar-date";
import { PREPARE_LEAD_MINUTES, PREPARE_LOOKAHEAD_MS, isOwnerDueForPrepare } from "./due-owners";

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md §3 items 6/11 + P11). `localCalendarDate`
// reads the RUNTIME's own local zone (documented "UTC on Vercel" in
// production) -- this machine's own default is NOT UTC (confirmed
// `Intl.DateTimeFormat().resolvedOptions().timeZone` during this item's
// investigation), so every test below pins `TZ=UTC` explicitly, the same
// convention web/src/lib/local-calendar-date.test.ts already established,
// rather than relying on the ambient environment.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PREPARE_LEAD_MINUTES", () => {
  it("is the §1x P1 ruling's number (90), not prepare-due.ts's own 45-minute default", () => {
    expect(PREPARE_LEAD_MINUTES).toBe(90);
  });
});

describe("isOwnerDueForPrepare — P11 batch date alignment", () => {
  it("keys the batch by localCalendarDate(checkinInstant) -- the SAME function+input shape a real visit uses -- not by dateInTimezone(now, digest_timezone), and the two demonstrably disagree for a real (timezone, hour) pair", () => {
    vi.stubEnv("TZ", "UTC");
    // Asia/Tokyo is UTC+9, no DST. 08:00 JST lands on the PREVIOUS UTC
    // calendar day whenever now is anywhere in JST's early-morning hours.
    const now = new Date("2026-09-24T19:00:00.000Z");
    const row = { digestHourLocal: 8, digestTimezone: "Asia/Tokyo" };

    // The owner's OWN-timezone calendar date -- what the B guide's original
    // draft design would have used as the storage key.
    const ownTzDate = dateInTimezone(now, row.digestTimezone);
    expect(ownTzDate).toBe("2026-09-25");

    const result = isOwnerDueForPrepare(row, now);
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");

    // The check-in instant itself: 08:00 JST on 2026-09-25 = 23:00Z on
    // 2026-09-24 (JST is 9h ahead).
    expect(result.checkinInstant.toISOString()).toBe("2026-09-24T23:00:00.000Z");

    // THE FIX: batchLocalDate is the SERVER-calendar date of the check-in
    // instant (what a real visit AT that instant would compute via
    // localCalendarDate), which is a full day EARLIER than the owner's own
    // timezone's calendar date.
    expect(result.batchLocalDate).toBe("2026-09-24");
    expect(result.batchLocalDate).toBe(localCalendarDate(result.checkinInstant));
    expect(result.batchLocalDate).not.toBe(ownTzDate);
  });

  it("agrees with dateInTimezone in the common case where the check-in instant doesn't cross a server-calendar day boundary relative to the owner's own date", () => {
    vi.stubEnv("TZ", "UTC");
    const now = new Date("2026-09-24T15:00:00.000Z");
    // America/Chicago in CDT (UTC-5): 08:00 local = 13:00Z, same UTC day.
    const row = { digestHourLocal: 8, digestTimezone: "America/Chicago" };
    const result = isOwnerDueForPrepare(row, now);
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");
    expect(result.batchLocalDate).toBe("2026-09-24");
    expect(result.batchLocalDate).toBe(dateInTimezone(now, row.digestTimezone));
  });
});

describe("isOwnerDueForPrepare — window / lookahead", () => {
  it("is due when the check-in is within the lookahead window", () => {
    vi.stubEnv("TZ", "UTC");
    // Same Tokyo scenario as above; dueAt = 21:30Z Sep24, 2.5h ahead of now.
    const now = new Date("2026-09-24T19:00:00.000Z");
    const result = isOwnerDueForPrepare({ digestHourLocal: 8, digestTimezone: "Asia/Tokyo" }, now);
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");
    expect(result.dueAt.toISOString()).toBe("2026-09-24T21:30:00.000Z");
    expect(result.dueAt.getTime()).toBeGreaterThan(now.getTime()); // genuinely still ahead, not yet past
  });

  it("is NOT due when the check-in is further away than the lookahead window", () => {
    vi.stubEnv("TZ", "UTC");
    // 20:00 UTC check-in, dueAt 18:30Z -- 8.5h after `now`, well beyond the
    // default 3h lookahead. Plain UTC on purpose, to isolate "far in the
    // future" from any cross-midnight timezone effect (covered separately
    // by the P11 tests above).
    const now = new Date("2026-09-24T10:00:00.000Z");
    const result = isOwnerDueForPrepare({ digestHourLocal: 20, digestTimezone: "UTC" }, now);
    expect(result).toEqual({ due: false, reason: "outside_window" });
  });

  it("has NO lower bound: a dueAt already in the past still reports due:true (enqueue is a cheap idempotent upsert; self-heals within one owner-local day) -- named deliberately in due-owners.ts's own header", () => {
    vi.stubEnv("TZ", "UTC");
    const now = new Date("2026-09-25T00:30:00.000Z"); // dueAt (21:30Z Sep24) is 3h in the past
    const result = isOwnerDueForPrepare({ digestHourLocal: 8, digestTimezone: "Asia/Tokyo" }, now);
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");
    expect(result.dueAt.getTime()).toBeLessThan(now.getTime());
  });

  it("respects an explicit lookaheadMs override -- the same far-future check-in the default window rejects becomes due under a wider one", () => {
    vi.stubEnv("TZ", "UTC");
    const now = new Date("2026-09-24T10:00:00.000Z");
    const row = { digestHourLocal: 20, digestTimezone: "UTC" };
    expect(isOwnerDueForPrepare(row, now)).toEqual({ due: false, reason: "outside_window" });
    const result = isOwnerDueForPrepare(row, now, { lookaheadMs: 24 * 60 * 60 * 1000 });
    expect(result.due).toBe(true);
  });

  it("returns timezone_unresolved for a garbage timezone string, never a false due:true", () => {
    vi.stubEnv("TZ", "UTC");
    const result = isOwnerDueForPrepare(
      { digestHourLocal: 8, digestTimezone: "Not/A_Real_Zone" },
      new Date("2026-09-24T10:00:00.000Z"),
    );
    expect(result).toEqual({ due: false, reason: "timezone_unresolved" });
  });

  it("returns timezone_unresolved for an out-of-range hour, never throws", () => {
    vi.stubEnv("TZ", "UTC");
    const result = isOwnerDueForPrepare(
      { digestHourLocal: 25, digestTimezone: "UTC" },
      new Date("2026-09-24T10:00:00.000Z"),
    );
    expect(result).toEqual({ due: false, reason: "timezone_unresolved" });
  });
});

// Guide §3 item 6 — DST-edge due-SELECTION regression pin, reusing the
// exact already-proven America/Chicago 2026-03-08 spring-forward fixture
// from prepare-due.test.ts (NOT re-proving the underlying Intl math, which
// stays that file's job -- this only pins that due-selection's own
// checkin/dueAt computation continues to agree with it).
describe("isOwnerDueForPrepare — DST edge (America/Chicago, 2026-03-08 spring-forward)", () => {
  it("computes the same check-in instant timezone.ts's own proven fixture does, and a dueAt 90 minutes earlier", () => {
    vi.stubEnv("TZ", "UTC");
    // Comfortably after the 08:00Z transition instant, so
    // dateInTimezone(now, tz) resolves to "2026-03-08" (CDT already active).
    const now = new Date("2026-03-08T15:00:00.000Z");
    const row = { digestHourLocal: 3, digestTimezone: "America/Chicago" };
    expect(dateInTimezone(now, row.digestTimezone)).toBe("2026-03-08");

    const result = isOwnerDueForPrepare(row, now, { lookaheadMs: 365 * 24 * 60 * 60 * 1000 });
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");

    // Pinned against prepare-due.test.ts's own proven value for this exact
    // (localDate, hourLocal, timezone) triple.
    expect(result.checkinInstant.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(result.checkinInstant.toISOString()).toBe(
      utcInstantForLocalWallClock("2026-03-08", 3, "America/Chicago")?.toISOString(),
    );
    expect(hourInTimezone(result.checkinInstant, "America/Chicago")).toBe(3);
    expect(result.dueAt.toISOString()).toBe("2026-03-08T06:30:00.000Z"); // 08:00 - 90min
    expect(result.batchLocalDate).toBe("2026-03-08");
  });
});

// Guide §3 item 11 — lead-time regression guard. Pins the CONSEQUENCE of P1
// (lead=90) against the hourly ":05" GitHub Actions grid
// (.github/workflows/digest-cron.yml's own cron string): the realized lead
// (target reading instant minus the first grid point at/after dueAt) must
// never be negative or zero. Derivation (recorded in the B guide's own
// §1.6, re-verified here programmatically rather than by hand): grid points
// are 60 minutes apart, so the gap between dueAt and the next grid point at
// or after it is in [0, 60) minutes, making the realized lead fall in
// (lead-60, lead] -- with lead=90, that's (30, 90], always positive. If a
// future change silently lowers PREPARE_LEAD_MINUTES back toward 45 (or
// below 60), this test starts failing rather than the regression going
// unnoticed.
function firstFiveGridPointAtOrAfter(instant: Date): Date {
  const d = new Date(instant);
  d.setUTCSeconds(0, 0);
  const hourStartMs = new Date(d).setUTCMinutes(0);
  const fivePastThisHour = new Date(hourStartMs + 5 * 60_000);
  if (fivePastThisHour.getTime() >= instant.getTime()) return fivePastThisHour;
  return new Date(fivePastThisHour.getTime() + 60 * 60_000);
}

describe("lead-time regression guard — realized lead against the hourly :05 grid", () => {
  it.each([
    // Whole-UTC-hour-offset zone (B guide §1.6's own worked example class).
    { digestHourLocal: 8, digestTimezone: "America/Chicago", now: new Date("2026-09-24T00:00:00.000Z"), label: "whole-hour offset (America/Chicago CDT)" },
    // Fractional-hour-offset zone (B guide §1.6's own worked example class).
    { digestHourLocal: 8, digestTimezone: "Asia/Kolkata", now: new Date("2026-09-24T00:00:00.000Z"), label: "fractional-hour offset (Asia/Kolkata, UTC+5:30)" },
  ])("realized lead is always positive and at most $PREPARE_LEAD_MINUTES min for $label", ({ digestHourLocal, digestTimezone, now }) => {
    vi.stubEnv("TZ", "UTC");
    const result = isOwnerDueForPrepare(
      { digestHourLocal, digestTimezone },
      now,
      { lookaheadMs: 365 * 24 * 60 * 60 * 1000 },
    );
    expect(result.due).toBe(true);
    if (!result.due) throw new Error("unreachable");

    const claimInstant = firstFiveGridPointAtOrAfter(result.dueAt);
    const realizedLeadMinutes = (result.checkinInstant.getTime() - claimInstant.getTime()) / 60_000;

    expect(realizedLeadMinutes).toBeGreaterThan(PREPARE_LEAD_MINUTES - 60);
    expect(realizedLeadMinutes).toBeLessThanOrEqual(PREPARE_LEAD_MINUTES);
    expect(realizedLeadMinutes).toBeGreaterThan(0); // the actual product guarantee P1 exists to protect
  });
});

describe("PREPARE_LOOKAHEAD_MS", () => {
  it("is a generous, multi-hour window (PROPOSED, not overridden by any §1x ruling)", () => {
    expect(PREPARE_LOOKAHEAD_MS).toBe(3 * 60 * 60 * 1000);
  });
});
