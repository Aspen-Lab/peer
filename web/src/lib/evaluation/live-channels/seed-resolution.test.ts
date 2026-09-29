import { describe, expect, it } from "vitest";
import {
  resolveOpenAlexSeed,
  resolveS2Seed,
  combineSeedLookups,
} from "./seed-resolution";

describe("resolveOpenAlexSeed", () => {
  it("resolves a work id and title via the single-entity doi: lookup", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          id: "https://openalex.org/W2145737817",
          title: "Building better batteries",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await resolveOpenAlexSeed("10.1038/451652a", { fetchImpl });
    expect(result).toEqual({ workId: "W2145737817", title: "Building better batteries" });
    expect(capturedUrl).toContain("/works/doi:10.1038%2F451652a");
  });

  it("throws on a non-2xx response (e.g. an OpenAlex-unknown DOI)", async () => {
    const fetchImpl = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;

    await expect(
      resolveOpenAlexSeed("10.0000/does-not-exist", { fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("resolveS2Seed", () => {
  it("resolves a paper id and title via the paced client's DOI: lookup", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ paperId: "abc123", title: "Building better batteries" }),
        { status: 200 },
      );
    }) as unknown as typeof import("@/lib/sources/semantic-scholar-client").fetchSemanticScholar;

    const result = await resolveS2Seed("10.1038/451652a", { fetchImpl });
    expect(result).toEqual({ paperId: "abc123", title: "Building better batteries" });
    expect(capturedUrl).toContain("/paper/DOI:10.1038%2F451652a");
  });

  it("throws when the paced client returns null (its own network-failure contract)", async () => {
    const fetchImpl = (async () =>
      null) as unknown as typeof import("@/lib/sources/semantic-scholar-client").fetchSemanticScholar;

    await expect(resolveS2Seed("10.1038/451652a", { fetchImpl })).rejects.toThrow(
      /request failed/,
    );
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 429,
      })) as unknown as typeof import("@/lib/sources/semantic-scholar-client").fetchSemanticScholar;

    await expect(resolveS2Seed("10.1038/451652a", { fetchImpl })).rejects.toThrow(
      /HTTP 429/,
    );
  });
});

describe("combineSeedLookups", () => {
  it("combines two successful lookups into one resolved seed, preferring the OpenAlex title", () => {
    const result = combineSeedLookups(
      "10.1038/451652a",
      { ok: true, value: { workId: "W1", title: "OA Title" } },
      { ok: true, value: { paperId: "S1", title: "S2 Title" } },
    );
    expect(result.seed).toEqual({
      doi: "10.1038/451652a",
      openAlexWorkId: "W1",
      s2PaperId: "S1",
      title: "OA Title",
    });
    expect(result.dropped).toBeUndefined();
  });

  it("falls back to the S2 title when OpenAlex returned none", () => {
    const result = combineSeedLookups(
      "10.1038/451652a",
      { ok: true, value: { workId: "W1", title: "" } },
      { ok: true, value: { paperId: "S1", title: "S2 Title" } },
    );
    expect(result.seed?.title).toBe("S2 Title");
  });

  it("drops the whole seed when the OpenAlex lookup failed, reporting the openalex reason", () => {
    const result = combineSeedLookups(
      "10.1038/451652a",
      { ok: false, reason: "openalex-seed-resolution HTTP 404" },
      { ok: true, value: { paperId: "S1", title: "S2 Title" } },
    );
    expect(result.seed).toBeUndefined();
    expect(result.dropped).toEqual({
      doi: "10.1038/451652a",
      reason: "openalex: openalex-seed-resolution HTTP 404",
    });
  });

  it("drops the whole seed when the S2 lookup failed, reporting the s2 reason", () => {
    const result = combineSeedLookups(
      "10.1038/451652a",
      { ok: true, value: { workId: "W1", title: "OA Title" } },
      { ok: false, reason: "semantic-scholar-seed-resolution HTTP 429" },
    );
    expect(result.dropped).toEqual({
      doi: "10.1038/451652a",
      reason: "s2: semantic-scholar-seed-resolution HTTP 429",
    });
  });

  it("reports both reasons when both lookups failed", () => {
    const result = combineSeedLookups(
      "10.1038/451652a",
      { ok: false, reason: "openalex down" },
      { ok: false, reason: "s2 down" },
    );
    expect(result.dropped).toEqual({
      doi: "10.1038/451652a",
      reason: "openalex: openalex down; s2: s2 down",
    });
  });
});
