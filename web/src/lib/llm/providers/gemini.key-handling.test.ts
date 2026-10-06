import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";

// A reader's Gemini key must live exactly as long as their request. The
// privacy page says "The key is used for that request and is not stored", and
// that is only true if nothing in this module holds the key after the request:
// the first version of this provider kept every client it built in a module-level
// Map keyed by the raw key, never evicted, so every key a server instance had seen
// stayed in its memory for the instance's life (the branch review, finding SF-3).
//
// A separate file from `gemini.test.ts` on purpose: the stand-in for the SDK here
// records what it is constructed with, which that file's stand-in does not.

const sdk = vi.hoisted(() => ({
  /** The options of every client constructed, in order. */
  constructed: [] as unknown[],
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
    models = { generateContent: sdk.generateContent };
  },
}));

import { createGeminiApiProvider } from "./gemini";

// Invented strings. None of them is, or ever was, a key.
const KEY_A = "gemini-key-handling-FAKE-A-do-not-use";
const KEY_B = "gemini-key-handling-FAKE-B-do-not-use";

async function oneRequest(provider: ReturnType<typeof createGeminiApiProvider>): Promise<void> {
  await provider.generateJsonText!({ systemPrompt: "s", userPrompt: "u", maxTokens: 10 });
}

let quiet: ConsoleCapture;

beforeEach(() => {
  quiet = captureConsole(); // the provider's own [llm] and [gemini-api] lines
  sdk.constructed.length = 0;
  sdk.generateContent.mockReset();
  sdk.generateContent.mockResolvedValue({ text: '{"ok":true}' });
});

afterEach(() => {
  quiet.restore();
});

describe("createGeminiApiProvider — the reader's key is used for the request and kept by nothing", () => {
  it("builds a client for each call with the key it was given, and no other", async () => {
    const provider = createGeminiApiProvider(KEY_A);

    await oneRequest(provider);

    expect(sdk.constructed).toEqual([{ apiKey: KEY_A }]);
  });

  it("builds a new client for the next call: nothing is remembered between calls", async () => {
    const provider = createGeminiApiProvider(KEY_A);

    await oneRequest(provider);
    await oneRequest(provider);

    expect(sdk.constructed).toEqual([{ apiKey: KEY_A }, { apiKey: KEY_A }]);
  });

  it("a second provider with the same key does not get the first one's client", async () => {
    await oneRequest(createGeminiApiProvider(KEY_A));
    await oneRequest(createGeminiApiProvider(KEY_A));

    expect(sdk.constructed).toHaveLength(2);
  });

  it("two readers' keys never meet: each request is built with its own key", async () => {
    await oneRequest(createGeminiApiProvider(KEY_A));
    await oneRequest(createGeminiApiProvider(KEY_B));
    await oneRequest(createGeminiApiProvider(KEY_A));

    expect(sdk.constructed).toEqual([{ apiKey: KEY_A }, { apiKey: KEY_B }, { apiKey: KEY_A }]);
  });

  it("an empty key builds no client at all", async () => {
    const provider = createGeminiApiProvider("");

    await expect(oneRequest(provider)).rejects.toThrow();

    expect(sdk.constructed).toEqual([]);
  });
});

describe("gemini.ts — holds no module-level collection keyed by an API key (source scan)", () => {
  function codeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  /**
   * Names of module-level (column 0) `Map`, `WeakMap`, `Set` or `WeakSet`
   * declarations that are read or written with an argument naming an API key,
   * and any `[apiKey]` index expression (an object used as a cache).
   */
  function keyedCaches(source: string): string[] {
    const code = codeOf(source);
    const out: string[] = [];
    const declared = [...code.matchAll(/^(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*new\s+(?:Map|WeakMap|Set|WeakSet)\b/gm)].map(
      (match) => match[1],
    );
    for (const name of declared) {
      const use = new RegExp(`\\b${name}\\s*\\.\\s*(?:get|set|has|add|delete)\\s*\\(([^)]*)\\)`, "g");
      for (const match of code.matchAll(use)) {
        if (/api[_-]?key/i.test(match[1])) out.push(`${name}(${match[1].trim()})`);
      }
    }
    for (const match of code.matchAll(/\[\s*apiKey\s*\]/g)) out.push(match[0]);
    return out;
  }

  it("the matcher finds a keyed cache however it is spelled (tested on planted sources)", () => {
    expect(keyedCaches("const apiClients = new Map<string, X>();\nfunction f(apiKey: string) { return apiClients.get(apiKey); }")).toHaveLength(1);
    expect(keyedCaches("const seen = new Set<string>();\nseen.add(apiKey);")).toHaveLength(1);
    expect(keyedCaches("const byKey = new WeakMap<object, X>();\nbyKey.set(options.apiKey, client);")).toHaveLength(1);
    expect(keyedCaches("const cache: Record<string, X> = {};\ncache[apiKey] = client;")).toHaveLength(1);
    // A map keyed by something that is not a key, and a comment about the old one, are fine.
    expect(keyedCaches("const clients = new Map<string, X>();\nclients.get(location);")).toEqual([]);
    expect(keyedCaches("// const apiClients = new Map();\n/* apiClients.get(apiKey) */\nrun();")).toEqual([]);
  });

  it("the real module has none", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/llm/providers/gemini.ts"), "utf8");
    expect(keyedCaches(source)).toEqual([]);
  });
});
