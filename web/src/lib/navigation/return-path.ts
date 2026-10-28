/**
 * Where the browser lands after an OAuth sign-in.
 *
 * The sign-in callback (`app/auth/callback/route.ts`) used to send every reader
 * to `/`, so a reader who signed in from the welcome wizard lost their place.
 * The wizard now asks to come back: before leaving for GitHub or Google the
 * browser sets a short-lived first-party cookie holding the path, and the
 * callback reads it once, checks it here, and deletes it.
 *
 * **Why a cookie and not `redirectTo …?next=`.** A query string on the OAuth
 * `redirectTo` may not match Supabase's Redirect URL allow-list, and changing
 * that list is a production configuration change. The cookie needs none.
 *
 * **Why the check is this strict.** The callback joins the path to its own
 * origin (`${origin}${path}`). A value that is not a plain same-site path turns
 * that into an open redirect: `@evil.com` makes `https://peer.homes@evil.com`
 * (a URL whose host is evil.com), `//evil.com` and `/\evil.com` are read by
 * browsers as a different host, and a control character can split a header.
 * So only three shapes are allowed, the pages that send a reader to sign in:
 * `/welcome` and `/profile`, each with an optional query string, and one
 * paper page, `/papers/<id>` (R14: a signed-out reader with a key is sent from
 * the paper to sign in, and must come back to it). Anything else is refused
 * and the callback falls back to `/`.
 *
 * Pure, and shared by the browser (which writes the cookie) and the callback
 * (which reads it), so both use the same rule.
 */

/** The cookie the browser sets before an OAuth sign-in that should come back. */
export const AFTER_SIGN_IN_COOKIE_NAME = "peer_after_sign_in";

/** Ten minutes: long enough for a provider's sign-in page, short enough to go stale. */
export const AFTER_SIGN_IN_COOKIE_MAX_AGE_SECONDS = 600;

export const RETURN_PATH_MAX_LENGTH = 200;

/** The only paths a sign-in may come back to. */
const ALLOWED_RETURN_PATHS: ReadonlySet<string> = new Set(["/welcome", "/profile"]);

// C0 controls, DEL and C1 controls, anywhere in the value.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

const PAPER_PREFIX = "/papers/";
/** One URI-encoded paper id: no "/", "?", "#", backslash or space can appear. */
const PAPER_SEGMENT = /^[A-Za-z0-9%._~:-]+$/;
/** Every "%" must start a two-digit escape. */
const BROKEN_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

/**
 * `/papers/<one segment>` and nothing more: no further "/", no query, no
 * fragment. The segment is the paper id as the paper's own link encodes it
 * (`/papers/openalex%3AW123`). Refused besides: a broken "%" escape, a
 * segment that decodes to "." or ".." (a dot segment, plain or as `%2e`, which
 * a browser resolves away), and one that decodes to a "/" or a backslash.
 * Those last could not leave Peer's host (the value still starts with
 * `/papers/`), but a paper link never needs them to land somewhere sensible,
 * and refusing is the safer side: a paper whose id holds a "/" (`%2F`) comes
 * back to `/`, as every sign-in did before.
 */
function isPaperReturnPath(value: string): boolean {
  if (!value.startsWith(PAPER_PREFIX)) return false;
  const segment = value.slice(PAPER_PREFIX.length);
  if (!PAPER_SEGMENT.test(segment) || BROKEN_ESCAPE.test(segment)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  if (decoded === "." || decoded === "..") return false;
  if (/[/\\]/.test(decoded) || CONTROL_CHARACTER.test(decoded)) return false;
  return true;
}

/**
 * The value itself when it is a safe place to land after sign-in, else `null`.
 *
 * Safe means: it starts with "/" (and not "//" or "/\"), holds no backslash and
 * no control character anywhere, is at most 200 characters long, and either
 * its path (everything before the first "?") is exactly `/welcome` or
 * `/profile`, with a query string allowed after it, or it is exactly one paper
 * page, `/papers/<id>` (see `isPaperReturnPath`). The value is checked as
 * given and never decoded here (only a paper id is decoded, and only to refuse
 * what it hides), so an encoded trick stays inside the path part and fails the
 * exact match.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > RETURN_PATH_MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  if (CONTROL_CHARACTER.test(value)) return null;
  if (isPaperReturnPath(value)) return value;
  const queryAt = value.indexOf("?");
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  if (!ALLOWED_RETURN_PATHS.has(path)) return null;
  return value;
}
