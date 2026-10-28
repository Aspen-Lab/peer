import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";
import {
  USER_SENTINEL,
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { KEY_CHECK_TIMEOUT_MS } from "@/lib/llm/key-check";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveProvider: vi.fn(),
  realResolveProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

// `resolveProvider` is a spy so a case can hand the route a stub provider and read
// exactly what the route asked the registry for. `hasUsableProviderOverride` stays
// real: the route's 400s are the registry's own rule. The real resolver is kept for
// the one case that builds a real provider (with `fetch` stubbed).
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  mocks.realResolveProvider.mockImplementation(actual.resolveProvider);
  return { ...actual, resolveProvider: mocks.resolveProvider };
});

import { POST } from "./route";

/** Words that must never come back: the stub providers put them in their error text. */
const SENTINEL = "SENTINEL-XYZ";

function stubProvider(testConnection: () => Promise<{ ok: boolean; error?: string }>) {
  return { id: "openai", generateDigest: vi.fn(), testConnection: vi.fn(testConnection) };
}

function checkRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/check-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { provider: "openai", apiKey: USER_SENTINEL };

describe("POST /api/ai/check-key", () => {
  let quiet: ConsoleCapture;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    deleteSpendableKeys();
    deployedRuntimeEnv(vi.stubEnv);
    resetCounterStoreForTests();
    quiet = captureConsole();
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    mocks.resolveProvider.mockReturnValue(stubProvider(async () => ({ ok: true })));
    // No case here may reach the network.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    quiet.restore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetCounterStoreForTests();
    vi.restoreAllMocks();
  });

  describe("the gate comes first", () => {
    it("answers a signed-out visitor 401 before any provider is resolved, and marks it no-store", async () => {
      mocks.getUser.mockResolvedValue(signedOut());

      const response = await POST(checkRequest(VALID));

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("answers the signed-out visitor 401 even when the body is not JSON", async () => {
      mocks.getUser.mockResolvedValue(signedOut());

      expect((await POST(checkRequest("{not json"))).status).toBe(401);
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
    });

    it("answers the 11th check of the hour 429, with no-store, without resolving a provider", async () => {
      // One clock hour for the whole case: the count is kept per UTC hour.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-28T09:20:00.000Z"));
      for (let i = 0; i < 10; i += 1) {
        expect((await POST(checkRequest(VALID))).status).toBe(200);
      }
      expect(mocks.resolveProvider).toHaveBeenCalledTimes(10);

      const over = await POST(checkRequest(VALID));

      expect(over.status).toBe(429);
      expect(over.headers.get("cache-control")).toBe("no-store");
      // The rest of the hour, in seconds.
      expect(over.headers.get("retry-after")).toBe("2400");
      expect(mocks.resolveProvider).toHaveBeenCalledTimes(10);
    });
  });

  describe("a request without a usable key is 400, and nothing is resolved", () => {
    it.each([
      ["no body fields", {}],
      ["no key", { provider: "openai" }],
      ["a blank key", { provider: "openai", apiKey: "   " }],
      ["a key that is not text", { provider: "openai", apiKey: 12345 }],
      ["no provider", { apiKey: USER_SENTINEL }],
      ["the no-model choice", { provider: "default", apiKey: USER_SENTINEL }],
      ["a provider Peer does not offer", { provider: "ollama", apiKey: USER_SENTINEL }],
      ["a key too long to be one", { provider: "openai", apiKey: "k".repeat(4097) }],
      ["a body that is not an object", ["openai", USER_SENTINEL]],
      ["a body that is null", null],
    ])("%s", async (_name, body) => {
      const response = await POST(checkRequest(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
    });

    it("a body that is not JSON", async () => {
      const response = await POST(checkRequest("{not json"));

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
    });

    it("a provider the registry cannot build", async () => {
      mocks.resolveProvider.mockReturnValue(null);

      const response = await POST(checkRequest(VALID));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });

  describe("only the request's key reaches the registry", () => {
    it("hands the registry the provider and key from the request, and no other field", async () => {
      await POST(
        checkRequest({ ...VALID, model: "a-model-the-check-ignores", llmOverride: { provider: "gemini", apiKey: "OTHER" } }),
      );

      expect(mocks.resolveProvider).toHaveBeenCalledTimes(1);
      expect(mocks.resolveProvider.mock.calls[0]).toEqual([{ provider: "openai", apiKey: USER_SENTINEL }]);
    });

    it("asks the provider for exactly one check", async () => {
      const provider = stubProvider(async () => ({ ok: true }));
      mocks.resolveProvider.mockReturnValue(provider);

      await POST(checkRequest(VALID));

      expect(provider.testConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe("the answer is one word, never the provider's text", () => {
    async function answer(testConnection: () => Promise<{ ok: boolean; error?: string }>) {
      mocks.resolveProvider.mockReturnValue(stubProvider(testConnection));
      const response = await POST(checkRequest(VALID));
      const text = await response.text();
      return { response, text, body: JSON.parse(text) as unknown };
    }

    it("ok", async () => {
      const { response, body } = await answer(async () => ({ ok: true }));

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: "ok" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("rejected, for a 401, and the body does not carry the provider's words", async () => {
      const { response, text, body } = await answer(async () => ({ ok: false, error: `401 Unauthorized ${SENTINEL}` }));

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: "rejected" });
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain("Unauthorized");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("busy, for a 429", async () => {
      const { text, body } = await answer(async () => ({ ok: false, error: `429 Too Many Requests ${SENTINEL}` }));

      expect(body).toEqual({ result: "busy" });
      expect(text).not.toContain(SENTINEL);
    });

    it("unreachable, for any other failure", async () => {
      const { text, body } = await answer(async () => ({ ok: false, error: `500 Internal Server Error ${SENTINEL}` }));

      expect(body).toEqual({ result: "unreachable" });
      expect(text).not.toContain(SENTINEL);
    });

    it("unreachable, when the check throws", async () => {
      const { response, text, body } = await answer(async () => {
        throw new Error(`401 ${SENTINEL}`);
      });

      expect(response.status).toBe(200);
      expect(body).toEqual({ result: "unreachable" });
      expect(text).not.toContain(SENTINEL);
    });

    it("unreachable, when the provider takes longer than the time limit", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      mocks.resolveProvider.mockReturnValue(stubProvider(() => new Promise(() => {})));

      const pending = POST(checkRequest(VALID));
      await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS);
      const response = await pending;

      expect(await response.json()).toEqual({ result: "unreachable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("writes no log line of its own, whatever the provider answers", async () => {
      await answer(async () => ({ ok: false, error: `401 ${SENTINEL}` }));
      await answer(async () => {
        throw new Error(SENTINEL);
      });

      expect(quiet.calls()).toBe(0);
    });
  });

  describe("through the real registry, with the network stubbed", () => {
    it("sends the reader's key to the provider they chose, once, and answers 'rejected' without echoing it", async () => {
      mocks.resolveProvider.mockImplementation(mocks.realResolveProvider);
      // OpenAI's real 401 body quotes part of the key it refused.
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: `Incorrect API key provided: ${USER_SENTINEL}.`, type: "invalid_request_error", code: "invalid_api_key" },
          }),
          { status: 401 },
        ),
      );

      const response = await POST(checkRequest(VALID));
      const text = await response.text();

      expect(JSON.parse(text)).toEqual({ result: "rejected" });
      expect(text).not.toContain(USER_SENTINEL);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_SENTINEL}`);
      // The provider's own usage line names the model and the outcome, never the key.
      expect(quiet.text()).not.toContain(USER_SENTINEL);
    });
  });
});
