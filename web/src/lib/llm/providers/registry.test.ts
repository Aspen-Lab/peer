import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * R-KEY-1, R-TEST-1 — **the resolution ladder of a Peer that holds no model key.**
 *
 * The ladder is: the reader's own key, then a developer's explicit local
 * opt-in, then nothing. There is no server-owned default, so every case that
 * puts a credential in the environment asserts it is **ignored**: a dummy
 * `GOOGLE_API_KEY` in the process environment is not a model, in any runtime.
 *
 * **Assertions are on `.id` and on which factory ran, never on object
 * identity.** `resolveProvider` wraps its result in the metering wrapper, so it
 * returns a fresh object every call and `toBe(geminiProvider)` cannot work.
 */

const mocks = vi.hoisted(() => ({ createGeminiApiProvider: vi.fn() }));

// Spying on the factory is how "an API-key provider was built" is told apart
// from "the Vertex singleton was returned": both report `id: "gemini"`, so the
// id alone cannot distinguish them.
vi.mock("./gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gemini")>();
  mocks.createGeminiApiProvider.mockImplementation(actual.createGeminiApiProvider);
  return { ...actual, createGeminiApiProvider: mocks.createGeminiApiProvider };
});

import {
  canUseLocalServerProvider,
  hasUsableProviderOverride,
  resolveProvider,
} from "./registry";

const SERVER_AI_ENV = [
  "PEER_DIGEST_PROVIDER",
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "DEEPSEEK_API_KEY",
  "VERCEL",
  "VERCEL_ENV",
] as const;

/** Sentinels only. Nothing here is, or resembles, a real credential. */
const COMPANY_KEY = "COMPANY-NOT-A-KEY";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Belt and braces on top of `vitest.setup.ts`: no environment credential may
  // survive a test.
  for (const key of SERVER_AI_ENV) delete process.env[key];
});

describe("provider resolution", () => {
  it("ignores GOOGLE_API_KEY in every runtime — Peer has no model key of its own", () => {
    // THE case this file exists for. With the old company default, a dummy
    // `GOOGLE_API_KEY` made `resolveProvider(null)` return a live Gemini
    // provider for every signed-in reader. It must resolve nothing now, in
    // production, on a Vercel preview, and in local development.
    vi.stubEnv("GOOGLE_API_KEY", COMPANY_KEY);

    for (const [nodeEnv, vercelEnv] of [
      ["production", ""],
      ["production", "production"],
      ["development", "preview"],
      ["development", ""],
      ["test", ""],
    ] as const) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("VERCEL_ENV", vercelEnv);
      expect(resolveProvider(null), `${nodeEnv}/${vercelEnv}`).toBeNull();
    }
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("resolves nothing in production with every operator credential set and no override", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "openai");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("GOOGLE_API_KEY", COMPANY_KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("OPENAI_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("QWEN_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("DEEPSEEK_API_KEY", "OPERATOR-NOT-A-KEY");

    // The local opt-in is local-only: `PEER_DIGEST_PROVIDER` is not honoured in
    // production, so even a leaked variable reaches no provider.
    expect(canUseLocalServerProvider()).toBe(false);
    expect(resolveProvider(null)).toBeNull();
  });

  it("does not treat a Vercel preview as local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    expect(canUseLocalServerProvider()).toBe(false);
    expect(resolveProvider(null)).toBeNull();
  });

  it("keeps the local Vertex path behind an explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "local-project");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    expect(canUseLocalServerProvider()).toBe(true);
    expect(resolveProvider(null)?.id).toBe("gemini");
    // The singleton, not the API-key factory: this is the Vertex path.
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("lets a developer opt a provider in by name, locally", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "anthropic");

    expect(resolveProvider(null)?.id).toBe("anthropic");
  });

  it("ignores GOOGLE_VERTEX_PROJECT in local dev without the opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "local-project");

    expect(resolveProvider(null)).toBeNull();
  });

  it("ignores GOOGLE_API_KEY in local dev without the opt-in too", () => {
    // Local development used to be the one place this key was read. It is not
    // read anywhere now: a developer opts a provider in by name, or pastes a key
    // like any reader.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GOOGLE_API_KEY", COMPANY_KEY);

    expect(resolveProvider(null)).toBeNull();
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("uses an explicit user key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");

    expect(
      resolveProvider({ provider: "openai", apiKey: " user-key " })?.id,
    ).toBe("openai");
  });

  it("builds the reader's own Gemini provider from the reader's key, never from the environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_API_KEY", COMPANY_KEY);

    const provider = resolveProvider({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });

    expect(provider?.id).toBe("gemini");
    expect(mocks.createGeminiApiProvider).toHaveBeenCalledWith("USER-NOT-A-KEY");
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalledWith(COMPANY_KEY);
  });

  it("lets a user's own key beat a developer's local opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    const provider = resolveProvider({
      provider: "anthropic",
      apiKey: "USER-NOT-A-KEY",
    });

    expect(provider?.id).toBe("anthropic");
  });

  it("resolves nothing when the override is unusable — there is no default to fall through to", () => {
    // An override with a blank key does not resolve, and with no server-owned
    // default behind it the request is the reading without a model.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_API_KEY", COMPANY_KEY);

    expect(resolveProvider({ provider: "openai", apiKey: "   " })).toBeNull();
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("rejects blank or unreasonably large user keys", () => {
    expect(
      hasUsableProviderOverride({ provider: "gemini", apiKey: "   " }),
    ).toBe(false);
    expect(
      hasUsableProviderOverride({
        provider: "gemini",
        apiKey: "x".repeat(4097),
      }),
    ).toBe(false);
  });
});
