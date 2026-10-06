// The quota notice (P2-09, §1g.14): one line saying why the report on the page
// is the shorter one. The server puts a `quota` on a report whose deep read a
// cap or an outage refused — the reader got the abstract-tier report, and
// until now no component said so. Peer's own words, so the label face; nothing
// else is rendered, and nothing when there is nothing to say.

import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { QUOTA } from "./copy";

/**
 * The line for a quota, or null. By `kind`, then `reason`:
 * - `deep_report` / `breaker` with reason `unavailable` — the counter could not
 *   be read, so nothing was spent: never "used up" (ABC-freemium 2-02), but not
 *   silent either;
 * - those two kinds with any other reason (`exhausted`; an older cached report
 *   may carry none) — the allowance is spent;
 * - `company_budget`, whatever the reason — the shared model budget;
 * - any other kind (a newer server, an older cache) — nothing.
 */
export function quotaNoticeText(quota: Pick<QuotaSignal, "kind" | "reason"> | null | undefined): string | null {
  if (!quota) return null;
  switch (quota.kind) {
    case "deep_report":
    case "breaker":
      return quota.reason === "unavailable" ? QUOTA.unavailable : QUOTA.exhausted;
    case "company_budget":
      return QUOTA.companyBudget;
    default:
      return null;
  }
}

export function QuotaNotice({ quota }: { quota: Pick<QuotaSignal, "kind" | "reason"> | null | undefined }) {
  const text = quotaNoticeText(quota);
  if (!text) return null;
  return <p className="font-mono text-caption text-text-muted mt-6">{text}</p>;
}
