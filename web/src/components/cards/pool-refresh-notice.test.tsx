import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PoolRefreshNotice } from "./pool-refresh-notice";
import {
  ANONYMOUS_CLIENT_ENTITLEMENT,
  type ClientEntitlement,
} from "@/lib/entitlement/allowance";

/**
 * ABC-freemium 6-03 · R-POOL-2 · Ruling 15 point 2 · Ruling 16 points 1, 3, 4,
 * 7.
 *
 * **Its own suite, not a widening of `quota-notice.test.tsx`.** That file's
 * 3-01 block is the protective test for "a paid reader is never upsold" on the
 * deep-report surface; borrowing it would blur two predicates that are
 * deliberately different. This component gets its own paid, trial, free,
 * signed-out and unhydrated cases.
 *
 * The strings are asserted **byte-for-byte** because they are the ruled copy,
 * not a paraphrase of it.
 */

function entitlement(over: Partial<ClientEntitlement>): ClientEntitlement {
  return {
    plan: "free",
    effectivePlan: "free",
    systemSearchAllowed: false,
    poolRefreshAllowed: false,
    trialEndsAt: null,
    userId: "user-1",
    source: "supabase",
    unlimited: false,
    deepReportsRemaining: 3,
    ...over,
  };
}

const FREE = entitlement({});
const TRIAL = entitlement({
  plan: "trial",
  effectivePlan: "trial",
  poolRefreshAllowed: true,
  trialEndsAt: "2099-01-01T00:00:00.000Z",
});
const PAID = entitlement({
  plan: "paid",
  effectivePlan: "paid",
  poolRefreshAllowed: true,
  unlimited: true,
});

function render(value: ClientEntitlement | null): string {
  return renderToStaticMarkup(
    createElement(PoolRefreshNotice, { entitlement: value }),
  );
}

describe("PoolRefreshNotice", () => {
  it("tells a free reader what refresh does, in the ruled words", () => {
    const html = render(FREE);

    expect(html).toContain(
      "Refresh now is on the paid plan. Your jobs and events refresh once a week.",
    );
    expect(html).toContain('data-refresh-audience="free"');
  });

  it("gives the free reader somewhere to go", () => {
    // R-POOL-2's own half: the refusal is explained AND the reader is offered
    // the thing that changes it. D7 keeps the price display-only, so the link
    // points at what exists rather than at a checkout that does not.
    const html = render(FREE);

    expect(html).toContain("Peer Pro refreshes them whenever you ask.");
    expect(html).toContain("See what Pro adds");
  });

  it("does not apologise or claim anything is broken", () => {
    // The pool on screen is complete, current for this week, and served with a
    // 200. This message explains the cadence; it does not report a fault, and
    // the vocabulary check is what keeps a later edit from turning it into one.
    const html = render(FREE);

    expect(html).not.toMatch(/sorry|error|failed|unavailable|stale|out of date/i);
  });

  it("says nothing at all to a PAID reader", () => {
    // Ruling 8, absolute: a paid reader is never upsold. They may refresh, the
    // control works, and there is nothing to explain.
    expect(render(PAID)).toBe("");
  });

  it("says nothing at all to a live TRIAL reader — the case the plan predicate gets wrong", () => {
    // Ruling 16 point 1. A trial reader IS entitled to refresh
    // (`poolRefreshAllowed: effectivePlan !== "free"`), so the natural-looking
    // `effectivePlan !== "paid"` — the predicate `QuotaNotice` uses next door
    // for a different question — would tell them refresh is paid while the
    // server was granting it. This is the case that fails if anyone "aligns"
    // the two components' predicates.
    expect(render(TRIAL)).toBe("");
  });

  it("tells a SIGNED-OUT reader to sign in, and never to upgrade", () => {
    // Ruling 16 point 4, ruled against B's recommendation of silence: a
    // rendered control that refuses must say so, and that does not stop being
    // true because the reader is signed out. "Upgrade" is the wrong sentence
    // for them — they cannot buy a plan without an account — so they get the
    // step that is actually theirs to take.
    const html = render(ANONYMOUS_CLIENT_ENTITLEMENT);

    expect(html).toContain("Sign in to refresh.");
    expect(html).toContain('data-refresh-audience="anonymous"');
    expect(html).not.toContain("Peer Pro");
    expect(html).not.toContain("paid plan");
    expect(html).not.toContain("See what Pro adds");
  });

  it("says NOTHING while the entitlement is still unknown (6-04)", () => {
    // The third state. `ANONYMOUS_CLIENT_ENTITLEMENT` and `null` look identical
    // through `poolRefreshAllowed` alone — both `false` — and telling a paid
    // reader mid-hydration that refresh is on the paid plan is exactly the
    // Ruling 8 breach 6-04 removed. Silence while ignorant is correct.
    expect(render(null)).toBe("");
  });

  it("contains no CJK characters", () => {
    // Ruling 3 point 1 — the product is English-only, and the guard follows the
    // string onto the screen rather than stopping at a pure function.
    for (const value of [FREE, ANONYMOUS_CLIENT_ENTITLEMENT]) {
      expect(/[一-鿿]/.test(render(value))).toBe(false);
    }
  });
});

