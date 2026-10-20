import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-13 (owner items 5 and 8; B P11-03 §2; ruling §1h.113): the selection's actions as a component — what it draws, what it
// listens to, what it tells the thumb bar. The component runs on the minimal hook runtime (no DOM here), with a stubbed window and
// document: the element tree it returns is inspected and the flag read. The margin is stubbed through `useMarginRect` (the real one
// is a `useSyncExternalStore` over `margin.ts`'s store, which the runtime does not run; `placeInMargin` and the selector stay the
// real ones). Every text and number is invented.
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
import { highlightOffered, setHighlightOffer } from "@/lib/reader/explain-offer";
import { MARGIN_CARD_SELECTOR, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { SelectionToolbar, type ActionsPlace } from "./selection-toolbar";
import type { ExplainSelection } from "./paper-body";

const MARGIN: MarginRect = { left: 1080, width: 360, top: 48, bottom: 860 };

interface Look {
  place: ActionsPlace | null;
  /** The handlers the view was given. */
  onHighlight: unknown;
}
type Box = { left: number; top: number; right: number; bottom: number };

let measureTop = 400;
let cards: Box[] = [];
let listeners: Map<string, Set<(event: unknown) => void>>;
let observers: Array<{ callback: () => void; target: unknown; init: unknown; live: boolean }>;
let measured = 0;

const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener({}));
const recorder = () => ({
  addEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
  },
  removeEventListener: (type: string, listener: (event: unknown) => void) => {
    listeners.get(type)?.delete(listener);
  },
});
const listenerCount = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);

const ROOT = { style: {}, tag: "html" };
function stubPage(width: number, height = 900) {
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
  vi.stubGlobal("document", {
    ...recorder(),
    documentElement: ROOT,
    querySelectorAll: (selector: string) => {
      asked.push(selector);
      return cards.map((box) => ({ getBoundingClientRect: () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top }) }));
    },
  });
  vi.stubGlobal(
    "MutationObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: () => void) {
        this.entry = { callback, target: null, init: null, live: false };
        observers.push(this.entry);
      }
      observe(target: unknown, init: unknown) {
        this.entry.target = target;
        this.entry.init = init;
        this.entry.live = true;
      }
      disconnect() {
        this.entry.live = false;
      }
    },
  );
}
const asked: string[] = [];

const selection = (over: Partial<ExplainSelection> = {}): ExplainSelection => ({
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 520, bottom: 422 },
  bounds: { left: 300, top: 400, right: 520, bottom: 422 },
  measure: () => {
    measured += 1;
    const bounds = { left: 300, top: measureTop, right: 520, bottom: measureTop + 22 };
    return { rect: bounds, bounds };
  },
  ...over,
});

type Props = Parameters<typeof SelectionToolbar>[0];
const base = (over: Partial<Props> = {}): Props => ({ target: selection(), canExplain: true, onExplain: vi.fn(), onTakeNote: vi.fn(), ...over });

const lookAt = (tree: ReactNode): Look => {
  const element = tree as ReactElement<{ place: ActionsPlace; onHighlight: unknown }> | null;
  return element && typeof element === "object" && "props" in element ? { place: element.props.place, onHighlight: element.props.onHighlight } : { place: null, onHighlight: undefined };
};

type Ctx = { props: Props; rerender: () => void; tree: ReactNode };
type Step = (ctx: Ctx) => void;
/** Each step runs in an effect, after the render before it; the first one only waits for the toolbar's own first measure. */
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
  return { trees, mounted, last: () => lookAt(trees[trees.length - 1]) };
}
const wait: Step = () => {};
const read = (into: Look[]): Step => (ctx) => void into.push(lookAt(ctx.tree));

beforeEach(() => {
  listeners = new Map();
  observers = [];
  asked.length = 0;
  cards = [];
  measureTop = 400;
  measured = 0;
  stub.margin = null;
  useWindows.setState({ windows: [] });
  setHighlightOffer(false);
  stubPage(1440);
});
afterEach(() => {
  setHighlightOffer(false);
  useWindows.setState({ windows: [] });
  vi.unstubAllGlobals();
});

