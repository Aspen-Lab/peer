import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { captureConsole } from "@/test-support/console-capture";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { plainCache } from "@/lib/papers/plain";
import { getCounterStore, rateKey, resetCounterStoreForTests } from "@/lib/usage/counters";

// P4-01 (blueprint §3.6, D14; rulings §1h.10, §1h.12 (h); §3d 15, 17): the sign-in gate on the
// plain route and what it means across readers — a stranger is refused before any text is read
// or any model asked; a reader is held to 40 requests an hour under the scope `paper-plain` and
// to nothing else (there is no allowance, no day cap and no house ceiling: the model is the
// reader's own key); and a second reader asking the same paragraph at the same level of the same
// paper is served from the server's memory, because nothing in that memory is a reader's. A
// deployed runtime and a session stub, so a file of its own (the ordinary route tests run with
// no sign-in at all) — the explain route's gate suite is its model.

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

const NUMS = "The specimens were held at 1100 K for 10 ms, and the rafting ratio rose from 0.2 to 0.7.";
const GOOD = "The samples were held at 1100 K for 10 ms. The rafting ratio went from 0.2 to 0.7.";
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 2,
  figureCaptions: [],
  sections: [{ id: "s1", heading: "2 Methods", canonical: "methods", page: 1, text: `Specimens were machined from a single casting.\n\n${NUMS}` }],
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
const NOW = new Date("2026-10-07T12:20:00.000Z");
const body = { paper, sectionId: "s1", paragraphIndex: 1, text: NUMS, level: "undergrad" };

function call(payload: unknown = body, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/plain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

/** How many requests this reader has made this hour under the plain scope, as the gate counts them. */
async function requestsOf(userId: string): Promise<number> {
  return (await getCounterStore().read(rateKey("paper-plain", userId, NOW), NOW)).value;
}

let generateJsonText: ReturnType<typeof vi.fn>;
let increment: { mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  resetCounterStoreForTests();
  plainCache.clear();
  deleteSpendableKeys();
  deployedRuntimeEnv(vi.stubEnv);
  // The store is chosen from the environment, so spy on the instance the gate will get.
  increment = vi.spyOn(getCounterStore(), "increment");
  generateJsonText = vi.fn().mockResolvedValue(JSON.stringify({ plain: GOOD }));
  mocks.getUser.mockResolvedValue(signedOut());
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ generateJsonText });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  // The route's one debug line per turn: silenced here, read in its own test below.
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetCounterStoreForTests();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/plain — who may ask", () => {
  it("answers a stranger 401, before the paper's text is read or any model is asked", async () => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(generateJsonText).not.toHaveBeenCalled();
    // A stranger is not counted: there is no account to count against.
    expect(increment.mock.calls).toEqual([]);
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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(increment.mock.calls).toEqual([]);
  });

  it("answers a signed-in reader", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plain: GOOD, level: "undergrad", cached: false });
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("answers a signed-in reader's upload with the private headers on the 401 a stranger gets and on the answer", async () => {
    const id = "upload:0123456789abcdef";
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: [id] });
    const stranger = await call({ ...body, paper: { ...paper, id } }, id);
    expect(stranger.status).toBe(401);
    expect(stranger.headers.get("cache-control")).toBe("private, no-store");

    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const owner = await call({ ...body, paper: { ...paper, id } }, id);
    expect(owner.status).toBe(200);
    expect(owner.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("POST /api/papers/[id]/plain — the hourly limit, and nothing else", () => {
  it("counts each request under the reader's own hour for `paper-plain` and under no other key", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    await call();
    await call();

    const key = rateKey("paper-plain", "reader-1", NOW);
    expect(key).toBe("rate:paper-plain:reader-1:2026-10-07T12");
    expect(increment.mock.calls.map((entry) => entry[0])).toEqual([key, key, key]);
    expect(await requestsOf("reader-1")).toBe(3);
    expect(await requestsOf("reader-2")).toBe(0);
  });

  it("counts a refused rewrite and a cached one the same as any other: one request, one count", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    await call();
    generateJsonText.mockResolvedValue(JSON.stringify({ plain: "The samples were held at 1100 K. The ratio rose to 0.7." }));
    plainCache.clear();
    expect((await call()).status).toBe(422);

    expect(await requestsOf("reader-1")).toBe(3);
  });

  it("limits a reader to 40 requests an hour: the 41st is a 429 with the rest of the hour in Retry-After", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 40; i += 1) expect((await call()).status).toBe(200);
    const over = await call();

    expect(over.status).toBe(429);
    // 12:20 -> 13:00 is 40 minutes.
    expect(over.headers.get("retry-after")).toBe("2400");
    expect(over.headers.get("cache-control")).toMatch(/no-store/);
    // The refused request reads nothing and asks nothing: forty rewrites were asked about (the same
    // paragraph, so one model call and thirty-nine memory hits), and the 41st added none.
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("holds each reader to their own count: one reader at the limit does not refuse the next, and the hour turning over starts a new one", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 41; i += 1) await call();
    expect((await call()).status).toBe(429);

    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    expect((await call()).status).toBe(200);
    expect(await requestsOf("reader-2")).toBe(1);
    expect(await requestsOf("reader-1")).toBe(42);

    vi.setSystemTime(new Date("2026-10-07T13:00:00.000Z"));
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    expect((await call()).status).toBe(200);
    expect(increment.mock.calls.at(-1)?.[0]).toBe("rate:paper-plain:reader-1:2026-10-07T13");
  });

  it("logs one debug line for a signed-in reader with a shortened hash of the account, never the id, and no word of the paper", async () => {
    const consoleText = captureConsole();
    try {
      mocks.getUser.mockResolvedValue(signedIn("reader-1"));
      await call();
      const all = consoleText.text();

      expect(consoleText.calls()).toBe(1);
      expect(all).toContain("[papers/plain] turn");
      expect(all).toMatch(/userId: '[0-9a-f]{12}'/);
      for (const word of ["reader-1", "rafting", "specimens", "1100", "samples", "Methods"]) expect(all).not.toContain(word);
    } finally {
      consoleText.restore();
    }
  });
});

describe("POST /api/papers/[id]/plain — nothing per-reader in the memory", () => {
  it("serves the next reader's same paragraph at the same level from the memory, with no model call of theirs", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call()).json()) as { cached: boolean; plain: string };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call()).json()) as { cached: boolean; plain: string };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.plain).toBe(first.plain);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    // Both are requests, and each is counted for its own reader's hour.
    expect(await requestsOf("reader-1")).toBe(1);
    expect(await requestsOf("reader-2")).toBe(1);
  });

  it("does not serve one level's rewrite to a request for another", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    const other = (await (await call({ ...body, level: "graduate" })).json()) as { cached: boolean; level: string };

    expect(other).toMatchObject({ cached: false, level: "graduate" });
    expect(generateJsonText).toHaveBeenCalledTimes(2);
  });
});
