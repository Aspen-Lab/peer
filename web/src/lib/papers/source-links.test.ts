import { afterEach, describe, expect, it, vi } from "vitest";
import { collectSourceLinks, lookupZenodoLinks } from "./source-links";

const ZENODO_RECORD = {
  files: [
    { key: "notes.txt", links: { self: "https://zenodo.org/api/records/1/files/notes.txt/content" } },
    { key: "Paper.pdf", links: { self: "https://zenodo.org/api/records/1/files/Paper.pdf/content" } },
  ],
};

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectSourceLinks — arXiv", () => {
  it("tries arxiv.org/html before ar5iv, and the PDF last", async () => {
    const spy = stubFetch(() => new Response("{}", { status: 404 }));
    const links = await collectSourceLinks({ arxivId: "2609.02697" });
    expect(links.map((l) => [l.label, l.kind, l.url])).toEqual([
      ["arxiv-html", "html", "https://arxiv.org/html/2609.02697"],
      ["ar5iv", "html", "https://ar5iv.labs.arxiv.org/html/2609.02697"],
      ["ar5iv", "pdf", "https://arxiv.org/pdf/2609.02697"],
    ]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("lookupZenodoLinks", () => {
  it("ignores non-Zenodo DOIs without a request", async () => {
    const spy = stubFetch(() => new Response("{}"));
    expect(await lookupZenodoLinks("10.1038/s41598-026-64923-9")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the deposited PDF from the records API", async () => {
    const spy = stubFetch((url) =>
      url.startsWith("https://zenodo.org/api/records/22316532")
        ? new Response(JSON.stringify(ZENODO_RECORD), { headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 }),
    );
    expect(await lookupZenodoLinks("https://doi.org/10.5281/zenodo.22316532")).toEqual([
      { url: "https://zenodo.org/api/records/1/files/Paper.pdf/content", kind: "pdf", label: "zenodo", rank: 12 },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("outranks the DOI landing page in the collected list", async () => {
    stubFetch((url) =>
      url.startsWith("https://zenodo.org/api/records/")
        ? new Response(JSON.stringify(ZENODO_RECORD), { headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 404 }),
    );
    const links = await collectSourceLinks({
      doi: "10.5281/zenodo.22316532",
      url: "https://doi.org/10.5281/zenodo.22316532",
    });
    const zenodo = links.findIndex((l) => l.label === "zenodo");
    const landing = links.findIndex((l) => l.url === "https://doi.org/10.5281/zenodo.22316532");
    expect(zenodo).toBeGreaterThanOrEqual(0);
    expect(landing).toBeGreaterThan(zenodo);
  });
});
