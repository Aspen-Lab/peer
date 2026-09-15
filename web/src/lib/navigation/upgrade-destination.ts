/**
 * ABC-freemium 7-02(a) · Ruling 18 point 5 · Ruling 19 point 2(a) — **the one
 * place every upsell call to action points at.**
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 *
 * Three surfaces upsell the reader — `TierUpgradeBlock`, `QuotaNotice` and
 * `PoolRefreshNotice` — and each carried its own destination string. Two
 * agreed; one did not. `QuotaNotice` pointed at `/settings`, **a route that has
 * never existed on any branch**, from round 2 until round 7. A free or trial
 * reader who hit the monthly deep-report cap was shown the required upgrade
 * prompt and its single call to action landed on `not-found` — the only path
 * the product has to a paying customer, silently blocked for five rounds while
 * R-QUOTA-1 was scored `MET` three times.
 *
 * It survived because every round asked *"does the prompt render?"* and none
 * asked *"does its button go anywhere?"*. Three copies of a string is three
 * chances to get it wrong; this is one.
 *
 * ── WHAT CHANGES WHEN PAYMENT SHIPS ─────────────────────────────────────────
 *
 * **D7 is display-only: the price is shown, there is no checkout.** When a
 * checkout does exist, it is this constant that moves, and nothing else — one
 * edit, in one file, and all three surfaces follow. That is the whole point of
 * the indirection, so please do not reintroduce a literal at a call site.
 *
 * ── THE CONTRACT FOR A FUTURE DESTINATION THAT DOES NOT EXIST YET ───────────
 *
 * Ruling 19 point 1: **the destination must answer the promise the control
 * made.** Resolving to a real page is necessary and not sufficient — a button
 * reading *"See what Pro adds"* that lands on a page never mentioning Pro is
 * still a broken promise, it just returns 200. That is why 7-02(b) put the plan
 * copy on the AI step: `/welcome?step=ai` renders the key panel **and** what
 * Pro costs and adds, so all three promises are kept there.
 *
 * If a later round ever needs a destination that has not been built, the honest
 * shape is to let the call to action be **omitted** — the type becomes nullable
 * and the surface renders the sentence without a link. A missing link is
 * honest; a dead one is not. Never point this at a placeholder.
 */
export const UPGRADE_HREF = "/welcome?step=ai";
