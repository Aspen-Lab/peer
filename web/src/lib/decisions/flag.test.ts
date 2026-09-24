import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP,
  DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP,
  DEFAULT_JEV_GLOBAL_DAILY_CAP,
  DEFAULT_JEV_PER_USER_DAILY_CAP,
  MAX_GEMINI_FALLBACK_PER_RUN,
  geminiFallbackEnabled,
  jevShadowEnabled,
  readGeminiFallbackConfig,
  readJevShadowConfig,
} from "./flag";

// P3-S5 — ABC-JEV-INTEGRATION.md §4 Round 3 "P3-S5 DESIGN RULING" +
// docs/jev-abc/P3-B-20260924T0525Z.md §0.5. Same literal-"on"-only
// convention as `jevBrokerEnabled()` (decisions/broker-client.ts) and
// `dashboardLedgerEnabled()` (dashboard/ledger-flag.ts) — tested here rather
// than assumed, since a typo silently keeping the feature off is the safe
// direction and must be provably true.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("jevShadowEnabled", () => {
  it("is enabled by the literal string 'on', trimmed and case-insensitive", () => {
    vi.stubEnv("PEER_JEV_SHADOW", "on");
    expect(jevShadowEnabled()).toBe(true);
    vi.stubEnv("PEER_JEV_SHADOW", " ON ");
    expect(jevShadowEnabled()).toBe(true);
    vi.stubEnv("PEER_JEV_SHADOW", "On");
    expect(jevShadowEnabled()).toBe(true);
  });

  it("stays disabled for anything other than the literal 'on'", () => {
    vi.stubEnv("PEER_JEV_SHADOW", "true");
    expect(jevShadowEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_SHADOW", "1");
    expect(jevShadowEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_SHADOW", "onn"); // typo
    expect(jevShadowEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_SHADOW", "");
    expect(jevShadowEnabled()).toBe(false);
  });

  it("stays disabled when entirely unset", () => {
    vi.stubEnv("PEER_JEV_SHADOW", undefined as unknown as string);
    delete process.env.PEER_JEV_SHADOW;
    expect(jevShadowEnabled()).toBe(false);
  });
});

describe("readJevShadowConfig — unconfigured detection", () => {
  it("is unconfigured when both the broker URL and secret are unset", () => {
    vi.stubEnv("PEER_JEV_BROKER_URL", undefined as unknown as string);
    vi.stubEnv("PEER_JEV_BROKER_SECRET", undefined as unknown as string);
    delete process.env.PEER_JEV_BROKER_URL;
    delete process.env.PEER_JEV_BROKER_SECRET;

    expect(readJevShadowConfig()).toEqual({ status: "unconfigured" });
  });

  it("is unconfigured when the URL is set but the secret is blank/whitespace", () => {
    vi.stubEnv("PEER_JEV_BROKER_URL", "https://example.supabase.co/functions/v1/jev-broker");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "   ");

    expect(readJevShadowConfig()).toEqual({ status: "unconfigured" });
  });

  it("is unconfigured when the secret is set but the URL is blank", () => {
    vi.stubEnv("PEER_JEV_BROKER_URL", "");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "a-real-secret");

    expect(readJevShadowConfig()).toEqual({ status: "unconfigured" });
  });

  it("never reserves or calls anything when unconfigured — this is a pure read, no side effects", () => {
    delete process.env.PEER_JEV_BROKER_URL;
    delete process.env.PEER_JEV_BROKER_SECRET;
    // Calling twice must be side-effect-free and idempotent.
    expect(readJevShadowConfig()).toEqual({ status: "unconfigured" });
    expect(readJevShadowConfig()).toEqual({ status: "unconfigured" });
  });
});

describe("readJevShadowConfig — configured, with cap parsing", () => {
  function stubBroker() {
    vi.stubEnv("PEER_JEV_BROKER_URL", "https://example.supabase.co/functions/v1/jev-broker");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "a-real-secret");
  }

  it("trims the URL and secret and defaults both caps when unset", () => {
    vi.stubEnv("PEER_JEV_BROKER_URL", "  https://example.supabase.co/functions/v1/jev-broker  ");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "  a-real-secret  ");
    vi.stubEnv("PEER_JEV_PER_USER_DAILY_CAP", undefined as unknown as string);
    vi.stubEnv("PEER_JEV_GLOBAL_DAILY_CAP", undefined as unknown as string);
    delete process.env.PEER_JEV_PER_USER_DAILY_CAP;
    delete process.env.PEER_JEV_GLOBAL_DAILY_CAP;

    expect(readJevShadowConfig()).toEqual({
      status: "configured",
      brokerUrl: "https://example.supabase.co/functions/v1/jev-broker",
      brokerSecret: "a-real-secret",
      perUserDailyCap: DEFAULT_JEV_PER_USER_DAILY_CAP,
      globalDailyCap: DEFAULT_JEV_GLOBAL_DAILY_CAP,
    });
    expect(DEFAULT_JEV_PER_USER_DAILY_CAP).toBe(50);
    expect(DEFAULT_JEV_GLOBAL_DAILY_CAP).toBe(2000);
  });

  it("parses valid explicit caps", () => {
    stubBroker();
    vi.stubEnv("PEER_JEV_PER_USER_DAILY_CAP", "12");
    vi.stubEnv("PEER_JEV_GLOBAL_DAILY_CAP", "999");

    const config = readJevShadowConfig();
    expect(config).toMatchObject({ status: "configured", perUserDailyCap: 12, globalDailyCap: 999 });
  });

  it.each([
    ["not-a-number", "typo"],
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["-5", "negative"],
    ["0", "zero"],
    ["NaN", "the literal word NaN"],
  ])("falls back to the default per-user cap for invalid string %j (%s)", (value) => {
    stubBroker();
    vi.stubEnv("PEER_JEV_PER_USER_DAILY_CAP", value);

    const config = readJevShadowConfig();
    expect(config).toMatchObject({ status: "configured", perUserDailyCap: DEFAULT_JEV_PER_USER_DAILY_CAP });
  });

  it.each([
    ["not-a-number", "typo"],
    ["", "empty string"],
    ["-1", "negative"],
    ["0", "zero"],
  ])("falls back to the default global cap for invalid string %j (%s)", (value) => {
    stubBroker();
    vi.stubEnv("PEER_JEV_GLOBAL_DAILY_CAP", value);

    const config = readJevShadowConfig();
    expect(config).toMatchObject({ status: "configured", globalDailyCap: DEFAULT_JEV_GLOBAL_DAILY_CAP });
  });

  it("truncates a fractional cap rather than rejecting it", () => {
    stubBroker();
    vi.stubEnv("PEER_JEV_PER_USER_DAILY_CAP", "12.9");

    const config = readJevShadowConfig();
    expect(config).toMatchObject({ status: "configured", perUserDailyCap: 12 });
  });
});

