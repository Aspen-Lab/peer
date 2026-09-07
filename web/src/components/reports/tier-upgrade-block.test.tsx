import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TierUpgradeBlock } from "./tier-upgrade-block";
import type { AiMode } from "@/lib/feed/ai-tier";
import type { Plan } from "@/lib/entitlement/types";

const items = [
  {
    title: "Tailored next steps",
    description: "Connect the evidence to your current work.",
  },
  {
    title: "Deeper source review",
    description: "Read the full source for caveats and implications.",
  },
];

function render(
  effectivePlan: Plan | null,
  aiMode: AiMode,
  rows = items,
): string {
  return renderToStaticMarkup(
    createElement(TierUpgradeBlock, { items: rows, aiMode, effectivePlan }),
  );
}

/**
 * ABC-freemium 1-26 / 1-27 · R-UI-3, D7.
 *
 * **Rewritten, not deleted.** The old pair of cases asked one question — "is a
 * provider configured?" — which is a BYOK test with no notion of a plan. Once
 * D1 gave every signed-in reader a model, that question would have shown a
 * **paid** reader an upsell for something they already have. The cases now ask
 * the question R-UI-3 actually poses: would upgrading get this reader anything?
 */
describe("TierUpgradeBlock", () => {
  it("renders for a free reader with no key of their own", () => {
    // The only reader for whom the locked rows are genuinely locked.
    const html = render("free", "system");

    expect(html).toContain("Also in this report on Peer Pro");
    expect(html).toContain("Tailored next steps");
    expect(html).toContain("Deeper source review");
  });

  it("shows D7's price, display only, with no checkout link", () => {
    // Payment is out of scope (spec §3). A dead checkout link would be worse
    // than none, so the CTA points at something the reader can actually do.
    const html = render("free", "system");

    expect(html).toContain("$12/month");
    expect(html).toContain("$6 for students");
    expect(html).toContain('href="/welcome?step=ai"');
    expect(html).not.toMatch(/checkout|stripe|billing/i);
  });

  it("NEVER renders for a paid reader", () => {
    // R-UI-3 says so in as many words, and this is the assertion that would
    // have caught the old BYOK-keyed version.
    expect(render("paid", "system")).toBe("");
    expect(render("paid", "byok")).toBe("");
    expect(render("paid", "none")).toBe("");
  });

  it("does not render for a trial reader", () => {
    // A trial already has paid behaviour (D5). An upsell for something you
    // currently have reads as a bug.
    expect(render("trial", "system")).toBe("");
    expect(render("trial", "byok")).toBe("");
  });

  it("does not render for a free reader running on their own key", () => {
    // They can already run those rows themselves — today's behaviour,
    // preserved.
    expect(render("free", "byok")).toBe("");
  });

  it("renders nothing when there is nothing locked", () => {
    // The existing guard, kept.
    expect(render("free", "system", [])).toBe("");
  });

  it("uses none of the tier vocabulary (R-UI-1)", () => {
    expect(render("free", "system")).not.toMatch(/Tier [012]|BYOK/);
  });
});

/**
 * ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 — **nothing upsells while
 * the plan is still unknown.**
 *
 * The client entitlement now has a third state, `null`, meaning the profile
 * fetch has not answered. Before 6-04 it did not: every reader, paid included,
 * carried the frozen anonymous default until the round trip finished, and this
 * block's own `=== "free"` test read that default at face value.
 *
 * The predicate below already refuses `null` by the direction it happens to
 * face. That is worth an assertion precisely *because* it is luck: the sibling
 * `QuotaNotice` faced the other way (`!== "paid"`) and upsold everyone. These
 * cases stop a future "simplification" flipping this one to match it.
 */
describe("TierUpgradeBlock before the entitlement is known (6-04)", () => {
  it("renders nothing while the plan is unknown, on any AI mode", () => {
    expect(render(null, "system")).toBe("");
    expect(render(null, "none")).toBe("");
    expect(render(null, "byok")).toBe("");
  });

  it("still renders once the plan is known to be free", () => {
    // The negative twin: without it, returning `null` unconditionally would
    // pass the case above while removing the block for the reader it is for.
    expect(render("free", "system")).toContain("Also in this report on Peer Pro");
  });
});
