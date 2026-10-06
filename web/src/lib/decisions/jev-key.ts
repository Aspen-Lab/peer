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
 * 1 to 512 characters, every one of them printable ASCII (0x21 to 0x7E:
 * letters, digits and punctuation). A pasted line break, a "Bearer " prefix with
 * its space, or a second word all fail, which is the usual way a paste goes
 * wrong; so does a smart quote, a zero-width space or any non-ASCII character,
 * which is the other usual way a paste from a document goes wrong.
 *
 * **Why ASCII and not "anything but whitespace".** The key travels in an HTTP
 * `Authorization` header, and `fetch` refuses a header value with a character
 * outside Latin-1 before it makes any request. The server cannot tell that from
 * a network failure, so such a paste used to read "Jev did not answer" and the
 * day's pool was cached as unavailable. Refusing it here makes the browser say
 * "That does not look like a key" at once, and the key is never sent. ASCII is
 * stricter than Latin-1 on purpose: no real key is expected outside it, and
 * the narrower rule has no byte-order or half-encoded cases to reason about.
 *
 * Nothing in here logs, stores or returns anything but the trimmed input.
 */

export const JEV_KEY_MAX_LENGTH = 512;

// Printable ASCII only: ! (0x21) to ~ (0x7E). The space (0x20), every control
// character and everything outside ASCII fail, wherever they sit in the string.
const KEY_SHAPE = /^[\x21-\x7e]+$/;

/** The trimmed key, or `undefined` when the value is not shaped like one. */
export function parseJevApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  if (key.length === 0 || key.length > JEV_KEY_MAX_LENGTH) return undefined;
  if (!KEY_SHAPE.test(key)) return undefined;
  return key;
}
