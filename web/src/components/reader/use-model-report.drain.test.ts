// P10-45 (BACKLOG-93, BACKLOG-92): the report request is read to its end (the browser logs a stream the
// page stops reading as ERR_ABORTED), a double effect starts one request, and the bar does not return
// to 0 when a queued request starts. The stream is a stub; the hook runs on `test-support/hook-runtime`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({
  strict: false,
  /** The render being run (1 = the mount). */
  render: 0,
  /** Each first-mount effect's holder and body, for the barrier that runs StrictMode's second pass. */
  later: [] as Array<{ holder: { cleanup?: () => void }; effect: () => void | (() => void) }>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  // StrictMode's dev double effect, in React's order: every effect of the mount runs, then every
  // cleanup, then every effect again (the barrier effect the test's component ends with). Only the
  // mount is doubled; a re-run for a changed dependency is run once, as React does.
  const strict = (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const doubled = mode.strict && mode.render === 1;
    return hookRuntime.hooks.useEffect(() => {
      if (!doubled) return effect();
      const holder: { cleanup?: () => void } = {};
      const first = effect();
      holder.cleanup = typeof first === "function" ? first : undefined;
      mode.later.push({ holder, effect });
      return () => holder.cleanup?.();
    }, deps);
  };
  return { ...actual, ...hookRuntime.hooks, useEffect: strict };
});

type Script = (body: Record<string, unknown>, signal?: AbortSignal) => AsyncGenerator<Record<string, unknown>>;

const net = vi.hoisted(() => ({
  calls: [] as Array<{ signal: AbortSignal | undefined }>,
  script: null as unknown,
  /** The stub ran to its last line: the page read the stream to its end. */
  ended: false,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: (body: Record<string, unknown>, signal?: AbortSignal) => {
    net.calls.push({ signal });
    return (net.script as Script)(body, signal);
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ noLlm: true }) }));
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
const reader: UserProfile = {
  ...defaultProfile,
  feedAiProvider: "anthropic",
  feedAiApiKey: "placeholder-not-a-key",
  deepReportEnabled: true,
};
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

type Seen = Pick<ModelReportState, "stage" | "report" | "failed">;

/** One page open, every render recorded; `waitMs` of the page's life, then unmounted. */
async function open(waitMs: number, asked: () => readonly string[] = () => [], act?: { at: number; run: () => void }) {
  const history: Seen[] = [];
  const clock = { start: Date.now(), acted: false };
  mode.render = 0;
  mode.later.length = 0;
  const opened = await hookRuntime.mount(
    () => {
      mode.render += 1;
      const state = useModelReport({ paper, profile: reader, questions: asked() });
      useEffect(() => {
        if (mode.render !== 1 || !mode.later.length) return;
        const pass = mode.later.splice(0);
        for (const item of pass) item.holder.cleanup?.();
        for (const item of pass) {
          const again = item.effect();
          item.holder.cleanup = typeof again === "function" ? again : undefined;
        }
      }, []);
      history.push({ stage: state.stage, report: state.report, failed: state.failed });
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (act && !clock.acted && Date.now() - clock.start >= act.at) {
          clock.acted = true;
          act.run();
          setTick((n) => n + 1);
          return;
        }
        if (Date.now() - clock.start >= waitMs) return;
        const timer = setTimeout(() => setTick((n) => n + 1), 1);
        return () => clearTimeout(timer);
      }, [tick]);
      return state;
    },
    { maxRounds: 900 },
  );
  opened.unmount();
  return history;
}

describe("useModelReport — the request is read to its end, once, and the bar starts from nothing (P10-45)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", quietWindow);
    net.calls.length = 0;
    net.ended = false;
    mode.strict = false;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the stream to its last line after the report: the page does not cancel a body the server is still closing", async () => {
    net.script = async function* (body: Record<string, unknown>) {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      yield reportEvent(body);
      yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
      net.ended = true;
    };
    const history = await open(80);

    expect(history[history.length - 1].report).not.toBeNull();
    expect(net.ended).toBe(true);
    expect(net.calls[0].signal?.aborted).toBe(false);
  });

  it("the trailing 'Report ready' stage shows nothing: the report stands with no stage and no failure", async () => {
    net.script = async function* (body: Record<string, unknown>) {
      yield { type: "mode", aiMode: "tier2" };
      yield reportEvent(body);
      await sleep(15);
      yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
      net.ended = true;
    };
    const history = await open(80);

    expect(net.ended).toBe(true);
    const shown = history.findIndex((seen) => seen.report !== null);
    expect(shown).toBeGreaterThan(-1);
    expect(history.slice(shown).every((seen) => seen.report !== null && seen.stage === null && !seen.failed)).toBe(true);
  });

  it("a stream that never closes after the report does not turn the report into a failure at the deadline", async () => {
    net.script = async function* (body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      yield reportEvent(body);
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
    };
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) =>
      ms !== undefined && ms >= 150_000 && ms <= 400_000
        ? realSetTimeout(handler, 40)
        : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
    const history = await open(150);

    const last = history[history.length - 1];
    expect(last.report).not.toBeNull();
    expect(last.failed).toBe(false);
    expect(last.stage).toBeNull();
  });

  it("a double effect (StrictMode) starts one request, and it is not aborted", async () => {
    mode.strict = true;
    net.script = async function* (body: Record<string, unknown>) {
      yield { type: "mode", aiMode: "tier2" };
      yield reportEvent(body);
    };
    const history = await open(60);

    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].signal?.aborted).toBe(false);
    expect(history[history.length - 1].report).not.toBeNull();
  });

  it("a queued request starts from no bar: after the earlier one's 75 %, the new one's first words carry no progress, never a 0 % bar", async () => {
    net.script = async function* (body: Record<string, unknown>) {
      yield { type: "mode", aiMode: "tier2" };
      // The server's first stage takes a moment to come: the page waits on words alone meanwhile.
      await sleep(10);
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await sleep(net.calls.length === 1 ? 120 : 30);
      yield reportEvent(body);
    };
    let questions: readonly string[] = [];
    const history = await open(400, () => questions, { at: 40, run: () => (questions = [QUESTION]) });

    expect(net.calls).toHaveLength(2);
    const bars = history.flatMap((seen) => (seen.stage ? [seen.stage.pct] : []));
    expect(bars).toContain(75);
    // No render draws a bar at zero.
    expect(bars.filter((pct) => pct === 0)).toEqual([]);
    // The hand-over: a stage that has words and no progress yet.
    const afterFirst = history.slice(history.findIndex((seen) => seen.stage?.pct === 75));
    expect(afterFirst.some((seen) => seen.stage?.label === "Starting the report" && seen.stage.pct === null)).toBe(true);
  });
});
