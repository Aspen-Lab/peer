import { describe, expect, it } from "vitest";
import { currentUsageContext, withUsageContext } from "./context";

/**
 * UPSTREAM-02 C1 — smoke coverage for the ported `usage/context.ts`.
 *
 * Upstream ships no dedicated test for this file (confirmed via
 * `git ls-tree origin/main -- web/src/lib/usage/`); this is the minimal round
 * trip the B guide asked C to add, mirroring the house style in
 * `counters.test.ts`. This module is not imported by any production code path
 * yet (UPSTREAM-02 C1 is an inert port), so these tests only exercise the
 * module directly.
 */

describe("withUsageContext / currentUsageContext", () => {
  it("returns undefined outside any scope", () => {
    expect(currentUsageContext()).toBeUndefined();
  });

  it("round-trips the exact scope inside the callback", () => {
    const scope = { userId: "u1", byok: false, path: "digest", recorded: false };

    const seenInsideCallback = withUsageContext(scope, () => currentUsageContext());

    expect(seenInsideCallback).toEqual(scope);
  });

  it("is not visible after the callback returns", () => {
    withUsageContext({ userId: "u1", byok: false, recorded: false }, () => {});

    expect(currentUsageContext()).toBeUndefined();
  });

  it("survives an await inside the callback (the whole point of AsyncLocalStorage)", async () => {
    // A module-scope variable would not survive the microtask boundary below;
    // this is the exact failure mode the module's header comment (two
    // concurrent feed loads attributing each other's spend) exists to avoid.
    const scope = { userId: "u2", byok: true, recorded: false };

    const seenAfterAwait = await withUsageContext(scope, async () => {
      await Promise.resolve();
      return currentUsageContext();
    });

    expect(seenAfterAwait).toEqual(scope);
  });

  it("does not leak one concurrent call's scope into another's", async () => {
    const run = (userId: string) =>
      withUsageContext({ userId, byok: false, recorded: false }, async () => {
        await Promise.resolve();
        return currentUsageContext()?.userId;
      });

    const [a, b] = await Promise.all([run("user-a"), run("user-b")]);

    expect(a).toBe("user-a");
    expect(b).toBe("user-b");
  });

  it("lets the caller flip recorded to avoid a second usage row for one call", () => {
    const scope = { userId: "u1", byok: false, recorded: false };

    withUsageContext(scope, () => {
      const seen = currentUsageContext();
      if (seen) seen.recorded = true;
    });

    expect(scope.recorded).toBe(true);
  });
});
