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
import { explainCache, explainDayKey } from "@/lib/papers/explain";
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";

// P3-02 (ruling §1h.2; §3d 14, 17): the sign-in gate on the explain route and
// what it means across readers — a stranger is refused before any text is read
// or any model asked; each model turn is counted for the reader who caused it
// and for no one else; and a second reader asking the same words of the same
// paper is served from the server's memory with no count of their own, because
// nothing in that memory is a reader's. A deployed runtime and a session stub,
// so a file of its own (the ordinary route tests run with no sign-in at all).

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

async function turnsOf(userId: string): Promise<number> {
  return (await getCounterStore().read(explainDayKey(userId, NOW), NOW)).value;
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

  it("limits a reader to 40 requests an hour, as the report route limits its own", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 40; i += 1) expect((await call()).status).toBe(200);
    const over = await call();

    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/papers/[id]/explain — nothing per-reader in the memory", () => {
  it("counts a turn for the reader who caused it, and serves the next reader's same words from the memory at no count of theirs", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call()).json()) as { cached: boolean };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call()).json()) as { cached: boolean };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(await turnsOf("reader-1")).toBe(1);
    expect(await turnsOf("reader-2")).toBe(0);
  });

  it("counts each reader's own model turns apart", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    await call({ ...body, passage: "Specimens were machined from a single casting", paragraphIndex: 0 });

    expect(await turnsOf("reader-1")).toBe(1);
    expect(await turnsOf("reader-2")).toBe(1);
    expect(await turnsOf("reader-3")).toBe(0);
  });

  it("starts a reader's count again the next UTC day", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    vi.setSystemTime(new Date("2026-10-07T00:00:01.000Z"));
    explainCache.clear();
    await call();

    expect((await getCounterStore().read(explainDayKey("reader-1", new Date("2026-10-07T00:00:01.000Z")), new Date("2026-10-07T00:00:01.000Z"))).value).toBe(1);
    expect((await getCounterStore().read(explainDayKey("reader-1", NOW), new Date("2026-10-07T00:00:01.000Z"))).value).toBe(0);
  });
});

// P3-02b (ruling §1h.3): a reply is counted for the reader who caused it, and
// the memory is keyed by the document, the passage and the thread's words only —
// so a second reader sending the same thread is served from it, with no count.
describe("POST /api/papers/[id]/explain — nothing per-reader in the memory, with a thread", () => {
  const thread = [
    { role: "peer", text: "A share of a sample turned to plates. It compares alloys." },
    { role: "reader", text: "Why does a bigger ratio matter?" },
  ];

  it("counts a reply for the reader who caused it, and serves the next reader's same thread from the memory at no count of theirs", async () => {
    generateJsonText.mockResolvedValue(JSON.stringify({ reply: "It changes how the metal carries load.", evidence: DEF }));
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call({ ...body, thread })).json()) as { cached: boolean; turn?: { text: string } };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call({ ...body, thread })).json()) as { cached: boolean; turn?: { text: string } };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.turn).toEqual(first.turn);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(await turnsOf("reader-1")).toBe(1);
    expect(await turnsOf("reader-2")).toBe(0);
  });

  it("answers a stranger's reply 401, before the thread is used", async () => {
    const response = await call({ ...body, thread });

    expect(response.status).toBe(401);
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});
