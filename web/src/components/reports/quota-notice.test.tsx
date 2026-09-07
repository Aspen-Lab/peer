import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaNotice } from "./quota-notice";
import { UPGRADE_HREF } from "@/lib/navigation/upgrade-destination";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import type { Plan } from "@/lib/entitlement/types";

/**
 * ABC-freemium 2-07 · R-QUOTA-1 · Ruling 3 point 1 · Ruling 4 point 2 ·
 * Ruling 6 point 2. Extended by **3-01** (R-UI-3 · Ruling 8 point 1 ·
 * Ruling 9 point 4) — a paid reader is never upsold.
 *
 * The strings are asserted **byte-for-byte** because they are the requirement's
 * own text, not a paraphrase of it.
 */

const EXHAUSTED: QuotaSignal = {
  kind: "deep_report",
  reason: "exhausted",
  remaining: 0,
  // Far enough out that the day count is stable whenever this suite runs.
  resetsAt: "2099-01-01T00:00:00.000Z",
};

const UNAVAILABLE: QuotaSignal = {
  kind: "deep_report",
  reason: "unavailable",
  remaining: 0,
  resetsAt: "2099-01-01T00:00:00.000Z",
};

/**
 * A **real** end-of-UTC-day reset, the shape D4's breaker actually produces
 * (`endOfUtcDay(now)`), rather than the 73-years-out placeholder the old
 * breaker case used. Held at 30 minutes out so the hours branch is exercised
 * and a regression to the old days-only formatter shows up as "1 day".
 */
const NOW = new Date("2026-09-05T23:30:00.000Z");
const BREAKER: QuotaSignal = {
  kind: "breaker",
  reason: "exhausted",
  remaining: 0,
  resetsAt: "2026-09-06T00:00:00.000Z",
};

// 3-01 — the plan is a REQUIRED prop, so the helper takes it. Defaulting it
// here rather than in the component keeps the fail-open default out of
// production while leaving the pre-existing cases readable.
// 6-04 — the prop's type gained `null`, "not known yet". The helper default
// stays `"free"` so the pre-existing cases keep asserting the reader they were
// written for; the unhydrated reader is passed explicitly by the 6-04 suite,
// because that state is the subject there rather than a backdrop.
function render(
  quota?: QuotaSignal,
  effectivePlan: Plan | null = "free",
): string {
  return renderToStaticMarkup(
    createElement(QuotaNotice, { quota, effectivePlan }),
  );
}

describe("QuotaNotice", () => {
  it("renders NOTHING when there is no quota signal", () => {
    // The overwhelmingly common case: the reader had allowance and was served.
    // "Never a heading over nothing" — not an empty panel, not a placeholder.
    expect(render(undefined)).toBe("");
  });

  it("shows the exhaustion sentence AND an upgrade prompt", () => {
    const html = render(EXHAUSTED, "free");

    expect(html).toContain("You&#x27;ve used this month&#x27;s deep reports.");
    expect(html).toContain("Peer Pro");
    expect(html).toContain('data-quota-reason="exhausted"');
  });

  it("shows the outage copy and NO upgrade prompt", () => {
    // Nothing the reader buys fixes a counter-store outage, so an upsell here
    // would be a second lie on top of the one 2-02 removed.
    const html = render(UNAVAILABLE);

    expect(html).toContain(
      "Deep reports are temporarily unavailable — your allowance is unchanged. Try again shortly.",
    );
    expect(html).not.toContain("Peer Pro");
    // 7-02(a) — this line read `not.toContain("/settings")` while `/settings`
    // was the CTA's destination. The route never existed, so after the fix that
    // assertion would have passed on a string no component can emit any more:
    // green, and measuring nothing. Rewritten to state what it always meant —
    // no upgrade call to action renders here — through the shared constant, so
    // it keeps meaning that when the destination next moves.
    expect(html).not.toContain(UPGRADE_HREF);
    expect(html).toContain('data-quota-reason="unavailable"');
  });

  it("never shows the exhaustion wording during an outage", () => {
    // The two states used to be byte-identical in the payload (2-02). This is
    // what stops them becoming byte-identical again on the screen.
    const html = render(UNAVAILABLE);

    expect(html).not.toContain("used this month");
    expect(html).not.toContain("Resets in");
  });

  it("contains no CJK characters", () => {
    // Ruling 3 point 1 — the product is English-only, and the guard follows the
    // string onto the screen rather than stopping at the pure function.
    for (const quota of [EXHAUSTED, UNAVAILABLE]) {
      expect(/[一-鿿]/.test(render(quota))).toBe(false);
    }
  });
});

