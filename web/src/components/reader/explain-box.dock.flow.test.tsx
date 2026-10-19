import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P8-02 (BACKLOG-31; the owner's words, 15:3xZ 2026-10-11; ruling §1h.41 (b)): from a window of 1024 px the
// explain window, once open, STAYS open. A new selection in the body does not close it (§1h.3's "a new
// selection closes" is amended for the dock only); "Explain this?" still stands at the new selection, and
// pressing it — or `e` — takes the new passage into the same window: the previous passage's thread is
// replaced (kept for its passage), with no close and reopen and no reflow, so the page's width stays clear
// from the first open to the close. Close closes it (P8-06: Escape clears the passage to the empty state), and only then does the page get its width
// back; the card (640 to 1023 px) and the phone's sheet still close on a new selection. The box runs on the
// minimal hook runtime (no DOM here); the element tree it returns is inspected and its handlers called.
// Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useReadingPrefsStore } from "@/store/reading-prefs";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { ExplainTurn } from "@/store/explain-threads";
import { EXPLAIN } from "./copy";
import { ExplainBox, ExplainCard, placeCard, type AskResult, type ThreadView } from "./explain-box";
import { explainOffered } from "@/lib/reader/explain-offer";
import { columnBottomPx, legendHeightPx } from "./explain-dock";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

// P11-14 (re-aimed, §1c; rule 4): the dock's bottom was the legend's top (`height − legend`). The explain card is a card of the margin's
// stack now and stands in its band, which ends at `columnBottomPx` — the legend's top less a margin (8 px; never nearer than 40 px to
// the screen's foot): 860 on a 900-px screen with the legend at its flat 28. Every number below that ended on the legend's top ends there,
// and the card stands at the stack's base z (60), where it stood over the stack at 70.
const FOOT = (height: number, legend = 28) => columnBottomPx(height, legend);

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const term: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const FIRST_ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const SECOND_ANSWER: ExplainAnswer = { meaning: "How the test bars were cut.", here: { text: "It says where the bars came from.", peer: true } };
const REPLY: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;

const first: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};
const second: ExplainSelection = {
  ...first,
  paragraphIndex: 0,
  passage: "Specimens were machined from a single casting.",
  rect: { left: 200, top: 600, right: 460, bottom: 620 },
  bounds: { left: 100, top: 580, right: 460, bottom: 620 },
};

const pair = (n: number): ExplainTurn[] => [{ role: "reader", text: `question ${n}` }, { role: "peer", text: `reply ${n}`, peer: true }];
const pairs = (count: number): ExplainTurn[] => Array.from({ length: count }, (_, i) => pair(i + 1)).flat();

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

interface Look {
  /** The floating "Explain this?" button — the one that stands beside the words where no window stands. */
  button: ReactElement<Props2> | undefined;
  /** P9-03b: the window's own control — the "Explain this?" in its header (`onExplain`), with the empty window too. */
  explain: (() => void) | undefined;
  card: ReactElement<Props2> | undefined;
  status: string | null;
  /** The passage the window explains. */
  passage: string | null;
  /** The first answer's "What it means", when the window has one. */
  meaning: string | null;
  thread: ThreadView | undefined;
  term: string | null;
  style: Record<string, number | undefined> | undefined;
  dock: boolean;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  // P8-06 (re-aimed): `card` is the window that holds a passage. The empty window a reader with a key has from the start
  // (`empty`) is pinned in `explain-box.empty.flow.test.tsx`; here, as before, no card means nothing is open on a passage.
  const card = all.find((el) => el.type === ExplainCard && el.props.empty !== true);
  const status = card?.props.status as { kind: string; answer?: ExplainAnswer } | undefined;
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    explain: all.find((el) => el.type === ExplainCard)?.props.onExplain as (() => void) | undefined,
    card,
    status: status?.kind ?? null,
    passage: (card?.props.passage as string | undefined) ?? null,
    meaning: status?.answer?.meaning ?? null,
    thread: card?.props.thread as ThreadView | undefined,
    term: (card?.props.term as PaperTerm | null | undefined)?.term ?? null,
    style: card?.props.style as Look["style"],
    dock: card?.props.dock === true,
  };
};

let listeners: Map<string, Set<(event: unknown) => void>>;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
function recorder() {
  return {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
}
let scrollBy: ReturnType<typeof vi.fn>;
function stubWindow(width = 1440, height = 900) {
  scrollBy = vi.fn();
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, scrollBy, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
}

// The document's root: what is written on it and what is taken off. P11-14 (re-aimed, §1c; B P11-01 §3.1): the dock used to keep the
// page's width clear with two custom properties on the root (`--explain-dock` 376px, `--explain-dock-width` 360px). The margin is a grid
// track of the reader's shell now, so NOTHING is reserved: every assertion below that read "the properties are written / are still
// there / are taken off" reads "nothing was ever written".
let root: Map<string, string>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
const NOTHING_RESERVED = {} as const;
function stubRoot() {
  root = new Map();
  setProperty = vi.fn((name: string, value: string) => void root.set(name, value));
  removeProperty = vi.fn((name: string) => void root.delete(name));
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty, removeProperty } } });
}

beforeEach(() => {
  openRef = { current: null };
  listeners = new Map();
  stubRoot();
  stubWindow();
});
afterEach(() => vi.unstubAllGlobals());

