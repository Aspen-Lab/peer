// P10-40 (BACKLOG-04): a double effect — React StrictMode in dev, or a key that changes in the first tick —
// must start one reading fetch, not one that is aborted before the server sees it and one that is kept.
// `use-model-report.ts` has the guard (`await Promise.resolve(); if (!active()) return;`); `useReading`'s
// effect did not. Here every effect runs the way StrictMode runs it: effect, its cleanup, effect again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  const strict = (effect: () => void | (() => void), deps?: readonly unknown[]) =>
    hookRuntime.hooks.useEffect(() => {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanup();
      return effect();
    }, deps);
  return { ...actual, ...hookRuntime.hooks, useEffect: strict };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { buildReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { useReading } from "./use-reading";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

const paper: Paper = {
  id: "openalex:W7000000040",
  title: "A Paper Opened Twice By Strict Mode",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};

const started: Array<{ url: string; signal: AbortSignal | undefined }> = [];

describe("useReading — one fetch per mount under a double effect (P10-40, BACKLOG-04)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    started.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      started.push({ url, signal: init?.signal ?? undefined });
      return new Response(JSON.stringify(buildReading(paper, null)), {
        headers: { "cache-control": "public, s-maxage=86400" },
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("a public paper: the effect run twice starts one request, and it is not aborted", async () => {
    const opened = await hookRuntime.mount(() => useReading(paper));

    expect(started).toHaveLength(1);
    expect(started[0].signal?.aborted).toBe(false);
    expect(opened.value.fromServer).toBe(true);
    opened.unmount();
  });

  it("a private attachment: the same", async () => {
    const attached: Paper = { ...paper, fullTextUploadId: "upload:0123456789abcdef", revision: 1 };
    const opened = await hookRuntime.mount(() => useReading(attached));

    expect(started).toHaveLength(1);
    expect(started[0].url).toContain("&upload=upload%3A0123456789abcdef");
    expect(started[0].signal?.aborted).toBe(false);
    opened.unmount();
  });
});
