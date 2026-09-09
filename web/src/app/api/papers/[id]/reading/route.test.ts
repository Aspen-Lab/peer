import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RawItem } from "@/lib/sources/types";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import zenodoDocJson from "@/lib/papers/__fixtures__/zenodo-W7208807247.doc.json";

const mocks = vi.hoisted(() => ({
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
}));

vi.mock("@/lib/papers/fetch-by-id", () => ({
  fetchPaperById: mocks.fetchPaperById,
}));
vi.mock("@/lib/papers/full-text", () => ({
  getFullText: mocks.getFullText,
}));

import { GET } from "./route";

const zenodoDoc = zenodoDocJson as unknown as ExtractedDocument;

/** The Zenodo record as `fetchPaperById` returns it. */
const zenodoItem: RawItem = {
  id: "openalex:W7208807247",
  source: "openalex",
  title: "Graph Embeddings for Protein Structure Prediction",
  authors: ["Jincheng Zhang"],
  abstract:
    "Predicting protein structure from its amino acid sequence remains a central challenge in computational biology. This work explores the potential of graph embeddings to address this challenge. We propose a novel framework where proteins are represented as graphs. We demonstrate that graph embeddings capture the structural information encoded within protein sequences.",
  url: "https://doi.org/10.5281/zenodo.22316532",
  publishedAt: "2026-09-05",
  venue: "Zenodo",
  metadata: { doi: "https://doi.org/10.5281/zenodo.22316532" },
};

const zenodoFullText: FullTextResult = {
  status: "ok",
  doc: zenodoDoc,
  sourceLink: {
    url: "https://zenodo.org/api/records/22316532/files/paper.pdf/content",
    kind: "pdf",
    label: "zenodo",
    rank: 12,
  },
  attempts: [],
};

function call(id: string, search = "") {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/reading${search}`);
  return GET(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

describe("GET /api/papers/[id]/reading", () => {
  beforeEach(() => {
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the reading with a day-long edge cache once the full text settled", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800",
    );
    const body = await res.json();
    expect(body.version).toBe(3);
    expect(body.paperId).toBe("openalex:W7208807247");
    expect(body.provenance.fullText).toBe("pdf");
    expect(body.provenance.pageCount).toBe(5);
    expect(body.provenance.sourceLabel).toBe("Zenodo PDF");
    expect(body.method).toHaveLength(2);
    expect(body.omitted).toContainEqual({ block: "findings", reason: "no_section" });
    expect(body.source).toEqual({ label: "Open the PDF", url: zenodoFullText.sourceLink?.url });

    // Resolved by id on the server, with every identifier the paper carries.
    expect(mocks.fetchPaperById).toHaveBeenCalledWith("openalex:W7208807247");
    expect(mocks.getFullText).toHaveBeenCalledWith({
      paperId: "openalex:W7208807247",
      url: "https://doi.org/10.5281/zenodo.22316532",
      doi: "10.5281/zenodo.22316532",
      arxivId: null,
      openAlexId: "W7208807247",
    });
  });

  it("caches a settled no-full-text outcome too — it is a fact about the paper", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [],
    } satisfies FullTextResult);

    const res = await call("openalex:W7208807247");

    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    const body = await res.json();
    expect(body.provenance.fullText).toBe("none");
    expect(body.omitted).toContainEqual({ block: "method", reason: "not_in_abstract" });
  });

  it("answers with the abstract alone, uncached, when the full text does not settle in time", async () => {
    vi.useFakeTimers();
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockReturnValue(new Promise<FullTextResult>(() => undefined));

    const pending = call("openalex:W7208807247");
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.provenance.fullText).toBe("none");
    expect(body.abstract.sentences.length).toBeGreaterThan(0);
  });

  it("does not cache when the full-text attempt throws", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockRejectedValue(new Error("network down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await call("openalex:W7208807247");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    quiet.mockRestore();
  });

  it("skips the edge cache on ?refresh=1", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247", "?refresh=1");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404s, uncached, for an id that resolves to nothing", async () => {
    mocks.fetchPaperById.mockResolvedValue(null);

    const res = await call("openalex:W0");

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});
