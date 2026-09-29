import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/lib/decisions/jev-client";
import { FEED_INTENT_VERSION } from "@/lib/feed/intent";
import type { JevSmokeInput } from "./inputs";
import { DEFAULT_JEV_SMOKE_CEILING, runJevSmoke, type JevSmokeSummary } from "./runner";

// JEV-DIRECT (§1aa point 6) — unit tests for the runner's OWN orchestration
// (ceiling enforcement, result shape, output writing), entirely with
// injected fakes. NEVER makes a real network call or touches the real
// filesystem — `fetchImpl` and `writeOutput` are always injected here, and
// `JEV_API_KEY` is stubbed with an obviously-fake value only for the
// duration of each test (vitest.setup.ts's conditional second-layer lock
// would otherwise strip it anyway; this file exercises the module directly,
// not through the opt-in smoke config).

const FAKE_API_KEY = "jev-smoke-test-FAKE-KEY-do-not-use-1234567890abcdef";
const NOW = new Date("2026-09-27T00:00:00.000Z");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Real rubric.ts criteria per question id (copied verbatim — JEV_SMOKE_INPUTS'
 * `clear-match` input asks `sense_match`, whose criteria differ from
 * `core_vs_background`'s, so a one-size-fits-all "choice: core" answer is
 * invalid for it and would wrongly report `invalid_response`).
 */
const CHOICE_ANSWERS: Record<string, { choice: string; probabilities: Record<string, number> }> = {
  sense_match: {
    choice: "matches_target_sense",
    probabilities: { matches_target_sense: 0.9, different_sense: 0.08, insufficient_information: 0.02 },
  },
  core_vs_background: {
    choice: "core",
    probabilities: { core: 0.9, background: 0.08, insufficient_information: 0.02 },
  },
  population_match: {
    choice: "population_match",
    probabilities: { population_match: 0.9, population_mismatch: 0.08, insufficient_information: 0.02 },
  },
  method_outcome_match: {
    choice: "method_match",
    probabilities: { method_match: 0.9, method_mismatch: 0.08, insufficient_information: 0.02 },
  },
};

function okWireBodyFor(questionIds: readonly string[]) {
  const answers: Record<string, unknown> = {};
  for (const id of questionIds) {
    if (id === "project_help") {
      answers[id] = {
        type: "score",
        score: 2,
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities: { "0": 0.05, "1": 0.05, "2": 0.8, "3": 0.1 },
        confidence: 0.8,
      };
    } else {
      const choiceAnswer = CHOICE_ANSWERS[id];
      answers[id] = { type: "choice", choice: choiceAnswer.choice, probabilities: choiceAnswer.probabilities, confidence: 0.9 };
    }
  }
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 40, output_tokens: 0 } };
}

function makeInput(id: string): JevSmokeInput {
  return {
    id,
    label: `synthetic input ${id}`,
    request: {
      paperId: `jev-smoke-test-${id}`,
      title: "Synthetic Test Paper",
      abstract: "A short synthetic abstract for testing only.",
      intentCard: {
        version: FEED_INTENT_VERSION,
        project: { presence: "value", value: "test project", provenance: "user" },
        challenge: { presence: "omitted" },
        requiredConcepts: [],
        preferredConcepts: [],
        exclusions: [],
        methods: [],
        selectedSenseConcepts: [],
      },
      senseConcepts: [],
      questions: ["core_vs_background", "project_help"],
    },
  };
}

function capturingWriteOutput() {
  const calls: Array<{ outputDir: string; summary: JevSmokeSummary; perInput: Map<string, unknown> }> = [];
  const writeOutput = (outputDir: string, summary: JevSmokeSummary, perInput: ReadonlyMap<string, unknown>) => {
    calls.push({ outputDir, summary, perInput: new Map(perInput) });
  };
  return { writeOutput, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runJevSmoke — happy path", () => {
  it("runs every default input exactly once, reports ok with the echoed modelId, and never touches the real filesystem", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { questions: Record<string, unknown> };
      return jsonResponse(200, okWireBodyFor(Object.keys(body.questions)));
    });
    const { writeOutput, calls } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(summary.attempted).toBe(4); // JEV_SMOKE_INPUTS' own fixed count
    expect(summary.ceilingReached).toBe(false);
    expect(summary.results).toHaveLength(4);
    expect(summary.results.every((r) => r.status === "ok")).toBe(true);
    expect(summary.results.every((r) => r.modelId === "jev-1.13.0")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.outputDir).toContain("jev-smoke");
  });

  it("reports credential presence in the summary", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okWireBodyFor(["core_vs_background", "project_help"])));
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(summary.credentialPresence).toEqual({ jevApiKey: true });
  });
});

describe("runJevSmoke — key unset: every input reports disabled, zero real calls attempted", () => {
  it("reports status disabled for every input when JEV_API_KEY is unset — never crashes, never silently skips the report", async () => {
    delete process.env.JEV_API_KEY;
    const fetchImpl: FetchLike = vi.fn();
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(summary.results.every((r) => r.status === "disabled")).toBe(true);
    expect(summary.credentialPresence).toEqual({ jevApiKey: false });
  });
});

describe("runJevSmoke — hard ceiling", () => {
  it(`stops at the default ceiling (${DEFAULT_JEV_SMOKE_CEILING}) when handed more inputs than that`, async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okWireBodyFor(["core_vs_background", "project_help"])));
    const { writeOutput } = capturingWriteOutput();
    const manyInputs = Array.from({ length: 15 }, (_, i) => makeInput(`extra-${i}`));

    const summary = await runJevSmoke({ inputs: manyInputs, now: () => NOW, fetchImpl, writeOutput });

    expect(summary.attempted).toBe(DEFAULT_JEV_SMOKE_CEILING);
    expect(summary.ceilingReached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_JEV_SMOKE_CEILING);
  });

  it("respects an explicitly injected smaller ceiling", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okWireBodyFor(["core_vs_background", "project_help"])));
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ ceiling: 2, now: () => NOW, fetchImpl, writeOutput });

    expect(summary.attempted).toBe(2);
    expect(summary.ceilingReached).toBe(true);
  });

  it("does not report ceilingReached when every input fits under the ceiling", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okWireBodyFor(["core_vs_background", "project_help"])));
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(summary.ceilingReached).toBe(false);
  });
});

describe("runJevSmoke — contract-mismatch reporting", () => {
  it("reports invalid_response with a detail string when the response fails validation, and continues to the remaining inputs", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, { model: "wrong-model-id", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }));
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(summary.results.every((r) => r.status === "invalid_response")).toBe(true);
    expect(summary.results.every((r) => typeof r.detail === "string" && r.detail.length > 0)).toBe(true);
    expect(summary.attempted).toBe(4); // one fault on input 1 never stops the remaining 3
  });

  it("reports a plain fault status (e.g. unauthorized) verbatim, with no remapping", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 401 }));
    const { writeOutput } = capturingWriteOutput();

    const summary = await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(summary.results.every((r) => r.status === "unauthorized")).toBe(true);
  });
});

describe("runJevSmoke — never leaks the key", () => {
  it("the key substring never appears anywhere in the written summary or per-input results", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okWireBodyFor(["core_vs_background", "project_help"])));
    const { writeOutput, calls } = capturingWriteOutput();

    await runJevSmoke({ now: () => NOW, fetchImpl, writeOutput });

    expect(JSON.stringify(calls)).not.toContain(FAKE_API_KEY);
  });
});
