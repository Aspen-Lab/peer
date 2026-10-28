/**
 * **The one place the "add your own key" link points at.**
 *
 * Peer holds no model key of its own: a reader reads without a model until they
 * paste their own. The surfaces that say so (the reading column's "add a key"
 * link, and any later one) all land on the same panel, the AI step of the
 * welcome wizard, and they take the destination from here rather than each
 * carrying a string of their own. The history behind that is a defect:
 * a call to action once pointed at `/settings`, a route that has never existed on
 * any branch, and the button landed on `not-found` for five rounds because every
 * review asked "does the prompt render?" and none asked "does its button go
 * anywhere?". Three copies of a string is three chances to get it wrong.
 * `add-key-destination.test.ts` stops a fourth literal appearing, and
 * `dead-links.test.ts` resolves every internal link against the real route tree.
 *
 * **The destination must answer the promise the control made.** A link reading
 * "Add a key" must land on a page where a key can be added; `/welcome?step=ai`
 * renders the key panel for exactly that reason.
 *
 * If a later change needs a destination that has not been built, the honest
 * shape is to let the call to action be **omitted** — the type becomes nullable
 * and the surface renders the sentence without a link. A missing link is
 * honest; a dead one is not. Never point this at a placeholder.
 */
export const ADD_KEY_HREF = "/welcome?step=ai";

/**
 * Where a reader who has a key but is signed out is sent to sign in. Peer uses
 * the key only for a signed-in reader (`aiAvailability`), so for them the call
 * to action is "Sign in", not "Add a key": a key is already there. The Profile
 * page's first block is the Account section, with the GitHub and Google sign-in
 * buttons; `dead-links.test.ts` cannot see a destination held in a constant, so
 * `add-key-destination.test.ts` pins this one as it pins `ADD_KEY_HREF`.
 */
export const SIGN_IN_HREF = "/profile";

/**
 * A paper's own path, as a place to come back to: `/papers/` and the id
 * percent-encoded into one segment, which the paper page decodes back to the
 * same id (`decodeURIComponent` on its route param). An id with a `/` or a `?`
 * in it therefore stays one segment.
 */
export function paperReturnPath(paperId: string): string {
  return `/papers/${encodeURIComponent(paperId)}`;
}

/**
 * The sign-in link that brings the reader back to `returnTo` once signed in:
 * `SIGN_IN_HREF` with `?return=` and the path, encoded as one query value. The
 * Profile's Account section reads `return`, checks it (`safeReturnPath`) and
 * hands it to the sign-in buttons; a value it refuses lands on the feed, as a
 * sign-in always did. With no path, the plain `SIGN_IN_HREF`.
 */
export function signInHref(returnTo?: string): string {
  return returnTo ? `${SIGN_IN_HREF}?return=${encodeURIComponent(returnTo)}` : SIGN_IN_HREF;
}
