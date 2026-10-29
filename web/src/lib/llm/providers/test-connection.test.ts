import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";

// Every provider's `testConnection`, as "Check key" (`app/api/ai/check-key`) runs it on a
// reader's own key: one request, one usage line, an empty answer counted as accepted, and
// the provider's refusal handed back as text for the classifier (`lib/llm/key-check.ts`).
// No case reaches the network: `fetch` is stubbed and both SDKs are replaced.

const sdk = vi.hoisted(() => ({
  anthropicConstructed: [] as unknown[],
  anthropicCreate: vi.fn(),
  geminiConstructed: [] as unknown[],
  geminiGenerate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) {
      sdk.anthropicConstructed.push(options);
    }
    messages = { create: sdk.anthropicCreate };
  },
}));

vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    constructor(options: unknown) {
      sdk.geminiConstructed.push(options);
    }
    models = { generateContent: sdk.geminiGenerate };
  },
}));

import { createAnthropicProvider } from "./anthropic";
import { createDeepseekProvider } from "./deepseek";
import { createGeminiApiProvider } from "./gemini";
import { createOpenAIProvider } from "./openai";
import { createQwenProvider } from "./qwen";

// An invented string. It is not, and never was, a key.
const KEY = "test-connection-sentinel-NOT-A-KEY-0000";

let quiet: ConsoleCapture;
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** The `[llm]` usage lines written so far. */
function usageLines(): string[] {
  return quiet
    .text()
    .split("\n")
    .filter((line) => line.startsWith("[llm]"));
}

function chatReply(content: string | null, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 7, completion_tokens: 1 } }),
    { status },
  );
}

beforeEach(() => {
  quiet = captureConsole();
  sdk.anthropicConstructed.length = 0;
  sdk.anthropicCreate.mockReset();
  sdk.geminiConstructed.length = 0;
  sdk.geminiGenerate.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  quiet.restore();
  vi.restoreAllMocks();
});

const FETCH_PROVIDERS = [
  { name: "OpenAI", create: () => createOpenAIProvider(KEY), url: "https://api.openai.com/v1/chat/completions" },
  { name: "Qwen", create: () => createQwenProvider(KEY), url: "dashscope" },
  { name: "DeepSeek", create: () => createDeepseekProvider(KEY), url: "https://api.deepseek.com/chat/completions" },
] as const;

describe.each(FETCH_PROVIDERS)("$name testConnection (plain fetch)", ({ name, create, url }) => {
  it("sends one request, on the reader's key, and writes one usage line that does not name the key", async () => {
    fetchSpy.mockResolvedValueOnce(chatReply('{"pong":true}'));

    expect(await create().testConnection()).toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [address, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(address).toContain(url);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body)) as { max_tokens?: number; max_completion_tokens?: number };
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(32);
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/ ok$/);
    expect(quiet.text()).not.toContain(KEY);
  });

  it("counts an accepted request with an empty answer as ok: the key works", async () => {
    fetchSpy.mockResolvedValueOnce(chatReply(""));
    expect(await create().testConnection()).toEqual({ ok: true });

    fetchSpy.mockResolvedValueOnce(chatReply(null));
    expect(await create().testConnection()).toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("hands a refusal back as the provider's text, after one request and one usage line", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":{"message":"Incorrect API key provided.","code":"invalid_api_key"}}', { status: 401 }),
    );

    const result = await create().testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toContain(`${name} API error 401`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/ ERR$/);
  });

  it("leaves every other call as it was: an empty answer to a JSON call still throws the same Error", async () => {
    fetchSpy.mockResolvedValueOnce(chatReply(""));

    const thrown = await create()
      .generateJsonText!({ systemPrompt: "s", userPrompt: "u" })
      .then(() => null, (err: unknown) => err);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Error");
    expect(String(thrown)).toBe(`Error: ${name} returned empty content`);
  });
});

describe("Anthropic testConnection (SDK)", () => {
  it("sends one request with the SDK's retries turned off, and writes one usage line under path test", async () => {
    sdk.anthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "pong" }],
      usage: { input_tokens: 8, output_tokens: 1 },
    });

    expect(await createAnthropicProvider(KEY).testConnection()).toEqual({ ok: true });

    expect(sdk.anthropicCreate).toHaveBeenCalledTimes(1);
    const [params, options] = sdk.anthropicCreate.mock.calls[0] as [{ max_tokens: number }, { maxRetries?: number }];
    expect(params.max_tokens).toBe(10);
    expect(options).toEqual({ maxRetries: 0 });
    expect(sdk.anthropicConstructed).toEqual([expect.objectContaining({ apiKey: KEY })]);
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/^\[llm\] anthropic\/\S+ path=test in=8 out=1 \d+ms ok$/);
    expect(quiet.text()).not.toContain(KEY);
  });

  it("hands a refusal back as text and still writes its one usage line", async () => {
    sdk.anthropicCreate.mockRejectedValueOnce(
      new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
    );

    const result = await createAnthropicProvider(KEY).testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Error: 401 /);
    expect(sdk.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/path=test \d+ms ERR$/);
  });

  it("keeps the retries on every other call: only the check passes request options", async () => {
    sdk.anthropicCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "{}" }], usage: {} });

    await createAnthropicProvider(KEY).generateJsonText!({ systemPrompt: "s", userPrompt: "u" });

    expect(sdk.anthropicCreate.mock.calls[0]).toHaveLength(1);
  });
});

describe("Gemini (reader's key) testConnection (SDK)", () => {
  it("sends one request, with no retry options anywhere, and writes one usage line under path test", async () => {
    sdk.geminiGenerate.mockResolvedValueOnce({ text: '{"pong":true}', usageMetadata: { promptTokenCount: 5 } });

    expect(await createGeminiApiProvider(KEY).testConnection()).toEqual({ ok: true });

    expect(sdk.geminiGenerate).toHaveBeenCalledTimes(1);
    // @google/genai retries only when the client is built with `httpOptions.retryOptions`.
    expect(sdk.geminiConstructed).toEqual([{ apiKey: KEY }]);
    const [args] = sdk.geminiGenerate.mock.calls[0] as [{ config: { httpOptions?: Record<string, unknown> } }];
    expect(args.config.httpOptions).not.toHaveProperty("retryOptions");
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/^\[llm\] gemini\/\S+ path=test in=5 \d+ms ok$/);
    expect(quiet.text()).not.toContain(KEY);
  });

  it("counts an accepted request with an empty answer as ok", async () => {
    sdk.geminiGenerate.mockResolvedValueOnce({ text: "" });
    expect(await createGeminiApiProvider(KEY).testConnection()).toEqual({ ok: true });
  });

  it("hands a refusal back as text, after one request and one usage line", async () => {
    sdk.geminiGenerate.mockRejectedValueOnce(new Error('{"error":{"code":400,"message":"API key not valid."}}'));

    const result = await createGeminiApiProvider(KEY).testConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("API key not valid");
    expect(sdk.geminiGenerate).toHaveBeenCalledTimes(1);
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]).toMatch(/ ERR$/);
  });
});
