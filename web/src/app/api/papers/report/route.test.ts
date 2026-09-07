import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PaperReport } from "@/lib/papers/report";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  generateDeepReport: vi.fn(),
  buildPaywalledFallback: vi.fn(),
  bindFiguresToReport: vi.fn(),
  getFullText: vi.fn(),
  getFigurePool: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", () => ({
  resolveProvider: mocks.resolveProvider,
}));
vi.mock("@/lib/papers/deep-report", () => ({
  generateDeepReport: mocks.generateDeepReport,
  buildPaywalledFallback: mocks.buildPaywalledFallback,
}));
vi.mock("@/lib/papers/figure-binding", () => ({
  bindFiguresToReport: mocks.bindFiguresToReport,
}));
vi.mock("@/lib/papers/full-text", () => ({
  getFullText: mocks.getFullText,
}));
vi.mock("@/lib/figures/extract", () => ({
  getFigurePool: mocks.getFigurePool,
}));

import { POST } from "./route";
import type { ReportStreamEvent } from "@/lib/papers/report-stream";

const paper = {
  id: "arxiv:2607.00001",
  title: "A focused paper",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "This paper studies a focused research question about method X.",
  summaryExperimentKeywords: ["focused method"],
  summaryResultDiscussion:
    "The experiment supports the stated conclusion with a 12% improvement over the baseline.",
  isSaved: false,
};

// Every evidence sentence below is copied from the abstract above, so the
// route's verification keeps them; the paraphrase test overrides one.
const abstractSentence = paper.summaryIntro;
const resultSentence = paper.summaryResultDiscussion;

const generatedReport: PaperReport = {
  skim: [{ text: "The paper studies method X.", evidence: abstractSentence }],
  whatItProposes: {
    summary: "A generated proposal summary.",
    methods: [{ text: "A focused method.", evidence: abstractSentence }],
  },
  resultsAndSignificance: {
    summary: "A generated result summary.",
    keyResults: [
      {
        title: "Main result",
        detail: "The main generated result.",
        evidence: resultSentence,
      },
    ],
  },
  provenance: { basis: "model-abstract", droppedClaims: 0 },
  depth: "deep",
};

function request(
  body: Record<string, unknown>,
  accept = "application/x-ndjson",
): NextRequest {
  return new NextRequest("http://localhost/api/papers/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: accept,
    },
    body: JSON.stringify(body),
  });
}

async function readEvents(response: Response): Promise<ReportStreamEvent[]> {
  return (await response.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReportStreamEvent);
}

