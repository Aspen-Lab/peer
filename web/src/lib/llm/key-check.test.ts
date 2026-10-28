import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_CHECK_RESULTS, KEY_CHECK_TIMEOUT_MS, checkProviderKey, classifyKeyCheckError } from "./key-check";

// The error texts below are what each provider's `testConnection` returns as
// `error`: `String(err)` of what its call threw. The shapes are read off the code
// that throws them — `openai.ts`, `qwen.ts` and `deepseek.ts` build
// `${Name} API error ${status}: ${body}`; `@anthropic-ai/sdk` builds
// `${status} ${JSON body}` on an error named `Error`; `@google/genai` throws an
// `ApiError` whose message is the JSON body with a numeric `code`. The bodies are
// the providers' documented error bodies. Every key-like fragment is invented.

const OPENAI_401 =
  'Error: OpenAI API error 401: {"error":{"message":"Incorrect API key provided: sk-inv***********9999. You can find your API key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}';
const OPENAI_429 =
  'Error: OpenAI API error 429: {"error":{"message":"Rate limit reached for gpt-5.4-nano in organization org-invented on requests per min (RPM): Limit 3, Used 3, Requested 1.","type":"requests","param":null,"code":"rate_limit_exceeded"}}';
const OPENAI_404 =
  'Error: OpenAI API error 404: {"error":{"message":"The model `gpt-5.4-nano` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}}';
const OPENAI_500 = 'Error: OpenAI API error 500: {"error":{"message":"The server had an error while processing your request.","type":"server_error"}}';

const QWEN_401 =
  'Error: Qwen API error 401: {"error":{"message":"Incorrect API key provided. ","type":"invalid_request_error","param":null,"code":"invalid_api_key"},"request_id":"0a1b2c3d-invented"}';
const QWEN_429 =
  'Error: Qwen API error 429: {"error":{"message":"Requests rate limit exceeded, please try again later.","type":"limit_requests","param":null,"code":"limit_requests"}}';

const DEEPSEEK_401 =
  'Error: DeepSeek API error 401: {"error":{"message":"Authentication Fails, Your api key: ****9999 is invalid","type":"authentication_error","param":null,"code":"invalid_request_error"}}';
const DEEPSEEK_402 =
  'Error: DeepSeek API error 402: {"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}';
const DEEPSEEK_429 = "Error: DeepSeek API error 429: Rate Limit Reached";

const ANTHROPIC_401 =
  'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011invented"}';
const ANTHROPIC_403 =
  'Error: 403 {"type":"error","error":{"type":"permission_error","message":"Your API key does not have permission to use the specified resource."}}';
const ANTHROPIC_429 =
  'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit."}}';
const ANTHROPIC_529 = 'Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
const ANTHROPIC_CONNECTION = "Error: Connection error.";
const ANTHROPIC_TIMEOUT = "Error: Request timed out.";

const GEMINI_BAD_KEY =
  'ApiError: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]}}';
const GEMINI_EXPIRED =
  'ApiError: {"error":{"code":400,"message":"API key expired. Please renew the API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}';
const GEMINI_403 =
  'ApiError: {"error":{"code":403,"message":"Generative Language API has not been used in project 000000000000 before or it is disabled.","status":"PERMISSION_DENIED"}}';
const GEMINI_429 =
  'ApiError: {"error":{"code":429,"message":"Resource has been exhausted (e.g. check usage limits).","status":"RESOURCE_EXHAUSTED"}}';
const GEMINI_STREAM_429 = 'ApiError: got status: RESOURCE_EXHAUSTED. {"error":{"status":"RESOURCE_EXHAUSTED"}}';
const GEMINI_404 =
  'ApiError: {"error":{"code":404,"message":"models/gemini-3.1-flash-lite is not found for API version v1beta.","status":"NOT_FOUND"}}';
const GEMINI_LOCATION =
  'ApiError: {"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}';
const GEMINI_503 = 'ApiError: {"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}';
const FETCH_FAILED = "TypeError: fetch failed";
const ABORTED = "TimeoutError: The operation was aborted due to timeout";

describe("classifyKeyCheckError — each provider's refusal of a key is 'rejected'", () => {
  it.each([
    ["OpenAI 401 invalid_api_key", OPENAI_401],
    ["Qwen 401 invalid_api_key", QWEN_401],
    ["DeepSeek 401 Authentication Fails", DEEPSEEK_401],
    ["Anthropic 401 authentication_error", ANTHROPIC_401],
    ["Anthropic 403 permission_error", ANTHROPIC_403],
    ["Gemini 400 API_KEY_INVALID (Gemini's answer to a key it does not know)", GEMINI_BAD_KEY],
    ["Gemini 400 API key expired", GEMINI_EXPIRED],
    ["Gemini 403 PERMISSION_DENIED", GEMINI_403],
    ["a bare 401", "401 Unauthorized"],
  ])("%s", (_name, text) => {
    expect(classifyKeyCheckError(text)).toBe("rejected");
  });
});

