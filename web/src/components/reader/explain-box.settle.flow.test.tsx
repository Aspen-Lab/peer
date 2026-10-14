import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P10-08 (review item 1.1 = 8.1-8.3; B P10-01; ruling §1h.80): the owner's walk ended in "Maximum update depth exceeded" at the
// explain box's after-every-commit layout effect (`setViewport` / `setCardHeight`), and then in the page's "This view hit a snag".
// B P10-01 did not find the number that moved, and could not make the loop happen in a browser, so the box is built so that NO
// feedback can run away: whatever the layout does with the card's height, the effect writes at most a handful of times for a
// change the reader made, and an A, B, A pattern of heights settles on the taller one. React throws at the 51st nested commit;
// this file counts what the effect would write on the project's minimal hook runtime (no DOM, no React commit): a card whose
// `scrollHeight` answers a different number on every read, as a layout that follows the card's own size would.
// Red on the head, which writes on every round until the runtime's cap; green after the fix. Every text is invented.
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
import { ExplainBox, ExplainCard, type AskResult } from "./explain-box";
import type { ExplainSelection } from "./paper-body";

const ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", "The rafting ratio rose from 0.2 to 0.7."] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;

/** A selection low on the screen, so the window is bottom-clamped and its top depends on the card's height. */
const low: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 4000, right: 420, bottom: 4020 },
  bounds: { left: 100, top: 4000, right: 420, bottom: 4020 },
  paragraph: { left: 120, top: 4000, right: 760, bottom: 4260 },
};

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}
const cardOf = (tree: ReactNode) => elements(tree).find((el) => el.type === ExplainCard && el.props.empty !== true);

let listeners: Map<string, Set<(event: unknown) => void>>;
const recorder = () => ({
  addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
  removeEventListener: (type: string, listener: (event: unknown) => void) => void listeners.get(type)?.delete(listener),
});
beforeEach(() => {
  listeners = new Map();
  vi.stubGlobal("window", { ...recorder(), innerWidth: 1440, innerHeight: 900, scrollBy: vi.fn(), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } } });
});
afterEach(() => vi.unstubAllGlobals());

/** The runtime stops a run that never goes quiet after this many rounds; far past the 51 nested commits React allows. */
const ROUNDS = 150;

/**
 * Open the box on `low` through the page's `explain` action (`openRef`), give it a card whose height reads as `read()` says,
 * then touch nothing: the reader changes nothing from here on. Returns every render's window top, and how many times the card
 * was read (once for each commit of the box that measures it).
 */
async function run(read: () => number) {
  const openRef = { current: null as (() => void) | null };
  const props: Props = {
    target: low,
    terms: [],
    canAsk: true,
    onAsk: vi.fn(async (): Promise<AskResult> => ANSWER),
    cached: ANSWER,
    cachedTurns: [],
    onReply: vi.fn(),
    onResetThread: vi.fn(),
    reading,
    openRef,
  };
  let reads = 0;
  const card = {
    get scrollHeight() {
      reads += 1;
      return read();
    },
    offsetHeight: 0,
    clientHeight: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ height: 500 }),
  };
  const tops: Array<number | undefined> = [];
  const mounted = await hookRuntime.mount(
    () => {
      const tree = ExplainBox(props);
      const [at, setAt] = useState(0);
      tops.push((cardOf(tree)?.props.style as { top?: number } | undefined)?.top);
      useEffect(() => {
        if (at === 0) openRef.current?.();
        else if (at === 1) (cardOf(tree)?.props.cardRef as { current: unknown }).current = card;
        else return;
        setAt(at + 1);
      }, [at]);
      return tree;
    },
    { maxRounds: ROUNDS },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const out = { renders: tops.length, reads, tops };
  mounted.unmount();
  return out;
}

describe("ExplainBox — the after-every-commit layout effect cannot run away (P10-08, review 1.1; B P10-01; §1h.80)", () => {
  it("a card whose height alternates 480, 500, 480, … on every read: the box writes a handful of times and settles on the taller one", async () => {
    let n = 0;
    const out = await run(() => (n++ % 2 === 0 ? 480 : 500));

    // Not one write per commit for ever (the head: a write on each of the runtime's 150 rounds); the burst is capped.
    expect(out.reads).toBeLessThanOrEqual(14);
    expect(out.renders).toBeLessThanOrEqual(16);
    // The taller height, which never hides content: 900 - 28 (the legend) - 500 = 372 is where the window stands at the end.
    expect(out.tops[out.tops.length - 1]).toBe(900 - 28 - 500);
  });

  it("a card that grows by 10 px each time it is read (a height that follows its own size): the burst is capped and the box goes quiet", async () => {
    let height = 400;
    const out = await run(() => (height += 10));

    expect(out.reads).toBeLessThanOrEqual(14);
    expect(out.renders).toBeLessThanOrEqual(16);
  });

  it("a card of a steady height settles at once: one write, one more read to see nothing changed", async () => {
    const out = await run(() => 520);

    expect(out.tops.filter((top, i, all) => top !== all[i - 1])).toEqual([512, 900 - 28 - 520]);
    expect(out.reads).toBeLessThanOrEqual(4);
  });
});
