import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-02b (ruling §1h.3; §3d 14): what the box does with a thread over time —
// nothing is sent until the reader sends; a send makes one request with the
// thread so far, and its reply joins the thread with the reader's message only
// once it arrives; a failed send leaves the thread as it was and keeps the
// typed words; eight reader messages fill the thread; a full thread is dropped
// when the passage is opened again; `e` (the page's `openRef`) opens the box as
// the button does. The box runs on the minimal hook runtime (no DOM here); the
// element tree it returns is inspected and its handlers called. Every text is
// invented.
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
import { MAX_EXPLAIN_TURNS, type ExplainTurn } from "@/store/explain-threads";
import { ExplainBox, ExplainCard, placeCard, type AskResult, type ThreadView } from "./explain-box";
import { firstAnswerMessage, type ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const term: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const answer: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
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
const second: ExplainSelection = { ...first, paragraphIndex: 0, passage: "Specimens were machined from a single casting." };

const pair = (n: number): ExplainTurn[] => [{ role: "reader", text: `question ${n}` }, { role: "peer", text: `reply ${n}`, peer: true }];
const pairs = (count: number): ExplainTurn[] => Array.from({ length: count }, (_, i) => pair(i + 1)).flat();
const REPLY: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };

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
  thread: ThreadView | undefined;
  style: Record<string, number | undefined> | undefined;
  dock: boolean;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  // P8-06 (re-aimed): `card` is the window that holds a passage. The empty window a reader with a key has from the start
  // (`empty`) is pinned in `explain-box.empty.flow.test.tsx`; here, as before, no card means nothing is open on a passage.
  const card = all.find((el) => el.type === ExplainCard && el.props.empty !== true);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === "Explain this?"),
    card,
    status: card ? (card.props.status as { kind: string }).kind : null,
    thread: card?.props.thread as ThreadView | undefined,
    style: card?.props.style as Look["style"],
    dock: card?.props.dock === true,
  };
};