type Step = (tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void;
async function scenario(initial: Props, steps: Step[]) {
  const ctx = { props: initial, rerender: () => {}, tree: null as ReactNode };
  const looks: Look[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(ctx.props);
    const [step, setStep] = useState(0);
    const [, setTick] = useState(0);
    ctx.rerender = () => setTick((n) => n + 1);
    looks.push(look(tree));
    ctx.tree = tree;
    useEffect(() => {
      const run = steps[step];
      if (!run) return;
      run(ctx.tree, ctx);
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  return { looks, mounted, last: () => looks[looks.length - 1] };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
// P9-03b (re-aimed helper): press "Explain this?" wherever it stands — the floating button where no window stands, the
// window's header control where one does (a reader with a key has the empty window from 1024 px). It was the button alone.
/** P10-08 (review 8.4, 8.5; re-aimed): the window is opened only by the page's `explain` action — the selection buttons and the `e` key —
 *  which is the box's `openRef`. It was the floating "Explain this?" button, or the control in the always-present window's header. */
let openRef: { current: (() => void) | null } = { current: null };
const click = (tree?: ReactNode) => {
  void tree;
  if (!openRef.current) throw new Error("the box has not published its open action");
  openRef.current();
};
const draft = (tree: ReactNode, text: string) => look(tree).thread?.onDraft(text);
const send = (tree: ReactNode) => look(tree).thread?.onSend();
const escape = () => fire("keydown", { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
const pressOutside = () => fire("pointerdown", { target: { closest: () => null } });
/** The reader selects `next` in the body: the page hands the box a new target. */
const selectNext =
  (next: ExplainSelection | null, over: Partial<Props> = {}): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next, ...over };
    ctx.rerender();
  };
/** The renders from the window's first opening on. */
const fromOpen = (looks: Look[]) => looks.slice(Math.max(0, looks.findIndex((l) => l.card)));
/** The tops the window stood at over the run, consecutive repeats dropped. */
const topsOf = (looks: Look[]) => looks.map((l) => l.style?.top).filter((top, i, all) => top !== undefined && top !== all[i - 1]);

const base = (over: Partial<Props> = {}): Props => ({
  target: first,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => SECOND_ANSWER),
  cached: FIRST_ANSWER,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  onResetThread: vi.fn(),
  reading,
  openRef,
  ...over,
});

describe("ExplainBox — the dock stays open across selections (P8-02, BACKLOG-31)", () => {
  it("a new selection does not close it: the window stays on its passage, and no control of its own stands for the new selection (re-aimed, P10-08: the selection buttons are the page's; was P9-03b's control in the window's header)", async () => {
    const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined }), () => pressOutside()]);
    await wait();

    // From the first opening on, there was never a render without the window.
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().dock).toBe(true);
    // P10-08 (re-aimed): the window carries no control for the new selection (it was P9-03b's, in its header) and there is no floating
    // button either; the page's `explain` action takes the new selection in.
    expect(run.last().explain).toBeUndefined();
    expect(run.last().button).toBeUndefined();
    // Nothing is reserved on the page (re-aimed, P11-14), and a press outside the dock closes nothing.
    expect(Object.fromEntries(root)).toEqual(NOTHING_RESERVED);
    run.mounted.unmount();
  });

  it("pressing Explain on the new selection takes it into the same window: no close and reopen, and no reflow", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const loading: Array<{ passage: string | null; status: string | null }> = [];
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: undefined, onAsk }),
      (tree) => click(tree),
      // The second passage is the window's at once, waiting for its answer — the first's is gone from it.
      (tree) => {
        loading.push({ passage: look(tree).passage, status: look(tree).status });
        resolve(SECOND_ANSWER);
      },
    ]);
    await wait();

    const seen = fromOpen(run.looks);
    // The window's passage goes from the first to the second and is never null on the way.
    expect(seen.every((l) => l.passage !== null)).toBe(true);
    expect(seen[0].passage).toBe(first.passage);
    expect(loading).toEqual([{ passage: second.passage, status: "loading" }]);
    expect(run.last().passage).toBe(second.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().meaning).toBe(SECOND_ANSWER.meaning);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: second.passage, sectionIndex: 1, paragraphIndex: 0 }));
    // It is the window's now: no button for it, and nothing was reserved or given back (re-aimed, P11-14: was "reserved once and never given back").
    expect(run.last().button).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(NOTHING_RESERVED);
    // …and nothing moved the page.
    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("replaces the previous passage's thread, which stays its own: explaining it again opens it with no request", async () => {
    const kept = pairs(1);
    const onAsk = vi.fn(async (): Promise<AskResult> => SECOND_ANSWER);
    const seen: Array<ExplainTurn[] | undefined> = [];
    const run = await scenario(base({ cachedTurns: kept, onAsk }), [
      (tree) => click(tree),
      (tree) => seen.push(look(tree).thread?.turns as ExplainTurn[]),
      selectNext(second, { cached: SECOND_ANSWER, cachedTurns: [] }),
      (tree) => click(tree),
      (tree) => seen.push(look(tree).thread?.turns as ExplainTurn[]),
      selectNext(first, { cached: FIRST_ANSWER, cachedTurns: kept }),
      (tree) => click(tree),
    ]);
    await wait();

    expect(seen).toEqual([kept, []]);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().thread?.turns).toEqual(kept);
    expect(onAsk).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("starts the new passage with an empty draft (re-aimed, P10-08: the web-search toggle it also started off is gone)", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why does it matter?"),
      (tree) => {
        expect(look(tree).thread?.draft).toBe("Why does it matter?");
      },
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().thread?.draft).toBe("");
    expect(run.last().thread).not.toHaveProperty("search");
    run.mounted.unmount();
  });

  it("starts the new passage at the top of the window, not where the last one was scrolled to", async () => {
    const scroller = { scrollTop: 250, scrollHeight: 900, getBoundingClientRect: () => ({ height: 600 }) };
    const run = await scenario(base(), [
      (tree) => {
        click(tree);
      },
      (tree) => {
        (look(tree).card?.props.cardRef as { current: unknown }).current = scroller;
      },
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(scroller.scrollTop).toBe(0);
    run.mounted.unmount();
  });

  it("e with a different selection explains it in the same window; with the same selection it goes to the input", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => SECOND_ANSWER);
    const focus = vi.fn();
    const run = await scenario(base({ openRef, onAsk }), [
      () => openRef.current?.(),
      (tree) => {
        (look(tree).card?.props.inputRef as { current: unknown }).current = { focus };
        // Same selection as the window's: to the input.
        openRef.current?.();
        expect(focus).toHaveBeenCalledTimes(1);
      },
      selectNext(second, { cached: undefined }),
      () => openRef.current?.(),
      () => {},
      // The window explains the second now, and the selection is still the second: to the input again.
      () => openRef.current?.(),
    ]);
    await wait();

    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(run.last().passage).toBe(second.passage);
    expect(run.last().status).toBe("answer");
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: second.passage }));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("e with no selection left (a click in the window collapsed it) goes to the input and changes nothing", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const focus = vi.fn();
    const run = await scenario(base({ openRef }), [
      () => openRef.current?.(),
      (tree) => {
        (look(tree).card?.props.inputRef as { current: unknown }).current = { focus };
      },
      selectNext(null),
      () => openRef.current?.(),
    ]);
    await wait();

    expect(focus).toHaveBeenCalledTimes(1);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().button).toBeUndefined();
    run.mounted.unmount();
  });

  it("Close closes it — only then — after two passages, and writes nothing on the page (re-aimed, P11-14: was \"…gives the width back — only then —…\")", async () => {
    // P8-06 (re-aimed): was "Escape closes it…". With a key and a body a window is always there: Escape clears the
    // passage back to the empty state (`explain-box.escape.flow.test.tsx`), and the window goes with the Close button.
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      (tree) => {
        expect(removeProperty).not.toHaveBeenCalled();
        expect(Object.fromEntries(root)).toEqual(NOTHING_RESERVED);
        (look(tree).card?.props.onClose as () => void)();
      },
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("Escape after two passages closes the window and writes nothing on the page (re-aimed, P10-08: was \"clears the window back to the empty state: the width stays reserved\" — there is no empty state; P11-14: nothing to give back)", async () => {
    const kinds: string[] = [];
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      () => escape(),
      (tree) => kinds.push(look(tree).card ? "window" : "none"),
    ]);
    await wait();

    expect(kinds).toEqual(["none"]);
    expect(run.last().card).toBeUndefined();
    // No control stands for the selection that is still there: the selection buttons (the page's) and `e` open it again.
    expect(run.last().explain).toBeUndefined();
    expect(run.last().button).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("the Close button closes it, with a new selection standing, and nothing is written on the page (re-aimed, P11-14: was \"…and gives the width back…\")", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => (look(tree).card?.props.onClose as () => void)(),
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    // Nothing is drawn for the selection that stood, now that nothing is open (re-aimed, P10-08: was the floating button).
    expect(run.last().button).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("a press outside it does nothing, and a selection that goes away leaves it open (P7-15, unchanged)", async () => {
    const run = await scenario(base(), [(tree) => click(tree), () => pressOutside(), selectNext(null), () => pressOutside()]);
    await wait();

    expect(run.last().card).toBeDefined();
    expect(run.last().passage).toBe(first.passage);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  // Re-aimed, P10-08: no control stands anywhere but the page's selection buttons. Under 768 px (640 and 390 here) the thumb bar's cell is
  // offered the new selection a closed card or sheet leaves (`explainOffered`); the press there is the page's `explain` action, the box's `openRef`.
  it("from 1024 px only: a new selection still closes the card (640 to 1023) and the phone's sheet (re-aimed, P10-08: they leave no pill; under 768 px the thumb bar's cell is offered the selection)", async () => {
    for (const [width, height, stays] of [[1024, 800, true], [1023, 800, false], [800, 900, false], [640, 900, false], [390, 844, false]] as const) {
      stubWindow(width, height);
      const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined })]);
      await wait();

      expect(run.last().card !== undefined, `${width} px`).toBe(stays);
      expect(run.last().explain, `${width} px`).toBeUndefined();
      expect(run.last().button, `${width} px`).toBeUndefined();
      expect(explainOffered(), `${width} px`).toBe(!stays && width < 768);
      run.mounted.unmount();
    }
  });

  it("an answer that comes back for the passage the window has left is not shown in the new one", async () => {
    let resolveFirst!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolveFirst = r)));
    const run = await scenario(base({ onAsk, cached: undefined }), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      () => resolveFirst(FIRST_ANSWER),
      () => {},
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().meaning).toBe(SECOND_ANSWER.meaning);
    expect(run.looks.every((l) => l.meaning !== FIRST_ANSWER.meaning)).toBe(true);
    run.mounted.unmount();
  });

  it("a reply that comes back for the passage the window has left is not added to the new one's thread", async () => {
    let resolveReply!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolveReply = r)));
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      () => resolveReply(REPLY),
      () => {},
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().thread?.turns).toEqual([]);
    expect(run.looks.every((l) => !l.thread?.turns.some((turn) => turn.text === REPLY.text))).toBe(true);
    run.mounted.unmount();
  });

  it("with no key, a new selection that the paper does not define gets no button and the window stays; one it defines does", async () => {
    const defined = { ...first, passage: "The rafting ratio rose." };
    const plain = { ...second, passage: "Specimens were machined from a single casting." };
    const other = { ...second, passage: "The rafting ratio is the same in all bars." };
    const run = await scenario(base({ canAsk: false, terms: [term], target: defined, cached: undefined }), [
      (tree) => click(tree),
      selectNext(plain),
      (tree) => {
        expect(look(tree).button).toBeUndefined();
        expect(look(tree).passage).toBe(defined.passage);
      },
      selectNext(other),
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().status).toBe("none");
    expect(run.last().passage).toBe(other.passage);
    expect(run.last().term).toBe("rafting ratio");
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  // Re-aimed, P9-41 (§1h.66): at 390 px, where this test stood the pill above the thumb bar, there is no pill now (the bar holds the
  // control: `explain-box.bar.flow.test.tsx`). The claim it pins — a pill on the page's furniture does not move with the scroll — is
  // the legend's, from 768 px, where a column with no gutter (the paragraph's right edge at 700, 100 px of room under the 136 a
  // pill needs) leaves it nowhere else.
  // P9-03 (the feature walk's X13): the button stands beside the words, never on them. The body reports the
  // selection's paragraph (P8-02), and with room to its right the button is in the gutter, level with the selection.
});

// ── Level with the explained paragraph's first line (P8-02) ─────────────────────────────────────────

/** A selection whose paragraph begins `top` px from the top of the window (its own words lie lower in it). */
const inParagraph = (selection: ExplainSelection, top: number): ExplainSelection => ({ ...selection, paragraph: { left: 120, top, right: 760, bottom: top + 260 } });

describe("ExplainBox — the window stands level with the explained paragraph's first line (P8-02, BACKLOG-31)", () => {
  it("its top is the paragraph's top; its right edge is flush, it is 360 wide, and its height is its content", async () => {
    const run = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => click(tree)]);
    await wait();

    // No `bottom`: the window is as tall as what it holds, at most what is left below its top.
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 400, maxHeight: FOOT(900) - 400, zIndex: 60 });
    expect(run.last().dock).toBe(true);
    run.mounted.unmount();
  });

  it("is the PARAGRAPH's top, not the first line of the words picked: those lie lower in a long paragraph", async () => {
    // `first.bounds.top` is 380: the picked words. The paragraph began at 250.
    const run = await scenario(base({ target: inParagraph(first, 250) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().style?.top).toBe(250);
    run.mounted.unmount();
  });

  it("is the same for the Tier 0 definition, which is the dock too", async () => {
    const target = inParagraph({ ...first, passage: "The rafting ratio rose." }, 330);
    const run = await scenario(base({ canAsk: false, terms: [term], target, cached: undefined }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("none");
    expect(run.last().style).toMatchObject({ right: 0, top: 330, maxHeight: FOOT(900) - 330 });
    run.mounted.unmount();
  });

  it("stays under the masthead while the paragraph is scrolled above it, and 360 px above the legend while it is far below (re-aimed, P9-17: a window that holds a passage keeps its header, its controls and two lines; was 160)", async () => {
    const above = await scenario(base({ target: inParagraph(first, -700) }), [(tree) => click(tree)]);
    await wait();
    expect(above.last().style).toMatchObject({ top: 48, maxHeight: FOOT(900) - 48 });
    above.mounted.unmount();

    const below = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree)]);
    await wait();
    expect(below.last().style).toMatchObject({ top: FOOT(900) - 360, maxHeight: 360 });
    below.mounted.unmount();
  });

  it("moves on a mere selection of the next passage, and explaining it leaves the window where it is (re-aimed, P9-03b: was \"does not move on a mere selection — it moves when that passage is explained\"; P9-17: the second paragraph at 480, inside the thread's band, was 620)", async () => {
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      (tree) => click(tree),
      selectNext(inParagraph(second, 480), { cached: SECOND_ANSWER }),
      // Selected, not explained: P9-03b (re-aimed) — the window is still the first passage's, but level with the SELECTED
      // paragraph (it stayed at the first paragraph's top, 400, until the passage was explained).
      (tree) => tops.push(look(tree).style?.top),
      (tree) => click(tree),
      // Explained: the same window, where it already stood.
      (tree) => tops.push(look(tree).style?.top),
    ]);
    await wait();

    expect(tops).toEqual([480, 480]);
    expect(run.last().passage).toBe(second.passage);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("follows the paragraph as the page scrolls, and holds the clamp (re-aimed, P9-17: the lowest top is 512, was 712; the last stop 480, was 520)", async () => {
    let paragraphTop = 400;
    const moving: ExplainSelection = {
      ...inParagraph(first, 400),
      measure: () => ({ rect: first.rect, bounds: first.bounds, paragraph: { left: 120, top: paragraphTop, right: 760, bottom: paragraphTop + 260 } }),
    };
    const tops: Array<number | undefined> = [];
    const scrollTo = (top: number): Step => () => {
      paragraphTop = top;
      fire("scroll", {});
    };
    const record: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ target: moving }), [
      (tree) => click(tree),
      record,
      scrollTo(300),
      record,
      scrollTo(-250),
      record,
      scrollTo(5000),
      record,
      scrollTo(480),
      record,
    ]);
    await wait();

    // Opened where the paragraph was read; then wherever the page puts it, held between 48 and 512 (900 − 28 − 360; re-aimed,
    // P9-17: it was 712, 900 − 28 − 160, the floor of a window with nothing in it).
    expect(tops).toEqual([400, 300, 48, FOOT(900) - 360, 480]);
    run.mounted.unmount();
  });

  it("follows the window as it is resized: the limit above the legend moves with its height (re-aimed, P9-17: 212 and 360, were 412 and 160)", async () => {
    const paragraphTop = 500;
    const moving: ExplainSelection = {
      ...inParagraph(first, 500),
      measure: () => ({ rect: first.rect, bounds: first.bounds, paragraph: { left: 120, top: paragraphTop, right: 760, bottom: paragraphTop + 260 } }),
    };
    const styles: Array<Look["style"]> = [];
    const run = await scenario(base({ target: moving }), [
      (tree) => click(tree),
      () => {
        stubWindow(1440, 600);
        fire("resize", {});
      },
      (tree) => styles.push(look(tree).style),
    ]);
    await wait();

    // The band ends at 600 − 40 = 560, so 560 − 360 = 200 is as low as it may stand; the paragraph at 500 is lower; the height is what is left of it
    // (re-aimed, P9-17: it was 412 and 160, the floor of a window with nothing in it).
    expect(styles).toEqual([{ right: 0, width: 360, top: FOOT(600) - 360, maxHeight: 360, zIndex: 60 }]);
    run.mounted.unmount();
  });

  it("falls back on the selection's own first line where the body reported no paragraph", async () => {
    const run = await scenario(base({ target: first }), [(tree) => click(tree)]);
    await wait();

    expect(first.paragraph).toBeUndefined();
    expect(run.last().style).toEqual({ right: 0, width: 360, top: first.bounds.top, maxHeight: FOOT(900) - first.bounds.top, zIndex: 60 });
    run.mounted.unmount();
  });

  it("is only the dock's: the card (640 to 1023 px) and the phone's sheet keep their places", async () => {
    stubWindow(800, 900);
    const card = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => click(tree)]);
    await wait();
    expect(card.last().dock).toBe(false);
    expect(card.last().style?.right).toBeUndefined();
    expect(card.last().style).toMatchObject(placeCard(first.bounds, { width: 800, height: 900 }));
    card.mounted.unmount();

    // Re-aimed, P9-41: at 390 px the control is the thumb bar's cell, which calls the page's `explain` action — the box's `openRef`.
    stubWindow(390, 844);
    const openRef = { current: null as (() => void) | null };
    const sheet = await scenario(base({ target: inParagraph(first, 400), openRef }), [() => openRef.current?.()]);
    await wait();
    expect(sheet.last().style).toMatchObject({ left: 0, width: 390, bottom: 0 });
    expect(sheet.last().style?.top).toBeUndefined();
    sheet.mounted.unmount();
  });
});

