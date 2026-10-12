import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P8-06 (the owner's "yes" of 16:4xZ 2026-10-11 to the empty-state question of §1h.41 (b); ruling §1h.45): from a
// window of 1024 px, for a reader with a key, on a paper with a readable body, the explain window is THERE before
// any text is selected, as an empty panel: the card's header and one line of copy, at the right edge, top 48, the
// page keeping its 376 px clear from the first paint. Close hides it for the rest of the page visit (Escape never does — the
// manager's ruling, pinned in `explain-box.escape.flow.test.tsx`; here: component
// state; a reload shows it again) and the next "Explain this?" brings it back with that passage; the first Explain fills
// it in place — nothing closes or reopens. With no key nothing stands (a locked block is never shown, §1b): the Tier 0
// definition opens on a defined-term selection as before. The card (640 to 1023) and the sheet are unchanged.
// The box runs on the minimal hook runtime (no DOM here); the element tree it returns is inspected and its handlers
// called. Every text is invented.
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
import type { ExplainTurn } from "@/store/explain-threads";
import { explainWindowAvailable } from "@/lib/feed/ai-tier";
import type { AuthOutcome } from "@/components/profile-sync";
import { defaultProfile } from "@/types";
import { EXPLAIN } from "./copy";
import { ExplainBox, ExplainCard, type AskResult, type ThreadView } from "./explain-box";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const term: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const FIRST_ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const REPLY: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };
const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;
/** A paper whose text could not be read: no body, so no Paper digestion tab and no standing window. */
const noBody = { body: [], map: { totalMinutes: 0, sections: [] } } as unknown as Pick<PaperReading, "body" | "map">;

const first: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};
const second: ExplainSelection = {
  ...first,
  paragraphIndex: 0,
  passage: "Specimens were machined from a single casting.",
  rect: { left: 200, top: 600, right: 460, bottom: 620 },
  bounds: { left: 100, top: 580, right: 460, bottom: 620 },
};
/** A selection whose paragraph begins `top` px from the top of the window (its own words lie lower in it). */
const inParagraph = (selection: ExplainSelection, top: number): ExplainSelection => ({ ...selection, paragraph: { left: 120, top, right: 760, bottom: top + 260 } });

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

interface Look {
  /** The floating "Explain this?" button — where no window stands. */
  button: ReactElement<Props2> | undefined;
  /** P9-03b: the window's own control — the "Explain this?" in its header (`onExplain`), the empty state's included. */
  explain: (() => void) | undefined;
  /** The window, whatever it holds. */
  card: ReactElement<Props2> | undefined;
  /** The window is the empty state (nothing explained in it yet). */
  empty: boolean;
  status: string | null;
  /** The passage the window explains (null in the empty state, and with no window). */
  passage: string | null;
  thread: ThreadView | undefined;
  term: string | null;
  style: Record<string, number | undefined> | undefined;
  dock: boolean;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  const empty = card?.props.empty === true;
  const status = card?.props.status as { kind: string; answer?: ExplainAnswer } | undefined;
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    explain: card?.props.onExplain as (() => void) | undefined,
    card,
    empty,
    status: empty ? null : (status?.kind ?? null),
    passage: empty ? null : ((card?.props.passage as string | undefined) ?? null),
    thread: card?.props.thread as ThreadView | undefined,
    term: (card?.props.term as PaperTerm | null | undefined)?.term ?? null,
    style: card?.props.style as Look["style"],
    dock: card?.props.dock === true,
  };
};
/** What the box shows, in one word per render: the empty state, a window with a passage, or nothing of the window. */
const kind = (l: Look) => (l.empty ? "empty" : l.card ? "window" : "none");

let listeners: Map<string, Set<(event: unknown) => void>>;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
const listening = (type: string) => listeners.get(type)?.size ?? 0;
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

