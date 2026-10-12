import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-41 (ruling §1h.66; C P9-20's checkpoint §7 / §8 item 1): below 768 px the "Explain this" control is a cell of the thumb bar, not a
// floating pill — the pill above the bar still covered 1,790 to 2,473 px² of the words that scroll under it. The box draws no
// pill there and tells the bar, through `explain-offer.ts`, whether a settled selection has a control on offer: it does while the
// selection stands, is the reader's to explain (a key, or a defined term of the paper) and is on the screen; it does not once the
// selection collapses, is scrolled wholly out of view, is the window's passage already, or the window is wide enough for the pill
// (768 px) or the dock (1024 px). The bar's cell calls the page's `explain` action, which is the box's `openRef`: the window opens
// for that selection, exactly as the pill's press did. The box runs on the minimal hook runtime (no DOM here); the element tree it
// returns is inspected and the flag read. Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { explainOffered, setExplainOffer } from "@/lib/reader/explain-offer";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { EXPLAIN } from "./copy";
import { ExplainBox, ExplainCard, type AskResult } from "./explain-box";
import type { ExplainSelection } from "./paper-body";

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const term: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
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
  rect: { left: 40, top: 400, right: 300, bottom: 420 },
  bounds: { left: 16, top: 380, right: 374, bottom: 420 },
  paragraph: { left: 16, top: 360, right: 374, bottom: 600 },
};

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

interface Look {
  /** The floating "Explain this?" button — the pill. */
  pill: ReactElement<Props2> | undefined;
  /** The window that holds a passage (the card or the sheet), if one stands. */
  card: ReactElement<Props2> | undefined;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  return {
    pill: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    card: all.find((el) => el.type === ExplainCard && el.props.empty !== true),
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
function stubWindow(width: number, height = 844) {
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, scrollBy: vi.fn(), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } } });
}

beforeEach(() => {
  listeners = new Map();
  setExplainOffer(false);
  stubWindow(390);
});
afterEach(() => {
  setExplainOffer(false);
  vi.unstubAllGlobals();
});

type Step = (tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void;
async function scenario(initial: Props, steps: Step[] = []) {
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
      // The box's own effects are declared before this one, so a step reads the flag as the bar would, once they have run.
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

const base = (over: Partial<Props> = {}): Props => ({
  target: first,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => ANSWER),
  reading,
  ...over,
});
const selectNext =
  (next: ExplainSelection | null): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next };
    ctx.rerender();
  };
/** The flag after the step that follows has run: a step reads it into `seen`. */
const note = (seen: boolean[]): Step => () => void seen.push(explainOffered());