// ── The window follows the selected paragraph and carries the control (P9-03b) ──────────────────────
//
// The owner's words, "level with the first line of the SELECTED paragraph" (被选中的文字段落), and the ruling §1h.49 (a): no
// gutter exists beside the column while the dock stands (P9-03's measurement), so while a window stands it moves to the
// paragraph of the selection on offer — the settled selection, never the one still being dragged — keeps what it holds, and
// carries the "Explain this?" control in its header; the floating button stands only where no window does.

// Re-aimed, P9-17: 480, was 620 — a window that holds a passage may stand no lower than 512 (900 − 28 − 360), and these tests
// are about the window following a paragraph, not about the clamp (pinned above and in `explain-box.thread.test.tsx`).
const B_TOP = 480;
const paraA = (): ExplainSelection => inParagraph(first, 400);
const paraB = (): ExplainSelection => inParagraph(second, B_TOP);

describe("ExplainBox — the window follows the selected paragraph's first line (P9-03b, ruling §1h.49)", () => {
  it("moves to the paragraph of a selection offered elsewhere, with no close and no reflow, and keeps the thread it holds", async () => {
    const kept = pairs(1);
    const seen: Array<{ top: number | undefined; passage: string | null; turns: ExplainTurn[] | undefined; status: string | null }> = [];
    const note: Step = (tree) => seen.push({ top: look(tree).style?.top, passage: look(tree).passage, turns: look(tree).thread?.turns as ExplainTurn[] | undefined, status: look(tree).status });
    const run = await scenario(base({ target: paraA(), cachedTurns: kept }), [
      (tree) => click(tree),
      note,
      selectNext(paraB(), { cached: SECOND_ANSWER, cachedTurns: [] }),
      note,
    ]);
    await wait();

    // Level with A's first line, then with B's — and the window still holds A's passage, answer and thread.
    expect(seen).toEqual([
      { top: 400, passage: first.passage, turns: kept, status: "answer" },
      { top: B_TOP, passage: first.passage, turns: kept, status: "answer" },
    ]);
    expect(run.last().style).toEqual({ right: 0, width: 360, top: B_TOP, maxHeight: FOOT(900) - B_TOP, zIndex: 60 });
    // Never a render without the window from its first opening on; nothing reserved or given back (re-aimed, P11-14), nothing scrolled.
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(NOTHING_RESERVED);
    run.mounted.unmount();
  });

  it("is the paragraph's first line, not the selected words': those lie lower in a long paragraph", async () => {
    // `second.bounds.top` is 580: the picked words. The paragraph began at 500.
    const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(inParagraph(second, 500), { cached: SECOND_ANSWER })]);
    await wait();

    expect(run.last().style?.top).toBe(500);
    run.mounted.unmount();
  });

  it("falls back on the selection's own first line where the body reported no paragraph (re-aimed, P9-17: a first line at 460, inside the thread's band; `second`'s 580 is below its limit of 512)", async () => {
    const near: ExplainSelection = { ...second, rect: { left: 200, top: 480, right: 460, bottom: 500 }, bounds: { left: 100, top: 460, right: 460, bottom: 500 } };
    const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(near, { cached: SECOND_ANSWER })]);
    await wait();

    expect(near.paragraph).toBeUndefined();
    expect(run.last().style?.top).toBe(near.bounds.top);
    run.mounted.unmount();
  });

  it("is held between the masthead and 360 px above the legend, as the explained paragraph's is (re-aimed, P9-17: was 160)", async () => {
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(inParagraph(second, 4000), { cached: SECOND_ANSWER }),
      note,
      selectNext(inParagraph(second, -700), { cached: SECOND_ANSWER }),
      note,
    ]);
    await wait();

    expect(tops).toEqual([FOOT(900) - 360, 48]);
    run.mounted.unmount();
  });

  it("does not move for a selection in the paragraph it is already level with", async () => {
    const tops: Array<number | undefined> = [];
    const same = { ...inParagraph(second, 400), passage: "A different passage of the same paragraph." };
    const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(same, { cached: undefined }), (tree) => tops.push(look(tree).style?.top)]);
    await wait();

    expect(tops).toEqual([400]);
    run.mounted.unmount();
  });

  it("stays where it moved when the selection goes away (a click in the window collapses it): it does not jump back to the explained paragraph", async () => {
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(paraB(), { cached: SECOND_ANSWER }), note, selectNext(null), note]);
    await wait();

    expect(tops).toEqual([B_TOP, B_TOP]);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().explain).toBeUndefined();
    // P9-17 (A P9-R2 F3): the two `note`s above read the tree of the render in which the selection went away — a render that React
    // discards and redoes when the box sets state while rendering (`followed`), so they pass whether the memory is kept or not.
    // The render the reader sees is the LAST one: it is still level with B, and no render on the way stood anywhere else (the
    // window does not go back to A's paragraph, 400, for a frame or for good). A nulled memory (`if (target !== followed)`) puts
    // the window back at A under the reader's pointer: red here.
    expect(run.last().style?.top).toBe(B_TOP);
    expect(topsOf(fromOpen(run.looks))).toEqual([400, B_TOP]);
    run.mounted.unmount();
  });

  it("goes back to the explained paragraph when the reader selects its passage again", async () => {
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: SECOND_ANSWER }),
      note,
      selectNext({ ...paraA(), rect: { left: 310, top: 410, right: 430, bottom: 430 } }, { cached: FIRST_ANSWER }),
      note,
    ]);
    await wait();

    expect(tops).toEqual([B_TOP, 400]);
    expect(run.last().explain).toBeUndefined();
    run.mounted.unmount();
  });

  it("follows the paragraph it moved to as the page scrolls", async () => {
    let shift = 0;
    const moving: ExplainSelection = {
      ...paraB(),
      measure: () => ({
        rect: { left: 200, top: 600 - shift, right: 460, bottom: 620 - shift },
        bounds: { left: 100, top: 580 - shift, right: 460, bottom: 620 - shift },
        paragraph: { left: 120, top: B_TOP - shift, right: 760, bottom: B_TOP + 260 - shift },
      }),
    };
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(moving, { cached: SECOND_ANSWER }),
      note,
      () => {
        shift = 250;
        fire("scroll", {});
      },
      note,
    ]);
    await wait();

    expect(tops).toEqual([B_TOP, B_TOP - 250]);
    run.mounted.unmount();
  });

  it("a Tier 0 window (no key) follows a selection too, whether or not the paper defines something in it", async () => {
    const definedA = inParagraph({ ...first, passage: "The rafting ratio rose." }, 330);
    const definedB = inParagraph({ ...second, passage: "The rafting ratio is the same in all bars." }, 440);
    const plainC = inParagraph({ ...second, passage: "Specimens were machined from a single casting." }, 700);
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base({ canAsk: false, terms: [term], target: definedA, cached: undefined }), [
      (tree) => click(tree),
      note,
      selectNext(definedB),
      note,
      selectNext(plainC),
      (tree) => {
        tops.push(look(tree).style?.top);
        // It has nothing to offer for a passage the paper does not define: the window moves, the control does not appear.
        expect(look(tree).explain).toBeUndefined();
        expect(look(tree).passage).toBe(definedA.passage);
      },
    ]);
    await wait();

    // The third paragraph lies at 700: the window holds a passage, so it stops at 512 (re-aimed, P9-17: it followed to 700; the
    // second paragraph is at 440, was 560, inside the band).
    expect(tops).toEqual([330, 440, FOOT(900) - 360]);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — the offered selection is taken into the open window by the page's explain action (P9-03b, ruling §1h.49; re-aimed, P10-08: was the window's own control)", () => {
  it("the action explains the offered passage in the same window: no close, no intermediate null, nothing reserved or given back (re-aimed, P11-14)", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const loading: Array<{ passage: string | null; status: string | null; top: number | undefined }> = [];
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: undefined, onAsk }),
      (tree) => click(tree),
      (tree) => {
        loading.push({ passage: look(tree).passage, status: look(tree).status, top: look(tree).style?.top });
        resolve(SECOND_ANSWER);
      },
    ]);
    await wait();

    // B is the window's at once, waiting for its answer, level with B's paragraph where it already stood.
    expect(loading).toEqual([{ passage: second.passage, status: "loading", top: B_TOP }]);
    expect(run.last().passage).toBe(second.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().meaning).toBe(SECOND_ANSWER.meaning);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: second.passage, sectionIndex: 1, paragraphIndex: 0 }));
    expect(fromOpen(run.looks).every((l) => l.passage !== null)).toBe(true);
    expect(run.last().explain).toBeUndefined();
    expect(run.last().style?.top).toBe(B_TOP);
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("shows none for the passage the window explains, even selected again with other measures", async () => {
    const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext({ ...paraA(), rect: { left: 301, top: 401, right: 421, bottom: 421 } }, { cached: FIRST_ANSWER })]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().explain).toBeUndefined();
    expect(run.last().button).toBeUndefined();
    expect(run.last().style?.top).toBe(400);
    run.mounted.unmount();
  });

  it("`e` takes the offered selection into the window, which already stands level with it", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const run = await scenario(base({ openRef, target: paraA() }), [() => openRef.current?.(), selectNext(paraB(), { cached: SECOND_ANSWER }), () => openRef.current?.()]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().style?.top).toBe(B_TOP);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

});
// ── The header control hands the focus to the window (P9-17, ruling §1h.56; A P9-R2 F5) ───────────────────────────
//
// Pressing the control makes the offered selection the window's passage, so `next` becomes null and the control unmounts
// (`explainNext = next && docked ? …`): a keyboard reader's focus, which stood on it, fell to `<body>`. The floating button
// did the same, but it was transient; the window is not. There is no DOM here: the box finds the card, its input and the
// document's `activeElement` through refs and the document, so the test stands in for the three and says what the browser
// would have done (`focus()` moves `activeElement`).
// ── The window's bottom stands on the screen's bottom when its paragraph is too low (P9-17, ruling §1h.57) ───────────────
//
// The owner: "如果选中段落在屏幕最下方，那么窗口的最底部就直接贴着整个屏幕的最底部。总之，始终让窗口存在于屏幕里." The box measures the
// card's own height after each commit (`scrollHeight` plus its border, whatever `max-height` clips) and the window needs at
// least that, and at least the thread's floor with a passage; it is level with its paragraph when all of it fits below, else
// lifted until its bottom stands on the legend's reserve. No DOM here: a stand-in for the card says how tall the browser made it.

