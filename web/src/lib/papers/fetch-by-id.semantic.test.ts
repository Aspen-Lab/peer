import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchSemanticScholar: vi.fn() }));
vi.mock("@/lib/sources/semantic-scholar-client", () => ({ fetchSemanticScholar: mocks.fetchSemanticScholar }));
import { fetchPaperById } from "./fetch-by-id";

const id = "cbc4266795a13b6124294e0fb15bfcdcc29417e2";
describe("Semantic Scholar paper lookup", () => {
  beforeEach(() => mocks.fetchSemanticScholar.mockReset());
  it("retrieves a record by id with its full-text identifiers", async () => {
    mocks.fetchSemanticScholar.mockResolvedValue(new Response(JSON.stringify({ paperId: id, title: "Paper", authors: [{ name: "Author" }], externalIds: { DOI: "10.1234/example", ArXiv: "2401.12345" }, openAccessPdf: { url: "https://example.org/paper.pdf" } })));
    const paper = await fetchPaperById(`semantic_scholar:${id}`);
    expect(paper?.id).toBe(`semantic_scholar:${id}`);
    expect(paper?.metadata.externalIds?.arxivId).toBe("2401.12345");
    expect(paper?.metadata.doi).toBe("10.1234/example");
    expect(paper?.url).toBe("https://example.org/paper.pdf");
  });
  it("rejects malformed ids and handles an unavailable source", async () => {
    expect(await fetchPaperById("semantic_scholar:../../evil")).toBeNull();
    expect(mocks.fetchSemanticScholar).not.toHaveBeenCalled();
    mocks.fetchSemanticScholar.mockResolvedValue(null);
    await expect(fetchPaperById(`semantic_scholar:${id}`)).rejects.toThrow("Semantic Scholar unavailable");
  });
});
