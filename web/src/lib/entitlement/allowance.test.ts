import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_CLIENT_ENTITLEMENT,
  deepReportAllowance,
  toClientEntitlement,
  type ClientEntitlement,
} from "./allowance";
import { ANONYMOUS_ENTITLEMENT, type Entitlement } from "./types";

/**
 * ABC-freemium 2-03 · R-ENT-2 (amended 2026-09-05) · Ruling 4 point 3 ·
 * Ruling 5 point 4.
 *
 * **The round trip is asserted the RIGHT way here, and that matters more than
 * it looks.** The obvious form —
 * `JSON.stringify(JSON.parse(JSON.stringify(x))) === JSON.stringify(x)` — is
 * `true` on the code this item replaced, because the first `stringify` has
 * already destroyed `Infinity` and both sides then read `null`. B proved that
 * in a harness. Every round-trip case below therefore compares the **parsed
 * object** with the **original object**.
 */

function entitlement(overrides: Partial<Entitlement>): Entitlement {
  return { ...ANONYMOUS_ENTITLEMENT, userId: "user-1", ...overrides };
}

const PAID = entitlement({
  plan: "paid",
  effectivePlan: "paid",
  deepReportsBudget: Number.POSITIVE_INFINITY,
});
const FREE = entitlement({
  plan: "free",
  effectivePlan: "free",
  deepReportsBudget: 5,
});
const TRIAL = entitlement({
  plan: "trial",
  effectivePlan: "trial",
  deepReportsBudget: 20,
  trialEndsAt: "2026-09-18T00:00:00.000Z",
});

/** The client payload the route builds, so the round trip covers the real shape. */
function clientShape(
  source: Entitlement,
  used: { value: number; ok: boolean },
): ClientEntitlement {
  return toClientEntitlement(source, used);
}

describe("deepReportAllowance (R-ENT-2, Ruling 5 point 4)", () => {
  it("gives a paid reader unlimited and NO number", () => {
    // `Infinity` stays inside the process; the wire carries a boolean.
    expect(deepReportAllowance(PAID, { value: 0, ok: true })).toEqual({
      unlimited: true,
      deepReportsRemaining: null,
    });
  });

  it("does not consult the counter at all for a paid reader", () => {
    // Whatever the store says, paid is unlimited (D4). Asserted with a reading
    // that would produce a very different answer on any other plan.
    expect(deepReportAllowance(PAID, { value: 9_999, ok: false })).toEqual({
      unlimited: true,
      deepReportsRemaining: null,
    });
  });

  it("gives a free reader a REAL remainder, not the budget", () => {
    // The defect this item fixes: the field never moved, because it held the
    // plan's budget. Two of the five are spent here.
    expect(deepReportAllowance(FREE, { value: 2, ok: true })).toEqual({
      unlimited: false,
      deepReportsRemaining: 3,
    });
  });

  it("floors the remainder at zero rather than shipping a negative", () => {
    // The counter is incremented BEFORE the limit is compared, so a reader who
    // has just been refused sits at budget + 1 used. A bare subtraction would
    // ship -1 to the browser.
    expect(
      deepReportAllowance(FREE, { value: 6, ok: true }).deepReportsRemaining,
    ).toBe(0);
  });

  it("counts a trial against its own budget", () => {
    expect(deepReportAllowance(TRIAL, { value: 7, ok: true })).toEqual({
      unlimited: false,
      deepReportsRemaining: 13,
    });
  });

  it("says `unavailable` and NO number when the store cannot be read", () => {
    expect(deepReportAllowance(FREE, { value: 0, ok: false })).toEqual({
      unlimited: false,
      deepReportsRemaining: null,
      reason: "unavailable",
    });
  });

  it("gives a signed-out reader 0, not null", () => {
    // `0` is a fact we know: no user, no allowance. `null` is reserved for
    // "we cannot tell", and the two must stay distinguishable.
    expect(
      deepReportAllowance(ANONYMOUS_ENTITLEMENT, { value: 0, ok: true }),
    ).toEqual({ unlimited: false, deepReportsRemaining: 0 });
  });

  it("tells `unlimited` apart from `unavailable`, though both carry null", () => {
    // Ruling 5 point 4's whole purpose. Before this item both arrived in the
    // browser as a bare `null` and nothing distinguished them.
    const paid = deepReportAllowance(PAID, { value: 0, ok: true });
    const down = deepReportAllowance(FREE, { value: 0, ok: false });

    expect(paid.deepReportsRemaining).toBeNull();
    expect(down.deepReportsRemaining).toBeNull();
    expect(paid.unlimited).toBe(true);
    expect(down.unlimited).toBe(false);
    expect(paid.reason).toBeUndefined();
    expect(down.reason).toBe("unavailable");
    expect(paid).not.toEqual(down);
  });
});

describe("the payload is JSON-safe (Ruling 5 point 4)", () => {
  const cases: Array<[string, ClientEntitlement]> = [
    ["paid", clientShape(PAID, { value: 0, ok: true })],
    ["free", clientShape(FREE, { value: 2, ok: true })],
    ["trial", clientShape(TRIAL, { value: 7, ok: true })],
    ["store down", clientShape(FREE, { value: 0, ok: false })],
    ["anonymous", ANONYMOUS_CLIENT_ENTITLEMENT],
  ];

  it.each(cases)("survives a round trip unchanged: %s", (_name, summary) => {
    // PARSED OBJECT vs ORIGINAL OBJECT. Comparing two `JSON.stringify` outputs
    // instead passes on the broken code this item replaced, because the first
    // stringify already turned `Infinity` into `null` on both sides.
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it.each(cases)("carries no Infinity and no budget field: %s", (_name, summary) => {
    // Structural, not by example: a `null` for the remainder is legitimate ONLY
    // when the reader is unlimited or the store was unreadable. That single
    // property is what stops a future field re-introducing the sentinel
    // collision the whole item exists to remove.
    const wire = JSON.parse(JSON.stringify(summary)) as ClientEntitlement & {
      deepReportsBudget?: unknown;
    };

    expect(wire.deepReportsBudget).toBeUndefined();
    if (wire.deepReportsRemaining === null) {
      expect(wire.unlimited || wire.reason === "unavailable").toBe(true);
    } else {
      expect(Number.isFinite(wire.deepReportsRemaining)).toBe(true);
    }
  });

  it("would have FAILED the naive round-trip check on the old shape", () => {
    // Kept as a live demonstration rather than a comment, because it is the
    // reason every case above is written the way it is. The old payload was the
    // raw entitlement, `Infinity` and all.
    const oldShape = { deepReportsRemaining: Number.POSITIVE_INFINITY };

    // The naive form: green, and it proves nothing.
    expect(JSON.stringify(JSON.parse(JSON.stringify(oldShape)))).toBe(
      JSON.stringify(oldShape),
    );
    // The form this suite uses: red, correctly.
    expect(JSON.parse(JSON.stringify(oldShape))).not.toEqual(oldShape);
  });
});
