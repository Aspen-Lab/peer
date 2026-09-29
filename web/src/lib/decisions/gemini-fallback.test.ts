import { afterEach, describe, expect, it, vi } from "vitest";
import { endOfUtcDay, InMemoryCounterStore, type CounterStore } from "@/lib/usage/counters";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import type { DecisionRequest } from "./types";
import {
  geminiFallbackGlobalDayKey,
  geminiFallbackPerUserDayKey,
  hasGeminiFallbackProviderCapability,
  mintGeminiFallbackProviderCapability,
  runDecisionFallback,
  type GeminiFallbackProviderCapability,
} from "./gemini-fallback";

// P3-S6 — the bounded Gemini decision fallback (ABC-JEV-INTEGRATION.md §4
// "P3-S6 RULING", 2026-09-24T14:35:58Z; §1p.H(5); docs/jev-abc/
// P3-B-20260924T0525Z.md DESIGN §5). Company-funded AI is deliberately
// unavailable (§1j) for the whole of this campaign, so `provider` here is
// ALWAYS an offline fake minted directly by this test file via
// `mintGeminiFallbackProviderCapability` — never a real Gemini call, no
// network of any kind. `runDecisionFallback` must never throw; every fault
// is a typed return value.

const NOW = new Date("2026-09-24T12:00:00.000Z");
const CAPS = { perUserDailyCap: 10, globalDailyCap: 100 };

afterEach(() => {
  vi.restoreAllMocks();
});

function makeIntent(overrides: Partial<NormalizedFeedIntent> = {}): NormalizedFeedIntent {
  return {
    version: FEED_INTENT_VERSION,
    project: { presence: "value", value: "Improve cathode cycling stability", provenance: "user" },
    challenge: { presence: "omitted" },
    requiredConcepts: [],
    preferredConcepts: [],
    exclusions: [],
    methods: [],
    selectedSenseConcepts: [],
    ...overrides,
  };
}

function baseRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    paperId: "p1",
    title: "A paper about cathode cycling",
    abstract: "An abstract describing the study.",
    venue: "Test Venue",
    intentCard: makeIntent(),
    senseConcepts: [],
    questions: ["core_vs_background", "project_help"],
    ...overrides,
  };
}

/** A validator-shaped, fully-valid answer for exactly one question id. */
function answerFor(id: string): unknown {
  if (id === "project_help") {
    return {
      type: "score",
      score: 2,
      legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
      probabilities: { "0": 0.05, "1": 0.1, "2": 0.6, "3": 0.25 },
      confidence: 0.75,
    };
  }
  if (id === "core_vs_background") {
    return {
      type: "choice",
      choice: "core",
      probabilities: { core: 0.8, background: 0.15, insufficient_information: 0.05 },
      confidence: 0.8,
    };
  }
  if (id === "sense_match") {
    return {
      type: "choice",
      choice: "matches_target_sense",
      probabilities: { matches_target_sense: 1, different_sense: 0, insufficient_information: 0 },
      confidence: 0.9,
    };
  }
  throw new Error(`answerFor: no fixture for question id ${id}`);
}

/** A validator-shaped, fully-valid `{answers, usage}` body covering EXACTLY the given question ids — matching what was actually requested matters, since `validateJevResponse` rejects any extra/missing key. */
function okAnswers(
  ids: readonly string[] = ["project_help"],
): { answers: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } } {
  const answers: Record<string, unknown> = {};
  for (const id of ids) answers[id] = answerFor(id);
  return { answers, usage: { input_tokens: 120, output_tokens: 0 } };
}

function baseOptions(overrides: Partial<Parameters<typeof runDecisionFallback>[0]> = {}) {
  return {
    request: baseRequest(),
    unknownQuestionIds: ["project_help"] as DecisionRequest["questions"],
    provider: mintGeminiFallbackProviderCapability(async () => JSON.stringify(okAnswers(["project_help"]))),
    caps: CAPS,
    store: new InMemoryCounterStore(),
    ownerId: "owner-a",
    now: NOW,
    ...overrides,
  };
}

