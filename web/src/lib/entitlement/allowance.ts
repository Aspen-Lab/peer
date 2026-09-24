/**
 * The deep-report allowance as the browser is allowed to see it.
 *
 * ABC-freemium 2-03 · R-ENT-2 (amended 2026-09-05) · R-ENT-3 · Ruling 4 point 3
 * · Ruling 5 point 4.
 *
 * ── WHY THIS IS A SEPARATE MODULE ────────────────────────────────────────────
 *
 * Two facts had to be kept apart and were not:
 *
 *  - **A plan's budget** — five a month, twenty a trial, unbounded for paid.
 *    That is `Entitlement.deepReportsBudget`, it is the same for every reader on
 *    a plan, and it is server-only.
 *  - **This reader's remainder** — budget minus what they have actually spent.
 *    That needs the counter store, and the counter store must not be read by
 *    `resolveEntitlement`, which runs on every AI request. So the subtraction
 *    happens in the delivery layer (`GET /api/profile`) and nowhere else.
 *
 * This module holds the pure half so it can be unit-tested and imported by
 * client code. **It imports no Supabase client and must never gain one** — that
 * is the property that keeps it out of the browser bundle's server surface.
 *
 * ── WHY `unlimited` IS A BOOLEAN AND THE NUMBER CAN BE `null` ────────────────
 *
 * `Number.POSITIVE_INFINITY` is not JSON. `JSON.stringify(Infinity)` is the
 * string `"null"`, so a paid reader's "unlimited" arrived in the browser
 * indistinguishable from "we could not tell you". Ruling 5 point 4 fixes the
 * shape rather than the sentinel: a boolean says *unlimited*, an optional
 * `reason` says *we could not tell*, and the number is `null` in both cases but
 * is never the only thing distinguishing them.
 */
import type { Entitlement } from "./types";

/**
 * A reading from the usage counter store — `{ value, ok }`.
 *
 * Declared structurally rather than imported from `lib/usage/counters` on
 * purpose: that module imports the Supabase admin client, and this one must
 * stay importable by the browser. The shape is two fields and it is asserted
 * against the real type at the one call site that has both.
 */
export interface AllowanceUsage {
  value: number;
  ok: boolean;
}

export interface DeepReportAllowance {
  /** D4's paid plan. When true, `deepReportsRemaining` is `null` and means so. */
  unlimited: boolean;
  /**
   * Budget minus used, floored at zero — or `null` when there is no number to
   * give. `null` means one of exactly two things, and `unlimited` plus `reason`
   * say which: unlimited, or unknown. **Never a guessed number.**
   */
  deepReportsRemaining: number | null;
  /**
   * Present only when the counter store could not be read. Absent otherwise —
   * an absent field is what "nothing went wrong" looks like on the wire.
   */
  reason?: "unavailable";
}

/**
 * Build the client-facing allowance from a plan budget and a counter reading.
 *
 * Pure, total, and JSON-safe by construction: every branch returns either a
 * finite number or `null`, so `Infinity` cannot escape through it.
 */
export function deepReportAllowance(
  entitlement: Pick<Entitlement, "effectivePlan" | "deepReportsBudget" | "userId">,
  used: AllowanceUsage,
): DeepReportAllowance {
  // Paid short-circuits BEFORE the store is consulted. D4 makes paid unlimited
  // to the reader, so no counter reading can change the answer — and the caller
  // is told (by this branch existing) that it need not read the store at all.
  if (entitlement.effectivePlan === "paid") {
    return { unlimited: true, deepReportsRemaining: null };
  }

  // A signed-out reader gets `0`, NOT `null`. They have no allowance, which is
  // a fact we know; `null` is reserved for "we cannot tell", which is a
  // different thing and must stay distinguishable from it.
  if (!entitlement.userId) {
    return { unlimited: false, deepReportsRemaining: 0 };
  }

  // Store unreachable. Honest emptiness: no number, and a `reason` saying why,
  // so the UI can say "temporarily unavailable" instead of inventing a count.
  if (!used.ok) {
    return {
      unlimited: false,
      deepReportsRemaining: null,
      reason: "unavailable",
    };
  }

  // `Math.max(0, …)` is load-bearing, not defensive. The counter is incremented
  // *before* the limit is compared, so a reader who has just been refused sits
  // at budget + 1 used, and a bare subtraction would ship `-1`.
  return {
    unlimited: false,
    deepReportsRemaining: Math.max(
      0,
      entitlement.deepReportsBudget - used.value,
    ),
  };
}