describe("SelectionToolbar — nothing in the margin until a selection (P11-13, rule 4; invariants 1 and 2)", () => {
  it("draws nothing and listens to nothing with no selection, margin or no margin: no pill, no scroll listener, no observer", async () => {
    for (const margin of [null, MARGIN]) {
      stub.margin = margin;
      const run = await scenario(base({ target: null, onHighlight: vi.fn(), canHighlight: true }));
      expect(run.trees.every((tree) => tree === null)).toBe(true);
      expect(listenerCount()).toBe(0);
      expect(observers).toHaveLength(0);
      expect(measured).toBe(0);
      expect(highlightOffered()).toBe(false);
      run.mounted.unmount();
    }
  });

  it("takes everything back when the selection goes: the listeners, the observer, the stack subscription", async () => {
    stub.margin = MARGIN;
    const seen: Look[] = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      (ctx) => {
        ctx.props = { ...ctx.props, target: null };
        ctx.rerender();
      },
      read(seen),
      () => {
        measured = 0;
        fire("scroll");
        fire("resize");
        useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" });
        observers.forEach((one) => one.live && one.callback());
      },
      wait,
    ]);
    expect(seen[0].place?.mode).toBe("margin");
    expect(seen[1].place).toBeNull();
    expect(listenerCount()).toBe(0);
    expect(observers.every((one) => !one.live)).toBe(true);
    expect(measured).toBe(0);
    run.mounted.unmount();
  });
});

describe("SelectionToolbar — the place (P11-13, rule 2)", () => {
  it("stands in the margin level with the selection's first line when a shell has registered one", async () => {
    stub.margin = MARGIN;
    const run = await scenario(base());
    expect(run.last().place).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 400, below: false });
    run.mounted.unmount();
  });

  it("is the pill above the selection when there is no margin (the real page today, a window under 1024 px)", async () => {
    stub.margin = null;
    const run = await scenario(base());
    const place = run.last().place!;
    expect(place.mode).toBe("above");
    expect(place.left).toBe(300);
    expect(place.top).toBeLessThan(400);
    run.mounted.unmount();
  });

  it("draws nothing under 768 px, and while the selection is wholly out of view", async () => {
    stub.margin = MARGIN;
    stubPage(390);
    const phone = await scenario(base());
    expect(phone.last().place).toBeNull();
    phone.mounted.unmount();

    stubPage(1440);
    measureTop = -200;
    const away = await scenario(base());
    expect(away.last().place).toBeNull();
    away.mounted.unmount();
  });

  it("asks the page for the open cards through the margin's selector, and goes above when one covers it, back to the margin when it goes", async () => {
    stub.margin = MARGIN;
    const seen: Look[] = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      () => {
        cards = [{ left: MARGIN.left, top: 380, right: MARGIN.left + MARGIN.width, bottom: 700 }];
        fire("scroll");
      },
      read(seen),
      () => {
        cards = [];
        fire("scroll");
      },
      read(seen),
    ]);
    expect(seen.map((look) => look.place?.mode)).toEqual(["margin", "above", "margin"]);
    expect(asked.length).toBeGreaterThan(0);
    for (const selector of asked) expect(selector).toContain(MARGIN_CARD_SELECTOR);
    run.mounted.unmount();
  });
});

describe("SelectionToolbar — it measures again whenever the place can have moved (P11-13, rule 2; defect b)", () => {
  /** Move the selection to `top`, make the trigger fire, and say where the group stands after. */
  async function afterTrigger(trigger: () => void, top = 300) {
    stub.margin = MARGIN;
    const seen: Look[] = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      () => {
        measureTop = top;
        trigger();
      },
      read(seen),
    ]);
    run.mounted.unmount();
    return seen.map((look) => look.place?.top);
  }

  it("starts from where the selection is", async () => {
    expect(await afterTrigger(() => {}, 400)).toEqual([400, 400]);
  });

  it("on a scroll (any scroller: the listener is a capture listener on the window)", async () => {
    expect(await afterTrigger(() => fire("scroll"))).toEqual([400, 300]);
  });

  it("on a resize of the window", async () => {
    expect(await afterTrigger(() => fire("resize"))).toEqual([400, 300]);
  });

  it("on every change of the window stack: a sticky opened, raised or closed (after the cards have been drawn)", async () => {
    expect(await afterTrigger(() => useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" }))).toEqual([400, 300]);
  });

  it("on the page's reflow — the reserve the dock writes on the root element (the pill went stale after it)", async () => {
    expect(await afterTrigger(() => observers.forEach((one) => one.live && one.callback()))).toEqual([400, 300]);
    const watched = observers.find((one) => one.target === ROOT);
    expect(watched).toBeDefined();
    expect(watched!.init).toMatchObject({ attributes: true });
  });

  it("on the margin's own resize: the margin the shell registered moves, the group follows it", async () => {
    stub.margin = MARGIN;
    const seen: Look[] = [];
    const run = await scenario(base(), [
      wait,
      read(seen),
      (ctx) => {
        stub.margin = { ...MARGIN, left: 900, width: 540 };
        ctx.rerender();
      },
      read(seen),
    ]);
    expect(seen.map((look) => look.place?.left)).toEqual([MARGIN.left + 8, 908]);
    run.mounted.unmount();
  });
});

