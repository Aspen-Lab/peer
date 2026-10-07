// P3-03 (ruling §1h.6): `useParagraphGuide` with its effects running — the page's
// one request for Peer's paragraph gists, made once per paper when there is a
// body to put them under and a model to write them, kept in this browser for a
// day, never made twice, and dropped with the page.
//
// The pattern of `use-model-report.effects.test.ts` and `use-reading.effects.test.ts`:
// the hook runs on `test-support/hook-runtime` (the project's Vitest has no DOM) and
// `fetch` — the one network entry point the hook uses — is counted. No real model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import type { Paper } from "@/types";
import type { ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { buildReadingKey } from "./use-reading";
import { PARAGRAPH_GUIDE_STORAGE_KEY, keptParagraphGuide, rememberParagraphGuide, useParagraphGuide } from "./use-paragraph-guide";

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
  id: "openalex:W7000000003",
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

const GISTS = { s1: { 0: "Blades slowly lose their shape under load.", 2: "Plates form inside the grains." } };
const guide: ParagraphGuide = { docHash: "abc123", gists: GISTS };

interface Sent {
  url: string;
  method: string | undefined;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}
const sent: Sent[] = [];
/** What the next request answers; a function lets a test hold it open. */
let answer: () => Promise<Response> = async () => json({ guide, cached: false });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>, signal: init?.signal ?? undefined });
    return answer();
  });
}

type Args = Parameters<typeof useParagraphGuide>[0];
const defaults = (paper: Paper): Args => ({ paper, hasBody: true, enabled: true });

async function open(paper: Paper, over: Partial<Args> = {}) {
  const opened = await hookRuntime.mount(() => useParagraphGuide({ ...defaults(paper), ...over }));
  opened.unmount();
  return opened.value;
}