/**
 * ABC-freemium 3-01 · R-UI-3 · Ruling 8 point 1 — **a paid reader is never
 * upsold**, and the three neighbouring properties that stop the fix being made
 * wrongly.
 *
 * The clock is fixed because the component calls `quotaMessage(quota)` with its
 * default `new Date()`, and Ruling 5 point 3 requires a fixture clock to reach
 * every place the code under test reads time. `resetsAt` is a **real**
 * `endOfUtcDay` instant 30 minutes out — the shape D4's breaker actually
 * produces — not the 73-years-out placeholder the old breaker case used, which
 * rendered a five-digit day count and exercised nothing daily.
 */
describe("QuotaNotice at the daily breaker (3-01)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the daily-breaker sentence for a paid reader at the cap AND upsells nothing", () => {
    // Ruling 8 point 1's protective test. This case existed before 3-01 under
    // this name, passed no plan (there was none to pass), used a 2099 reset,
    // and asserted only the sentence — it named the exact property the ruling
    // requires and asserted none of it, which is why it stayed green while the
    // defect shipped. Repaired in place rather than replaced.
    const html = render(BREAKER, "paid");

    expect(html).toContain("Peer is at today&#x27;s limit for deep reports.");
    // The reset unit: hours under a day. A regression to the old days-only
    // formatter renders "Resets in 1 day." here and fails on this line.
    expect(html).toContain("Resets in 1 hour.");
    expect(html).not.toContain("Peer Pro");
    // 7-02(a) — see the note on the outage case: asserted through the shared
    // constant, because `/settings` is a string nothing can render any more.
    expect(html).not.toContain(UPGRADE_HREF);
    expect(html).not.toContain("Add your own key");
  });

  it("still shows the paid reader the heading and the sentence, not an outage", () => {
    // The one boolean used to drive the heading AND the prompt, so the obvious
    // fix would have retitled this "Deep reports unavailable" — an outage the
    // reader would wait out, when in fact the cap is real and resets tonight.
    // Never an empty bordered panel either: the sentence is true information.
    const html = render(BREAKER, "paid");

    expect(html).toContain("Deep reports");
    expect(html).not.toContain("Deep reports unavailable");
    expect(html).toContain('data-quota-reason="exhausted"');
  });

  it("DOES show the prompt to a free reader at the same cap", () => {
    // The negative twin. Without it, simply deleting the upsell would pass the
    // case above while breaking R-QUOTA-1 for the reader it is written for.
    const html = render(BREAKER, "free");

    expect(html).toContain("Peer Pro");
    expect(html).toContain("Add your own key");
  });

  it("DOES show the prompt to a TRIAL reader at the same cap", () => {
    // Ruling 8 point 1 scopes the prompt to free AND trial. `TierUpgradeBlock`
    // next door uses `effectivePlan === "free"` and so shows a trial reader
    // nothing — a deliberate difference. Copying that predicate across here
    // would silently drop the prompt for the group with 20 reports to exhaust,
    // which is the most likely way this item gets fixed wrongly.
    const html = render(BREAKER, "trial");

    expect(html).toContain("Peer Pro");
    expect(html).toContain("Add your own key");
  });

  it("never upsells a paid reader on the monthly path either", () => {
    // R-UI-3's property belongs to the surface, not to one `kind`. A paid
    // reader should not reach the monthly cap at all, but if a future producer
    // sends one, the answer is still no upsell.
    const html = render(EXHAUSTED, "paid");

    expect(html).not.toContain("Peer Pro");
    expect(html).not.toContain("Add your own key");
  });
});

/**
 * ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 — **nothing upsells while
 * the plan is still unknown.**
 *
 * The defect this suite exists for was not a wrong predicate; it was a wrong
 * *input*. The client entitlement began life as the frozen anonymous default,
 * so `effectivePlan` arrived here as `"free"` for every reader — a **paid** one
 * included — until `GET /api/profile` came back. 3-01's predicate then did
 * exactly what it was written to do and upsold them.
 *
 * `null` is the third state. An upsell requires positive evidence that the
 * reader is not entitled; absence of data is not evidence.
 *
 * These cases are the ones that fail if the old default is ever put back —
 * anywhere in the chain, including the two report views that used to default
 * the pass-through prop to `"free"` one layer above this component.
 */
describe("QuotaNotice before the entitlement is known (6-04)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("upsells NOBODY on the monthly path while the plan is unknown", () => {
    const html = render(EXHAUSTED, null);

    expect(html).not.toContain("Peer Pro");
    expect(html).not.toContain("Add your own key");
    // 7-02(a) — see the note on the outage case: asserted through the shared
    // constant, because `/settings` is a string nothing can render any more.
    expect(html).not.toContain(UPGRADE_HREF);
  });

  it("upsells NOBODY at the daily breaker while the plan is unknown", () => {
    // The breaker is the reader most likely to be paid — D4's 200/day cap is a
    // paid-only path — so this is the case the hydration window actually hurt.
    const html = render(BREAKER, null);

    expect(html).not.toContain("Peer Pro");
    expect(html).not.toContain("Add your own key");
  });

  it("still tells the unknown reader what happened", () => {
    // Silence is required of the *upsell*, not of the notice. The refusal is a
    // fact about the server's answer and is true whoever is reading; dropping
    // it would swap a wrong prompt for a blank panel, which is the failure mode
    // this loop has rejected since round 1.
    const html = render(EXHAUSTED, null);

    expect(html).toContain("You&#x27;ve used this month&#x27;s deep reports.");
    expect(html).toContain('data-quota-reason="exhausted"');
  });

  it("resumes upselling the same reader once the plan is known to be free", () => {
    // The negative twin, and the reason this is a guard rather than a mute
    // button: deleting the prompt outright would pass all three cases above.
    const html = render(EXHAUSTED, "free");

    expect(html).toContain("Peer Pro");
    expect(html).toContain("Add your own key");
  });
});

