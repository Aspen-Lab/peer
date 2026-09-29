import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordUsageEvent,
  recordUsageEventAwaited,
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "./events";

/**
 * UPSTREAM-02 C1 — smoke coverage for the ported `usage/events.ts`.
 *
 * Upstream ships no dedicated test for this file (confirmed via
 * `git ls-tree origin/main -- web/src/lib/usage/`); this is the minimal
 * fake-client coverage the B guide asked C to add — no real Supabase client is
 * constructed anywhere in this file. This module is not imported by any
 * production code path yet (UPSTREAM-02 C1 is an inert port); `events.ts` is
 * only reachable here via the test-only `setUsageEventsClientForTests` seam
 * its own module comment documents.
 */

const ROW: UsageEventRow = {
  user_id: "u1",
  kind: "llm",
  path: "digest",
  ok: true,
};

afterEach(() => {
  // Leave no fake client behind for a later, unrelated test file.
  setUsageEventsClientForTests(undefined);
});

describe("no-op when unconfigured", () => {
  it("recordUsageEvent does nothing and never throws when the client is null", () => {
    setUsageEventsClientForTests(null);

    expect(() => recordUsageEvent(ROW)).not.toThrow();
  });

  it("recordUsageEventAwaited resolves without writing anything when the client is null", async () => {
    setUsageEventsClientForTests(null);

    await expect(recordUsageEventAwaited(ROW)).resolves.toBeUndefined();
  });
});

describe("fire-and-forget never throws", () => {
  it("recordUsageEvent does not throw synchronously even if the insert will reject", () => {
    const insert = vi.fn().mockRejectedValue(new Error("down"));
    setUsageEventsClientForTests({ from: () => ({ insert }) });

    // The module's own header comment: "a usage row is observability, never a
    // gate" — a write failure must never surface to the caller.
    expect(() => recordUsageEvent(ROW)).not.toThrow();
  });

  it("recordUsageEventAwaited swallows an insert rejection rather than propagating it", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("down"));
    setUsageEventsClientForTests({ from: () => ({ insert }) });

    await expect(recordUsageEventAwaited(ROW)).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("recordUsageEventAwaited swallows a client that reports an error object instead of throwing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "down" } });
    setUsageEventsClientForTests({ from: () => ({ insert }) });

    // events.ts does not itself inspect `{ error }` (that is Supabase's own
    // convention, not a throw) — this only proves the call completes either way.
    await expect(recordUsageEventAwaited(ROW)).resolves.toBeUndefined();
  });
});

describe("writes through to the injected client", () => {
  it("recordUsageEventAwaited inserts exactly the given row into usage_events", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    setUsageEventsClientForTests({ from });

    await recordUsageEventAwaited(ROW);

    expect(from).toHaveBeenCalledWith("usage_events");
    expect(insert).toHaveBeenCalledWith([ROW]);
  });

  it("recordUsageEvent (fire-and-forget) eventually reaches the client too", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    setUsageEventsClientForTests({ from: () => ({ insert }) });

    recordUsageEvent(ROW);
    await Promise.resolve();
    await Promise.resolve();

    expect(insert).toHaveBeenCalledWith([ROW]);
  });
});
