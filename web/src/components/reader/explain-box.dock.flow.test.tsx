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
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { ExplainTurn } from "@/store/explain-threads";
import { EXPLAIN } from "./copy";
import { ExplainBox, ExplainCard, placeCard, type AskResult, type ThreadView } from "./explain-box";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

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

// The document's root, where the page's width is kept clear: what is written and what is taken off.
let root: Map<string, string>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
const RESERVED = { "--explain-dock": "376px", "--explain-dock-width": "360px" };
function stubRoot() {
  root = new Map();
  setProperty = vi.fn((name: string, value: string) => void root.set(name, value));
  removeProperty = vi.fn((name: string) => void root.delete(name));
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty, removeProperty } } });
}

beforeEach(() => {
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
const click = (tree: ReactNode) => {
  const at = look(tree);
  const press = (at.button?.props.onClick as (() => void) | undefined) ?? at.explain;
  if (!press) throw new Error("no Explain this? control is standing");
  press();
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
  ...over,
});

describe("ExplainBox — the dock stays open across selections (P8-02, BACKLOG-31)", () => {
  it("a new selection does not close it: the window stays on its passage, and the new selection gets its control (re-aimed, P9-03b: in the window's header, not a floating button)", async () => {
    const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined }), () => pressOutside()]);
    await wait();

    // From the first opening on, there was never a render without the window.
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().dock).toBe(true);
    // P9-03b (re-aimed): the control is the new selection's, in the window's header; there is no floating button to
    // stand below the selection's end (it was {left: 400, top: 626} here), and the window is level with the new selection.
    expect(run.last().explain).toBeTypeOf("function");
    expect(run.last().button).toBeUndefined();
    // The page's width stays clear, and a press on that control (inside the dock) closes nothing.
    expect(Object.fromEntries(root)).toEqual(RESERVED);
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
    // It is the window's now: no button for it, and the width was reserved once and never given back.
    expect(run.last().button).toBeUndefined();
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
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

  it("starts the new passage with an empty draft and the web-search toggle off", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why does it matter?"),
      (tree) => {
        expect(look(tree).thread?.draft).toBe("Why does it matter?");
        look(tree).thread?.search?.onPress();
      },
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().thread?.draft).toBe("");
    expect(run.last().thread?.search?.on).toBe(false);
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

  it("Close closes it and gives the width back — only then — after two passages", async () => {
    // P8-06 (re-aimed): was "Escape closes it…". With a key and a body a window is always there: Escape clears the
    // passage back to the empty state with the width still reserved (`explain-box.escape.flow.test.tsx`), and the
    // width goes back with the Close button.
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      (tree) => {
        expect(removeProperty).not.toHaveBeenCalled();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
        (look(tree).card?.props.onClose as () => void)();
      },
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("Escape after two passages clears the window back to the empty state: the width stays reserved, nothing is taken off (P8-06)", async () => {
    const kinds: string[] = [];
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      () => escape(),
      (tree) => kinds.push(look(tree).card ? "passage" : "empty-or-none"),
    ]);
    await wait();

    // `look().card` is the window with a passage: after Escape there is none, but the window is still there — empty.
    expect(kinds).toEqual(["empty-or-none"]);
    expect(run.last().card).toBeUndefined();
    // The selection that stands is offered again — P9-03b (re-aimed): by the empty window that stays, in its header, not by
    // a floating button; the properties were never touched.
    expect(run.last().explain).toBeTypeOf("function");
    expect(run.last().button).toBeUndefined();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("the Close button closes it and gives the width back, with a new selection standing", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => (look(tree).card?.props.onClose as () => void)(),
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    // The selection that stood is offered again, now that nothing is open.
    expect(run.last().button).toBeDefined();
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

  it("from 1024 px only: a new selection still closes the card (640 to 1023) and the phone's sheet, and leaves its own button (re-aimed, P9-03b: at 1024 the control is the window's, below it the floating button)", async () => {
    for (const [width, height, stays] of [[1024, 800, true], [1023, 800, false], [800, 900, false], [640, 900, false], [390, 844, false]] as const) {
      stubWindow(width, height);
      const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined })]);
      await wait();

      expect(run.last().card !== undefined, `${width} px`).toBe(stays);
      // The control stands in one place only: the window's header where the window stays, the floating button where it closed.
      expect(run.last().explain !== undefined, `${width} px`).toBe(stays);
      expect(run.last().button !== undefined, `${width} px`).toBe(!stays);
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

  it("keeps the new selection's control clear of the window: no floating button stands under the 376 px the page leaves free (re-aimed, P9-03b: the window carries it)", async () => {
    stubWindow(1280, 800);
    const late: ExplainSelection = { ...second, rect: { left: 700, top: 600, right: 1000, bottom: 620 }, bounds: { left: 700, top: 580, right: 1000, bottom: 620 } };
    // P8-06 (re-aimed): "no window yet" is now the reader with no key, whose Tier 0 definition opens on the press
    // (a reader with a key has the empty window from the start, and its button clears the dock the same way:
    // `explain-box.empty.flow.test.tsx`).
    const lateDefined: ExplainSelection = { ...late, passage: "The rafting ratio is the same in all bars." };
    const before = await scenario(base({ target: lateDefined, canAsk: false, terms: [term], cached: undefined }), []);
    // No window yet: the button is centred on the end of the selection, as it always was.
    expect(before.last().button?.props.style).toEqual({ left: 1000 - 60, top: 620 + 6 });
    before.mounted.unmount();

    const opened = await scenario(base({ target: first }), [(tree) => click(tree), selectNext(late, { cached: undefined })]);
    await wait();
    // The window open: P9-03b (re-aimed) — there is no floating button to keep out of it (it stood at 1280 − 376 − 120 − 8
    // at the furthest right); the control is the window's.
    expect(opened.last().button).toBeUndefined();
    expect(opened.last().explain).toBeTypeOf("function");
    opened.mounted.unmount();
  });

  it("measures the new selection again as the page scrolls, for its button (re-aimed, P9-03b: in the card range, where a floating button still stands)", async () => {
    stubWindow(800, 900);
    let rect = { left: 200, top: 600, right: 460, bottom: 620 };
    const moving: ExplainSelection = { ...second, measure: () => ({ rect, bounds: rect }) };
    const run = await scenario(base({ target: moving, cached: undefined }), [
      () => {
        rect = { left: 200, top: 300, right: 460, bottom: 320 };
        fire("scroll", {});
      },
      () => {},
    ]);
    await wait();

    expect(run.last().button?.props.style).toEqual({ left: 460 - 60, top: 320 + 6 });
    run.mounted.unmount();
  });

  // P9-03 (the feature walk's X13): the button stands beside the words, never on them. The body reports the
  // selection's paragraph (P8-02), and with room to its right the button is in the gutter, level with the selection.
  it("P9-03: with the paragraph reported, the new selection's button stands in the gutter beside it, level with the selection (re-aimed, P9-03b: in the card range, where a floating button still stands; with a window open it is the window's control)", async () => {
    stubWindow(800, 900);
    const paragraph = { left: 120, top: 560, right: 600, bottom: 860 };
    const late: ExplainSelection = { ...second, paragraph };
    const run = await scenario(base({ target: late, cached: undefined }), []);

    // 800 px, no window: 200 px right of the paragraph. The button's left is the paragraph's edge and the 6 px gap; its
    // top is the selection's FIRST line (580, `bounds.top`; P9-03b, re-aimed — it was 600, the line the selection ends
    // on), not the 626 under the selection's end.
    expect(run.last().button?.props.style).toEqual({ left: 600 + 6, top: 580 });
    expect((run.last().button?.props.style as { left: number }).left).toBeGreaterThanOrEqual(paragraph.right);
    run.mounted.unmount();
  });

  it("P9-03: with no key (no window open), the button stands in the gutter of the whole window", async () => {
    const lateDefined: ExplainSelection = { ...second, passage: "The rafting ratio is the same in all bars.", paragraph: { left: 120, top: 560, right: 760, bottom: 860 } };
    const run = await scenario(base({ target: lateDefined, canAsk: false, terms: [term], cached: undefined }), []);

    expect(run.last().card).toBeUndefined();
    // P9-03b (re-aimed): level with the selection's first line (580), not the line it ends on (600).
    expect(run.last().button?.props.style).toEqual({ left: 760 + 6, top: 580 });
    run.mounted.unmount();
  });

  it("P9-03: a paragraph that leaves the window less than 136 px keeps today's place under the selection's end (re-aimed, P9-03b: the card range, no dock to narrow the window)", async () => {
    stubWindow(800, 900);
    // The paragraph ends at 700: 100 px to its right.
    const tight: ExplainSelection = { ...second, rect: { left: 500, top: 600, right: 640, bottom: 620 }, paragraph: { left: 120, top: 560, right: 700, bottom: 860 } };
    const run = await scenario(base({ target: tight, cached: undefined }), []);
    expect(run.last().button?.props.style).toEqual({ left: 640 - 60, top: 620 + 6 });
    run.mounted.unmount();

    // One pixel on the threshold's other side (800 − 136 = 664): the gutter.
    const roomy: ExplainSelection = { ...tight, paragraph: { left: 120, top: 560, right: 664, bottom: 860 } };
    const again = await scenario(base({ target: roomy, cached: undefined }), []);
    // P9-03b (re-aimed): the first line's top (580), not the end line's (600).
    expect(again.last().button?.props.style).toEqual({ left: 664 + 6, top: 580 });
    again.mounted.unmount();
  });

  it("P9-03: the button follows its paragraph and selection as the page scrolls (re-aimed, P9-03b: the card range)", async () => {
    stubWindow(800, 900);
    let shift = 0;
    const moving: ExplainSelection = {
      ...second,
      paragraph: { left: 120, top: 560, right: 600, bottom: 860 },
      measure: () => ({
        rect: { left: 200, top: 600 - shift, right: 460, bottom: 620 - shift },
        bounds: { left: 100, top: 580 - shift, right: 460, bottom: 620 - shift },
        paragraph: { left: 120, top: 560 - shift, right: 600, bottom: 860 - shift },
      }),
    };
    const run = await scenario(base({ target: moving, cached: undefined }), [
      () => {
        shift = 250;
        fire("scroll", {});
      },
      () => {},
    ]);
    await wait();
    // P9-03b (re-aimed): the first line's top moves with the page (580 − 250), not the end line's (600 − 250 = 350).
    expect(run.last().button?.props.style).toEqual({ left: 600 + 6, top: 330 });
    run.mounted.unmount();
  });
});

