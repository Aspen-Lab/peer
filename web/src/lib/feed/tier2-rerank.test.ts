import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";

// P5-06 item 1 (§1h.19 (a)). The rerank prompt carries the reader's own search
// brief (their topics, open questions and must-include terms) and the pool's
// titles and abstracts; a provider's error body can quote the prompt back, so the
// failure line says the kind and an HTTP status, never the error. A rerank
// that fails still keeps the Tier 1 order, as it always did. No model is called.
const providerMock = vi.hoisted(() => ({ generateJsonText: vi.fn() }));
vi.mock("@/lib/llm/providers/registry", () => ({
  resolveProvider: () => ({ id: "stub", generateJsonText: providerMock.generateJsonText }),
}));

import { applyTier2Rerank } from "./tier2-rerank";
import type { SearchBrief } from "./profile-compiler";
import type { ScoredItem } from "@/lib/scoring/types";

// Invented. Not a topic or a question that anyone has.
const MARKER = "Quillfeather-Tarn-marker";

function brief(): SearchBrief {
  return {
    coreTopics: ["tidal turbine wake"],
    activeQuestions: [`does ${MARKER} change the wake?`],
    mustInclude: [],
    niceToHave: [],
    avoid: [],
    methods: [],
    controls: [],
  } as unknown as SearchBrief;
}

function pool(): ScoredItem[] {
  return [1, 2, 3].map(
    (n) =>
      ({
        id: `openalex:${n}`,
        source: "openalex",
        title: `Paper ${n}`,
        authors: [],
        url: `https://example.test/${n}`,
        publishedAt: "2026-09-01",
        metadata: {},
        score: 0.5,
        scoreBreakdown: { keyword: 0.5, tfidf: 0.5, recency: 0.5, source: 0.5, combined: 0.5 },
        matchedKeywords: [],
        relevanceReason: "",
      }) as unknown as ScoredItem,
  );
}

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];

function render(argument: unknown): string {
  return typeof argument === "string" ? argument : inspect(argument, { depth: 10, breakLength: Infinity });
}

beforeEach(() => {
  calls.length = 0;
  providerMock.generateJsonText.mockReset();
  for (const method of ["log", "info", "debug", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, args });
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyTier2Rerank — a failed rerank logs the kind, never the error", () => {
  it("a provider error that echoes the prompt and carries status 400: the line holds the kind and 400, no argument holds the brief", async () => {
    let sent = "";
    providerMock.generateJsonText.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
      sent = userPrompt;
      throw Object.assign(new Error(`400 Bad request: ${userPrompt.slice(0, 600)}`), {
        name: "ApiError",
        status: 400,
      });
    });
    const items = pool();

    const result = await applyTier2Rerank(items, brief());

    // The premise: the prompt carried the reader's brief, and the error echoed it.
    expect(sent).toContain(MARKER);
    // The order is Tier 1's, as before.
    expect(result).toEqual({ items, orderedIds: [], reasons: {} });
    const warns = calls.filter((c) => c.method === "warn");
    expect(warns).toHaveLength(1);
    const line = warns[0].args.map(render).join(" ");
    expect(line).toContain("[feed/tier2]");
    expect(line).toContain("ApiError");
    expect(line).toContain("400");
    for (const call of calls) {
      for (const argument of call.args) {
        expect(render(argument)).not.toContain(MARKER);
        expect(argument).not.toBeInstanceOf(Error);
      }
    }
  });

  it("a thrown string: the line holds the type, not the text", async () => {
    providerMock.generateJsonText.mockRejectedValue(`upstream said: ${MARKER}`);

    const result = await applyTier2Rerank(pool(), brief());

    expect(result.orderedIds).toEqual([]);
    const warns = calls.filter((c) => c.method === "warn");
    expect(warns).toHaveLength(1);
    const line = warns[0].args.map(render).join(" ");
    expect(line).toContain("string");
    for (const call of calls) {
      for (const argument of call.args) expect(render(argument)).not.toContain(MARKER);
    }
  });

  it("an answer that does not parse is not a failure and logs nothing", async () => {
    providerMock.generateJsonText.mockResolvedValue("not json at all");

    const items = pool();
    const result = await applyTier2Rerank(items, brief());

    expect(result).toEqual({ items, orderedIds: [], reasons: {} });
    expect(calls.filter((c) => c.method === "warn")).toHaveLength(0);
  });
});
