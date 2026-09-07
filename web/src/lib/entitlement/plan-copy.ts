/**
 * ABC-freemium 7-02(b) · D7 · Ruling 19 points 1-2 — **what Peer Pro costs and
 * what it adds, written once.**
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 *
 * 7-02(a) gave the three upsell surfaces one destination. That fixed a link
 * that resolved to nothing; it did **not** fix a link that resolved to a page
 * with nothing to say. `PoolRefreshNotice`'s call to action reads *"See what
 * Pro adds"* and landed on the AI step of the onboarding wizard, which contains
 * **zero** plan words — round-7 B drove all six entitlement states through the
 * real page and scanned for nine plan and pricing terms; every one was absent
 * on every persona. **A control that resolves and does not answer its own
 * promise is still a broken promise. It just returns 200.**
 *
 * B also measured the wider version of the same gap: before this module, the
 * price lived in `tier-upgrade-block.tsx` alone, which renders **only** for a
 * signed-in free reader with locked rows in an open report. A trial reader, a
 * paid reader, a signed-out reader, and any free reader who never opened a
 * report **could not find the price anywhere in the product.**
 *
 * ── EVERY STRING HERE ALREADY SHIPPED. NONE OF IT IS NEW COPY ───────────────
 *
 * Ruling 19 point 2(b) is explicit that the AI step reuses the exact sentences
 * that already existed, so no editorial decision is being taken and no owner
 * ruling is needed — this is the same sentence in one more place, already ruled
 * under D7. Each constant records where it was lifted from, and the surface it
 * came from now imports it rather than keeping its own copy. **Extracted, never
 * duplicated:** two copies of a sentence is how `/settings` and
 * `/welcome?step=ai` drifted apart for five rounds.
 *
 * ── D7 TRAVELS WITH THE COPY ────────────────────────────────────────────────
 *
 * **The price is display only. There is no checkout link and must not be one**
 * — spec §3 puts payment out of scope, and a dead link is worse than no link.
 * That rule is not a property of `TierUpgradeBlock`; it is a property of these
 * strings, so it is written here, where anyone rendering them will read it.
 * When payment ships, the one destination to change is `UPGRADE_HREF` in
 * `src/lib/navigation/upgrade-destination.ts`.
 *
 * ── A SENTENCE THAT DID NOT TRAVEL, AND WHY ─────────────────────────────────
 *
 * `TierUpgradeBlock`'s heading *"Also in this report on Peer Pro"* is **not**
 * here. It is scoped to an open report by its own wording ("in this report"),
 * so it cannot be rendered anywhere else without becoming false. The benefit it
 * names — deeper report content — is carried by the deep-report pair below.
 */

/** The product's own name, as the interface spells it. */
export const PRO_NAME = "Peer Pro";

/**
 * D7's price, split exactly as `tier-upgrade-block.tsx` renders it: the lead is
 * emphasised, the tail is not. Kept as two constants rather than one sentence
 * so the existing emphasis survives the move unchanged.
 *
 * From `tier-upgrade-block.tsx`.
 */
export const PRO_PRICE_LEAD = "Peer Pro is $12/month";
/** @see PRO_PRICE_LEAD — the unemphasised tail, rendered straight after it. */
export const PRO_PRICE_TAIL = ", or $6 for students.";

/** `QuotaNotice`'s heading on the exhausted branch. */
export const DEEP_REPORTS_LABEL = "Deep reports";
/**
 * What Pro adds to deep reports. From `quota-notice.tsx`, where it follows the
 * exhaustion sentence; anywhere else it needs `DEEP_REPORTS_LABEL` above it, or
 * *"the monthly limit"* has nothing to refer to.
 */
export const PRO_LIFTS_MONTHLY_LIMIT = "Peer Pro lifts the monthly limit.";

/** `PoolRefreshNotice`'s heading. */
export const POOL_REFRESH_LABEL = "Refresh now";
/**
 * The free reader's explanation of the weekly pool. Carried alongside
 * `PRO_REFRESHES_ON_DEMAND` because it is the antecedent for *"them"* — the two
 * sentences render together in `PoolRefreshNotice` today and must stay together
 * wherever else they go.
 */
export const POOL_REFRESH_IS_WEEKLY =
  "Refresh now is on the paid plan. Your jobs and events refresh once a week.";
/** @see POOL_REFRESH_IS_WEEKLY — *"them"* is that sentence's jobs and events. */
export const PRO_REFRESHES_ON_DEMAND =
  "Peer Pro refreshes them whenever you ask.";