// The document's root, where the page's width is kept clear: what is written and what is taken off.
let root: Map<string, string>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
const RESERVED = { "--explain-dock": "376px", "--explain-dock-width": "360px" };
function stubRoot() {
  root = new Map();
  setProperty = vi.fn((name: string, value: string) => void root.set(name, value));
  removeProperty = vi.fn((name: string) => void root.delete(name));
  vi.stubGlobal("document", { ...recorder(), documentElement: { style: { setProperty, removeProperty } } });
}
// The hiding is the component's state for the visit and nothing else: no storage is written or read.
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  listeners = new Map();
  stubRoot();
  stubWindow();
  storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
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
// P9-03b (re-aimed helper): press "Explain this?" wherever it stands — the floating button where no window stands (hidden,
// no key, below 1024 px), the window's header control where one does. It was the floating button alone.
const click = (tree: ReactNode) => {
  const at = look(tree);
  const press = (at.button?.props.onClick as (() => void) | undefined) ?? at.explain;
  if (!press) throw new Error("no Explain this? control is standing");
  press();
};
const close = (tree: ReactNode) => (look(tree).card?.props.onClose as () => void)();
const draft = (tree: ReactNode, text: string) => look(tree).thread?.onDraft(text);
const escapeEvent = () => ({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
const pressOutside = () => fire("pointerdown", { target: { closest: () => null } });
/** The reader selects `next` in the body (or nothing): the page hands the box a new target. */
const selectNext =
  (next: ExplainSelection | null, over: Partial<Props> = {}): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next, ...over };
    ctx.rerender();
  };

const pair = (n: number): ExplainTurn[] => [{ role: "reader", text: `question ${n}` }, { role: "peer", text: `reply ${n}`, peer: true }];

/** A reader with a key, a paper with a body, no selection yet. */
const base = (over: Partial<Props> = {}): Props => ({
  target: null,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => FIRST_ANSWER),
  cached: FIRST_ANSWER,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  onResetThread: vi.fn(),
  reading,
  ...over,
});

