"use client";

import Link from "next/link";
import { REPORT_LABEL_STEP } from "@/components/reports/report-section";
import type { ClientEntitlement } from "@/lib/entitlement/allowance";

/**
 * ABC-freemium 6-03 · R-POOL-2 · Ruling 15 point 2 · Ruling 16 points 1, 3, 4,
 * 7 — **the refresh control stops refusing silently.**
 *
 * The server side has been correct since 1-18 and round-5 A proved it: a free
 * reader's `poolRefresh: true` is refused, the route answers **200**, and the
 * pool that was already on screen is served. Nothing rendered that outcome, so
 * a free reader could not tell a refusal from a refresh that happened to return
 * the same pool. A control that is shown, clicked, and then quietly does
 * nothing is a lie of omission, and this build's standard has been "honest
 * emptiness beats a wrong value" since round 1.
 *
 * ── WHY THIS IS A SIBLING AND NOT `QuotaNotice` (Ruling 16 point 7) ──────────
 *
 * Three of `QuotaNotice`'s four visible strings are hard-wired to deep reports:
 * the heading is a literal `"Deep reports"`, the body is `quotaMessage(quota)`
 * whose every branch is a deep-report sentence, and its upsell says *"lifts the
 * **monthly** limit"* — refresh is **weekly**, so that sentence is simply wrong
 * here. Its data contract does not fit either: `QuotaSignal` requires a `kind`,
 * a `remaining` and a `resetsAt`, and a refresh refusal has no honest value for
 * any of the three. Rendering this through it would mean fabricating a signal
 * **and** printing "Deep reports" over a message about pool refresh. Adding a
 * `mode` or `heading` prop would be worse: that component's whole value is that
 * it is hard to misuse, and its own docblock records what happened the last time
 * one flag drove two jobs.
 *
 * So: the same presentation, none of the logic. Two small components with two
 * separate predicates beat one generic box.
 *
 * ── THE PREDICATE — THE CAPABILITY, NEVER THE PLAN NAME (Ruling 16 point 1) ──
 *
 * Keyed on **`poolRefreshAllowed`**, the thing the server actually granted, and
 * never on `effectivePlan`. The obvious-looking `effectivePlan !== "paid"` — the
 * predicate `QuotaNotice` uses next door for a different question — tells a
 * **live trial** reader that refresh is paid *while the server is granting their
 * refresh*. Ruling 8 scopes the deep-report prompt to free and trial because a
 * trial reader has 20 reports to exhaust; that reasoning does not carry here,
 * because a trial reader is not refresh-limited at all. **Gate a feature on the
 * capability the entitlement grants, not on the name of the plan.**
 *
 * ── THE FIVE BRANCHES (Ruling 16 point 3) ───────────────────────────────────
 *
 *  - **not known** (`entitlement === null`) — nothing. An upsell requires
 *    positive evidence that the reader is not entitled; absence of data is not
 *    evidence, and before 6-04 this window told every reader, paid included,
 *    that they were free.
 *  - **known + anonymous** — *"Sign in to refresh."*, and **no** upgrade prompt.
 *    They cannot buy a plan without an account, so "upgrade" is the wrong next
 *    step; signing in is the right one, and the product already has it.
 *  - **known + free** — the explanation plus the upgrade prompt.
 *  - **known + trial** and **known + paid** — nothing. They may refresh; the
 *    control works for them and needs no commentary.
 *
 * ── WHAT THE FREE READER IS BEING TOLD, AND WHAT THEY ARE NOT ───────────────
 *
 * **Nothing is broken for them, and the copy must not apologise.** After this
 * renders, the free reader still has the complete pool that was already on
 * screen: the same items, the same facets, a 200, and no error state. It is not
 * stale in any sense the product promises — `pool-cache.ts` keys the jobs and
 * events pools by local ISO week, so *"your jobs and events refresh once a
 * week"* is a checked fact rather than a softening. Changing topics still
 * rebuilds mid-week, because the topics are inside the cache signature (D3 calls
 * that "their quota to spend"). This message **explains** the pool; it does not
 * report a fault.
 *
 * ── TWO THINGS IT DELIBERATELY DOES NOT DO ──────────────────────────────────
 *
 * 1. **It is not keyed on the response.** Refused and granted return the
 *    identical shape and the same 200; `cacheHit` is computed inside the
 *    pipeline and dropped at the response boundary. That is a good property and
 *    a future round must not "fix" it by adding a `refused` flag — a flag would
 *    immediately become the thing a component keys on, which is the Ruling 8
 *    hole this whole item closes. The entitlement is the source of truth.
 * 2. **It is not shown on the Papers tab.** The tile serves papers too, and
 *    papers refresh is a plain refetch on a daily pool (D3) and is **not** a
 *    paid feature. Telling a free reader on Papers that refresh is paid would be
 *    false, so the caller gates on the surface as well.
 */
export function PoolRefreshNotice({
  entitlement,
  className = "",
}: {
  /**
   * The client entitlement, or **`null` while it is still unknown** (6-04).
   * Required, with no default: a default here would be a guess about a reader
   * nobody has looked up, which is the defect 6-04 removed.
   */
  entitlement: ClientEntitlement | null;
  className?: string;
}) {
  // Not known yet — say nothing. Silence while ignorant is correct.
  if (!entitlement) return null;
  // Granted. Trial and paid both land here, which is the point of keying on the
  // capability rather than the plan name.
  if (entitlement.poolRefreshAllowed) return null;

  // `source` is the "where did this come from" field, and it is the only one
  // that separates a signed-out reader from a signed-in free reader —
  // `effectivePlan` reads `"free"` for both.
  const signedOut = entitlement.source === "anonymous";

  return (
    <aside
      className={`overflow-hidden rounded-2xl border border-border bg-bg-secondary/50 ${className}`}
      data-testid="pool-refresh-notice"
      data-refresh-audience={signedOut ? "anonymous" : "free"}
    >
      <div className="px-5 py-4 sm:px-6">
        <p className={`${REPORT_LABEL_STEP} text-accent`}>Refresh now</p>
        <p className="mt-2 text-body-sm leading-6 text-text-muted">
          {signedOut
            ? "Sign in to refresh."
            : "Refresh now is on the paid plan. Your jobs and events refresh once a week."}
        </p>
        {signedOut ? null : (
          <p className="mt-3 text-caption leading-5 text-text-faint">
            Peer Pro refreshes them whenever you ask.{" "}
            <Link
              href="/welcome?step=ai"
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              See what Pro adds
            </Link>
          </p>
        )}
      </div>
    </aside>
  );
}