describe("runDecisionFallback — capability guard (never a BYOK override by mistake)", () => {
  it("refuses a plain object shaped like the capability but never minted", async () => {
    const fake = { generateJsonText: async () => JSON.stringify(okAnswers()) };
    const result = await runDecisionFallback(
      baseOptions({ provider: fake as unknown as GeminiFallbackProviderCapability }),
    );
    expect(result).toEqual({ status: "invalid_provider" });
  });

  it("refuses when provider is undefined, and never throws", async () => {
    await expect(
      runDecisionFallback(baseOptions({ provider: undefined })),
    ).resolves.toEqual({ status: "invalid_provider" });
  });

  it("hasGeminiFallbackProviderCapability rejects a non-minted object and undefined", () => {
    expect(hasGeminiFallbackProviderCapability({ generateJsonText: async () => "" })).toBe(false);
    expect(hasGeminiFallbackProviderCapability(undefined)).toBe(false);
    expect(hasGeminiFallbackProviderCapability(null)).toBe(false);
  });

  it("hasGeminiFallbackProviderCapability accepts a value minted via mintGeminiFallbackProviderCapability", () => {
    const capability = mintGeminiFallbackProviderCapability(async () => "");
    expect(hasGeminiFallbackProviderCapability(capability)).toBe(true);
  });

  it("accepts a properly minted capability and returns ok", async () => {
    const result = await runDecisionFallback(baseOptions());
    expect(result.status).toBe("ok");
  });
});

