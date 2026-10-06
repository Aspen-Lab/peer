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
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";
import {
  ALL_USERS_EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_SEARCH_TENTHS,
  EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_TURN_TENTHS,
  explainTenthsHouseKey,
  explainTenthsKey,
} from "@/lib/usage/explain-quota";

// P3-02 (ruling §1h.2; §3d 14, 17): the sign-in gate on the explain route and
// what it means across readers — a stranger is refused before any text is read
// or any model asked; each model turn is counted for the reader who caused it
// and for no one else; and a second reader asking the same words of the same
// paper is served from the server's memory with no count of their own, because
// nothing in that memory is a reader's. A deployed runtime and a session stub,
// so a file of its own (the ordinary route tests run with no sign-in at all).
// P3-02c (§1h.4 amendment): "counted" is now "charged" — in tenths, one or ten —
// and the per-reader day cap and the house ceiling are tested here, across readers.

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

/** What this reader has been charged today, in tenths. */
async function turnsOf(userId: string): Promise<number> {
  return (await getCounterStore().read(explainTenthsKey(userId, NOW), NOW)).value;
}
async function houseOf(): Promise<number> {
  return (await getCounterStore().read(explainTenthsHouseKey(NOW), NOW)).value;
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
    expect(await turnsOf("reader-1")).toBe(EXPLAIN_TURN_TENTHS);
    expect(await turnsOf("reader-2")).toBe(0);
  });

  it("charges each reader's own model turns apart", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    await call({ ...body, passage: "Specimens were machined from a single casting", paragraphIndex: 0 });

    expect(await turnsOf("reader-1")).toBe(EXPLAIN_TURN_TENTHS);
    expect(await turnsOf("reader-2")).toBe(EXPLAIN_TURN_TENTHS);
    expect(await turnsOf("reader-3")).toBe(0);
    expect(await houseOf()).toBe(2 * EXPLAIN_TURN_TENTHS);
  });

  it("starts a reader's charge again the next UTC day", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    vi.setSystemTime(new Date("2026-10-07T00:00:01.000Z"));
    explainCache.clear();
    await call();

    const later = new Date("2026-10-07T00:00:01.000Z");
    expect((await getCounterStore().read(explainTenthsKey("reader-1", later), later)).value).toBe(EXPLAIN_TURN_TENTHS);
    // The first day's charge has gone with its day (the in-memory store sweeps what has ended).
    expect((await getCounterStore().read(explainTenthsKey("reader-1", NOW), later)).value).toBe(0);
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
    expect(await turnsOf("reader-1")).toBe(EXPLAIN_TURN_TENTHS);
    expect(await turnsOf("reader-2")).toBe(0);
  });

  it("answers a stranger's reply 401, before the thread is used", async () => {
    const response = await call({ ...body, thread });

    expect(response.status).toBe(401);
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});

// P3-02c (§1h.4 amendment): the day cap is each reader's own, the house ceiling
// is everyone's, and a stranger is never charged.
describe("POST /api/papers/[id]/explain — the caps across readers (P3-02c)", () => {
  it("charges nothing to a stranger: refused 401 before any counter is touched", async () => {
    await call();

    expect(await houseOf()).toBe(0);
  });

  it("refuses the reader whose day is spent with a 429, and still serves another reader", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const refused = await call();
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const served = await call();

    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string; reason: string }).error).toBe("explain_exhausted");
    expect(served.status).toBe(200);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(await turnsOf("reader-2")).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("refuses everyone once the house ceiling is spent, a reader who has asked nothing today included", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY, NOW);
    mocks.getUser.mockResolvedValue(signedIn("reader-9"));
    const response = await call();

    expect(response.status).toBe(429);
    expect(((await response.json()) as { reason: string }).reason).toBe("exhausted");
    expect(generateJsonText).not.toHaveBeenCalled();
    expect(await turnsOf("reader-9")).toBe(0);
  });

  it("charges a searched reply ten tenths to the reader who sent it, and the same words from the next reader are a hit at no charge of theirs", async () => {
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
    expect(await turnsOf("reader-1")).toBe(EXPLAIN_SEARCH_TENTHS);
    expect(await turnsOf("reader-2")).toBe(0);
    expect(await houseOf()).toBe(EXPLAIN_SEARCH_TENTHS);
  });

  it("says nothing of the reader in the 429: the reason and the hour, no id", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const text = await (await call()).text();

    expect(JSON.parse(text)).toEqual({ error: "explain_exhausted", reason: "exhausted", resetsAt: "2026-10-07T00:00:00.000Z" });
    expect(text).not.toContain("reader-1");
  });
});
