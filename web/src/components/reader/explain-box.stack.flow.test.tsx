import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-14 rules 3 and 4 (B P11-03 §3, B P11-01 §3.1, §4 C4; rulings §1h.113, O-6, O-7, O-8, BACKLOG-66): the explain card is one card of
// the margin's stack. It registers in `useWindows` as `explain` while it stands (from 1024 px), takes its frame from the margin's rect, is
// level with its paragraph while it stands alone and a header when another card is raised over it; and nothing is reserved when it opens:
// no custom property on the document's root, no scroll to hold the words (the margin is a grid track, the text never moves). The box runs on
// the minimal hook runtime (no DOM here); the element tree it returns is inspected and its handlers called. Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { DOCK_BOTTOM_PX, DOCK_STACK_FLOOR_PX, DOCK_TOP_PX, columnBottomPx } from "./explain-dock";
import { EXPLAIN_WINDOW_ID, WINDOW_HEADER_PX, useWindows } from "@/lib/reader/windows";
import { placeInMargin, useMarginStore, type MarginRect } from "@/lib/reader/margin";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { ExplainTurn } from "@/store/explain-threads";
import type { PaperReading } from "@/lib/papers/reading";
import { explainOffered } from "@/lib/reader/explain-offer";
import { ExplainBox, ExplainCard, type AskResult } from "./explain-box";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const REPLY: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };
const ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", "We define the rafting ratio."] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;

const selection = (top: number, paragraphTop?: number): ExplainSelection => ({
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top, right: 420, bottom: top + 20 },
  bounds: { left: 100, top, right: 420, bottom: top + 20 },
  ...(paragraphTop !== undefined ? { paragraph: { left: 100, top: paragraphTop, right: 700, bottom: paragraphTop + 120 } } : {}),
});

/** The margin a shell would register: 400 px wide at the right, the masthead's foot down to the legend's strip. */
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
const styleOf = (tree: ReactNode) => cardOf(tree)?.props.style as Record<string, number | string | undefined> | undefined;

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
let root: Map<string, string>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
function stubRoot() {
  root = new Map();
  setProperty = vi.fn((name: string, value: string) => void root.set(name, value));
  removeProperty = vi.fn((name: string) => void root.delete(name));
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty, removeProperty } } });
}

let openRef: { current: (() => void) | null } = { current: null };
beforeEach(() => {
  openRef = { current: null };
  listeners = new Map();
  stubRoot();
  stubWindow();
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
});

