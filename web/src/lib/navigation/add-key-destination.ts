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