// ── Level with the explained paragraph's first line (P8-02) ─────────────────────────────────────────

/** A selection whose paragraph begins `top` px from the top of the window (its own words lie lower in it). */
const inParagraph = (selection: ExplainSelection, top: number): ExplainSelection => ({ ...selection, paragraph: { left: 120, top, right: 760, bottom: top + 260 } });

describe("ExplainBox — the window stands level with the explained paragraph's first line (P8-02, BACKLOG-31)", () => {
  it("its top is the paragraph's top; its right edge is flush, it is 360 wide, and its height is its content", async () => {
    const run = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => click(tree)]);
    await wait();

    // No `bottom`: the window is as tall as what it holds, at most what is left below its top.
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 400, maxHeight: 900 - 400 - 28 });
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
    expect(run.last().style).toMatchObject({ right: 0, top: 330, maxHeight: 900 - 330 - 28 });
    run.mounted.unmount();
  });

  it("stays under the masthead while the paragraph is scrolled above it, and 360 px above the legend while it is far below (re-aimed, P9-17: a window that holds a passage keeps its header, its controls and two lines; was 160)", async () => {
    const above = await scenario(base({ target: inParagraph(first, -700) }), [(tree) => click(tree)]);
    await wait();
    expect(above.last().style).toMatchObject({ top: 48, maxHeight: 900 - 48 - 28 });
    above.mounted.unmount();

    const below = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree)]);
    await wait();
    expect(below.last().style).toMatchObject({ top: 900 - 28 - 360, maxHeight: 360 });
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
    expect(tops).toEqual([400, 300, 48, 512, 480]);
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

    // 600 − 28 − 360 = 212 is as low as it may stand; the paragraph at 500 is lower; the height is what is left of it
    // (re-aimed, P9-17: it was 412 and 160, the floor of a window with nothing in it).
    expect(styles).toEqual([{ right: 0, width: 360, top: 212, maxHeight: 360 }]);
    run.mounted.unmount();
  });

  it("falls back on the selection's own first line where the body reported no paragraph", async () => {
    const run = await scenario(base({ target: first }), [(tree) => click(tree)]);
    await wait();

    expect(first.paragraph).toBeUndefined();
    expect(run.last().style).toEqual({ right: 0, width: 360, top: first.bounds.top, maxHeight: 900 - first.bounds.top - 28 });
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

    stubWindow(390, 844);
    const sheet = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => click(tree)]);
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
    expect(run.last().style).toEqual({ right: 0, width: 360, top: B_TOP, maxHeight: 900 - B_TOP - 28 });
    // Never a render without the window from its first opening on; the page's width never given back, nothing scrolled.
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
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

    expect(tops).toEqual([900 - 28 - 360, 48]);
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
    expect(tops).toEqual([330, 440, 512]);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — the window carries the Explain this? control (P9-03b, ruling §1h.49)", () => {
  it("shows it while a selection is offered that is not the passage the window explains; the floating button is not rendered", async () => {
    const run = await scenario(base({ target: paraA() }), [
      (tree) => {
        // Before anything is explained the empty window stands: the control is its, and the floating button is not.
        expect(look(tree).explain).toBeDefined();
        expect(look(tree).button).toBeUndefined();
        click(tree);
      },
      (tree) => {
        // A is the window's: nothing on offer.
        expect(look(tree).explain).toBeUndefined();
        expect(look(tree).button).toBeUndefined();
      },
      selectNext(paraB(), { cached: SECOND_ANSWER }),
    ]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().explain).toBeTypeOf("function");
    expect(run.last().button).toBeUndefined();
    run.mounted.unmount();
  });

  it("pressing it explains the offered passage in the same window: no close, no intermediate null, the width never given back", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const loading: Array<{ passage: string | null; status: string | null; top: number | undefined }> = [];
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: undefined, onAsk }),
      (tree) => look(tree).explain?.(),
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
    expect(setProperty).toHaveBeenCalledTimes(2);
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

  it("is the window's whatever its width from 1024 px: no floating Explain button at 1024, 1280, 1440 or 1920, with a passage open or the window empty", async () => {
    for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]] as const) {
      stubWindow(width, height);
      // The empty window, a selection on offer.
      const empty = await scenario(base({ target: paraB() }), []);
      expect(empty.last().button, `${width} px, empty`).toBeUndefined();
      expect(empty.last().explain, `${width} px, empty`).toBeTypeOf("function");
      empty.mounted.unmount();

      // A passage open, another on offer.
      const open = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(paraB(), { cached: SECOND_ANSWER })]);
      await wait();
      expect(open.last().button, `${width} px, open`).toBeUndefined();
      expect(open.last().explain, `${width} px, open`).toBeTypeOf("function");
      open.mounted.unmount();

      // Tier 0: a window open on a definition, another defined passage on offer.
      const tier0 = await scenario(base({ canAsk: false, terms: [term], target: inParagraph({ ...first, passage: "The rafting ratio rose." }, 330), cached: undefined }), [
        (tree) => click(tree),
        selectNext(inParagraph({ ...second, passage: "The rafting ratio is the same in all bars." }, 560)),
      ]);
      await wait();
      expect(tier0.last().button, `${width} px, Tier 0`).toBeUndefined();
      expect(tier0.last().explain, `${width} px, Tier 0`).toBeTypeOf("function");
      tier0.mounted.unmount();
    }
  });

  it("Escape clears the passage and the empty window that stays carries the control for the selection still standing; Close then gives the floating button back", async () => {
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: SECOND_ANSWER }),
      () => escape(),
      (tree) => {
        // P8-06: the window goes back to the empty state, the width still reserved; the selection is still on offer — as the window's control.
        expect(look(tree).card).toBeUndefined();
        expect(look(tree).explain).toBeTypeOf("function");
        expect(look(tree).button).toBeUndefined();
        expect(removeProperty).not.toHaveBeenCalled();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
        // The empty window has followed the selection too.
        expect((elements(tree).find((el) => el.type === ExplainCard)?.props.style as { top: number }).top).toBe(B_TOP);
      },
    ]);
    await wait();
    run.mounted.unmount();

    // Hidden with Close: no window stands, so the floating button does.
    const closed = await scenario(base({ target: paraA() }), [(tree) => click(tree), (tree) => (look(tree).card?.props.onClose as () => void)()]);
    await wait();
    expect(closed.last().card).toBeUndefined();
    expect(closed.last().explain).toBeUndefined();
    expect(closed.last().button).toBeDefined();
    closed.mounted.unmount();
  });
});

