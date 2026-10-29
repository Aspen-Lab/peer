// P12-58 (rule 3): the page keeps asking while the full text is pending.
//
// A P12-44 (D1): the hook asked once per page open; the reading route's "abstract alone" answer was
// kept as the answer and nothing re-asked, so the body of a PDF the reader had just uploaded arrived
// only after a manual reload (for a 25 MB one, not within 90 s). Here the hook runs with its effects
// on `staged-runtime` and fake timers; `fetch` is a script of invented answers, and the asks'
// times, the one request in flight, the swap to the body, the end after three minutes, and the
// aborts are read off it. Nothing is a real paper; no server runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import { stagedRuntime } from "@/test-support/staged-runtime";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import { markFullTextPending } from "@/lib/papers/full-text-pending";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { Paper } from "@/types";
import { FULL_TEXT_WAIT } from "./copy";
import {
  POLL_BUDGET_MS,
  POLL_DELAYS_MS,
  POLL_EVERY_MS,
  READING_VERSION,
  buildReadingKey,
  pollDelayMs,
  sentencesWhileWaiting,
  useReading,
} from "./use-reading";

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
  id: "upload:fedcba9876543210",
  title: "An Invented Upload That Takes A While To Read",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "We measure creep in invented alloys. Boundary density sets the creep rate.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  revision: 1,
};
const other: Paper = { ...base, id: "upload:0123456789abcdef", title: "Another Invented Upload" };
const publicPaper: Paper = { ...base, id: "openalex:W7000000058", revision: undefined };

const doc: ExtractedDocument = {
  source: "pdf",
  figureCaptions: [],
  pageCount: 4,
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life of parts that run hot for years at a time." },
    { id: "s2", heading: "2 Methods", canonical: "methods", text: "Twelve samples were cut from one ingot." },
  ],
};

/** What the route would answer: pending (the wait ended first) or the settled reading of the invented document. */
function answerOf(paper: Paper, kind: "pending" | "pdf" | "none"): PaperReading {
  if (kind === "pending") return markFullTextPending(buildReading(paper, null));
  if (kind === "none") return buildReading(paper, null);
  return buildReading(paper, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } });
}

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}
function reply(body: unknown, cacheControl = "private, no-store", status = 200): FakeResponse {
  return { ok: status < 400, status, headers: { get: (name) => (name.toLowerCase() === "cache-control" ? cacheControl : null) }, json: async () => body };
}

interface Ask {
  /** Milliseconds since the start of the test. */
  at: number;
  url: string;
  signal: AbortSignal | undefined;
}
const asks: Ask[] = [];
let t0 = 0;
/** The script: what the nth ask (1-based) answers. A promise lets a test hold an answer back. */
let script: (n: number, url: string) => FakeResponse | Promise<FakeResponse>;

let current: Paper;
function open(paper: Paper) {
  current = paper;
  const opened = stagedRuntime.mount(() => useReading(current));
  stagedRuntime.flush();
  return opened;
}
/** Let `ms` of the fake clock pass, then show what the hook returns now. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  stagedRuntime.rerender();
  stagedRuntime.flush();
}
/** When each ask was made, in milliseconds after the first of them. */
const times = () => asks.map((ask) => ask.at - asks[0].at);
const stored = () => localStorage.getItem("peer-reading-v2");

