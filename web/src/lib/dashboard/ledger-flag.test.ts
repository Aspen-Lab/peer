import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardLedgerEnabled } from "./ledger-flag";

// P4-S4 (Round 3) -- ABC-JEV-INTEGRATION.md §1p.F. This pins the EXACT same
// semantics as the inline `isDashboardLedgerEnabled()` this module extracts
// from (web/src/app/api/feed/route.ts:36-38, not edited by this slice --
// P4-S3 is what switches route.ts to import this module instead of keeping
// its own copy). If either copy's behavior ever needs to change, these
// tests are the contract that both must keep matching.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboardLedgerEnabled", () => {
  it("is false when the env var is unset/empty -- today's behaviour by default", () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "");
    expect(dashboardLedgerEnabled()).toBe(false);
  });

  it("is true for the exact lowercase value 'on'", () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    expect(dashboardLedgerEnabled()).toBe(true);
  });

  it("is true regardless of case", () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "ON");
    expect(dashboardLedgerEnabled()).toBe(true);
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "On");
    expect(dashboardLedgerEnabled()).toBe(true);
  });

  it("is true with surrounding whitespace trimmed", () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "  on  ");
    expect(dashboardLedgerEnabled()).toBe(true);
  });

  it.each(["true", "1", "yes", "enabled", "onn", "on1", "off", "no"])(
    "is false for the near-miss value %j -- only the literal spelling 'on' enables it, deliberately unforgiving",
    (value) => {
      vi.stubEnv("PEER_DASHBOARD_LEDGER", value);
      expect(dashboardLedgerEnabled()).toBe(false);
    },
  );
});
