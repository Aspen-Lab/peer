import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { buildReadingKey, rememberReading, useReading } from "./use-reading";

// 9-15 (A9-10): same reasoning as use-model-report.test.ts's coverage of
// buildReportKey — a pure extraction so the key's revision-awareness is
// testable without rendering the hook.
describe("buildReadingKey", () => {
  it("returns the paperId|public|'' shape with no upload id or revision", () => {
    expect(buildReadingKey("arxiv:2607.00001", undefined, undefined)).toBe("arxiv:2607.00001|public|");
  });

  it("includes the upload id when present", () => {
    expect(buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", undefined))
      .toBe("arxiv:2607.00001|upload:0123456789abcdef|");
  });

  it("differs when the revision differs, even with the same paperId and uploadId", () => {
    const keyRev1 = buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", 1);
    const keyRev2 = buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", 2);
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("is unchanged for a paper with no revision at all (the vast majority of papers)", () => {
    expect(buildReadingKey("arxiv:2607.00001", undefined, undefined))
      .toBe(buildReadingKey("arxiv:2607.00001", undefined, undefined));
  });
});

// P0-02 (spec D0): a private PDF's reading is kept in the browser under the
// key that names the upload and its revision (`buildReadingKey`), instead of
// never, so the second open reads it back. Mounted through the server
// renderer (no DOM in this project's Vitest; the cache read happens during
// render). Effects — the request — do not run, so nothing is fetched.
describe("useReading — private PDF reading cache (P0-02)", () => {
  function memoryStorage(): Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, String(value)),
    };
  }

  const upload: Paper = {
    id: "upload:fedcba9876543210",
    revision: 1,
    title: "A Private Upload",
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: false,
  };
  const supplement: Paper = { ...upload, id: "openalex:W7000000002", fullTextUploadId: "upload:0123456789abcdef" };

  /** The reading the server would have answered: the record's own, marked
   *  as read from the PDF so it can be told from the first-paint one. */
  function serverReading(paper: Paper): PaperReading {
    const reading = buildReading(paper, null);
    return { ...reading, provenance: { ...reading.provenance, fullText: "pdf", pageCount: 9 } };
  }

  function mount(paper: Paper): string {
    function Probe() {
      const { reading, fromServer } = useReading(paper);
      return createElement("p", null, `${fromServer ? "hit" : "miss"}:${reading?.provenance.pageCount ?? "-"}`);
    }
    return renderToStaticMarkup(createElement(Probe));
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads a standalone upload's reading back on the second mount", () => {
    expect(mount(upload)).toContain("miss:-");
    rememberReading(buildReadingKey(upload.id, undefined, 1), serverReading(upload));

    expect(mount(upload)).toContain("hit:9");
  });

  it("reads a supplement's reading back on the second mount", () => {
    rememberReading(buildReadingKey(supplement.id, supplement.fullTextUploadId, 1), serverReading(supplement));

    expect(mount(supplement)).toContain("hit:9");
  });

  it("misses when the upload's revision changes", () => {
    rememberReading(buildReadingKey(upload.id, undefined, 1), serverReading(upload));

    expect(mount({ ...upload, revision: 2 })).toContain("miss:-");
  });
});
