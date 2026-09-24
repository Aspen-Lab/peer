import { describe, expect, it } from "vitest";
import { resolveProvider } from "@/lib/llm/providers/registry";
import {
  entitledContext,
  isEntitledContext,
  unsafeEntitledContextForTests,
  type EntitledContext,
  type ProviderContext,
} from "./entitled-context";
import type { Entitlement } from "@/lib/entitlement/types";

/**
 * ABC-freemium 3-02 · R-SEC-2 · Ruling 7 point 3 · Ruling 9 point 5.
 *
 * **Most of this file is checked by `tsc`, not by vitest.** The item's claim is
 * that an unguarded provider acquisition stops being a grep miss and becomes a
 * compile error, so the assertions that matter are the `@ts-expect-error`
 * lines: each one FAILS THE BUILD if the error it names ever stops happening.
 * Test files are inside `tsconfig.json`'s program, so the gate's `tsc` step is
 * what runs them, and a weakened brand cannot pass unnoticed.
 *
 * The runtime cases below cover the small amount of behaviour the brand has:
 * the mint copies the right fields, and the justification narrows correctly.
 */

const ENTITLEMENT: Entitlement = {
  plan: "paid",
  effectivePlan: "paid",
  systemSearchAllowed: true,
  poolRefreshAllowed: true,
  trialEndsAt: null,
  userId: "user-3-02",
  source: "supabase",
  deepReportsBudget: 0,
};

describe("the entitled-context brand refuses a caller that did not prove entitlement", () => {
  it("rejects an acquisition with NO context at all", () => {
    // The shape scan 4 was written to catch with a regex. It is now a TS2554,
    // which means it is caught in files scan 4 does not look at, in call shapes
    // the regex cannot express, and before the test suite even runs.
    // @ts-expect-error — the context argument is required (3-02)
    expect(() => resolveProvider(null)).toBeTruthy();
  });

  it("rejects a plain object with EVERY visible field correct", () => {
    // The important case, and the one a regex could never catch: this is what a
    // forgetful author actually writes. Every field is right; the brand is
    // absent, and the brand is the only thing that says an entitlement check
    // ran above this line.
    expect(() =>
      // @ts-expect-error — a plain object is not an EntitledContext (3-02)
      resolveProvider(null, { userId: "user-3-02", byok: false, path: "attack" }),
    ).toBeTruthy();
  });

  it("rejects an invented justification kind", () => {
    // The justification union is closed on purpose: a caller outside an
    // entitled request must pick one of the two written reasons, not invent a
    // third that sounds fine. "It is probably OK" is exactly the claim this
    // item exists to stop people making silently.
    expect(() =>
      // @ts-expect-error — not a member of SpendJustification (3-02)
      resolveProvider(null, { kind: "i-am-sure-it-is-fine", where: "nowhere" }),
    ).toBeTruthy();
  });

  it("rejects an explicit undefined", () => {
    // @ts-expect-error — undefined is not a ProviderContext (3-02)
    expect(() => resolveProvider(null, undefined)).toBeTruthy();
  });

  it("cannot be forged with a symbol of the caller's own", () => {
    const forged = Symbol("entitledBrand");
    expect(() =>
      resolveProvider(null, {
        userId: null,
        byok: false,
        path: "attack",
        // @ts-expect-error — the real brand symbol is not exported (3-02)
        [forged]: true,
      }),
    ).toBeTruthy();
  });
});

describe("what the brand does NOT stop — recorded, not implied", () => {
  it("does not prevent a legitimately-obtained context being tampered with", () => {
    // Round-3 B compiled this attack rather than assuming it away, and it is
    // written down here so no later round mistakes the brand for more than it
    // is. A brand proves PROVENANCE, not that the fields were left alone
    // afterwards. The consequence is a usage row attributed to the wrong user;
    // it cannot create spend that was not already authorised, because the
    // entitlement check still ran.
    const real = entitledContext(ENTITLEMENT, "paper-report", false);
    const tampered: EntitledContext = { ...real, userId: "someone-else" };

    expect(tampered.userId).toBe("someone-else");
    expect(isEntitledContext(tampered)).toBe(true);
  });
});

describe("minting", () => {
  it("copies the entitlement's user and the caller's path and byok flag", () => {
    const ctx = entitledContext(ENTITLEMENT, "paper-report", true);

    expect(ctx.userId).toBe("user-3-02");
    expect(ctx.path).toBe("paper-report");
    expect(ctx.byok).toBe(true);
  });

  it("takes an Entitlement, not a bare user id", () => {
    // The parameter type IS part of the claim: the only supported way to hold
    // an `Entitlement` is to have gone through `requireEntitledAiRequest`, so a
    // caller with a loose string cannot reach the mint at all.
    // @ts-expect-error — a user id is not an Entitlement (3-02)
    expect(() => entitledContext("user-3-02", "p", false)).toBeTruthy();
  });

  it("gives the test hatch honest defaults", () => {
    const ctx = unsafeEntitledContextForTests();

    expect(ctx.userId).toBeNull();
    expect(ctx.byok).toBe(false);
    expect(ctx.path).toBe("test");
  });
});

describe("narrowing a ProviderContext", () => {
  it("tells a minted context from a written justification", () => {
    const minted: ProviderContext = entitledContext(ENTITLEMENT, "p", false);
    const justified: ProviderContext = {
      kind: "entitlement-proved-by-tier-ceiling",
      where: "feed/pipeline.ts",
    };

    expect(isEntitledContext(minted)).toBe(true);
    expect(isEntitledContext(justified)).toBe(false);
  });

  it("meters a justified acquisition against no user, and says so", () => {
    // A pool-build closure has no reader. `null` is the honest `user_id` there
    // and it is now STATED by the justification branch rather than produced by
    // an optional parameter defaulting into existence.
    const justified: ProviderContext = {
      kind: "byok-only-never-operator-funded",
      where: "test",
    };

    expect(isEntitledContext(justified)).toBe(false);
  });
});
