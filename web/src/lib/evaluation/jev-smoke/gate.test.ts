import { afterEach, describe, expect, it, vi } from "vitest";
import { canRunJevSmoke, credentialPresence, readJevSmokeApiKey } from "./gate";

describe("credentialPresence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a presence boolean only — the credential VALUE never appears anywhere in the return", () => {
    vi.stubEnv("JEV_SMOKE_API_KEY", "jev-super-secret-value-do-not-use-12345");

    const presence = credentialPresence();

    expect(presence).toEqual({ jevApiKey: true });
    // Belt-and-suspenders: inspect the JSON-serialized form too, not just the
    // typed shape, mirroring live-channels-gate.test.ts's own pattern.
    const serialized = JSON.stringify(presence);
    expect(serialized).not.toContain("jev-super-secret-value-do-not-use-12345");
    expect(typeof presence.jevApiKey).toBe("boolean");
  });

  it("reports false when unset", () => {
    delete process.env.JEV_SMOKE_API_KEY;
    expect(credentialPresence()).toEqual({ jevApiKey: false });
  });

  it("treats a whitespace-only value as absent", () => {
    vi.stubEnv("JEV_SMOKE_API_KEY", "   ");
    expect(credentialPresence().jevApiKey).toBe(false);
  });

  it("does not count JEV_API_KEY: only the smoke runner's own name is read", () => {
    vi.stubEnv("JEV_API_KEY", "jev-super-secret-value-do-not-use-12345");
    delete process.env.JEV_SMOKE_API_KEY;
    expect(credentialPresence()).toEqual({ jevApiKey: false });
    expect(readJevSmokeApiKey()).toBeUndefined();
  });

  it("reads from an injected environment, trimmed, and refuses a value that is not shaped like a key", () => {
    expect(readJevSmokeApiKey({ JEV_SMOKE_API_KEY: "  abc123  " })).toBe("abc123");
    expect(readJevSmokeApiKey({ JEV_SMOKE_API_KEY: "two words" })).toBeUndefined();
    expect(credentialPresence({ JEV_SMOKE_API_KEY: "abc123" })).toEqual({ jevApiKey: true });
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
