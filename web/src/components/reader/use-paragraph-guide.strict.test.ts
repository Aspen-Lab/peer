// P4-00c (§1h.11 (e), A's P3-06b O-1): `useParagraphGuide` sends ONE request on a hard load in
// development. React's dev StrictMode runs every effect, cleans it up and runs it again in the same
// tick; the hook's effect used to send its request in the first run (aborted by the clean-up, an
// `ERR_ABORTED` in the browser) and again in the second. `use-model-report.ts` lets the first tick
// pass and checks that the run is still wanted before it sends anything (`await Promise.resolve();
// if (!active()) return;`); this hook now does the same, so a run that is cleaned up in the tick it
// started in sends nothing.
//
// The project's Vitest has no DOM and no StrictMode, so the double run is made here, the way React
// makes it: the `useEffect` this file's `react` mock hands out runs the effect, then its clean-up,
// then the effect again, synchronously. `fetch` — the one network entry point the hook uses — is
// counted. No real model, no real network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ kind: "strict" as "strict" | "unmounted" | "plain" }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  const { hooks } = hookRuntime;
  return {
    ...actual,
    ...hooks,
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      return hooks.useEffect(() => {
        if (mode.kind === "plain") return effect();
        const first = effect();
        if (typeof first === "function") first();
        // StrictMode runs the effect again; an unmount in the same tick does not.
        return mode.kind === "strict" ? effect() : undefined;
      }, deps);
    },
  };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import type { Paper } from "@/types";
import type { ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { PARAGRAPH_GUIDE_STORAGE_KEY, useParagraphGuide } from "./use-paragraph-guide";
import { buildReadingKey } from "./use-reading";

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
  id: "openalex:W7000000004",
  title: "A Paper About Creep",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
const GISTS = { s1: { 0: "Blades slowly lose their shape under load." } };
const guide: ParagraphGuide = { docHash: "abc123", gists: GISTS };

interface Sent {
  url: string;
  signal: AbortSignal | undefined;
}
const sent: Sent[] = [];

/** One page open; `aborted` is whether each request's signal had been aborted by the time the page settled
 *  (before the unmount that ends the test, which aborts whatever is left). */
async function open() {
  const opened = await hookRuntime.mount(() => useParagraphGuide({ paper, hasBody: true, enabled: true }));
  const aborted = sent.map((request) => request.signal?.aborted);
  opened.unmount();
  return { gists: opened.value, aborted };
}

describe("useParagraphGuide under React's double effect (StrictMode, P4-00c)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T12:00:00.000Z"));
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    sent.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      sent.push({ url, signal: init?.signal ?? undefined });
      return new Response(JSON.stringify({ guide, cached: false }), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  afterEach(() => {
    mode.kind = "strict";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends one request when the effect runs, is cleaned up and runs again in the same tick", async () => {
    mode.kind = "strict";
    const { gists, aborted } = await open();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/papers/openalex%3AW7000000004/paragraph-guide");
    // The one request is the second run's: it was never aborted, and its answer is kept and returned.
    expect(aborted).toEqual([false]);
    expect(gists).toEqual(GISTS);
    expect(JSON.parse(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY) ?? "{}")).toHaveProperty(buildReadingKey(paper.id, undefined, undefined));
  });

  it("sends nothing from a run that was cleaned up in the tick it started in: mounted, then unmounted", async () => {
    mode.kind = "unmounted";
    const { gists } = await open();

    expect(sent).toHaveLength(0);
    expect(gists).toBeUndefined();
    expect(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY)).toBeNull();
  });

  it("is still one request, and the one it always was, with a single run", async () => {
    mode.kind = "plain";
    const { gists, aborted } = await open();

    expect(sent).toHaveLength(1);
    expect(aborted).toEqual([false]);
    expect(gists).toEqual(GISTS);
  });
});
