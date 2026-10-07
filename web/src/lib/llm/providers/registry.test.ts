import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * R-KEY-1, R-TEST-1 — **the resolution ladder of a Peer that holds no model key.**
 *
 * The ladder is: the reader's own key, then a developer's explicit local
 * opt-in, then nothing. There is no server-owned default, so every case that
 * puts a credential in the environment asserts it is **ignored**: a dummy
 * `GOOGLE_API_KEY` in the process environment is not a model, in any runtime.
 *
 * **The registry hands the provider back exactly as it was built** — no
 * wrapper, no usage ledger — so the case at the bottom asserts object identity,
 * and the rest still assert `.id` and which factory ran (the Vertex singleton
 * and an API-key provider both report `id: "gemini"`).
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
import { geminiProvider } from "./gemini";

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

/**
 * P3-02c (ruling §1h.4 amendment) — which RESOLVED providers can search the web.
 *
 * The explain route reads `supportsWebSearch` off whatever `resolveProvider`
 * returns. With no wrapper between (P4-00: the metering wrapper is gone) that is
 * the provider's own object, so the end-to-end fact is asserted here, through the
 * registry: both Gemini providers can search — a reader's own key, and the
 * developer's opted-in local one — and no other provider says it can: they ignore
 * the argument, and the route answers them without search.
 */
describe("P3-02c — which resolved providers can search the web", () => {
  it("a reader's own Gemini key can, and so can the developer's local opt-in", () => {
    expect(resolveProvider({ provider: "gemini", apiKey: "USER-NOT-A-KEY" })?.supportsWebSearch).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");
    expect(resolveProvider(null)?.supportsWebSearch).toBe(true);
  });

  it("no other provider says it can", () => {
    for (const provider of ["anthropic", "openai", "qwen", "deepseek"] as const) {
      const resolved = resolveProvider({ provider, apiKey: "USER-NOT-A-KEY" });

      expect(resolved?.id).toBe(provider);
      expect(resolved?.supportsWebSearch).toBeUndefined();
    }
  });
});

describe("the provider is handed back exactly as it was built", () => {
  it("returns the reader's own provider object itself, every optional member and flag untouched", () => {
    // Nothing sits between the registry and the provider: no metering wrapper,
    // no usage ledger. A flag a provider object carries (`supportsWebSearch` on
    // the two Gemini providers, once the reader-side search lands) is therefore
    // readable by the caller as it was set, and an optional method a provider
    // lacks stays absent rather than being defined and then failing.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    const built = {
      id: "gemini",
      generateDigest: vi.fn(),
      testConnection: vi.fn(),
      generateJsonText: vi.fn(),
      supportsWebSearch: true,
    };
    mocks.createGeminiApiProvider.mockReturnValueOnce(built);

    const resolved = resolveProvider({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });

    expect(resolved).toBe(built);
    expect(resolved).toHaveProperty("supportsWebSearch", true);
    expect(resolved).not.toHaveProperty("generateVisionJsonText");
  });

  it("returns the developer's opted-in singleton itself", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    expect(resolveProvider(null)).toBe(geminiProvider);
  });
});