/** The card as the browser sized it: `height` from border to border (2 px of border), what `max-height` clips included. */
const sized = (height: number) => ({ scrollHeight: height - 2, offsetHeight: height, clientHeight: height - 2, scrollTop: 0, getBoundingClientRect: () => ({ height }) });
const cardElement = (tree: ReactNode) => elements(tree).find((el) => el.type === ExplainCard);
const giveCard =
  (card: unknown): Step =>
  (tree) => {
    (cardElement(tree)?.props.cardRef as { current: unknown }).current = card;
  };

describe("ExplainBox — the window's bottom stands on the screen's bottom when its paragraph is too low for the whole window (P9-17, ruling §1h.57)", () => {
  it("is lifted to its real height when that is taller than the thread's floor: its bottom edge on the screen's bottom, above the legend", async () => {
    const card = sized(520);
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree), giveCard(card)]);
    await wait();

    // Unmeasured it stood at the thread's floor (900 − 28 − 360 = 512); measured 520 px tall, 900 − 28 − 520 = 352.
    expect(topsOf(fromOpen(run.looks))).toEqual([FOOT(900) - 360, FOOT(900) - 520]);
    expect(run.last().style).toEqual({ right: 0, width: 360, top: FOOT(900) - 520, maxHeight: 520, zIndex: 60 });
    expect(run.last().style!.top! + 520).toBe(FOOT(900));
    run.mounted.unmount();
  });

  it("keeps the thread's floor when what it holds is shorter than that, and is level with the paragraph wherever the whole window fits below it", async () => {
    const short = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree), giveCard(sized(200))]);
    await wait();
    expect(short.last().style?.top).toBe(FOOT(900) - 360);
    short.mounted.unmount();

    // 300 + 520 = 820 ≤ 872: all of it fits below the first line.
    const fits = await scenario(base({ target: inParagraph(first, 300) }), [(tree) => click(tree), giveCard(sized(520))]);
    await wait();
    expect(fits.last().style).toEqual({ right: 0, width: 360, top: 300, maxHeight: FOOT(900) - 300, zIndex: 60 });
    fits.mounted.unmount();

    // 360 + 520 = 880 > 872: lifted by the 8 px that do not fit, to 352.
    const barely = await scenario(base({ target: inParagraph(first, 360) }), [(tree) => click(tree), giveCard(sized(520))]);
    await wait();
    expect(barely.last().style?.top).toBe(FOOT(900) - 520);
    barely.mounted.unmount();
  });

  it("is never above the masthead's foot, nor off the screen: a window as tall as the room between the masthead and the legend stands at 48", async () => {
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree), giveCard(sized(2000))]);
    await wait();

    expect(run.last().style).toEqual({ right: 0, width: 360, top: 48, maxHeight: FOOT(900) - 48, zIndex: 60 });
    run.mounted.unmount();
  });

  it("holds at every window height from 600 to 1080: the bottom on the screen's bottom, the top at or below the masthead's foot", async () => {
    for (const height of [600, 660, 720, 780, 840, 900, 960, 1020, 1080]) {
      stubWindow(1440, height);
      const run = await scenario(base({ target: inParagraph(first, 5000) }), [(tree) => click(tree), giveCard(sized(520))]);
      await wait();

      const style = run.last().style!;
      // (At 600 px the band is 512 px high, under the card's 520: it stands at the masthead's foot.)
      expect(style.top, `${height} px`).toBe(Math.max(48, FOOT(height) - 520));
      expect(style.top!, `${height} px`).toBeGreaterThanOrEqual(48);
      expect(style.top! + Math.min(520, style.maxHeight!), `${height} px`).toBeLessThanOrEqual(FOOT(height));
      run.mounted.unmount();
    }
  });

  it("moves up as the thread grows, its bottom staying on the screen's bottom (a reply arrives, the reader types a longer draft)", async () => {
    const card = sized(520);
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [
      (tree) => click(tree),
      giveCard(card),
      (_tree, ctx) => {
        Object.assign(card, sized(700));
        ctx.rerender();
      },
    ]);
    await wait();

    expect(topsOf(fromOpen(run.looks))).toEqual([FOOT(900) - 360, FOOT(900) - 520, FOOT(900) - 700]);
    run.mounted.unmount();
  });

  it("does not move for a card it cannot measure (no height yet, or a card and a sheet): the thread's floor, as before", async () => {
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree), giveCard({ scrollTop: 0, scrollHeight: 520 })]);
    await wait();
    expect(run.last().style?.top).toBe(FOOT(900) - 360);
    run.mounted.unmount();

    stubWindow(800, 900);
    const card = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree), giveCard(sized(520))]);
    await wait();
    expect(card.last().dock).toBe(false);
    expect(card.last().style).toMatchObject(placeCard(first.bounds, { width: 800, height: 900 }));
    card.mounted.unmount();
  });
});