describe("ExplainBox — the window is there before the first selection (P8-06, ruling §1h.45)", () => {
  it("at 1280 with a key and a body, renders the empty state from the first render, with no selection", async () => {
    const run = await scenario(base(), []);

    expect(run.looks[0].card).toBeDefined();
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(run.last().dock).toBe(true);
    // Only the empty state: no passage, no answer, no thread, no button.
    expect(run.last().passage).toBeNull();
    expect(run.last().thread).toBeUndefined();
    expect(run.last().button).toBeUndefined();
    run.mounted.unmount();
  });

  it("keeps the page's 376 px clear from the mount, not from the first open", async () => {
    const run = await scenario(base(), []);

    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    // Mounting moves nothing: there is no selection whose place the reflow would have to hold.
    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();

    // Leaving the paper gives the width back.
    expect(Object.fromEntries(root)).toEqual({});
  });

  it("stands at the right edge, 360 wide, its top at 48 under the masthead whatever the window's height, as tall as its content", async () => {
    for (const [width, height] of [[1280, 800], [1440, 900], [1920, 1080], [1280, 600]] as const) {
      stubWindow(width, height);
      const run = await scenario(base(), []);

      expect(run.last().style, `${width}x${height}`).toEqual({ right: 0, width: 360, top: 48, maxHeight: height - 48 - 28 });
      run.mounted.unmount();
    }
  });

  it("is there from 1024 px and from no narrower: the card (640 to 1023) and the sheet get nothing at mount", async () => {
    for (const [width, height, stands] of [[1024, 800, true], [1023, 800, false], [800, 900, false], [640, 900, false], [390, 844, false]] as const) {
      stubWindow(width, height);
      const run = await scenario(base(), []);

      expect(run.last().card !== undefined, `${width} px`).toBe(stands);
      expect(setProperty.mock.calls.length > 0, `${width} px`).toBe(stands);
      run.mounted.unmount();
      setProperty.mockClear();
    }
  });

  it("with no key nothing stands (a locked block is never shown); the Tier 0 definition still opens on a defined term, and stays", async () => {
    const defined = { ...first, passage: "The rafting ratio rose." };
    const plain = { ...second, passage: "Specimens were machined from a single casting." };
    const run = await scenario(base({ canAsk: false, terms: [term], cached: undefined }), [
      () => {
        // Nothing rendered, nothing reserved, and no Escape swallowed (the page's own means "back").
        expect(setProperty).not.toHaveBeenCalled();
        expect(listening("keydown")).toBe(0);
      },
      selectNext(plain),
      (tree) => expect(look(tree).button).toBeUndefined(),
      selectNext(defined),
      (tree) => {
        expect(look(tree).card).toBeUndefined();
        expect(look(tree).button).toBeDefined();
        click(tree);
      },
    ]);
    await wait();

    // Before the click there was never a window; after it, the Tier 0 window, whole and docked.
    const opened = run.looks.findIndex((l) => l.card);
    expect(opened).toBeGreaterThan(0);
    expect(run.looks.slice(0, opened).every((l) => l.card === undefined)).toBe(true);
    expect(run.last().empty).toBe(false);
    expect(run.last().status).toBe("none");
    expect(run.last().term).toBe("rafting ratio");
    expect(run.last().dock).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("on a paper with no readable body nothing stands, key or not (there is no Paper digestion tab)", async () => {
    const run = await scenario(base({ reading: noBody }), []);

    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(setProperty).not.toHaveBeenCalled();
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });

  it("Escape does nothing to it (re-aimed, P8-06 ruling on Escape): it was \"hides it for the rest of the visit\"", async () => {
    // The window the owner wants is always there: with the empty state showing the box listens for no key, so Escape
    // is the page's. The seams — the lightbox, a term highlight, "back" — are in `explain-box.escape.flow.test.tsx`.
    const event = escapeEvent();
    const run = await scenario(base(), [() => fire("keydown", event)]);
    await wait();

    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });

  it("the Close button hides it for the rest of the visit, gives the width back, and leaves no listener (re-aimed: was \"the same way\" as Escape)", async () => {
    const run = await scenario(base(), [(tree) => close(tree)]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(Object.fromEntries(root)).toEqual({});
    expect(removeProperty).toHaveBeenCalledTimes(2);
    expect(listening("keydown")).toBe(0);
    expect(listening("resize")).toBe(0);
    run.mounted.unmount();
  });

  it("stays hidden: not for a resize, a selection that is not explained, or a window that was closed after an Explain", async () => {
    // Re-aimed (P8-06 ruling on Escape): hidden with the Close button; Escape no longer hides.
    const run = await scenario(base(), [
      (tree) => close(tree),
      selectNext(first),
      // A selection gives a button, not the window back.
      (tree) => {
        expect(look(tree).card).toBeUndefined();
        expect(look(tree).button).toBeDefined();
        stubWindow(800, 900);
        fire("resize", {});
      },
      () => {
        stubWindow(1280, 800);
        fire("resize", {});
      },
      selectNext(null),
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();

    // A window that held a passage and was closed with Close does not leave the empty state behind it (Escape would).
    const afterPassage = await scenario(base({ target: first }), [(tree) => click(tree), (tree) => close(tree)]);
    await wait();
    expect(afterPassage.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    afterPassage.mounted.unmount();
  });

  it("is component state, not stored: nothing is written or read, and a reload shows the empty panel again", async () => {
    const hidden = await scenario(base(), [(tree) => close(tree)]);
    await wait();
    expect(hidden.last().card).toBeUndefined();
    hidden.mounted.unmount();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();

    // A reload is a new mount of the box.
    const reloaded = await scenario(base(), []);
    expect(reloaded.last().empty).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    reloaded.mounted.unmount();
  });

  it("a later selection's button brings it back with that passage — in the dock, the width reserved again", async () => {
    const run = await scenario(base({ cached: FIRST_ANSWER }), [(tree) => close(tree), selectNext(first), (tree) => click(tree)]);
    await wait();

    expect(run.last().empty).toBe(false);
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().dock).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(setProperty).toHaveBeenCalledTimes(4);
    run.mounted.unmount();
  });

  it("`e` brings it back the same way, after it was hidden", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const run = await scenario(base({ openRef }), [(tree) => close(tree), selectNext(first), () => openRef.current?.()]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("the first Explain replaces the empty state in place: nothing closes or reopens, and the width is never given back", async () => {
    const run = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => click(tree)]);
    await wait();

    // Empty first, then the passage; never a render without the window in between or after.
    const kinds = run.looks.map(kind);
    expect(kinds[0]).toBe("empty");
    expect(kinds[kinds.length - 1]).toBe("window");
    expect(kinds).not.toContain("none");
    expect(kinds.indexOf("window")).toBeGreaterThan(kinds.lastIndexOf("empty"));
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.looks.every((l) => l.dock)).toBe(true);
    // The properties were set once, at mount, and never touched again; the page did not move.
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("stands at 48 until a passage is selected, then level with its paragraph's first line; explaining it leaves it there (re-aimed, P9-03b: was \"until a passage is explained\", the window not moving for a selection)", async () => {
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: inParagraph(first, 400) }), [
      // A settled selection is on the page, with its control in the window: the window is already level with it.
      (tree) => {
        expect(look(tree).explain).toBeDefined();
        tops.push(look(tree).style?.top);
        click(tree);
      },
      (tree) => tops.push(look(tree).style?.top),
    ]);
    await wait();

    expect(tops).toEqual([400, 400]);
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 400, maxHeight: 800 - 400 - 28 });
    run.mounted.unmount();
  });

  it("a new selection with the empty state showing gets its control in the window, out of the dock's 376 px (re-aimed, P9-03b: was a floating button beside the words)", async () => {
    const late: ExplainSelection = { ...second, rect: { left: 700, top: 600, right: 1000, bottom: 620 }, bounds: { left: 700, top: 580, right: 1000, bottom: 620 } };
    const run = await scenario(base({ target: late }), []);

    expect(run.last().empty).toBe(true);
    // P9-03b (re-aimed): the floating button that stood at 1280 − 376 − 120 − 8 is not rendered while the window stands.
    expect(run.last().button).toBeUndefined();
    expect(run.last().explain).toBeTypeOf("function");
    run.mounted.unmount();
  });

  // P9-03: the button stands beside the words, never on them — in the gutter between the column and the window's edge.
  it("P9-03: with the paragraph reported, the floating button stands in the gutter beside it, level with the selection (re-aimed, P9-03b: the card range, no window; the empty state carries the control)", async () => {
    stubWindow(800, 900);
    // 800 px, no window: the paragraph ends at 600, 200 px to its right — room for the button and a margin each side.
    const late: ExplainSelection = {
      ...second,
      rect: { left: 500, top: 600, right: 580, bottom: 620 },
      bounds: { left: 500, top: 580, right: 580, bottom: 620 },
      paragraph: { left: 120, top: 560, right: 600, bottom: 860 },
    };
    const run = await scenario(base({ target: late }), []);

    expect(run.last().card).toBeUndefined();
    expect(run.last().button?.props.style).toEqual({ left: 600 + 6, top: 600 });
    run.mounted.unmount();
  });

  it("`e` with nothing selected and the empty state showing does nothing: there is no input to focus", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const focus = vi.fn();
    const run = await scenario(base({ openRef, onAsk, cached: undefined }), [
      (tree) => {
        // Even if some input were reachable, the empty state is not a window to ask in.
        (look(tree).card?.props.inputRef as { current: unknown }).current = { focus };
        openRef.current?.();
      },
      () => openRef.current?.(),
      () => {},
    ]);
    await wait();

    expect(focus).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("`e` with a selection explains it in the empty window, in place", async () => {
    const openRef: NonNullable<Props["openRef"]> = { current: null };
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const run = await scenario(base({ openRef, onAsk, cached: undefined, target: first }), [() => openRef.current?.()]);
    await wait();

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ passage: first.passage }));
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.looks.map(kind)).not.toContain("none");
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("a press outside it does nothing", async () => {
    const run = await scenario(base(), [() => pressOutside(), () => pressOutside()]);
    await wait();

    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("follows the window's width: gone below 1024 (the width given back), back at 1024 and over", async () => {
    const seen: Array<{ kind: string; root: Record<string, string> }> = [];
    const note: Step = (tree) => seen.push({ kind: kind(look(tree)), root: Object.fromEntries(root) });
    const run = await scenario(base(), [
      note,
      () => {
        stubWindow(800, 900);
        fire("resize", {});
      },
      note,
      () => {
        stubWindow(1440, 900);
        fire("resize", {});
      },
      note,
    ]);
    await wait();

    expect(seen).toEqual([
      { kind: "empty", root: RESERVED },
      { kind: "none", root: {} },
      { kind: "empty", root: RESERVED },
    ]);
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 48, maxHeight: 900 - 48 - 28 });
    run.mounted.unmount();
  });

  it("keeps watching the window's width at 800 (to come back at 1024) but swallows no key there", async () => {
    stubWindow(800, 900);
    const run = await scenario(base(), []);

    expect(run.last().card).toBeUndefined();
    expect(listening("resize")).toBe(1);
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
    expect(listening("resize")).toBe(0);
  });

  it("listens only while it stands, and for no key while it is empty: the resize is gone with it (re-aimed: the keydown was 1 here)", async () => {
    const run = await scenario(base(), [
      () => {
        // The empty state watches the window's width and nothing else: Escape is the page's.
        expect(listening("keydown")).toBe(0);
        expect(listening("pointerdown")).toBe(0);
        expect(listening("resize")).toBe(1);
      },
      (tree) => close(tree),
    ]);
    await wait();

    expect(listening("keydown")).toBe(0);
    expect(listening("resize")).toBe(0);
    run.mounted.unmount();
  });

  it("survives what a tab switch does to the box: the page clears the selection, and the empty state stays", async () => {
    // The tab state is the page's (`useReaderTab`); the box is mounted outside the tabs and the only thing a switch
    // does to it is `clearExplain`, which hands it a null target. That is what is exercised here.
    const run = await scenario(base(), [selectNext(first), selectNext(null)]);
    await wait();

    expect(run.looks.map(kind).every((k) => k === "empty")).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("survives it with a passage explained: the thread, the draft and the place stay", async () => {
    const kept = pair(1);
    const run = await scenario(base({ target: inParagraph(first, 400), cachedTurns: kept }), [
      (tree) => click(tree),
      (tree) => draft(tree, "And at a lower temperature?"),
      selectNext(null, { cached: undefined, cachedTurns: undefined }),
    ]);
    await wait();

    expect(run.last().passage).toBe(first.passage);
    expect(run.last().thread?.turns).toEqual(kept);
    expect(run.last().thread?.draft).toBe("And at a lower temperature?");
    expect(run.last().style?.top).toBe(400);
    expect(run.looks.map(kind)).not.toContain("none");
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });
});

// ── The first paint with a reader's own key (P8-06, the manager's ruling) ───────────────────────────────────────

describe("ExplainBox — a reader's own key shows the window in the first paint, before the sign-in check answers", () => {
  // What the page hands the box as `canAsk`: `explainWindowAvailable(profile, authOutcome)` (`page.explain.test.ts` pins the
  // wiring). The sign-in check starts at "unknown"; with Supabase configured it answers a round trip after the first paint.
  const LOCAL_KEY = { ...defaultProfile, feedAiProvider: "openai" as const, feedAiApiKey: "not-a-real-key" };
  const NO_LOCAL_KEY = { ...defaultProfile, feedAiProvider: "default" as const, feedAiApiKey: "" };
  const canAskFor = (profile: typeof LOCAL_KEY | typeof NO_LOCAL_KEY, auth: AuthOutcome) => explainWindowAvailable(profile, auth);
  /** The sign-in check answers `auth`: the page's next render hands the box a new `canAsk`. */
  const resolves =
    (profile: typeof LOCAL_KEY | typeof NO_LOCAL_KEY, auth: AuthOutcome): Step =>
    (_tree, ctx) => {
      ctx.props = { ...ctx.props, canAsk: canAskFor(profile, auth) };
      ctx.rerender();
    };

  it("`unknown` with a local key: the window stands at mount — the first render — with the page's width reserved", async () => {
    const run = await scenario(base({ canAsk: canAskFor(LOCAL_KEY, "unknown") }), []);

    expect(run.looks[0].empty).toBe(true);
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(run.last().style).toEqual({ right: 0, width: 360, top: 48, maxHeight: 800 - 48 - 28 });
    run.mounted.unmount();
  });

  it("`unknown` with no local key: nothing at mount, and nothing when the check answers either — Peer has no key to lend", async () => {
    const run = await scenario(base({ canAsk: canAskFor(NO_LOCAL_KEY, "unknown") }), [
      (tree) => {
        expect(look(tree).card).toBeUndefined();
        expect(setProperty).not.toHaveBeenCalled();
      },
      resolves(NO_LOCAL_KEY, "signed-in"),
      (tree) => expect(look(tree).card).toBeUndefined(),
      resolves(NO_LOCAL_KEY, "unconfigured"),
    ]);
    await wait();

    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(setProperty).not.toHaveBeenCalled();
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });

  it("the check answering signed-in or unconfigured changes nothing: the window that stood stands, with no property churn", async () => {
    const run = await scenario(base({ canAsk: canAskFor(LOCAL_KEY, "unknown") }), [resolves(LOCAL_KEY, "signed-in"), resolves(LOCAL_KEY, "unconfigured")]);
    await wait();

    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("a confirmed sign-out takes it away, and the width goes back (the server would refuse the call)", async () => {
    const run = await scenario(base({ canAsk: canAskFor(LOCAL_KEY, "unknown") }), [resolves(LOCAL_KEY, "signed-out")]);
    await wait();

    expect(run.looks[0].empty).toBe(true);
    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    expect(listening("resize")).toBe(0);
    run.mounted.unmount();
  });

  it("a settled outcome gives the same first paint as `unknown` for a reader with a local key", async () => {
    for (const auth of ["signed-in", "unconfigured"] as const) {
      const run = await scenario(base({ canAsk: canAskFor(LOCAL_KEY, auth) }), []);

      expect(run.looks[0].empty, auth).toBe(true);
      expect(Object.fromEntries(root), auth).toEqual(RESERVED);
      run.mounted.unmount();
    }
  });
});

// ── The empty window follows the selection and carries the control (P9-03b, ruling §1h.49) ──────────────────────

describe("ExplainBox — the empty window follows the selected paragraph and carries the control (P9-03b)", () => {
  it("stands at 48 with nothing selected, moves to the first line of the paragraph of a settled selection, and moves again for the next — it stays the empty window", async () => {
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base(), [note, selectNext(inParagraph(first, 400)), note, selectNext(inParagraph(second, 520)), note]);
    await wait();

    expect(tops).toEqual([48, 400, 520]);
    // Never closed, never anything but the empty state; the width kept clear throughout; the page not moved.
    expect(run.looks.map(kind).every((k) => k === "empty")).toBe(true);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("carries the control once a selection is offered — not before, and the floating button is not rendered", async () => {
    const seen: Array<{ explain: boolean; button: boolean }> = [];
    const note: Step = (tree) => seen.push({ explain: look(tree).explain !== undefined, button: look(tree).button !== undefined });
    const run = await scenario(base(), [note, selectNext(inParagraph(first, 400)), note, selectNext(null), note]);
    await wait();

    expect(seen).toEqual([
      { explain: false, button: false },
      { explain: true, button: false },
      { explain: false, button: false },
    ]);
    run.mounted.unmount();
  });

  it("stays where it moved when the selection goes away", async () => {
    const tops: Array<number | undefined> = [];
    const note: Step = (tree) => tops.push(look(tree).style?.top);
    const run = await scenario(base(), [selectNext(inParagraph(first, 400)), selectNext(null), note]);
    await wait();

    expect(tops).toEqual([400]);
    expect(run.last().empty).toBe(true);
    run.mounted.unmount();
  });

  it("pressing the control fills the empty window in place with the offered passage: nothing closes or reopens, the width never given back", async () => {
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const run = await scenario(base({ onAsk, cached: undefined }), [selectNext(inParagraph(first, 400)), (tree) => look(tree).explain?.()]);
    await wait();

    const kinds = run.looks.map(kind);
    expect(kinds[0]).toBe("empty");
    expect(kinds[kinds.length - 1]).toBe("window");
    expect(kinds).not.toContain("none");
    expect(run.last().passage).toBe(first.passage);
    expect(run.last().status).toBe("answer");
    expect(run.last().style?.top).toBe(400);
    expect(run.last().explain).toBeUndefined();
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("is the window's control at 1024, 1280, 1440 and 1920; the floating button is there once the window is hidden, and in the card range with no window at all", async () => {
    for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]] as const) {
      stubWindow(width, height);
      const run = await scenario(base({ target: inParagraph(first, 400) }), []);

      expect(run.last().empty, `${width} px`).toBe(true);
      expect(run.last().explain, `${width} px`).toBeTypeOf("function");
      expect(run.last().button, `${width} px`).toBeUndefined();
      run.mounted.unmount();
    }
    stubWindow(1280, 800);
    const hidden = await scenario(base({ target: inParagraph(first, 400) }), [(tree) => close(tree)]);
    await wait();
    expect(hidden.last().card).toBeUndefined();
    expect(hidden.last().explain).toBeUndefined();
    expect(hidden.last().button).toBeDefined();
    hidden.mounted.unmount();

    for (const [width, height] of [[1023, 800], [800, 900], [390, 844]] as const) {
      stubWindow(width, height);
      const card = await scenario(base({ target: inParagraph(first, 400) }), []);
      expect(card.last().card, `${width} px`).toBeUndefined();
      expect(card.last().button, `${width} px`).toBeDefined();
      card.mounted.unmount();
    }
  });
});
