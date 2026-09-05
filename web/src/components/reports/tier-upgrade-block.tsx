"use client";

import Link from "next/link";

// Was imported from report-section.tsx, the shared kit for the event and job
// reports. Those reports are gone; this is the one piece the paper report used.
const REPORT_LABEL_STEP =
  "text-caption font-semibold uppercase tracking-[0.18em]";

export interface TierUpgradeItem {
  title: string;
  description: string;
}

export function TierUpgradeBlock({
  items,
  providerConfigured = false,
}: {
  items: TierUpgradeItem[];
  providerConfigured?: boolean;
}) {
  if (providerConfigured || items.length === 0) return null;

  return (
    <aside className="mt-14 overflow-hidden rounded-2xl border border-border bg-bg-secondary/50">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        {/* Round 28 items 2+3 (V28-01/V28-02): the step matches every other
            report label (`REPORT_LABEL_STEP`, not the old `text-micro`), and
            the colour is `text-accent` — the token this label's plate
            counterpart already resolves to (V26-E05), not a fixed hex. */}
        <p className={`${REPORT_LABEL_STEP} text-accent`}>
          Also in this report with an AI key
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
        <Link
          href="/welcome?step=ai"
          className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-accent transition-colors hover:text-heading"
        >
          Connect a key
          <span aria-hidden>→</span>
        </Link>
      </div>
    </aside>
  );
}