describe("useReading — P12-58 rule 3: it keeps asking while the full text is pending", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    t0 = Date.now();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("scrollBy", vi.fn());
    asks.length = 0;
    script = () => reply(answerOf(current, "pending"));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      asks.push({ at: Date.now() - t0, url, signal: init?.signal ?? undefined });
      return Promise.resolve(script(asks.length, url));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("the plan: 2, 4, 8, 16 seconds, then every 20, for three minutes", () => {
    expect(POLL_DELAYS_MS).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(POLL_EVERY_MS).toBe(20_000);
    expect(POLL_BUDGET_MS).toBe(180_000);
    expect([1, 2, 3, 4, 5, 6, 9].map(pollDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000, 20_000, 20_000, 20_000]);
  });

  // P12-97, RE-AIMED: 17 was the 'pending' value (P12-58); the version is 18 now, for the figure text and the running foot that
  // leave an uploaded PDF's paragraphs. The test's point, that the hook reads the number the reading is built with, is unchanged.
  it("the reading's version is 18 (17 came with the 'pending' value, 18 with P12-97), and the hook reads the same number the reading is built with", () => {
    expect(READING_VERSION).toBe(18);
    expect(buildReading(base, null).version).toBe(READING_VERSION);
    expect(markFullTextPending(buildReading(base, null)).version).toBe(READING_VERSION);
  });

  it("a reading kept by the build before (version 16, here one that says 'pending') is not used: the page asks for it again", async () => {
    const kept = { ...answerOf(base, "pending"), version: 16 };
    localStorage.setItem("peer-reading-v2", JSON.stringify({ [buildReadingKey(base.id, undefined, base.revision)]: { reading: kept, ts: Date.now() } }));
    script = () => reply(answerOf(current, "pdf"));

    const opened = open(base);
    await advance(0);

    expect(asks).toHaveLength(1);
    expect(opened.value.reading?.provenance.fullText).toBe("pdf");
    opened.unmount();
  });

  it("asks again at the planned times, shows the abstract and 'pending' meanwhile, and swaps the body in when it arrives", async () => {
    script = (n) => reply(answerOf(current, n < 4 ? "pending" : "pdf"));
    const opened = open(base);
    await advance(0);

    // After the first answer: the abstract-only reading the page already shows, and the wait.
    expect(opened.value.wait).toBe("pending");
    expect(opened.value.fromServer).toBe(false);
    expect(opened.value.reading?.provenance.fullText).toBe("none");
    expect(opened.value.reading?.body).toEqual([]);
    expect(times()).toEqual([0]);

    await advance(1_999);
    expect(times()).toEqual([0]);
    await advance(1);
    expect(times()).toEqual([0, 2_000]);
    await advance(4_000);
    expect(times()).toEqual([0, 2_000, 6_000]);
    expect(opened.value.wait).toBe("pending");
    await advance(8_000);
    expect(times()).toEqual([0, 2_000, 6_000, 14_000]);

    // The fourth answer is the body: it replaces the abstract in place, and the asking stops.
    expect(opened.value.wait).toBeNull();
    expect(opened.value.fromServer).toBe(true);
    expect(opened.value.reading?.provenance.fullText).toBe("pdf");
    expect(opened.value.reading?.body.length).toBeGreaterThan(0);
    await advance(60_000);
    expect(times()).toEqual([0, 2_000, 6_000, 14_000]);

    // Nothing in the swap scrolled the page.
    expect(vi.mocked(globalThis.scrollTo)).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.scrollBy)).not.toHaveBeenCalled();
    opened.unmount();
  });

  it("stops after three minutes: 12 asks, the last at 170 s, then 'gave-up' and no timer left", async () => {
    const opened = open(base);
    await advance(0);
    await advance(180_000);

    expect(times()).toEqual([0, 2_000, 6_000, 14_000, 30_000, 50_000, 70_000, 90_000, 110_000, 130_000, 150_000, 170_000]);
    expect(opened.value.wait).toBe("gave-up");
    expect(opened.value.fromServer).toBe(false);
    expect(opened.value.reading?.provenance.fullText).toBe("none");
    // Nothing more, ever: no timer left to ask with.
    expect(vi.getTimerCount()).toBe(0);
    await advance(600_000);
    expect(asks).toHaveLength(12);
    opened.unmount();
  });

  it("keeps one request in flight: a slow answer is waited for, and the wait starts after it", async () => {
    let release!: (response: FakeResponse) => void;
    script = (n) => (n === 1 ? new Promise<FakeResponse>((resolve) => { release = resolve; }) : reply(answerOf(current, "pdf")));
    const opened = open(base);
    await advance(0);

    await advance(60_000);
    expect(times()).toEqual([0]);
    expect(opened.value.wait).toBeNull();

    release(reply(answerOf(current, "pending")));
    await advance(0);
    expect(times()).toEqual([0]);
    await advance(1_999);
    expect(times()).toEqual([0]);
    await advance(1);
    expect(times()).toEqual([0, 62_000]);
    expect(opened.value.reading?.provenance.fullText).toBe("pdf");
    opened.unmount();
  });

  it("counts the three minutes from the first ask, slow answers included", async () => {
    // Each answer takes 40 s: asks at 0 and 42, 86 (4 s wait), 134 (8 s wait); the next would be at 134+40+16 = 190 > 180.
    script = () => new Promise<FakeResponse>((resolve) => setTimeout(() => resolve(reply(answerOf(current, "pending"))), 40_000));
    const opened = open(base);
    await advance(0);
    await advance(400_000);

    expect(times()).toEqual([0, 42_000, 86_000, 134_000]);
    expect(opened.value.wait).toBe("gave-up");
    opened.unmount();
  });

  it("never keeps a pending answer: not for a private reading, not for a public one, whatever the headers say", async () => {
    const privateOpen = open(base);
    await advance(0);
    expect(stored()).toBeNull();
    privateOpen.unmount();

    asks.length = 0;
    script = () => reply(answerOf(current, "pending"), "public, s-maxage=86400");
    const publicOpen = open(publicPaper);
    await advance(0);
    expect(asks).toHaveLength(1);
    expect(publicOpen.value.wait).toBe("pending");
    expect(stored()).toBeNull();
    publicOpen.unmount();
  });

  it("keeps the body that arrives, as it always did for a private reading that was read", async () => {
    script = (n) => reply(answerOf(current, n === 1 ? "pending" : "pdf"));
    const opened = open(base);
    await advance(0);
    await advance(2_000);

    expect(Object.keys(JSON.parse(stored() ?? "{}"))).toHaveLength(1);
    opened.unmount();

    // A second open of the same upload reads it from there: no request.
    asks.length = 0;
    const again = open(base);
    await advance(0);
    expect(asks).toHaveLength(0);
    expect(again.value.fromServer).toBe(true);
    expect(again.value.reading?.provenance.fullText).toBe("pdf");
    again.unmount();
  });

  it("does not ask again for an answer that is settled: 'none' (a fact about the paper) is the end of it", async () => {
    script = () => reply(answerOf(current, "none"));
    const opened = open(base);
    await advance(0);
    await advance(120_000);

    expect(asks).toHaveLength(1);
    expect(opened.value.wait).toBeNull();
    expect(opened.value.fromServer).toBe(true);
    opened.unmount();
  });

  it("a first ask that fails is the end of it, as before; so is a 4xx after a pending answer", async () => {
    script = () => reply({}, "no-store", 500);
    const failed = open(base);
    await advance(0);
    await advance(120_000);
    expect(asks).toHaveLength(1);
    expect(failed.value.wait).toBeNull();
    expect(failed.value.fromServer).toBe(false);
    expect(failed.value.reading?.provenance.fullText).toBe("none");
    failed.unmount();

    asks.length = 0;
    script = (n) => (n === 1 ? reply(answerOf(current, "pending")) : reply({ error: "Upload no longer available" }, "private, no-store", 410));
    const gone = open(base);
    await advance(0);
    await advance(120_000);
    expect(times()).toEqual([0, 2_000]);
    expect(gone.value.wait).toBeNull();
    gone.unmount();
  });

  it("a dropped connection or a 5xx after a pending answer is a blip in the wait, not the end of it", async () => {
    script = (n) => {
      if (n === 1) return reply(answerOf(current, "pending"));
      if (n === 2) return reply({}, "no-store", 503);
      if (n === 3) return Promise.reject(new TypeError("fetch failed"));
      return reply(answerOf(current, "pdf"));
    };
    const opened = open(base);
    await advance(0);
    await advance(40_000);

    expect(times()).toEqual([0, 2_000, 6_000, 14_000]);
    expect(opened.value.wait).toBeNull();
    expect(opened.value.reading?.provenance.fullText).toBe("pdf");
    opened.unmount();
  });

  it("stops at once when the page goes: the wait is cleared and the request in flight is aborted", async () => {
    const waiting = open(base);
    await advance(0);
    expect(vi.getTimerCount()).toBe(1);
    waiting.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(300_000);
    expect(asks).toHaveLength(1);

    asks.length = 0;
    script = () => new Promise<FakeResponse>(() => undefined);
    const inFlight = open(base);
    await advance(0);
    expect(asks).toHaveLength(1);
    expect(asks[0].signal?.aborted).toBe(false);
    inFlight.unmount();
    expect(asks[0].signal?.aborted).toBe(true);
  });

  it("stops asking about the paper the page left: a new paper is asked about, the old one is not asked again", async () => {
    const opened = open(base);
    await advance(0);
    expect(asks).toHaveLength(1);

    current = other;
    stagedRuntime.rerender();
    stagedRuntime.flush();
    await advance(0);

    expect(asks.map((ask) => decodeURIComponent(ask.url))).toEqual([
      expect.stringContaining(base.id),
      expect.stringContaining(other.id),
    ]);
    await advance(30_000);
    const olderAsks = asks.filter((ask) => decodeURIComponent(ask.url).includes(base.id));
    expect(olderAsks).toHaveLength(1);
    expect(asks.length).toBeGreaterThan(2);
    opened.unmount();
  });
});

