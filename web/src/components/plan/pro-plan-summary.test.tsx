import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProPlanSummary } from "./pro-plan-summary";
import { UPGRADE_HREF } from "@/lib/navigation/upgrade-destination";
import {
  DEEP_REPORTS_LABEL,
  POOL_REFRESH_IS_WEEKLY,
  POOL_REFRESH_LABEL,
  PRO_LIFTS_MONTHLY_LIMIT,
  PRO_NAME,
  PRO_PRICE_LEAD,
  PRO_PRICE_TAIL,
  PRO_REFRESHES_ON_DEMAND,
} from "@/lib/entitlement/plan-copy";

/**
 * ABC-freemium 7-02(b) · D7 · Ruling 19 points 1-2.
 *
 * **Ruling 18 point 2 said a call to action is verified by resolving its
 * destination, not by asserting the element exists. Ruling 19 point 1 said that
 * was written one step too short: the destination must ANSWER the promise.**
 * 7-02(c)'s scan proves the destination resolves. This suite proves it answers
 * — the two halves are separate tests because they are separate failures, and
 * for five rounds the app had the second one wrong while looking fine.
 *
 * The wizard itself is not rendered here, and that is a deliberate limit rather
 * than an oversight: `welcome/page.tsx` is a client component whose store graph
 * a suite would have to fake wholesale, and round-7 B showed how easily such a
 * harness produces a false all-clear (patching one of two `useSyncExternalStore`
 * export shapes made all six personas render byte-identical output, and the
 * only tell was the identical byte count). So the copy is proved on the
 * component, and the wiring is proved by reading the step's own source. **What
 * neither can settle: whether the block is actually on screen at
 * `/welcome?step=ai` for every entitlement state.** That is A's to drive.
 */

const AI_STEP_MARKER = 'key === "ai"';
const CONNECTORS_STEP_MARKER = 'key === "connectors"';

function welcomeSource(): string {
  return readFileSync(
    join(process.cwd(), "src", "app", "welcome", "page.tsx"),
    "utf8",
  );
}

/** The AI step's own JSX, sliced out so a match cannot come from another step. */
function aiStepSource(): string {
  const source = welcomeSource();
  const start = source.indexOf(AI_STEP_MARKER);
  const end = source.indexOf(CONNECTORS_STEP_MARKER);
  expect(start, "the AI step marker moved — re-anchor this slice").toBeGreaterThan(-1);
  expect(end, "the connectors step marker moved — re-anchor this slice").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the upsell destination answers the promise (7-02b)", () => {
  it("says what Pro costs, in D7's own words", () => {
    const html = renderToStaticMarkup(createElement(ProPlanSummary));

    expect(html).toContain(PRO_PRICE_LEAD);
    expect(html).toContain(PRO_PRICE_TAIL);
    // Both figures asserted as literals as well, on purpose: the constants pin
    // "the same sentence everywhere", these pin D7's actual price. A rename
    // that quietly changed the number would pass the first pair and fail here.
    expect(html).toContain("$12/month");
    expect(html).toContain("$6 for students");
  });

  it("says what Pro adds, each benefit with the label its sentence needs", () => {
    // Both sentences were lifted from surfaces that supplied their referent.
    // Rendered without the label, "the monthly limit" and "refreshes them"
    // point at nothing — which is why the labels travel with them.
    const html = renderToStaticMarkup(createElement(ProPlanSummary));

    expect(html).toContain(DEEP_REPORTS_LABEL);
    expect(html).toContain(PRO_LIFTS_MONTHLY_LIMIT);
    expect(html).toContain(POOL_REFRESH_LABEL);
    expect(html).toContain(POOL_REFRESH_IS_WEEKLY);
    expect(html).toContain(PRO_REFRESHES_ON_DEMAND);
    expect(html).toContain(PRO_NAME);
  });

  it("writes no new copy — every rendered sentence is a shared constant", () => {
    // Ruling 19 point 2(b): the AI step reuses the EXACT existing strings, so
    // this is D7's ruled sentence in one more place rather than an editorial
    // decision needing an owner. Read the component's own source and require
    // that its JSX text nodes are all interpolations, never typed prose.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "plan", "pro-plan-summary.tsx"),
      "utf8",
    );
    const body = source.slice(source.indexOf("export function ProPlanSummary"));

    // Any run of letters sitting directly between JSX tags is hand-typed copy.
    const typedProse = body.match(/>[^<>{}\n]*[A-Za-z]{2,}[^<>{}]*</g) ?? [];

    expect(typedProse).toEqual([]);
  });

  it("has NO checkout link — D7 is display only", () => {
    // Payment is out of scope (spec §3). A dead checkout link is precisely the
    // defect this whole round exists to remove, so the absence is asserted
    // rather than assumed.
    const html = renderToStaticMarkup(createElement(ProPlanSummary));

    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
    expect(html).not.toMatch(/checkout|stripe|billing|subscribe/i);
  });

  it("is rendered by the AI step, which is where every upsell now lands", () => {
    // The component answering the promise is worth nothing if the destination
    // does not render it. Sliced to the AI step so a match cannot leak in from
    // another step of the wizard.
    expect(aiStepSource()).toMatch(/<\s*ProPlanSummary\s*\/>/);
  });

  it("lands on the step the shared destination names", () => {
    // Closes the loop: the constant all three CTAs render points at the wizard
    // with `step=ai`, and the block above lives on that step. Whitespace
    // tolerant because the tree is CRLF on disk.
    expect(UPGRADE_HREF).toMatch(/^\/welcome\?step=ai$/);
    expect(welcomeSource()).toMatch(/\{\s*key\s*===\s*"ai"\s*&&/);
  });
});
