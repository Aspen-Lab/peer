/**
 * The one rule for what counts as a Jev API key, shared by the browser (which
 * sends a key only when it passes) and the feed route (which uses a key only
 * when it passes), so the two cannot disagree about a half-pasted value.
 *
 * Peer has no Jev key of its own. The key is the reader's: they apply for it
 * with Jev, paste it into their browser, and the browser sends it with each
 * paper request. This module only decides whether a value is shaped like a
 * key. It does not know what a real key looks like (Peer cannot verify that
 * without calling Jev), so the shape rule is deliberately loose: one string,
 * 1 to 512 characters, no whitespace and no control characters. A pasted
 * line break, a "Bearer " prefix with its space, or a second word all fail,
 * which is the usual way a paste goes wrong.
 *
 * Nothing in here logs, stores or returns anything but the trimmed input.
 */

export const JEV_API_KEY_MAX_LENGTH = 512;

// Whitespace anywhere (including a tab, a line break and a no-break space),
// C0 controls, DEL and C1 controls.
const NOT_KEY_CHARACTER = /[\s\u0000-\u001f\u007f-\u009f]/u;

/** The trimmed key, or `undefined` when the value is not shaped like one. */
export function parseJevApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  if (key.length === 0 || key.length > JEV_API_KEY_MAX_LENGTH) return undefined;
  if (NOT_KEY_CHARACTER.test(key)) return undefined;
  return key;
}
