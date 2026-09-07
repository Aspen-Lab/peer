"use client";

import Link from "next/link";
import { REPORT_LABEL_STEP } from "./report-section";
import { UPGRADE_HREF } from "@/lib/navigation/upgrade-destination";
import { PRO_PRICE_LEAD, PRO_PRICE_TAIL } from "@/lib/entitlement/plan-copy";
import type { AiMode } from "@/lib/feed/ai-tier";
import type { Plan } from "@/lib/entitlement/types";

export interface TierUpgradeItem {
  title: string;
  description: string;
}

/**
 * ABC-freemium 1-26 · R-UI-3, D7 — **a plan-aware upsell, and it never renders
 * for a paid reader.**
 *
 * It used to be keyed on `providerConfigured`, a BYOK test with no notion of a
 * plan — so once D1 gave every signed-in reader a model, a **paid** reader with
 * no key of their own would have been shown an upsell for something they
 * already have.
 *
 * Who sees it, and why:
 *  - **free, no key of their own** — yes. They are the only reader for whom the
 *    locked rows are genuinely locked.
 *  - **free, own key** — no. They can already run those rows on their own key;
 *    that is today's behaviour, preserved.
 *  - **trial** — no. A trial already has paid behaviour, and an upsell for
 *    something you currently have reads as a bug.
 *  - **paid** — no. R-UI-3 says so in as many words.
 *  - **no locked rows** (`items.length === 0`) — no. The existing guard, kept.
 *
 * **D7's price is display only.** No checkout link: spec §3 puts payment out of
 * scope, and a dead link is worse than no link. The CTA points at the existing
 * key panel, which is a real thing a reader can do today.
 *
 * ── ABC-freemium 6-04 · Ruling 16 points 2-3 ────────────────────────────────
 *
 * **`effectivePlan` may be `null`, meaning the plan is not known yet**, and
 * then this block does not render. The `=== "free"` test below already refused
 * an unknown plan the moment one could exist — but only by luck of which way
 * the comparison happens to face, and the sibling `QuotaNotice` proved how
 * easily that luck runs out (`!== "paid"` upsold everyone mid-hydration). The
 * type now carries the third state so a future edit cannot lose it silently,
 * and the reader who could actually be harmed is named: a **paid** reader
 * scrolling to a locked-rows block before `GET /api/profile` answers.
 */
export function TierUpgradeBlock({
  items,
  aiMode,
  effectivePlan,
}: {
  items: TierUpgradeItem[];
  /** `aiAvailability(profile, entitlement)` — whose model, if any. */
  aiMode: AiMode;
  /**
   * From the entitlement. `trial` reads as paid behaviour (D5). **`null` while
   * the plan is still unknown** (6-04) — nothing renders on it.
   */
  effectivePlan: Plan | null;
}) {
  // 6-04 — an unknown plan is not a free plan. `=== "free"` says so already;
  // the comment is here so nobody "simplifies" it to `!== "paid"`.
  const upgradeWouldHelp = effectivePlan === "free" && aiMode !== "byok";
  if (!upgradeWouldHelp || items.length === 0) return null;

  return (
    <aside className="mt-14 overflow-hidden rounded-2xl border border-border bg-bg-secondary/50">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        {/* Round 28 items 2+3 (V28-01/V28-02): the step matches every other
            report label (`REPORT_LABEL_STEP`, not the old `text-micro`), and
            the colour is `text-accent` — the token this label's plate
            counterpart already resolves to (V26-E05), not a fixed hex. */}
        {/* ABC-freemium 1-26 — the heading said "with an AI key", which is no
            longer what these rows are about: the reader already has Peer's AI.
            What they do not have is the plan that unlocks these. */}
        <p className={`${REPORT_LABEL_STEP} text-accent`}>
          Also in this report on Peer Pro
        </p>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.title}
            className="grid gap-3 px-5 py-4 sm:grid-cols-[28px_1fr_140px] sm:items-center sm:px-6"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-caption text-text-faint"
              aria-hidden
            >
              🔒
            </span>
            <div>
              <h3 className="text-body-sm font-semibold text-heading">
                {item.title}
              </h3>
              <p className="mt-1 text-caption leading-5 text-text-muted">
                {item.description}
              </p>
            </div>
            <div className="hidden space-y-2 sm:block" aria-hidden>
              <span className="block h-2 rounded-full bg-border-strong/45" />
              <span className="block h-2 w-3/4 rounded-full bg-border-strong/30" />
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-5 py-4 sm:px-6">
        {/* D7 — display only. $12/month, $6 for students. No checkout link:
            payment is out of scope, and a dead link is worse than none.
            7-02(b) — the strings moved to `plan-copy.ts`, which carries this
            same rule, so the AI step can render the identical sentence instead
            of a second hand-typed copy of it. */}
        <p className="text-body-sm text-text-muted">
          <span className="font-semibold text-heading">{PRO_PRICE_LEAD}</span>
          {PRO_PRICE_TAIL}
        </p>
        {/* 7-02(a) — the literal moved to `UPGRADE_HREF`. This surface already
            pointed at the right page; the constant is what stops the next
            surface pointing somewhere else, as `QuotaNotice` did for five
            rounds. */}
        <Link
          href={UPGRADE_HREF}
          className="mt-2 inline-flex items-center gap-1.5 text-body-sm font-semibold text-accent transition-colors hover:text-heading"
        >
          Or use your own AI key
          <span aria-hidden>→</span>
        </Link>
      </div>
    </aside>
  );
}
