// P2-08b (§1g.18, F3): the question box and the deep report together — the
// field's own handlers, the real store and the real hook on the P0-06 runtime,
// one mounted "page". Only the network entry point is stubbed (slow, counted,
// and told when it is abandoned); nothing else is.
//
// What A measured on the real counter: five questions typed with Enter between
// them made six deep requests, four of them aborted in flight after the server
// had already charged them. The ruling: the box settles as a whole; an in-flight
// request is never aborted by a later set — it finishes and caches under its
// own key, and one more goes out for the latest set. A "charge" below is one
// deep request: it was counted once per deep request (§1g.4), and since P4-00 it
// is what the reader's own provider bills them for. P7-13 (R11c, the owner's order):
// the box settles when the reader presses Submit, or presses Enter on an empty last
// line (or the last line of a full box) — no longer on leaving the box after an idle
// wait, and no longer on `pagehide`. Every question is synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

const net = vi.hoisted(() => ({
  calls: [] as Array<{ questions: string[] | null; deep: unknown; aborted: boolean; done: boolean }>,
  /** How long each request takes before its report arrives. */
  delayMs: 30,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: async function* (body: Record<string, unknown>, signal: AbortSignal) {
    const call = { questions: (body.questions as string[] | undefined) ?? null, deep: body.deepReport, aborted: false, done: false };
    net.calls.push(call);
    signal.addEventListener("abort", () => {
      if (!call.done) call.aborted = true;
    });
    yield { type: "mode", aiMode: "tier2" };
    await new Promise((resolve) => setTimeout(resolve, net.delayMs));
    call.done = true;
    yield {
      type: "report",
      report: {
        noLlm: false,
        depth: "deep",
        skim: [],
        whatItProposes: { summary: `Report ${net.calls.length}`, methods: [] },
        resultsAndSignificance: { summary: "", keyResults: [] },
        provenance: { basis: "model-fulltext", droppedClaims: 0 },
      },
    };
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ noLlm: true }) }));
// A reader's own key counts only for a signed-in reader (P4-00).
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { settledQuestions, useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField } from "./question-field";
import { useModelReport } from "./use-model-report";

/**
 * A `window` that holds the `pagehide` / `pageshow` listeners the report hook (P3-05, from
 * mount) adds — the field adds none since P7-13 — in the order they were added, as a browser
 * fires them, and can fire an event. `count` is how many are registered for a type.
 */
function pageWindow() {
  const listeners = new Map<string, Set<() => void>>();
  const win = Object.assign(Object.create(globalThis) as object, {
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
  });
  return {
    win,
    count: (type: string) => listeners.get(type)?.size ?? 0,
    fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener()),
  };
}
let page = pageWindow();

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

const paper: Paper = {
  id: "openalex:W7000000001",
  title: "A Paper For The Question Box",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};
// The reader's own key and deep reports on: the hook asks a deep report (a
// placeholder string — the stream is stubbed, nothing leaves the process).
const reader: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key", deepReportEnabled: true };

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

interface View {
  section: ReactElement<Props>;
  inputs: ReactElement<Props>[];
  /** The Submit button of this render, if the box shows one. */
  submit: ReactElement<Props> | undefined;
}
type Step = ((view: View) => void) | { wait: number };

const type =
  (index: number, value: string): Step =>
  ({ inputs }) =>
    (inputs[index].props.onChange as (event: unknown) => void)({ target: { value } });
const enter =
  (index: number): Step =>
  ({ inputs }) =>
    (inputs[index].props.onKeyDown as (event: unknown) => void)({ key: "Enter", preventDefault: () => {} });
