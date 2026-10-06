import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-02c (ruling §1h.4 amendment; user decision §1a.11): what the box does with
// its web-search toggle over time — off whenever the box opens or a passage is
// opened and never remembered; a mouse or the keyboard turns it on, a touch
// screen needs two taps (the first shows the warning); the next send carries it
// and it is off again straight away, sent or failed; a reply that searched
// marks the reader's message, one that could not leaves a note; a spent
// allowance disables the input and keeps the typed words, an allowance that
// could not be checked does not; the first message is refused or not in place
// of the loading line. The box runs on the minimal hook runtime (no DOM here);
// the element tree it returns is inspected and its handlers called. Every text
// is invented.
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
import type { ExplainTurn } from "@/store/explain-threads";
import { ExplainBox, ExplainCard, type AskResult, type ThreadView } from "./explain-box";
import { firstAnswerMessage, type ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const answer: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", "We define the rafting ratio as the fraction of the gauge length covered by plates."] },
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

const PLAIN: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };
const SEARCHED: ExplainTurn = { ...PLAIN, searched: true };

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
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === "Explain this?"),
    card,
    status: card ? (card.props.status as { kind: string }).kind : null,
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
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  listeners = new Map();
  storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("document", recorder());
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
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
const searchOf = (tree: ReactNode) => look(tree).thread!.search!;
/** One press of the toggle the way a browser delivers it: the pointer goes down, then the click. */
const press = (tree: ReactNode, pointerType?: string) => {
  const search = searchOf(tree);
  if (pointerType) search.onPointerDown(pointerType);
  search.onPress();
};
const base = (over: Partial<Props> = {}): Props => ({
  target: first,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => answer),
  cached: answer,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => PLAIN),
  onResetThread: vi.fn(),
  reading,
  ...over,
});

describe("ExplainBox — the toggle is off whenever the box opens (§1a.11)", () => {
  it("opens off: not on, no warning showing", async () => {
    const run = await scenario(base(), [(tree) => click(tree)]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: false, tip: false });
    run.mounted.unmount();
  });

  it("is off again when the box is opened again, even if it was left on", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "mouse"),
      (tree) => {
        expect(searchOf(tree).on).toBe(true);
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        for (const listener of listeners.get("keydown") ?? []) listener(event);
      },
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: false, tip: false });
    run.mounted.unmount();
  });

  it("is off when a different passage is opened, even if it was left on", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "mouse"),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: second, cached: answer };
        ctx.rerender();
      },
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: false, tip: false });
    run.mounted.unmount();
  });

  it("is never remembered: nothing is read from or written to the browser's storage", async () => {
    const run = await scenario(base(), [(tree) => click(tree), (tree) => press(tree, "mouse"), (tree) => draft(tree, "Why?"), (tree) => send(tree)]);
    await wait();

    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("is not there in a Tier 0 box, which has no thread", async () => {
    const run = await scenario(base({ canAsk: false, cached: undefined, terms: [{ term: "rafting ratio", definition: "x", evidence: "We define the rafting ratio.", evidenceWhere: "2 Methods", sectionId: "s2", page: 2 }], target: { ...first, passage: "The rafting ratio rose." } }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().thread).toBeUndefined();
    run.mounted.unmount();
  });
});

describe("ExplainBox — pressing the toggle (§1a.11)", () => {
  it("a mouse press turns it on and the next turns it off", async () => {
    const seen: boolean[] = [];
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "mouse"),
      (tree) => {
        seen.push(searchOf(tree).on);
        press(tree, "mouse");
      },
      (tree) => seen.push(searchOf(tree).on),
    ]);
    await wait();

    expect(seen).toEqual([true, false]);
    run.mounted.unmount();
  });

  it("the keyboard — a click with no pointer before it — turns it on at once", async () => {
    const run = await scenario(base(), [(tree) => click(tree), (tree) => press(tree)]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: true, tip: false });
    run.mounted.unmount();
  });

  it("a touch screen needs two taps: the first shows the warning and leaves search off, the second turns it on and puts the warning away", async () => {
    const seen: Array<{ on: boolean; tip: boolean }> = [];
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "touch"),
      (tree) => {
        seen.push({ ...searchOf(tree) });
        press(tree, "touch");
      },
      (tree) => {
        seen.push({ ...searchOf(tree) });
        press(tree, "touch");
      },
      (tree) => seen.push({ ...searchOf(tree) }),
    ]);
    await wait();

    expect(seen.map(({ on, tip }) => ({ on, tip }))).toEqual([
      { on: false, tip: true },
      { on: true, tip: false },
      { on: false, tip: false },
    ]);
    run.mounted.unmount();
  });

  it("the pointer that went down is used once: a press with none before it, after a touch, is a keyboard press and turns it on", async () => {
    const run = await scenario(base(), [(tree) => click(tree), (tree) => press(tree, "touch"), (tree) => press(tree)]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: true, tip: false });
    run.mounted.unmount();
  });

  it("a touch that leaves the button before the second tap starts over: the next tap is a first tap again", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "touch"),
      (tree) => searchOf(tree).onBlur(),
      (tree) => {
        expect(searchOf(tree)).toMatchObject({ on: false, tip: false });
        press(tree, "touch");
      },
    ]);
    await wait();

    expect(run.last().thread?.search).toMatchObject({ on: false, tip: true });
    run.mounted.unmount();
  });

  it("a press anywhere else in the card puts the warning away, and one on the toggle itself does not", async () => {
    const insideCard = (selector: string) => (selector === "[data-explain-card]" ? {} : null);
    const insideToggle = (selector: string) => (selector === "[data-explain-card]" || selector === "[data-explain-search]" ? {} : null);
    const run = await scenario(base(), [
      (tree) => click(tree),
      (tree) => press(tree, "touch"),
      (tree) => {
        expect(searchOf(tree).tip).toBe(true);
        for (const listener of listeners.get("pointerdown") ?? []) listener({ target: { closest: insideToggle } });
      },
      (tree) => {
        expect(searchOf(tree).tip).toBe(true);
        for (const listener of listeners.get("pointerdown") ?? []) listener({ target: { closest: insideCard } });
      },
    ]);
    await wait();

    expect(run.last().thread?.search?.tip).toBe(false);
    expect(run.last().card).toBeDefined();
    run.mounted.unmount();
  });

  it("does nothing while a reply is pending", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      (tree) => {
        press(tree, "mouse");
        resolve(PLAIN);
      },
    ]);
    await wait();

    expect(run.last().thread?.search?.on).toBe(false);
    run.mounted.unmount();
  });
});

