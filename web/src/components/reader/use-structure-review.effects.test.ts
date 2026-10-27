// P12-53 (ruling §1h.428; B P12-42 §4): `useStructureReview` with its effects running — the page's one request for
// the model's review of the rules' structure, made once per paper when there is a body, a draft and a model to ask,
// kept in this browser for 30 days (a failure for an hour), never made twice, and dropped with the page. Without a
// model the hook returns nothing and sends nothing: the map is Tier 0's.
//
// The pattern of `use-paragraph-guide.effects.test.ts`: the hook runs on `test-support/hook-runtime` (the project's
// Vitest has no DOM) and `fetch` — the one network entry point the hook uses — is counted. No real model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import type { Paper } from "@/types";
import { REVIEW_PROMPT_VERSION, SKELETON_VERSION, STRUCTURE_RULES_VERSION, type StructureReviewEntry } from "@/lib/papers/structure-review";
import { buildReadingKey } from "./use-reading";
import {
  ANSWER_TTL_MS,
  FAILURE_TTL_MS,
  STRUCTURE_REVIEW_STORAGE_KEY,
  keptStructureReview,
  rememberStructureReview,
  useStructureReview,
} from "./use-structure-review";

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

const base: Paper = {
  id: "openalex:W7000000013",
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
const attached: Paper = { ...base, fullTextUploadId: "upload:0123456789abcdef", revision: 1 };
const standalone: Paper = { ...base, id: "upload:fedcba9876543210", revision: 1 };

const DIGEST = "0123456789abcd";
const review: StructureReviewEntry = {
  v: 1,
  docHash: "1abc",
  rulesVersion: STRUCTURE_RULES_VERSION,
  skeletonVersion: SKELETON_VERSION,
  promptVersion: REVIEW_PROMPT_VERSION,
  draftDigest: DIGEST,
  corrections: [{ op: "set_role", part: 1, role: "method" }],
  unsure: [],
  secondLooks: [],
  model: "gemini/large",
  reviewedAt: 1,
};
const KEY = buildReadingKey(base.id, undefined, undefined);

interface Sent {
  url: string;
  method: string | undefined;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
const sent: Sent[] = [];
/** What the next request answers; a function lets a test hold it open. */
let answer: () => Promise<Response> = async () => json({ review, cached: false });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, signal: init?.signal ?? undefined });
    return answer();
  });
}

type Args = Parameters<typeof useStructureReview>[0];
const defaults = (paper: Paper): Args => ({ paper, hasBody: true, draftDigest: DIGEST, enabled: true });

async function open(paper: Paper, over: Partial<Args> = {}) {
  const opened = await hookRuntime.mount(() => useStructureReview({ ...defaults(paper), ...over }));
  opened.unmount();
  return opened.value;
}

