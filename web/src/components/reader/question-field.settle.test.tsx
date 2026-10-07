import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P2-03 (§1g.11 a): the field settles the questions — the ones a deep report
// is asked about. P2-08b (§1g.18, §1g.21 (4), (5)) re-times that: not on every
// Enter, blur or removal (five questions typed with Enter between them were
// five deep reports), but once, when the box settles as a whole — focus leaves
// it, or Enter is pressed on an empty last line (or the last line of a full
// box) — and the reader then stays idle for `idleMs`; anything done in the box
// meanwhile starts the wait over, and leaving the page during it settles at
// once. Never on a keystroke, never on the gist toggle. No DOM here: the field
// runs on the minimal hook runtime and its own handlers are called on the
// element tree it returns.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { BOX_IDLE_MS, QuestionField, enterEndsTheBox, leftTheBox } from "./question-field";

const PAPER = "openalex:W1";
const AT = "2026-10-05T00:00:00.000Z";
/** P1-09 (§1f.20): the page's example groups. */
const EXAMPLE = "Does this help with dendrite growth?";
const EXAMPLES = [{ label: ASK.fromProfile, items: [EXAMPLE] }];
/** A few milliseconds: the tests wait for real, the runtime uses real timers. */
const IDLE = 15;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element in the tree the field returned (host elements only — the
 *  field renders no component of its own). */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

async function field(idleMs = IDLE) {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: EXAMPLES, idleMs }));
  const all = elements(mounted.value);
  const inputs = all.filter((el) => "data-ask-line" in el.props);
  const section = all.find((el) => el.type === "section")!;
  const button = (label: string) => all.find((el) => el.type === "button" && (el.props["aria-label"] === label || el.props.children === label));
  /** Focus leaves the box: the section's own blur, with nothing receiving focus. */
  const leave = () => (section.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
  return { mounted, inputs, button, leave, section };
}

const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

// P2-10 (§1g.21 (6), A's N3): while the box's idle wait is pending the field
// listens for `pagehide` on `window`. This suite has no DOM, so `window` is a
// bare event target the tests can read: how many listeners each event has, and
// a way to fire one.
let windowListeners: Map<string, Set<() => void>>;
const listenerCount = (type: string) => windowListeners.get(type)?.size ?? 0;
const fireOnWindow = (type: string) => [...(windowListeners.get(type) ?? [])].forEach((listener) => listener());

