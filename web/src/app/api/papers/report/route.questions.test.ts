import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PaperReport } from "@/lib/papers/report";

// P2-03 (§1g.11 d): the reader's questions arrive in the report request's
// body. The route cleans them leniently (never a 400), hands them to the
// deep report on both transports, never to the abstract-tier report, and
// writes none of them to any log line.

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
  id: "arxiv:2607.00002",
  title: "A focused paper about rafting",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "This paper studies rafting in a nickel superalloy under creep.",
  summaryExperimentKeywords: ["creep"],
  summaryResultDiscussion: "Tungsten additions slowed rafting by a third at 1100 C.",
  isSaved: false,
};
const report: PaperReport = {
  skim: [{ text: "Tungsten slows rafting.", evidence: paper.summaryResultDiscussion }],
  whatItProposes: { summary: "It adds tungsten.", methods: [] },
  resultsAndSignificance: { summary: "Rafting slowed.", keyResults: [] },
  provenance: { basis: "model-fulltext", droppedClaims: 0 },
  depth: "deep",
};
const doc = { title: paper.title, source: "pdf", sections: [{ id: "s1", heading: "Results", canonical: "results", text: "Rafting slowed." }], figureCaptions: [] };

function request(body: Record<string, unknown>, accept: string): NextRequest {
  return new NextRequest("http://localhost/api/papers/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(body),
  });
}

async function send(body: Record<string, unknown>, accept: string) {
  const response = await POST(request(body, accept));
  await response.text();
  return response;
}

const TRANSPORTS = ["application/json", "application/x-ndjson"];

beforeEach(() => {
  resetCounterStoreForTests();
  vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn().mockResolvedValue(JSON.stringify(report)) });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  mocks.getFigurePool.mockResolvedValue(null);
  mocks.generateDeepReport.mockResolvedValue(report);
  mocks.bindFiguresToReport.mockResolvedValue(report);
});

afterEach(() => vi.restoreAllMocks());

describe("the report route and the reader's questions (P2-03)", () => {
  it.each(TRANSPORTS)("hands the cleaned questions to the deep report (%s)", async (accept) => {
    const response = await send({ paper, deepReport: true, questions: ["  Does tungsten delay rafting?  ", "Why 1100 C?"] }, accept);

    expect(response.status).toBe(200);
    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(1);
    expect(mocks.generateDeepReport.mock.calls[0][0].questions).toEqual(["Does tungsten delay rafting?", "Why 1100 C?"]);
  });

  it.each(TRANSPORTS)("cleans malformed questions or ignores them, and never answers 400 (%s)", async (accept) => {
    const long = `Why ${"x".repeat(300)}`;
    const cases: Array<[unknown, string[]]> = [
      ["Does tungsten delay rafting?", []],
      [[1, 2, 3], []],
      [{ 0: "Not an array" }, []],
      [null, []],
      [["Q1?", "Q2?", "Q3?", "Q4?", "Q5?", "Q6?", "Q7?"], ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]],
      [[long], [long.slice(0, 200)]],
      [["Does tungsten delay rafting?", "does TUNGSTEN delay rafting?", "  ", 7, "Why?"], ["Does tungsten delay rafting?", "Why?"]],
    ];
    for (const [questions, expected] of cases) {
      mocks.generateDeepReport.mockClear();
      const response = await send({ paper, deepReport: true, questions }, accept);
      expect(response.status).toBe(200);
      expect(mocks.generateDeepReport.mock.calls[0][0].questions ?? []).toEqual(expected);
    }
  });

  it("the same request body twice gives the deep report equal questions", async () => {
    const body = { paper, deepReport: true, questions: ["Why 1100 C?", "Does tungsten delay rafting?"] };
    await send(body, "application/x-ndjson");
    await send(body, "application/x-ndjson");

    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(2);
    expect(mocks.generateDeepReport.mock.calls[1][0].questions).toEqual(mocks.generateDeepReport.mock.calls[0][0].questions);
  });

  it.each(TRANSPORTS)("the abstract-tier report never sees them (%s)", async (accept) => {
    const generateJsonText = vi.fn().mockResolvedValue(JSON.stringify(report));
    mocks.resolveProvider.mockReturnValue({ generateJsonText });
    await send({ paper, questions: ["Quillwortane marker question?"] }, accept);

    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    expect(generateJsonText).toHaveBeenCalled();
    for (const [args] of generateJsonText.mock.calls) expect(JSON.stringify(args)).not.toContain("Quillwortane");
  });

  it.each(TRANSPORTS)("writes no question to any log line during a deep request (%s)", async (accept) => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    // Every branch that logs: a figure pool that fails, a deep report that
    // fails (and the abstract-tier fallback that follows).
    mocks.getFigurePool.mockRejectedValue(new Error("pool down"));
    mocks.generateDeepReport.mockResolvedValue(null);
    await send({ paper, deepReport: true, questions: ["Quillwortane marker question?"] }, accept);
    mocks.generateDeepReport.mockRejectedValue(new Error("deep down"));
    await send({ paper, deepReport: true, questions: ["Quillwortane marker question?"] }, accept);

    const lines = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((arg) => (arg instanceof Error ? arg.message : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("Quillwortane");
  });
});
