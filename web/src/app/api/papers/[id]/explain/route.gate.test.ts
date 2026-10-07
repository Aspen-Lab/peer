import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache } from "@/lib/papers/explain";
import { getCounterStore, rateKey, resetCounterStoreForTests } from "@/lib/usage/counters";

// P3-02 (ruling §1h.2; §3d 14, 17): the sign-in gate on the explain route and
// what it means across readers — a stranger is refused before any text is read
// or any model asked; a reader is held to 40 requests an hour and to nothing
// else (P4-00: there is no allowance, no day cap and no house ceiling any more —
// the model is the reader's own key); and a second reader asking the same words
// of the same paper is served from the server's memory, because nothing in that
// memory is a reader's. A deployed runtime and a session stub, so a file of its
// own (the ordinary route tests run with no sign-in at all).

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  getFullText: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: vi.fn(), rpc: vi.fn() }),
}));
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...(await original<typeof import("@/lib/papers/upload-access")>()),
  ownedUpload: mocks.ownedUpload,
}));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));

import { POST } from "./route";

const DEF = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 2,
  figureCaptions: [],
  sections: [{ id: "s1", heading: "2 Methods", canonical: "methods", page: 1, text: `Specimens were machined from a single casting.\n\n${DEF}` }],
};
const paper = {
  id: "arxiv:2607.00002",
  title: "Rafting under creep in a nickel alloy",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "arxiv" as const,
  summaryIntro: "A short abstract.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
const NOW = new Date("2026-10-06T12:00:00.000Z");
const body = { paper, passage: "the rafting ratio as the fraction of the gauge length", sectionId: "s1", paragraphIndex: 1, thread: [] };

function call(payload: unknown = body, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

/** How many requests this reader has made this hour, as the gate counts them. */
async function requestsOf(userId: string): Promise<number> {
  return (await getCounterStore().read(rateKey("paper-explain", userId, NOW), NOW)).value;
}

let generateJsonText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  resetCounterStoreForTests();
  explainCache.clear();
  deleteSpendableKeys();
  deployedRuntimeEnv(vi.stubEnv);
  generateJsonText = vi.fn().mockResolvedValue(
    JSON.stringify({ meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", evidence: DEF } }),
  );
  mocks.getUser.mockResolvedValue(signedOut());
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ generateJsonText });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetCounterStoreForTests();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/explain — who may ask", () => {
  it("answers a stranger 401, before the paper's text is read or any model is asked", async () => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("answers 503 where the deployment has no sign-in configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const response = await call();

    expect(response.status).toBe(503);
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("answers 404 for an upload nobody owns, even to a stranger — the owner check runs first", async () => {
    const id = "upload:0123456789abcdef";
    const response = await call({ ...body, paper: { ...paper, id } }, id);

    expect(response.status).toBe(404);
  });

  it("answers a signed-in reader", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const response = await call();

    expect(response.status).toBe(200);
    expect(((await response.json()) as { cached: boolean }).cached).toBe(false);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("counts the request against the reader's own hour, and nothing else", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    await call();

    expect(await requestsOf("reader-1")).toBe(2);
    expect(await requestsOf("reader-2")).toBe(0);
  });

  it("logs one debug line for a signed-in reader with a shortened hash of the account, never the id, and no word of the paper", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();

    expect(debug).toHaveBeenCalledTimes(1);
    const [label, fields] = debug.mock.calls[0] as [string, Record<string, unknown>];
    expect(label).toBe("[papers/explain] turn");
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "userId"]);
    expect(String(fields.userId)).toMatch(/^[0-9a-f]{12}$/);
    const all = JSON.stringify(debug.mock.calls);
    for (const word of ["reader-1", "rafting", "gauge", "plates"]) expect(all).not.toContain(word);
  });

  it("limits a reader to 40 requests an hour, as the report route limits its own", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 40; i += 1) expect((await call()).status).toBe(200);
    const over = await call();

    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/papers/[id]/explain — nothing per-reader in the memory", () => {
  it("serves the next reader's same words from the memory, with no model call of theirs", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call()).json()) as { cached: boolean };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call()).json()) as { cached: boolean };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    // Both are requests, and each is counted for its own reader's hour.
    expect(await requestsOf("reader-1")).toBe(1);
    expect(await requestsOf("reader-2")).toBe(1);
  });
});

// P3-02b (ruling §1h.3): the memory is keyed by the document, the passage and the
// thread's words only — so a second reader sending the same thread is served from it.
describe("POST /api/papers/[id]/explain — nothing per-reader in the memory, with a thread", () => {
  const thread = [
    { role: "peer", text: "A share of a sample turned to plates. It compares alloys." },
    { role: "reader", text: "Why does a bigger ratio matter?" },
  ];

  it("serves the next reader's same thread from the memory, with no model call of theirs", async () => {
    generateJsonText.mockResolvedValue(JSON.stringify({ reply: "It changes how the metal carries load.", evidence: DEF }));
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call({ ...body, thread })).json()) as { cached: boolean; turn?: { text: string } };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call({ ...body, thread })).json()) as { cached: boolean; turn?: { text: string } };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.turn).toEqual(first.turn);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("answers a stranger's reply 401, before the thread is used", async () => {
    const response = await call({ ...body, thread });

    expect(response.status).toBe(401);
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});

// P3-02c (§1h.4 amendment): a searched reply is its own entry in the memory, and
// the next reader's same words are a hit — with the search it was written with.
describe("POST /api/papers/[id]/explain — a searched reply across readers (P3-02c)", () => {
  it("serves the same searched thread to the next reader from the memory, still marked searched, with one model call", async () => {
    mocks.resolveProvider.mockReturnValue({ generateJsonText, supportsWebSearch: true });
    generateJsonText.mockResolvedValue(JSON.stringify({ reply: "It changes how the metal carries load.", evidence: DEF }));
    const thread = [
      { role: "peer", text: "A share of a sample turned to plates. It compares alloys." },
      { role: "reader", text: "Does anyone else measure it this way?" },
    ];
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call({ ...body, thread, search: true })).json()) as { cached: boolean; turn: { searched: boolean } };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call({ ...body, thread, search: true })).json()) as { cached: boolean; turn: { searched: boolean } };

    expect(first).toMatchObject({ cached: false, turn: { searched: true } });
    expect(second).toMatchObject({ cached: true, turn: { searched: true } });
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(generateJsonText.mock.calls[0][0]).toMatchObject({ webSearch: true });
  });
});