describe("useStructureReview with effects running — the model's review, asked for once", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    sent.length = 0;
    answer = async () => json({ review, cached: false });
    stubFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks once for a paper with a body, a draft and a model, and returns the review", async () => {
    const got = await open(base);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/papers/openalex%3AW7000000013/structure");
    expect(sent[0].method).toBe("POST");
    expect(got).toEqual(review);
  });

  it("asks nothing the second time the paper is opened: the review is kept in this browser", async () => {
    await open(base);
    const second = await open(base);

    expect(sent).toHaveLength(1);
    expect(second).toEqual(review);
    const kept = JSON.parse(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(kept)).toEqual([KEY]);
    expect(STRUCTURE_REVIEW_STORAGE_KEY).toBe("peer-structure-review-v1");
  });

  it("sends the paper and, when the reader has one, their own key — and nothing else about them", async () => {
    await open(base, { llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });

    expect(Object.keys(sent[0].body).sort()).toEqual(["llmOverride", "paper"]);
    expect((sent[0].body.paper as Paper).id).toBe(base.id);
    expect(sent[0].body.llmOverride).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
    await open({ ...base, id: "openalex:W7000000014" });
    expect(Object.keys(sent[1].body)).toEqual(["paper"]);
  });

  it("is not asked for without a model, a body, a draft or a paper — and the moment all four are there, it is", async () => {
    expect(await open(base, { enabled: false })).toBeUndefined();
    expect(await open(base, { hasBody: false })).toBeUndefined();
    expect(await open(base, { draftDigest: undefined })).toBeUndefined();
    const none = await hookRuntime.mount(() => useStructureReview({ paper: undefined, hasBody: true, draftDigest: DIGEST, enabled: true }));
    none.unmount();

    expect(none.value).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY)).toBeNull();
    await open(base);
    expect(sent).toHaveLength(1);
  });

  it("changes nothing without a model, even for a paper whose review is kept: no request, no review", async () => {
    await open(base);
    sent.length = 0;

    expect(await open(base, { enabled: false })).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(await open(base)).toEqual(review);
  });

  it("keeps one review per paper and per upload revision: a new revision asks again", async () => {
    await open(attached);
    await open(attached);
    expect(sent).toHaveLength(1);

    await open({ ...attached, revision: 2 });
    expect(sent).toHaveLength(2);
    await open(standalone);
    expect(sent).toHaveLength(3);
    expect(sent[2].url).toBe("/api/papers/upload%3Afedcba9876543210/structure");
    await open(standalone);
    expect(sent).toHaveLength(3);
  });

  it("keeps an answer for 30 days, and asks again after them", async () => {
    await open(base);
    vi.setSystemTime(new Date(Date.parse("2026-10-27T12:00:00.000Z") + ANSWER_TTL_MS - 60_000));
    expect(await open(base)).toEqual(review);
    expect(sent).toHaveLength(1);

    vi.setSystemTime(new Date(Date.parse("2026-10-27T12:00:00.000Z") + ANSWER_TTL_MS + 60_000));
    await open(base);
    expect(sent).toHaveLength(2);
    expect(ANSWER_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("keeps a failure for an hour: the route's `fellBack` and `unavailable` are not asked again until it is over", async () => {
    for (const failure of [{ fellBack: "timeout" }, { unavailable: true }]) {
      sent.length = 0;
      localStorage.clear();
      vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
      answer = async () => json(failure);

      expect(await open(base)).toBeUndefined();
      expect(await open(base)).toBeUndefined();
      expect(sent).toHaveLength(1);
      expect(keptStructureReview(KEY)).toEqual({ failed: true });

      vi.setSystemTime(new Date(Date.parse("2026-10-27T12:00:00.000Z") + FAILURE_TTL_MS - 60_000));
      await open(base);
      expect(sent).toHaveLength(1);
      vi.setSystemTime(new Date(Date.parse("2026-10-27T12:00:00.000Z") + FAILURE_TTL_MS + 60_000));
      expect(keptStructureReview(KEY)).toBeNull();
      await open(base);
      expect(sent).toHaveLength(2);
    }
    expect(FAILURE_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("does not keep a request that failed: an error status, a thrown request or an answer that is not one is asked again next time", async () => {
    answer = async () => json({ error: "nope" }, 500);
    await open(base);
    answer = async () => {
      throw new Error("offline");
    };
    await open(base);
    answer = async () => json({ something: "else" });
    await open(base);
    answer = async () => new Response("not json", { status: 200 });
    await open(base);
    answer = async () => json({ review: { ...review, rulesVersion: "other" } });
    await open(base);

    expect(sent).toHaveLength(5);
    expect(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY)).toBeNull();
    answer = async () => json({ review, cached: false });
    expect(await open(base)).toEqual(review);
  });

  it("does not lay a kept review over another draft: it asks again, and keeps the new answer", async () => {
    await open(base);
    expect(await open(base, { draftDigest: "ffffffffffffff" })).toBeUndefined();
    expect(sent).toHaveLength(2);
    // The server's answer was made against the old draft too, so it is not drawn: kept as a failure for an hour.
    expect(keptStructureReview(KEY)).toEqual({ failed: true });
    answer = async () => json({ review: { ...review, draftDigest: "ffffffffffffff" } });
    localStorage.clear();
    expect((await open(base, { draftDigest: "ffffffffffffff" }))?.draftDigest).toBe("ffffffffffffff");
  });

  it("reads a kept review through the restorer: another version of the rules is no answer, and it asks again", async () => {
    localStorage.setItem(STRUCTURE_REVIEW_STORAGE_KEY, JSON.stringify({ [KEY]: { at: Date.now(), review: { ...review, promptVersion: "old" } } }));
    expect(await open(base)).toEqual(review);

    expect(sent).toHaveLength(1);
  });

  it("is never asked twice for the paper while the first request is open, however often the page re-renders", async () => {
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    const opened = await hookRuntime.mount(() => {
      // A new paper object and a new key object on every render, as the page builds them, and a state change in
      // the middle of the request.
      const [, rerender] = useState(0);
      useEffect(() => {
        rerender(1);
      }, []);
      return useStructureReview({ paper: { ...base }, hasBody: true, draftDigest: DIGEST, enabled: true, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    });

    expect(sent).toHaveLength(1);
    expect(opened.value).toBeUndefined();
    release(json({ review, cached: false }));
    opened.unmount();
    expect(sent).toHaveLength(1);
  });

  it("aborts the request when the page goes, and keeps nothing of an answer that arrives after", async () => {
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    const opened = await hookRuntime.mount(() => useStructureReview(defaults(base)));

    expect(sent).toHaveLength(1);
    expect(sent[0].signal?.aborted).toBe(false);
    opened.unmount();
    expect(sent[0].signal?.aborted).toBe(true);

    release(json({ review, cached: false }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY)).toBeNull();
    await open(base);
    expect(sent).toHaveLength(2);
  });

  it("keeps the reviews of at most 24 papers, the newest", async () => {
    for (let i = 0; i < 26; i += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 27, 12, 0, i)));
      await open({ ...base, id: `openalex:W80000000${String(i).padStart(2, "0")}` });
    }
    const kept = JSON.parse(localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY) ?? "{}") as Record<string, unknown>;

    expect(Object.keys(kept)).toHaveLength(24);
    expect(kept[buildReadingKey("openalex:W8000000000", undefined, undefined)]).toBeUndefined();
    expect(kept[buildReadingKey("openalex:W8000000025", undefined, undefined)]).toBeDefined();
  });

  it("survives a browser store that is corrupt, full or blocked: the page still gets its review", async () => {
    localStorage.setItem(STRUCTURE_REVIEW_STORAGE_KEY, "{not json");
    expect(await open(base)).toEqual(review);

    localStorage.setItem(STRUCTURE_REVIEW_STORAGE_KEY, JSON.stringify({ [KEY]: { at: "yesterday", review: 5 } }));
    sent.length = 0;
    expect(await open(base)).toEqual(review);
    expect(sent).toHaveLength(1);

    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", blocked);
    sent.length = 0;
    expect(await open(base)).toEqual(review);
    expect(sent).toHaveLength(1);
  });

  it("returns the same object for the same review on every render: the page may depend on it", async () => {
    const seen: unknown[] = [];
    const opened = await hookRuntime.mount(() => {
      const [again, rerender] = useState(0);
      const view = useStructureReview(defaults(base));
      useEffect(() => {
        if (view && again < 2) rerender(again + 1);
      }, [view, again]);
      seen.push(view);
      return view;
    });
    opened.unmount();

    const withReview = seen.filter((view) => view !== undefined);
    expect(withReview.length).toBeGreaterThan(1);
    expect(new Set(withReview).size).toBe(1);
  });

  it("can be told what to keep and reads it back as it was kept", () => {
    rememberStructureReview(KEY, { review });
    expect(keptStructureReview(KEY)).toEqual({ review });
    rememberStructureReview(KEY, { failed: true });
    expect(keptStructureReview(KEY)).toEqual({ failed: true });
  });
});
