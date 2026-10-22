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
  /** Whether the JSON fallback is held until the page has drawn the line that says it was asked again. */
  jsonPaced: false,
  script: null as unknown,
  /** Requests the stub has begun and not ended. */
  open: 0,
  // What the tests wait on (P11-18, BACKLOG-97; `test-support/page-pacing`). A wait is for the thing its
  // assertion needs, never for a number of timer ticks: under load the page is slow, not wrong. The stubs
  // count what they do; `until` polls these.
  /** Streams read out to their end, or let go. */
  ended: 0,
  /** Requests that said all their stages, saw them drawn, and wait to be released. */
  held: 0,
  /** JSON fallbacks answered. */
  jsonAnswered: 0,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: (body: Record<string, unknown>, signal?: AbortSignal) => {
    net.streamCalls.push(body);
    return counted((net.script as Script)(body, signal));
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async (_path: string, init?: { signal?: AbortSignal }) => {
    net.jsonCalls += 1;
    if (net.jsonPaced) await drawn(init?.signal);
    net.jsonAnswered += 1;
    return { noLlm: true };
  },
}));
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { CEILING_MS, TEST_TIMEOUT_MS, drawn, pacing, resetPacing, throwIfLapsed, until } from "@/test-support/page-pacing";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { buildReportKey, rememberReport, useModelReport, type ModelReportState } from "./use-model-report";

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

// A test is several waits long at worst; the runner's 5 s would cut a slow machine off before the ceiling speaks.
vi.setConfig({ testTimeout: TEST_TIMEOUT_MS });

