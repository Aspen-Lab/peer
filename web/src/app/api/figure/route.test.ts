import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

/**
 * ABC-freemium 1-09 · R-TEST-1, R-SEC-1, Ruling 2 point 7.
 *
 * `GET /api/figure` had **no authentication of any kind** and no test file at
 * all. It reaches a provider through `extractFigure` -> `chooseCandidate` -> the
 * semantic and vision matchers, which were the only two no-argument
 * `resolveProvider()` calls in the tree.
 *
 * **The money rule.** This suite drives the real handler and does not mock the
 * provider registry, so after item 1-11 an unmocked `resolveProvider()` would
 * return a live provider on the operator's real key. `vitest.setup.ts` deletes
 * `GOOGLE_API_KEY` before every suite and every test; `deleteSpendableKeys()`
 * below is the belt-and-braces call, and the "no model call" assertion is what
 * would catch a regression.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  // P0-10: the owner check and the extractor are observable; by default the
  // owner check finds nothing (no upload exists) and the extractor is the
  // real one, so the public tests below run exactly as before.
  ownedUpload: vi.fn(),
  extractFigure: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));
vi.mock("@/lib/papers/upload-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/papers/upload-access")>()),
  ownedUpload: mocks.ownedUpload,
}));
vi.mock("@/lib/figures/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/figures/extract")>()),
  extractFigure: mocks.extractFigure,
}));

import { GET, POST } from "./route";

const outgoing: string[] = [];

function recordingFetch(): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request)?.url ?? "");
    outgoing.push(url);
    // Nothing usable comes back, so the deterministic extractor finds no
    // candidates and the route answers with its "no figure" result rather than
    // reaching for a model to choose between candidates it does not have.
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

function request(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/figure");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url, { method: "GET" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof import("@/lib/figures/extract")>("@/lib/figures/extract");
  mocks.extractFigure.mockImplementation(actual.extractFigure);
  mocks.ownedUpload.mockResolvedValue(null);
  outgoing.length = 0;
  deleteSpendableKeys();
  vi.stubGlobal("fetch", recordingFetch());
  deployedRuntimeEnv(vi.stubEnv);
  mocks.getUser.mockResolvedValue(signedOut());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/figure", () => {
  it("still rejects a request with no id before doing anything", () => {
    // The 400 must stay ahead of the guard: a malformed request is not an
    // authentication problem, and answering 401 to it would be a worse message.
    return GET(request({})).then(async (response) => {
      expect(response.status).toBe(400);
      expect(mocks.getUser).not.toHaveBeenCalled();
    });
  });

  it("answers a signed-out visitor 401 and fetches nothing", async () => {
    // R-SEC-1 / D8. Before this item the same request ran the whole extractor
    // and could reach a model, with no account involved.
    mocks.getUser.mockResolvedValue(signedOut());

    const response = await GET(request({ id: "paper-1", url: "https://example.org/p" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in before using an AI feature",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Nothing upstream was touched, so an unauthenticated caller cannot make
    // this route fetch on their behalf either.
    expect(outgoing).toEqual([]);
  });

  // P0-08 (§1e.8): only the canonical `upload:<hash16>` is an upload id. A
  // malformed claim (`UPLOAD:<hash16>`) skipped the route's owner check,
  // which tested `startsWith("upload:")`, and was served as a public id with
  // a public cache header; it is not found now, before any work.
  it("answers a malformed upload claim 404, privately, before any lookup or fetch", async () => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));

    for (const id of ["UPLOAD:0123456789abcdef", "Upload:0123456789abcdef", "upload:0123456789ABCDEF"]) {
      const response = await GET(request({ id, url: "https://example.org/p" }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Upload not found." });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(outgoing).toEqual([]);
  });

  it("serves a signed-in reader without making a model call", async () => {
    // The degraded figure path is a real answer, not an error: with no provider
    // available the matchers return null and the deterministic extractor decides
    // on its own.
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));

    const response = await GET(request({ id: "paper-1", url: "https://example.org/p" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(typeof body.status).toBe("string");
    // No `GOOGLE_API_KEY` in this process, so `resolveProvider` returns null and
    // no request can have gone to a model endpoint.
    expect(
      outgoing.filter((url) => /googleapis|openai|anthropic|deepseek|dashscope/i.test(url)),
    ).toEqual([]);
  });
});

// P0-10 (§1e.10, A's F7, privacy): an upload's figure request never carries
// private text in a URL. The page used to ask
// `GET /api/figure?id=upload:<h>&query=<report text>&paperTitle=<the PDF's
// title>`, and the server's request log printed both. An upload's request is
// a POST now, its title is taken from the owner-checked record on the
// server, and a GET that carries either for an upload is refused before any
// work, so a client regression fails loudly instead of leaking quietly.
describe("POST /api/figure — an upload's figure request (P0-10)", () => {
  const HASH = "0123456789abcdef";
  const RECORD_TITLE = "A Title Only The Owner's Record Holds";
  const FOUND = {
    imageUrl: "data:image/png;base64,AAAA",
    caption: "Figure 1",
    source: "publisher",
    status: "found",
    reason: null,
    hideFigure: false,
    matchedBy: "keyword",
  };

  function post(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/figure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mocks.getUser.mockResolvedValue(signedIn("reader-1"));
    mocks.extractFigure.mockResolvedValue(FOUND);
  });

  it("serves the owner, privately, with the record's title — never a title the client sent", async () => {
    mocks.ownedUpload.mockResolvedValue({ hash16: HASH, title: RECORD_TITLE, ownerKey: "owner", revision: 1 });

    const response = await POST(post({
      id: `upload:${HASH}`, v: "12", url: `/api/papers/upload/${HASH}/file`,
      query: "words from the report", idx: 1, rev: 1, paperTitle: "a title the client made up",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(FOUND);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.ownedUpload).toHaveBeenCalledWith(HASH);
    expect(mocks.extractFigure).toHaveBeenCalledTimes(1);
    expect(mocks.extractFigure).toHaveBeenCalledWith(expect.objectContaining({
      itemId: `upload:${HASH}`,
      url: `/api/papers/upload/${HASH}/file`,
      query: "words from the report",
      paperTitle: RECORD_TITLE,
      figureIndex: 1,
    }));
  });

  it("answers anyone else 404, privately, before the extractor", async () => {
    mocks.ownedUpload.mockResolvedValue(null);

    const response = await POST(post({ id: `upload:${HASH}`, v: "12", query: "words" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Upload not found." });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.extractFigure).not.toHaveBeenCalled();
  });

  it("answers a malformed upload claim 404 without an owner lookup", async () => {
    mocks.ownedUpload.mockResolvedValue({ hash16: HASH, title: RECORD_TITLE, ownerKey: "owner" });

    for (const id of [`UPLOAD:${HASH}`, `upload:${HASH.toUpperCase()}`]) {
      const response = await POST(post({ id, query: "words" }));
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.extractFigure).not.toHaveBeenCalled();
  });

  // P0-11 (§1e.11): a public paper with a private attachment posts too, so
  // its report text stays out of a URL. Its title is public and comes from
  // the body; the answer is private like every POST's.
  it("serves a public paper's POST with the body's title, privately", async () => {
    const response = await POST(post({
      id: "openalex:W7000000003", v: "12", url: "https://example.org/a-public-paper",
      query: "words from the deep report on the attached PDF", paperTitle: "The Public Paper's Title", idx: 2, rev: 2,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(FOUND);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.extractFigure).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "openalex:W7000000003",
      query: "words from the deep report on the attached PDF",
      paperTitle: "The Public Paper's Title",
      figureIndex: 2,
    }));
  });

  it("refuses a body that is not JSON, or has no id", async () => {
    const notJson = await POST(new NextRequest("http://localhost/api/figure", { method: "POST", body: "id=upload:x" }));
    const noId = await POST(post({ query: "words" }));

    expect(notJson.status).toBe(400);
    expect(noId.status).toBe(400);
    expect(mocks.extractFigure).not.toHaveBeenCalled();
  });

  it("refuses a GET for an upload that carries a query or a title: 400 before the owner check, the gate or any fetch", async () => {
    for (const params of [
      { id: `upload:${HASH}`, query: "words from the report" } as Record<string, string>,
      { id: `upload:${HASH}`, paperTitle: "The PDF's Own Title" },
      { id: `UPLOAD:${HASH}`, query: "words" },
    ]) {
      const response = await GET(request(params));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.extractFigure).not.toHaveBeenCalled();
    expect(outgoing).toEqual([]);
  });

  // P0-12 (§1e.12): after P0-11 no client sends `rev` by GET — a paper with
  // a private attachment posts. A GET that carries `rev` together with
  // report text or a title is a client regression; it is refused before the
  // gate and any fetch, so it fails where it can be seen.
  it("refuses a GET that carries a revision and a query or a title: 400 before the gate or any fetch", async () => {
    for (const params of [
      { id: "openalex:W7000000003", rev: "2", query: "words from the deep report on the attached PDF" },
      { id: "openalex:W7000000003", rev: "2", paperTitle: "The Public Paper's Title" },
    ] as Record<string, string>[]) {
      const response = await GET(request(params));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "A paper with a private attachment asks for figures by POST." });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.extractFigure).not.toHaveBeenCalled();
    expect(outgoing).toEqual([]);

    // A GET with a revision and nothing else to leak still runs.
    const bare = await GET(request({ id: "openalex:W7000000003", rev: "2", url: "https://example.org/p" }));
    expect(bare.status).toBe(200);
  });

  it("keeps a public paper's GET as it was, query and title included", async () => {
    const response = await GET(request({ id: "openalex:W1", url: "https://example.org/p", query: "words", paperTitle: "A Public Title" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=86400, stale-while-revalidate=604800");
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.extractFigure).toHaveBeenCalledWith(expect.objectContaining({ itemId: "openalex:W1", query: "words", paperTitle: "A Public Title" }));
  });
});