beforeEach(() => {
  windowListeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: () => void) => {
      windowListeners.set(type, (windowListeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => {
      windowListeners.get(type)?.delete(listener);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the field settles the questions (P2-03)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
  });

  // P2-08b (§1g.18): this test named the events that settle as Enter, blur and
  // removal. Under the ruling none of the three settles by itself — the box
  // settles as a whole — so it now names what does and what does not, through
  // the same pure functions the handlers use.
  it("names what settles the box: leaving it, and Enter on an empty last line or the last line of a full box — nothing a line does", () => {
    expect(BOX_IDLE_MS).toBe(1500);
    // Focus moving to another control inside the box is not leaving it.
    expect(leftTheBox({ contains: () => true } as unknown as Node, {} as EventTarget)).toBe(false);
    expect(leftTheBox({ contains: () => false } as unknown as Node, {} as EventTarget)).toBe(true);
    expect(leftTheBox({ contains: () => false } as unknown as Node, null)).toBe(true);
    // Enter on an empty last line: nothing more to add — the reader is done.
    expect(enterEndsTheBox(["Q1", ""], 1)).toBe(true);
    expect(enterEndsTheBox([""], 0)).toBe(true);
    // Enter in a filled line adds one (or moves on): the reader is not done.
    expect(enterEndsTheBox(["Q1"], 0)).toBe(false);
    expect(enterEndsTheBox(["", "Q2"], 0)).toBe(false);
    expect(enterEndsTheBox(["Q1", "Q2"], 0)).toBe(false);
    // §1g.21 (5): on the last line of a full five-line box there is no room for
    // another line, so Enter there is the done gesture — and only there.
    const five = ["Q1", "Q2", "Q3", "Q4", "Q5"];
    expect(enterEndsTheBox(five, 4)).toBe(true);
    expect(enterEndsTheBox(five, 3)).toBe(false);
    expect(enterEndsTheBox(["Q1", "", "Q3", "Q4", "Q5"], 4)).toBe(false);
    expect(enterEndsTheBox(["Q1", "Q2", "Q3", "Q4", ""], 4)).toBe(true);
  });

  it("typing writes through to items and settles nothing", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });

    expect(stored().items).toEqual(["Does tungsten delay rafting at 1100 C?"]);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say Enter settles the line it was pressed in. It
  // settles nothing now: pressing Enter between questions is how a reader types
  // five of them, and each settle was a deep report.
  it("Enter in a line settles nothing, however long the reader then stays", async () => {
    const { inputs, mounted } = await field();
    (inputs[0].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });
    await sleep(IDLE * 4);

    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say a line's blur settles it. A line's own blur
  // settles nothing; the box's does, after the idle wait.
  it("a line's blur settles nothing; leaving the box settles it after the wait, not before", async () => {
    const { inputs, leave, mounted } = await field();
    (inputs[0].props.onBlur as () => void)();
    await sleep(IDLE * 4);
    expect(stored().settled).toBeUndefined();

    leave();
    // Not before the wait is over…
    expect(stored().settled).toBeUndefined();
    await sleep(IDLE * 4);
    // …and then once.
    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say removing a line settles nothing — the old set
  // stood until the box settled. P5-04 (S3, §1h.15 (c)) rules the × a finished
  // gesture, like a tick: the focused button leaves with its line, so no blur
  // ever reached the box and the deleted question's words stayed in the
  // preference ledger until the box was next left. The × now settles the box as
  // it stands, at once (`question-field.remove.test.tsx` pins the ledger side);
  // this test is rewritten to that contract, and what it pinned about leaving
  // the box afterwards (the settled set is what is left) is unchanged.
  it("removing a line settles what is left at once; leaving the box afterwards changes nothing", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?", "Why 1100 C?"], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);
    const { button, leave, mounted } = await field();
    (button(ASK.remove(1))?.props.onClick as () => void)();

    expect(stored().items).toEqual(["Why 1100 C?"]);
    expect(stored().settled).toEqual(["Why 1100 C?"]);

    leave();
    await sleep(IDLE * 4);
    expect(stored().settled).toEqual(["Why 1100 C?"]);
    mounted.unmount();
  });

  // P2-08b (§1g.18): the wait is the reader's chance to come back — someone who
  // tabs away and returns inside it has not finished.
  it("coming back into the box inside the wait cancels it; leaving again starts it afresh", async () => {
    const { section, leave, mounted } = await field();
    leave();
    (section.props.onFocus as () => void)();
    await sleep(IDLE * 4);
    expect(stored().settled).toBeUndefined();

    leave();
    await sleep(IDLE * 4);
    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  // P2-08b (§1g.21 (5)): a reader who finishes and goes straight to the next
  // paper inside the wait has still finished; their questions settle at once,
  // not never.
  it("leaving the page during the wait settles at once", async () => {
    const { leave, mounted } = await field(BOX_IDLE_MS);
    leave();
    expect(stored().settled).toBeUndefined();

    mounted.unmount();

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
  });

  it("an unmount with no wait pending settles nothing", async () => {
    const { mounted } = await field(BOX_IDLE_MS);
    mounted.unmount();

    expect(stored().settled).toBeUndefined();
  });

  it("the gist toggle settles nothing", async () => {
    const { button, mounted } = await field();
    (button(ASK.chips.gist)?.props.onClick as () => void)();

    expect(stored().gist).toBe(true);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  // P2-08b (§1g.18): used to say the chip settles when its line blurs or on
  // Enter in it. Neither does now; the box settling as a whole does.
  it("an example chip fills the next line and settles nothing until the box settles as a whole (P1-09)", async () => {
    const { button, mounted } = await field();
    (button(EXAMPLE)?.props.onClick as () => void)();
    expect(stored().items).toEqual(["Does tungsten delay rafting?", EXAMPLE]);
    expect(stored().settled).toBeUndefined();
    mounted.unmount();

    // The reader leaves the line the chip filled, or presses Enter in it: nothing.
    const again = await field();
    (again.inputs[1].props.onBlur as () => void)();
    (again.inputs[1].props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });
    await sleep(IDLE * 4);
    expect(stored().settled).toBeUndefined();
    again.mounted.unmount();

    // Leaving the box does.
    const third = await field();
    third.leave();
    await sleep(IDLE * 4);
    expect(stored().settled).toEqual(["Does tungsten delay rafting?", EXAMPLE]);
    third.mounted.unmount();
  });
});

// P2-10 (§1g.21 (6), A's N3): "leaving the page" during the idle wait (§1g.21
// (5)) includes a reload and a closed tab, where React's cleanup never runs. The
// wait's own `pagehide` listener settles the questions the way the unmount does;
// nothing is sent from the unloading page — the settled questions travel with the
// next open, as after in-app navigation.
describe("the box settles on pagehide while its wait is pending (P2-10)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
  });

  it("registers no listener while nothing is pending: not on mount, typing, the gist or focus", async () => {
    const { inputs, section, button, mounted } = await field(BOX_IDLE_MS);
    expect(listenerCount("pagehide")).toBe(0);

    (section.props.onFocus as () => void)();
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "Does tungsten delay rafting at 1100 C?" } });
    (button(ASK.chips.gist)?.props.onClick as () => void)();
    expect(listenerCount("pagehide")).toBe(0);

    // A pagehide with nothing pending settles nothing.
    fireOnWindow("pagehide");
    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  it("arms one listener when the wait starts, and a pagehide inside the wait settles at once", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { leave, mounted } = await field(BOX_IDLE_MS);
    leave();
    expect(listenerCount("pagehide")).toBe(1);
    expect(stored().settled).toBeUndefined();

    fireOnWindow("pagehide");

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    expect(listenerCount("pagehide")).toBe(0);
    // Nothing leaves the unloading page: the field only writes the store.
    expect(fetched).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("the pagehide ends the wait: the timer does not settle a second time", async () => {
    const { leave, mounted } = await field(IDLE);
    leave();
    fireOnWindow("pagehide");
    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);

    // A later change must not be settled by the wait that already ended.
    useReadingQuestionsStore.getState().set(PAPER, ["Does tungsten delay rafting?", "Why 1100 C?"], false, AT);
    await sleep(IDLE * 4);

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    mounted.unmount();
  });

  it("leaves no listener behind when the wait fires", async () => {
    const { leave, mounted } = await field(IDLE);
    leave();
    expect(listenerCount("pagehide")).toBe(1);

    await sleep(IDLE * 4);

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    expect(listenerCount("pagehide")).toBe(0);
    mounted.unmount();
  });

  it("leaves no listener behind when the wait is cancelled, and a pagehide then settles nothing", async () => {
    const { leave, section, mounted } = await field(BOX_IDLE_MS);
    leave();
    expect(listenerCount("pagehide")).toBe(1);

    // Coming back into the box ends the wait.
    (section.props.onFocus as () => void)();
    expect(listenerCount("pagehide")).toBe(0);
    fireOnWindow("pagehide");

    expect(stored().settled).toBeUndefined();
    mounted.unmount();
  });

  it("leaving and re-arming does not stack listeners", async () => {
    const { leave, section, mounted } = await field(BOX_IDLE_MS);
    leave();
    (section.props.onFocus as () => void)();
    leave();
    leave();

    expect(listenerCount("pagehide")).toBe(1);
    mounted.unmount();
  });

  it("removes the listener on unmount, and the unmount still settles as it did", async () => {
    const { leave, mounted } = await field(BOX_IDLE_MS);
    leave();
    expect(listenerCount("pagehide")).toBe(1);

    mounted.unmount();

    expect(stored().settled).toEqual(["Does tungsten delay rafting?"]);
    expect(listenerCount("pagehide")).toBe(0);
  });
});
