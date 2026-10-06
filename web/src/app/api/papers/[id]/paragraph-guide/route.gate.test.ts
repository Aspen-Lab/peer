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
import { paragraphGuideCache } from "@/lib/papers/paragraph-guide";
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";
import { explainTenthsHouseKey, explainTenthsKey } from "@/lib/usage/explain-quota";

// P3-03 (ruling §1h.6; §3d 17): the sign-in gate on the paragraph-guide route and
// what it means across readers — a stranger is refused before any text is read
// or any model asked; the gist pass is remembered by the document, so a second
// reader of the same paper is served from the memory with no model call; and
// the pass is charged to nobody (it is one small call per document per hour
// across all readers, so there is no per-reader count to take). A deployed
// runtime and a session stub, so a file of its own (the ordinary route tests
// run with no sign-in at all).

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

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 2,
  figureCaptions: [],
  sections: [
    { id: "s1", heading: "2 Methods", canonical: "methods", page: 1, text: "Specimens were machined from a single casting and heat treated together." },
  ],
};
const paper = {
  id: "arxiv:2607.00003",
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
const body = { paper };

function call(payload: unknown = body, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/paragraph-guide`, {
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
  paragraphGuideCache.clear();
  deleteSpendableKeys();
  deployedRuntimeEnv(vi.stubEnv);
  generateJsonText = vi.fn().mockResolvedValue(
    JSON.stringify({ gists: [{ sectionId: "s1", paragraphIndex: 0, gist: "Specimens machined from one casting, heat treated." }] }),
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

describe("POST /api/papers/[id]/paragraph-guide — who may ask", () => {
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
  });

  it("answers a signed-in reader", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const response = await call();

    expect(response.status).toBe(200);
    expect(((await response.json()) as { cached: boolean }).cached).toBe(false);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("limits a reader to 20 requests an hour", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    for (let i = 0; i < 20; i += 1) expect((await call()).status).toBe(200);
    const over = await call();

    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/papers/[id]/paragraph-guide — nothing per-reader in the memory, nothing charged", () => {
  it("serves the next reader's same document from the memory, with no model call", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const first = (await (await call()).json()) as { cached: boolean; guide: unknown };
    mocks.getUser.mockResolvedValue(signedIn("reader-2"));
    const second = (await (await call()).json()) as { cached: boolean; guide: unknown };

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.guide).toEqual(first.guide);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("charges no reader and the house nothing: neither explain counter moves", async () => {
    for (const reader of ["reader-1", "reader-2"]) {
      mocks.getUser.mockResolvedValue(signedIn(reader));
      await call();
    }

    expect((await getCounterStore().read(explainTenthsKey("reader-1", NOW), NOW)).value).toBe(0);
    expect((await getCounterStore().read(explainTenthsKey("reader-2", NOW), NOW)).value).toBe(0);
    expect((await getCounterStore().read(explainTenthsHouseKey(NOW), NOW)).value).toBe(0);
  });

  it("is answered to a reader whose explain allowance is spent: the two allowances are separate", async () => {
    await getCounterStore().increment(explainTenthsKey("reader-1", NOW), null, 40, NOW);
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    const response = await call();

    expect(response.status).toBe(200);
    expect(generateJsonText).toHaveBeenCalledTimes(1);
  });
});
