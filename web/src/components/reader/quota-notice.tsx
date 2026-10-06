// The quota notice (P2-09, §1g.14): one line saying why the report on the page
// is the shorter one. The server puts a `quota` on a report whose deep read a
// cap or an outage refused — the reader got the abstract-tier report, and
// until now no component said so. Peer's own words, so the label face; nothing
// else is rendered, and nothing when there is nothing to say.

import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { QUOTA } from "./copy";

/**
 * The line for a quota, or null. By `kind`, then `reason`:
 * - any of the three kinds with reason `unavailable` — the counter or the
 *   budget check could not be read, so nothing was spent: never "used up" or
 *   "budget is spent" (ABC-freemium 2-02; P2-08b, §1g.14 amendment 3), but not
 *   silent either;
 * - `deep_report` / `breaker` with any other reason (`exhausted`; an older
 *   cached report may carry none) — the allowance is spent;
 * - `company_budget` with any other reason — the shared model budget is spent;
 * - any other kind (a newer server, an older cache) — nothing, whatever its
 *   reason: it may mean something this build cannot word.
 */
export function quotaNoticeText(quota: Pick<QuotaSignal, "kind" | "reason"> | null | undefined): string | null {
  if (!quota) return null;
  switch (quota.kind) {
    case "deep_report":
    case "breaker":
      return quota.reason === "unavailable" ? QUOTA.unavailable : QUOTA.exhausted;
    case "company_budget":
      return quota.reason === "unavailable" ? QUOTA.unavailable : QUOTA.companyBudget;
    default:
      return null;
  }
}

export function QuotaNotice({ quota }: { quota: Pick<QuotaSignal, "kind" | "reason"> | null | undefined }) {
  const text = quotaNoticeText(quota);
  if (!text) return null;
  return <p className="font-mono text-caption text-text-muted mt-6">{text}</p>;
}