// P3-S6 — the bounded Gemini decision fallback's OWN flag + caps
// (ABC-JEV-INTEGRATION.md §4 "P3-S6 RULING", 2026-09-24T14:35:58Z;
// §1p.H(5)). Same literal-"on"-only convention, same cap-parsing fallback
// behaviour, tested the same way as the main Jev shadow flag above —
// deliberately a SEPARATE flag/config (`PEER_JEV_GEMINI_FALLBACK`, not
// `PEER_JEV_SHADOW`) and a SEPARATE pair of caps, never the main Jev caps.

describe("geminiFallbackEnabled", () => {
  it("is enabled by the literal string 'on', trimmed and case-insensitive", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    expect(geminiFallbackEnabled()).toBe(true);
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", " ON ");
    expect(geminiFallbackEnabled()).toBe(true);
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "On");
    expect(geminiFallbackEnabled()).toBe(true);
  });

  it("stays disabled for anything other than the literal 'on'", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "true");
    expect(geminiFallbackEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "1");
    expect(geminiFallbackEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "onn"); // typo
    expect(geminiFallbackEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "");
    expect(geminiFallbackEnabled()).toBe(false);
  });

  it("stays disabled when entirely unset (default off)", () => {
    delete process.env.PEER_JEV_GEMINI_FALLBACK;
    expect(geminiFallbackEnabled()).toBe(false);
  });

  it("is a SEPARATE flag from PEER_JEV_SHADOW — the main shadow flag alone does not enable it", () => {
    delete process.env.PEER_JEV_GEMINI_FALLBACK;
    vi.stubEnv("PEER_JEV_SHADOW", "on");
    expect(geminiFallbackEnabled()).toBe(false);
  });
});

describe("MAX_GEMINI_FALLBACK_PER_RUN — the binding <=5-per-run ceiling", () => {
  it("is exactly 5 (ABC-JEV-INTEGRATION.md §1p.H(5): '<=5 per run')", () => {
    expect(MAX_GEMINI_FALLBACK_PER_RUN).toBe(5);
  });
});

describe("readGeminiFallbackConfig — disabled detection", () => {
  it("is disabled when the flag is unset", () => {
    delete process.env.PEER_JEV_GEMINI_FALLBACK;
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
  });

  it("is disabled for a near-miss value ('true', '1', a typo)", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "true");
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "1");
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "onn");
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
  });

  it("never reserves or calls anything when disabled — a pure, idempotent read", () => {
    delete process.env.PEER_JEV_GEMINI_FALLBACK;
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
    expect(readGeminiFallbackConfig()).toEqual({ status: "disabled" });
  });
});

describe("readGeminiFallbackConfig — enabled, with cap parsing", () => {
  it("defaults both caps when unset, and the defaults are the documented PROPOSED numbers", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    delete process.env.PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP;
    delete process.env.PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP;

    expect(readGeminiFallbackConfig()).toEqual({
      status: "enabled",
      perUserDailyCap: DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP,
      globalDailyCap: DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP,
    });
  });

  it("parses valid explicit caps", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP", "3");
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP", "77");

    expect(readGeminiFallbackConfig()).toEqual({
      status: "enabled",
      perUserDailyCap: 3,
      globalDailyCap: 77,
    });
  });

  it.each([
    ["not-a-number", "typo"],
    ["", "empty string"],
    ["-5", "negative"],
    ["0", "zero"],
  ])("falls back to the default per-user cap for invalid string %j (%s)", (value) => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP", value);

    const config = readGeminiFallbackConfig();
    expect(config).toMatchObject({ perUserDailyCap: DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP });
  });

  it("truncates a fractional cap rather than rejecting it", () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP", "77.9");

    const config = readGeminiFallbackConfig();
    expect(config).toMatchObject({ globalDailyCap: 77 });
  });

  it("never shares its cap defaults with the main Jev shadow caps", () => {
    expect(DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP).not.toBe(DEFAULT_JEV_PER_USER_DAILY_CAP);
    expect(DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP).not.toBe(DEFAULT_JEV_GLOBAL_DAILY_CAP);
  });
});
