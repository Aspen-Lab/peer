export function localCalendarDate(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The local ISO week, as `YYYY-Www`.
 *
 * ABC-freemium 1-17 · R-POOL-1 · D3 — jobs and events pools rebuild weekly.
 * It lives next to `localCalendarDate` on purpose: both answer "which period is
 * it, in the server's own calendar", and separating them is how the two would
 * drift on timezone handling.
 *
 * **The `Math.round` is load-bearing, and this is the one place to say why.**
 * Round-1 B swept three candidate implementations day by day across 2019–2031 in
 * ten timezones. The form most commonly published —
 * `Math.ceil(((thursday - jan1) / 86400000 + 1) / 7)` — is exact in every
 * northern-hemisphere zone and **wrong for roughly a seventh of the year in
 * southern-hemisphere DST zones**, where 1 January falls inside DST and the raw
 * millisecond difference rounds the other way: 350 wrong days in
 * Pacific/Chatham, 364 in Australia/Lord_Howe, 308 in America/Santiago. The
 * first divergence is 2021-04-05, which it calls W15 for a day in W14.
 *
 * `Math.round` on the day difference absorbs the DST hour and is exact in every
 * zone tested. **A developer or a CI machine on UTC cannot catch this**, which
 * is why `local-calendar-date.test.ts` stubs `TZ`.
 *
 * Local components throughout — `getFullYear`, `getMonth`, `getDate` — because
 * `localCalendarDate` uses the same, and an ISO week derived from `getUTCDay()`
 * would disagree with it near midnight.
 */
export function localIsoWeek(now = new Date()): string {
  // Work on a date-only copy so a time-of-day cannot shift the arithmetic.
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ISO weeks run Monday-Sunday and belong to the year containing their
  // Thursday. Step to that Thursday first; everything after is counting.
  const isoDayOfWeek = local.getDay() === 0 ? 7 : local.getDay();
  const thursday = new Date(local);
  thursday.setDate(local.getDate() + 4 - isoDayOfWeek);

  const isoYear = thursday.getFullYear();
  const jan1 = new Date(isoYear, 0, 1);
  const days = Math.round((thursday.getTime() - jan1.getTime()) / 86_400_000);
  const week = Math.floor(days / 7) + 1;

  return `${String(isoYear).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}