type Step = (tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void;
async function scenario(initial: Props, steps: Step[]) {
  const ctx = { props: initial, rerender: () => {}, tree: null as ReactNode };
  const trees: ReactNode[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(ctx.props);
    const [step, setStep] = useState(0);
    const [, setTick] = useState(0);
    ctx.rerender = () => setTick((n) => n + 1);
    trees.push(tree);
    ctx.tree = tree;
    useEffect(() => {
      const run = steps[step];
      if (!run) return;
      run(ctx.tree, ctx);
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  return { trees, mounted, last: () => trees[trees.length - 1] };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
/** The reader selects `next` in the body: the page hands the box a new target. */
const selectNext =
  (next: ExplainSelection | null, over: Partial<Props> = {}): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next, ...over };
    ctx.rerender();
  };
const open = () => {
  if (!openRef.current) throw new Error("the box has not published its open action");
  openRef.current();
};
const base = (target: ExplainSelection, over: Partial<Props> = {}): Props => ({
  target,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => ANSWER),
  cached: ANSWER,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  reading,
  openRef,
  ...over,
});
const explainRegistered = () => useWindows.getState().windows.find((w) => w.id === EXPLAIN_WINDOW_ID);

describe("ExplainBox — nothing is reserved and nothing moves when it opens (P11-14 rule 3)", () => {
  it("writes no custom property on the document's root and never scrolls the page, on opening, on a new passage and on closing", async () => {
    const run = await scenario(base(selection(380)), [() => open(), () => fire("keydown", { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() })]);
    await wait();
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(root.size).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

describe("ExplainBox — one card of the margin's stack (P11-14 rule 4; O-8, BACKLOG-66)", () => {
  it("registers in useWindows as the explain card when it opens, and leaves when it closes", async () => {
    expect(explainRegistered()).toBeUndefined();
    const run = await scenario(base(selection(380)), [() => open()]);
    await wait();
    expect(explainRegistered()).toMatchObject({ id: EXPLAIN_WINDOW_ID, kind: "explain" });
    expect(cardOf(run.last())).toBeDefined();
    fire("keydown", { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    run.mounted.unmount();
    expect(explainRegistered()).toBeUndefined();
  });

  it("closing with the card's own Close leaves the stack too", async () => {
    const run = await scenario(base(selection(380)), [() => open(), (tree) => (cardOf(tree)!.props.onClose as () => void)()]);
    await wait();
    expect(cardOf(run.last())).toBeUndefined();
    run.mounted.unmount();
    expect(explainRegistered()).toBeUndefined();
  });

  it("takes its frame from the margin's rect: its left and width, and no right edge of its own", async () => {
    const run = await scenario(base(selection(380)), [() => open()]);
    await wait();
    const style = styleOf(run.last())!;
    expect(style.left).toBe(MARGIN.left);
    expect(style.width).toBe(MARGIN.width);
    expect(style).not.toHaveProperty("right");
    expect(cardOf(run.last())!.props.dock).toBe(true);
    run.mounted.unmount();
  });

  it("without a registered margin it keeps the right edge, 360 px wide (a page without the shell)", async () => {
    useMarginStore.setState({ rect: null });
    const run = await scenario(base(selection(380)), [() => open()]);
    await wait();
    expect(styleOf(run.last())).toMatchObject({ right: 0, width: 360 });
    run.mounted.unmount();
  });

  // RE-AIMED (§1c), P11-26 rule 1 (ruling §1h.122): was "held in the margin's band for its whole height", and the low paragraph "lifted until the
  // thread's floor (360) stands above the band's foot". The card is now held for the explain card's floor, `DOCK_STACK_FLOOR_PX` (250), and no more
  // (the new block at the foot of this file holds the answer's height out of it): a low paragraph lifts it by just what that floor needs.
  it("stands alone level with its paragraph, held in the margin's band for its floor, and is the whole room beyond that", async () => {
    // The paragraph's first line is at 300: the card opens there.
    const level = await scenario(base(selection(380, 300)), [() => open()]);
    await wait();
    expect(styleOf(level.last())!.top).toBe(300);
    expect(useWindows.getState().origin).toBe(300);
    level.mounted.unmount();
    // A paragraph low on the screen: lifted until its floor (250, not the thread's 360) stands above the band's foot.
    const low = await scenario(base(selection(780, 760)), [() => open()]);
    await wait();
    expect(styleOf(low.last())!.top).toBe(placeInMargin(MARGIN, 760, DOCK_STACK_FLOOR_PX));
    expect(styleOf(low.last())!.top).toBe(MARGIN.bottom - DOCK_STACK_FLOOR_PX);
    // Above the masthead: no higher than the band's top.
    low.mounted.unmount();
    const high = await scenario(base(selection(20, 10)), [() => open()]);
    await wait();
    expect(styleOf(high.last())!.top).toBe(DOCK_TOP_PX);
    high.mounted.unmount();
  });

  it("stands at z 60, the stack's base, alone; it no longer sits over the whole stack at 70", async () => {
    const run = await scenario(base(selection(380, 300)), [() => open()]);
    await wait();
    expect(styleOf(run.last())!.zIndex).toBe(60);
    run.mounted.unmount();
  });

  it("is a header tall, with a way to raise it, when another card is raised over it; a header press raises it back", async () => {
    const seen: Array<{ behind: unknown; style: Record<string, number | string | undefined> | undefined }> = [];
    const note: Step = (tree) => seen.push({ behind: cardOf(tree)!.props.behind, style: styleOf(tree) });
    const run = await scenario(base(selection(380, 300)), [
      () => open(),
      () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
      note,
      (tree) => (cardOf(tree)!.props.onRaise as () => void)(),
      note,
    ]);
    await wait();
    // The sticky joined after the explain card: it is the front, the explain card a header at the cascade's origin.
    expect(seen[0].behind).toBe(true);
    expect(seen[0].style).toMatchObject({ top: 300, maxHeight: WINDOW_HEADER_PX, zIndex: 60 });
    // A press on its header raises it back over the sticky: whole again, in front.
    expect(seen[1].behind).toBeFalsy();
    const order = (id: string) => useWindows.getState().windows.find((w) => w.id === id)!.order;
    expect(order(EXPLAIN_WINDOW_ID)).toBeGreaterThan(order("s1"));
    expect(styleOf(run.last())!.zIndex).toBe(61);
    run.mounted.unmount();
  });

  it("the cascade's origin is frozen once a second card joins: the explain card no longer follows its paragraph", async () => {
    const run = await scenario(base(selection(380, 300)), [() => open(), () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" })]);
    await wait();
    expect(useWindows.getState().origin).toBe(300);
    run.mounted.unmount();
  });

  it("taking a new passage into it raises it over the cards that stand: opening raises", async () => {
    const second = { ...selection(600, 580), paragraphIndex: 0, passage: "Specimens were machined from a single casting." };
    const run = await scenario(base(selection(380, 300)), [
      () => open(),
      () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
      selectNext(second, { cached: undefined }),
      () => open(),
    ]);
    await wait();
    const order = (id: string) => useWindows.getState().windows.find((w) => w.id === id)!.order;
    expect(order(EXPLAIN_WINDOW_ID)).toBeGreaterThan(order("s1"));
    expect(cardOf(run.last())!.props.behind).toBeFalsy();
    run.mounted.unmount();
  });

  it("Escape closes it and a press outside it closes nothing, as before (the order of Escape is unchanged)", async () => {
    const escape = { key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const stood: boolean[] = [];
    const run = await scenario(base(selection(380, 300)), [
      () => open(),
      () => fire("pointerdown", { target: { closest: () => null } }),
      () => stood.push(explainRegistered() !== undefined),
      () => fire("keydown", escape),
    ]);
    await wait();
    // The press outside closed nothing: the card stood, and was in the stack, after it.
    expect(stood).toEqual([true]);
    // Escape closed it, as it always did (and went no further), and the card left the stack.
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(cardOf(run.last())).toBeUndefined();
    expect(explainRegistered()).toBeUndefined();
    run.mounted.unmount();
  });
});

describe("ExplainBox — below 1024 px it is the card and the sheet, outside the stack (P11-14 rule 4)", () => {
  it("does not register in the stack at 900 px (the card under the selection) or at 390 px (the sheet)", async () => {
    for (const width of [900, 390]) {
      stubWindow(width, 900);
      const run = await scenario(base(selection(380, 300)), [() => open()]);
      await wait();
      expect(cardOf(run.last()), `${width}`).toBeDefined();
      expect(explainRegistered(), `${width}`).toBeUndefined();
      expect(styleOf(run.last())!.zIndex, `${width}`).toBeUndefined();
      run.mounted.unmount();
    }
  });
});

// ── P11-26 rule 1 (A P11-22 B3; ruling §1h.122): the card keeps its top at the selection ──────────────────────────────────────────────
//
// Round 1 measured the explain card level with the selection only while it said "Peer is reading this passage…" (188 px tall). Once the
// answer landed (632 px with the stub's three parts and a table) the box asked the margin for a place for its WHOLE height, so the top gave
// way: 107 / 227 px above the selection at 1440 × 900, at the margin's top at 1280 × 720 and 1093 × 614. The ruling: the top stays level with
// the selection's first line before and after the answer lands, the card is the room from there to the band's foot and the answer scrolls
// inside it; only where that room is under the card's floor (250 px) does the top rise, by just what the floor needs.
//
// No DOM here: a stand-in for the card says how tall the browser made it (`scrollHeight` plus its 2 px of border), as the dock's flow tests do.
describe("ExplainBox — the card keeps its top at the selection when the answer lands (P11-26 rule 1; ruling §1h.122, B3)", () => {
  const sized = (height: number) => ({ scrollHeight: height - 2, offsetHeight: height, clientHeight: height - 2, scrollTop: 0, getBoundingClientRect: () => ({ height }) });
  const giveCard =
    (card: unknown): Step =>
    (tree) => {
      (cardOf(tree)!.props.cardRef as { current: unknown }).current = card;
    };
  const bandFor = (height: number): MarginRect => ({ left: 1000, width: 400, top: DOCK_TOP_PX, bottom: columnBottomPx(height, DOCK_BOTTOM_PX) });
  /** What the ruling asks of the top: level with the first line, or lifted by just what the floor needs. */
  const expectedTop = (band: MarginRect, y: number) => Math.max(band.top, Math.min(y, band.bottom - DOCK_STACK_FLOOR_PX));
  const ANSWER_HEIGHT = 632;

  const WINDOWS = [[1440, 900], [1366, 768], [1280, 720], [1093, 614]] as const;
  for (const [width, height] of WINDOWS) {
    for (const y of [200, 335, 455, 600]) {
      it(`${width} x ${height}, a paragraph at y ${y}: the top is the same loading and answered, level with it or lifted by just the floor, and the card is the room to the band's foot`, async () => {
        stubWindow(width, height);
        const band = bandFor(height);
        useMarginStore.setState({ rect: band });
        const loading = await scenario(base(selection(y + 20, y)), [() => open()]);
        await wait();
        const loadingStyle = styleOf(loading.last())!;
        loading.mounted.unmount();
        useWindows.setState({ windows: [], clock: 0, origin: null });

        const answered = await scenario(base(selection(y + 20, y)), [() => open(), giveCard(sized(ANSWER_HEIGHT))]);
        await wait();
        const answeredStyle = styleOf(answered.last())!;
        const want = expectedTop(band, y);

        expect(loadingStyle.top, "loading").toBe(want);
        expect(answeredStyle.top, "answered").toBe(want);
        // Level with the first line (8 px either way) wherever the room under it holds the floor.
        if (band.bottom - y >= DOCK_STACK_FLOOR_PX) expect(Math.abs((answeredStyle.top as number) - y)).toBeLessThanOrEqual(8);
        // The card is the room from its top to the band's foot (it is as tall as its content up to that, and scrolls inside).
        expect(answeredStyle.maxHeight, "answered").toBe(band.bottom - want);
        expect(answeredStyle.maxHeight as number).toBeGreaterThanOrEqual(DOCK_STACK_FLOOR_PX);
        // The cascade starts where the card stands, so a second card joins level with the selection, not where the answer pushed it.
        expect(useWindows.getState().origin).toBe(want);
        answered.mounted.unmount();
      });
    }
  }

  it("does not move when the answer grows into a thread: a reply of 700 px, then 2000 px, leaves the top where the paragraph is", async () => {
    stubWindow(1440, 900);
    useMarginStore.setState({ rect: MARGIN });
    const card = sized(188);
    const run = await scenario(base(selection(340, 320)), [
      () => open(),
      giveCard(card),
      (_tree, ctx) => {
        Object.assign(card, sized(ANSWER_HEIGHT));
        ctx.rerender();
      },
      (_tree, ctx) => {
        Object.assign(card, sized(700));
        ctx.rerender();
      },
      (_tree, ctx) => {
        Object.assign(card, sized(2000));
        ctx.rerender();
      },
    ]);
    await wait();
    const tops = run.trees.map((tree) => styleOf(tree)?.top).filter((top) => top !== undefined);
    expect(new Set(tops)).toEqual(new Set([320]));
    expect(styleOf(run.last())).toMatchObject({ top: 320, maxHeight: MARGIN.bottom - 320 });
    run.mounted.unmount();
  });

  it("a card behind another one keeps today's rules: a header tall, at the cascade's frozen origin", async () => {
    stubWindow(1440, 900);
    useMarginStore.setState({ rect: MARGIN });
    const run = await scenario(base(selection(380, 300)), [
      () => open(),
      giveCard(sized(ANSWER_HEIGHT)),
      () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
    ]);
    await wait();
    expect(cardOf(run.last())!.props.behind).toBe(true);
    expect(styleOf(run.last())).toMatchObject({ top: 300, maxHeight: WINDOW_HEADER_PX, height: WINDOW_HEADER_PX });
    expect(useWindows.getState().origin).toBe(300);
    run.mounted.unmount();
  });
});

// ── P11-26 rule 4 (§1h.127; C P11-27's report): a selection in a caption or a heading is not the Explain box's ───────────────────────────
//
// Take notes and Highlight are offered on a selection in a figure's caption or a section's heading (their ids have a paragraph's shape; the
// target carries its `block` kind). The explain route finds a passage among the paragraphs only, so a card opened there said "Select text from the
// paper itself". `e`, the thumb bar's cell and the selection's button open the box through the same `open`: it does nothing for such a selection, and
// the box takes no notice of it at all — an open card stays where it stands, behind or in front. A paragraph, a Summary block and an answer are as before.
describe("ExplainBox — nothing opens for a caption or a heading (P11-26 rule 4; §1h.127)", () => {
  const as = (block: string | undefined, over: Partial<ExplainSelection> = {}): ExplainSelection => ({ ...selection(380, 300), ...(block !== undefined ? { block } : {}), ...over }) as ExplainSelection;

  for (const block of ["caption", "heading"]) {
    it(`\`e\` on a ${block} selection opens no card, registers no window and asks for nothing`, async () => {
      const onAsk = vi.fn(async (): Promise<AskResult> => ANSWER);
      const run = await scenario(base(as(block), { onAsk }), [() => open()]);
      await wait();
      expect(cardOf(run.last())).toBeUndefined();
      expect(explainRegistered()).toBeUndefined();
      expect(onAsk).not.toHaveBeenCalled();
      run.mounted.unmount();
    });

    it(`with a card open, a ${block} selection and \`e\` change nothing: the card keeps its passage, its place and its place in the stack`, async () => {
      const onAsk = vi.fn(async (): Promise<AskResult> => ANSWER);
      const run = await scenario(base(selection(380, 300), { onAsk, cached: undefined }), [
        () => open(),
        () => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }),
        selectNext(as(block, { ...selection(700, 640), passage: "A figure's caption, selected.", paragraphIndex: 0 }), { cached: undefined }),
        () => open(),
      ]);
      await wait();
      // Still the first passage's card, a header behind the sticky; `e` neither raised it nor asked for the caption.
      expect(cardOf(run.last())!.props.passage).toBe("The rafting ratio rose from 0.2 to 0.7.");
      expect(cardOf(run.last())!.props.behind).toBe(true);
      expect(styleOf(run.last())).toMatchObject({ top: 300, maxHeight: WINDOW_HEADER_PX });
      expect(onAsk).toHaveBeenCalledTimes(1);
      const order = (id: string) => useWindows.getState().windows.find((w) => w.id === id)!.order;
      expect(order(EXPLAIN_WINDOW_ID)).toBeLessThan(order("s1"));
      run.mounted.unmount();
    });

    it(`the thumb bar's cell is not offered for a ${block} selection (under 768 px), and is for a paragraph's`, async () => {
      stubWindow(600, 800);
      const paragraph = await scenario(base(as(undefined)), []);
      await wait();
      expect(explainOffered()).toBe(true);
      paragraph.mounted.unmount();
      const captioned = await scenario(base(as(block)), []);
      await wait();
      expect(explainOffered()).toBe(false);
      captioned.mounted.unmount();
    });
  }

  it("a paragraph, a Summary block and an answer open as they always did, whatever else the target carries", async () => {
    for (const over of [as(undefined), as("paragraph"), as(undefined, { source: "summary" }), as(undefined, { source: "answer" })]) {
      const run = await scenario(base(over), [() => open()]);
      await wait();
      expect(cardOf(run.last()), JSON.stringify({ block: (over as { block?: string }).block, source: over.source })).toBeDefined();
      expect(explainRegistered()).toMatchObject({ id: EXPLAIN_WINDOW_ID });
      run.mounted.unmount();
    }
  });
});
