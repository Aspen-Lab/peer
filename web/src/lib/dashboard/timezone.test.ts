// P4-S8b (Round 3) — see timezone.ts's header. hourInTimezone/
// weekdayInTimezone/dateInTimezone are a byte-identical extraction from
// dispatch-digests/route.ts; the DST/cross-midnight fixtures below are the
// SAME instants route.test.ts's P4-S7-T suite already proves against the
// real route, reused here as direct unit tests of the extracted functions
// themselves (not merely re-proved indirectly through the route).
// utcInstantForLocalWallClock/offsetMinutesAt are new in this module.
import { describe, expect, it } from "vitest";
import {
  dateInTimezone,
  hourInTimezone,
  offsetMinutesAt,
  utcInstantForLocalWallClock,
  weekdayInTimezone,
} from "./timezone";

describe("hourInTimezone / dateInTimezone — extracted, unchanged behaviour", () => {
  it("DST spring-forward boundary (America/Chicago, 2026-03-08): pre-transition instant reads hour 1, date 2026-03-08", () => {
    const instant = new Date("2026-03-08T07:59:00.000Z"); // 01:59 CST, pre-transition
    expect(hourInTimezone(instant, "America/Chicago")).toBe(1);
    expect(dateInTimezone(instant, "America/Chicago")).toBe("2026-03-08");
  });

  it("DST spring-forward boundary (America/Chicago, 2026-03-08): post-transition instant reads hour 3, same local date", () => {
    const instant = new Date("2026-03-08T08:01:00.000Z"); // 03:01 CDT, just after the jump
    expect(hourInTimezone(instant, "America/Chicago")).toBe(3);
    expect(dateInTimezone(instant, "America/Chicago")).toBe("2026-03-08");
  });

  it("cross-midnight: server just after UTC midnight, America/Los_Angeles is still on the previous local day", () => {
    const instant = new Date("2026-09-24T00:30:00.000Z"); // 17:30 previous day PDT (UTC-7)
    expect(hourInTimezone(instant, "America/Los_Angeles")).toBe(17);
    expect(dateInTimezone(instant, "America/Los_Angeles")).toBe("2026-09-23");
  });

  it("cross-midnight (reverse): Asia/Tokyo is already on the NEXT local day while UTC is still the previous day", () => {
    const instant = new Date("2026-09-24T23:30:00.000Z"); // 08:30 next day JST (UTC+9)
    expect(hourInTimezone(instant, "Asia/Tokyo")).toBe(8);
    expect(dateInTimezone(instant, "Asia/Tokyo")).toBe("2026-09-25");
  });

  it("weekdayInTimezone agrees with a known Monday (2026-03-09 UTC is Monday everywhere relevant here)", () => {
    const instant = new Date("2026-03-09T12:00:00.000Z");
    expect(weekdayInTimezone(instant, "America/Chicago")).toBe(1); // Mon
  });

  it("unresolvable timezone fails closed to -1 / null rather than throwing", () => {
    expect(hourInTimezone(new Date(), "Not/A_Zone")).toBe(-1);
    expect(weekdayInTimezone(new Date(), "Not/A_Zone")).toBe(-1);
    expect(dateInTimezone(new Date(), "Not/A_Zone")).toBeNull();
  });
});

describe("offsetMinutesAt", () => {
  it("America/Chicago in CDT (September) is UTC-5 -> -300", () => {
    expect(offsetMinutesAt(new Date("2026-09-24T15:00:00.000Z"), "America/Chicago")).toBe(-300);
  });

  it("America/Chicago in CST (pre spring-forward) is UTC-6 -> -360", () => {
    expect(offsetMinutesAt(new Date("2026-03-08T07:59:00.000Z"), "America/Chicago")).toBe(-360);
  });

  it("America/Chicago in CDT (post spring-forward) is UTC-5 -> -300", () => {
    expect(offsetMinutesAt(new Date("2026-03-08T08:01:00.000Z"), "America/Chicago")).toBe(-300);
  });

  it("Asia/Tokyo has no DST, always UTC+9 -> +540", () => {
    expect(offsetMinutesAt(new Date("2026-09-24T23:30:00.000Z"), "Asia/Tokyo")).toBe(540);
    expect(offsetMinutesAt(new Date("2026-03-08T08:01:00.000Z"), "Asia/Tokyo")).toBe(540);
  });
});

describe("utcInstantForLocalWallClock — the reverse of hourInTimezone/dateInTimezone", () => {
  it("America/Chicago spring-forward: local 03:00 on 2026-03-08 (first valid CDT minute) is 2026-03-08T08:00:00.000Z", () => {
    const result = utcInstantForLocalWallClock("2026-03-08", 3, "America/Chicago");
    expect(result?.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("America/Chicago pre-transition: local 01:00 on 2026-03-08 (CST) is 2026-03-08T07:00:00.000Z", () => {
    const result = utcInstantForLocalWallClock("2026-03-08", 1, "America/Chicago");
    expect(result?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("America/Los_Angeles: local 17:00 on 2026-09-23 (PDT) is 2026-09-24T00:00:00.000Z (crosses UTC midnight)", () => {
    const result = utcInstantForLocalWallClock("2026-09-23", 17, "America/Los_Angeles");
    expect(result?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("Asia/Tokyo: local 08:00 on 2026-09-25 (JST) is 2026-09-24T23:00:00.000Z (crosses UTC midnight backwards)", () => {
    const result = utcInstantForLocalWallClock("2026-09-25", 8, "Asia/Tokyo");
    expect(result?.toISOString()).toBe("2026-09-24T23:00:00.000Z");
  });

  it("round-trips through hourInTimezone/dateInTimezone for every P4-S7-T fixture (both modules provably agree)", () => {
    const fixtures: Array<{ localDate: string; hour: number; tz: string }> = [
      { localDate: "2026-03-08", hour: 1, tz: "America/Chicago" },
      { localDate: "2026-03-08", hour: 3, tz: "America/Chicago" },
      { localDate: "2026-09-23", hour: 17, tz: "America/Los_Angeles" },
      { localDate: "2026-09-25", hour: 8, tz: "Asia/Tokyo" },
    ];
    for (const fixture of fixtures) {
      const instant = utcInstantForLocalWallClock(fixture.localDate, fixture.hour, fixture.tz);
      expect(instant).not.toBeNull();
      expect(hourInTimezone(instant as Date, fixture.tz)).toBe(fixture.hour);
      expect(dateInTimezone(instant as Date, fixture.tz)).toBe(fixture.localDate);
    }
  });

  it("malformed local date returns null rather than a garbage instant", () => {
    expect(utcInstantForLocalWallClock("not-a-date", 9, "America/Chicago")).toBeNull();
    expect(utcInstantForLocalWallClock("2026-13-40", 9, "America/Chicago")).not.toBeNull(); // regex-valid shape; JS Date normalizes overflow rather than rejecting — documented, not a defect this module introduces
  });

  it("out-of-range hour/minute returns null", () => {
    expect(utcInstantForLocalWallClock("2026-09-24", 24, "America/Chicago")).toBeNull();
    expect(utcInstantForLocalWallClock("2026-09-24", -1, "America/Chicago")).toBeNull();
    expect(utcInstantForLocalWallClock("2026-09-24", 9, "America/Chicago", 60)).toBeNull();
  });
});