// ── The legend's reserve follows the legend (P9-20, BACKLOG-42; A P9-W2) ───────────────────────────────────────────
//
// In Fit mode the foot legend, inside the page container the page zooms, is 28 × zoom tall on screen; the box (outside the container)
// read a flat 28 and its window overlapped the legend by 4.0 / 10.6 / 23.5 px at 1440 / 1920 / 2560. The box now reads the page's zoom
// (`--page-zoom` on `[data-zoom-root]`) and stands the window's bottom on the legend's top.

describe("ExplainBox — the window's bottom stands on the legend's top as Fit scales the page (P9-20, BACKLOG-42)", () => {
  let zoom: string;
  /** The page container and its zoom, as the browser reports them; `zoom` is read afresh each time (the Fit toggle changes it). */
  const stubZoom = (present = true) => {
    zoom = "1";
    (document as unknown as Record<string, unknown>).querySelector = (selector: string) => (present && selector === "[data-zoom-root]" ? { zoomRoot: true } : null);
    (window as unknown as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: (name: string) => (name === "--page-zoom" ? zoom : "") });
  };
  const bottomOf = (style: Look["style"]) => (style?.top ?? 0) + (style?.maxHeight ?? 0);

  it("at A's three Fit sizes the tallest the window can be ends on the legend's top: 1440 x 1000, 1920 x 1080, 2560 x 1440", async () => {
    for (const [width, height, factor] of [[1440, 1000, 1.142], [1920, 1080, 1.378], [2560, 1440, 1.838]] as const) {
      stubWindow(width, height);
      stubZoom();
      zoom = String(factor);
      for (const paragraph of [200, height - 100]) {
        const run = await scenario(base({ target: inParagraph(first, paragraph) }), [(tree) => click(tree)]);
        await wait();

        expect(run.last().dock, `${width} x ${height}`).toBe(true);
        // The legend's top is `height − 28 × zoom`; the window's bottom edge is not below it (it was 4.0 / 10.6 / 23.5 px below).
        expect(bottomOf(run.last().style), `${width} x ${height}, paragraph ${paragraph}`).toBeCloseTo(FOOT(height, legendHeightPx(factor)), 6);
        run.mounted.unmount();
      }
    }
  });

  it("the lowest top it stands at leaves the thread's floor above the legend, not above a flat 28", async () => {
    stubWindow(1440, 1000);
    stubZoom();
    zoom = "1.142";
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().style?.top).toBeCloseTo(FOOT(1000, legendHeightPx(1.142)) - 360, 6);
    run.mounted.unmount();
  });

  it("follows a change of zoom with no scroll and no resize: the Fit toggle (the reading-prefs store's `fit`) is subscribed, and the window's bottom moves to the new legend (re-aimed, P10-08: the box no longer re-reads the viewport after every commit — a re-render alone no longer does it)", async () => {
    stubWindow(2560, 1440);
    stubZoom();
    useReadingPrefsStore.setState({ fit: false });
    const run = await scenario(base({ target: inParagraph(first, 4000) }), [
      (tree) => click(tree),
      () => {
        zoom = "1.838";
        useReadingPrefsStore.setState({ fit: true });
      },
    ]);
    await wait();
    useReadingPrefsStore.setState({ fit: false });
    const at = fromOpen(run.looks);

    // Fit off: the flat 28. Fit on: the legend's 51.5 — the same window, moved by the difference.
    expect(bottomOf(at[0].style)).toBeCloseTo(FOOT(1440), 6);
    expect(bottomOf(run.last().style)).toBeCloseTo(FOOT(1440, legendHeightPx(1.838)), 6);
    expect(run.last().style?.top).toBeLessThan(at[0].style?.top ?? 0);
    run.mounted.unmount();
  });

  it("is the flat 28 where Fit is off (zoom 1), where the page has no zoom root and where the zoom is nonsense", async () => {
    stubWindow(1440, 1000);
    for (const [present, value] of [[true, "1"], [false, "1.5"], [true, ""], [true, "0"], [true, "NaN"]] as const) {
      stubZoom(present);
      zoom = value;
      const run = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree)]);
      await wait();

      expect(bottomOf(run.last().style), `root ${present}, zoom "${value}"`).toBeCloseTo(FOOT(1000), 6);
      run.mounted.unmount();
    }
  });
});

