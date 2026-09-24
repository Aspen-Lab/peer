import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionResult } from "./types";
import {
  DECISION_CACHE_PROVIDER,
  deriveDecisionCacheKey,
  InMemoryDecisionCache,
  type DecisionCacheKeyInput,
} from "./decision-cache";

const BASE_INPUT: DecisionCacheKeyInput = {
  ownerId: "owner-a",
  intentHash: "intent-hash-1",
  paperContentHash: "content-hash-1",
  provider: DECISION_CACHE_PROVIDER,
  modelVersion: "jev-1.13.0",
  rubricVersion: "peer-decisions-rubric-v1",
};

function fixtureResult(paperId: string): DecisionResult {
  return {
    paperId,
    answers: [
      { questionId: "core_vs_background", kind: "choice", value: "core", confidence: 0.9, unknown: false },
    ],
    usage: { inputTokens: 120, outputTokens: 0, latencyMs: 40 },
    modelId: "jev-1.13.0",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("deriveDecisionCacheKey", () => {
  it("is deterministic for identical input", () => {
    expect(deriveDecisionCacheKey(BASE_INPUT)).toBe(deriveDecisionCacheKey({ ...BASE_INPUT }));
  });

  it("changes when any single component changes — ownerId, projectId, intentHash, paperContentHash, provider, modelVersion, rubricVersion", () => {
    const baseline = deriveDecisionCacheKey({ ...BASE_INPUT, projectId: "project-1" });
    const variants: DecisionCacheKeyInput[] = [
      { ...BASE_INPUT, projectId: "project-1", ownerId: "owner-b" },
      { ...BASE_INPUT, projectId: "project-2" },
      { ...BASE_INPUT, projectId: "project-1", intentHash: "intent-hash-2" },
      { ...BASE_INPUT, projectId: "project-1", paperContentHash: "content-hash-2" },
      { ...BASE_INPUT, projectId: "project-1", provider: "some-other-provider" },
      { ...BASE_INPUT, projectId: "project-1", modelVersion: "jev-1.14.0" },
      { ...BASE_INPUT, projectId: "project-1", rubricVersion: "peer-decisions-rubric-v2" },
    ];
    for (const variant of variants) {
      expect(deriveDecisionCacheKey(variant)).not.toBe(baseline);
    }
    // No two variants collide with each other either.
    const allKeys = [baseline, ...variants.map(deriveDecisionCacheKey)];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it("treats an omitted projectId the same as an explicitly undefined one, and differently from any real projectId", () => {
    const { projectId: _omit, ...withoutProjectId } = BASE_INPUT;
    const explicitUndefined = deriveDecisionCacheKey({ ...BASE_INPUT, projectId: undefined });
    const withProjectId = deriveDecisionCacheKey({ ...BASE_INPUT, projectId: "project-1" });
    expect(deriveDecisionCacheKey(withoutProjectId)).toBe(explicitUndefined);
    expect(deriveDecisionCacheKey(withoutProjectId)).not.toBe(withProjectId);
  });

  it("does not change with the wall-clock date/time — the function takes no now/Date parameter at all", () => {
    expect(deriveDecisionCacheKey.length).toBe(1); // exactly one parameter — no hidden `now`

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const keyOnJan1 = deriveDecisionCacheKey(BASE_INPUT);

    vi.setSystemTime(new Date("2027-06-15T12:00:00.000Z"));
    const keyOnJun15NextYear = deriveDecisionCacheKey(BASE_INPUT);

    expect(keyOnJan1).toBe(keyOnJun15NextYear);
  });

  it("does not change when only the paper's local retrieval/ranking score differs for the same paper content", () => {
    // Simulates two pipeline runs that scored the same paper differently
    // (e.g. after a re-rank) but where the paper's actual CONTENT — and
    // therefore its paperContentHash — is unchanged. DecisionCacheKeyInput
    // has no score-shaped field at all; a caller extracting only the fields
    // this function accepts necessarily drops the score before it could ever
    // reach the hash.
    const scoredRunA = { ...BASE_INPUT, __simulatedRetrievalScore: 0.91 } as DecisionCacheKeyInput & {
      __simulatedRetrievalScore: number;
    };
    const scoredRunB = { ...BASE_INPUT, __simulatedRetrievalScore: 0.12 } as DecisionCacheKeyInput & {
      __simulatedRetrievalScore: number;
    };
    expect(deriveDecisionCacheKey(scoredRunA)).toBe(deriveDecisionCacheKey(scoredRunB));
  });

  it("structurally contains no date/calendar/now-shaped identifier anywhere in its own source (fresh-A grep target)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "decision-cache.ts"), "utf8");
    const deriveFnMatch = source.match(/export function deriveDecisionCacheKey\([\s\S]*?\n\}/);
    expect(deriveFnMatch).not.toBeNull();
    const deriveFnSource = deriveFnMatch![0];
    expect(deriveFnSource).not.toMatch(/\bnow\b/i);
    expect(deriveFnSource).not.toMatch(/\bDate\b/);
    expect(deriveFnSource).not.toMatch(/localCalendarDate|utcDaySegment|toISOString/);
  });
});

describe("InMemoryDecisionCache", () => {
  it("a cache hit returns exactly the stored result", async () => {
    const cache = new InMemoryDecisionCache();
    const key = deriveDecisionCacheKey(BASE_INPUT);
    const result = fixtureResult("paper-1");

    expect(await cache.get(key)).toBeNull();
    await cache.set(key, result);
    expect(await cache.get(key)).toEqual(result);
  });

  it("a cache miss for an unwritten key returns null, never throws", async () => {
    const cache = new InMemoryDecisionCache();
    await expect(cache.get("never-written-key")).resolves.toBeNull();
  });

  it("different owners never share entries, even for otherwise-identical decision identity", async () => {
    const cache = new InMemoryDecisionCache();
    const ownerAKey = deriveDecisionCacheKey({ ...BASE_INPUT, ownerId: "owner-a" });
    const ownerBKey = deriveDecisionCacheKey({ ...BASE_INPUT, ownerId: "owner-b" });
    expect(ownerAKey).not.toBe(ownerBKey);

    await cache.set(ownerAKey, fixtureResult("paper-1"));

    expect(await cache.get(ownerBKey)).toBeNull();
    expect(await cache.get(ownerAKey)).not.toBeNull();
  });

  it("a later set for the same key overwrites the earlier stored result", async () => {
    const cache = new InMemoryDecisionCache();
    const key = deriveDecisionCacheKey(BASE_INPUT);
    await cache.set(key, fixtureResult("paper-1"));
    await cache.set(key, fixtureResult("paper-2"));
    expect(await cache.get(key)).toEqual(fixtureResult("paper-2"));
  });
});
