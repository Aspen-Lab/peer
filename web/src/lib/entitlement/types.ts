/**
 * What a request is allowed to spend — the shape only, with no Supabase import,
 * so client code can hold an entitlement without dragging the server client into
 * the browser bundle. The resolver lives in `./resolve`.
 *
 * ABC-freemium 1-01 · R-ENT-2.
 */

/** The stored plan column. D5: `trial` auto-downgrades to `free` at expiry. */
export type Plan = "free" | "trial" | "paid";

/**
 * Where this entitlement came from. R-METER-4 asks for the counter store to say
 * which implementation answered; the same honesty is cheap here and is what lets
 * a log line distinguish "the developer's machine said paid" from "the database
 * said paid".
 *
 * - `supabase`     — a signed-in user in a deployed runtime; the stored row (or
 *                    the `free` default when there is no row to read).
 * - `dev-override` — the local-development path of R-ENT-5. Covers both the case
 *                    where `PEER_DEV_ENTITLEMENT` was set and the case where it
 *                    was not (Ruling 3 point 2 makes the unset local default
 *                    `free`); it never appears in a deployed runtime.
 * - `anonymous`    — no signed-in user. The frozen constant below.
 */
export type EntitlementSource = "supabase" | "dev-override" | "anonymous";

export interface Entitlement {
  /** The stored column, verbatim — what an admin set by hand (D7). */
  plan: Plan;
  /** R-ENT-2: a `trial` past `trial_ends_at` reads as `free`, computed at read time. */
  effectivePlan: Plan;
  /**
   * The plan's deep-report allowance: free 5 per calendar month, trial 20 over
   * the whole trial, paid unbounded (D4).
   *
   * **This is the budget, not budget-minus-used, and the name now says so**
   * (ABC-freemium 2-03 · Ruling 4 point 3). It used to be named for a
   * remainder, which was the lie: a field named "remaining" that
   * never decreases will eventually be displayed as a wrong number, and it was
   * already on the wire as one. The live remainder is computed in the delivery
   * layer by `deepReportAllowance` in `./allowance`, never here.
   *
   * **Nothing is subtracted here on purpose.** `resolveEntitlement` runs on
   * *every* AI request, and putting a counter read inside it would add a
   * database round trip to every feed load, every report and every digest to
   * compute a number only the profile screen wants. The resolver is an input to
   * the counter and to the quota check, not a consumer of either. That is a
   * decision, not an accident — do not "fix" it by reading the store here.
   *
   * `Number.POSITIVE_INFINITY` for paid is fine **inside the process** and is
   * what the two comparison sites in `deep-report-quota.ts` want. It must never
   * reach a payload — `JSON.stringify` turns it into `null` — which is why
   * `GET /api/profile` ships `ClientEntitlement` and drops this field by
   * construction rather than by remembering.
   */
  deepReportsBudget: number;
  /**
   * **D2a (5-02): permanently `false` for every plan.** The operator never pays
   * for search, for anyone — see `resolve.ts`. The field survives as the single
   * constant that would reverse the decision (Ruling 12 point 2), and because it
   * is still the gate on the `BRAVE_SEARCH_API_KEY` env read in
   * `lib/search/system-key.ts` (Ruling 13 point 3 — do not delete it).
   */
  systemSearchAllowed: boolean;
  /** D3: only entitled users may force a pool rebuild. */
  poolRefreshAllowed: boolean;
  /** ISO timestamp, null unless the trial is currently running. */
  trialEndsAt: string | null;
  /**
   * Not in R-ENT-2's minimum, and kept because 1-06 and 1-11 need it: under D1
   * *every signed-in user* gets the system LLM, so "may this request use AI at
   * all" is `userId !== null` — never `effectivePlan`.
   */
  userId: string | null;
  source: EntitlementSource;
}

/** D4 — free users get five deep reports per calendar month. */
export const FREE_DEEP_REPORTS_PER_MONTH = 5;
/** D4 — a trial gets twenty over the whole 14 days, not twenty per month. */
export const TRIAL_DEEP_REPORTS_TOTAL = 20;

/**
 * What the field shows when there is no user at all.
 *
 * A frozen constant rather than a `null` or a throw, on purpose: every consumer
 * then reads a real object and takes its degraded branch by ordinary logic, so
 * no caller needs a null check and a *forgotten* null check cannot fail open.
 * Each `false`/`0` below lands on plumbing that already exists — a signed-out
 * visitor gets the same structured-sources feed and the same `noLlm: true`
 * report a keyless user gets today. No new response shape is introduced.
 */
export const ANONYMOUS_ENTITLEMENT: Readonly<Entitlement> = Object.freeze({
  plan: "free",
  effectivePlan: "free",
  deepReportsBudget: 0,
  systemSearchAllowed: false,
  poolRefreshAllowed: false,
  trialEndsAt: null,
  userId: null,
  source: "anonymous",
} satisfies Entitlement);

/** Narrow an arbitrary string to a `Plan`, so a typo is ignored, never defaulted. */
export function asPlan(value: unknown): Plan | null {
  return value === "free" || value === "trial" || value === "paid"
    ? value
    : null;
}