describe("runDecisionFallback — asks ONLY the unknown questions", () => {
  it("the provider prompt's question set is exactly unknownQuestionIds, never the full request.questions", async () => {
    let capturedUserPrompt = "";
    const provider = mintGeminiFallbackProviderCapability(async (args) => {
      capturedUserPrompt = args.userPrompt;
      return JSON.stringify({
        answers: { project_help: okAnswers().answers.project_help },
        usage: { input_tokens: 10, output_tokens: 0 },
      });
    });

    const result = await runDecisionFallback(
      baseOptions({
        request: baseRequest({ questions: ["core_vs_background", "project_help", "sense_match"] }),
        unknownQuestionIds: ["project_help"],
        provider,
      }),
    );

    expect(result.status).toBe("ok");
    const parsed = JSON.parse(capturedUserPrompt) as { questions: Record<string, unknown> };
    expect(Object.keys(parsed.questions)).toEqual(["project_help"]);
  });

  it("no_unknown_questions when handed an empty unknownQuestionIds — never calls the provider", async () => {
    const generateSpy = vi.fn(async () => JSON.stringify(okAnswers()));
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const result = await runDecisionFallback(baseOptions({ unknownQuestionIds: [], provider }));

    expect(result).toEqual({ status: "no_unknown_questions" });
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

describe("runDecisionFallback — reservation (mirrors reserveJevCall, own jev-gemini: namespace)", () => {
  it("reserves exactly one unit from both counters, per-user AND global, in the jev-gemini: namespace", async () => {
    const store = new InMemoryCounterStore();

    await runDecisionFallback(baseOptions({ store, ownerId: "owner-a" }));

    expect((await store.read(geminiFallbackPerUserDayKey("owner-a", NOW), NOW)).value).toBe(1);
    expect((await store.read(geminiFallbackGlobalDayKey(NOW), NOW)).value).toBe(1);
  });

  it("key shape is jev-gemini:<owner>:<UTC-day> / jev-gemini:all:<UTC-day>, disjoint from the main jev: namespace", () => {
    expect(geminiFallbackPerUserDayKey("owner-a", NOW)).toBe("jev-gemini:owner-a:2026-09-24");
    expect(geminiFallbackGlobalDayKey(NOW)).toBe("jev-gemini:all:2026-09-24");
    expect(geminiFallbackPerUserDayKey("owner-a", NOW).startsWith("jev:")).toBe(false);
    expect(geminiFallbackGlobalDayKey(NOW).startsWith("jev:")).toBe(false);
  });

  it("refuses when the per-user cap is already exceeded, WITHOUT touching the global counter (per-user-first)", async () => {
    const store = new InMemoryCounterStore();
    await store.increment(geminiFallbackPerUserDayKey("owner-a", NOW), endOfUtcDay(NOW), 5, NOW);
    const generateSpy = vi.fn(async () => JSON.stringify(okAnswers()));
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const result = await runDecisionFallback(
      baseOptions({ store, ownerId: "owner-a", provider, caps: { perUserDailyCap: 5, globalDailyCap: 100 } }),
    );

    expect(result).toEqual({ status: "reservation_refused", reason: "per_user_cap_exceeded" });
    expect(generateSpy).not.toHaveBeenCalled();
    expect((await store.read(geminiFallbackGlobalDayKey(NOW), NOW)).value).toBe(0);
  });

  it("refuses when the global cap is already exceeded, after a successful per-user reservation", async () => {
    const store = new InMemoryCounterStore();
    await store.increment(geminiFallbackGlobalDayKey(NOW), endOfUtcDay(NOW), 100, NOW);
    const generateSpy = vi.fn(async () => JSON.stringify(okAnswers()));
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const result = await runDecisionFallback(
      baseOptions({ store, ownerId: "owner-a", provider, caps: { perUserDailyCap: 10, globalDailyCap: 100 } }),
    );

    expect(result).toEqual({ status: "reservation_refused", reason: "global_cap_exceeded" });
    expect(generateSpy).not.toHaveBeenCalled();
    // Not rolled back — same accepted design choice as reserveJevCall.
    expect((await store.read(geminiFallbackPerUserDayKey("owner-a", NOW), NOW)).value).toBe(1);
  });

  it("fails CLOSED when the counter store is unreadable", async () => {
    const unreadableStore: CounterStore = {
      label: "in-memory",
      increment: async () => ({ value: 0, ok: false }),
      read: async () => ({ value: 0, ok: false }),
    };
    const generateSpy = vi.fn(async () => JSON.stringify(okAnswers()));
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const result = await runDecisionFallback(baseOptions({ store: unreadableStore, provider }));

    expect(result).toEqual({ status: "reservation_refused", reason: "counter_unreadable" });
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

describe("runDecisionFallback — malformed provider output never reaches a score field", () => {
  it("prose (not JSON) -> invalid_response, never a usable answer", async () => {
    const provider = mintGeminiFallbackProviderCapability(
      async () => "I think this paper is moderately helpful to the project.",
    );
    const result = await runDecisionFallback(baseOptions({ provider }));
    expect(result.status).toBe("invalid_response");
    expect("answers" in result).toBe(false);
  });

  it("a free-text string in a Score answer's numeric 'score' field is rejected, never coerced (mutation-guard)", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () =>
      JSON.stringify({
        answers: {
          project_help: {
            type: "score",
            score: "very helpful",
            legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
            probabilities: { "0": 0.1, "1": 0.1, "2": 0.6, "3": 0.2 },
            confidence: 0.9,
          },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );
    const result = await runDecisionFallback(baseOptions({ provider }));
    expect(result.status).toBe("invalid_response");
  });

  it("a choice value outside the declared criteria is rejected (proves genuine reuse of jev-contract.ts, not a reimplementation)", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () =>
      JSON.stringify({
        answers: {
          core_vs_background: {
            type: "choice",
            choice: "definitely-core-trust-me",
            probabilities: { core: 0.5, background: 0.3, insufficient_information: 0.2 },
            confidence: 0.9,
          },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );
    const result = await runDecisionFallback(
      baseOptions({ provider, unknownQuestionIds: ["core_vs_background"] }),
    );
    expect(result.status).toBe("invalid_response");
  });

  it("missing usage -> invalid_response", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () =>
      JSON.stringify({ answers: { project_help: okAnswers().answers.project_help } }),
    );
    const result = await runDecisionFallback(baseOptions({ provider }));
    expect(result.status).toBe("invalid_response");
  });

  it("an extra, unrequested answer key -> invalid_response (answers must be EXACTLY the requested ids)", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () =>
      JSON.stringify({
        answers: {
          project_help: okAnswers().answers.project_help,
          sense_match: {
            type: "choice",
            choice: "matches_target_sense",
            probabilities: { matches_target_sense: 1, different_sense: 0, insufficient_information: 0 },
            confidence: 0.9,
          },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );
    const result = await runDecisionFallback(baseOptions({ provider, unknownQuestionIds: ["project_help"] }));
    expect(result.status).toBe("invalid_response");
  });

  it("JSON wrapped in prose/code fences is still recovered when it IS otherwise valid (lenient extraction, not lenient validation)", async () => {
    const provider = mintGeminiFallbackProviderCapability(
      async () => "Here is my answer:\n```json\n" + JSON.stringify(okAnswers()) + "\n```\nHope that helps!",
    );
    const result = await runDecisionFallback(baseOptions({ provider }));
    expect(result.status).toBe("ok");
  });
});

describe("runDecisionFallback — provider failure", () => {
  it("provider_error when generateJsonText rejects — never throws", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () => {
      throw new Error("upstream boom");
    });
    await expect(runDecisionFallback(baseOptions({ provider }))).resolves.toEqual({ status: "provider_error" });
  });
});

describe("runDecisionFallback — answers carry their source", () => {
  it("every ok answer is tagged source: 'gemini-fallback'", async () => {
    const provider = mintGeminiFallbackProviderCapability(async () =>
      JSON.stringify(okAnswers(["core_vs_background", "project_help"])),
    );
    const result = await runDecisionFallback(
      baseOptions({ provider, unknownQuestionIds: ["core_vs_background", "project_help"] }),
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.answers).toHaveLength(2);
      for (const answer of result.answers) {
        expect(answer.source).toBe("gemini-fallback");
      }
    }
  });
});

describe("runDecisionFallback — cost log privacy", () => {
  it("logs exactly one line on success, provider 'gemini', with no owner id / paper text / intent text / key", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = mintGeminiFallbackProviderCapability(async () => JSON.stringify(okAnswers()));

    await runDecisionFallback(
      baseOptions({
        provider,
        ownerId: "SENTINEL-OWNER-do-not-log-me",
        request: baseRequest({
          paperId: "SENTINEL-PAPER-ID-9f8e",
          title: "SENTINEL-TITLE-do-not-log-me",
          abstract: "SENTINEL-ABSTRACT-do-not-log-me",
          intentCard: makeIntent({
            project: { presence: "value", value: "SENTINEL-PROJECT-do-not-log-me", provenance: "user" },
          }),
        }),
      }),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedLine).toContain("gemini");
    expect(loggedLine).not.toContain("SENTINEL");
  });

  it("logs exactly one line on a fault path too (reservation refused)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const store = new InMemoryCounterStore();
    await store.increment(geminiFallbackPerUserDayKey("owner-a", NOW), endOfUtcDay(NOW), 10, NOW);
    const provider = mintGeminiFallbackProviderCapability(async () => JSON.stringify(okAnswers()));

    await runDecisionFallback(
      baseOptions({ store, ownerId: "owner-a", provider, caps: { perUserDailyCap: 10, globalDailyCap: 100 } }),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedLine).toContain("gemini");
    expect(loggedLine).toContain("reservation_refused");
  });

  it("logs exactly one line when the provider output was malformed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const provider = mintGeminiFallbackProviderCapability(async () => "not json at all");

    await runDecisionFallback(baseOptions({ provider }));

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedLine).toContain("invalid_response");
  });
});