describe("ExplainBox — the send carries the toggle, which then goes off (§1a.11)", () => {
  it("with search on, the send carries it as a fourth argument — and the toggle is off while the reply is pending", async () => {
    let resolve!: (value: ReplyResult) => void;
    const onReply = vi.fn(() => new Promise<ReplyResult>((r) => (resolve = r)));
    const pendingLooks: Array<{ pending: boolean; on: boolean }> = [];
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Does anyone else measure it this way?"),
      (tree) => press(tree, "mouse"),
      (tree) => send(tree),
      (tree) => {
        pendingLooks.push({ pending: look(tree).thread!.pending, on: searchOf(tree).on });
        resolve(SEARCHED);
      },
    ]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ passage: first.passage }), [firstAnswerMessage(answer)], "Does anyone else measure it this way?", true);
    expect(pendingLooks).toEqual([{ pending: true, on: false }]);
    run.mounted.unmount();
  });

  it("with search off, the send is the three-argument call it always was", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => PLAIN);
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => send(tree)]);
    await wait();

    expect(onReply.mock.calls[0]).toHaveLength(3);
    run.mounted.unmount();
  });

  it("is off again after the reply has come, and the next send does not search unless it is turned on again", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => SEARCHED);
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "First?"),
      (tree) => press(tree, "mouse"),
      (tree) => send(tree),
      () => {},
      (tree) => draft(tree, "Second?"),
      (tree) => send(tree),
    ]);
    await wait();

    expect((onReply.mock.calls[0] as unknown[])[3]).toBe(true);
    expect(onReply.mock.calls[1]).toHaveLength(3);
    expect(run.last().thread?.search?.on).toBe(false);
    run.mounted.unmount();
  });

  it("is off again after a failed send, with the typed words kept", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => "unavailable");
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => press(tree, "mouse"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread).toMatchObject({ failed: true, draft: "Why?" });
    expect(run.last().thread?.search?.on).toBe(false);
    run.mounted.unmount();
  });

  it("is off again after a request that throws", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => Promise.reject(new Error("boom")));
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => press(tree, "mouse"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread?.failed).toBe(true);
    expect(run.last().thread?.search?.on).toBe(false);
    run.mounted.unmount();
  });

  it("a send that cannot be made — an empty draft — leaves the toggle where it was", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => PLAIN);
    const run = await scenario(base({ onReply }), [(tree) => click(tree), (tree) => press(tree, "mouse"), (tree) => send(tree)]);
    await wait();

    expect(onReply).not.toHaveBeenCalled();
    expect(run.last().thread?.search?.on).toBe(true);
    run.mounted.unmount();
  });
});