// ── The card between the masthead and the foot legend (P9-50; A P9-W3's N7 and §3 c) ───────────────────────────────────
//
// 640 to 1023 px: the card, under or above the selection (P3-02), over the page. It climbed to 12 px at 768 × 1000 with a grown thread — over
// the masthead (`h-12`, from 768 px) — and stood 16 px into the foot legend when placed under the selection. The numbers are `placeCard`'s,
// pinned in `explain-box.card.test.ts`; here the box hands it the window and the legend (`legendHeightPx`, Fit's zoom) and the card keeps
// them. No DOM: the card's inline style is what the box asked for.

describe("ExplainBox — the card stands between the masthead and the foot legend (P9-50, A P9-W3's N7)", () => {
  const oneLine = (top: number, left = 40) => ({ left, top, right: left + 360, bottom: top + 20 });
  /** A selection whose paragraph reaches the column's right edge, so no gutter stands and the control is the legend's pill. */
  const selectedAt = (top: number, width: number): ExplainSelection => ({ ...first, rect: oneLine(top), bounds: oneLine(top), paragraph: { left: 16, top, right: width - 16, bottom: top + 260 } });
  const topEdgeOf = (style: Look["style"], height: number) => style?.top ?? height - (style?.bottom ?? 0) - (style?.maxHeight ?? 0);
  const bottomEdgeOf = (style: Look["style"], height: number) => (style?.top !== undefined ? style.top + (style.maxHeight ?? 0) : height - (style?.bottom ?? 0));

  it("a thread grown by three replies above a low selection stands at the masthead's foot (48) and not over it: 768 × 1000 and 900 × 900", async () => {
    for (const [width, height, top] of [[768, 1000, 944.7], [900, 900, 850]] as const) {
      stubWindow(width, height);
      const run = await scenario(base({ target: selectedAt(top, width), cachedTurns: pairs(3) }), [(tree) => click(tree)]);
      await wait();

      expect(run.last().dock, `${width} x ${height}`).toBe(false);
      expect(run.last().thread?.turns, `${width} x ${height}`).toHaveLength(6);
      expect(run.last().style?.right).toBeUndefined();
      expect(topEdgeOf(run.last().style, height), `${width} x ${height}`).toBeCloseTo(48, 6);
      // Above the words it explains, as P3-02 has it: 8 px clear of the selection's first line.
      expect(bottomEdgeOf(run.last().style, height), `${width} x ${height}`).toBeCloseTo(top - 8, 6);
      run.mounted.unmount();
    }
  });

  it("under a selection higher up, the card ends on the legend's top and not 16 px into it: 768 × 1000 and 900 × 900", async () => {
    for (const [width, height, top] of [[768, 1000, 400], [900, 900, 300]] as const) {
      stubWindow(width, height);
      const run = await scenario(base({ target: selectedAt(top, width), cachedTurns: pairs(3) }), [(tree) => click(tree)]);
      await wait();

      expect(run.last().style?.top, `${width} x ${height}`).toBe(top + 20 + 8);
      expect(bottomEdgeOf(run.last().style, height), `${width} x ${height}`).toBe(height - 28);
      run.mounted.unmount();
    }
  });

  it("follows Fit's zoom: the card's bottom is the legend's top as the page scales it (28 × zoom), as the dock's is", async () => {
    stubWindow(900, 1000);
    (document as unknown as Record<string, unknown>).querySelector = (selector: string) => (selector === "[data-zoom-root]" ? { zoomRoot: true } : null);
    (window as unknown as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: (name: string) => (name === "--page-zoom" ? "1.142" : "") });
    const run = await scenario(base({ target: selectedAt(400, 900), cachedTurns: pairs(3) }), [(tree) => click(tree)]);
    await wait();

    expect(bottomEdgeOf(run.last().style, 1000)).toBeCloseTo(1000 - legendHeightPx(1.142), 6);
    run.mounted.unmount();
  });

  it("under 768 px (no masthead, no legend): the head is the 12-px margin and the bottom the screen's bottom", async () => {
    stubWindow(700, 900);
    const openRef = { current: null as (() => void) | null };
    const above = await scenario(base({ target: selectedAt(840, 700), cachedTurns: pairs(3), openRef }), [() => openRef.current?.()]);
    await wait();
    expect(above.last().dock).toBe(false);
    expect(topEdgeOf(above.last().style, 900)).toBeCloseTo(12, 6);
    above.mounted.unmount();

    const below = await scenario(base({ target: selectedAt(300, 700), cachedTurns: pairs(3), openRef }), [() => openRef.current?.()]);
    await wait();
    expect(bottomEdgeOf(below.last().style, 900)).toBe(900);
    below.mounted.unmount();
  });
});
