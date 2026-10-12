/**
 * The local calendar day as `YYYY-MM-DD`: the period of a papers pool and of
 * its cache key. Local components throughout (`getFullYear`, `getMonth`,
 * `getDate`), never a UTC slice, so the key rolls over at the server's own
 * midnight and not at UTC's.
 */
export function localCalendarDate(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