describe("ExplainBox — under 768 px the control is the thumb bar's cell, not a pill (P9-41, §1h.66)", () => {
  it("draws no floating pill at 390, 640 and 767 px, and offers the settled selection to the bar", async () => {
    for (const width of [390, 640, 767]) {
      stubWindow(width);
      const run = await scenario(base());
      await wait();

      expect(run.last().pill, `${width} px`).toBeUndefined();
      expect(explainOffered(), `${width} px`).toBe(true);
      run.mounted.unmount();
    }
  });

  it("offers it with no gutter and with one alike (a column that leaves 200 px to its right is no reason for a pill under 768 px)", async () => {
    stubWindow(760);
    const run = await scenario(base({ target: { ...first, paragraph: { left: 16, top: 360, right: 400, bottom: 600 } } }));
    await wait();

    expect(run.last().pill).toBeUndefined();
    expect(explainOffered()).toBe(true);
    run.mounted.unmount();
  });

  it("offers nothing before a selection, and takes the offer back when the selection collapses", async () => {
    const seen: boolean[] = [];
    const run = await scenario(base({ target: null }), [note(seen), selectNext(first), note(seen), selectNext(null), note(seen)]);
    await wait();

    expect(seen).toEqual([false, true, false]);
    run.mounted.unmount();
  });

  it("a Tier 0 reader: offered for a defined term of the paper, not for any other words (a locked block is not shown)", async () => {
    const defined: ExplainSelection = { ...first, passage: "the rafting ratio" };
    const yes = await scenario(base({ canAsk: false, terms: [term], target: defined }));
    await wait();
    expect(yes.last().pill).toBeUndefined();
    expect(explainOffered()).toBe(true);
    yes.mounted.unmount();

    const other: ExplainSelection = { ...first, passage: "Specimens were machined." };
    const locked = await scenario(base({ canAsk: false, terms: [term], target: other }));
    await wait();
    expect(locked.last().pill).toBeUndefined();
    expect(explainOffered()).toBe(false);
    locked.mounted.unmount();
  });

  it("takes the offer back when the selection is scrolled wholly out of the viewport, and gives it again when it is scrolled back", async () => {
    let bounds = { left: 16, top: 380, right: 374, bottom: 420 };
    const paragraph = { left: 16, top: 360, right: 374, bottom: 600 };
    const moving: ExplainSelection = { ...first, bounds, measure: () => ({ rect: bounds, bounds, paragraph }) };
    const seen: boolean[] = [];
    const run = await scenario(base({ target: moving }), [
      note(seen),
      () => {
        bounds = { left: 16, top: -300, right: 374, bottom: -240 };
        fire("scroll", {});
      },
      note(seen),
      () => {
        bounds = { left: 16, top: 900, right: 374, bottom: 960 };
        fire("scroll", {});
      },
      note(seen),
      () => {
        // Partly in view (its foot is still on the screen): still on offer.
        bounds = { left: 16, top: -40, right: 374, bottom: 20 };
        fire("scroll", {});
      },
      note(seen),
      () => {
        bounds = { left: 16, top: 380, right: 374, bottom: 420 };
        fire("scroll", {});
      },
      note(seen),
    ]);
    await wait();

    // In view; above the viewport; below it; its last line still showing at the head; back in view.
    expect(seen).toEqual([true, false, false, true, true]);
    run.mounted.unmount();
  });

  it("the bar's press opens the window for that selection (the page's `explain` action is the box's `openRef`), and the cell goes", async () => {
    const openRef = { current: null as (() => void) | null };
    const onAsk = vi.fn(async (): Promise<AskResult> => ANSWER);
    const seen: boolean[] = [];
    const run = await scenario(base({ openRef, onAsk }), [note(seen), () => openRef.current?.(), note(seen)]);
    await wait();

    expect(seen).toEqual([true, false]);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: first.passage }));
    // The sheet is open on the selection and the offer is spent: the rail is as it was while the sheet stands.
    expect(run.last().card).toBeDefined();
    run.mounted.unmount();
  });

  it("takes the offer back when the page is left: nothing of it stays for the next page's bar", async () => {
    const run = await scenario(base());
    await wait();
    expect(explainOffered()).toBe(true);

    run.mounted.unmount();

    expect(explainOffered()).toBe(false);
  });
});

describe("ExplainBox — from 768 px the pill is the control again, and the bar is not asked (P9-41, §1h.66)", () => {
  it("at 768 and 800 px with no gutter: the pill on the legend, nothing offered to the bar (the bar is hidden there)", async () => {
    for (const width of [768, 800]) {
      stubWindow(width);
      const run = await scenario(base({ target: { ...first, paragraph: { left: 16, top: 360, right: width - 100, bottom: 600 } } }));
      await wait();

      expect(run.last().pill, `${width} px`).toBeDefined();
      expect((run.last().pill?.props.style as { bottom?: string }).bottom, `${width} px`).toBe("36px");
      expect(explainOffered(), `${width} px`).toBe(false);
      run.mounted.unmount();
    }
  });

  it("at 1024 px and up the window carries the control and the bar is not asked either", async () => {
    stubWindow(1440, 900);
    const run = await scenario(base());
    await wait();

    expect(run.last().pill).toBeUndefined();
    expect(explainOffered()).toBe(false);
    run.mounted.unmount();
  });

  it("a window resized from a phone's width to a tablet's hands the control from the bar back to the pill, and the other way", async () => {
    const seen: Array<{ offered: boolean; pill: boolean }> = [];
    const mark: Step = (tree) => seen.push({ offered: explainOffered(), pill: look(tree).pill !== undefined });
    const resizeTo = (width: number): Step => () => {
      (window as unknown as { innerWidth: number }).innerWidth = width;
      fire("resize", {});
    };
    const run = await scenario(base({ target: { ...first, paragraph: { left: 16, top: 360, right: 700, bottom: 600 } } }), [mark, resizeTo(800), mark, resizeTo(390), mark]);
    await wait();

    expect(seen).toEqual([
      { offered: true, pill: false },
      { offered: false, pill: true },
      { offered: true, pill: false },
    ]);
    run.mounted.unmount();
  });
});
