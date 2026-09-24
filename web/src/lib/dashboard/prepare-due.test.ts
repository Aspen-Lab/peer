import { describe, expect, it } from "vitest";
import { dateInTimezone, hourInTimezone, utcInstantForLocalWallClock } from "./timezone";
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_PREPARE_LEAD_MINUTES,
  computePrepareDueAt,
  nextAttemptAt,
  nextAttemptDelayMs,
} from "./prepare-due";

describe("computePrepareDueAt", () => {
  it("subtracts the given lead from the target reading instant", () => {
    // 09:00 America/Chicago on 2026-09-24 (CDT, UTC-5) = 14:00:00.000Z.
    const due = computePrepareDueAt({
      localDate: "2026-09-24",
      hourLocal: 9,
      timezone: "America/Chicago",
      leadMinutes: 45,
    });
    expect(due?.toISOString()).toBe("2026-09-24T13:15:00.000Z");
  });

  it("uses DEFAULT_PREPARE_LEAD_MINUTES when leadMinutes is omitted", () => {
    const withDefault = computePrepareDueAt({ localDate: "2026-09-24", hourLocal: 9, timezone: "America/Chicago" });
    const withExplicit = computePrepareDueAt({
      localDate: "2026-09-24",
      hourLocal: 9,
      timezone: "America/Chicago",
      leadMinutes: DEFAULT_PREPARE_LEAD_MINUTES,
    });
    expect(withDefault?.toISOString()).toBe(withExplicit?.toISOString());
    expect(DEFAULT_PREPARE_LEAD_MINUTES).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_PREPARE_LEAD_MINUTES).toBeLessThanOrEqual(60);
  });

  it("a zero lead equals the target reading instant exactly (agrees with timezone.ts's own reverse conversion)", () => {
    const due = computePrepareDueAt({
      localDate: "2026-09-24",
      hourLocal: 9,
      timezone: "America/Chicago",
      leadMinutes: 0,
    });
    const direct = utcInstantForLocalWallClock("2026-09-24", 9, "America/Chicago");
    expect(due?.toISOString()).toBe(direct?.toISOString());
  });

  // P4-S7-T's exact DST/cross-midnight instants (route.test.ts), reused here
  // so prepare-due.ts and dispatch-digests' existing gate provably compute
  // the same wall-clock meaning for the same (hour, timezone) pair rather
  // than silently drifting apart (DESIGN B4's explicit instruction).
  it.each([
    { localDate: "2026-03-08", hourLocal: 1, timezone: "America/Chicago" }, // pre spring-forward (CST)
    { localDate: "2026-03-08", hourLocal: 3, timezone: "America/Chicago" }, // post spring-forward (CDT)
    { localDate: "2026-09-23", hourLocal: 17, timezone: "America/Los_Angeles" }, // cross-midnight
    { localDate: "2026-09-25", hourLocal: 8, timezone: "Asia/Tokyo" }, // cross-midnight, reverse direction
  ])(
    "round-trips through hourInTimezone/dateInTimezone for $timezone $localDate $hourLocal:00 (zero lead)",
    ({ localDate, hourLocal, timezone }) => {
      const due = computePrepareDueAt({ localDate, hourLocal, timezone, leadMinutes: 0 });
      expect(due).not.toBeNull();
      expect(hourInTimezone(due as Date, timezone)).toBe(hourLocal);
      expect(dateInTimezone(due as Date, timezone)).toBe(localDate);
    },
  );

  it("a 45-minute lead still lands on the correct PRE-transition side of the Chicago spring-forward jump", () => {
    // Target: 03:00 CDT 2026-03-08 = 08:00:00Z. A 45-min lead = 07:15:00Z,
    // which is still pre-transition wall-clock-wise in absolute UTC terms
    // (the transition instant itself is 08:00:00Z) — this proves the lead
    // subtraction operates on the absolute instant, not by re-running the
    // local-wall-clock conversion a second time (which could misbehave
    // inside the skipped 02:00-02:59 local hour).
    const due = computePrepareDueAt({
      localDate: "2026-03-08",
      hourLocal: 3,
      timezone: "America/Chicago",
      leadMinutes: 45,
    });
    expect(due?.toISOString()).toBe("2026-03-08T07:15:00.000Z");
  });

  it("returns null when the underlying wall-clock conversion can't be resolved", () => {
    expect(computePrepareDueAt({ localDate: "not-a-date", hourLocal: 9, timezone: "America/Chicago" })).toBeNull();
    expect(computePrepareDueAt({ localDate: "2026-09-24", hourLocal: 25, timezone: "America/Chicago" })).toBeNull();
  });
});

describe("nextAttemptDelayMs / nextAttemptAt — deterministic exponential backoff", () => {
  it("doubles per attempt starting from the base", () => {
    expect(nextAttemptDelayMs(1)).toBe(DEFAULT_BACKOFF_BASE_MS);
    expect(nextAttemptDelayMs(2)).toBe(DEFAULT_BACKOFF_BASE_MS * 2);
    expect(nextAttemptDelayMs(3)).toBe(DEFAULT_BACKOFF_BASE_MS * 4);
    expect(nextAttemptDelayMs(4)).toBe(DEFAULT_BACKOFF_BASE_MS * 8);
  });

  it("caps at DEFAULT_BACKOFF_MAX_MS and never exceeds it for a large attempt count", () => {
    expect(nextAttemptDelayMs(6)).toBe(DEFAULT_BACKOFF_MAX_MS);
    expect(nextAttemptDelayMs(50)).toBe(DEFAULT_BACKOFF_MAX_MS);
  });

  it("treats a non-positive attempts count as 1 rather than throwing or returning a negative/zero delay", () => {
    expect(nextAttemptDelayMs(0)).toBe(DEFAULT_BACKOFF_BASE_MS);
    expect(nextAttemptDelayMs(-3)).toBe(DEFAULT_BACKOFF_BASE_MS);
  });

  it("is a pure function of its inputs: same attempts -> same delay, every time", () => {
    const a = nextAttemptDelayMs(3);
    const b = nextAttemptDelayMs(3);
    expect(a).toBe(b);
  });

  it("nextAttemptAt adds the delay to the given clock", () => {
    const now = new Date("2026-09-24T15:00:00.000Z");
    const result = nextAttemptAt(2, now);
    expect(result.toISOString()).toBe(new Date(now.getTime() + DEFAULT_BACKOFF_BASE_MS * 2).toISOString());
  });

  it("accepts custom base/max overrides", () => {
    expect(nextAttemptDelayMs(1, 1000, 5000)).toBe(1000);
    expect(nextAttemptDelayMs(10, 1000, 5000)).toBe(5000);
  });
});
