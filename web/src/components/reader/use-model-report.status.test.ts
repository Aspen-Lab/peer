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
  /** Requests the stub has begun and not ended. */
  open: 0,
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
    net.open += 1;
    try {
      yield { type: "mode", aiMode: "tier2" };
      for (const [stage, label, pct] of stages) yield { type: "stage", stage, label, pct };
      await sleep(holdMs);
    } finally {
      net.open -= 1;
    }
    yield reportEvent(body);
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
  };
}

type Seen = Pick<ModelReportState, "stage" | "report" | "failed"> & { open: number };

/**
 * One page open, every render recorded. `acts` run one per round (a number is a wait, kept alive
 * by a 1 ms poll), the settled questions read from `asked()` on each render as the page reads them.
 */
async function drive(
  acts: Array<(() => void) | number>,
  asked: () => readonly string[] = () => [],
  history: Seen[] = [],
  reader: UserProfile = { ...profile, deepReportEnabled: true },
) {
  const queued = [...acts];
  const clock = { until: 0 };
  const opened = await hookRuntime.mount(
    () => {
      const state = useModelReport({ paper, profile: reader, questions: asked() });
      history.push({ stage: state.stage, report: state.report, failed: state.failed, open: net.open });
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
    net.open = 0;
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
    opened.unmount();
    expect(history.some((seen) => seen.report === null && seen.stage !== null)).toBe(true);
  });

  it("names the pass: reading with the reader's questions on it is 'Reading your questions'", async () => {
    net.script = staged(60, [["reading", "Reading it", 35]]);
    const { opened, history } = await drive([30], () => [QUESTION]);
    opened.unmount();

    expect(history.some((seen) => seen.stage?.label === "Reading your questions")).toBe(true);
    expect(history.some((seen) => seen.stage?.label === "Reading the paper")).toBe(false);
  });

  it("names the pass: writing is 'Writing the report', reading without questions is 'Reading the paper'", async () => {
    net.script = staged(60, [["writing", "Writing the report", 75]]);
    const withWriting = await drive([30], () => [QUESTION]);
    withWriting.opened.unmount();
    expect(withWriting.history.some((seen) => seen.stage?.label === "Writing the report")).toBe(true);

    net.script = staged(60, [["reading", "Reading it", 35]]);
    const plain = await drive([30]);
    plain.opened.unmount();
    expect(plain.history.some((seen) => seen.stage?.label === "Reading the paper")).toBe(true);
    expect(plain.history.some((seen) => seen.stage?.label === "Reading your questions")).toBe(false);
  });

  it("a question settled while an earlier request is in flight: the label names that request, not a blank wait", async () => {
    net.script = staged(250, [["writing", "Writing the report", 75]]);
    let questions: readonly string[] = [];
    const seen: Array<Seen["stage"]> = [];
    const history: Seen[] = [];
    const { opened } = await drive(
      [30, () => (questions = [QUESTION]), 20, () => seen.push(history[history.length - 1].stage), 300],
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
    net.script = staged(250, [["writing", "Writing the report", 75]]);
    let questions: readonly string[] = [];
    const { opened, history } = await drive([30, () => (questions = [QUESTION]), 80], () => questions);
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
    // The deadline is the only timer of minutes the hook sets: fire it at once.
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) =>
      ms !== undefined && ms >= 150_000 && ms <= 400_000
        ? realSetTimeout(handler, 60)
        : realSetTimeout(handler, ms, ...rest)) as typeof setTimeout);
    const { opened, history } = await drive([160]);
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
    net.script = async function* () {
      // The server's word takes a while: the page has nothing to show for it meanwhile.
      await sleep(40);
      yield { type: "mode", aiMode: "tier0" };
    };
    const { opened, history } = await drive([30], () => [], [], { ...defaultProfile });
    opened.unmount();

    expect(net.streamCalls).toHaveLength(1);
    expect(history.every((seen) => seen.stage === null)).toBe(true);
    expect(history[history.length - 1].failed).toBe(false);
  });

  it("a server that answers Tier 0 to a keyed reader ends the stage with the request (nothing lingers)", async () => {
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier0" };
    };
    const { opened, history } = await drive([30]);
    opened.unmount();

    const last = history[history.length - 1];
    expect(last.stage).toBeNull();
    expect(last.failed).toBe(false);
  });

  it("the stream breaks and the request is asked again as JSON: the line says so, and clears with the answer", async () => {
    net.jsonDelayMs = 60;
    net.script = async function* () {
      yield { type: "mode", aiMode: "tier2" };
      yield { type: "stage", stage: "writing", label: "Writing the report", pct: 75 };
      throw new Error("the connection was cut");
    };
    const { opened, history } = await drive([120]);
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

/** The request with no question rides the figures stage and is held there; the one with a question is a shorter run. */
const firstThenQuestion: Script = async function* (body) {
  net.open += 1;
  try {
    // Each event arrives on its own, as chunks do: a pause between them lets the page draw each one.
    yield { type: "mode", aiMode: "tier2" };
    await sleep(8);
    if (Array.isArray(body.questions)) {
      yield { type: "stage", stage: "reading", label: "Reading it", pct: 20 };
      await sleep(8);
      yield { type: "stage", stage: "writing", label: "Writing it", pct: 75 };
      await sleep(40);
    } else {
      yield { type: "stage", stage: "writing", label: "Writing it", pct: 75 };
      await sleep(8);
      yield { type: "stage", stage: "figures", label: "Adding it", pct: 92 };
      await sleep(250);
    }
  } finally {
    net.open -= 1;
  }
  yield reportEvent(body);
  yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
};

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
    net.streamCalls.length = 0;
    net.jsonCalls = 0;
    net.jsonDelayMs = 0;
    net.open = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function questionBehindARun() {
    net.script = firstThenQuestion;
    let questions: readonly string[] = [];
    const history: Seen[] = [];
    const { opened } = await drive([80, () => (questions = [QUESTION]), 500], () => questions, history);
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
    net.script = firstThenQuestion;
    const { opened, history } = await drive([400]);
    opened.unmount();

    expect(history.some((seen) => seen.stage?.label === NEW_QUESTION)).toBe(false);
    expect(history[history.length - 1].stage).toBeNull();
  });
});