function reportEvent(events: ReportStreamEvent[]): PaperReport {
  const event = events.find((e) => e.type === "report");
  if (!event || event.type !== "report") throw new Error("no report event");
  return event.report;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/papers/report streaming", () => {
  it("emits Tier 0 mode first and performs no report-generation work", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const response = await POST(request({ paper }));
    const events = await readEvents(response);

    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(events).toEqual([
      { type: "mode", aiMode: "tier0" },
      {
        type: "stage",
        stage: "done",
        label: "Basic report ready",
        pct: 100,
      },
    ]);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    expect(mocks.getFigurePool).not.toHaveBeenCalled();
    expect(mocks.bindFiguresToReport).not.toHaveBeenCalled();
  });

  it("keeps Tier 1 shallow and makes exactly one model call", async () => {
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...generatedReport,
        depth: "abstract",
      }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const response = await POST(
      request(
        { paper, stream: true },
        "application/json",
      ),
    );
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "mode",
      "stage",
      "report",
      "stage",
    ]);
    expect(events[0]).toEqual({ type: "mode", aiMode: "tier1" });
    // The shallow path has one real step, so it emits a single low anchor and
    // lets the client ease forward. Emitting a second high stage up front
    // would slam the bar across before any work happened, then strand it.
    expect(
      events
        .filter((event) => event.type === "stage")
        .map((event) => event.pct),
    ).toEqual([20, 100]);
    const report = reportEvent(events);
    expect(report.skim[0].text).toBe(generatedReport.skim[0].text);
    expect(report.skim[0].evidenceWhere).toBe("abstract");
    expect(report.provenance).toEqual({ basis: "model-abstract", droppedClaims: 0 });
    expect(report.depth).toBe("abstract");
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    expect(mocks.getFigurePool).not.toHaveBeenCalled();
    expect(mocks.bindFiguresToReport).not.toHaveBeenCalled();
  });

  it("drops a key result whose evidence is not in the abstract and counts it in provenance.droppedClaims", async () => {
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...generatedReport,
        resultsAndSignificance: {
          summary: generatedReport.resultsAndSignificance.summary,
          keyResults: [
            ...generatedReport.resultsAndSignificance.keyResults,
            {
              title: "Paraphrased result",
              detail: "A result the model made up.",
              evidence:
                "The experiment shows a twelve percent gain compared with the baseline approach.",
            },
          ],
        },
      }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const response = await POST(request({ paper, stream: true }, "application/json"));
    const report = reportEvent(await readEvents(response));

    expect(report.resultsAndSignificance.keyResults).toHaveLength(1);
    expect(report.resultsAndSignificance.keyResults[0].title).toBe("Main result");
    expect(report.resultsAndSignificance.keyResults[0].evidenceWhere).toBe("abstract");
    expect(report.provenance.droppedClaims).toBe(1);
  });

  it("asks for relationToYourWork only when project is present", async () => {
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...generatedReport,
        relationToYourWork: {
          basedOn: "echoed by the model",
          items: [{ text: "Relates to your project.", evidence: abstractSentence }],
        },
      }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const without = reportEvent(
      await readEvents(await POST(request({ paper, stream: true }, "application/json"))),
    );
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    const promptWithout = generateJsonText.mock.calls[0][0] as { userPrompt: string };
    expect(promptWithout.userPrompt).not.toContain("relationToYourWork");
    // A relation the model volunteered against no project is not kept.
    expect(without.relationToYourWork).toBeUndefined();

    const project = "Cryo-EM reconstruction of membrane proteins";
    const withProject = reportEvent(
      await readEvents(
        await POST(request({ paper, project, stream: true }, "application/json")),
      ),
    );
    expect(generateJsonText).toHaveBeenCalledTimes(2);
    const promptWith = generateJsonText.mock.calls[1][0] as { userPrompt: string };
    expect(promptWith.userPrompt).toContain("relationToYourWork");
    expect(promptWith.userPrompt).toContain(project);
    expect(withProject.relationToYourWork?.items).toHaveLength(1);
    // `basedOn` is the project text the server holds, not the model's echo.
    expect(withProject.relationToYourWork?.basedOn).toBe(project);
  });

  it("keeps no figure at Tier 1 — nothing bound it, so a URL the model emitted is not the paper's", async () => {
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...generatedReport,
        whatItProposes: {
          ...generatedReport.whatItProposes,
          figureLabel: "Figure 1",
          figureImageUrl: "https://example.org/fig1.png",
          figureCaption: "An overview figure.",
        },
        resultsAndSignificance: {
          ...generatedReport.resultsAndSignificance,
          keyResults: [
            {
              ...generatedReport.resultsAndSignificance.keyResults[0],
              figureImageUrl: "https://example.org/fig2.png",
              figureCaption: "A result figure.",
            },
          ],
        },
      }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const report = reportEvent(
      await readEvents(await POST(request({ paper, stream: true }, "application/json"))),
    );

    expect(report.skim[0].text).toBe(generatedReport.skim[0].text);
    for (const field of ["figureLabel", "figureImageUrl", "figureCaption", "figureSource"]) {
      expect(field in report.whatItProposes).toBe(false);
      expect(field in report.resultsAndSignificance.keyResults[0]).toBe(false);
    }
    expect(mocks.bindFiguresToReport).not.toHaveBeenCalled();
  });

  it("returns the empty report, not an invented one, when the model output cannot be parsed", async () => {
    const generateJsonText = vi.fn().mockResolvedValue("not json at all");
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const report = reportEvent(
      await readEvents(await POST(request({ paper, stream: true }, "application/json"))),
    );

    expect(report.noLlm).toBe(true);
    expect(report.depth).toBe("fallback");
    expect(report.skim).toEqual([]);
    expect(report.whatItProposes.methods).toEqual([]);
    expect(report.resultsAndSignificance.keyResults).toEqual([]);
  });

  it("reuses each existing Tier 2 operation once and emits monotonic stages", async () => {
    const generateJsonText = vi.fn();
    const provider = { generateJsonText };
    const doc = {
      title: paper.title,
      source: "ar5iv",
      sections: [{ heading: "Results", canonical: "results", text: "Body text" }],
      figureCaptions: [],
      rawText: "Body text",
    };
    mocks.resolveProvider.mockReturnValue(provider);
    mocks.getFullText.mockResolvedValue({
      status: "ok",
      doc,
      attempts: [],
    });
    mocks.getFigurePool.mockResolvedValue(null);
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockResolvedValue(generatedReport);

    const response = await POST(
      request({ paper, deepReport: true, project: "My project" }),
    );
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toEqual([
      "mode",
      "stage",
      "stage",
      "stage",
      "stage",
      "report",
      "stage",
    ]);
    expect(events[0]).toEqual({ type: "mode", aiMode: "tier2" });
    expect(
      events
        .filter((event) => event.type === "stage")
        .map((event) => event.pct),
    ).toEqual([10, 35, 75, 92, 100]);
    expect(mocks.getFullText).toHaveBeenCalledTimes(1);
    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(1);
    expect(mocks.generateDeepReport.mock.calls[0][0]).toMatchObject({
      project: "My project",
      doc,
    });
    expect(mocks.getFigurePool).toHaveBeenCalledTimes(1);
    expect(mocks.bindFiguresToReport).toHaveBeenCalledTimes(1);
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("hands a paywalled paper the empty paywalled report when the model produced nothing", async () => {
    const generateJsonText = vi.fn().mockResolvedValue("");
    mocks.resolveProvider.mockReturnValue({ generateJsonText });
    mocks.getFullText.mockResolvedValue({
      status: "paywalled",
      reason: "publisher.example keeps the full text behind access",
      attempts: [],
    });
    const paywalled: PaperReport = {
      skim: [],
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-abstract", droppedClaims: 0 },
      noLlm: true,
      depth: "fallback",
      paywallNotice: "publisher.example keeps the full text behind access",
    };
    mocks.buildPaywalledFallback.mockReturnValue(paywalled);

    const report = reportEvent(
      await readEvents(await POST(request({ paper, deepReport: true }))),
    );

    expect(mocks.buildPaywalledFallback).toHaveBeenCalledWith(
      "publisher.example keeps the full text behind access",
    );
    expect(report).toEqual(paywalled);
    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/report JSON fallback", () => {
  it("preserves the non-streaming JSON response", async () => {
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({
        ...generatedReport,
        depth: "abstract",
      }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const response = await POST(
      request({ paper }, "application/json"),
    );
    const report = (await response.json()) as PaperReport;

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(report.whatItProposes.summary).toBe(
      generatedReport.whatItProposes.summary,
    );
    expect(report.skim[0].text).toBe(generatedReport.skim[0].text);
    expect(report.provenance.basis).toBe("model-abstract");
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});
