import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// P10-08 (review 8.5; supersedes P8-06's ruling on Escape): there is no always-present window, so there is no empty state for Escape to
// go back to. With nothing open the box listens for no key at all — Escape is the page's, and its other handlers (the figure lightbox,
// "back", and a React handler such as the notes editor's) act as they always did. With a passage in the window, Escape clears it AND
// closes the window: the thread is dropped as a Close drops it, the kept answer for the passage stays kept, and the width goes back.
// Close (the button) does the same. The Tier 0 definition, the card and the sheet close on Escape as they always did.
//
// The seams are tried on a miniature of the browser's order for a key press: window capture, document capture, the
// React root's bubble (where `onKeyDown` handlers run), document bubble, window bubble; `stopPropagation` keeps the event
// from reaching the NEXT node but not from the other listeners of the node it is on. The lightbox, the keyboard layer's "back" and the editor's handler are
// stand-ins of the shape their source has, and a last block pins that shape against the source. (P10-02: the term
// highlight's hook went with the "Terms to know" strip, and with it its scenario here.) The box runs on the minimal hook
// runtime (no DOM). Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { readerActions, registerReaderActions, resolvePaperKey } from "@/lib/reader/reader-keys";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { ExplainTurn } from "@/store/explain-threads";
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

const first: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};
const pair = (n: number): ExplainTurn[] => [{ role: "reader", text: `question ${n}` }, { role: "peer", text: `reply ${n}`, peer: true }];

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
  passage: string | null;
  thread: ThreadView | undefined;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    card,
    passage: (card?.props.passage as string | undefined) ?? null,
    thread: card?.props.thread as ThreadView | undefined,
  };
};
/** One word per render: a window with a passage, or no window. */
const kind = (l: Look) => (l.card ? "window" : "none");

// ── The browser's order for a key press, in miniature ──────────────────────────────────────────────

type Node = "window" | "document";
interface Registration {
  type: string;
  fn: (event: unknown) => void;
  capture: boolean;
  node: Node;
}
let registrations: Registration[];
/** The React root's bubble: where `onKeyDown` handlers run (a document-level `stopPropagation` in capture never lets the event reach it). */
let rootHandlers: Array<(event: KeyEvent) => void>;
const listening = (type: string) => registrations.filter((r) => r.type === type).length;

function node(on: Node) {
  const isCapture = (options: unknown) => options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
  return {
    addEventListener: (type: string, fn: Registration["fn"], options?: unknown) => void registrations.push({ type, fn, capture: isCapture(options), node: on }),
    removeEventListener: (type: string, fn: Registration["fn"], options?: unknown) => {
      registrations = registrations.filter((r) => !(r.type === type && r.fn === fn && r.node === on && r.capture === isCapture(options)));
    },
  };
}

interface KeyEvent {
  key: string;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault: Mock<() => void>;
  stopPropagation: Mock<() => void>;
}
function keyEvent(key: string): KeyEvent {
  const event: KeyEvent = {
    key,
    defaultPrevented: false,
    stopped: false,
    preventDefault: vi.fn(() => void (event.defaultPrevented = true)),
    stopPropagation: vi.fn(() => void (event.stopped = true)),
  };
  return event;
}
/** Press `key`: node by node, in the browser's order, each node's own listeners all running; a stop holds back the later nodes only. */
function press(key: string): KeyEvent {
  const event = keyEvent(key);
  const keydown = (on: Node, capture: boolean) => registrations.filter((r) => r.type === "keydown" && r.node === on && r.capture === capture).map((r) => r.fn);
  const stages: Array<() => Array<(event: never) => void>> = [
    () => keydown("window", true),
    () => keydown("document", true),
    () => rootHandlers,
    () => keydown("document", false),
    () => keydown("window", false),
  ];
  for (const stage of stages) {
    if (event.stopped) break;
    for (const fn of [...stage()]) fn(event as never);
  }
  return event;
}

