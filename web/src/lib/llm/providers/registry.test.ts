import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ABC-freemium 1-12 · R-KEY-1, R-TEST-1.
 *
 * **Every assertion below was rewritten, none deleted.** This file was the
 * anti-drift lock for "a deployed Peer is BYOK-only", and D1 reverses that
 * decision: the system Gemini key is the default model for every signed-in user
 * in every environment. What the file locks now is the *new* contract, and in
 * particular the half of R-KEY-1 that is easiest to lose — **`GOOGLE_VERTEX_*`
 * must never outrank `GOOGLE_API_KEY`**, which is exactly the inversion that
 * shipped before this round.
 *
 * **Assertions are on `.id` and on which factory ran, never on object
 * identity.** `resolveProvider` wraps its result in the metering wrapper (1-03),
 * so it returns a fresh object every call and `toBe(geminiProvider)` can no
 * longer work.
 */

const mocks = vi.hoisted(() => ({ createGeminiApiProvider: vi.fn() }));

// Spying on the factory is how "the system key path ran" is told apart from
// "the Vertex singleton was returned": both report `id: "gemini"`, so the id
// alone cannot distinguish them.
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
import { unsafeEntitledContextForTests } from "@/lib/security/entitled-context";

/**
 * ABC-freemium 3-02 · R-SEC-2 · Ruling 7 point 3.
 *
 * `resolveProvider`'s second argument is now **required and branded**: a plain
 * object with every field correct no longer compiles, which is the whole point
 * of the item. This file tests the **resolution ladder** — which key wins — and
 * has no entitlement to hand; building a real one here would make these cases
 * assert the entitlement layer instead of the ladder.
 *
 * So they go through the **one named escape hatch**, and it says `unsafe` in its
 * own name so that any production use is a single grep away. `spend-scans.test.ts`
 * scan 6 fails the build if this identifier appears outside a test file — the
 * brand is not weakened for production by anything on this line.
 */
const TEST_CTX = unsafeEntitledContextForTests({ path: "registry.test" });

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
const SYSTEM_KEY = "SYSTEM-NOT-A-KEY";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Belt and braces on top of `vitest.setup.ts` (item 1-00): after 1-11 a
  // lingering `GOOGLE_API_KEY` makes `resolveProvider(null, TEST_CTX)` return a LIVE provider,
  // so it must not survive a test.
  for (const key of SERVER_AI_ENV) delete process.env[key];
});

describe("provider resolution", () => {
  // ABC-freemium 1-11 — REWRITTEN. This case used to assert that
  // `resolveProvider(null, TEST_CTX)` is **null** in production with every operator credential
  // set, which was the BYOK-only lock. D1 removes that lock for one specific
  // credential and for no others, so the case now asserts exactly that split.
  it("uses the system key in production and ignores every other operator credential", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "openai");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("GOOGLE_API_KEY", SYSTEM_KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("OPENAI_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("QWEN_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("DEEPSEEK_API_KEY", "OPERATOR-NOT-A-KEY");

    const provider = resolveProvider(null, TEST_CTX);

    // The system key wins, and it is the API-key factory that ran — not the
    // Vertex singleton, and not the OpenAI provider `PEER_DIGEST_PROVIDER` asked
    // for, which is a local-only opt-in.
    expect(provider?.id).toBe("gemini");
    expect(mocks.createGeminiApiProvider).toHaveBeenCalledWith(SYSTEM_KEY);
  });

  it("resolves nothing when there is no system key and no override", () => {
    // D1's last clause — "no LLM at all only when neither exists" — and the
    // tier-0 path every call site already handles.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("ANTHROPIC_API_KEY", "OPERATOR-NOT-A-KEY");

    expect(resolveProvider(null, TEST_CTX)).toBeNull();
  });

  it("never lets GOOGLE_VERTEX_PROJECT outrank the system key", () => {
    // ABC-freemium 1-12 — NEW, and it is the assertion this round exists for.
    // Before 1-11 the ladder tested Vertex **first**, so with both set the
    // operator's Vertex project won and the system key was never reached.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("GOOGLE_API_KEY", SYSTEM_KEY);

    expect(resolveProvider(null, TEST_CTX)?.id).toBe("gemini");
    expect(mocks.createGeminiApiProvider).toHaveBeenCalledWith(SYSTEM_KEY);
  });

  it("does not treat a Vercel preview as local development", () => {
    // Unchanged in meaning and still true: Vertex is not a bare trigger in any
    // runtime now, and a preview is not a place a local opt-in is honoured.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    expect(canUseLocalServerProvider()).toBe(false);
    expect(resolveProvider(null, TEST_CTX)).toBeNull();
  });

  // ABC-freemium 1-11 — REWRITTEN. This case asserted that
  // `GOOGLE_VERTEX_PROJECT` alone resolved the Vertex provider in local
  // development. It is no longer a trigger; the opt-in is stated by name.
  it("keeps the local Vertex path behind an explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "local-project");
    vi.stubEnv("PEER_DIGEST_PROVIDER", "gemini");

    expect(canUseLocalServerProvider()).toBe(true);
    expect(resolveProvider(null, TEST_CTX)?.id).toBe("gemini");
    // The singleton, not the API-key factory: this is the Vertex path.
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("ignores GOOGLE_VERTEX_PROJECT in local dev without the opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "local-project");

    expect(resolveProvider(null, TEST_CTX)).toBeNull();
  });

  it("uses an explicit user key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "operator-project");

    expect(
      resolveProvider({ provider: "openai", apiKey: " user-key " }, TEST_CTX)
        ?.id,
    ).toBe("openai");
  });

  it("lets a user's own key beat the system key", () => {
    // ABC-freemium 1-12 — NEW. R-KEY-1 and R-KEY-2 both say BYOK wins; with the
    // system key now always present, this is the case that keeps it winning.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GOOGLE_API_KEY", SYSTEM_KEY);

    const provider = resolveProvider(
      { provider: "anthropic", apiKey: "USER-NOT-A-KEY" },
      TEST_CTX,
    );

    expect(provider?.id).toBe("anthropic");
    expect(mocks.createGeminiApiProvider).not.toHaveBeenCalled();
  });

  it("falls through to the system key when the override is unusable", () => {
    // B's adversarial case 2: an override with an invalid key does not resolve,
    // so the request falls through. Harmless only because the route
    // authenticated first (1-06) — asserted here so the fall-through is a
    // stated contract rather than an accident.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_API_KEY", SYSTEM_KEY);

    const provider = resolveProvider(
      { provider: "openai", apiKey: "   " },
      TEST_CTX,
    );

    expect(provider?.id).toBe("gemini");
    expect(mocks.createGeminiApiProvider).toHaveBeenCalledWith(SYSTEM_KEY);
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
