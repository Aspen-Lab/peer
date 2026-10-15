import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P5-06 item 1 (§1h.19 (a)): no provider logs an error whole. The SDK builds an
// error's message from the response body, and a provider whose body echoes its
// input would put the prompt's start — the task text, an upload's title, the
// reader's own brief — into a server log line. A Gemini provider swallows the
// error after logging it (the caller gets a generic "returned empty response"),
// so a route's own kind-only catch never sees it: these lines are the only place
// the rule can hold. Every path that logs a caught error is driven here with a
// stood-in SDK — the reader's-key provider and the server's Vertex provider, for
// the digest, the JSON call and the vision call — and no model is called.
const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { ApiError } from "@google/genai";
import { inspect } from "node:util";
import { createGeminiApiProvider, geminiProvider } from "./gemini";
import type { DigestProvider, VisionImageInput } from "./types";

// Invented. Not a title, a brief or a key that anyone has.
const MARKER = "Quillfeather-Tarn-marker";
const PROMPT = `Task: read the paper called ${MARKER} and say what it claims.`;
const API_KEY = "gemini-logs-test-FAKE-do-not-use";

type Call = { method: "log" | "info" | "debug" | "warn" | "error"; args: unknown[] };
const calls: Call[] = [];

function watchConsole(): void {
  calls.length = 0;
  for (const method of ["log", "info", "debug", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, args });
    });
  }
}

/** One console argument as text, objects and errors in depth (their message and stack included). */
function render(argument: unknown): string {
  return typeof argument === "string" ? argument : inspect(argument, { depth: 10, breakLength: Infinity });
}

/** The provider's own failure lines: the `warn`s, one per model tried. */
function failureLines(): string[] {
  return calls.filter((c) => c.method === "warn").map((c) => c.args.map(render).join(" "));
}

beforeEach(() => {
  generateContentMock.mockReset();
  watchConsole();
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", "not-a-real-project");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** What the SDK throws on a 400 whose body quotes the request. */
function echoing400(): Error {
  return new ApiError({ message: `{"error":{"code":400,"message":"Bad request: ${PROMPT}"}}`, status: 400 });
}

const ONE_MODEL = [{ id: "gemini-3.1-flash-lite", location: "global" as const, tier: "small" as const }];

const IMAGE: VisionImageInput = { dataBase64: "AAAA", mimeType: "image/png" };

type Path = {
  label: string;
  /** A provider and the call that reaches the line under test. */
  run: () => Promise<unknown>;
  /** The line's bracketed label. */
  prefix: string;
};

function paths(): Path[] {
  const api: DigestProvider = createGeminiApiProvider(API_KEY, ONE_MODEL);
  return [
    {
      label: "the reader's key — the JSON call (every report, explain, guide and figure prompt)",
      run: () => api.generateJsonText!({ systemPrompt: "s", userPrompt: PROMPT, maxTokens: 10 }),
      prefix: "[gemini-api]",
    },
    {
      label: "the reader's key — the digest",
      run: () => api.generateDigest({ papers: [], contextHint: PROMPT }),
      prefix: "[gemini-api]",
    },
    {
      label: "the reader's key — the vision call",
      run: () =>
        api.generateVisionJsonText!({ systemPrompt: "s", userPrompt: PROMPT, images: [IMAGE], maxTokens: 10 }),
      prefix: "[gemini-api-vision]",
    },
    {
      label: "the server's Vertex provider — the JSON call",
      run: () => geminiProvider.generateJsonText!({ systemPrompt: "s", userPrompt: PROMPT, maxTokens: 10 }),
      prefix: "[gemini]",
    },
    {
      label: "the server's Vertex provider — the digest",
      run: () => geminiProvider.generateDigest({ papers: [], contextHint: PROMPT }),
      prefix: "[gemini]",
    },
    {
      label: "the server's Vertex provider — the vision call",
      run: () =>
        geminiProvider.generateVisionJsonText!({
          systemPrompt: "s",
          userPrompt: PROMPT,
          images: [IMAGE],
          maxTokens: 10,
        }),
      prefix: "[gemini-vision]",
    },
  ];
}

describe("P5-06 — a Gemini provider's failure line says the kind and the status, never the error", () => {
  for (const path of paths().map((p) => p.label)) {
    describe(path, () => {
      const pick = (): Path => paths().find((p) => p.label === path)!;

      it("an Error whose body quotes the prompt and carries status 400: the line holds ApiError and 400, no argument holds the prompt", async () => {
        generateContentMock.mockRejectedValue(echoing400());
        const { run, prefix } = pick();

        await expect(run()).rejects.toThrow(/returned empty response|vision calls returned empty response/);

        const lines = failureLines();
        // One line per model tried, and the SDK was asked each time.
        expect(lines.length).toBe(generateContentMock.mock.calls.length);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line).toContain(prefix);
          expect(line).toContain("ApiError");
          expect(line).toContain("400");
        }
        // The premise: the SDK's error did hold the marker, so a log of it would have.
        expect(echoing400().message).toContain(MARKER);
        // No console method got an argument that holds it, an error object included.
        for (const call of calls) {
          for (const argument of call.args) {
            expect(render(argument)).not.toContain(MARKER);
            expect(argument).not.toBeInstanceOf(Error);
          }
        }
      });

      it("a thrown string that quotes the prompt: the line holds the type, not the text", async () => {
        generateContentMock.mockRejectedValue(`upstream said: ${PROMPT}`);
        const { run, prefix } = pick();

        await expect(run()).rejects.toThrow();

        const lines = failureLines();
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line).toContain(prefix);
          expect(line).toContain("string");
        }
        for (const call of calls) {
          for (const argument of call.args) expect(render(argument)).not.toContain(MARKER);
        }
      });

      it("an Error with no status: the line holds the kind and no number", async () => {
        generateContentMock.mockRejectedValue(new TypeError(`fetch failed for ${PROMPT}`));
        const { run } = pick();

        await expect(run()).rejects.toThrow();

        for (const line of failureLines()) {
          expect(line).toMatch(/failed: TypeError$/);
        }
        for (const call of calls) {
          for (const argument of call.args) expect(render(argument)).not.toContain(MARKER);
        }
      });
    });
  }

  it("what the caller gets is what it always got: a generic error that names no input", async () => {
    generateContentMock.mockRejectedValue(echoing400());
    const api = createGeminiApiProvider(API_KEY, ONE_MODEL);

    const failure = await api
      .generateJsonText!({ systemPrompt: "s", userPrompt: PROMPT, maxTokens: 10 })
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("All Gemini API models returned empty response");
  });
});
