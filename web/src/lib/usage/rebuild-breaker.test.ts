import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORCED_REBUILDS_PER_DAY,
  consumeForcedRebuild,
} from "./rebuild-breaker";
import { resetCounterStoreForTests } from "./counters";

/**
 * The forced-rebuild breaker, kept as its own suite when the deep-report
 * allowance (whose test file used to hold these cases) was deleted. The
 * breaker is the daily cap on a forced pool rebuild ("refresh now") and it
 * stays live until it goes with the rest of the company-budget machinery.
 *
 * **The clock is stubbed, never `Date.now()`.** The day boundary is a claim
 * about a calendar, and a test that computed it the same way the code does
 * would assert nothing.
 */

const NOW = new Date("2026-09-04T12:00:00.000Z");

beforeEach(() => {
  resetCounterStoreForTests();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetCounterStoreForTests();
});

/**
 * The error lines carrying the stable `[quota] store unavailable` prefix, matched
 * byte-for-byte rather than by substring.
 */
function storeUnavailableLines(): string[] {
  const spy = vi.mocked(console.error);
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("[quota] store unavailable"));
}

describe("the forced-rebuild breaker", () => {
  it("allows the day's rebuild units and refuses the one past the cap", async () => {
    expect(
      await consumeForcedRebuild("user-1", FORCED_REBUILDS_PER_DAY, NOW),
    ).toBe(true);

    expect(await consumeForcedRebuild("user-1", 1, NOW)).toBe(false);
    // A real trip says so on the error channel, naming the cap it hit.
    const tripLines = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.startsWith("[quota] forced-rebuild breaker tripped"));
    expect(tripLines).toHaveLength(1);
  });

  it("charges the whole fan-out, not one per call", async () => {
    // A fan-out of twelve queries costs twelve, or the 500/day cap would mean
    // 500 fan-outs rather than 500 searches.
    await consumeForcedRebuild("user-1", FORCED_REBUILDS_PER_DAY - 5, NOW);

    expect(await consumeForcedRebuild("user-1", 12, NOW)).toBe(false);
  });

  it("untrips on the next UTC day, with no extra state", async () => {
    await consumeForcedRebuild("user-1", FORCED_REBUILDS_PER_DAY, NOW);
    expect(await consumeForcedRebuild("user-1", 1, NOW)).toBe(false);

    const tomorrow = new Date("2026-09-05T00:00:01.000Z");
    expect(await consumeForcedRebuild("user-1", 1, tomorrow)).toBe(true);
  });

  it("fails CLOSED when the counter store is unreachable, and says it was an outage", async () => {
    // Point the store at a URL no admin client can be built from in-process.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE-ROLE-NOT-A-KEY");
    resetCounterStoreForTests();

    expect(await consumeForcedRebuild("user-1", 3, NOW)).toBe(false);

    // An outage must not be reported as a trip ("a cap tripped"): none did.
    const tripLines = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .filter((line) => line.startsWith("[quota] forced-rebuild breaker tripped"));
    expect(tripLines).toHaveLength(0);
    expect(storeUnavailableLines()).toHaveLength(1);
  });

  it("charges nobody when there is no user, or nothing to charge", async () => {
    expect(await consumeForcedRebuild(null, 5, NOW)).toBe(true);
    expect(await consumeForcedRebuild("user-1", 0, NOW)).toBe(true);
  });
});
