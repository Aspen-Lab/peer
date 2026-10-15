import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PaperReport } from "@/lib/papers/report";

// P2-08b (§1g.17, O2): a reader who stops reading a streamed deep report —
// the page aborts the request whenever its key or its paper changes — closes
// the stream's controller under the flow; the next `enqueue` then throws
// "Controller is already closed". That is an ordinary event, not a failure,
// and used to be logged at error level, burying real errors. It is a debug
// line now, and no line carries a question or any paper text.

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  generateDeepReport: vi.fn(),
  buildPaywalledFallback: vi.fn(),
  bindFiguresToReport: vi.fn(),
  getFullText: vi.fn(),
  getFigurePool: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...(await original<typeof import("@/lib/papers/upload-access")>()),
  ownedUpload: mocks.ownedUpload,
}));
vi.mock("@/lib/papers/deep-report", () => ({
  generateDeepReport: mocks.generateDeepReport,
  buildPaywalledFallback: mocks.buildPaywalledFallback,
}));
vi.mock("@/lib/papers/figure-binding", () => ({ bindFiguresToReport: mocks.bindFiguresToReport }));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));
vi.mock("@/lib/figures/extract", () => ({ getFigurePool: mocks.getFigurePool }));

import { POST } from "./route";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

const paper = {
  id: "arxiv:2607.00003",
  title: "A focused paper about creep",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "This paper studies creep in a nickel superalloy under load.",
  summaryExperimentKeywords: ["creep"],
  summaryResultDiscussion: "Tungsten additions slowed creep by a third at 1100 C.",
  isSaved: false,
};
const report: PaperReport = {
  skim: [{ text: "Tungsten slows creep.", evidence: paper.summaryResultDiscussion }],
  whatItProposes: { summary: "It adds tungsten.", methods: [] },
  resultsAndSignificance: { summary: "Creep slowed.", keyResults: [] },
  provenance: { basis: "model-fulltext", droppedClaims: 0 },
  depth: "deep",
};
const doc = { title: paper.title, source: "pdf", sections: [{ id: "s1", heading: "Results", canonical: "results", text: "Creep slowed." }], figureCaptions: [] };

const QUESTION = "Quillwortane marker question about creep?";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/papers/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ paper, deepReport: true, questions: [QUESTION] }),
  });
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;

const text = (args: unknown[]) => args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");

beforeEach(() => {
  resetCounterStoreForTests();
  vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn().mockResolvedValue(JSON.stringify(report)) });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  mocks.getFigurePool.mockResolvedValue(null);
  mocks.bindFiguresToReport.mockResolvedValue(report);
});

afterEach(() => vi.restoreAllMocks());

describe("a client abort of a streaming deep report (P2-08b, O2)", () => {
  it("is a debug line, not an error, and carries no question", async () => {
    const spies = Object.fromEntries(LEVELS.map((level) => [level, vi.spyOn(console, level).mockImplementation(() => {})]));
    const lines = (level: (typeof LEVELS)[number]): string[] => (spies[level].mock.calls as unknown[][]).map(text);
    // The deep report is held mid-flight while the reader goes away.
    let release!: (value: PaperReport) => void;
    mocks.generateDeepReport.mockReturnValue(new Promise<PaperReport>((resolve) => (release = resolve)));

    const response = await POST(request());
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();

    release(report);
    // Let the flow reach its next `send` and whatever it does about a closed stream.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const errors = lines("error");
    expect(errors.filter((line) => line.includes("streaming flow failed"))).toEqual([]);
    expect(errors).toEqual([]);
    const debug = lines("debug");
    expect(debug).toHaveLength(1);
    expect(debug[0]).toContain("[papers/report]");
    expect(debug[0]).toMatch(/reader disconnected/);
    for (const level of LEVELS) for (const line of lines(level)) expect(line).not.toContain("Quillwortane");
  });

  it("a genuine failure after the abort still logs at error level", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    let fail!: (reason: Error) => void;
    mocks.generateDeepReport.mockReturnValue(new Promise<PaperReport>((_resolve, reject) => (fail = reject)));

    const response = await POST(request());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    fail(new Error("provider down"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Quiet only for the reader's own disconnect: a provider error is still one.
    expect(error.mock.calls.map((args) => args.map(String).join(" ")).some((line) => line.includes("streaming flow failed"))).toBe(true);
  });
});