/**
 * What `GET /api/profile` actually ships.
 *
 * `deepReportsBudget` is **dropped on the way out** and the three allowance
 * keys are inlined at the top level. Removing the field by construction is the
 * point: `Infinity` cannot reach a payload by forgetting, because the field
 * that could hold it is not part of this type at all.
 */
export type ClientEntitlement = Omit<Entitlement, "deepReportsBudget"> &
  DeepReportAllowance;

/**
 * Turn a resolved entitlement plus a counter reading into the client payload.
 *
 * **The single place the budget field is dropped.** Doing it here rather than
 * with a destructure at each call site means there is exactly one line to audit
 * for "can `Infinity` escape", and adding a field to `Entitlement` cannot
 * accidentally bypass it.
 */
export function toClientEntitlement(
  entitlement: Entitlement,
  used: AllowanceUsage,
): ClientEntitlement {
  const allowance = deepReportAllowance(entitlement, used);
  return {
    plan: entitlement.plan,
    effectivePlan: entitlement.effectivePlan,
    systemSearchAllowed: entitlement.systemSearchAllowed,
    poolRefreshAllowed: entitlement.poolRefreshAllowed,
    trialEndsAt: entitlement.trialEndsAt,
    userId: entitlement.userId,
    source: entitlement.source,
    ...allowance,
  };
}

/**
 * The client's default before any profile fetch has answered — the frozen
 * anonymous entitlement in client shape.
 *
 * A signed-out reader gets `401` from the profile route, so this is what the
 * browser holds in that case: a real object with a real `0`, so no consumer
 * needs a null branch and a forgotten one cannot fail open.
 */
export const ANONYMOUS_CLIENT_ENTITLEMENT: Readonly<ClientEntitlement> =
  Object.freeze({
    plan: "free",
    effectivePlan: "free",
    systemSearchAllowed: false,
    poolRefreshAllowed: false,
    trialEndsAt: null,
    userId: null,
    source: "anonymous",
    unlimited: false,
    deepReportsRemaining: 0,
  } satisfies ClientEntitlement);

/**
 * ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 — **the entitlement to
 * answer a CAPABILITY question with while the real one is still unknown.**
 *
 * The client entitlement has three states now, not two: `null` until the
 * profile fetch has answered, then a real object. A capability question ("may
 * this reader use Peer's model?", "does this feed ask for tier 2?") still needs
 * an answer during that window, and the honest one is the frozen anonymous
 * default — it grants nothing, so a capability fails **closed** while we are
 * ignorant. That is the same direction every breaker in this build fails, and
 * it is exactly the behaviour that shipped before 6-04.
 *
 * **NEVER use this to decide an upsell.** An upsell requires positive evidence
 * that the reader is *not* entitled, and this helper manufactures precisely the
 * evidence that is missing: it turns "we have not asked yet" into "free", which
 * is what told a **paid** reader mid-hydration to upgrade (Ruling 16 point 2).
 * Upsell surfaces take the nullable value and render **nothing** on `null`.
 *
 * The asymmetry is the whole point and it is not an inconsistency to tidy up:
 * refusing a capability while ignorant costs the reader a few hundred
 * milliseconds; asserting a plan while ignorant puts a wrong claim on screen.
 */
export function entitlementGrants(
  entitlement: ClientEntitlement | null,
): ClientEntitlement {
  return entitlement ?? ANONYMOUS_CLIENT_ENTITLEMENT;
}
