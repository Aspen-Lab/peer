import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFigure } from "./extract";

const FIGURE_HTML = `<!doctype html><html><body>
  <figure class="ltx_figure">
    <img src="2609.02697v1/images/original.jpg" alt="">
    <figcaption>Figure 1: Segmentation of the tumour region.</figcaption>
  </figure>
</body></html>`;

function htmlResponse(body: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("arXiv figure source", () => {
  it("reads arxiv.org/html before falling back to ar5iv", async () => {
    // ar5iv now serves a stub for recent preprints — measured across seven
    // papers from one briefing it returned "no figures" for every one, while
    // arxiv.org/html carried 26 <figure> elements for the same ids. The
    // extractor only ever asked ar5iv, so the feed had no images at all.
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(
          typeof input === "string" ? input : (input as Request).url,
        );
        seen.push(url);
        if (url.startsWith("https://arxiv.org/html/")) {
          return htmlResponse(FIGURE_HTML);
        }
        return { ok: false, status: 404, text: async () => "" } as Response;
      }),
    );

    const result = await extractFigure({ itemId: "arxiv:2609.02697" });

    const arxivNative = seen.findIndex((u) =>
      u.startsWith("https://arxiv.org/html/"),
    );
    const ar5iv = seen.findIndex((u) => u.includes("ar5iv.labs.arxiv.org"));

    expect(arxivNative).toBeGreaterThanOrEqual(0);
    // Native endpoint answered, so ar5iv is never reached.
    expect(ar5iv).toBe(-1);
    expect(result.imageUrl).toContain("arxiv.org/html/");
  });

  it("falls back to ar5iv when the native endpoint has nothing", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(
          typeof input === "string" ? input : (input as Request).url,
        );
        seen.push(url);
        if (url.startsWith("https://arxiv.org/html/")) {
          return htmlResponse("<html><body><p>no figures here</p></body></html>");
        }
        if (url.includes("ar5iv.labs.arxiv.org")) {
          return htmlResponse(FIGURE_HTML);
        }
        return { ok: false, status: 404, text: async () => "" } as Response;
      }),
    );

    // A distinct id: extract.ts memoises the candidate pool per paper, so
    // reusing the id above would replay the first test's result.
    await extractFigure({ itemId: "arxiv:2609.09999" });

    expect(seen.some((u) => u.includes("ar5iv.labs.arxiv.org"))).toBe(true);
  });
});