let listeners: Map<string, Set<(event: unknown) => void>>;
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
beforeEach(() => {
  listeners = new Map();
  vi.stubGlobal("document", recorder());
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
const base = (over: Partial<Props> = {}): Props => ({
  target: first,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => answer),
  cached: answer,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  onResetThread: vi.fn(),
  reading,
  ...over,
});

describe("ExplainBox — the thread is the reader's to send (P3-02b)", () => {
  it("opens with the first answer and the thread kept for the passage, and sends nothing", async () => {
    const kept = pairs(2);
    const props = base({ cachedTurns: kept });
    const run = await scenario(props, [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("answer");
    expect(run.last().thread?.turns).toEqual(kept);
    expect(run.last().thread?.draft).toBe("");
    expect(run.last().thread?.pending).toBe(false);
    expect(run.last().thread?.failed).toBe(false);
    expect(props.onReply).not.toHaveBeenCalled();
    expect(props.onAsk).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("sends nothing while the reader types: the draft is the box's, the request is the send's", async () => {
    const props = base();
    const run = await scenario(props, [(tree) => click(tree), (tree) => draft(tree, "Why does"), (tree) => draft(tree, "Why does it matter?")]);
    await wait();

    expect(run.last().thread?.draft).toBe("Why does it matter?");
    expect(props.onReply).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("clips a draft to 400 characters", async () => {
    const run = await scenario(base(), [(tree) => click(tree), (tree) => draft(tree, "x".repeat(900))]);
    await wait();

    expect(run.last().thread?.draft).toHaveLength(400);
    run.mounted.unmount();
  });

  it("a send makes one request with the target, the thread so far (the first answer first) and the message", async () => {
    const kept = pairs(1);
    const onReply = vi.fn(async (): Promise<ReplyResult> => REPLY);
    const run = await scenario(base({ onReply, cachedTurns: kept }), [(tree) => click(tree), (tree) => draft(tree, "  Why does it matter?  "), (tree) => send(tree)]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIndex: 1, paragraphIndex: 1, passage: first.passage }),
      [firstAnswerMessage(answer), ...kept],
      "Why does it matter?",
    );
    run.mounted.unmount();
  });

  it("while the reply is pending the input is the box's pending state, a second send does nothing and the words stay", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const seen: boolean[] = [];
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      (tree) => {
        seen.push(look(tree).thread?.pending ?? false);
        send(tree);
        expect(look(tree).thread?.draft).toBe("Why?");
        resolve(REPLY);
      },
    ]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true]);
    run.mounted.unmount();
  });

  it("when the reply arrives it joins the thread with the reader's message, and the draft is cleared", async () => {
    const run = await scenario(base(), [(tree) => click(tree), (tree) => draft(tree, "Why does it matter?"), (tree) => send(tree)]);
    await wait();

    const thread = run.last().thread;
    expect(thread?.turns).toEqual([{ role: "reader", text: "Why does it matter?" }, REPLY]);
    expect(thread?.draft).toBe("");
    expect(thread?.pending).toBe(false);
    expect(thread?.failed).toBe(false);
    run.mounted.unmount();
  });

  it("each send builds on the last: the second request carries the first reply", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => REPLY);
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "First?"),
      (tree) => send(tree),
      () => {},
      (tree) => draft(tree, "Second?"),
      (tree) => send(tree),
    ]);
    await wait();

    const calls = onReply.mock.calls as unknown as Array<[unknown, ExplainTurn[], string]>;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual([firstAnswerMessage(answer), { role: "reader", text: "First?" }, REPLY]);
    expect(calls[1][2]).toBe("Second?");
    expect(run.last().thread?.turns).toHaveLength(4);
    run.mounted.unmount();
  });

  it("sends nothing for an empty or blank draft", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => REPLY);
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => send(tree), (tree) => draft(tree, "   \n "), (tree) => send(tree)]);
    await wait();

    expect(onReply).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("a failed reply leaves the thread as it was, keeps the typed words and says so — and the next send can succeed", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => REPLY);
    onReply.mockResolvedValueOnce("unavailable");
    const kept = pairs(1);
    const run = await scenario(base({ onReply, cachedTurns: kept }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why does it matter?"),
      (tree) => send(tree),
      (tree) => {
        const thread = look(tree).thread;
        expect(thread?.failed).toBe(true);
        expect(thread?.pending).toBe(false);
        expect(thread?.draft).toBe("Why does it matter?");
        expect(thread?.turns).toEqual(kept);
        send(tree);
      },
    ]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(2);
    expect(run.last().thread?.failed).toBe(false);
    expect(run.last().thread?.turns).toEqual([...kept, { role: "reader", text: "Why does it matter?" }, REPLY]);
    expect(run.last().thread?.draft).toBe("");
    run.mounted.unmount();
  });

  it("a request that throws is a failed reply too", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => Promise.reject(new Error("boom")));
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread?.failed).toBe(true);
    expect(run.last().thread?.turns).toEqual([]);
    expect(run.last().thread?.draft).toBe("Why?");
    run.mounted.unmount();
  });

  it("does not show a reply that arrives after the reader has moved on, and starts nothing again (the card, 640 to 1023 px)", async () => {
    // P8-02: at 900 px, where a new selection still closes the box; from 1024 px the dock stays and "moved
    // on" is the press on the next passage — that version is in `explain-box.dock.flow.test.tsx`.
    stubWindow(900, 900);
    let resolve!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: second, cached: undefined };
        ctx.rerender();
      },
    ]);
    await wait();
    resolve(REPLY);
    await wait();

    expect(run.looks.every((l) => !l.thread?.turns.some((turn) => turn.text === REPLY.text))).toBe(true);
    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });
});

describe("ExplainBox — at the cap (P3-02b)", () => {
  it("eight reader messages fill the thread: the eighth reply is the last, and a send after it does nothing", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => REPLY);
    const run = await scenario(base({ onReply, cachedTurns: pairs(MAX_EXPLAIN_TURNS - 1) }), [
      (tree) => click(tree),
      (tree) => draft(tree, "The eighth question?"),
      (tree) => send(tree),
      (tree) => {
        expect(look(tree).thread?.turns.filter((turn) => turn.role === "reader")).toHaveLength(MAX_EXPLAIN_TURNS);
        draft(tree, "A ninth?");
      },
      (tree) => send(tree),
    ]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(run.last().thread?.turns).toHaveLength(2 * MAX_EXPLAIN_TURNS);
    run.mounted.unmount();
  });

  it("opens a passage whose thread is full with the first answer and an empty thread, dropping the full one through resetThread", async () => {
    const onResetThread = vi.fn();
    const run = await scenario(base({ onResetThread, cachedTurns: pairs(MAX_EXPLAIN_TURNS) }), [(tree) => click(tree)]);
    await wait();

    expect(onResetThread).toHaveBeenCalledTimes(1);
    expect(onResetThread).toHaveBeenCalledWith(expect.objectContaining({ passage: first.passage, sectionIndex: 1, paragraphIndex: 1 }));
    expect(run.last().status).toBe("answer");
    expect(run.last().thread?.turns).toEqual([]);
    run.mounted.unmount();
  });

  it("does not reset a thread that is not full, and keeps its turns", async () => {
    const onResetThread = vi.fn();
    const run = await scenario(base({ onResetThread, cachedTurns: pairs(MAX_EXPLAIN_TURNS - 1) }), [(tree) => click(tree)]);
    await wait();

    expect(onResetThread).not.toHaveBeenCalled();
    expect(run.last().thread?.turns).toHaveLength(2 * (MAX_EXPLAIN_TURNS - 1));
    run.mounted.unmount();
  });
});