/** Focus leaves the box from input `index`: the input's own blur, then the section's. */
const leave =
  (index: number): Step =>
  ({ section, inputs }) => {
    (inputs[index].props.onBlur as () => void)();
    (section.props.onBlur as (event: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
  };
/** P7-13 (R11c): the Submit button is pressed. */
const submit: Step = (view) => (view.submit!.props.onClick as () => void)();
const sleep = (ms: number): Step => ({ wait: ms });

/**
 * One page open: the hook, the field, and a scripted reader — one action per
 * render round, a wait being rounds kept alive by a 1 ms poll until the clock
 * says so. The field is rendered beside the hook as the page does, both on the
 * store's settled set.
 */
async function session(script: Step[]) {
  const queued = [...script];
  const clock = { until: 0 };
  /** The field's handlers of the latest render: a step must call this render's closures. */
  const latest: { view: View | null } = { view: null };
  const opened = await hookRuntime.mount(
    () => {
      const [asked, setAsked] = useState(() => useReadingQuestionsStore.getState().byPaper[paper.id]);
      useEffect(() => useReadingQuestionsStore.subscribe((state) => setAsked(state.byPaper[paper.id])), []);
      const model = useModelReport({ paper, profile: reader, questions: settledQuestions(asked) });
      const all = elements(QuestionField({ paperId: paper.id, examples: [] }));
      latest.view = {
        section: all.find((el) => el.type === "section")!,
        inputs: all.filter((el) => "data-ask-line" in el.props),
        submit: all.find((el) => el.type === "button" && el.props.children === ASK.submit),
      };
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (Date.now() < clock.until) {
          const timer = setTimeout(() => setTick((n) => n + 1), 1);
          return () => clearTimeout(timer);
        }
        const next = queued.shift();
        if (!next) return;
        if (typeof next === "function") {
          next(latest.view!);
          setTick((n) => n + 1);
          return;
        }
        clock.until = Date.now() + next.wait;
        const timer = setTimeout(() => setTick((n) => n + 1), 1);
        return () => clearTimeout(timer);
      }, [tick]);
      return model;
    },
    { maxRounds: 1500 },
  );
  opened.unmount();
  return opened.value;
}

const FIVE = [
  "Synthetic question one about x?",
  "Synthetic question two about x?",
  "Synthetic question three about x?",
  "Synthetic question four about x?",
  "Synthetic question five about x?",
];
const settledOf = () => useReadingQuestionsStore.getState().byPaper[paper.id]?.settled;
const cachedKeys = () => Object.keys(JSON.parse(localStorage.getItem("peer-paper-report-v7") ?? "{}") as Record<string, unknown>);