describe("SelectionToolbar — the third action and the phone's cell (P11-13, rules 1 and 3)", () => {
  it("gives the view a highlight only when the page passes a handler and says it can", async () => {
    stub.margin = MARGIN;
    const onHighlight = vi.fn();
    const withIt = await scenario(base({ onHighlight, canHighlight: true }));
    expect(typeof withIt.last().onHighlight).toBe("function");
    withIt.mounted.unmount();

    for (const over of [{}, { onHighlight }, { canHighlight: true }, { onHighlight, canHighlight: false }] as Partial<Props>[]) {
      const run = await scenario(base(over));
      expect(run.last().onHighlight, JSON.stringify(Object.keys(over))).toBeUndefined();
      run.mounted.unmount();
    }
  });

  it("its Highlight press hands the page the selection it holds", async () => {
    stub.margin = MARGIN;
    const onHighlight = vi.fn();
    const target = selection();
    const run = await scenario(base({ target, onHighlight, canHighlight: true }));
    (run.last().onHighlight as () => void)();
    expect(onHighlight).toHaveBeenCalledTimes(1);
    expect(onHighlight).toHaveBeenCalledWith(target);
    run.mounted.unmount();
  });

  it("tells the thumb bar a highlight is on offer under 768 px, while the selection is on the screen, and takes it back when it is not", async () => {
    stubPage(390, 844);
    const flags: boolean[] = [];
    const note: Step = () => void flags.push(highlightOffered());
    const run = await scenario(base({ onHighlight: vi.fn(), canHighlight: true }), [
      wait,
      note,
      () => {
        measureTop = -300;
        fire("scroll");
      },
      note,
      () => {
        measureTop = 300;
        fire("scroll");
      },
      note,
      (ctx) => {
        ctx.props = { ...ctx.props, target: null };
        ctx.rerender();
      },
      note,
    ]);
    expect(flags).toEqual([true, false, true, false]);
    run.mounted.unmount();
    expect(highlightOffered()).toBe(false);
  });

  it("does not tell it on a window wide enough for the group (768 px and over), or without a highlight to offer", async () => {
    for (const [width, over] of [
      [768, { onHighlight: vi.fn(), canHighlight: true }],
      [1440, { onHighlight: vi.fn(), canHighlight: true }],
      [390, {}],
      [390, { onHighlight: vi.fn(), canHighlight: false }],
    ] as [number, Partial<Props>][]) {
      stubPage(width, 844);
      const run = await scenario(base(over));
      expect(highlightOffered(), `${width} ${Object.keys(over)}`).toBe(false);
      run.mounted.unmount();
    }
  });

  it("takes the offer back when the page is left", async () => {
    stubPage(390, 844);
    const run = await scenario(base({ onHighlight: vi.fn(), canHighlight: true }));
    expect(highlightOffered()).toBe(true);
    run.mounted.unmount();
    expect(highlightOffered()).toBe(false);
  });
});

// ── P11-27 (ruling §1h.122) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Rule 1: a card standing at the selection's height does not take the group out of the margin: it stands there, level, over the card, and says so
// (`data-over-card`). Rule 2: a selection in a caption or a heading is offered Take notes and Highlight in the margin; Explain this is not offered for it
// (the explain route finds a passage in the paper's paragraphs only, so it would answer "not in the paper": see `lib/papers/explain.ts`, `locatePassage`).
type Peek = { place: ActionsPlace | null; canExplain: unknown; overCard: unknown; onHighlight: unknown };
const peek = (tree: ReactNode): Peek => {
  const element = tree as ReactElement<{ place: ActionsPlace; canExplain: unknown; overCard: unknown; onHighlight: unknown }> | null;
  return element && typeof element === "object" && "props" in element
    ? { place: element.props.place, canExplain: element.props.canExplain, overCard: element.props.overCard, onHighlight: element.props.onHighlight }
    : { place: null, canExplain: undefined, overCard: undefined, onHighlight: undefined };
};
const lookNow: (into: Peek[]) => Step = (into) => (ctx) => void into.push(peek(ctx.tree));

