import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "@/lib/sources/types";

const mocks = vi.hoisted(() => ({
  openAlexWorkToRawItem: vi.fn(),
}));

vi.mock("@/lib/utils/openalex", () => ({
  openAlexWorkToRawItem: mocks.openAlexWorkToRawItem,
}));

import { fetchAbstract, fetchSemanticScholarText } from "./enrich";
import { fetchPaperById } from "./fetch-by-id";

/** A fetch that answers Semantic Scholar with one fixed record and everything else with 404. */
function stubFetch(s2: Record<string, unknown>, openAlexWork: unknown = { id: "W1" }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.semanticscholar.org/")) {
      return new Response(JSON.stringify(s2), { status: 200 });
    }
    if (url.startsWith("https://api.openalex.org/works/")) {
      return new Response(JSON.stringify(openAlexWork), { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bareItem = (): RawItem => ({
  id: "openalex:W1",
  source: "openalex",
  title: "A paper with no licensed abstract",
  authors: ["A. Author"],
  url: "https://doi.org/10.1000/x",
  publishedAt: "2026-09-01",
  metadata: { doi: "https://doi.org/10.1000/x" },
});

describe("Semantic Scholar abstract and TLDR", () => {
  beforeEach(() => {
    mocks.openAlexWorkToRawItem.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the TLDR apart from the abstract", async () => {
    stubFetch({ abstract: null, tldr: { text: "A machine-written line." } });

    expect(await fetchSemanticScholarText("DOI:10.1000/x")).toEqual({
      abstract: null,
      tldr: "A machine-written line.",
    });
  });

  it("fetchAbstract never returns a TLDR as the abstract", async () => {
    stubFetch({ abstract: null, tldr: { text: "A machine-written line." } });

    expect(await fetchAbstract({ doi: "10.1000/x" })).toBeNull();
  });

  it("fetchPaperById sets item.tldr from the TLDR and leaves item.abstract empty", async () => {
    stubFetch({ abstract: null, tldr: { text: "A machine-written line." } });
    mocks.openAlexWorkToRawItem.mockReturnValue(bareItem());

    const item = await fetchPaperById("openalex:W1");

    expect(item?.abstract).toBeUndefined();
    expect(item?.tldr).toBe("A machine-written line.");
  });

  it("fetchPaperById sets item.abstract from a real abstract and stops at the first hit", async () => {
    const fetchMock = stubFetch({
      abstract: "The authors' own abstract, as published.",
      tldr: { text: "A machine-written line." },
    });
    mocks.openAlexWorkToRawItem.mockReturnValue(bareItem());

    const item = await fetchPaperById("openalex:W1");

    expect(item?.abstract).toBe("The authors' own abstract, as published.");
    expect(item?.tldr).toBe("A machine-written line.");
    const s2Calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("https://api.semanticscholar.org/"),
    );
    expect(s2Calls).toHaveLength(1);
  });
});