let scrollBy: ReturnType<typeof vi.fn>;
function stubWindow(width = 1280, height = 800) {
  scrollBy = vi.fn();
  vi.stubGlobal("window", { ...node("window"), innerWidth: width, innerHeight: height, scrollBy, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
}

let root: Map<string, string>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
const RESERVED = { "--explain-dock": "376px", "--explain-dock-width": "360px" };

beforeEach(() => {
  openRef = { current: null };
  registrations = [];
  rootHandlers = [];
  root = new Map();
  setProperty = vi.fn((name: string, value: string) => void root.set(name, value));
  removeProperty = vi.fn((name: string) => void root.delete(name));
  vi.stubGlobal("document", { ...node("document"), documentElement: { style: { setProperty, removeProperty } } });
  stubWindow();
});
afterEach(() => vi.unstubAllGlobals());

type Step = (tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void;
/** One page: the box mounted with `initial` (and whatever else `extra` mounts beside it), then `steps`, one per render. */
async function scenario(initial: Props, steps: Step[], extra?: () => void) {
  const ctx = { props: initial, rerender: () => {}, tree: null as ReactNode };
  const looks: Look[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(ctx.props);
    extra?.();
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
// P9-03b (re-aimed helper): press "Explain this?" wherever it stands — the floating button where no window stands, the
// window's header control (`onExplain`) where one does (a reader with a key has the empty window from 1024 px). It was
// the floating button alone; every assertion of the tests that use it is as it was.
/** P10-08 (review 8.4, 8.5; re-aimed): the window is opened only by the page's `explain` action — the selection buttons and the `e` key —
 *  which is the box's `openRef`. It was the floating "Explain this?" button, or the control in the always-present window's header. */
let openRef: { current: (() => void) | null } = { current: null };
const click = (tree?: ReactNode) => {
  void tree;
  if (!openRef.current) throw new Error("the box has not published its open action");
  openRef.current();
};
const close = (tree: ReactNode) => (look(tree).card?.props.onClose as () => void)();
const draft = (tree: ReactNode, text: string) => look(tree).thread?.onDraft(text);

/** A reader with a key, a paper with a body, nothing selected. */
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
  openRef,
  ...over,
});

// ── With nothing open Escape is the page's ──────────────────────────────────────────────────────────

describe("Escape with no window open (P10-08; was P8-06's \"with the empty state showing\")", () => {
  it("registers no key and no press listener, and watches nothing: there is no window and no selection", async () => {
    const run = await scenario(base(), []);

    expect(run.last().card).toBeUndefined();
    expect(listening("keydown")).toBe(0);
    expect(listening("pointerdown")).toBe(0);
    expect(listening("resize")).toBe(0);
    run.mounted.unmount();
  });

  it("does nothing: no window, nothing reserved, and the event is left untouched", async () => {
    let event!: KeyEvent;
    const run = await scenario(base(), [() => void (event = press("Escape"))]);
    await wait();

    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(Object.fromEntries(root)).toEqual({});
    expect(setProperty).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  // Ruling §1h.51 (a), from A P8-05's finding F1: while no thread is open the box does not consume Escape, so the page's own handlers — the
  // Keyboard-shortcuts dialog's close — see that same key and the dialog never needs a second press. With a selection on offer (re-aimed,
  // P10-08: the selection buttons are the page's, the box draws nothing) it is the same.
  it("with a selection made but no window open, Escape is still the page's: no listener of the box's, the event untouched, the page's handlers each see it", async () => {
    const pageSaw = { documentCapture: vi.fn(), windowBubble: vi.fn() };
    let event!: KeyEvent;
    const run = await scenario(base({ target: first }), [
      (tree) => {
        expect(look(tree).card).toBeUndefined();
        expect(listening("keydown")).toBe(0);
        document.addEventListener("keydown", pageSaw.documentCapture as never, true);
        window.addEventListener("keydown", pageSaw.windowBubble as never);
        event = press("Escape");
      },
    ]);
    await wait();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(pageSaw.documentCapture).toHaveBeenCalledTimes(1);
    expect(pageSaw.windowBubble).toHaveBeenCalledTimes(1);
    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("the figure lightbox: its own Escape closes it, and nothing of the box's is in the way", async () => {
    // Stand-in with the shape of `figure-lightbox.tsx`: a capture listener on the document, registered when the lightbox
    // opens (after the box), that stops the key and closes. It ran alongside a hiding box before; now the box is not there.
    const closeLightbox = vi.fn();
    const run = await scenario(base(), [
      () => {
        document.addEventListener(
          "keydown",
          ((event: KeyEvent) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              closeLightbox();
            }
          }) as never,
          true,
        );
      },
      () => void press("Escape"),
    ]);
    await wait();

    expect(closeLightbox).toHaveBeenCalledTimes(1);
    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(Object.fromEntries(root)).toEqual({});
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("\"back\": the keyboard layer resolves Escape to the page's `back`", async () => {
    // Stand-in with the shape of `components/keyboard.tsx`: a bubble listener on the window that runs the reading page's
    // handler for the key (`resolvePaperKey`, `readerActions`: the real ones) and prevents the event.
    const back = vi.fn();
    const release = registerReaderActions({ back });
    window.addEventListener("keydown", ((event: KeyEvent) => {
      const action = resolvePaperKey(event.key);
      const run = action ? readerActions()?.[action] : undefined;
      if (!run) return;
      run();
      event.preventDefault();
    }) as never);
    const run = await scenario(base(), [() => void press("Escape")]);
    await wait();

    expect(back).toHaveBeenCalledTimes(1);
    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
    release();
  });

  it("a React `onKeyDown` handler such as the notes editor's: it runs and stops the key", async () => {
    // Stand-in with the shape of `note-editor.tsx` (Escape: preventDefault, stopPropagation, then its own work): React
    // runs it at the root's bubble. A hiding capture listener on the document would have taken the key before it.
    const closeMenu = vi.fn();
    const back = vi.fn();
    const release = registerReaderActions({ back });
    window.addEventListener("keydown", (() => readerActions()?.back?.()) as never);
    rootHandlers.push((event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      }
    });
    const run = await scenario(base(), [() => void press("Escape")]);
    await wait();

    expect(closeMenu).toHaveBeenCalledTimes(1);
    // Its own stop held "back" off, as in the browser: one Escape, one thing.
    expect(back).not.toHaveBeenCalled();
    expect(run.looks.every((l) => l.card === undefined)).toBe(true);
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
    release();
  });
});

// ── With a passage in the window, Escape closes it ──────────────────────────────────────────────────

describe("Escape with a passage in the window (P10-08; was P8-06's \"returns the window to the empty state\")", () => {
  it("closes the window: the width goes back, nothing is scrolled, and the key goes no further", async () => {
    const back = vi.fn();
    const release = registerReaderActions({ back });
    window.addEventListener("keydown", (() => readerActions()?.back?.()) as never);
    let event!: KeyEvent;
    const run = await scenario(base({ target: first, cachedTurns: pair(1) }), [
      (tree) => click(tree),
      (tree) => {
        expect(look(tree).thread?.turns).toEqual(pair(1));
        event = press("Escape");
      },
    ]);
    await wait();

    // Nothing, then the passage, then nothing again.
    const kinds = run.looks.map(kind);
    expect(kinds[0]).toBe("none");
    expect(kinds).toContain("window");
    expect(kinds[kinds.length - 1]).toBe("none");
    // The window's Escape goes no further, as it always did while it held a passage: "back" is not run.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(Object.fromEntries(root)).toEqual({});
    expect(scrollBy).not.toHaveBeenCalled();
    // No control stands for the selection that is still there: the selection buttons (the page's) and `e` open it again.
    expect(run.last().button).toBeUndefined();
    run.mounted.unmount();
    release();
  });

  it("then the next Escape is the page's: two presses, two things", async () => {
    const back = vi.fn();
    const release = registerReaderActions({ back });
    window.addEventListener("keydown", (() => readerActions()?.back?.()) as never);
    const events: KeyEvent[] = [];
    const run = await scenario(base({ target: first }), [(tree) => click(tree), () => events.push(press("Escape")), () => events.push(press("Escape"))]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(events[0].stopPropagation).toHaveBeenCalledTimes(1);
    expect(events[1].stopPropagation).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(listening("keydown")).toBe(1 /* the stand-in for "back" alone */);
    run.mounted.unmount();
    release();
  });

  it("drops the thread as a Close does — what was typed and the session's turns go — and the kept answer stays kept: opened again, it shows with no request", async () => {
    const kept = pair(1);
    const onAsk = vi.fn(async (): Promise<AskResult> => FIRST_ANSWER);
    const seen: Array<{ draft: string | undefined; turns: ExplainTurn[] | undefined }> = [];
    const run = await scenario(base({ target: first, cachedTurns: kept, onAsk }), [
      (tree) => click(tree),
      (tree) => draft(tree, "And at a lower temperature?"),
      (tree) => {
        expect(look(tree).thread?.draft).toBe("And at a lower temperature?");
        press("Escape");
      },
      (tree) => {
        // No window: no thread, no input.
        expect(look(tree).card).toBeUndefined();
        expect(look(tree).thread).toBeUndefined();
        click(tree);
      },
      (tree) => seen.push({ draft: look(tree).thread?.draft, turns: look(tree).thread?.turns as ExplainTurn[] }),
    ]);
    await wait();

    // Opened again: the kept answer and the kept thread, with no request; the typed words are gone.
    expect(onAsk).not.toHaveBeenCalled();
    expect(seen).toEqual([{ draft: "", turns: kept }]);
    expect(run.last().passage).toBe(first.passage);
    run.mounted.unmount();
  });

  it("Close does the same as Escape — with a passage in the window — and leaves no listener", async () => {
    const run = await scenario(base({ target: first }), [(tree) => click(tree), (tree) => close(tree)]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(run.last().button).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });
});

// ── The Tier 0 definition, the card and the sheet close on Escape as they always did ───────────────

describe("Escape on the Tier 0 definition, the card and the sheet (unchanged)", () => {
  it("no key: the Tier 0 definition's window closes, and the width goes back", async () => {
    const defined = { ...first, passage: "The rafting ratio rose." };
    const run = await scenario(base({ canAsk: false, terms: [term], target: defined, cached: undefined }), [
      (tree) => click(tree),
      (tree) => {
        expect(look(tree).card).toBeDefined();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
        press("Escape");
      },
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });

  it("the card (640 to 1023 px): closes", async () => {
    stubWindow(900, 800);
    const run = await scenario(base({ target: first }), [(tree) => click(tree), () => press("Escape")]);
    await wait();

    expect(run.looks.some((l) => l.card)).toBe(true);
    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("the sheet (under 640 px): closes (opened by the page's `explain` action, the box's `openRef` — the thumb bar's cell, P9-41)", async () => {
    stubWindow(390, 844);
    const openRef = { current: null as (() => void) | null };
    const run = await scenario(base({ target: first, openRef }), [() => openRef.current?.(), () => press("Escape")]);
    await wait();

    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });
});

// ── What is open takes Escape first (P10-31, BACKLOG-86) ────────────────────────────────────────────

// P10-18's check found Escape closing the explain window with the focus in the page, and nothing said who else Escape belongs to there.
// The order, written down (P10-31 rule 1): (1) a modal dialog over the page — the figure lightbox, the Keyboard-shortcuts sheet — takes
// it and the window stays; (2) a control that is open — the question bar's suggestions, a note editor's menu, an export menu, a sticky or
// the notes window with the focus in it — takes it (its React handler stops it before the document's bubble) and the window stays;
// (3) with none of those open the window closes, as P10-08 says (Escape clears the passage and closes it, and goes no further, so the
// page's own "back" is not run by the same press). The box listens on the document in the BUBBLE phase for this: at the capture
// phase it ran before every one of them (and beside the lightbox's own capture listener, which it did not stop), so one press closed the
// lightbox and the window together, and never reached the suggestions' handler.
describe("Escape's order when something else is open (P10-31, BACKLOG-86)", () => {
  /** A stand-in with the shape of the lightbox (`figure-lightbox.tsx`): a capture listener on the document that stops every key, closes on Escape. */
  function openLightbox(onClose: () => void) {
    const onKeyDown = (event: KeyEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        document.removeEventListener("keydown", onKeyDown as never, true);
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown as never, true);
  }
  const standsOpen = (run: { last: () => Look }) => run.last().card !== undefined;

  it("an open figure lightbox takes Escape first: it closes, the window stays; the next Escape closes the window", async () => {
    const closeLightbox = vi.fn();
    const run = await scenario(base({ target: first }), [
      (tree) => click(tree),
      () => openLightbox(closeLightbox),
      () => void press("Escape"),
      (tree) => {
        expect(closeLightbox).toHaveBeenCalledTimes(1);
        expect(look(tree).card, "the window stays while the lightbox closes").toBeDefined();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
      },
      () => void press("Escape"),
    ]);
    await wait();

    expect(closeLightbox).toHaveBeenCalledTimes(1);
    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("the question bar's open suggestions take Escape first (its React handler stops it): they close, the window stays; the next one closes the window", async () => {
    // Stand-in with the shape of `question-field.tsx`: with the list open Escape is the list's (preventDefault, stopPropagation, close).
    let listboxOpen = true;
    rootHandlers.push((event) => {
      if (event.key !== "Escape" || !listboxOpen) return;
      event.preventDefault();
      event.stopPropagation();
      listboxOpen = false;
    });
    const run = await scenario(base({ target: first }), [
      (tree) => click(tree),
      () => void press("Escape"),
      (tree) => {
        expect(listboxOpen).toBe(false);
        expect(look(tree).card, "the window stays while the list closes").toBeDefined();
        expect(Object.fromEntries(root)).toEqual(RESERVED);
      },
      () => void press("Escape"),
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("a sticky note (or the notes window, or a note editor's menu) with the focus in it takes Escape as its React handler always did: the window stays", async () => {
    const closeSticky = vi.fn();
    rootHandlers.push((event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      closeSticky();
    });
    const run = await scenario(base({ target: first }), [(tree) => click(tree), () => void press("Escape")]);
    await wait();

    expect(closeSticky).toHaveBeenCalledTimes(1);
    expect(standsOpen(run)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
  });

  it("the Keyboard-shortcuts sheet, a modal dialog standing over the page, takes Escape first: the keyboard layer closes it, the window stays", async () => {
    // The keyboard layer handles Escape on the window in bubble (`components/keyboard.tsx`) after the document's: the sheet's own markup
    // (`role="dialog" aria-modal="true"`) is how the box knows to leave the key to it.
    let helpOpen = true;
    vi.stubGlobal("document", {
      ...node("document"),
      documentElement: { style: { setProperty, removeProperty } },
      querySelector: (selector: string) => (helpOpen && selector.includes('aria-modal="true"') ? {} : null),
    });
    window.addEventListener("keydown", ((event: KeyEvent) => {
      if (event.key === "Escape" && helpOpen) {
        helpOpen = false;
        event.preventDefault();
      }
    }) as never);
    const run = await scenario(base({ target: first }), [
      (tree) => click(tree),
      () => void press("Escape"),
      (tree) => {
        expect(helpOpen).toBe(false);
        expect(look(tree).card, "the window stays while the sheet closes").toBeDefined();
      },
      () => void press("Escape"),
    ]);
    await wait();

    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
  });

  it("a key someone has already handled (default prevented) is left alone: the window stays", async () => {
    const run = await scenario(base({ target: first }), [
      (tree) => click(tree),
      () => {
        const event = keyEvent("Escape");
        event.defaultPrevented = true;
        for (const r of registrations.filter((entry) => entry.type === "keydown")) r.fn(event);
        expect(event.stopPropagation).not.toHaveBeenCalled();
      },
    ]);
    await wait();

    expect(standsOpen(run)).toBe(true);
    run.mounted.unmount();
  });

  it("with nothing else open (the focus anywhere in the page) one Escape closes the window and goes no further; the next is the page's (P10-08, unchanged)", async () => {
    const back = vi.fn();
    const release = registerReaderActions({ back });
    window.addEventListener("keydown", (() => readerActions()?.back?.()) as never);
    const events: KeyEvent[] = [];
    const run = await scenario(base({ target: first }), [(tree) => click(tree), () => events.push(press("Escape")), () => events.push(press("Escape"))]);
    await wait();

    expect(events[0].stopPropagation).toHaveBeenCalledTimes(1);
    expect(events[1].stopPropagation).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
    release();
  });

  it("the box's Escape stands on the document in the bubble phase (read from the source): after every capture listener and every React handler", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/explain-box.tsx"), "utf8").replace(/\s+/g, " ");

    expect(source).toContain('document.addEventListener("keydown", onKeyDown);');
    expect(source).toContain('document.removeEventListener("keydown", onKeyDown);');
    expect(source).not.toContain('"keydown", onKeyDown, true');
  });
});

// ── The shapes the stand-ins above are modelled on ─────────────────────────────────────────────────

describe("the seams are as the stand-ins model them (read from the source)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\s+/g, " ");

  it("the figure lightbox takes Escape on the document in capture, stops it and closes", () => {
    const source = read("src/components/reader/figure-lightbox.tsx");

    expect(source).toContain('document.addEventListener("keydown", onKeyDown, true)');
    expect(source).toMatch(/event\.stopPropagation\(\); if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); onClose\(\);/);
  });

  it("the keyboard layer listens on the window (bubble) and runs the page's key — `back` for Escape — after the help sheet and a focused field", () => {
    const source = read("src/components/keyboard.tsx");

    expect(source).toContain('window.addEventListener("keydown", handler)');
    expect(source).toContain("if (onPaperPage() && runReaderKey(e.key, e)) return;");
    expect(source).toMatch(/Esc is "back to the briefing"/);
  });

  it("the notes editor's Escape is a React handler that stops the key itself", () => {
    const source = read("src/components/notes/note-editor.tsx");

    expect(source).toMatch(/if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\);/);
  });

  it("the box registers its own Escape only while a passage is in the window: one effect, gated on it", () => {
    const source = read("src/components/reader/explain-box.tsx");

    expect(source).toContain("const isOpen = open !== null; useEffect(() => { if (!isOpen) return; const onKeyDown");
    expect(source).not.toContain("setHidden");
  });
});