describe("sentencesWhileWaiting — P12-58 rule 3: one calm line instead of the abstract-only notice", () => {
  const notice = ["No abstract is published where Peer can read it — only the record. Open it at the source to judge it."];

  it("replaces the abstract-only sentence while pending, and again with the end-of-wait line", () => {
    expect(sentencesWhileWaiting(notice, "pending", false)).toEqual([FULL_TEXT_WAIT.pending]);
    expect(sentencesWhileWaiting(notice, "gave-up", false)).toEqual([FULL_TEXT_WAIT.gaveUp]);
  });

  it("leaves every sentence alone when nothing is awaited, and a model's own sentence when a report answered", () => {
    expect(sentencesWhileWaiting(notice, null, false)).toEqual(notice);
    const model = ["Read by your model from the abstract; every claim below carries a sentence from it."];
    expect(sentencesWhileWaiting(model, "pending", true)).toEqual(model);
  });

  it("keeps the sentences after the first (a model that failed)", () => {
    const failed = [...notice, "Your model could not finish; what is below is the paper's own text."];
    expect(sentencesWhileWaiting(failed, "pending", false)).toEqual([FULL_TEXT_WAIT.pending, failed[1]]);
  });

  it("the two lines are plain sentences: neither says the abstract is missing, and the end of the wait names the reload", () => {
    expect(FULL_TEXT_WAIT.pending).not.toMatch(/no abstract|abstract only/i);
    expect(FULL_TEXT_WAIT.gaveUp).not.toMatch(/no abstract|abstract only/i);
    expect(FULL_TEXT_WAIT.gaveUp).toMatch(/reload/i);
    for (const line of Object.values(FULL_TEXT_WAIT)) expect(line).toMatch(/^[A-Z][^]*\.$/);
  });
});
