// P4-00c (as `use-paragraph-guide.strict.test.ts`) for P12-53: `useStructureReview` sends ONE request on a hard load
// in development. React's dev StrictMode runs every effect, cleans it up and runs it again in the same tick; the
// hook lets the first tick pass and checks that the run is still wanted before it sends anything, so a run that is
// cleaned up in the tick it started in sends nothing.
//
// The project's Vitest has no DOM and no StrictMode, so the double run is made here, the way React makes it: the
// `useEffect` this file's `react` mock hands out runs the effect, then its clean-up, then the effect again,
// synchronously. `fetch` — the one network entry point the hook uses — is counted. No real model, no real network.
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
import { REVIEW_PROMPT_VERSION, SKELETON_VERSION, STRUCTURE_RULES_VERSION, type StructureReviewEntry } from "@/lib/papers/structure-review";
import { STRUCTURE_REVIEW_STORAGE_KEY, useStructureReview } from "./use-structure-review";
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
  id: "openalex:W7000000014",
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
const review: StructureReviewEntry = {
  v: 1,
  docHash: "1abc",
  rulesVersion: STRUCTURE_RULES_VERSION,
  skeletonVersion: SKELETON_VERSION,
  promptVersion: REVIEW_PROMPT_VERSION,
  draftDigest: "0123456789abcd",
  corrections: [{ op: "set_role", part: 1, role: "method" }],
  unsure: [],
  secondLooks: [],
  model: "gemini/large",
  reviewedAt: 1,
};

interface Sent {
  url: string;
  signal: AbortSignal | undefined;
}
const sent: Sent[] = [];

/** One page open; `aborted` is whether each request's signal had been aborted by the time the page settled. */
async function open() {
  const opened = await hookRuntime.mount(() => useStructureReview({ paper, hasBody: true, draftDigest: review.draftDigest, enabled: true }));
  const aborted = sent.map((request) => request.signal?.aborted);
  opened.unmount();
  return { view: opened.value, aborted };
}

describe("useStructureReview under React's double effect (StrictMode, P4-00c)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    sent.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      sent.push({ url, signal: init?.signal ?? undefined });
      return new Response(JSON.stringify({ review, cached: false }), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  afterEach(() => {
    mode.kind = "strict";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends one request when the effect runs, is cleaned up and runs again in the same tick", async () => {
    mode.kind = "strict";
    const { view, aborted } = await open();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/papers/openalex%3AW7000000014/structure");
    // The one request is the second run's: it was never aborted, and its answer is kept and returned.
    expect(aborted).toEqual([false]);
    expect(view).toEqual(review);
    expect(JSON.parse(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY) ?? "{}")).toHaveProperty(buildReadingKey(paper.id, undefined, undefined));
  });

  it("sends nothing from a run that was cleaned up in the tick it started in: mounted, then unmounted", async () => {
    mode.kind = "unmounted";
    const { view } = await open();

    expect(sent).toHaveLength(0);
    expect(view).toBeUndefined();
    expect(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY)).toBeNull();
  });

  it("is still one request, and the one it always was, with a single run", async () => {
    mode.kind = "plain";
    const { view, aborted } = await open();

    expect(sent).toHaveLength(1);
    expect(aborted).toEqual([false]);
    expect(view).toEqual(review);
  });
});
