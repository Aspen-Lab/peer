import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { structureReviewCache } from "@/lib/papers/structure-review";
import { FIVE_PARTS, inventedPaper, modelDouble } from "@/test-support/structure-fixtures";
import { getCounterStore, rateKey, resetCounterStoreForTests } from "@/lib/usage/counters";

// P12-53 (ruling §1h.428; the gist route's gate, `paragraph-guide/route.gate.test.ts`): the sign-in gate on the
// structure route and what it means across readers — a stranger is refused before any text is read or any model
// asked; the review is remembered by the document, so a second reader of the same paper is served from the memory
// with no model call; and a reader is held to 20 requests an hour. A deployed runtime and a session stub, so a
// file of its own (the ordinary route tests run with no sign-in at all).

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

const FIVE = inventedPaper(FIVE_PARTS);
const paper = {
  id: "arxiv:2610.00032",
  title: "Zymurgy of the tide pools",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "arxiv" as const,
  summaryIntro: "A short abstract.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
const NOW = new Date("2026-10-27T12:00:00.000Z");
const body = { paper };

function call(payload: unknown = body, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

let generateJsonText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  resetCounterStoreForTests();
  structureReviewCache.clear();
  deleteSpendableKeys();
  deployedRuntimeEnv(vi.stubEnv);
  generateJsonText = vi.fn(async (args: { userPrompt: string }) => modelDouble(args.userPrompt));
  mocks.getUser.mockResolvedValue(signedOut());
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ id: "gemini", generateJsonText });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc: FIVE.doc, attempts: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetCounterStoreForTests();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/structure — who may ask", () => {
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
    const response = await call({ paper: { ...paper, id } }, id);

    expect(response.status).toBe(404);
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it("answers a signed-in reader", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const response = await call();

    expect(response.status).toBe(200);
    expect(((await response.json()) as { cached: boolean }).cached).toBe(false);
    expect(generateJsonText).toHaveBeenCalled();
  });

  it("logs one debug line for a signed-in reader with a shortened hash of the account, never the id, and no word of the paper", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();

    const lines = debug.mock.calls.filter(([label]) => label === "[papers/structure] review");
    expect(lines).toHaveLength(1);
    const fields = lines[0][1] as Record<string, unknown>;
    expect(String(fields.userId)).toMatch(/^[0-9a-f]{12}$/);
    const all = JSON.stringify(debug.mock.calls);
    for (const word of ["reader-1", "Invented", "tide pools", "Zymurgy", "Introduction"]) expect(all).not.toContain(word);
  });

  it("counts the request against the reader's own hour, and nothing else", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    await call();
    await call();

    expect((await getCounterStore().read(rateKey("paper-structure", "reader-1", NOW), NOW)).value).toBe(2);
    expect((await getCounterStore().read(rateKey("paper-structure", "reader-2", NOW), NOW)).value).toBe(0);
  });

  it("limits a reader to 20 requests an hour, and refuses the 21st before the provider is resolved", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 20; i += 1) expect((await call()).status).toBe(200);
    mocks.resolveProvider.mockClear();
    generateJsonText.mockClear();
    const over = await call();

    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(generateJsonText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/structure — nothing per-reader in the memory", () => {
  it("serves the next reader's same document from the memory, with no model call", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call()).json()) as { cached: boolean; review: unknown };
    const calls = generateJsonText.mock.calls.length;
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call()).json()) as { cached: boolean; review: unknown };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.review).toEqual(first.review);
    expect(generateJsonText).toHaveBeenCalledTimes(calls);
  });
});