describe("ExplainBox — when there is no thread (P3-02b)", () => {
  it("a Tier 0 box has none: no key, the paper's own definition and nothing to ask", async () => {
    const target = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ canAsk: false, terms: [term], target, cached: undefined }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("none");
    expect(run.last().thread).toBeUndefined();
    run.mounted.unmount();
  });

  it("has none before the first answer arrives, and none when it could not be had", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const loading: Array<ThreadView | undefined> = [];
    const run = await scenario(base({ onAsk, cached: undefined }), [
      (tree) => click(tree),
      (tree) => {
        loading.push(look(tree).thread);
        resolve("unavailable");
      },
    ]);
    await wait();

    expect(loading).toEqual([undefined]);
    expect(run.last().status).toBe("unavailable");
    expect(run.last().thread).toBeUndefined();
    run.mounted.unmount();
  });

  it("has one once the first answer has come, with the thread empty", async () => {
    const run = await scenario(base({ cached: undefined, onAsk: vi.fn(async (): Promise<AskResult> => answer) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("answer");
    expect(run.last().thread?.turns).toEqual([]);
    run.mounted.unmount();
  });

  it("has none when the page gave no way to reply", async () => {
    const run = await scenario(base({ onReply: undefined }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("answer");
    expect(run.last().thread).toBeUndefined();
    run.mounted.unmount();
  });
});

describe("ExplainBox — openRef: e opens the box as the button does (P3-02b)", () => {
  it("hands the page an open function, and takes it back on unmount", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const run = await scenario(base({ openRef }), []);
    await wait();

    expect(typeof openRef.current).toBe("function");
    run.mounted.unmount();
    expect(openRef.current).toBeNull();
  });

  it("opens an answer already kept at once, with no request", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const props = base({ openRef });
    const run = await scenario(props, [() => openRef.current?.()]);
    await wait();

    expect(props.onAsk).not.toHaveBeenCalled();
    expect(run.last().status).toBe("answer");
    expect(run.last().thread?.turns).toEqual([]);
    run.mounted.unmount();
  });

  it("asks once when nothing is kept — the same one request the click makes", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const run = await scenario(base({ openRef, onAsk, cached: undefined }), [() => openRef.current?.()]);
    await wait();

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: first.passage, sectionIndex: 1, paragraphIndex: 1 }));
    expect(run.last().status).toBe("answer");
    run.mounted.unmount();
  });

  it("opens the Tier 0 box without a key when the paper defines a term in the passage, and asks nothing", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const target = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ openRef, onAsk, canAsk: false, terms: [term], target, cached: undefined }), [() => openRef.current?.()]);
    await wait();

    expect(onAsk).not.toHaveBeenCalled();
    expect(run.last().status).toBe("none");
    run.mounted.unmount();
  });

  it("does nothing with no term and no key, or with no selection", async () => {
    for (const over of [{ canAsk: false, terms: [] as PaperTerm[] }, { target: null }]) {
      const openRef: NonNullable<Props["openRef"]> = { current: null };
      const props = base({ openRef, cached: undefined, ...over });
      const run = await scenario(props, [() => openRef.current?.()]);
      await wait();

      expect(props.onAsk).not.toHaveBeenCalled();
      expect(run.last().card).toBeUndefined();
      run.mounted.unmount();
    }
  });

  it("with the box already open, e goes to the input: it focuses it and opens nothing twice", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const focus = vi.fn();
    const run = await scenario(base({ openRef, onAsk }), [
      (tree) => click(tree),
      (tree) => {
        (look(tree).card?.props.inputRef as { current: unknown }).current = { focus };
        openRef.current?.();
      },
    ]);
    await wait();

    expect(focus).toHaveBeenCalledTimes(1);
    expect(onAsk).not.toHaveBeenCalled();
    expect(run.last().status).toBe("answer");
    run.mounted.unmount();
  });
});