/**
 * ABC-freemium 2-07 — **the three report pages actually read and render it.**
 *
 * The component being correct is not the requirement; the requirement is that a
 * reader sees it. For a whole round the server computed a correct message,
 * tested it three ways, and showed it to nobody — so the placement is asserted
 * here rather than trusted. These are source-text assertions for the same
 * reason `spend-scans.test.ts`'s are: they are placement rules, and rendering
 * three ~2500-line page components in a unit test would assert far less for far
 * more setup.
 */
describe("the report pages render the notice (R-QUOTA-1's UI half)", () => {
  const PAGES = [
    "src/app/jobs/[id]/page.tsx",
    "src/app/events/[id]/page.tsx",
    "src/app/papers/[id]/page.tsx",
  ];

  function source(file: string): string {
    return readFileSync(join(process.cwd(), file), "utf8");
  }

  it.each(PAGES)("%s reads `quota` off the response", (file) => {
    // B established that all three fetchers destructured the degraded payload
    // and dropped `quota` on the floor — on papers it was not even reachable in
    // TypeScript, because `PaperReport` had no such field.
    expect(source(file)).toMatch(/setQuota\(/);
  });

  it.each(PAGES)("%s renders QuotaNotice", (file) => {
    expect(source(file)).toContain("<QuotaNotice");
  });

  it.each(PAGES)("%s passes the reader's plan to it (3-01)", (file) => {
    // R-UI-3 — the prop is required, so `tsc` already enforces that *something*
    // is passed. What tsc cannot say is that it is the server's entitlement
    // rather than a literal: a fourth page could satisfy the type with
    // `effectivePlan="free"` and reintroduce the defect. This pins the source.
    //
    // 6-04 — the accepted shapes changed, so the assertion did too rather than
    // being deleted. Papers reads the store in the same component and now
    // passes `entitlement?.effectivePlan ?? null`; jobs and events pass a
    // required `effectivePlan` prop down from the page. `[\s\S]` because the
    // papers call spans lines and this tree is CRLF on disk (Ruling 10 point
    // 2c). A literal still fails, which is the point of the case.
    expect(source(file)).toMatch(
      /<QuotaNotice[\s\S]{0,120}?effectivePlan=\{(entitlement\?\.effectivePlan \?\? null|effectivePlan)\}/,
    );
  });

  it.each(PAGES)(
    "%s gives the plan no default anywhere on its way down (6-04)",
    (file) => {
      // The leaf components' props are required so a caller cannot forget them.
      // `jobs` and `events` render their notice from an intermediate view, and
      // that view used to declare `effectivePlan?: Plan` with a `= "free"`
      // default — which satisfied the leaf's requirement with a guess and put
      // the fail-open back one file above where anyone reads for it. `tsc`
      // cannot object: a default makes the type legal. Only the source can say
      // there isn't one.
      const text = source(file);
      expect(text).not.toMatch(/effectivePlan\s*=\s*["']/);
      expect(text).not.toMatch(/effectivePlan\?\s*:/);
    },
  );

  it.each(PAGES)("%s never hard-codes a plan into an upsell (6-04)", (file) => {
    // The hydration defect was a wrong *value*, not a wrong predicate, and the
    // cheapest way to reintroduce it is a literal at a call site — which `tsc`
    // accepts happily. Both upsell components are covered, because a page that
    // stopped rendering `QuotaNotice` would still have `TierUpgradeBlock`.
    const text = source(file);
    expect(text).not.toMatch(/<QuotaNotice[\s\S]{0,120}?effectivePlan="/);
    expect(text).not.toMatch(/<TierUpgradeBlock[\s\S]{0,300}?effectivePlan="/);
  });

  it.each(PAGES)("%s keeps the signal OUT of the cached report object", (file) => {
    // All three pages cache their report in browser storage. A cached quota
    // signal is a stale one: it would keep telling a reader they had spent
    // their allowance after they upgraded, which is the cache-poisoning shape
    // R-UI-4 exists to prevent. The signal therefore lives in its own state,
    // set only when a fetch actually runs.
    expect(source(file)).toMatch(
      /useState<QuotaSignal \| undefined>\(undefined\)/,
    );
  });
});
