import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P10-08 (the owner's review of 2026-10-13, items 8.4-8.5; ruling §1h.78): nothing stands when a paper is entered — no empty window, no
// reserved width, no pill — and the window exists only while a passage is open. It opens from the page's `explain` action alone (the
// selection buttons and the `e` key, the box's `openRef`), and Close and Escape both close it and give the page its width back. While
// it is open it stays across a new selection and follows the selected paragraph (P8-02, P9-03b). The box runs on the minimal hook
// runtime (no DOM here); the element tree it returns is inspected and its handlers called. Every text is invented.
// (Replaces P8-06's `explain-box.empty.flow.test.tsx`, which pinned the always-present empty window.)
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
import { ExplainBox, ExplainCard, type AskResult, type ThreadView } from "./explain-box";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const term: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const FIRST_ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
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
/** A selection whose paragraph begins `top` px from the top of the window (its own words lie lower in it). */
const inParagraph = (selection: ExplainSelection, top: number): ExplainSelection => ({ ...selection, paragraph: { left: 120, top, right: 760, bottom: top + 260 } });

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

interface Look {
  /** The window, when one stands. */
  card: ReactElement<Props2> | undefined;
  /** Anything that is a button of the box's own besides the window's (a pill): there is none. */
  loose: number;
  status: string | null;
  passage: string | null;
  thread: ThreadView | undefined;
  term: string | null;
  style: Record<string, number | undefined> | undefined;
  dock: boolean;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  const status = card?.props.status as { kind: string } | undefined;
  return {
    card,
    loose: all.filter((el) => el.type === "button").length,
    status: status?.kind ?? null,
    passage: (card?.props.passage as string | undefined) ?? null,
    thread: card?.props.thread as ThreadView | undefined,
    term: (card?.props.term as PaperTerm | null | undefined)?.term ?? null,
    style: card?.props.style as Look["style"],
    dock: card?.props.dock === true,
  };
};

let listeners: Map<string, Set<(event: unknown) => void>>;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
const listening = (type: string) => listeners.get(type)?.size ?? 0;
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
function stubWindow(width = 1280, height = 800) {
  scrollBy = vi.fn();
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, scrollBy, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
}

// The document's root: what is written on it and what is taken off. P11-14 (re-aimed, §1c; B P11-01 §3.1): the dock used to keep the page's
// width clear with two custom properties on the root (`--explain-dock` 376px, `--explain-dock-width` 360px). The margin is a grid track of
// the reader's shell now, so NOTHING is reserved: every assertion below that read "the properties are written / are taken off" reads
// "nothing was ever written".
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

let openRef: { current: (() => void) | null };
beforeEach(() => {
  listeners = new Map();
  openRef = { current: null };
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
/** The page's `explain` action: the selection buttons and the `e` key call it. */
const open = () => openRef.current?.();
const close = (tree: ReactNode) => (look(tree).card?.props.onClose as () => void)();
const draft = (tree: ReactNode, text: string) => look(tree).thread?.onDraft(text);
const escapeEvent = () => ({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
const pressOutside = () => fire("pointerdown", { target: { closest: () => null } });
/** The reader selects `next` in the body (or nothing): the page hands the box a new target. */
const selectNext =
  (next: ExplainSelection | null, over: Partial<Props> = {}): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next, ...over };
    ctx.rerender();
  };

const pair = (n: number): ExplainTurn[] => [{ role: "reader", text: `question ${n}` }, { role: "peer", text: `reply ${n}`, peer: true }];

/** A reader with a key, a paper with a body, no selection yet. */
const base = (over: Partial<Props> = {}): Props => ({
  target: null,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => FIRST_ANSWER),
  cached: FIRST_ANSWER,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  onResetThread: vi.fn(),
  reading,
  openRef,
  ...over,
});

describe("ExplainBox — nothing stands on entering a paper (P10-08, review 8.5)", () => {
  it("at 1280 with a key and a body, no selection: no window in any render, nothing reserved, no listener", async () => {
    const run = await scenario(base(), []);
    await wait();

    expect(run.looks.every((l) => l.card === undefined && l.loose === 0)).toBe(true);
    expect(setProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual({});
    for (const type of ["keydown", "pointerdown", "resize", "scroll"]) expect(listening(type), type).toBe(0);
    run.mounted.unmount();
  });

  it("with a selection already made it is the same: the selection draws no pill and reserves nothing; only the selection is watched", async () => {
    const run = await scenario(base({ target: inParagraph(first, 400) }), []);
    await wait();

    expect(run.looks.every((l) => l.card === undefined && l.loose === 0)).toBe(true);
    expect(setProperty).not.toHaveBeenCalled();
    expect(listening("keydown")).toBe(0);
    expect(listening("pointerdown")).toBe(0);
    run.mounted.unmount();
  });

  it("is the same without a key, at 1024, 1440 and 1920, and at the card's and the sheet's widths", async () => {
    for (const width of [390, 800, 1023, 1024, 1440, 1920]) {
      for (const canAsk of [true, false]) {
        stubRoot();
        stubWindow(width, 900);
        const run = await scenario(base({ canAsk, target: first, terms: [term] }), []);
        await wait();

        expect(run.looks.every((l) => l.card === undefined && l.loose === 0), `${width} px, canAsk ${canAsk}`).toBe(true);
        expect(setProperty, `${width} px, canAsk ${canAsk}`).not.toHaveBeenCalled();
        run.mounted.unmount();
      }
    }
  });

  it("`e` (the page's explain action) with nothing selected and nothing open does nothing", async () => {
    const run = await scenario(base(), [() => open()]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — it opens from the page's explain action only (P10-08, review 8.4)", () => {
  it("the action opens the selected passage in the dock, and the page's width is never reserved — nothing is written (re-aimed, P11-14: was \"…and only then is the page's width reserved\")", async () => {
    const seen: Array<Record<string, string>> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      () => seen.push(Object.fromEntries(root)),
      () => open(),
      () => seen.push(Object.fromEntries(root)),
    ]);
    await wait();

    expect(seen).toEqual([{}, NOTHING_RESERVED]);
    expect(setProperty).not.toHaveBeenCalled();
    expect(run.last().dock).toBe(true);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 400, maxHeight: 800 - 400 - 28 });
    run.mounted.unmount();
  });

  it("asks nothing until then: the open action is the only request", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const run = await scenario(base({ target: first, cached: undefined, onAsk }), [selectNext(first), () => expect(onAsk).not.toHaveBeenCalled(), () => open()]);
    await wait();

    expect(onAsk).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("with no key it opens the paper's own definition for a defined term, and has nothing to open for any other words", async () => {
    const defined = { ...first, passage: "The rafting ratio rose." };
    const some = await scenario(base({ canAsk: false, terms: [term], target: defined }), [() => open()]);
    await wait();
    expect(some.last().term).toBe("rafting ratio");
    expect(some.last().status).toBe("none");
    some.mounted.unmount();

    stubRoot();
    const none = await scenario(base({ canAsk: false, terms: [term], target: second }), [() => open()]);
    await wait();
    expect(none.last().card).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    none.mounted.unmount();
  });

  it("the card (640 to 1023 px) and the sheet (under 640 px) open the same way and reserve nothing", async () => {
    for (const width of [800, 390]) {
      stubRoot();
      stubWindow(width, 900);
      const run = await scenario(base({ target: first }), [() => open()]);
      await wait();

      expect(run.last().card, `${width} px`).toBeDefined();
      expect(run.last().dock, `${width} px`).toBe(false);
      expect(setProperty, `${width} px`).not.toHaveBeenCalled();
      run.mounted.unmount();
    }
  });
});

describe("ExplainBox — Close and Escape both close it (P10-08, review 8.5)", () => {
  it("Close leaves no listener of the keyboard or the pointer, and no window, and has nothing to give back (re-aimed, P11-14: was \"Close gives the width back…\")", async () => {
    const run = await scenario(base({ target: first }), [() => open(), (tree) => close(tree)]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual({});
    expect(listening("keydown")).toBe(0);
    expect(listening("pointerdown")).toBe(0);
    run.mounted.unmount();
  });

  it("Escape clears the passage and CLOSES the window — there is no empty state to go back to — and the key goes no further", async () => {
    const event = escapeEvent();
    const looks: string[] = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      () => open(),
      (tree) => draft(tree, "And at a lower temperature?"),
      () => fire("keydown", event),
    ]);
    await wait();
    run.looks.forEach((l) => looks.push(l.card ? "window" : "none"));

    expect(run.last().card).toBeUndefined();
    expect(looks[looks.length - 1]).toBe("none");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(root)).toEqual({});
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });

  it("then the next Escape is the page's: no listener of the box's is left to take it", async () => {
    const second1 = escapeEvent();
    const run = await scenario(base({ target: first }), [() => open(), () => fire("keydown", escapeEvent()), () => fire("keydown", second1)]);
    await wait();

    expect(second1.preventDefault).not.toHaveBeenCalled();
    expect(second1.stopPropagation).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("reopening a passage already explained shows its kept thread, and still nothing is reserved (re-aimed, P11-14: was \"…and the width is reserved again\")", async () => {
    const kept = pair(1);
    const run = await scenario(base({ target: first, cachedTurns: kept }), [() => open(), (tree) => close(tree), () => open()]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().thread?.turns).toEqual(kept);
    expect(Object.fromEntries(root)).toEqual(NOTHING_RESERVED);
    expect(setProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("a press outside the dock closes nothing: the page's width must not move under the pointer (P7-15)", async () => {
    const run = await scenario(base({ target: first }), [() => open(), () => pressOutside()]);
    await wait();

    expect(run.last().card).toBeDefined();
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — while it is open (P8-02, P9-03b kept)", () => {
  it("a new selection does not close it, and gives no pill: explaining it takes the new passage into the same window in place", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const seen: Array<string | null> = [];
    const run = await scenario(base({ target: inParagraph(first, 400), onAsk }), [
      () => open(),
      selectNext(inParagraph(second, 150), { cached: undefined }),
      (tree) => seen.push(look(tree).passage),
      () => open(),
    ]);
    await wait();

    // The window stood on the first passage through the new selection, with no control of its own for it…
    expect(seen).toEqual([first.passage]);
    expect(run.looks.every((l) => l.loose === 0)).toBe(true);
    // …and the action took the new passage into it: never null on the way, nothing reserved or given back (re-aimed, P11-14).
    expect(run.looks.filter((l) => l.card).every((l) => l.passage !== null)).toBe(true);
    expect(run.last().passage).toBe(second.passage);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("it stands level with the first line of the SELECTED paragraph, and stays there when the selection goes away", async () => {
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      () => open(),
      (tree) => tops.push(look(tree).style?.top),
      selectNext(inParagraph(second, 150)),
      (tree) => tops.push(look(tree).style?.top),
      selectNext(null),
    ]);
    await wait();
    tops.push(run.last().style?.top);

    expect(tops).toEqual([400, 150, 150]);
    run.mounted.unmount();
  });

  it("follows the window's width: the dock is a card below 1024 and a dock again at 1024 and over, and nothing is ever reserved (re-aimed, P11-14: was \"…(the width given back)…\")", async () => {
    const seen: Array<{ dock: boolean; root: Record<string, string> }> = [];
    const note: Step = (tree) => seen.push({ dock: look(tree).dock, root: Object.fromEntries(root) });
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      () => open(),
      note,
      () => {
        stubWindow(800, 900);
        fire("resize", {});
      },
      note,
      () => {
        stubWindow(1440, 900);
        fire("resize", {});
      },
      note,
    ]);
    await wait();

    expect(seen).toEqual([
      { dock: true, root: NOTHING_RESERVED },
      { dock: false, root: NOTHING_RESERVED },
      { dock: true, root: NOTHING_RESERVED },
    ]);
    run.mounted.unmount();
  });

  it("survives what a tab switch does to the box: the page clears the selection, and the open window stays with its thread and draft", async () => {
    const kept = pair(1);
    const run = await scenario(base({ target: inParagraph(first, 400), cachedTurns: kept }), [
      () => open(),
      (tree) => draft(tree, "And at a lower temperature?"),
      selectNext(null, { cached: undefined, cachedTurns: undefined }),
    ]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().thread?.turns).toEqual(kept);
    expect(run.last().thread?.draft).toBe("And at a lower temperature?");
    expect(run.last().style?.top).toBe(400);
    expect(run.looks.filter((l) => l.passage !== null).every((l) => l.card)).toBe(true);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("it listens only while a passage is open: the resize and scroll are gone with it", async () => {
    const run = await scenario(base({ target: first }), [
      () => {
        expect(listening("keydown")).toBe(0);
        // A selection alone is watched (it can be measured again), a window adds the keyboard and the pointer.
        expect(listening("resize")).toBe(1);
      },
      () => open(),
      () => {
        expect(listening("keydown")).toBe(1);
        expect(listening("pointerdown")).toBe(1);
      },
      (tree) => close(tree),
      selectNext(null),
    ]);
    await wait();

    expect(listening("keydown")).toBe(0);
    expect(listening("pointerdown")).toBe(0);
    expect(listening("resize")).toBe(0);
    run.mounted.unmount();
  });
});

// ── A selection of the Summary or an answer (P10-08, review 8.4) ──────────────────────────────────────

describe("ExplainBox — a selection of the Summary or an answer is explained like the paper's (P10-08, review 8.4)", () => {
  const summary: ExplainSelection = {
    sectionIndex: -1,
    paragraphIndex: -1,
    passage: "Peer's reading of the alloy's rafting.",
    source: "summary",
    paragraphId: "summary",
    rect: { left: 300, top: 640, right: 420, bottom: 660 },
    bounds: { left: 100, top: 620, right: 420, bottom: 660 },
  };
  const answer: ExplainSelection = { ...summary, passage: "The ratio is the share of plates.", source: "answer", paragraphId: "answers" };

  it("opens it in the dock, at the masthead's foot — there is no paragraph of the paper to be level with — and asks with where it is from", async () => {
    for (const target of [summary, answer]) {
      stubRoot();
      const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
      const run = await scenario(base({ target, cached: undefined, onAsk }), [() => open()]);
      await wait();

      expect(run.last().dock, target.source).toBe(true);
      expect(run.last().passage, target.source).toBe(target.passage);
      expect(run.last().style, target.source).toEqual({ right: 0, width: 360, top: 48, maxHeight: 800 - 48 - 28 });
      expect(run.last().card?.props.source, target.source).toBe(target.source);
      expect(onAsk, target.source).toHaveBeenCalledWith(expect.objectContaining({ passage: target.passage, source: target.source, paragraphId: target.paragraphId, sectionIndex: -1 }));
      expect(Object.fromEntries(root), target.source).toEqual(NOTHING_RESERVED);
      run.mounted.unmount();
    }
  });

  it("while a window is open, a selection in the Summary moves it to the masthead's foot, and one in the body moves it to the paragraph again", async () => {
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      () => open(),
      (tree) => tops.push(look(tree).style?.top),
      selectNext(summary),
      (tree) => tops.push(look(tree).style?.top),
      selectNext(inParagraph(second, 300)),
    ]);
    await wait();
    tops.push(run.last().style?.top);

    expect(tops).toEqual([400, 48, 300]);
    expect(run.last().passage).toBe(first.passage);
    run.mounted.unmount();
  });

  it("the page's explain action takes the Summary selection into the open window in place, and the thread is kept for those words", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const run = await scenario(base({ target: inParagraph(first, 400), onAsk }), [() => open(), selectNext(summary, { cached: undefined, onAsk }), () => open()]);
    await wait();

    expect(run.looks.filter((l) => l.card).every((l) => l.passage !== null)).toBe(true);
    expect(run.last().passage).toBe(summary.passage);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(onAsk).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("the thumb bar is offered the selection under 768 px as for the paper's own", async () => {
    stubWindow(390, 844);
    const run = await scenario(base({ target: summary }), []);
    await wait();
    expect((await import("@/lib/reader/explain-offer")).explainOffered()).toBe(true);
    run.mounted.unmount();
  });
});