describe("ExplainBox — where the panel stands (P3-02b; P7-15, R7)", () => {
  // P7-15 (R7, Q4): from 1024 px the box is the dock at the window's right edge, wherever the
  // selection is and whatever the text column does; the card remains between 640 and 1024.
  // P8-02 (BACKLOG-31): the dock's top is level with the explained paragraph's first line (the selection
  // reports the paragraph's box), no longer the masthead's foot for every selection; its height is its
  // content. These two were "top 48, bottom 28" for any selection and are re-aimed to the new rule; the
  // clamp, the scroll and the move on the next passage are in `explain-box.dock.flow.test.tsx`.
  it("the dock on a window of 1440: flush right, 360 wide, its top the paragraph's, no bottom of its own", async () => {
    stubWindow(1440, 900);
    const run = await scenario(base({ target: { ...first, paragraph: { left: 120, top: 260, right: 760, bottom: 520 } } }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().style).toEqual({ right: 0, width: 360, top: 260, maxHeight: 900 - 260 - 28 });
    expect(run.last().dock).toBe(true);
    run.mounted.unmount();
  });

  it("the dock at 1280 and at 1920 too, and where the selection's words are within the paragraph changes nothing", async () => {
    for (const [width, height] of [[1280, 800], [1920, 1080]]) {
      stubWindow(width, height);
      const paragraph = { left: 120, top: 300, right: 760, bottom: 600 };
      for (const target of [{ ...first, paragraph }, { ...first, paragraph, bounds: { left: width - 300, top: height - 40, right: width - 20, bottom: height - 10 } }]) {
        const run = await scenario(base({ target }), [(tree) => click(tree)]);
        await wait();

        expect(run.last().style).toEqual({ right: 0, width: 360, top: 300, maxHeight: height - 300 - 28 });
        expect(run.last().dock).toBe(true);
        run.mounted.unmount();
      }
    }
  });

  it("where the first card stood below 1024 px: under the selection, not the dock", async () => {
    stubWindow(800, 900);
    const expected = placeCard(first.bounds, { width: 800, height: 900 });
    const run = await scenario(base(), [(tree) => click(tree)]);
    await wait();

    expect(run.last().style).toMatchObject({ left: expected.left, width: expected.width });
    expect(run.last().style?.right).toBeUndefined();
    expect(run.last().dock).toBe(false);
    run.mounted.unmount();
  });

  it("a bottom sheet on a phone: the whole width, on the bottom edge, at most 60% of the height", async () => {
    stubWindow(390, 844);
    const run = await scenario(base(), [(tree) => click(tree)]);
    await wait();

    const style = run.last().style;
    expect(style).toMatchObject({ left: 0, width: 390, bottom: 0 });
    expect(style?.top).toBeUndefined();
    expect(style?.maxHeight).toBeLessThanOrEqual(0.6 * 844);
    run.mounted.unmount();
  });

  it("on a phone, scrolls the page so the selection stays above the sheet as the sheet grows", async () => {
    stubWindow(390, 844);
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => {
        const cardRef = look(tree).card?.props.cardRef as { current: unknown };
        cardRef.current = { getBoundingClientRect: () => ({ height: 500 }) };
        draft(tree, "Why?");
      },
      (tree) => send(tree),
    ]);
    await wait();

    // The selection ends at 420; the sheet's top stands at 344, less a margin.
    expect(scrollBy).toHaveBeenCalledWith({ top: 420 - (844 - 500 - 12) });
    run.mounted.unmount();
  });

  it("does not scroll a page on the spread", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => {
        draft(tree, "Why?");
      },
      (tree) => send(tree),
    ]);
    await wait();

    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — Escape and the thread (P3-02b)", () => {
  it("Escape closes the box with a thread in it, and the thread stays the store's", async () => {
    const run = await scenario(base({ cachedTurns: pairs(1) }), [
      (tree) => click(tree),
      () => {
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        for (const listener of listeners.get("keydown") ?? []) listener(event);
        expect(event.stopPropagation).toHaveBeenCalled();
      },
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });
});

// ── The page makes room (P7-15, R7 / Q4) ────────────────────────────────

