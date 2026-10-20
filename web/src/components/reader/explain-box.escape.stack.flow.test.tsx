import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17c rule 1 (C P11-15 "For the manager" 1): the explain card takes Escape only while it is the front card of the margin's stack. With a
// sticky, the notes window or the figure raised over it, it is a header and the key is not its own: it is not closed, prevented or stopped,
// and the card in front takes it. Raised again, it is the front and closes with the key as before. Below 1024 px it stands outside the stack
// (the card under the selection, the phone's sheet) and nothing changes: the key closes it whatever the store holds. A key something has
// handled, and a modal dialog over the page, still win. The box runs on the minimal hook runtime (no DOM); the stack is the real store.
// (The four cards together are `front-card.escape.flow.test.tsx`.) Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { EXPLAIN_WINDOW_ID, useWindows } from "@/lib/reader/windows";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import { ExplainBox, ExplainCard, type AskResult } from "./explain-box";
import type { ExplainSelection } from "./paper-body";

const ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const reading = {
  body: [{ id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep.", "We define the rafting ratio."] }],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;
const target: ExplainSelection = {
  sectionIndex: 0,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};
const MARGIN: MarginRect = { left: 1000, width: 400, top: 48, bottom: 860 };

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}
const cardOf = (tree: ReactNode) => elements(tree).find((el) => el.type === ExplainCard);

let listeners: Map<string, Set<(event: unknown) => void>>;
let modal: unknown;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
function recorder() {
  return {
    addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: (event: unknown) => void) => void listeners.get(type)?.delete(listener),
  };
}
function stubPage(width = 1440, height = 900) {
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, scrollBy: vi.fn(), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty: () => {}, removeProperty: () => {} } }, querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? modal : null) });
}

let openRef: { current: (() => void) | null };
beforeEach(() => {
  openRef = { current: null };
  listeners = new Map();
  modal = null;
  stubPage();
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
});

type Step = (tree: ReactNode) => void;
async function scenario(steps: Step[]) {
  const props: Props = { target, terms: [], canAsk: true, onAsk: vi.fn(async (): Promise<AskResult> => ANSWER), cached: ANSWER, cachedTurns: [], reading, openRef };
  const trees: ReactNode[] = [];
  const ctx = { tree: null as ReactNode };
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(props);
    const [step, setStep] = useState(0);
    trees.push(tree);
    ctx.tree = tree;
    useEffect(() => {
      const run = steps[step];
      if (!run) return;
      run(ctx.tree);
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  return { mounted, last: () => trees[trees.length - 1] };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
const open = () => {
  if (!openRef.current) throw new Error("the box has not published its open action");
  openRef.current();
};
const escape = (over: Record<string, unknown> = {}) => ({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });
const inStack = () => useWindows.getState().windows.some((w) => w.id === EXPLAIN_WINDOW_ID);

describe("the explain card behind another card does not answer Escape", () => {
  for (const [kind, id] of [["sticky", "s1"], ["notes", "notes-window"], ["figure", "figure"]] as const) {
    it(`behind a ${kind} raised over it: the key is not taken, prevented or stopped, and the card stands`, async () => {
      const event = escape();
      const run = await scenario([() => open(), () => useWindows.getState().open({ id, kind, title: kind }), () => fire("keydown", event)]);
      await wait();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(inStack()).toBe(true);
      expect(cardOf(run.last())?.props.behind).toBe(true);
      run.mounted.unmount();
    });
  }

  it("raised to the front by its header it takes the key — prevented, stopped, closed — and the card that was in front stands", async () => {
    const event = escape();
    const run = await scenario([
      () => open(),
      () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
      (tree) => (cardOf(tree)!.props.onRaise as () => void)(),
      () => fire("keydown", event),
    ]);
    await wait();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(inStack()).toBe(false);
    expect(useWindows.getState().windows.map((w) => w.id)).toEqual(["s1"]);
    run.mounted.unmount();
  });

  it("in front it still leaves a key something handled already, and a modal dialog over the page", async () => {
    const handled = escape({ defaultPrevented: true });
    const underModal = escape();
    const run = await scenario([
      () => open(),
      () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
      (tree) => (cardOf(tree)!.props.onRaise as () => void)(),
      () => fire("keydown", handled),
      () => {
        modal = {};
        fire("keydown", underModal);
      },
    ]);
    await wait();
    expect(handled.preventDefault).not.toHaveBeenCalled();
    expect(underModal.preventDefault).not.toHaveBeenCalled();
    expect(inStack()).toBe(true);
    run.mounted.unmount();
  });
});

describe("below 1024 px it stands outside the stack and nothing changes", () => {
  it("takes Escape as before at 900 px (the card) and at 390 px (the sheet), whatever card the store holds", async () => {
    for (const width of [900, 390]) {
      listeners = new Map();
      stubPage(width, 900);
      useWindows.setState({ windows: [], clock: 0, origin: null });
      const event = escape();
      const run = await scenario([() => open(), () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }), () => fire("keydown", event)]);
      await wait();
      expect(inStack(), `${width}`).toBe(false);
      expect(event.preventDefault, `${width}`).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation, `${width}`).toHaveBeenCalledTimes(1);
      expect(cardOf(run.last()), `${width}`).toBeUndefined();
      run.mounted.unmount();
    }
  });
});
