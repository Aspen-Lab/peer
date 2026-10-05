// P0-06 (§1e.2, A's F2): `useModelReport` with its effects running.
//
// `use-model-report.test.ts` mounts the hook with `react-dom/server`, where
// effects never run: it shows the report is READ from the cache on render,
// not that the second open of a private PDF sends no request — the write that
// makes the second open free is in the effect. A's mutation M4 (drop the
// effect's `writeCached`) left every reader test green. Here the hook runs on
// `test-support/hook-runtime` and the one network entry point it uses,
// `streamPaperReport`, is counted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

const net = vi.hoisted(() => ({ streamCalls: [] as Array<Record<string, unknown>>, jsonCalls: 0 }));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: async function* (body: Record<string, unknown>) {
    net.streamCalls.push(body);
    yield { type: "mode", aiMode: "tier2" };
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
    yield {
      type: "report",
      report: {
        noLlm: false,
        depth: body.deepReport ? "deep" : "abstract",
        skim: [],
        whatItProposes: { summary: "A report asked for once.", methods: [] },
        resultsAndSignificance: { summary: "", keyResults: [] },
        provenance: { basis: "model-full-text", droppedClaims: 0 },
      },
    };
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async () => {
    net.jsonCalls += 1;
    return { noLlm: true };
  },
}));
vi.mock("@/store/profile", () => ({
  useProfileStore: (select: (state: { entitlement: null }) => unknown) => select({ entitlement: null }),
}));

import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { readingRoute } from "./reading-map";
import { useModelReport } from "./use-model-report";

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

// The reader's own key, so the hook asks a model: a placeholder string — the
// stream is stubbed, nothing leaves the process.
const profile: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key" };
const base: Paper = {
  id: "openalex:W7000000001",
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
const standalone: Paper = { ...base, id: "upload:fedcba9876543210", revision: 1, textStatus: "ok" };

async function open(paper: Paper, reader: UserProfile = profile) {
  const opened = await hookRuntime.mount(() => useModelReport({ paper, profile: reader }));
  opened.unmount();
  return opened.value;
}

describe("useModelReport with effects running — one report request across two opens (P0-06)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    net.streamCalls.length = 0;
    net.jsonCalls = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("an attached PDF: the first open asks for the deep report once, the second asks for nothing", async () => {
    const first = await open(attached);
    expect(net.streamCalls).toHaveLength(1);
    expect(net.streamCalls[0].deepReport).toBe(true);
    expect(first.report?.whatItProposes.summary).toBe("A report asked for once.");
    expect(first.fresh).toBe(true);

    const second = await open(attached);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(second.report?.whatItProposes.summary).toBe("A report asked for once.");
    expect(second.fresh).toBe(false);
  });

  it("a new revision of the attachment asks again", async () => {
    await open(attached);
    await open(attached);
    await open({ ...attached, revision: 2 });

    expect(net.streamCalls).toHaveLength(2);
  });

  it("a standalone upload: one request across two opens, a new one for a new revision", async () => {
    const deepReader = { ...profile, deepReportEnabled: true };
    await open(standalone, deepReader);
    await open(standalone, deepReader);
    expect(net.streamCalls).toHaveLength(1);
    expect(net.streamCalls[0].deepReport).toBe(true);

    await open({ ...standalone, revision: 2 }, deepReader);

    expect(net.streamCalls).toHaveLength(2);
  });

  // P1-03 (§1f.9): the reader's questions stay in this browser. With
  // questions stored for the paper, the report request is the same request.
  it("sends no question: the report request is unchanged with questions stored for the paper (P1-03)", async () => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await open(attached);

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [attached.id]: { items: ["Quillwortane creep under load"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: attached.id,
    });
    await open(attached);

    expect(net.streamCalls).toHaveLength(2);
    expect(JSON.stringify(net.streamCalls[1])).toBe(JSON.stringify(net.streamCalls[0]));
    expect(JSON.stringify(net.streamCalls[1])).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  // P1-05 (§1f.13): the route the page draws is computed beside the report,
  // in this browser; with a route present the report request is unchanged.
  it("sends no question with a route present: the report request is unchanged (P1-05)", async () => {
    const doc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Quillwortane parts creep under load. The creep rate rises with the load." }],
    };
    const reading = buildReading(attached, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } });
    const withRoute = async () => {
      const opened = await hookRuntime.mount(() => {
        const report = useModelReport({ paper: attached, profile });
        return { report, route: readingRoute(reading, useReadingQuestionsStore.getState().byPaper[attached.id]) };
      });
      opened.unmount();
      return opened.value;
    };

    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    const before = await withRoute();
    expect(before.route).toBeUndefined();

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [attached.id]: { items: ["Quillwortane creep under load"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: attached.id,
    });
    const after = await withRoute();

    expect(after.route?.vague).toBe(false);
    expect(after.route?.byQuestion[0].sections.s1.tier).toBe("read");
    expect(net.streamCalls).toHaveLength(2);
    expect(JSON.stringify(net.streamCalls[1])).toBe(JSON.stringify(net.streamCalls[0]));
    expect(JSON.stringify(net.streamCalls)).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });
});
