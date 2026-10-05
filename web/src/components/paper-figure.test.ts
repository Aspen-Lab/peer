import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P0-10: the request tests below run `useResolvedFigure`'s effect on the
// minimal hook runtime (no DOM here); the key tests are pure and unaffected.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { buildFigureRequestKey, useResolvedFigure, type ResolveFigureArgs } from "./paper-figure";
import { rawItemToPaper } from "@/lib/feed/mapper";
import { uploadMetaToPaper } from "@/lib/papers/upload-store";

// 9-15 (A9-10): `buildFigureRequestKey` is a pure extraction of the
// in-flight/settled map key so it can be unit-tested without rendering the
// hook (this project's Vitest config runs in a plain Node environment, no
// DOM). The load-bearing behavior: an optional `revision` (9-12), when
// present, must change the key — otherwise a delete-then-re-upload of the
// identical bytes (the same `itemId` hash16, a fresh lifecycle instance)
// could join an in-flight request or read a settled result left over from
// the asset's previous instance.
describe("buildFigureRequestKey", () => {
  it("is unchanged for a caller that never passes a revision (the vast majority of callers)", () => {
    const withoutField = buildFigureRequestKey({ itemId: "arxiv:2607.00001" });
    const withUndefined = buildFigureRequestKey({ itemId: "arxiv:2607.00001", revision: undefined });
    expect(withoutField).toBe(withUndefined);
  });

  it("differs when the revision differs, even with an otherwise identical itemId", () => {
    const keyRev1 = buildFigureRequestKey({ itemId: "upload:0123456789abcdef", revision: 1 });
    const keyRev2 = buildFigureRequestKey({ itemId: "upload:0123456789abcdef", revision: 2 });
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("still differs on itemId / url / doi / query / paperTitle / figureIndex as before", () => {
    const base = buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 });
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "b", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "v", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "e", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "r", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "s", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 2 }));
  });
});

// P0-10 (§1e.10, A's F7, privacy): an uploaded PDF's figure request carried
// the PDF's own title (`paperTitle`) and Peer's words about it (`query`) in
// a GET query string, which the server's request log printed. For an upload
// it is a POST now: nothing but the id, the file link and the cache-busting
// numbers can reach a URL, and the title is not sent at all (the server reads
// it from the owner's record). A public paper's GET is unchanged, byte for
// byte — its URL is what the route's day-long edge cache keys on.
describe("useResolvedFigure — the figure request (P0-10)", () => {
  const calls: Array<{ url: string; method: string; body: string | null; cache: string | undefined }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null, cache: init.cache });
      return new Response(JSON.stringify({ imageUrl: "data:image/png;base64,AAAA", caption: "Figure 1", source: "publisher", status: "found" }));
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function resolve(args: ResolveFigureArgs) {
    const opened = await hookRuntime.mount(() => useResolvedFigure(args));
    opened.unmount();
    return opened.value;
  }

  it("posts an upload's request, with no report text or title in the URL and no title in the body", async () => {
    const figure = await resolve({
      itemId: "upload:0123456789abcdef",
      url: "/api/papers/upload/0123456789abcdef/file",
      query: "  Peer's words about the private paper  ",
      paperTitle: "The Private PDF's Own Title",
      figureIndex: 1,
      revision: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/figure");
    expect(calls[0].cache).toBe("no-store");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({
      id: "upload:0123456789abcdef",
      v: "12",
      url: "/api/papers/upload/0123456789abcdef/file",
      query: "Peer's words about the private paper",
      idx: 1,
      rev: 1,
    });
    expect(calls[0].body).not.toContain("Private PDF's Own Title");
    expect(figure.imageUrl).toBe("data:image/png;base64,AAAA");
    expect(figure.status).toBe("found");
  });

  // P0-11 (§1e.11): a public paper with a private PDF attached asks for its
  // section figures with `query` = text from the deep report, which was
  // built from the private PDF. That is per-user text about private content,
  // so it travels in a body too. `revision` is the signal: only a paper with
  // a private attachment carries one (asserted below).
  it("posts for a public paper with a private attachment (it carries a revision): no report text in the URL", async () => {
    await resolve({
      itemId: "openalex:W7000000003",
      url: "https://example.org/a-public-paper",
      doi: "10.1000/public",
      query: "  Peer's words from the deep report on the attached PDF  ",
      paperTitle: "The Public Paper's Title",
      figureIndex: 3,
      revision: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("/api/figure");
    expect(calls[0].cache).toBe("no-store");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({
      id: "openalex:W7000000003",
      v: "12",
      url: "https://example.org/a-public-paper",
      doi: "10.1000/public",
      query: "Peer's words from the deep report on the attached PDF",
      paperTitle: "The Public Paper's Title",
      idx: 3,
      rev: 2,
    });
  });

  it("only a paper with a private attachment carries a revision", () => {
    // The two places a Paper gets one: the upload's own record, and the
    // supplement merge (`use-private-supplement.ts`, `revision:
    // upload.revision`). A paper from a source never does.
    const fromSource = rawItemToPaper({
      id: "openalex:W7000000004",
      source: "openalex",
      title: "A Paper From A Source",
      authors: [],
      url: "https://example.org/p",
      publishedAt: "2026-09-01",
      metadata: {},
    });
    const fromUpload = uploadMetaToPaper({
      hash16: "0123456789abcdef", fileName: "paper.pdf", title: "An Upload", uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok", revision: 1,
    });

    expect(fromSource.revision).toBeUndefined();
    expect(fromUpload.revision).toBe(1);
  });

  it("keeps a public paper's GET exactly as it was (no attachment, so no revision)", async () => {
    await resolve({
      itemId: "arxiv:2607.00001",
      url: "https://arxiv.org/abs/2607.00001",
      doi: "10.1000/xyz",
      query: "Words about a public paper",
      paperTitle: "A Public Title",
      figureIndex: 2,
    });

    expect(calls).toEqual([
      {
        url: "/api/figure?id=arxiv%3A2607.00001&v=12&url=https%3A%2F%2Farxiv.org%2Fabs%2F2607.00001&doi=10.1000%2Fxyz&query=Words+about+a+public+paper&paperTitle=A+Public+Title&idx=2",
        method: "GET",
        body: null,
        cache: "no-store",
      },
    ]);
  });
});