describe("the question box and the deep report (P2-08b, §1g.18)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    // P3-05: the report hook listens for `pagehide` and `pageshow` on `window` from
    // mount, so this window holds listeners and can fire an event (the flows above
    // never fire one; the last test here does).  P7-13: the field listens for none.
    page = pageWindow();
    vi.stubGlobal("window", page.win);
    net.calls.length = 0;
    net.delayMs = 30;
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  it("five questions typed with Enter between them cost one charge: the open, then one report for all five", async () => {
    const script: Step[] = [sleep(100)];
    FIVE.forEach((text, index) => {
      script.push(type(index, text));
      if (index < FIVE.length - 1) script.push(enter(index));
    });
    script.push(submit, sleep(300));

    await session(script);

    // The open (no questions), and the one request for the five — never one per Enter.
    expect(net.calls.filter((call) => call.deep === true)).toHaveLength(2);
    expect(net.calls.map((call) => call.questions?.length ?? 0)).toEqual([0, 5]);
    expect(net.calls[1].questions).toEqual(FIVE);
    // None of the five intermediate sets was ever requested, and nothing was abandoned.
    expect(net.calls.every((call) => !call.aborted)).toBe(true);
  });

  it("sets settled while a request is in flight never abort it: it finishes, and one more goes out for the latest set", async () => {
    net.delayMs = 200;
    const alpha = "Synthetic question about topic alpha here?";
    const beta = "Synthetic question about topic beta here?";
    const gamma = "Synthetic question about topic gamma here?";

    await session([sleep(300), type(0, alpha), submit, sleep(50), type(0, beta), submit, sleep(50), type(0, gamma), submit, sleep(900)]);

    // The open, set alpha (in flight while beta and gamma settle), then gamma
    // alone: beta was superseded before anything was free to send it.
    const named = net.calls.map((call) => call.questions?.[0]?.match(/alpha|beta|gamma/)?.[0] ?? null);
    expect(named).toEqual([null, "alpha", "gamma"]);
    expect(net.calls.every((call) => !call.aborted)).toBe(true);
    // Each finished request cached under its own key — three entries, never beta's.
    expect(cachedKeys()).toHaveLength(3);
  });

  // §1g.21 (5), and the ruling's own done gesture: Enter on an empty last line. P7-13 (§1h.29
  // Q8): it still settles, and now at once — there is no wait after it.
  it("Enter on an empty last line is the done gesture: the questions settle at once", async () => {
    let atOnce: readonly string[] | undefined;
    await session([type(0, FIVE[0]), enter(0), enter(1), () => (atOnce = settledOf()), sleep(150)]);

    expect(atOnce).toEqual([FIVE[0]]);
    expect(settledOf()).toEqual([FIVE[0]]);
  });

  it("Enter on the last line of a full five-line box is the done gesture too", async () => {
    const script: Step[] = [];
    FIVE.forEach((text, index) => {
      script.push(type(index, text));
      if (index < FIVE.length - 1) script.push(enter(index));
    });
    // The box is full: no empty line can exist to press Enter on.
    script.push(sleep(60));
    await session(script);
    expect(settledOf()).toBeUndefined();

    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await session([...script.slice(0, -1), enter(4), sleep(150)]);
    expect(settledOf()).toEqual(FIVE);
  });

  // P7-13 (R11c): the three ways the box used to settle by itself are gone — leaving it and
  // waiting, a reload (`pagehide`) inside that wait, and leaving the page. A set typed and
  // not submitted is sent by none of them. It stays in the store, unsent, and is still there
  // to submit.
  it("leaving the box and staying away sends nothing: only Submit asks the question", async () => {
    await session([sleep(100), type(0, FIVE[0]), leave(0), sleep(400)]);

    expect(settledOf()).toBeUndefined();
    expect(net.calls.map((call) => call.questions?.length ?? 0)).toEqual([0]);
    expect(useReadingQuestionsStore.getState().byPaper[paper.id]?.items).toEqual([FIVE[0]]);
  });

  it("Submit sends the one request, with the question; a second Submit with nothing new sends nothing", async () => {
    await session([sleep(100), type(0, FIVE[0]), submit, sleep(150), submit, sleep(150)]);

    expect(net.calls.map((call) => call.questions?.length ?? 0)).toEqual([0, 1]);
    expect(net.calls[1].questions).toEqual([FIVE[0]]);
    expect(net.calls.every((call) => !call.aborted)).toBe(true);
  });

  it("a reload with a set typed and not submitted: pagehide settles nothing, nothing is sent from the dying page, pageshow sends nothing for it", async () => {
    const seen: Array<{ calls: number; settled: readonly string[] | undefined; hide: number }> = [];
    const snap: Step = () => seen.push({ calls: net.calls.length, settled: settledOf(), hide: page.count("pagehide") });

    await session([
      sleep(100), // the open's request ends
      type(0, FIVE[0]),
      leave(0),
      () => page.fire("pagehide"),
      sleep(80),
      snap,
      () => page.fire("pageshow"),
      sleep(120),
    ]);

    // Only the report hook's own pagehide listener is registered; the pagehide settled nothing and sent nothing.
    expect(seen).toEqual([{ calls: 1, settled: undefined, hide: 1 }]);
    expect(net.calls.map((call) => call.questions?.length ?? 0)).toEqual([0]);
    expect(useReadingQuestionsStore.getState().byPaper[paper.id]?.items).toEqual([FIVE[0]]);
    expect(net.calls.every((call) => !call.aborted)).toBe(true);
    // Both of the hook's listeners went with the page.
    expect([page.count("pagehide"), page.count("pageshow")]).toEqual([0, 0]);
  });
});
