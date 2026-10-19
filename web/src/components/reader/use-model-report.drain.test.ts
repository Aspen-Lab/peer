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
  // What the tests wait on (P11-18, BACKLOG-97; `test-support/page-pacing`): a wait is for the thing its
  // assertion needs, never for a number of timer ticks. The stubs count what they do; `until` polls these.
  /** Streams closed, however they ended: read to the end, or let go by the page. */
  closed: 0,
  /** Requests that said their stage, saw it drawn, and wait to be released. */
  held: 0,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: (body: Record<string, unknown>, signal?: AbortSignal) => {
    net.calls.push({ signal });
    return counted((net.script as Script)(body, signal));
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ noLlm: true }) }));
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { TEST_TIMEOUT_MS, CEILING_MS, drawn, pacing, resetPacing, throwIfLapsed, until } from "@/test-support/page-pacing";
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
// A test is several waits long at worst; the runner's 5 s would cut a slow machine off before the ceiling speaks.
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS });

/** The stream as the hook reads it, counted once it has closed, whether it ran to its end or was let go. */
async function* counted(stream: AsyncGenerator<Record<string, unknown>>) {
  try {
    yield* stream;
  } finally {
    net.closed += 1;
  }
}

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

/** A step of `open` that holds the next one back until the page has what the assertion needs. */
interface Wait {
  what: string;
  ready: (history: Seen[]) => boolean;
}
type Act = ((history: Seen[]) => void) | Wait;
const waitFor = (what: string, ready: (history: Seen[]) => boolean): Wait => ({ what, ready });

/** Every stream the page started has closed, and at least `n` were started. */
const streamsClosed = (n = 1): Wait =>
  waitFor(`${n} stream(s) to close`, () => net.calls.length >= n && net.closed >= net.calls.length);

/** A request has said its stage, the page has drawn it, and it is held in flight. */
const requestHeld = (): Wait => waitFor("a request held at its stage", () => net.held >= 1);

/**
 * An act, then the wait for the page to take it up: the render that carries it, then the effects of that render,
 * then the render of what those effects set. What is read after this is read from a page that has answered the act.
 */
function actAndSettle(act: () => void): Act[] {
  let mark = 0;
  return [
    (history) => {
      mark = history.length;
      act();
    },
    waitFor("the page to take the change up", (history) => history.length >= mark + 2),
  ];
}

/**
 * One page open, every render recorded, then unmounted. `acts` run one per round: a function runs, a wait is kept
 * alive by a 1 ms poll until its condition holds. A wait that runs out the ceiling fails the test, naming it.
 */
async function open(acts: Act[], asked: () => readonly string[] = () => [], history: Seen[] = []) {
  const queued = [...acts];
  const waiting = { since: 0 };
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
      pacing.draws += 1;
      history.push({ stage: state.stage, report: state.report, failed: state.failed });
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const next = queued[0];
        if (next === undefined) return;
        if (typeof next === "function") {
          queued.shift();
          next(history);
          setTick((n) => n + 1);
          return;
        }
        if (next.ready(history)) {
          queued.shift();
          waiting.since = 0;
          setTick((n) => n + 1);
          return;
        }
        waiting.since = waiting.since || Date.now();
        if (Date.now() - waiting.since >= CEILING_MS) {
          pacing.lapsed.push(next.what);
          queued.length = 0;
          return;
        }
        const timer = setTimeout(() => setTick((n) => n + 1), 1);
        return () => clearTimeout(timer);
      }, [tick]);
      return state;
    },
    // The ceiling is what bounds a run, not the number of rounds a slow machine gets through.
    { maxRounds: 100_000 },
  );
  throwIfLapsed(opened.unmount);
  opened.unmount();
  return history;
}

describe("useModelReport — the request is read to its end, once, and the bar starts from nothing (P10-45)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", quietWindow);
    net.calls.length = 0;
    net.ended = false;
    net.closed = 0;
    net.held = 0;
    mode.strict = false;
    resetPacing();
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
    // However it ends, the stream closes: a page that stopped reading at the report closes it early, and the
    // assertions below say so.
    const history = await open([streamsClosed()]);

    expect(history[history.length - 1].report).not.toBeNull();
    expect(net.ended).toBe(true);
    expect(net.calls[0].signal?.aborted).toBe(false);
  });

  it("the trailing 'Report ready' stage shows nothing: the report stands with no stage and no failure", async () => {
    net.script = async function* (body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      yield reportEvent(body);
      // The report is on the page before the trailing stage arrives.
      await drawn(signal);
      yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
      net.ended = true;
    };
    const history = await open([streamsClosed()]);

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
    // The deadline fires once the page has drawn the report it must not turn into a failure.
    const history: Seen[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) =>
      ms !== undefined && ms >= 150_000 && ms <= 400_000
        ? realSetTimeout(
            () =>
              void until(
                () => history.some((seen) => seen.report !== null),
                "the report on the page before the deadline",
              ).then(() => handler()),
            0,
          )
        : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
    await open([streamsClosed()], () => [], history);

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
    const history = await open([streamsClosed()]);

    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].signal?.aborted).toBe(false);
    expect(history[history.length - 1].report).not.toBeNull();
  });

  it("a queued request starts from no bar: after the earlier one's 75 %, the new one's first words carry no progress, never a 0 % bar", async () => {
    // The first request is held at its 75 % until the question has settled and the page has taken it up.
    let released = false;
    net.script = async function* (body: Record<string, unknown>, signal?: AbortSignal) {
      const first = net.calls.length === 1;
      yield { type: "mode", aiMode: "tier2" };
      // The server's first stage takes a moment to come: the page waits on words alone meanwhile
      // (held until the page has drawn them).
      await drawn(signal);
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await drawn(signal);
      if (first) {
        net.held += 1;
        await until(() => released, "the held request to be released", signal);
      }
      yield reportEvent(body);
    };
    let questions: readonly string[] = [];
    const history = await open(
      [requestHeld(), ...actAndSettle(() => (questions = [QUESTION])), () => (released = true), streamsClosed(2)],
      () => questions,
    );

    expect(net.calls).toHaveLength(2);
    const bars = history.flatMap((seen) => (seen.stage ? [seen.stage.pct] : []));
    expect(bars).toContain(75);
    // No render draws a bar at zero.
    expect(bars.filter((pct) => pct === 0)).toEqual([]);
    // The hand-over: a stage that has words and no progress yet. P10-47: re-aimed — those words now
    // name the new request ("Your new question — reading it") rather than "Starting the report".
    const afterFirst = history.slice(history.findIndex((seen) => seen.stage?.pct === 75));
    expect(afterFirst.some((seen) => seen.stage?.label === "Your new question — reading it" && seen.stage.pct === null)).toBe(true);
  });
});