describe("ExplainBox — the page keeps the dock's width clear while it is open (P7-15)", () => {
  let root: Map<string, string>;
  const stubRoot = () => {
    root = new Map();
    const style = { setProperty: (name: string, value: string) => void root.set(name, value), removeProperty: (name: string) => void root.delete(name) };
    vi.stubGlobal("document", { ...recorder(), documentElement: { style } });
  };
  const escape = () => {
    for (const listener of listeners.get("keydown") ?? []) listener({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
  };
  const resizeTo = (width: number, height: number) => {
    stubWindow(width, height);
    for (const listener of listeners.get("resize") ?? []) listener({});
  };
  const RESERVED = { "--explain-dock": "376px", "--explain-dock-width": "360px" };

  beforeEach(() => {
    stubRoot();
    stubWindow(1440, 900);
  });

  it("reserves nothing while only the button stands, and 376 px once the box is open as a dock (no key: the Tier 0 definition)", async () => {
    // P8-06 (re-aimed): with a key and a body the page keeps the 376 px clear from the mount, before any button
    // (`explain-box.empty.flow.test.tsx`). Without a key nothing stands before the press, as this pinned.
    let before: Record<string, string> = { unset: "yes" };
    const defined = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ canAsk: false, terms: [term], target: defined, cached: undefined }), [
      (tree) => {
        before = Object.fromEntries(root);
        expect(look(tree).button).toBeDefined();
        click(tree);
      },
    ]);
    await wait();

    expect(before).toEqual({});
    expect(run.last().dock).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("gives the width back when the box closes: Escape, the Close button, and leaving the page", async () => {
    const closers: Array<[string, Step]> = [
      ["Escape", () => escape()],
      ["Close", (tree) => (look(tree).card?.props.onClose as () => void)()],
    ];
    for (const [, close] of closers) {
      const run = await scenario(base(), [(tree) => click(tree), close]);
      await wait();
      expect(run.last().card).toBeUndefined();
      expect(Object.fromEntries(root)).toEqual({});
      run.mounted.unmount();
    }

    const open = await scenario(base(), [(tree) => click(tree)]);
    await wait();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    open.mounted.unmount();
    expect(Object.fromEntries(root)).toEqual({});
  });

  it("keeps it for the Tier 0 definition card as well, which is the dock too", async () => {
    const target = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ canAsk: false, terms: [term], target, cached: undefined }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("none");
    expect(run.last().dock).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("reserves nothing for the card (640 to 1023 px) or the phone's sheet: those stand over the page, as before", async () => {
    for (const [width, height] of [[800, 900], [390, 844]]) {
      stubWindow(width, height);
      const run = await scenario(base(), [(tree) => click(tree)]);
      await wait();

      expect(run.last().card).toBeDefined();
      expect(run.last().dock).toBe(false);
      expect(Object.fromEntries(root)).toEqual({});
      run.mounted.unmount();
    }
  });

  it("follows the window across 1024 px while the box is open: the width goes with the dock and comes back with it", async () => {
    const seen: Array<{ dock: boolean; root: Record<string, string> }> = [];
    const snap = (tree: ReactNode) => seen.push({ dock: look(tree).dock, root: Object.fromEntries(root) });
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => snap(tree),
      () => resizeTo(800, 900),
      (tree) => {
        snap(tree);
        resizeTo(1280, 800);
      },
      (tree) => snap(tree),
      () => resizeTo(1023, 800),
      (tree) => {
        snap(tree);
        resizeTo(1024, 800);
      },
      (tree) => snap(tree),
    ]);
    await wait();

    expect(seen).toEqual([
      { dock: true, root: RESERVED },
      { dock: false, root: {} },
      { dock: true, root: RESERVED },
      { dock: false, root: {} },
      { dock: true, root: RESERVED },
    ]);
    run.mounted.unmount();
  });

  it("reads where the selection is after the page has reflowed, so the button stands by the words again once the dock closes", async () => {
    // What the page captured when the selection was made (`first.rect`: right 420, bottom 420) is not
    // where the words stand once the dock has come and gone: after the reflow they are at right 700,
    // bottom 500 in the wide page. The button must follow the measure, not the first capture.
    const wide = { rect: { left: 560, top: 480, right: 700, bottom: 500 }, bounds: { left: 560, top: 480, right: 700, bottom: 500 } };
    const narrow = { rect: { left: 300, top: 900, right: 380, bottom: 920 }, bounds: { left: 300, top: 900, right: 380, bottom: 920 } };
    const target: ExplainSelection = { ...first, measure: () => (root.has("--explain-dock") ? narrow : wide) };
    const buttonAt: Array<{ left?: number; top?: number }> = [];
    const run = await scenario(base({ target }), [
      (tree) => buttonAt.push(look(tree).button?.props.style as { left?: number; top?: number }),
      (tree) => click(tree),
      () => {},
      () => escape(),
    ]);
    await wait();
    const style = run.last().button?.props.style as { left: number; top: number } | undefined;

    // Before the dock the button is where the first capture put it: just below its end, centred on it.
    expect(buttonAt[0]).toEqual({ left: 420 - 60, top: 420 + 6 });
    // After the dock closed it is below the words' end where the measure says they are.
    expect(run.last().card).toBeUndefined();
    expect(style).toEqual({ left: 700 - 60, top: 500 + 6 });
    run.mounted.unmount();
  });
});

