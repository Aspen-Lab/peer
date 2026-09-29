// P4-S8b (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S8b C assigned" ruling,
// docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN B4 ("Due-time computation
// ... should REUSE — not re-derive a third time — the exact
// Intl.DateTimeFormat-based hourInTimezone/dateInTimezone helpers
// dispatch-digests/route.ts already has and P4-S7-T already proved
// DST-correct").
//
// EXTRACTED, BYTE-IDENTICAL BODIES from
// web/src/app/api/jobs/dispatch-digests/route.ts (which now imports these
// three functions from here instead of declaring them locally) — this file
// changes zero behaviour, only where the code lives. Proof: route.test.ts's
// and idempotency.test.ts's full DST/cross-midnight/concurrency suites
// (P4-S7/P4-S7-T) pass unchanged after the extraction; neither test file
// imports these functions directly (both only import `GET` and
// `digestIdempotencyKey`), so there was nothing to update in either test
// file.
//
// Second caller: web/src/lib/dashboard/prepare-due.ts (P4-S8b) reuses these
// unchanged so the "scheduled feed ready ahead of reading time" due-time
// math and the existing digest-dispatch hour/date gate can never silently
// drift apart from computing the same wall-clock question two different
// ways — see that module's own header for the "two copies is exactly how
// the prefix drifts" precedent this codebase already names elsewhere
// (ledger-flag.ts).

/** Returns the hour (0–23) of the given instant in the given IANA timezone. */
export function hourInTimezone(instant: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(instant);
    const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
    // "24" can appear for midnight depending on runtime — normalize.
    const h = parseInt(hourPart, 10) % 24;
    return Number.isFinite(h) ? h : -1;
  } catch {
    return -1;
  }
}

/** Returns 0 (Sun) – 6 (Sat) for the given instant in the given timezone. */
export function weekdayInTimezone(instant: Date, tz: string): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(instant);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  } catch {
    return -1;
  }
}

// Returns "YYYY-MM-DD" for the given instant in the given IANA timezone, or
// null if the timezone can't be resolved. Deliberately NOT a reuse of
// web/src/lib/local-calendar-date.ts's `localCalendarDate`: that helper reads
// the SERVER's own local zone (UTC on Vercel), which is the wrong value here
// — this needs the recipient's own `digest_timezone`, the same one
// `hourInTimezone` above already resolves per row.
export function dateInTimezone(instant: Date, tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Minutes to ADD to UTC to get local time in `tz`, at the given instant
 * (e.g. America/Chicago in CDT is -300; Asia/Tokyo is always +540). Derived
 * by formatting `instant` in `tz`, reinterpreting those wall-clock parts as
 * if they were themselves UTC, and diffing against the true instant — the
 * standard Intl-based way to recover a timezone's current offset without a
 * date library. Exported for prepare-due.ts's own doc comment/tests; not
 * used by dispatch-digests/route.ts (this is new to P4-S8b, not part of the
 * byte-identical extraction above).
 */
export function offsetMinutesAt(instant: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    let hour = get("hour");
    if (hour === 24) hour = 0; // some runtimes represent midnight as 24
    const asUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
    return (asUtcMs - instant.getTime()) / 60000;
  } catch {
    return 0;
  }
}

/**
 * The inverse of hourInTimezone/dateInTimezone: given a desired local wall
 * clock (YYYY-MM-DD + hour, minute defaults to 0) in `tz`, returns the UTC
 * instant it corresponds to, or null if `localDate` is malformed or `tz`
 * can't be resolved.
 *
 * Algorithm: start from the naive guess "treat the wall clock as if it were
 * UTC," measure `tz`'s actual offset AT that guess, and correct — repeated
 * three times so a guess landing on the wrong side of a DST transition
 * still converges (two iterations proved sufficient by hand for the
 * spring-forward fixture below; three is one extra safety margin, still
 * O(1) and deterministic). This is the standard Intl-only technique for
 * "reverse" timezone conversion; there is no direct Intl API for it.
 *
 * Hand-verified against P4-S7-T's own America/Chicago 2026-03-08
 * spring-forward fixture (route.test.ts): local 03:00 America/Chicago on
 * 2026-03-08 (the first valid wall-clock minute of CDT, immediately after
 * the 01:59:59 CST -> 03:00:00 CDT jump) converges to
 * 2026-03-08T08:00:00.000Z, which independently matches 03:00 CDT = UTC-5.
 * prepare-due.test.ts turns this into a permanent, in-repo, round-trip
 * assertion against hourInTimezone/dateInTimezone rather than relying on
 * this hand computation alone.
 */
export function utcInstantForLocalWallClock(
  localDate: string,
  hour: number,
  tz: string,
  minute = 0,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  const desiredMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guessMs = desiredMs;
  for (let i = 0; i < 3; i++) {
    const offsetMinutes = offsetMinutesAt(new Date(guessMs), tz);
    const nextGuessMs = desiredMs - offsetMinutes * 60000;
    if (nextGuessMs === guessMs) break;
    guessMs = nextGuessMs;
  }
  const result = new Date(guessMs);
  return Number.isFinite(result.getTime()) ? result : null;
}
