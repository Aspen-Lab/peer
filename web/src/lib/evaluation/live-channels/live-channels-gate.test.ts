import { afterEach, describe, expect, it, vi } from "vitest";
import { canRunLiveChannelsEval, credentialPresence } from "./live-channels-gate";

describe("credentialPresence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports presence booleans only — the credential VALUE never appears anywhere in the return", () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "sk-super-secret-value-12345");
    vi.stubEnv("OPENALEX_API_KEY", "");
    vi.stubEnv("OPENALEX_EMAIL", "researcher@example.com");

    const presence = credentialPresence();

    expect(presence).toEqual({
      semanticScholar: true,
      openAlexKey: false,
      openAlexEmail: true,
    });
    // Belt-and-suspenders: inspect the JSON-serialized form too, not just the
    // typed shape, so a future field that smuggled a raw value through would
    // still fail this test.
    const serialized = JSON.stringify(presence);
    expect(serialized).not.toContain("sk-super-secret-value-12345");
    expect(serialized).not.toContain("researcher@example.com");
    expect(Object.values(presence).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("reports all-false when nothing is set", () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "");
    vi.stubEnv("OPENALEX_API_KEY", "");
    vi.stubEnv("OPENALEX_EMAIL", "");
    expect(credentialPresence()).toEqual({
      semanticScholar: false,
      openAlexKey: false,
      openAlexEmail: false,
    });
  });

  it("treats a whitespace-only value as absent", () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "   ");
    expect(credentialPresence().semanticScholar).toBe(false);
  });
});

describe("canRunLiveChannelsEval", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when the opt-in literal is exactly "1"', () => {
    vi.stubEnv("PEER_RUN_LIVE_CHANNELS_EVAL", "1");
    expect(canRunLiveChannelsEval()).toBe(true);

    vi.stubEnv("PEER_RUN_LIVE_CHANNELS_EVAL", "true");
    expect(canRunLiveChannelsEval()).toBe(false);

    vi.stubEnv("PEER_RUN_LIVE_CHANNELS_EVAL", "0");
    expect(canRunLiveChannelsEval()).toBe(false);
  });

  it("is false when unset (does not accidentally run on a machine that has credentials but no opt-in)", () => {
    expect(canRunLiveChannelsEval()).toBe(false);
  });
});
