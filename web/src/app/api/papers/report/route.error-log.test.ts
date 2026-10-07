import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";

// P4-00c (N6, A's P4-00b): a failed report logs the error's KIND, never the error.
//
// A provider's error message may echo the request that caused it (a 400 that
// quotes the prompt back), and the report's prompts carry the reader's project
// text and, on the deep path, the paper's text and the reader's questions. The
// explain and paragraph-guide routes already log `err.name` for that reason; the
// report route logged the whole error in its three catch blocks (shallow, deep
// JSON, deep stream). Each block gets a case: a provider failure whose message
// echoes a sentinel leaves the sentinel in no console call, at any level, and the
// line that is logged names the kind. Sentinels are invented strings.

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

const PROJECT_SENTINEL = "ZXQPROJECTTEXT-the-reader-is-studying-an-invented-alloy";
const ECHO_SENTINEL = "ZXQPROVIDERECHO-a-prompt-quoted-back-in-an-error";
const QUESTION_SENTINEL = "ZXQQUESTIONTEXT-does-an-invented-thing-happen";

const paper = {
  id: "arxiv:2607.00005",
  title: "A focused paper about an invented alloy",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "This paper studies creep in an invented alloy under load.",
  summaryExperimentKeywords: ["creep"],
  summaryResultDiscussion: "Additions slowed creep by a third at 1100 C.",
  isSaved: false,
};
const doc = {
  title: paper.title,
  source: "pdf",
  sections: [{ id: "s1", heading: "Results", canonical: "results", text: "Creep slowed." }],
  figureCaptions: [],
};

function request(body: Record<string, unknown>, accept: string): NextRequest {
  return new NextRequest("http://localhost/api/papers/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(body),
  });
}

/** An error the way a provider's client throws one: its message quotes what was sent. */
function echoingError(prompt: string): Error {
  const err = new Error(`400 Bad Request: could not process "${prompt}" ${ECHO_SENTINEL}`);
  err.cause = { echoed: ECHO_SENTINEL };
  return err;
}

let consoleText: ConsoleCapture;

beforeEach(() => {
  resetCounterStoreForTests();
  vi.clearAllMocks();
  consoleText = captureConsole();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  mocks.getFigurePool.mockResolvedValue(null);
});

afterEach(() => {
  consoleText.restore();
  vi.restoreAllMocks();
});

describe("POST /api/papers/report — a failure logs the error's kind, not the error", () => {
  it("shallow: a provider error that quotes the prompt, which holds the reader's project text, leaves none of it in the log", async () => {
    mocks.resolveProvider.mockReturnValue({
      generateJsonText: vi.fn(async ({ userPrompt }: { userPrompt: string }) => {
        throw echoingError(userPrompt);
      }),
    });

    const response = await POST(request({ paper, project: PROJECT_SENTINEL }, "application/json"));

    // The reader still gets the reading without a model, and the failure is logged.
    expect(response.status).toBe(200);
    expect(consoleText.text()).toContain("[papers/report] shallow generation failed: Error");
    expect(consoleText.text()).not.toContain(PROJECT_SENTINEL);
    expect(consoleText.text()).not.toContain(ECHO_SENTINEL);
  });

  it("shallow: a thrown value that is not an Error is logged as its type", async () => {
    mocks.resolveProvider.mockReturnValue({
      generateJsonText: vi.fn(async () => {
        throw `${ECHO_SENTINEL}`;
      }),
    });

    await POST(request({ paper, project: PROJECT_SENTINEL }, "application/json"));

    expect(consoleText.text()).toContain("[papers/report] shallow generation failed: string");
    expect(consoleText.text()).not.toContain(ECHO_SENTINEL);
  });

  it("deep (JSON): a failed deep report that quotes the questions leaves none of it in the log, and the reader gets the abstract report", async () => {
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn().mockResolvedValue("{}") });
    mocks.generateDeepReport.mockRejectedValue(echoingError(QUESTION_SENTINEL));

    const response = await POST(
      request({ paper, deepReport: true, project: PROJECT_SENTINEL, questions: [QUESTION_SENTINEL] }, "application/json"),
    );

    expect(response.status).toBe(200);
    expect(mocks.generateDeepReport).toHaveBeenCalledTimes(1);
    expect(consoleText.text()).toContain("[papers/report] deep flow failed: Error");
    for (const sentinel of [ECHO_SENTINEL, QUESTION_SENTINEL, PROJECT_SENTINEL]) {
      expect(consoleText.text()).not.toContain(sentinel);
    }
  });

  it("deep (stream): a failed deep report that quotes the questions leaves none of it in the log, and the stream says it could not finish", async () => {
    mocks.resolveProvider.mockReturnValue({ generateJsonText: vi.fn().mockResolvedValue("{}") });
    mocks.generateDeepReport.mockRejectedValue(echoingError(QUESTION_SENTINEL));

    const response = await POST(
      request({ paper, deepReport: true, project: PROJECT_SENTINEL, questions: [QUESTION_SENTINEL] }, "application/x-ndjson"),
    );
    const streamed = await response.text();

    expect(streamed).toContain("Peer could not finish the report stream.");
    expect(consoleText.text()).toContain("[papers/report] streaming flow failed: Error");
    for (const sentinel of [ECHO_SENTINEL, QUESTION_SENTINEL, PROJECT_SENTINEL]) {
      expect(consoleText.text()).not.toContain(sentinel);
      // Nor does the stream carry it back to the browser: the message is fixed.
      expect(streamed).not.toContain(sentinel);
    }
  });
});