// The reflow moves the words. A selection deep in a paper sits hundreds of pixels lower (or higher) once
// the column is narrower (or wide again): measured in a browser at 1280, a selection at the middle of the
// window went to 1,095 px — below the window — when the dock opened, and the browser's own scroll
// anchoring had moved the page by only 82. So the box holds the selection where it was on the screen:
// it reads the selection's top, changes the layout, reads it again and scrolls the page by the
// difference, all before the next paint.
describe("ExplainBox — the selection stays where it was on the screen across the reflow (P7-15)", () => {
  let root: Map<string, string>;
  /** A selection whose top depends on the layout: 300 in the wide page, 1,100 once the dock's width is kept clear. */
  const reflowing = (wide = 300, narrow = 1100): ExplainSelection => ({
    ...first,
    measure: () => {
      const top = root.has("--explain-dock") ? narrow : wide;
      return { rect: { ...first.rect, top, bottom: top + 20 }, bounds: { ...first.bounds, top, bottom: top + 20 } };
    },
  });
  const escape = () => {
    for (const listener of listeners.get("keydown") ?? []) listener({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
  };

  beforeEach(() => {
    root = new Map();
    const style = { setProperty: (name: string, value: string) => void root.set(name, value), removeProperty: (name: string) => void root.delete(name) };
    vi.stubGlobal("document", { ...recorder(), documentElement: { style } });
    stubWindow(1280, 800);
  });

  it("scrolls the page by how far the words moved when the dock opens, and back by as far when it closes", async () => {
    const run = await scenario(base({ target: reflowing() }), [(tree) => click(tree), () => {}, () => escape()]);
    await wait();

    expect(scrollBy.mock.calls).toEqual([[{ top: 800, behavior: "instant" }], [{ top: -800, behavior: "instant" }]]);
    run.mounted.unmount();
  });

  it("does not scroll when the words did not move, and not for a selection it cannot measure", async () => {
    const still = await scenario(base({ target: reflowing(300, 300) }), [(tree) => click(tree), () => {}, () => escape()]);
    await wait();
    still.mounted.unmount();
    const unmeasured = await scenario(base(), [(tree) => click(tree), () => {}, () => escape()]);
    await wait();

    expect(scrollBy).not.toHaveBeenCalled();
    unmeasured.mounted.unmount();
  });

  it("gives the width back without scrolling when the reader leaves the paper with the dock open", async () => {
    const run = await scenario(base({ target: reflowing() }), [(tree) => click(tree)]);
    await wait();
    scrollBy.mockClear();
    run.mounted.unmount();

    expect(root.size).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("holds the NEW selection when the box closes with a new passage selected, not the one the box was opened for", async () => {
    // P8-02 (BACKLOG-31): a new selection no longer closes the dock — it stays open, so the closing that
    // can meet a new selection is the reader's (Escape) with the next passage selected and not explained.
    // The old words are 300 wide / 1,100 narrow; the new ones 500 wide / 650 narrow: closing moves them by 150.
    const old = reflowing();
    const next: ExplainSelection = { ...reflowing(500, 650), passage: "Specimens were machined from a single casting." };
    const run = await scenario(base({ target: old }), [
      (tree) => click(tree),
      () => {},
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: next };
        ctx.rerender();
      },
      () => {},
      () => escape(),
    ]);
    await wait();

    // 800 on opening (the old words); on closing, the new words' own 650 -> 500, not the old ones' 1,100 -> 300.
    expect(scrollBy.mock.calls).toEqual([[{ top: 800, behavior: "instant" }], [{ top: -150, behavior: "instant" }]]);
    run.mounted.unmount();
  });
});