describe("ExplainBox — the floating button stands only where no window does (P9-03b, ruling §1h.49)", () => {
  it("is there in the card range and on the phone, and not the window's control", async () => {
    for (const [width, height] of [[1023, 800], [900, 900], [800, 900], [640, 900], [390, 844]] as const) {
      stubWindow(width, height);
      const run = await scenario(base({ target: paraA() }), []);

      expect(run.last().button, `${width} px`).toBeDefined();
      expect(run.last().card, `${width} px`).toBeUndefined();
      expect(run.last().explain, `${width} px`).toBeUndefined();
      run.mounted.unmount();
    }
  });

  it("stays the card's and the sheet's button after they open: a new selection closes them and leaves it", async () => {
    for (const [width, height] of [[900, 900], [390, 844]] as const) {
      stubWindow(width, height);
      const run = await scenario(base({ target: paraA() }), [(tree) => click(tree), selectNext(paraB(), { cached: undefined })]);
      await wait();

      expect(run.last().card, `${width} px`).toBeUndefined();
      expect(run.last().button, `${width} px`).toBeDefined();
      expect(run.last().explain, `${width} px`).toBeUndefined();
      run.mounted.unmount();
    }
  });

  it("is there with no key and no window, for a passage the paper defines, from 1024 px as well", async () => {
    const run = await scenario(base({ canAsk: false, terms: [term], target: inParagraph({ ...first, passage: "The rafting ratio rose." }, 330), cached: undefined }), []);

    expect(run.last().card).toBeUndefined();
    expect(run.last().button).toBeDefined();
    expect(run.last().explain).toBeUndefined();
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

describe("ExplainBox — the header control hands the focus to the window (P9-17)", () => {
  /** The card, the control inside it, the follow-up input once a thread has one, and the page — as far as the box looks. */
  function fakeDom() {
    const page = { name: "body" };
    const outside = { name: "a link elsewhere on the page" };
    const focus: { current: unknown } = { current: page };
    const control = { name: "control" };
    const input = { name: "input", focus: vi.fn(() => void (focus.current = input)) };
    const card = {
      name: "card",
      focus: vi.fn(() => void (focus.current = card)),
      contains: (node: unknown) => node === card || node === control || node === input,
      getBoundingClientRect: () => ({ height: 360 }),
      scrollTop: 0,
      scrollHeight: 360,
    };
    vi.stubGlobal("document", {
      ...recorder(),
      documentElement: { style: { setProperty, removeProperty } },
      get activeElement() {
        return focus.current;
      },
    });
    /** The refs the box hands the card, pointed at the stand-ins (a browser attaches them at commit). */
    const attach = (tree: ReactNode, withInput: boolean) => {
      const element = elements(tree).find((el) => el.type === ExplainCard);
      (element?.props.cardRef as { current: unknown }).current = card;
      (element?.props.inputRef as { current: unknown }).current = withInput ? input : null;
    };
    return { page, outside, focus, control, input, card, attach };
  }
  const pending = () => vi.fn(() => new Promise<AskResult>(() => {}));

  it("moves into the follow-up input when the window holds a thread with one: the keyboard's press leaves the focus in the window, not on <body>", async () => {
    const dom = fakeDom();
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: SECOND_ANSWER, cachedTurns: [] }),
      (tree) => {
        dom.attach(tree, true);
        dom.focus.current = dom.control; // Tab to the control
        look(tree).explain?.(); // Enter
      },
    ]);
    await wait();

    expect(run.last().passage).toBe(second.passage);
    expect(run.last().explain).toBeUndefined();
    expect(dom.focus.current).toBe(dom.input);
    expect(dom.focus.current).not.toBe(dom.page);
    expect(dom.input.focus).toHaveBeenCalledTimes(1);
    expect(dom.card.focus).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("moves to the card itself when the window has no input yet (the answer is on its way): inside the window, not on <body>", async () => {
    const dom = fakeDom();
    const onAsk = pending();
    const run = await scenario(base({ target: paraA(), cached: undefined, onAsk }), [
      (tree) => {
        // The empty window carries the control; the first Explain fills it in place.
        dom.attach(tree, false);
        dom.focus.current = dom.control;
        look(tree).explain?.();
      },
    ]);
    await wait();

    expect(run.last().status).toBe("loading");
    expect(dom.focus.current).toBe(dom.card);
    expect(dom.card.focus).toHaveBeenCalledTimes(1);
    expect(dom.input.focus).not.toHaveBeenCalled();
    expect(dom.card.contains(dom.focus.current)).toBe(true);
    run.mounted.unmount();
  });

  it("does the same for a window that holds the paper's own definition and no input at all (no key)", async () => {
    const dom = fakeDom();
    const definedA = inParagraph({ ...first, passage: "The rafting ratio rose." }, 330);
    const definedB = inParagraph({ ...second, passage: "The rafting ratio is the same in all bars." }, 440);
    const run = await scenario(base({ canAsk: false, terms: [term], target: definedA, cached: undefined }), [
      (tree) => click(tree),
      selectNext(definedB),
      (tree) => {
        dom.attach(tree, false);
        dom.focus.current = dom.control;
        look(tree).explain?.();
      },
    ]);
    await wait();

    expect(run.last().passage).toBe(definedB.passage);
    expect(dom.focus.current).toBe(dom.card);
    run.mounted.unmount();
  });

  it("keeps a reader who was typing in the window's input inside it when the press replaces the thread", async () => {
    const dom = fakeDom();
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: undefined, onAsk: pending() }),
      (tree) => {
        dom.attach(tree, false); // the answer is on its way: the new passage's window has no input yet
        dom.focus.current = dom.input; // the reader's focus was in the input of the thread that is being replaced
        look(tree).explain?.();
      },
    ]);
    await wait();

    expect(dom.focus.current).toBe(dom.card);
    expect(dom.card.focus).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("takes nothing from a reader whose focus is not in the window: a mouse press (the control cancels the mouse-down) or a press while the focus is elsewhere on the page", async () => {
    for (const where of ["page", "outside"] as const) {
      const dom = fakeDom();
      const run = await scenario(base({ target: paraA() }), [
        (tree) => click(tree),
        selectNext(paraB(), { cached: SECOND_ANSWER, cachedTurns: [] }),
        (tree) => {
          dom.attach(tree, true);
          dom.focus.current = dom[where];
          look(tree).explain?.();
        },
      ]);
      await wait();

      expect(run.last().passage, where).toBe(second.passage);
      expect(dom.focus.current, where).toBe(dom[where]);
      expect(dom.input.focus, where).not.toHaveBeenCalled();
      expect(dom.card.focus, where).not.toHaveBeenCalled();
      run.mounted.unmount();
    }
  });

  it("is asked once per press: a later answer, a reply or a new selection does not pull the focus back into the window", async () => {
    const dom = fakeDom();
    const run = await scenario(base({ target: paraA() }), [
      (tree) => click(tree),
      selectNext(paraB(), { cached: SECOND_ANSWER, cachedTurns: [] }),
      (tree) => {
        dom.attach(tree, true);
        dom.focus.current = dom.control;
        look(tree).explain?.();
      },
      () => {
        dom.focus.current = dom.outside; // the reader goes back to the page…
      },
      selectNext(paraA(), { cached: FIRST_ANSWER }), // …and selects the first passage again
    ]);
    await wait();

    expect(dom.input.focus).toHaveBeenCalledTimes(1);
    expect(dom.focus.current).toBe(dom.outside);
    run.mounted.unmount();
  });
});
