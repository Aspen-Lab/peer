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
 * So only two destinations are allowed, the two pages that send a reader to
 * sign in, each with an optional query string; anything else is refused and
 * the callback falls back to `/`.
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

/**
 * The value itself when it is a safe place to land after sign-in, else `null`.
 *
 * Safe means: it starts with "/" (and not "//" or "/\"), holds no backslash and
 * no control character anywhere, is at most 200 characters long, and its path
 * (everything before the first "?") is exactly `/welcome` or `/profile`. A
 * query string after that is allowed. The value is checked as given and never
 * decoded here, so an encoded trick stays inside the path part and fails the
 * exact match.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > RETURN_PATH_MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  if (CONTROL_CHARACTER.test(value)) return null;
  const queryAt = value.indexOf("?");
  const path = queryAt === -1 ? value : value.slice(0, queryAt);
  if (!ALLOWED_RETURN_PATHS.has(path)) return null;
  return value;
}
