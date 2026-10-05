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
import { useReadingQuestionsStore } from "@/store/reading-questions";
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
});
