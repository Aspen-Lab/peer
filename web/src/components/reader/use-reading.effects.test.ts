// P0-06 (§1e.2, A's F2): `useReading` with its effects running.
//
// `use-reading.test.ts` mounts the hook with `react-dom/server`, where the
// fetch effect never runs: it shows a private reading is READ from the cache
// on render, not that the second open sends no request. Here the hook runs on
// `test-support/hook-runtime` and `fetch` is counted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { readingRoute } from "./reading-map";
import { useReading } from "./use-reading";

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

const base: Paper = {
  id: "openalex:W7000000002",
  title: "A Paper With A Private PDF",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
const attached: Paper = { ...base, fullTextUploadId: "upload:0123456789abcdef", revision: 1 };
const standalone: Paper = { ...base, id: "upload:fedcba9876543210", revision: 1 };

const fetches: string[] = [];

/** The private reading route's answer: always `private, no-store`. */
function serveReading(fullText: PaperReading["provenance"]["fullText"]) {
  vi.stubGlobal("fetch", async (url: string) => {
    fetches.push(url);
    const reading = buildReading(base, null);
    return new Response(JSON.stringify({ ...reading, provenance: { ...reading.provenance, fullText } }), {
      headers: { "cache-control": "private, no-store" },
    });
  });
}

async function open(paper: Paper) {
  const opened = await hookRuntime.mount(() => useReading(paper));
  opened.unmount();
  return opened.value;
}

describe("useReading with effects running — one reading request across two opens (P0-06)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    fetches.length = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("an attached PDF: fetched once across two opens; a new revision fetches again", async () => {
    serveReading("pdf");

    const first = await open(attached);
    const second = await open(attached);

    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain("?upload=upload%3A0123456789abcdef");
    expect(first.fromServer).toBe(true);
    expect(second.fromServer).toBe(true);
    expect(second.reading?.provenance.fullText).toBe("pdf");

    await open({ ...attached, revision: 2 });
    expect(fetches).toHaveLength(2);
  });

  it("a standalone upload: fetched once across two opens; a new revision fetches again", async () => {
    serveReading("pdf");

    await open(standalone);
    await open(standalone);
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toBe("/api/papers/upload%3Afedcba9876543210/reading");

    await open({ ...standalone, revision: 2 });
    expect(fetches).toHaveLength(2);
  });

  it("does not keep a private reading that came back without the full text (the timed-out answer)", async () => {
    serveReading("none");

    await open(standalone);
    await open(standalone);

    expect(fetches).toHaveLength(2);
  });

  // P1-03 (§1f.9): the reader's questions stay in this browser. With
  // questions stored for the paper, the reading request is the same request.
  it("sends no question: the request is unchanged with questions stored for the paper (P1-03)", async () => {
    serveReading("pdf");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await open(standalone);

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [standalone.id]: { items: ["Quillwortane creep under load"], gist: true, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: standalone.id,
    });
    await open(standalone);

    expect(fetches).toHaveLength(2);
    expect(fetches[1]).toBe(fetches[0]);
    expect(fetches[1]).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  // P1-05 (§1f.13): the page routes the stored questions through the
  // reading it holds, in this browser. With a route on the page the reading
  // request is still the same request.
  it("sends no question with a route present: the same request, and the route computed from what came back (P1-05)", async () => {
    const doc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [
        { id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Quillwortane parts creep under load. The creep rate rises with the load." },
        { id: "s2", heading: "2 Methods", canonical: "methods", text: "Twelve samples were cut from one ingot." },
      ],
    };
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(url);
      const reading = buildReading(base, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } });
      return new Response(JSON.stringify(reading), { headers: { "cache-control": "private, no-store" } });
    });
    const withRoute = async () => {
      const opened = await hookRuntime.mount(() => {
        const state = useReading(standalone);
        return { ...state, route: readingRoute(state.reading, useReadingQuestionsStore.getState().byPaper[standalone.id]) };
      });
      opened.unmount();
      return opened.value;
    };

    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    const before = await withRoute();
    expect(before.route).toBeUndefined();

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [standalone.id]: { items: ["Quillwortane creep under load"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: standalone.id,
    });
    const after = await withRoute();

    expect(after.route?.vague).toBe(false);
    expect(after.route?.byQuestion[0].sections.s1.tier).toBe("read");
    expect(fetches).toHaveLength(2);
    expect(fetches[1]).toBe(fetches[0]);
    expect(fetches.join(" ")).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });
});
