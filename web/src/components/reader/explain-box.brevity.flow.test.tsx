import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-07 (ruling §1h.9 (2), (4); user decision §1a.14): what the box does with
// "Say more" over time. The button re-sends the reader's LAST message with the
// long form through `onSayMore` — the thread before that message, then the
// message, no duplicate of it — and the reply is appended as Peer's next turn:
// the reader count does not grow, nothing is replaced, the draft the reader was
// typing stays. It does nothing while a request is in flight, at the full
// thread, with the day's explanations used up, or with no reply to lengthen; a
// failed one leaves the thread as it was. The box runs on the minimal hook
// runtime (no DOM here); the element tree it returns is inspected and its
// handlers called. Every text is invented.
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
import { MAX_EXPLAIN_TURNS, type ExplainTurn } from "@/store/explain-threads";
import { ExplainBox, ExplainCard, type AskResult, type ThreadView } from "./explain-box";
import { firstAnswerMessage, type ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
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
const LONG: ExplainTurn = { role: "peer", text: "A longer reply, in full, with every step.", peer: true, detail: true };
const SHORT: ExplainTurn = { role: "peer", text: "A short reply.", peer: true };

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
  thread: ThreadView | undefined;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === "Explain this?"),
    card,
    thread: card?.props.thread as ThreadView | undefined,
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
beforeEach(() => {
  listeners = new Map();
  vi.stubGlobal("document", recorder());
  vi.stubGlobal("window", { ...recorder(), innerWidth: 1280, innerHeight: 800, scrollBy: vi.fn(), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
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
const sayMore = (tree: ReactNode) => look(tree).thread?.onSayMore?.();
const base = (over: Partial<Props> = {}): Props => ({
  target: first,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => answer),
  cached: answer,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => SHORT),
  onSayMore: vi.fn(async (): Promise<ReplyResult> => LONG),
  onResetThread: vi.fn(),
  reading,
  ...over,
});

describe("ExplainBox — Say more (P3-07)", () => {
  it("hands the card its handler whenever the box can send (the card shows the button only under a reply)", async () => {
    const run = await scenario(base({ cachedTurns: [] }), [(tree) => click(tree)]);
    await wait();
    expect(run.last().thread?.onSayMore).toBeTypeOf("function");
    run.mounted.unmount();
  });

  it("makes no request on its own: opening a thread that has replies sends nothing", async () => {
    const props = base({ cachedTurns: pairs(2) });
    const run = await scenario(props, [(tree) => click(tree)]);
    await wait();

    expect(props.onSayMore).not.toHaveBeenCalled();
    expect(props.onReply).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("re-sends the reader's last message once, with the thread before it — the first answer first, the reply to be lengthened left out — and no other argument", async () => {
    const kept = pairs(2);
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    const props = base({ onSayMore, cachedTurns: kept });
    const run = await scenario(props, [(tree) => click(tree), (tree) => sayMore(tree)]);
    await wait();

    expect(onSayMore).toHaveBeenCalledTimes(1);
    expect(onSayMore).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIndex: 1, paragraphIndex: 1, passage: first.passage }),
      [firstAnswerMessage(answer), ...kept.slice(0, 2)],
      "question 2",
    );
    expect(props.onReply).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("appends Peer's reply alone: the reader count does not grow, nothing is replaced and the earlier reply stays", async () => {
    const kept = pairs(2);
    const run = await scenario(base({ cachedTurns: kept }), [(tree) => click(tree), (tree) => sayMore(tree)]);
    await wait();

    const turns = run.last().thread?.turns ?? [];
    expect(turns).toEqual([...kept, LONG]);
    expect(turns.filter((turn) => turn.role === "reader")).toHaveLength(2);
    expect(turns.slice(0, kept.length)).toEqual(kept);
    expect(run.last().thread?.pending).toBe(false);
    expect(run.last().thread?.failed).toBe(false);
    run.mounted.unmount();
  });

  it("is pending while the request is in flight, and a second press does nothing", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onSayMore = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const seen: boolean[] = [];
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(1) }), [
      (tree) => click(tree),
      (tree) => sayMore(tree),
      (tree) => {
        seen.push(look(tree).thread?.pending ?? false);
        sayMore(tree);
        send(tree);
        resolve(LONG);
      },
    ]);
    await wait();

    expect(onSayMore).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true]);
    run.mounted.unmount();
  });

  it("does nothing while a typed send is in flight, and a typed send does nothing while it is", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    const run = await scenario(base({ onReply, onSayMore, cachedTurns: pairs(1) }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Another?"),
      (tree) => send(tree),
      (tree) => {
        sayMore(tree);
        resolve(SHORT);
      },
    ]);
    await wait();

    expect(onSayMore).not.toHaveBeenCalled();
    expect(onReply).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("keeps what the reader was typing: the draft is not sent and not cleared", async () => {
    const run = await scenario(base({ cachedTurns: pairs(1) }), [(tree) => click(tree), (tree) => draft(tree, "A thought half typed"), (tree) => sayMore(tree)]);
    await wait();

    expect(run.last().thread?.draft).toBe("A thought half typed");
    expect(run.last().thread?.turns).toEqual([...pairs(1), LONG]);
    run.mounted.unmount();
  });

  it("does nothing at the full thread: eight reader messages", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(MAX_EXPLAIN_TURNS - 1) }), [
      (tree) => click(tree),
      (tree) => draft(tree, "The eighth?"),
      (tree) => send(tree),
      (tree) => sayMore(tree),
    ]);
    await wait();

    expect(run.last().thread?.turns.filter((turn) => turn.role === "reader")).toHaveLength(MAX_EXPLAIN_TURNS);
    expect(onSayMore).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("does nothing when there is no reply to lengthen: no turns, or a reply that is already long", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    const none = await scenario(base({ onSayMore, cachedTurns: [] }), [(tree) => click(tree), (tree) => sayMore(tree)]);
    await wait();
    none.mounted.unmount();
    const long = await scenario(base({ onSayMore, cachedTurns: [{ role: "reader", text: "question 1" }, LONG] }), [(tree) => click(tree), (tree) => sayMore(tree)]);
    await wait();
    long.mounted.unmount();

    expect(onSayMore).not.toHaveBeenCalled();
  });

  it("a failed request leaves the thread as it was, says so, and the reader can press it again", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    onSayMore.mockResolvedValueOnce("unavailable");
    const kept = pairs(1);
    const run = await scenario(base({ onSayMore, cachedTurns: kept }), [
      (tree) => click(tree),
      (tree) => sayMore(tree),
      (tree) => {
        expect(look(tree).thread?.failed).toBe(true);
        expect(look(tree).thread?.turns).toEqual(kept);
        sayMore(tree);
      },
    ]);
    await wait();

    expect(onSayMore).toHaveBeenCalledTimes(2);
    expect(run.last().thread?.failed).toBe(false);
    expect(run.last().thread?.turns).toEqual([...kept, LONG]);
    run.mounted.unmount();
  });

  it("a request that throws is a failed one", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => Promise.reject(new Error("boom")));
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(1) }), [(tree) => click(tree), (tree) => sayMore(tree)]);
    await wait();

    expect(run.last().thread?.failed).toBe(true);
    expect(run.last().thread?.turns).toEqual(pairs(1));
    run.mounted.unmount();
  });

  it("the day's explanations used up stops it, as it stops a send", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => "exhausted");
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(1) }), [(tree) => click(tree), (tree) => sayMore(tree), (tree) => sayMore(tree)]);
    await wait();

    expect(run.last().thread?.quota).toBe("exhausted");
    expect(run.last().thread?.turns).toEqual(pairs(1));
    expect(onSayMore).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("the allowance that could not be read leaves the reader to try again", async () => {
    const onSayMore = vi.fn(async (): Promise<ReplyResult> => LONG);
    onSayMore.mockResolvedValueOnce("allowance_unavailable");
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(1) }), [(tree) => click(tree), (tree) => sayMore(tree), (tree) => sayMore(tree)]);
    await wait();

    expect(onSayMore).toHaveBeenCalledTimes(2);
    expect(run.last().thread?.turns).toEqual([...pairs(1), LONG]);
    run.mounted.unmount();
  });

  it("goes on from the long reply: the next typed send carries both replies as they are kept, and Say more is for the new one", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => SHORT);
    const run = await scenario(base({ onReply, cachedTurns: pairs(1) }), [
      (tree) => click(tree),
      (tree) => sayMore(tree),
      (tree) => draft(tree, "And then?"),
      (tree) => send(tree),
    ]);
    await wait();

    const calls = onReply.mock.calls as unknown as Array<[unknown, ExplainTurn[], string]>;
    expect(calls[0][1]).toEqual([firstAnswerMessage(answer), ...pairs(1), LONG]);
    expect(run.last().thread?.turns).toEqual([...pairs(1), LONG, { role: "reader", text: "And then?" }, SHORT]);
    run.mounted.unmount();
  });

  it("is not offered without the handler: a box that cannot send long replies has no button", async () => {
    const run = await scenario(base({ onSayMore: undefined, cachedTurns: pairs(1) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().thread?.onSayMore).toBeUndefined();
    expect(run.last().thread?.turns).toEqual(pairs(1));
    run.mounted.unmount();
  });

  it("drops a reply that arrives after the reader has moved on to another passage", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onSayMore = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const run = await scenario(base({ onSayMore, cachedTurns: pairs(1) }), [
      (tree) => click(tree),
      (tree) => sayMore(tree),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: second, cached: undefined };
        ctx.rerender();
      },
    ]);
    await wait();
    resolve(LONG);
    await wait();

    expect(run.looks.every((l) => !l.thread?.turns.some((turn) => turn.text === LONG.text))).toBe(true);
    run.mounted.unmount();
  });
});
