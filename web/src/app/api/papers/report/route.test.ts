import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PaperReport } from "@/lib/papers/report";

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  generateDeepReport: vi.fn(),
  buildPaywalledFallback: vi.fn(),
  bindFiguresToReport: vi.fn(),
  getFullText: vi.fn(),
  getFigurePool: vi.fn(),
}));

// ABC-freemium 1-06 — the routes now ask the registry whether the request
// carries a usable BYOK override, so the metering wrapper can attribute the
// call. The mock must export it or the module has a hole where a real function
// used to be.
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(), ownedUpload: mocks.ownedUpload,
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
import {
  InMemoryCounterStore,
  resetCounterStoreForTests,
} from "@/lib/usage/counters";
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
  // The counter store is memoised per module, and the gate's hourly rate limit
  // counts in it, so without this every test in the file spends the same hour.
  // Resetting it is what keeps each case independent.
  resetCounterStoreForTests();
  vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
});

describe("owner-only full article supplement", () => {
  it.each(["application/json", "application/x-ndjson"])("uses the uploaded text and figures while retaining the original paper (%s)", async (accept) => {
    const fullTextUploadId = "upload:0123456789abcdef";
    mocks.ownedUpload.mockResolvedValue({ paperIds: [paper.id] });
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn() });
    const doc = { title: paper.title, source: "pdf", sections: [{ heading: "Results", canonical: "results", text: "Full article results." }], figureCaptions: [] };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
    mocks.getFigurePool.mockResolvedValue({ entries: [{ imageUrl: "data:image/png;base64,test" }], attempted: true });
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockResolvedValue(generatedReport);
    const response = await POST(request({ paper: { ...paper, fullTextUploadId }, deepReport: true }, accept));
    if (accept.includes("ndjson")) await readEvents(response); else await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(mocks.getFullText).toHaveBeenCalledWith(expect.objectContaining({ paperId: fullTextUploadId }));
    expect(mocks.getFigurePool).toHaveBeenCalledWith(expect.objectContaining({ itemId: fullTextUploadId }));
    expect(mocks.generateDeepReport).toHaveBeenCalledWith(expect.objectContaining({ paper: expect.objectContaining({ id: paper.id }), doc }));
  });
  it("refuses another user's upload before any text, figure or model work", async () => {
    const response = await POST(request({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" }, deepReport: true }));
    expect(response.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.getFigurePool).not.toHaveBeenCalled();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });
  // P0-05 (§1e.1, A's F1): only the canonical `upload:<hash16>` is an
  // upload id. A case variant used to skip this route's owner check (it
  // tested `startsWith("upload:")`) while the full-text reader still read
  // the PDF; it is now refused as "not found" before any text, figure or
  // model work — on both transports, and even where the owner check would
  // pass for the canonical id.
  it.each(["application/json", "application/x-ndjson"])("refuses a non-canonical upload id with 404 before any work (%s)", async (accept) => {
    mocks.ownedUpload.mockResolvedValue({ paperIds: [paper.id], revision: 1 });
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn() });
    const hash = "0123456789abcdef";
    const bodies = [
      { paper: { ...paper, id: `UPLOAD:${hash}` }, deepReport: true },
      { paper: { ...paper, id: `Upload:${hash}` }, deepReport: true },
      { paper: { ...paper, id: `upload:${hash.toUpperCase()}` }, deepReport: true },
      { paper: { ...paper, fullTextUploadId: `UPLOAD:${hash}` }, deepReport: true },
      { paper: { ...paper, fullTextUploadId: "" }, deepReport: true },
    ];
    for (const body of bodies) {
      const response = await POST(request(body, accept));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Upload not found." });
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.getFigurePool).not.toHaveBeenCalled();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
  });

  it("refuses an owned PDF attached to a different article", async () => {
    mocks.ownedUpload.mockResolvedValue({ paperIds: ["arxiv:different"] });
    const response = await POST(request({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" } }));
    expect(response.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  // 9-14 (A9-13, matrix C5): the deep-report generation (full text + two
  // model passes + figure binding) can run close to a minute; a
  // delete/block/replace landing during that window must not let a stale
  // report land.
  it("returns 410 (JSON) when the upload's revision changed while the deep report was generating", async () => {
    const fullTextUploadId = "upload:0123456789abcdef";
    mocks.ownedUpload
      .mockResolvedValueOnce({ paperIds: [paper.id], revision: 1 }) // the initial ownership check
      .mockResolvedValueOnce({ paperIds: [paper.id], revision: 2 }); // the post-generation re-check
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn() });
    const doc = { title: paper.title, source: "pdf", sections: [{ heading: "Results", canonical: "results", text: "Full article results." }], figureCaptions: [] };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
    mocks.getFigurePool.mockResolvedValue({ entries: [{ imageUrl: "data:image/png;base64,test" }], attempted: true });
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockResolvedValue(generatedReport);

    const response = await POST(request({ paper: { ...paper, fullTextUploadId }, deepReport: true }, "application/json"));

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toBe("Upload no longer available");
  });

  it("returns 410 (JSON) when the upload was deleted while the deep report was generating", async () => {
    const fullTextUploadId = "upload:0123456789abcdef";
    mocks.ownedUpload
      .mockResolvedValueOnce({ paperIds: [paper.id], revision: 1 })
      .mockResolvedValueOnce(null);
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn() });
    const doc = { title: paper.title, source: "pdf", sections: [{ heading: "Results", canonical: "results", text: "Full article results." }], figureCaptions: [] };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
    mocks.getFigurePool.mockResolvedValue({ entries: [{ imageUrl: "data:image/png;base64,test" }], attempted: true });
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockResolvedValue(generatedReport);

    const response = await POST(request({ paper: { ...paper, fullTextUploadId }, deepReport: true }, "application/json"));

    expect(response.status).toBe(410);
  });

  it("emits an error event (NDJSON) instead of a stale report when the revision changed mid-flight", async () => {
    const fullTextUploadId = "upload:0123456789abcdef";
    mocks.ownedUpload
      .mockResolvedValueOnce({ paperIds: [paper.id], revision: 1 })
      .mockResolvedValueOnce({ paperIds: [paper.id], revision: 2 });
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn() });
    const doc = { title: paper.title, source: "pdf", sections: [{ heading: "Results", canonical: "results", text: "Full article results." }], figureCaptions: [] };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
    mocks.getFigurePool.mockResolvedValue({ entries: [{ imageUrl: "data:image/png;base64,test" }], attempted: true });
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockResolvedValue(generatedReport);

    const response = await POST(request({ paper: { ...paper, fullTextUploadId }, deepReport: true }, "application/x-ndjson"));
    const events = await readEvents(response);

    expect(events.some((e) => e.type === "error" && e.message === "Upload no longer available")).toBe(true);
    expect(events.some((e) => e.type === "report")).toBe(false);
  });
});

