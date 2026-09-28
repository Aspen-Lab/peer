import { afterEach, describe, expect, it, vi } from "vitest";
import { canRunJevSmoke, credentialPresence } from "./gate";

describe("credentialPresence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a presence boolean only — the credential VALUE never appears anywhere in the return", () => {
    vi.stubEnv("JEV_API_KEY", "jev-super-secret-value-do-not-use-12345");

    const presence = credentialPresence();

    expect(presence).toEqual({ jevApiKey: true });
    // Belt-and-suspenders: inspect the JSON-serialized form too, not just the
    // typed shape, mirroring live-channels-gate.test.ts's own pattern.
    const serialized = JSON.stringify(presence);
    expect(serialized).not.toContain("jev-super-secret-value-do-not-use-12345");
    expect(typeof presence.jevApiKey).toBe("boolean");
  });

  it("reports false when unset", () => {
    delete process.env.JEV_API_KEY;
    expect(credentialPresence()).toEqual({ jevApiKey: false });
  });

  it("treats a whitespace-only value as absent", () => {
    vi.stubEnv("JEV_API_KEY", "   ");
    expect(credentialPresence().jevApiKey).toBe(false);
  });
});

describe("canRunJevSmoke", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when the opt-in literal is exactly "1"', () => {
    vi.stubEnv("PEER_RUN_JEV_SMOKE", "1");
    expect(canRunJevSmoke()).toBe(true);

    vi.stubEnv("PEER_RUN_JEV_SMOKE", "true");
    expect(canRunJevSmoke()).toBe(false);

    vi.stubEnv("PEER_RUN_JEV_SMOKE", "0");
    expect(canRunJevSmoke()).toBe(false);
  });

  it("is false when unset (does not accidentally run on a machine that has a key but no opt-in)", () => {
    expect(canRunJevSmoke()).toBe(false);
  });
});
