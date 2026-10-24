import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-49 (round 3, Theme B readers r1 and r2; ruling §1h.149) as the component does it: the group reads each open card's controls and words from the page with its headers, in the one
// query by the margin's marker and one for each card, places itself clear of the controls (rule 1) and reads them again with the cards — on a scroll, a resize, a change of the stack.
// Like the component's other flow suite it runs on the minimal hook runtime with a stubbed window and document; the margin is stubbed through `useMarginRect`. Every number is invented.
const stub = vi.hoisted(() => ({ margin: null as unknown }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("@/lib/reader/margin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reader/margin")>()),
  useMarginRect: () => stub.margin,
}));

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { setHighlightOffer } from "@/lib/reader/explain-offer";
import { MARGIN_CARD_SELECTOR, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { SelectionToolbar, type ActionsPlace } from "./selection-toolbar";
import type { ExplainSelection } from "./paper-body";

const MARGIN: MarginRect = { left: 1080, width: 360, top: 48, bottom: 860 };
type Box = { left: number; top: number; right: number; bottom: number };
type Look = { place: (ActionsPlace & { clear?: string }) | null };

let measureTop = 300;
let richCards: unknown[] = [];
let listeners: Map<string, Set<(event: unknown) => void>>;
const asked: string[] = [];
const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener({}));
const recorder = () => ({
  addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
  removeEventListener: (type: string, listener: (event: unknown) => void) => void listeners.get(type)?.delete(listener),
});
function stubPage(width: number) {
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: 900, getSelection: () => ({ isCollapsed: false, removeAllRanges: () => {} }), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
  vi.stubGlobal("document", {
    ...recorder(),
    documentElement: { style: {} },
    querySelectorAll: (selector: string) => {
      asked.push(selector);
      return richCards;
    },
  });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
}

const sized = (b: Box) => ({ ...b, width: b.right - b.left, height: b.bottom - b.top });
const selection = (): ExplainSelection => ({
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 300, right: 520, bottom: 322 },
  bounds: { left: 300, top: 300, right: 520, bottom: 322 },
  measure: () => {
    const bounds = { left: 300, top: measureTop, right: 520, bottom: measureTop + 22 };
    return { rect: bounds, bounds };
  },
});
type Props = Parameters<typeof SelectionToolbar>[0];
const base = (): Props => ({ target: selection(), canExplain: true, onExplain: vi.fn(), onTakeNote: vi.fn() });
const viewOf = (tree: ReactNode) => (tree && typeof tree === "object" && "props" in tree ? (tree as ReactElement<{ place: Look["place"]; onExplain: () => void }>).props : null);

/** A card as the page draws it: its box and kind, no header, and the controls it holds — `holds` rects, each a button with a label, standing in the card (their parent). */
function card(kind: string, box: Box, holds: Box[]) {
  const root: Record<string, unknown> = { getAttribute: (name: string) => (name === "data-margin-card" ? kind : null), getBoundingClientRect: () => sized(box), querySelector: () => null, firstElementChild: null };
  const controls = holds.map((rect) => ({ tagName: "BUTTON", parentElement: root, textContent: "B", getBoundingClientRect: () => sized(rect) }));
  root.querySelectorAll = (selector: string) => {
    asked.push(`card:${selector}`);
    return controls;
  };
  return root;
}