describe("POST /api/papers/report streaming", () => {
  it("emits Tier 0 mode first and performs no report-generation work", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const response = await POST(request({ paper }));
    const events = await readEvents(response);

    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store, no-transform");
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

/**
 * A deep report is not allowanced, counted or capped by Peer. The model runs on
 * the reader's own key, so there is no spend of Peer's to protect; what protects
 * Peer's server (the full-text fetch, the PDF parse) is the gate's hourly rate
 * limit, which every request below passes through.
 *
 * **Drive the request shape the app actually sends.**
 * `lib/papers/report-stream.ts` sends `Accept: application/x-ndjson` on every
 * request, so that header is not an option here — it is the product. The
 * counter store is observed directly, by spying on its `increment`, rather than
 * inferred from the response: a response looks identical whether or not
 * anything was counted.
 */
describe("POST /api/papers/report — a deep report is not metered by Peer", () => {
  /** The deep request the papers page builds, verbatim in shape. */
  const deepBody = { paper, deepReport: true };

  function spyOnCounter() {
    // Spied on the class rather than the module: `getCounterStore()` memoises,
    // and the route resolves its own store inside the request.
    return vi.spyOn(InMemoryCounterStore.prototype, "increment");
  }

  /** Every key the request touched in the shared counter store. */
  function keysTouched(spy: ReturnType<typeof spyOnCounter>): string[] {
    return spy.mock.calls.map(([key]) => String(key));
  }

  beforeEach(() => {
    const generateJsonText = vi
      .fn()
      .mockResolvedValue(JSON.stringify(generatedReport));
    mocks.resolveProvider.mockReturnValue({ generateJsonText });
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: { text: "Body." } });
    mocks.getFigurePool.mockResolvedValue(null);
    mocks.generateDeepReport.mockResolvedValue(generatedReport);
    mocks.bindFiguresToReport.mockImplementation((report: PaperReport) => report);
  });

  it("runs a STREAMED deep report and writes no allowance counter of any kind", async () => {
    const increments = spyOnCounter();

    const response = await POST(request(deepBody));
    const events = await readEvents(response);

    expect(events.map((event) => event.type)).toContain("report");
    expect(events).toContainEqual({ type: "mode", aiMode: "tier2" });
    // The only counter this request may touch is the gate's hourly rate limit
    // (which a runtime with no sign-in configured does not even count).
    expect(
      keysTouched(increments).filter((key) => !key.startsWith("rate:")),
    ).toEqual([]);
  });

  it("runs a deep report on the JSON transport with no allowance counter either", async () => {
    const increments = spyOnCounter();

    const response = await POST(request(deepBody, "application/json"));
    await response.json();

    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(1);
    expect(
      keysTouched(increments).filter((key) => !key.startsWith("rate:")),
    ).toEqual([]);
  });

  it("never refuses a reader a deep report for having read too many", async () => {
    // The old free allowance was five a month. Seven in a row must all be
    // deep reads now, on both transports.
    for (let i = 0; i < 7; i += 1) {
      const events = await readEvents(await POST(request(deepBody)));
      expect(events).toContainEqual({ type: "mode", aiMode: "tier2" });
      expect(events.some((event) => (event as { type: string }).type === "quota")).toBe(false);
    }
    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(7);
  });

  it("streams a SHALLOW request as the abstract tier, with no quota notice", async () => {
    const events = await readEvents(await POST(request({ paper })));

    expect(events).toContainEqual({ type: "mode", aiMode: "tier1" });
    expect(events.some((event) => (event as { type: string }).type === "quota")).toBe(false);
    expect(mocks.generateDeepReport).not.toHaveBeenCalled();
  });

  // ── F6 (P2-07, §1g.9; B's guide P2-07-B §3) ──────────────────────────
  // The provider is resolved ONCE, first (after the sign-in gate and the owner
  // checks), and handed to whichever transport answers; a deep request with no
  // provider that can write is a tier 0 answer that reads nothing and asks
  // nothing. (P4-00: this was "the unit is charged only once a provider can
  // write"; there is no unit any more, so the cases about the charge, the spent
  // allowance and the company budget's refusal went with it, and what is left is
  // the resolution order, which the stream's tier 0 exit and the JSON fallback
  // still share.)
  describe("F6 — the provider is resolved once, before any text is read (P2-07)", () => {
    const attached = { paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" }, deepReport: true };
    const TRANSPORTS = ["application/json", "application/x-ndjson"] as const;
    const TIER0 = [
      { type: "mode", aiMode: "tier0" },
      { type: "stage", stage: "done", label: "Basic report ready", pct: 100 },
    ];

    beforeEach(() => {
      mocks.ownedUpload.mockResolvedValue({ paperIds: [paper.id], revision: 1 });
    });

    it.each(TRANSPORTS)("(1) no provider → tier 0: no text read, no model asked, no allowance counter (%s)", async (accept) => {
      mocks.resolveProvider.mockReturnValue(null);
      const increments = spyOnCounter();

      const response = await POST(request(attached, accept));
      if (accept === "application/x-ndjson") {
        expect(await readEvents(response)).toEqual(TIER0);
      } else {
        const body = (await response.json()) as PaperReport;
        expect(body.noLlm).toBe(true);
        expect(body).not.toHaveProperty("quota");
      }

      expect(response.status).toBe(200);
      expect(keysTouched(increments).filter((key) => !key.startsWith("rate:"))).toEqual([]);
      expect(mocks.getFullText).not.toHaveBeenCalled();
      expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    });

    it.each(TRANSPORTS)("(1) a provider without generateJsonText → the same tier 0 (%s)", async (accept) => {
      mocks.resolveProvider.mockReturnValue({});

      const response = await POST(request(attached, accept));
      if (accept === "application/x-ndjson") expect(await readEvents(response)).toEqual(TIER0);
      else expect(((await response.json()) as PaperReport).noLlm).toBe(true);

      expect(mocks.getFullText).not.toHaveBeenCalled();
      expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    });

    it.each(TRANSPORTS)("(3) a provider present → one resolution, one deep report, and no counter but the gate's hour (%s)", async (accept) => {
      const increments = spyOnCounter();

      const response = await POST(request(attached, accept));
      expect(response.status).toBe(200);
      if (accept === "application/x-ndjson") {
        const events = await readEvents(response);
        expect(events[0]).toEqual({ type: "mode", aiMode: "tier2" });
        expect(events.map((event) => event.type)).toContain("report");
      } else {
        await response.json();
      }

      expect(mocks.generateDeepReport).toHaveBeenCalledTimes(1);
      expect(mocks.resolveProvider).toHaveBeenCalledTimes(1);
      expect(keysTouched(increments).filter((key) => !key.startsWith("rate:"))).toEqual([]);
    });

    it.each(TRANSPORTS)("(6) a shallow request reads no full text and builds no deep report (%s)", async (accept) => {
      await POST(request({ paper }, accept)).then((r) => r.text());

      expect(mocks.getFullText).not.toHaveBeenCalled();
      expect(mocks.generateDeepReport).not.toHaveBeenCalled();
    });
  });
});

/**
 * Every model failure on this route degrades to the report with no model layer
 * (200, `noLlm: true`), never a 500 or an unhandled rejection, and never carries
 * a notice about a budget: there is no Peer budget to refuse a call.
 */
describe("POST /api/papers/report — a failed model call degrades quietly", () => {
  beforeEach(() => {
    mocks.getFigurePool.mockResolvedValue(null);
    mocks.resolveProvider.mockReturnValue({
      generateJsonText: vi.fn().mockRejectedValue(new Error("upstream 500")),
    });
  });

  it("a shallow JSON request whose model call fails returns the empty report, 200", async () => {
    const response = await POST(request({ paper }, "application/json"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as PaperReport & { quota?: unknown };

    expect(body.noLlm).toBe(true);
    expect(body.quota).toBeUndefined();
  });

  it("the streamed shallow path ends in a report event whose shape is the same degraded report", async () => {
    const events = await readEvents(await POST(request({ paper })));

    expect(events).toContainEqual({ type: "mode", aiMode: "tier1" });
    const report = reportEvent(events);
    expect(report.noLlm).toBe(true);
    expect(events.some((event) => (event as { type: string }).type === "quota")).toBe(false);
  });

  it("a DEEP request whose deep attempt throws still falls back to the shallow degrade shape, 200", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: { text: "Body." } });
    mocks.generateDeepReport.mockRejectedValue(new Error("upstream 500"));

    const response = await POST(request({ paper, deepReport: true }, "application/json"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as PaperReport;

    expect(body.noLlm).toBe(true);
    expect(mocks.bindFiguresToReport).not.toHaveBeenCalled();
  });
});
