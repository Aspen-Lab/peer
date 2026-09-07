"use client";

import { Callout } from "@/components/ui";
import {
  DEEP_REPORTS_LABEL,
  POOL_REFRESH_IS_WEEKLY,
  POOL_REFRESH_LABEL,
  PRO_LIFTS_MONTHLY_LIMIT,
  PRO_NAME,
  PRO_PRICE_LEAD,
  PRO_PRICE_TAIL,
  PRO_REFRESHES_ON_DEMAND,
} from "@/lib/entitlement/plan-copy";

/**
 * ABC-freemium 7-02(b) · D7 · Ruling 19 points 1-2 — **what the upsell's
 * destination has to say for the upsell to be honest.**
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 *
 * 7-02(a) gave all three upsell surfaces one destination that exists. One of
 * those surfaces says *"See what Pro adds"*. Round-7 B drove all six
 * entitlement states through the real destination page and scanned the rendered
 * text for nine plan and pricing terms — *Peer Pro, Pro, $12, upgrad, plan,
 * pric, subscrib, student, sign in*. **Every one was absent on every persona.**
 * The link resolved, rendered, and stayed put, and had nothing whatever to do
 * with paying. Ruling 19 point 1: **a control that resolves to a page which
 * does not answer it is still a broken promise — it just returns 200.**
 *
 * B measured the wider version of the same gap too: before this, the price
 * lived in `TierUpgradeBlock` alone, which renders only for a signed-in free
 * reader with locked rows in an open report. **A trial, paid, or signed-out
 * reader could not find the price anywhere in the product.**
 *
 * ── NO NEW COPY (Ruling 19 point 2b) ────────────────────────────────────────
 *
 * Every sentence comes from `plan-copy.ts` and already shipped on another
 * surface; the surfaces it came from now import the same constants rather than
 * keeping their own copies. Nothing here is an editorial decision, so no owner
 * ruling is needed. The two labels are carried **with** their sentences because
 * both sentences need them: *"the monthly limit"* has no referent without
 * "Deep reports", and *"refreshes them"* has no antecedent without the weekly
 * sentence in front of it.
 *
 * ── D7 — DISPLAY ONLY. THERE IS NO CHECKOUT LINK HERE, AND MUST NOT BE ──────
 *
 * Payment is out of scope (spec §3) and a dead link is worse than none. This
 * component renders **no anchor at all**, and its suite asserts that, because
 * the whole point of the round is that a reader clicking a call to action gets
 * somewhere real. Ruling 19 point 7 records the consequence for the owner: with
 * this in place the upgrade path is fully wired for the first time — prompt,
 * page, price — **and then stops, honestly, because D7 says there is no
 * checkout.** Whether the page should offer a way to register interest is the
 * owner's call, not this loop's.
 */
export function ProPlanSummary() {
  return (
    <Callout variant="warm" title={PRO_NAME}>
      <p>
        <strong>{PRO_PRICE_LEAD}</strong>
        {PRO_PRICE_TAIL}
      </p>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="font-semibold text-heading">{DEEP_REPORTS_LABEL}</dt>
          <dd>{PRO_LIFTS_MONTHLY_LIMIT}</dd>
        </div>
        <div>
          <dt className="font-semibold text-heading">{POOL_REFRESH_LABEL}</dt>
          <dd>
            {POOL_REFRESH_IS_WEEKLY} {PRO_REFRESHES_ON_DEMAND}
          </dd>
        </div>
      </dl>
    </Callout>
  );
}