describe("SelectionToolbar — over a card (P11-27 rule 1; ruling §1h.122)", () => {
  const covering = { left: MARGIN.left, top: 380, right: MARGIN.left + MARGIN.width, bottom: 700 };

  it("stays in the margin, level with the selection's first line, when a card stands at that height, and says it stands over the card", async () => {
    stub.margin = MARGIN;
    cards = [covering];
    const run = await scenario(base());
    const got = peek(run.trees[run.trees.length - 1]);
    run.mounted.unmount();
    expect(got.place).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 400, below: false });
    expect(got.overCard).toBe(true);
  });

  it("does not move when the card comes and goes under it, and the word over-card follows the card", async () => {
    stub.margin = MARGIN;
    const seen: Peek[] = [];
    const run = await scenario(base(), [
      wait,
      lookNow(seen),
      () => {
        cards = [covering];
        fire("scroll");
      },
      lookNow(seen),
      () => {
        cards = [{ ...covering, top: 600, bottom: 800 }];
        fire("scroll");
      },
      lookNow(seen),
      () => {
        cards = [];
        fire("scroll");
      },
      lookNow(seen),
    ]);
    run.mounted.unmount();
    expect(seen.map((one) => one.place?.mode)).toEqual(["margin", "margin", "margin", "margin"]);
    expect(seen.map((one) => one.place?.top)).toEqual([400, 400, 400, 400]);
    expect(seen.map((one) => one.overCard)).toEqual([false, true, false, false]);
  });

  it("stays in the margin at every height of the first line with a card over the whole band", async () => {
    stub.margin = MARGIN;
    cards = [{ left: MARGIN.left, top: MARGIN.top, right: MARGIN.left + MARGIN.width, bottom: MARGIN.bottom }];
    const tops: Array<number | undefined> = [];
    const modes: Array<string | undefined> = [];
    for (const at of [60, 200, 330, 520, 700, 820]) {
      measureTop = at;
      const run = await scenario(base());
      const got = peek(run.trees[run.trees.length - 1]);
      run.mounted.unmount();
      modes.push(got.place?.mode);
      tops.push(got.place?.top);
    }
    expect(modes).toEqual(["margin", "margin", "margin", "margin", "margin", "margin"]);
    expect(tops[2]).toBe(330);
  });

  it("is still the pill above the selection where there is no margin, with a card or without one", async () => {
    stub.margin = null;
    cards = [covering];
    const run = await scenario(base());
    const got = peek(run.trees[run.trees.length - 1]);
    run.mounted.unmount();
    expect(got.place?.mode).toBe("above");
  });
});

describe("SelectionToolbar — a selection in a caption or a heading (P11-27 rule 2)", () => {
  const block = (kind: "heading" | "caption") => selection({ sectionIndex: 1, paragraphIndex: kind === "heading" ? 4 : 5, paragraphId: kind === "heading" ? "paper-section-1-p4" : "paper-section-1-p5", source: "paper", block: kind } as Partial<ExplainSelection>);

  it("is offered Take notes and Highlight in the margin, level with the selection: the group stands as it does for a paragraph", async () => {
    stub.margin = MARGIN;
    for (const kind of ["heading", "caption"] as const) {
      const run = await scenario(base({ target: block(kind), onHighlight: vi.fn(), canHighlight: true }));
      const got = peek(run.trees[run.trees.length - 1]);
      run.mounted.unmount();
      expect(got.place).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 400, below: false });
      expect(typeof got.onHighlight, kind).toBe("function");
    }
  });

  it("is not offered Explain this, whatever the page says it can explain: the route would not find the passage", async () => {
    stub.margin = MARGIN;
    for (const kind of ["heading", "caption"] as const) {
      const run = await scenario(base({ target: block(kind), canExplain: true, onHighlight: vi.fn(), canHighlight: true }));
      const got = peek(run.trees[run.trees.length - 1]);
      run.mounted.unmount();
      expect(got.canExplain, kind).toBe(false);
    }
  });

  it("is offered Explain this for a paragraph exactly as before (the page's word stands)", async () => {
    stub.margin = MARGIN;
    const yes = await scenario(base({ canExplain: true }));
    const yesNow = peek(yes.trees[yes.trees.length - 1]);
    yes.mounted.unmount();
    const no = await scenario(base({ canExplain: false }));
    const noNow = peek(no.trees[no.trees.length - 1]);
    no.mounted.unmount();
    expect(yesNow.canExplain).toBe(true);
    expect(noNow.canExplain).toBe(false);
  });
});
