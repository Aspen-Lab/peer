// P10-41 (BACKLOG-39): the report's status line says what the page waits on, and clears.
//
// The hook's `stage` is what the page draws as "loading report..." under the progress bar. It
// must name the request the reader waits on (the stage the server is in, said plainly), stand while
// that request is in flight — including the moments before its first stage event and while an
// earlier request for the same paper finishes ahead of the reader's new questions — and be gone
// the moment nothing is pending: the report arrived, the request failed, or it ran past the
// deadline. It is never drawn beside the report it was waiting for, and never for a request that
// is not sent to a model (Tier 0). The stream is a stub; the hook runs on `test-support/hook-runtime`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

type Script = (body: Record<string, unknown>, signal?: AbortSignal) => AsyncGenerator<Record<string, unknown>>;

const net = vi.hoisted(() => ({
  streamCalls: [] as Array<Record<string, unknown>>,
  jsonCalls: 0,
  /** How long the JSON fallback is held, and what it answers. */
  jsonDelayMs: 0,
  script: null as unknown,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: (body: Record<string, unknown>, signal?: AbortSignal) => {
    net.streamCalls.push(body);
    return (net.script as Script)(body, signal);
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async () => {
    net.jsonCalls += 1;
    if (net.jsonDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, net.jsonDelayMs));
    return { noLlm: true };
  },
}));
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { useModelReport, type ModelReportState } from "./use-model-report";

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
const quietWindow = Object.assign(Object.create(globalThis) as object, {
  addEventListener: () => {},
  removeEventListener: () => {},
});

// An invented placeholder, never a key: the stream is stubbed and nothing leaves the process.
const profile: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key" };
const paper: Paper = {
  id: "upload:0123456789abcdef",
  title: "An Invented Paper About Seaweed Mulch",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  revision: 1,
  textStatus: "ok",
};
const QUESTION = "Which layer kept the most soil water?";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function reportEvent(body: Record<string, unknown>) {
  return {
    type: "report",
    report: {
      noLlm: false,
      depth: body.deepReport ? "deep" : "abstract",
      skim: [],
      whatItProposes: { summary: "Invented.", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-full-text", droppedClaims: 0 },
    },
  };
}

/** A request that says its stages, is held `holdMs` in the last one, then reports. */
function staged(holdMs: number, stages: Array<[string, string, number]>): Script {
  return async function* (body) {
    yield { type: "mode", aiMode: "tier2" };
    for (const [stage, label, pct] of stages) yield { type: "stage", stage, label, pct };
    await sleep(holdMs);
    yield reportEvent(body);
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
  };
}

type Seen = Pick<ModelReportState, "stage" | "report" | "failed">;

/**
 * One page open, every render recorded. `acts` run one per round (a number is a wait, kept alive
 * by a 1 ms poll), the settled questions read from `asked()` on each render as the page reads them.
 */
async function drive(acts: Array<(() => void) | number>, asked: () => readonly string[] = () => [], history: Seen[] = []) {
  const queued = [...acts];
  const clock = { until: 0 };
  const opened = await hookRuntime.mount(
    () => {
      const state = useModelReport({ paper, profile: { ...profile, deepReportEnabled: true }, questions: asked() });
      history.push({ stage: state.stage, report: state.report, failed: state.failed });
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (Date.now() < clock.until) {
          const timer = setTimeout(() => setTick((n) => n + 1), 1);
          return () => clearTimeout(timer);
        }
        const next = queued.shift();
        if (next === undefined) return;
        if (typeof next === "function") {
          next();
          setTick((n) => n + 1);
          return;
        }
        clock.until = Date.now() + next;
        const timer = setTimeout(() => setTick((n) => n + 1), 1);
        return () => clearTimeout(timer);
      }, [tick]);
      return state;
    },
    { maxRounds: 600 },
  );
  return { opened, history };
}