/**
 * ABC-freemium 6-03 — **the dashboard actually renders it, on the right
 * surface, with the right value.**
 *
 * The component being correct is not the requirement; the requirement is that a
 * free reader sees it. Source-text assertions for the same reason
 * `quota-notice.test.tsx`'s are: these are placement rules, and rendering
 * `DiscoveryPage` in a unit test would stand up its whole store graph to assert
 * far less.
 */
describe("the dashboard renders the refresh notice (R-POOL-2's UI half)", () => {
  const PAGE = "src/app/page.tsx";

  function source(): string {
    return readFileSync(join(process.cwd(), PAGE), "utf8");
  }

  it("renders PoolRefreshNotice at all", () => {
    expect(source()).toContain("<PoolRefreshNotice");
  });

  it("feeds it the store's entitlement, not a literal or a plan", () => {
    // Whitespace-tolerant: this tree is CRLF on disk (Ruling 10 point 2c).
    expect(source()).toMatch(
      /<PoolRefreshNotice[\s\S]{0,120}?entitlement=\{entitlement\}/,
    );
  });

  it("keeps it OFF the Papers tab (B's trap)", () => {
    // The tile serves papers too, and papers refresh is a plain refetch on a
    // daily pool (D3), not a paid feature. A notice keyed on the tile alone
    // would tell a free reader on Papers that refresh is paid, which is false.
    expect(source()).toMatch(
      /activeType !== "papers"[\s\S]{0,200}?<PoolRefreshNotice/,
    );
  });

  it("never keys the notice on the response or on a plan name", () => {
    // Two separate traps, both recorded by B. (a) Refused and granted responses
    // are byte-identical and both 200 — that is a good property, and a
    // `refused` flag would immediately become the thing a component keys on,
    // which is the Ruling 8 hole this item closes. (b) Ruling 16 point 1: gate
    // on the capability, never on the plan label.
    const text = source();
    expect(text).not.toMatch(/<PoolRefreshNotice[\s\S]{0,200}?refused/);
    expect(text).not.toMatch(/<PoolRefreshNotice[\s\S]{0,200}?effectivePlan/);
  });

  it("the component itself asks the capability, never the plan", () => {
    // Ruling 16 point 1, pinned at the source rather than inferred from the
    // trial case above: `effectivePlan` must not appear in the predicate at
    // all. `source` is allowed — it is the only field that separates a
    // signed-out reader from a signed-in free one.
    const text = readFileSync(
      join(process.cwd(), "src/components/cards/pool-refresh-notice.tsx"),
      "utf8",
    );
    expect(text).toMatch(/entitlement\.poolRefreshAllowed/);
    expect(text).not.toMatch(/^\s*(?!\s*\*).*entitlement\.effectivePlan/m);
  });
});
