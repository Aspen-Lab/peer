import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-02 (ruling §1h.2; §3d 14): what the popover does — nothing is asked
// before the reader clicks "Explain this?"; the click is the send, once; a
// passage already explained opens at once with no request; without a key the
// paper's own definition is the whole card and nothing is asked; Escape, a
// click outside and a new selection close it; an answer for a passage the
// reader has since left is not shown. The popover runs on the minimal hook
// runtime (no DOM here); its own handlers are called on the element tree it
// returns, and the window's listeners are a recorded stand-in.
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
import { EXPLAIN } from "./copy";
import { ExplainCard, ExplainBox, type AskResult } from "./explain-box";
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
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    card,
    status: card ? (card.props.status as { kind: string }).kind : null,
  };
};

// ── The window and the document, as recorded listeners ──────────────────

let listeners: Map<string, Set<(event: unknown) => void>>;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
const countOf = (type: string) => listeners.get(type)?.size ?? 0;

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
  vi.stubGlobal("window", { ...recorder(), innerWidth: 1280, innerHeight: 800, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
});
afterEach(() => vi.unstubAllGlobals());

/**
 * One page: the popover mounted with `props`, then `steps` run one per render,
 * each on the tree that render produced. `props` may be changed by a step, and
 * `rerender()` shows it. Every render's look is recorded.
 */
async function scenario(initial: Props, steps: Array<(tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void>) {
  const ctx = { props: initial, rerender: () => {}, tree: null as ReactNode };
  const looks: Look[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(ctx.props);
    const [step, setStep] = useState(0);
    const [, setTick] = useState(0);
    ctx.rerender = () => setTick((n) => n + 1);
    looks.push(look(tree));
    // Once per step, on the tree of the render that step belongs to.
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

const click = (tree: ReactNode) => (look(tree).button?.props.onClick as () => void)();
const base = (over: Partial<Props> = {}): Props => ({ target: first, terms: [], canAsk: true, onAsk: vi.fn(async (): Promise<AskResult> => answer), reading, ...over });
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("ExplainBox — the click is the send (§1h.2)", () => {
  it("asks nothing before the click, once on it, and shows the loading card, then the answer", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const seen: Array<string | null> = [];
    const run = await scenario(base({ onAsk }), [
      (tree) => {
        expect(onAsk).not.toHaveBeenCalled();
        expect(look(tree).button).toBeDefined();
        seen.push(look(tree).status);
      },
      (tree) => click(tree),
      (tree) => {
        seen.push(look(tree).status);
        resolve(answer);
      },
      (tree) => seen.push(look(tree).status),
    ]);

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ sectionIndex: 1, paragraphIndex: 1, passage: first.passage }));
    expect(seen).toEqual([null, "loading", "answer"]);
    // Once the card is open the button is gone.
    expect(run.last().button).toBeUndefined();
    run.mounted.unmount();
  });

  it("opens an answer already kept at once, with no request", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const run = await scenario(base({ onAsk, cached: answer }), [(tree) => click(tree)]);
    await wait();

    expect(onAsk).not.toHaveBeenCalled();
    expect(run.looks.map((l) => l.status).filter(Boolean)).toEqual(["answer"]);
    run.mounted.unmount();
  });

  it("with no key, opens the paper's own definition and asks nothing", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const target = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ onAsk, canAsk: false, terms: [term], target }), [(tree) => click(tree)]);
    await wait();

    expect(onAsk).not.toHaveBeenCalled();
    const open = run.last();
    expect(open.status).toBe("none");
    expect((open.card?.props.term as PaperTerm).term).toBe("rafting ratio");
    expect(open.card?.props.canAsk).toBe(false);
    run.mounted.unmount();
  });

  it("shows 'unavailable' and 'not in the paper' as the answer says", async () => {
    for (const result of ["unavailable", "not_in_paper"] as const) {
      const run = await scenario(base({ onAsk: vi.fn(async (): Promise<AskResult> => result) }), [(tree) => click(tree)]);
      await wait();

      expect(run.last().status).toBe(result);
      run.mounted.unmount();
    }
  });

  it("shows 'unavailable' when the request itself throws", async () => {
    const run = await scenario(base({ onAsk: vi.fn(async (): Promise<AskResult> => Promise.reject(new Error("boom"))) }), [(tree) => click(tree)]);
    await wait();

    expect(run.last().status).toBe("unavailable");
    run.mounted.unmount();
  });

  it("does not ask a second time for a second click on the same card", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => answer);
    const run = await scenario(base({ onAsk }), [(tree) => click(tree), (tree) => look(tree).button && click(tree)]);
    await wait();

    expect(onAsk).toHaveBeenCalledTimes(1);
    run.mounted.unmount();
  });
});

describe("ExplainBox — what closes it", () => {
  it("closes on Escape, and the key goes no further", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      () => {
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        fire("keydown", event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
      },
    ]);
    await wait();

    expect(run.looks.some((l) => l.card)).toBe(true);
    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });

  it("leaves other keys alone", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      () => {
        const event = { key: "j", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        fire("keydown", event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
      },
    ]);
    await wait();

    expect(run.last().card).toBeDefined();
    run.mounted.unmount();
  });

  it("closes on a press outside the card, and not on one inside it", async () => {
    const inside = { target: { closest: (selector: string) => (selector.includes("data-explain-card") ? {} : null) } };
    const outside = { target: { closest: () => null } };
    const run = await scenario(base(), [(tree) => click(tree), () => fire("pointerdown", inside), () => fire("pointerdown", outside)]);
    await wait();

    // After the inside press it is still open; after the outside one it is gone.
    const opened = run.looks.map((l) => Boolean(l.card));
    expect(opened.lastIndexOf(true)).toBeGreaterThan(opened.indexOf(true));
    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });

  it("closes when the reader selects something else", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: second };
        ctx.rerender();
      },
    ]);
    await wait();

    expect(run.looks.some((l) => l.card)).toBe(true);
    expect(run.last().card).toBeUndefined();
    // The new selection has its own button.
    expect(run.last().button).toBeDefined();
    run.mounted.unmount();
  });

  it("stays open when the selection simply goes away (a click in the card collapses it)", async () => {
    const run = await scenario(base(), [
      (tree) => click(tree),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: null };
        ctx.rerender();
      },
    ]);
    await wait();

    expect(run.last().card).toBeDefined();
    run.mounted.unmount();
  });

  it("does not show an answer that arrives after the reader has moved on", async () => {
    let resolve!: (value: AskResult) => void;
    const onAsk = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const run = await scenario(base({ onAsk }), [
      (tree) => click(tree),
      (_tree, ctx) => {
        ctx.props = { ...ctx.props, target: second };
        ctx.rerender();
      },
    ]);
    await wait();
    resolve(answer);
    await wait();

    expect(run.looks.every((l) => l.status !== "answer")).toBe(true);
    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });

  it("listens for Escape and presses only while a card is open", async () => {
    const closed = await scenario(base(), []);
    expect(countOf("keydown")).toBe(0);
    expect(countOf("pointerdown")).toBe(0);
    closed.mounted.unmount();

    const open = await scenario(base(), [(tree) => click(tree)]);
    await wait();
    expect(countOf("keydown")).toBe(1);
    expect(countOf("pointerdown")).toBe(1);
    open.mounted.unmount();
    expect(countOf("keydown")).toBe(0);
    expect(countOf("pointerdown")).toBe(0);
  });
});
