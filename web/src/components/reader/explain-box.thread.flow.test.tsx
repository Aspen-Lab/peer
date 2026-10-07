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
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === "Explain this?"),
    card,
    status: card ? (card.props.status as { kind: string }).kind : null,
    thread: card?.props.thread as ThreadView | undefined,
    style: card?.props.style as Look["style"],
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

  it("does not show a reply that arrives after the reader has moved on, and starts nothing again", async () => {
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

describe("ExplainBox — where the panel stands (P3-02b)", () => {
  it("beside the text on the spread when the column leaves 376 px: 360 wide, at the selection's top", async () => {
    stubWindow(1440, 900);
    const run = await scenario(base({ column: () => ({ right: 1000 }) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().style).toMatchObject({ left: 1016, width: 360, top: 380 });
    run.mounted.unmount();
  });

  it("where the first card stood when the column leaves no room, or when none is given", async () => {
    stubWindow(1440, 900);
    const expected = placeCard(first.bounds, { width: 1440, height: 900 });
    for (const column of [() => ({ right: 1200 }), undefined, () => null]) {
      const run = await scenario(base({ column }), [(tree) => click(tree)]);
      await wait();

      expect(run.last().style).toMatchObject({ left: expected.left, width: expected.width });
      run.mounted.unmount();
    }
  });

  it("a bottom sheet on a phone: the whole width, on the bottom edge, at most 60% of the height", async () => {
    stubWindow(390, 844);
    const run = await scenario(base({ column: () => ({ right: 100 }) }), [(tree) => click(tree)]);
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