const liveMounts: Array<{ unmount: () => void }> = [];
type Ctx = { props: Props; rerender: () => void; tree: ReactNode };
type Step = (ctx: Ctx) => void;
async function scenario(initial: Props, steps: Step[] = []) {
  const ctx: Ctx = { props: initial, rerender: () => {}, tree: null };
  const trees: ReactNode[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = SelectionToolbar(ctx.props);
    const [step, setStep] = useState(0);
    const [, setTick] = useState(0);
    ctx.rerender = () => setTick((n) => n + 1);
    ctx.tree = tree;
    trees.push(tree);
    useEffect(() => {
      const run = steps[step];
      if (!run) return;
      run(ctx);
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  liveMounts.push(mounted);
  return { trees, mounted, last: () => viewOf(trees[trees.length - 1])?.place ?? null };
}
const wait: Step = () => {};
const read = (into: Array<Look["place"]>): Step => (ctx) => void into.push(viewOf(ctx.tree)?.place ?? null);

beforeEach(() => {
  listeners = new Map();
  asked.length = 0;
  richCards = [];
  measureTop = 300;
  stub.margin = MARGIN;
  useWindows.setState({ windows: [] });
  setHighlightOffer(false);
  stubPage(1440);
});
afterEach(() => {
  liveMounts.splice(0).forEach((one) => one.unmount());
  setHighlightOffer(false);
  useWindows.setState({ windows: [] });
  vi.unstubAllGlobals();
});

const ROW = { left: 1093, top: 290, right: 1427, bottom: 330 };

describe("SelectionToolbar — never over a card's control (P11-49 rule 1; ruling §1h.149)", () => {
  it("reads a card's controls from the page and stands just below the one the level place would cover; level again when the card goes", async () => {
    richCards = [card("notes", { left: 1080, top: 48, right: 1440, bottom: 700 }, [ROW])];
    const seen: Array<Look["place"]> = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      () => {
        richCards = [];
        fire("scroll");
      },
      read(seen),
    ]);
    run.mounted.unmount();
    expect(seen.map((place) => place?.top)).toEqual([330, 300]);
    expect(seen[0]).toMatchObject({ mode: "margin", left: MARGIN.left + 8, below: false, clear: "below" });
    expect(seen[1]).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 300, below: false });
  });

  it("slides along the margin to clear a small control at the line's height, and reads it again on a scroll: the control moves, the group follows", async () => {
    const square = { left: 1093, top: 306, right: 1107, bottom: 320 };
    richCards = [card("sticky", { left: 1080, top: 250, right: 1440, bottom: 510 }, [square])];
    const seen: Array<Look["place"]> = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      () => {
        richCards = [card("sticky", { left: 1080, top: 250, right: 1440, bottom: 510 }, [{ left: 1093, top: 406, right: 1107, bottom: 420 }])];
        fire("scroll");
      },
      read(seen),
    ]);
    run.mounted.unmount();
    expect(seen[0]).toMatchObject({ left: 1111, top: 300, clear: "aside" });
    expect(seen[1]).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 300, below: false });
  });

  it("asks the page only through the margin's selector, and each card for what it holds", async () => {
    richCards = [card("notes", { left: 1080, top: 48, right: 1440, bottom: 700 }, [ROW])];
    const run = await scenario(base());
    run.mounted.unmount();
    const page = asked.filter((selector) => !selector.startsWith("card:"));
    expect(page.length).toBeGreaterThan(0);
    for (const selector of page) expect(selector).toBe(MARGIN_CARD_SELECTOR);
    const cardAsked = asked.filter((selector) => selector.startsWith("card:"));
    expect(cardAsked.length).toBeGreaterThan(0);
    for (const selector of cardAsked) expect(selector).toContain("button");
  });

  it("changes nothing where there is no margin: the pill above the selection, whatever control stands", async () => {
    stub.margin = null;
    richCards = [card("notes", { left: 1080, top: 48, right: 1440, bottom: 700 }, [ROW])];
    const run = await scenario(base());
    const got = run.last()!;
    run.mounted.unmount();
    expect(got.mode).toBe("above");
    expect(got.clear).toBeUndefined();
  });

  it("is still put away by a press of Explain this, controls or none (P11-38 rule 1)", async () => {
    richCards = [card("notes", { left: 1080, top: 48, right: 1440, bottom: 700 }, [ROW])];
    const shown: boolean[] = [];
    const run = await scenario(base(), [
      wait,
      (ctx) => void shown.push(viewOf(ctx.tree) !== null),
      (ctx) => void viewOf(ctx.tree)?.onExplain(),
      wait,
      (ctx) => void shown.push(viewOf(ctx.tree) !== null),
    ]);
    run.mounted.unmount();
    expect(shown).toEqual([true, false]);
  });
});
