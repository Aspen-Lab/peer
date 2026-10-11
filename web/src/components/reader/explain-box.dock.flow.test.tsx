import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P8-02 (BACKLOG-31; the owner's words, 15:3xZ 2026-10-11; ruling §1h.41 (b)): from a window of 1024 px the
// explain window, once open, STAYS open. A new selection in the body does not close it (§1h.3's "a new
// selection closes" is amended for the dock only); "Explain this?" still stands at the new selection, and
// pressing it — or `e` — takes the new passage into the same window: the previous passage's thread is
// replaced (kept for its passage), with no close and reopen and no reflow, so the page's width stays clear
// from the first open to the close. Escape and Close close it, and only then does the page get its width
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
  button: ReactElement<Props2> | undefined;
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
  const card = all.find((el) => el.type === ExplainCard);
  const status = card?.props.status as { kind: string; answer?: ExplainAnswer } | undefined;
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
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
const click = (tree: ReactNode) => (look(tree).button?.props.onClick as () => void)();
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
  it("a new selection does not close it: the window stays on its passage, and the new selection gets its button", async () => {
    const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined }), () => pressOutside()]);
    await wait();

    // From the first opening on, there was never a render without the window.
    expect(fromOpen(run.looks).every((l) => l.card !== undefined)).toBe(true);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().dock).toBe(true);
    // The button is the new selection's: below its end, centred on it.
    expect(run.last().button).toBeDefined();
    expect(run.last().button?.props.style).toEqual({ left: 460 - 60, top: 620 + 6 });
    // The page's width stays clear, and a press on that button (outside the dock) closes nothing.
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

  it("Escape closes it and gives the width back — only then — after two passages", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(second, { cached: SECOND_ANSWER }),
      (tree) => click(tree),
      () => {
        expect(removeProperty).not.toHaveBeenCalled();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
        escape();
      },
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(Object.fromEntries(root)).toEqual({});
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

  it("from 1024 px only: a new selection still closes the card (640 to 1023) and the phone's sheet, and leaves its own button", async () => {
    for (const [width, height, stays] of [[1024, 800, true], [1023, 800, false], [800, 900, false], [640, 900, false], [390, 844, false]] as const) {
      stubWindow(width, height);
      const run = await scenario(base(), [(tree) => click(tree), selectNext(second, { cached: undefined })]);
      await wait();

      expect(run.last().card !== undefined, `${width} px`).toBe(stays);
      expect(run.last().button !== undefined, `${width} px`).toBe(true);
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

  it("keeps the new selection's button clear of the window: it never stands under the 376 px the page leaves free", async () => {
    stubWindow(1280, 800);
    const late: ExplainSelection = { ...second, rect: { left: 700, top: 600, right: 1000, bottom: 620 }, bounds: { left: 700, top: 580, right: 1000, bottom: 620 } };
    const before = await scenario(base({ target: late }), []);
    // No window yet: the button is centred on the end of the selection, as it always was.
    expect(before.last().button?.props.style).toEqual({ left: 1000 - 60, top: 620 + 6 });
    before.mounted.unmount();

    const opened = await scenario(base({ target: first }), [(tree) => click(tree), selectNext(late, { cached: undefined })]);
    await wait();
    // The window open: 1280 − 376 − 120 − 8 at the furthest right.
    expect(opened.last().button?.props.style).toEqual({ left: 1280 - 376 - 120 - 8, top: 620 + 6 });
    opened.mounted.unmount();
  });

  it("measures the new selection again as the page scrolls, for its button", async () => {
    let rect = { left: 200, top: 600, right: 460, bottom: 620 };
    const moving: ExplainSelection = { ...second, measure: () => ({ rect, bounds: rect }) };
    const run = await scenario(base(), [
      (tree) => click(tree),
      selectNext(moving, { cached: undefined }),
      () => {
        rect = { left: 200, top: 300, right: 460, bottom: 320 };
        fire("scroll", {});
      },
      () => {},
    ]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().button?.props.style).toEqual({ left: 460 - 60, top: 320 + 6 });
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

  it("stays under the masthead while the paragraph is scrolled above it, and 160 px above the legend while it is far below", async () => {
    const above = await scenario(base({ target: inParagraph(first, -700) }), [(tree) => click(tree)]);
    await wait();
    expect(above.last().style).toMatchObject({ top: 48, maxHeight: 900 - 48 - 28 });
    above.mounted.unmount();

    const below = await scenario(base({ target: inParagraph(first, 4000) }), [(tree) => click(tree)]);
    await wait();
    expect(below.last().style).toMatchObject({ top: 900 - 28 - 160, maxHeight: 160 });
    below.mounted.unmount();
  });

  it("does not move on a mere selection of the next passage — it moves when that passage is explained", async () => {
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      (tree) => click(tree),
      selectNext(inParagraph(second, 620), { cached: SECOND_ANSWER }),
      // Selected, not explained: the window is still the first passage's, at the first paragraph's top.
      (tree) => tops.push(look(tree).style?.top),
      (tree) => click(tree),
      // Explained: the same window, now level with the second paragraph.
      (tree) => tops.push(look(tree).style?.top),
    ]);
    await wait();

    expect(tops).toEqual([400, 620]);
    expect(run.last().passage).toBe(second.passage);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("follows the paragraph as the page scrolls, and holds the clamp", async () => {
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
      scrollTo(520),
      record,
    ]);
    await wait();

    // Opened where the paragraph was read; then wherever the page puts it, held between 48 and 712 (900 − 28 − 160).
    expect(tops).toEqual([400, 300, 48, 712, 520]);
    run.mounted.unmount();
  });

  it("follows the window as it is resized: the limit above the legend moves with its height", async () => {
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

    // 600 − 28 − 160 = 412 is as low as it may stand; the paragraph at 500 is lower; the height is what is left of it.
    expect(styles).toEqual([{ right: 0, width: 360, top: 412, maxHeight: 160 }]);
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
