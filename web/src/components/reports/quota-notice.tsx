"use client";

import Link from "next/link";
import { REPORT_LABEL_STEP } from "./report-section";
import { quotaMessage, type QuotaSignal } from "@/lib/usage/deep-report-quota";
import type { Plan } from "@/lib/entitlement/types";

/**
 * ABC-freemium 2-07 · R-QUOTA-1 · Ruling 3 point 1 · Ruling 4 point 2 ·
 * Ruling 6 point 2.
 *
 * **The half of R-QUOTA-1 that nothing rendered.** The requirement's own
 * sentence is "the UI shows an English message … and an upgrade prompt", and
 * for a whole round the server computed a correct message, tested it three
 * ways, and showed it to nobody: `quotaMessage` had **zero** production callers
 * and all three client fetchers dropped the `quota` field on the floor.
 *
 * ── WHAT IT SAYS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────
 *
 *  - **`exhausted`** — the sentence plus an upgrade prompt. This reader has
 *    spent their allowance, and a plan is the thing that changes that.
 *  - **`unavailable`** — the sentence and **no upgrade prompt**. Nothing the
 *    reader buys fixes a counter-store outage, so an upsell here would be a
 *    second lie on top of the one 2-02 removed.
 *  - **no `quota` at all** — `null`. Nothing is rendered, not an empty box and
 *    not a heading over nothing: the overwhelmingly common case is a reader
 *    with allowance left, and a report that grows a permanent empty panel is
 *    worse than one that says nothing.
 *
 * The reader still has their complete deterministic report either way — that is
 * the existing degraded payload, and this component sits beside it rather than
 * replacing anything.
 *
 * **D7's price is display only** and there is no checkout link, for the same
 * reason `TierUpgradeBlock` has none: spec §3 puts payment out of scope and a
 * dead link is worse than no link. The prompt points at the key panel, which is
 * a real thing a reader can act on today.
 *
 * ── ABC-freemium 3-01 · R-UI-3 · Ruling 8 point 1 · Ruling 9 point 4 ─────────
 *
 * **A paid reader is never upsold.** A paid reader who trips D4's 200/day
 * wallet breaker gets `{kind:"breaker", reason:"exhausted"}` — which is exactly
 * the payload R-QUOTA-2 specifies, so the *server* was right and this component
 * was the defect: it decided the prompt on `reason === "exhausted"` alone and
 * told a paying customer to pay. D7 makes the price display-only, so there is
 * nothing for them to buy; and telling the one group who already paid to pay is
 * wrong data aimed at precisely the wrong reader.
 *
 * **Two booleans, not one.** The old single `exhausted` flag drove the heading
 * *and* the prompt, so the obvious fix — make `exhausted` plan-aware — would
 * have silently retitled a paid reader's breaker notice **"Deep reports
 * unavailable"**, which reads like an outage they should wait out. The heading
 * and the sentence keep using `exhausted`; only `showUpgradePrompt` is
 * plan-aware.
 *
 * **The plan is a required prop and comes from the server's entitlement**
 * (`ClientEntitlement.effectivePlan`, the same value `TierUpgradeBlock` on the
 * next line already takes) — never inferred from the shape of the refusal,
 * which Ruling 8 forbids, and never read from the store here, because all three
 * report trees render in tests with no store setup and the paid path could then
 * never be asserted. It is **required, not optional-defaulting-to-`"free"`**:
 * that default would fail *open* on the exact property being fixed, so a fourth
 * call site that forgot the prop would upsell a paid reader silently. Same
 * reasoning as `FigureMatchContext`, which is required on purpose.
 *
 * **Trial readers still get the prompt.** `TierUpgradeBlock` uses
 * `effectivePlan === "free"` and so shows a trial reader nothing — a deliberate
 * difference, not an inconsistency to tidy up. Ruling 8 point 1 scopes the
 * prompt to free **and trial**, and trial readers are exactly the group with 20
 * reports to exhaust, so the predicate here is `!== "paid"`, not `=== "free"`.
 *
 * **What a paid reader at the breaker sees:** the heading, the sentence with a
 * real hours count, and nothing else. The `<aside>` still renders — the
 * sentence is true information they need — but not an empty bordered panel and
 * not a third paragraph. Only the prompt is dropped.
 *
 * ── ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 ───────────────────────
 *
 * **`null` is a third value, and it means "not known yet".** 3-01 made the prop
 * required so no call site could forget it, and that was right — but the value
 * a call site had to pass was itself a guess for the first moments of every
 * page. The client entitlement started life as the frozen anonymous default, so
 * `effectivePlan` arrived here as `"free"` for **every** reader, paid included,
 * until `GET /api/profile` came back. The prompt below then told a paying
 * customer to pay, which is the very thing Ruling 8 forbids.
 *
 * The prop is still required — a caller must still make a choice — but the
 * choice now includes "I do not know", and that answer renders **no prompt**.
 * **An upsell requires positive evidence that the reader is not entitled;
 * absence of data is not evidence.**
 *
 * The heading and the sentence are unaffected. They are facts about the
 * refusal the server sent, true whoever is reading, and suppressing them while
 * the plan loads would replace a wrong prompt with a blank panel.
 */
export function QuotaNotice({
  quota,
  effectivePlan,
  className = "",
}: {
  /** From the report response. Absent whenever the reader was served. */
  quota?: QuotaSignal;
  /**
   * The reader's server-resolved plan, or **`null` while it is still unknown**
   * (6-04). **Required on purpose** — see the note above; a `"free"` default
   * would fail open on the property this prop exists to enforce, and so would
   * an optional prop that arrived `undefined`.
   */
  effectivePlan: Plan | null;
  className?: string;
}) {
  if (!quota) return null;

  const exhausted = quota.reason === "exhausted";
  // R-UI-3 — the upsell, and ONLY the upsell, is plan-aware. Keeping this a
  // second name rather than narrowing `exhausted` is what stops the heading
  // changing with it.
  //
  // 6-04 — `effectivePlan !== null` is written out rather than folded into the
  // comparison below, because `null !== "paid"` is `true` and the shorter form
  // upsells exactly the reader whose plan we have not read yet.
  const showUpgradePrompt =
    exhausted && effectivePlan !== null && effectivePlan !== "paid";

  return (
    <aside
      className={`mt-10 overflow-hidden rounded-2xl border border-border bg-bg-secondary/50 ${className}`}
      data-testid="quota-notice"
      data-quota-reason={quota.reason}
    >
      <div className="px-5 py-4 sm:px-6">
        <p className={`${REPORT_LABEL_STEP} text-accent`}>
          {exhausted ? "Deep reports" : "Deep reports unavailable"}
        </p>
        <p className="mt-2 text-body-sm leading-6 text-text-muted">
          {quotaMessage(quota)}
        </p>
        {showUpgradePrompt ? (
          <p className="mt-3 text-caption leading-5 text-text-faint">
            Peer Pro lifts the monthly limit.{" "}
            <Link
              href="/settings"
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              Add your own key
            </Link>{" "}
            to keep going now.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