describe("useModelReport — the status line says what the page waits on, and clears (P10-41)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", quietWindow);
    net.streamCalls.length = 0;
    net.jsonCalls = 0;
    net.jsonDelayMs = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pending, then done: the stage stands while the request is in flight and is gone with the report", async () => {
    net.script = staged(40, [["writing", "Writing the report", 75]]);
    const { opened, history } = await drive([60]);
    opened.unmount();

    const during = history.filter((seen) => seen.stage !== null);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((seen) => seen.report === null)).toBe(true);
    expect(during[during.length - 1].stage?.label).toBe("Writing the report");
    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.report).not.toBeNull();
    expect(last.failed).toBe(false);
  });

  it("the report and the stage are never drawn together (the answers shown, nothing pending)", async () => {
    net.script = staged(30, [
      ["reading", "Reading it", 35],
      ["writing", "Writing the report", 75],
      ["figures", "Adding figures", 92],
    ]);
    const { opened, history } = await drive([80]);
    opened.unmount();

    expect(history.some((seen) => seen.report !== null)).toBe(true);
    expect(history.filter((seen) => seen.report !== null && seen.stage !== null)).toEqual([]);
  });

  it("pending, then failed: an error before any report clears the stage and says the model could not finish", async () => {
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await sleep(20);
      yield { type: "error", message: "Peer could not finish the report stream." };
    };
    const { opened, history } = await drive([80]);
    opened.unmount();

    expect(history.some((seen) => seen.stage !== null)).toBe(true);
    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(true);
    expect(last.report).toBeNull();
  });

  it("the stage stands from the moment a model is asked, before the server's first stage event", async () => {
    net.script = async function* (body: Record<string, unknown>) {
      yield { type: "mode", aiMode: "tier2" };
      await sleep(60);
      yield reportEvent(body);
    };
    const { opened, history } = await drive([30]);

    // Held: the mode event has arrived, no stage yet; the reader is waiting.
    const held = history[history.length - 1];
    expect(held.report).toBeNull();
    expect(held.stage).not.toBeNull();
    opened.unmount();
  });

  it("names the pass: reading with the reader's questions on it is 'Reading your questions'", async () => {
    net.script = staged(60, [["reading", "Reading it", 35]]);
    const { opened, history } = await drive([30], () => [QUESTION]);

    expect(history[history.length - 1].stage?.label).toBe("Reading your questions");
    opened.unmount();
  });

  it("names the pass: writing is 'Writing the report', reading without questions is 'Reading the paper'", async () => {
    net.script = staged(60, [["writing", "Writing the report", 75]]);
    const withWriting = await drive([30], () => [QUESTION]);
    expect(withWriting.history[withWriting.history.length - 1].stage?.label).toBe("Writing the report");
    withWriting.opened.unmount();

    net.script = staged(60, [["reading", "Reading it", 35]]);
    const plain = await drive([30]);
    expect(plain.history[plain.history.length - 1].stage?.label).toBe("Reading the paper");
    plain.opened.unmount();
  });

  it("a question settled while an earlier request is in flight: the label names that request, not a blank wait", async () => {
    net.script = staged(120, [["writing", "Writing the report", 75]]);
    let questions: readonly string[] = [];
    const seen: Array<Seen["stage"]> = [];
    const history: Seen[] = [];
    const { opened } = await drive(
      [30, () => (questions = [QUESTION]), 20, () => seen.push(history[history.length - 1].stage), 200],
      () => questions,
      history,
    );
    opened.unmount();

    // The reader's question is queued behind the request in flight (one request at a time): the
    // page is not silent while it finishes.
    expect(net.streamCalls[0]).not.toHaveProperty("questions");
    expect(seen[0]).not.toBeNull();
    expect(seen[0]?.label).toBe("Writing the report");
  });

  it("a request that never answers times out: the stage clears and the model-could-not-finish line stands", async () => {
    net.script = async function* (_body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
    };
    // The deadline is the only timer of minutes the hook sets: fire it at once.
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) =>
      ms !== undefined && ms >= 150_000 && ms <= 400_000
        ? realSetTimeout(handler, 5)
        : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
    const { opened, history } = await drive([60]);
    opened.unmount();

    expect(history.some((seen) => seen.stage !== null)).toBe(true);
    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(true);
    expect(last.report).toBeNull();
    // Out of time is the end of it: nothing asks again for the same key.
    expect(net.streamCalls).toHaveLength(1);
  });

  it("Tier 0: a request that is never sent to a model shows no stage, at any render", async () => {
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier0" };
    };
    const { opened, history } = await drive([30]);
    opened.unmount();

    expect(history.every((seen) => seen.stage === null)).toBe(true);
    expect(history[history.length - 1].failed).toBe(false);
  });
});