/** The stream as the hook reads it, counted once it has run to its end or been let go. */
async function* counted(stream: AsyncGenerator<Record<string, unknown>>) {
  try {
    yield* stream;
  } finally {
    net.ended += 1;
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

/**
 * A request that says its stages, each on the page before the next, then waits until `release` holds and reports.
 * Held with `release` never true, it stands in flight until the page is let go.
 */
function staged(stages: Array<[string, string, number]>, release: () => boolean = () => true): Script {
  return async function* (body, signal) {
    net.open += 1;
    try {
      yield { type: "mode", aiMode: "tier2" };
      await drawn(signal);
      for (const [stage, label, pct] of stages) {
        yield { type: "stage", stage, label, pct };
        await drawn(signal);
      }
      net.held += 1;
      await until(release, "the held request to be released", signal);
    } finally {
      net.open -= 1;
    }
    yield reportEvent(body);
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
  };
}

type Seen = Pick<ModelReportState, "stage" | "report" | "failed"> & { open: number };

/** A step of `drive` that holds the next one back until the page has what the assertion needs. */
interface Wait {
  what: string;
  ready: () => boolean;
}
type Act = (() => void) | Wait;
const waitFor = (what: string, ready: () => boolean): Wait => ({ what, ready });

/** `n` more requests have run to their end; the runtime then renders until nothing changes, so what the hook set on the way out is in the record. */
function requestsEnded(n = 1): Wait {
  const from = net.ended;
  return waitFor(`${n} request(s) to end`, () => net.ended - from >= n);
}

/** A request has said all its stages, the page has drawn them, and it is held in flight. */
function requestHeld(): Wait {
  const from = net.held;
  return waitFor("a request held at its last stage", () => net.held > from);
}

/**
 * An act, then the wait for the page to take it up: the render that carries it, then the effects of that render,
 * then the render of what those effects set. What is read after this is read from a page that has answered the act.
 */
function actAndSettle(history: Seen[], act: () => void): Act[] {
  let mark = 0;
  return [
    () => {
      mark = history.length;
      act();
    },
    waitFor("the page to take the change up", () => history.length >= mark + 2),
  ];
}

/**
 * One page open, every render recorded. `acts` run one per round: a function runs, a wait is kept alive by a
 * 1 ms poll until its condition holds. The settled questions are read from `asked()` on each render as the page
 * reads them. A wait that runs out the ceiling ends the run and fails the test, naming what it waited for.
 */
async function drive(
  acts: Act[],
  asked: () => readonly string[] = () => [],
  history: Seen[] = [],
  reader: UserProfile = { ...profile, deepReportEnabled: true },
) {
  const queued = [...acts];
  const waiting = { since: 0 };
  const opened = await hookRuntime.mount(
    () => {
      const state = useModelReport({ paper, profile: reader, questions: asked() });
      pacing.draws += 1;
      history.push({ stage: state.stage, report: state.report, failed: state.failed, open: net.open });
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const next = queued[0];
        if (next === undefined) return;
        if (typeof next === "function") {
          queued.shift();
          next();
          setTick((n) => n + 1);
          return;
        }
        if (next.ready()) {
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
  return { opened, history };
}

/** What every test starts from. */
function resetNet() {
  net.streamCalls.length = 0;
  net.jsonCalls = 0;
  net.jsonPaced = false;
  net.open = 0;
  net.ended = 0;
  net.held = 0;
  net.jsonAnswered = 0;
  resetPacing();
}

/** What every test ends with: a request left running was let go when its page unmounted; wait for it to wind down, so none outlives its test. */
async function windDown() {
  await until(() => net.open === 0, "the requests to wind down");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

describe("useModelReport — the status line says what the page waits on, and clears (P10-41)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", quietWindow);
    resetNet();
  });
  afterEach(windDown);

  it("pending, then done: the stage stands while the request is in flight and is gone with the report", async () => {
    net.script = staged([["writing", "Writing the report", 75]]);
    const { opened, history } = await drive([requestsEnded()]);
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
    net.script = staged([
      ["reading", "Reading it", 35],
      ["writing", "Writing the report", 75],
      ["figures", "Adding figures", 92],
    ]);
    const { opened, history } = await drive([requestsEnded()]);
    opened.unmount();

    expect(history.some((seen) => seen.report !== null)).toBe(true);
    expect(history.filter((seen) => seen.report !== null && seen.stage !== null)).toEqual([]);
  });

  it("pending, then failed: an error before any report clears the stage and says the model could not finish", async () => {
    net.script = async function* (_body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await drawn(signal);
      yield { type: "error", message: "Peer could not finish the report stream." };
    };
    // The error is asked again as JSON (the stub answers at once, with no model): the request ends when that answers.
    const { opened, history } = await drive([waitFor("the JSON ask to answer", () => net.jsonAnswered >= 1)]);
    opened.unmount();

    expect(history.some((seen) => seen.stage !== null)).toBe(true);
    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(true);
    expect(last.report).toBeNull();
  });

  it("the stage stands from the moment a model is asked, before the server's first stage event", async () => {
    net.script = async function* (body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      // Held until the page has drawn: the mode event has arrived, no stage yet; the reader is waiting.
      await drawn(signal);
      yield reportEvent(body);
    };
    const { opened, history } = await drive([requestsEnded()]);

    // Held: the mode event has arrived, no stage yet; the reader is waiting.
    opened.unmount();
    expect(history.some((seen) => seen.report === null && seen.stage !== null)).toBe(true);
  });

  it("names the pass: reading with the reader's questions on it is 'Reading your questions'", async () => {
    net.script = staged([["reading", "Reading it", 35]]);
    const { opened, history } = await drive([requestsEnded()], () => [QUESTION]);
    opened.unmount();

    expect(history.some((seen) => seen.stage?.label === "Reading your questions")).toBe(true);
    expect(history.some((seen) => seen.stage?.label === "Reading the paper")).toBe(false);
  });

  it("names the pass: writing is 'Writing the report', reading without questions is 'Reading the paper'", async () => {
    net.script = staged([["writing", "Writing the report", 75]]);
    const withWriting = await drive([requestsEnded()], () => [QUESTION]);
    withWriting.opened.unmount();
    expect(withWriting.history.some((seen) => seen.stage?.label === "Writing the report")).toBe(true);

    net.script = staged([["reading", "Reading it", 35]]);
    const plain = await drive([requestsEnded()]);
    plain.opened.unmount();
    expect(plain.history.some((seen) => seen.stage?.label === "Reading the paper")).toBe(true);
    expect(plain.history.some((seen) => seen.stage?.label === "Reading your questions")).toBe(false);
  });

  it("a question settled while an earlier request is in flight: the label names that request, not a blank wait", async () => {
    // Held in its stage until the question has settled and the page has taken it up; then let go to finish.
    let released = false;
    net.script = staged([["writing", "Writing the report", 75]], () => released);
    let questions: readonly string[] = [];
    const seen: Array<Seen["stage"]> = [];
    const history: Seen[] = [];
    const { opened } = await drive(
      [
        requestHeld(),
        ...actAndSettle(history, () => (questions = [QUESTION])),
        () => seen.push(history[history.length - 1].stage),
        () => (released = true),
        requestsEnded(),
      ],
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

  it("answers shown while a request is still in flight: the question's answers are on the page and no stage is drawn", async () => {
    // The answers for the reader's question are already kept (an earlier visit): they show at once,
    // while the request that was in flight when the question settled is still running.
    const key = buildReportKey(paper, "deep", "", profile.feedAiProvider, [QUESTION]);
    rememberReport(key, {
      noLlm: false,
      depth: "deep",
      skim: [],
      whatItProposes: { summary: "Kept answers.", methods: [] },
      resultsAndSignificance: { summary: "", keyResults: [] },
      provenance: { basis: "model-full-text", droppedClaims: 0 },
    } as never);
    // The request is held in flight, never released: it stands until the page is let go.
    net.script = staged([["writing", "Writing the report", 75]], () => false);
    let questions: readonly string[] = [];
    const history: Seen[] = [];
    const { opened } = await drive(
      [requestHeld(), ...actAndSettle(history, () => (questions = [QUESTION]))],
      () => questions,
      history,
    );
    opened.unmount();

    const answered = history.filter((seen) => seen.report !== null);
    expect(answered.length).toBeGreaterThan(0);
    // The earlier request was still running at some render that already showed the answers.
    expect(answered.some((seen) => seen.open > 0)).toBe(true);
    expect(answered.every((seen) => seen.stage === null)).toBe(true);
  });

  it("a request that never answers times out: the stage clears and the model-could-not-finish line stands", async () => {
    net.script = async function* (_body: Record<string, unknown>, signal?: AbortSignal) {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
    };
    // The deadline is the only timer of minutes the hook sets: fire it at once — as soon as the page has drawn the
    // stage it cuts short (a deadline that beat the first render would leave nothing to clear).
    const history: Seen[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) =>
      ms !== undefined && ms >= 150_000 && ms <= 400_000
        ? realSetTimeout(
            () =>
              void until(
                () => history.some((seen) => seen.stage !== null),
                "the stage on the page before the deadline",
              ).then(() => handler()),
            0,
          )
        : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
    const { opened } = await drive([requestsEnded()], () => [], history);
    opened.unmount();

    expect(history.some((seen) => seen.stage !== null)).toBe(true);
    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(true);
    expect(last.report).toBeNull();
    // Out of time is the end of it: nothing asks again for the same key.
    expect(net.streamCalls).toHaveLength(1);
  });

  it("Tier 0: with no key no model is asked and no stage shows, at any render", async () => {
    net.script = async function* (_body: Record<string, unknown>, signal?: AbortSignal) {
      // The server's word takes a while: the page has nothing to show for it meanwhile. It is held until the
      // page has drawn, so the render of the wait is in the record.
      await drawn(signal);
      yield { type: "mode", aiMode: "tier0" };
    };
    const { opened, history } = await drive([requestsEnded()], () => [], [], { ...defaultProfile });
    opened.unmount();

    expect(net.streamCalls).toHaveLength(1);
    expect(history.every((seen) => seen.stage === null)).toBe(true);
    expect(history[history.length - 1].failed).toBe(false);
  });

  it("a server that answers Tier 0 to a keyed reader ends the stage with the request (nothing lingers)", async () => {
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier0" };
    };
    const { opened, history } = await drive([requestsEnded()]);
    opened.unmount();

    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(false);
  });

  it("the stream breaks and the request is asked again as JSON: the line says so, and clears with the answer", async () => {
    // The second ask is held until the page has drawn the line that says it is being made.
    net.jsonPaced = true;
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      throw new Error("the connection was cut");
    };
    const { opened, history } = await drive([waitFor("the second ask to answer", () => net.jsonAnswered >= 1)]);
    opened.unmount();

    expect(net.jsonCalls).toBe(1);
    const labels = history.map((seen) => seen.stage?.label);
    expect(labels).toContain("Trying the report once more");
    expect(history[history.length - 1].stage).toBeNull();
  });
});

// P10-47 (round 5's reader 3): across a question queued behind a running request, the line the reader
// sees never goes backwards. The first request ends at "Adding figures" 92 %; the question's own request
// then starts from nothing. The line must not go blank between them, and a lower bar must never stand
// under the words of a stage already shown: the move from the first request to the second is named
// plainly ("Your new question — reading it"), and the second request's bar starts after it.

const NEW_QUESTION = "Your new question — reading it";

/**
 * The request with no question rides the figures stage and is held there until `release`; the one with a question is a
 * shorter run. Each event arrives on its own, as chunks do, and is on the page before the next is sent.
 */
function firstThenQuestion(release: () => boolean): Script {
  return async function* (body, signal) {
    net.open += 1;
    try {
      yield { type: "mode", aiMode: "tier2" };
      await drawn(signal);
      if (Array.isArray(body.questions)) {
        yield { type: "stage", stage: "reading", label: "Reading it", pct: 20 };
        await drawn(signal);
        yield { type: "stage", stage: "writing", label: "Writing it", pct: 75 };
        await drawn(signal);
      } else {
        yield { type: "stage", stage: "writing", label: "Writing it", pct: 75 };
        await drawn(signal);
        yield { type: "stage", stage: "figures", label: "Adding it", pct: 92 };
        await drawn(signal);
        net.held += 1;
        await until(release, "the held request to be released", signal);
      }
    } finally {
      net.open -= 1;
    }
    yield reportEvent(body);
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
  };
}

/** The lines the reader sees, in order, each once however many renders drew it. */
function seenLines(history: Seen[]): Array<[string, number | null]> {
  const lines: Array<[string, number | null]> = [];
  for (const seen of history) {
    if (seen.stage === null) continue;
    const last = lines[lines.length - 1];
    if (last && last[0] === seen.stage.label && last[1] === seen.stage.pct) continue;
    lines.push([seen.stage.label, seen.stage.pct]);
  }
  return lines;
}

describe("useModelReport — a queued question never sends the line backwards (P10-47)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", quietWindow);
    resetNet();
  });
  afterEach(windDown);

  /** The reader's question settles while the first request is held at its last stage; the page takes it up; the first request is let go; both run to their end. */
  async function questionBehindARun() {
    let released = false;
    net.script = firstThenQuestion(() => released);
    let questions: readonly string[] = [];
    const history: Seen[] = [];
    const { opened } = await drive(
      [
        requestHeld(),
        ...actAndSettle(history, () => (questions = [QUESTION])),
        () => (released = true),
        requestsEnded(2),
      ],
      () => questions,
      history,
    );
    opened.unmount();
    return history;
  }

  it("finished request to the queued one's first stage: the sequence moves forward, naming the new request", async () => {
    const history = await questionBehindARun();

    expect(net.streamCalls.length).toBe(2);
    expect(seenLines(history)).toEqual([
      ["Starting the report", null],
      ["Writing the report", 75],
      ["Adding figures", 92],
      [NEW_QUESTION, null],
      ["Reading your questions", 20],
      ["Writing the report", 75],
    ]);
  });

  it("the line is never blank between the two requests: from the first stage to the report, a stage stands at every render", async () => {
    const history = await questionBehindARun();

    const first = history.findIndex((seen) => seen.stage !== null);
    const reported = history.findIndex((seen) => seen.report !== null);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(reported).toBeGreaterThan(first);
    expect(history.slice(first, reported).every((seen) => seen.stage !== null)).toBe(true);
  });

  it("a bar never shows a lower percentage under the same words", async () => {
    const history = await questionBehindARun();

    let before: { label: string; pct: number } | null = null;
    for (const seen of history) {
      if (seen.stage === null || seen.stage.pct === null) continue;
      if (before && before.label === seen.stage.label) expect(seen.stage.pct).toBeGreaterThanOrEqual(before.pct);
      before = { label: seen.stage.label, pct: seen.stage.pct };
    }
  });

  it("a bar that goes down is always after the words that name a new request", async () => {
    const history = await questionBehindARun();

    let previousBar: number | null = null;
    let named = false;
    for (const seen of history) {
      if (seen.stage === null) continue;
      if (seen.stage.label === NEW_QUESTION) {
        named = true;
        previousBar = null;
        continue;
      }
      if (seen.stage.pct === null) continue;
      if (previousBar !== null && seen.stage.pct < previousBar) expect(named).toBe(true);
      previousBar = seen.stage.pct;
    }
  });

  it("no queued question: nothing names a new request", async () => {
    net.script = firstThenQuestion(() => true);
    const { opened, history } = await drive([requestsEnded()]);
    opened.unmount();

    expect(history.some((seen) => seen.stage?.label === NEW_QUESTION)).toBe(false);
    expect(history[history.length - 1].stage).toBeNull();
  });
});