describe("classifyKeyCheckError — a provider turning requests away for now is 'busy'", () => {
  it.each([
    ["OpenAI 429", OPENAI_429],
    ["Qwen 429", QWEN_429],
    ["DeepSeek 429", DEEPSEEK_429],
    ["Anthropic 429 rate_limit_error", ANTHROPIC_429],
    ["Gemini 429 RESOURCE_EXHAUSTED", GEMINI_429],
    ["Gemini's streamed error, no numeric status", GEMINI_STREAM_429],
    ["a bare 429", "429 Too Many Requests"],
  ])("%s", (_name, text) => {
    expect(classifyKeyCheckError(text)).toBe("busy");
  });
});

describe("classifyKeyCheckError — everything else is 'unreachable'", () => {
  it.each([
    ["OpenAI 404 model_not_found", OPENAI_404],
    ["OpenAI 500", OPENAI_500],
    ["DeepSeek 402 Insufficient Balance", DEEPSEEK_402],
    ["Anthropic 529 overloaded", ANTHROPIC_529],
    ["Anthropic connection error", ANTHROPIC_CONNECTION],
    ["Anthropic request timed out", ANTHROPIC_TIMEOUT],
    ["Gemini 404 model not found", GEMINI_404],
    ["Gemini 400 location not supported", GEMINI_LOCATION],
    ["Gemini 503 overloaded", GEMINI_503],
    ["a network failure", FETCH_FAILED],
    ["an aborted fetch", ABORTED],
    ["an empty string", ""],
  ])("%s", (_name, text) => {
    expect(classifyKeyCheckError(text)).toBe("unreachable");
  });

  it("is 'unreachable' for no text at all, or a value that is not text", () => {
    expect(classifyKeyCheckError(undefined)).toBe("unreachable");
    expect(classifyKeyCheckError(null)).toBe("unreachable");
    expect(classifyKeyCheckError(401)).toBe("unreachable");
    expect(classifyKeyCheckError({ status: 401 })).toBe("unreachable");
  });

  it("does not read a 401 out of a number that is only part of a word", () => {
    expect(classifyKeyCheckError('Error: OpenAI API error 500: {"id":"req401abc"}')).toBe("unreachable");
  });
});

describe("checkProviderKey — one testConnection, answered with a word", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const SENTINEL = "SENTINEL-XYZ-provider-text";

  it("answers 'ok' when the provider accepts", async () => {
    expect(await checkProviderKey({ testConnection: async () => ({ ok: true }) })).toBe("ok");
  });

  it("answers the classified word, and only the word, when the provider refuses", async () => {
    const result = await checkProviderKey({
      testConnection: async () => ({ ok: false, error: `401 Unauthorized ${SENTINEL}` }),
    });
    expect(result).toBe("rejected");
    expect(KEY_CHECK_RESULTS).toContain(result);
  });

  it("answers 'unreachable' when testConnection throws, without throwing itself", async () => {
    const result = await checkProviderKey({
      testConnection: async () => {
        throw new Error(`401 ${SENTINEL}`);
      },
    });
    expect(result).toBe("unreachable");
  });

  it("answers 'unreachable' for an answer of an unexpected shape", async () => {
    expect(
      await checkProviderKey({ testConnection: async () => null as unknown as { ok: boolean } }),
    ).toBe("unreachable");
    expect(
      await checkProviderKey({ testConnection: async () => ({ ok: "yes" }) as unknown as { ok: boolean } }),
    ).toBe("unreachable");
  });

  it("answers 'unreachable' when the provider takes longer than the time limit, which is 15 seconds", async () => {
    expect(KEY_CHECK_TIMEOUT_MS).toBe(15_000);
    vi.useFakeTimers();
    const pending = checkProviderKey({ testConnection: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS);
    expect(await pending).toBe("unreachable");
  });

  it("answers a provider that replies just inside the limit", async () => {
    vi.useFakeTimers();
    const pending = checkProviderKey({
      testConnection: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), KEY_CHECK_TIMEOUT_MS - 1)),
    });
    await vi.advanceTimersByTimeAsync(KEY_CHECK_TIMEOUT_MS);
    expect(await pending).toBe("ok");
  });

  it("leaves no timer behind once it has answered", async () => {
    vi.useFakeTimers();
    await checkProviderKey({ testConnection: async () => ({ ok: true }) });
    expect(vi.getTimerCount()).toBe(0);
  });
});