describe("useParagraphGuide with effects running — Peer's gists, asked for once (P3-03)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    sent.length = 0;
    answer = async () => json({ guide, cached: false });
    stubFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks once for a paper with a body and a model, and returns the gists", async () => {
    const gists = await open(base);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/papers/openalex%3AW7000000003/paragraph-guide");
    expect(sent[0].method).toBe("POST");
    expect(gists).toEqual(GISTS);
  });

  it("asks nothing the second time the paper is opened: the guide is kept in this browser", async () => {
    await open(base);
    const second = await open(base);

    expect(sent).toHaveLength(1);
    expect(second).toEqual(GISTS);
    const kept = JSON.parse(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(kept)).toEqual([buildReadingKey(base.id, undefined, undefined)]);
  });

  it("sends the paper and, when the reader has one, their own key — and nothing else about them", async () => {
    await open(base, { llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });

    expect(Object.keys(sent[0].body).sort()).toEqual(["llmOverride", "paper"]);
    expect((sent[0].body.paper as Paper).id).toBe(base.id);
    expect(sent[0].body.llmOverride).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
    await open({ ...base, id: "openalex:W7000000004" });
    expect(Object.keys(sent[1].body)).toEqual(["paper"]);
  });

  it("is not asked for without a model, without a body, or without a paper", async () => {
    expect(await open(base, { enabled: false })).toBeUndefined();
    expect(await open(base, { hasBody: false })).toBeUndefined();
    const none = await hookRuntime.mount(() => useParagraphGuide({ paper: undefined, hasBody: true, enabled: true }));
    none.unmount();

    expect(none.value).toBeUndefined();
    expect(sent).toHaveLength(0);
    // …and asked the moment all three are there.
    await open(base);
    expect(sent).toHaveLength(1);
  });

  it("keeps one guide per paper and per upload revision: a new revision asks again", async () => {
    await open(attached);
    await open(attached);
    expect(sent).toHaveLength(1);

    await open({ ...attached, revision: 2 });
    expect(sent).toHaveLength(2);
    await open(standalone);
    expect(sent).toHaveLength(3);
    expect(sent[2].url).toBe("/api/papers/upload%3Afedcba9876543210/paragraph-guide");
    await open(standalone);
    expect(sent).toHaveLength(3);
  });

  it("honours a kept `skipped` for a day, and asks again after it", async () => {
    answer = async () => json({ skipped: "too_many_paragraphs" });
    expect(await open(base)).toBeUndefined();
    expect(sent).toHaveLength(1);

    expect(await open(base)).toBeUndefined();
    expect(sent).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-07T11:59:00.000Z"));
    await open(base);
    expect(sent).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-07T12:01:00.000Z"));
    await open(base);
    expect(sent).toHaveLength(2);
  });

  it("honours a kept `unavailable` for a day: the route said there is no model to write it", async () => {
    answer = async () => json({ unavailable: true });
    await open(base);
    await open(base);

    expect(sent).toHaveLength(1);
    expect(keptParagraphGuide(buildReadingKey(base.id, undefined, undefined))).toEqual({ unavailable: true });

    vi.setSystemTime(new Date("2026-10-07T12:01:00.000Z"));
    expect(keptParagraphGuide(buildReadingKey(base.id, undefined, undefined))).toBeNull();
    await open(base);
    expect(sent).toHaveLength(2);
  });

  it("keeps a guide for a day too", async () => {
    await open(base);
    vi.setSystemTime(new Date("2026-10-07T11:59:00.000Z"));
    expect(await open(base)).toEqual(GISTS);
    expect(sent).toHaveLength(1);

    vi.setSystemTime(new Date("2026-10-07T12:01:00.000Z"));
    await open(base);
    expect(sent).toHaveLength(2);
  });

  it("does not keep a failed request: an error status, a thrown request or an answer that is not one is asked again next time", async () => {
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

    expect(sent).toHaveLength(4);
    expect(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY)).toBeNull();
    answer = async () => json({ guide, cached: false });
    expect(await open(base)).toEqual(GISTS);
  });

  it("takes only what a guide is: a gist that is not text, or past 120 characters, never reaches the map", async () => {
    answer = async () =>
      json({ guide: { docHash: "x", gists: { s1: { 0: 5, 1: "Fine gist about the blades.", 2: "x".repeat(121), 3: "" }, s2: "nope" } }, cached: false });
    const gists = await open(base);

    expect(gists).toEqual({ s1: { 1: "Fine gist about the blades." } });
  });

  it("is never asked twice for the paper while the first request is open, however often the page re-renders", async () => {
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    const opened = await hookRuntime.mount(() => {
      // A new paper object and a new key object on every render, as the page builds them,
      // and a state change in the middle of the request.
      const [, rerender] = useState(0);
      useEffect(() => {
        rerender(1);
      }, []);
      return useParagraphGuide({ paper: { ...base }, hasBody: true, enabled: true, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    });

    expect(sent).toHaveLength(1);
    expect(opened.value).toBeUndefined();
    release(json({ guide, cached: false }));
    opened.unmount();
    expect(sent).toHaveLength(1);
  });

  it("aborts the request when the page goes, and keeps nothing of an answer that arrives after", async () => {
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    const opened = await hookRuntime.mount(() => useParagraphGuide(defaults(base)));

    expect(sent).toHaveLength(1);
    expect(sent[0].signal?.aborted).toBe(false);
    opened.unmount();
    expect(sent[0].signal?.aborted).toBe(true);

    release(json({ guide, cached: false }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY)).toBeNull();
    await open(base);
    expect(sent).toHaveLength(2);
  });

  it("keeps the guides of at most 24 papers, the newest", async () => {
    for (let i = 0; i < 26; i += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 12, 0, i)));
      await open({ ...base, id: `openalex:W80000000${String(i).padStart(2, "0")}` });
    }
    const kept = JSON.parse(localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;

    expect(Object.keys(kept)).toHaveLength(24);
    expect(kept[buildReadingKey("openalex:W8000000000", undefined, undefined)]).toBeUndefined();
    expect(kept[buildReadingKey("openalex:W8000000025", undefined, undefined)]).toBeDefined();
  });

  it("survives a browser store that is corrupt, full or blocked: the page still gets its gists", async () => {
    localStorage.setItem(PARAGRAPH_GUIDE_STORAGE_KEY, "{not json");
    expect(await open(base)).toEqual(GISTS);

    localStorage.setItem(PARAGRAPH_GUIDE_STORAGE_KEY, JSON.stringify({ [buildReadingKey(base.id, undefined, undefined)]: { at: "yesterday", guide: 5 } }));
    sent.length = 0;
    expect(await open(base)).toEqual(GISTS);
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
    expect(await open(base)).toEqual(GISTS);
    expect(sent).toHaveLength(1);
  });

  it("can be told what to keep and reads it back as it was kept", () => {
    const key = buildReadingKey(base.id, undefined, undefined);
    rememberParagraphGuide(key, { guide });
    expect(keptParagraphGuide(key)).toEqual({ guide });
    rememberParagraphGuide(key, { skipped: "too_many_paragraphs" });
    expect(keptParagraphGuide(key)).toEqual({ skipped: "too_many_paragraphs" });
  });
});