describe("ExplainBox — the mark and the note come from what the server did (§1a.11)", () => {
  it("a reply that searched joins the thread with the reader's message marked", async () => {
    const run = await scenario(base({ onReply: vi.fn(async (): Promise<ReplyResult> => SEARCHED) }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => press(tree, "mouse"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread?.turns).toEqual([{ role: "reader", text: "Why?", searched: true }, SEARCHED]);
    run.mounted.unmount();
  });

  it("a reply that did not search, for a message that asked to, is not marked and carries the note", async () => {
    const run = await scenario(base({ onReply: vi.fn(async (): Promise<ReplyResult> => PLAIN) }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => press(tree, "mouse"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread?.turns).toEqual([{ role: "reader", text: "Why?" }, { ...PLAIN, searchUnavailable: true }]);
    run.mounted.unmount();
  });

  it("a message that did not ask to search has neither", async () => {
    const run = await scenario(base({ onReply: vi.fn(async (): Promise<ReplyResult> => PLAIN) }), [(tree) => click(tree), (tree) => draft(tree, "Why?"), (tree) => send(tree)]);
    await wait();

    expect(run.last().thread?.turns).toEqual([{ role: "reader", text: "Why?" }, PLAIN]);
    run.mounted.unmount();
  });

  it("the next message's thread carries the reader's words and Peer's, and nothing of the marks", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => SEARCHED);
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "First?"),
      (tree) => press(tree, "mouse"),
      (tree) => send(tree),
      () => {},
      (tree) => draft(tree, "Second?"),
      (tree) => send(tree),
    ]);
    await wait();

    const sent = (onReply.mock.calls[1] as unknown as [unknown, ExplainTurn[], string])[1];
    expect(sent).toHaveLength(3);
    expect(sent[1]).toMatchObject({ role: "reader", text: "First?" });
    run.mounted.unmount();
  });
});

describe("ExplainBox — an allowance that is spent or cannot be checked (§1g.14, §1h.4)", () => {
  it("a day's explanations used up: the line, the thread as it was, the typed words kept, and nothing more can be sent", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => "exhausted");
    const kept: ExplainTurn[] = [{ role: "reader", text: "Earlier?" }, PLAIN];
    const run = await scenario(base({ onReply, cachedTurns: kept }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why does it matter at 1100 C?"),
      (tree) => press(tree, "mouse"),
      (tree) => send(tree),
      (tree) => {
        expect(look(tree).thread).toMatchObject({ quota: "exhausted", failed: false, pending: false, draft: "Why does it matter at 1100 C?" });
        send(tree);
      },
    ]);
    await wait();

    expect(run.last().thread?.turns).toEqual(kept);
    expect(run.last().thread?.search?.on).toBe(false);
    expect(onReply).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });

  it("an allowance that could not be checked: its own line, the typed words kept, and the reader may try again", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => PLAIN);
    onReply.mockResolvedValueOnce("allowance_unavailable");
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      (tree) => {
        expect(look(tree).thread).toMatchObject({ quota: "unavailable", failed: false, draft: "Why?" });
        send(tree);
      },
    ]);
    await wait();

    expect(onReply).toHaveBeenCalledTimes(2);
    expect(run.last().thread?.quota).toBeUndefined();
    expect(run.last().thread?.turns).toEqual([{ role: "reader", text: "Why?" }, PLAIN]);
    run.mounted.unmount();
  });

  it("the line is gone when the box is opened again: the allowance is asked afresh with the next send", async () => {
    const onReply = vi.fn(async (): Promise<ReplyResult> => "exhausted");
    const run = await scenario(base({ onReply }), [
      (tree) => click(tree),
      (tree) => draft(tree, "Why?"),
      (tree) => send(tree),
      () => {
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        for (const listener of listeners.get("keydown") ?? []) listener(event);
      },
      (tree) => click(tree),
    ]);
    await wait();

    expect(run.last().thread?.quota).toBeUndefined();
    run.mounted.unmount();
  });

  it("the first message refused: the line in place of the loading line, and no thread", async () => {
    for (const [result, kind] of [["exhausted", "exhausted"], ["allowance_unavailable", "allowance_unavailable"]] as const) {
      const run = await scenario(base({ cached: undefined, onAsk: vi.fn(async (): Promise<AskResult> => result) }), [(tree) => click(tree)]);
      await wait();

      expect(run.last().status).toBe(kind);
      expect(run.last().thread).toBeUndefined();
      run.mounted.unmount();
    }
  });
});
