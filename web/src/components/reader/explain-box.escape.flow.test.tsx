import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// P8-06, the manager's ruling on Escape (after the first build): the window the owner wants is ALWAYS there, so Escape
// must not fight the page. With the empty state showing, Escape does nothing to the window and the box listens for no
// key at all — the page's other Escape handlers (the figure lightbox, a term highlight, "back", and a React handler such
// as the notes editor's) act as before. With a thread showing, Escape returns the window to the empty state: the thread is
// dropped as a Close used to drop it, the kept answer for the passage stays kept, the window stays and the width stays
// reserved. Close (the button) is the only thing that hides the window for the visit. Without an empty state to go back to
// (no key, no body, below 1024 px) Escape closes the window as it always did.
//
// The seams are tried on a miniature of the browser's order for a key press: window capture, document capture, the
// React root's bubble (where `onKeyDown` handlers run), document bubble, window bubble; `stopPropagation` keeps the event
// from reaching the NEXT node but not from the other listeners of the node it is on. The term highlight's own hook
// (`useEscapeToClear`) is the real one; the lightbox, the keyboard layer's "back" and the editor's handler are stand-ins
// of the shape their source has, and a last block pins that shape against the source. The box runs on the minimal hook
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
import { useEscapeToClear } from "./terms-strip";

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
  empty: boolean;
  passage: string | null;
  thread: ThreadView | undefined;
}
const look = (tree: ReactNode): Look => {
  const all = elements(tree);
  const card = all.find((el) => el.type === ExplainCard);
  const empty = card?.props.empty === true;
  return {
    button: all.find((el) => el.type === "button" && el.props.children === EXPLAIN.ask),
    card,
    empty,
    passage: empty ? null : ((card?.props.passage as string | undefined) ?? null),
    thread: card?.props.thread as ThreadView | undefined,
  };
};
/** One word per render: the empty state, a window with a passage, or no window. */
const kind = (l: Look) => (l.empty ? "empty" : l.card ? "window" : "none");

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
const click = (tree: ReactNode) => {
  const pressIt = (look(tree).button?.props.onClick as (() => void) | undefined) ?? (elements(tree).find((el) => el.type === ExplainCard)?.props.onExplain as (() => void) | undefined);
  if (!pressIt) throw new Error("no Explain this? control is standing");
  pressIt();
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
  ...over,
});

// ── The empty state leaves Escape alone ────────────────────────────────────────────────────────────

describe("Escape with the empty state showing (P8-06, the manager's ruling)", () => {
  it("registers no key and no press listener — only the window's width is watched", async () => {
    const run = await scenario(base(), []);

    expect(run.last().empty).toBe(true);
    expect(listening("keydown")).toBe(0);
    expect(listening("pointerdown")).toBe(0);
    expect(listening("resize")).toBe(1);
    run.mounted.unmount();
  });

  it("does nothing to the window: it stays, empty, with the width still reserved, and the event is left untouched", async () => {
    let event!: KeyEvent;
    const run = await scenario(base(), [() => void (event = press("Escape"))]);
    await wait();

    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  // Ruling §1h.51 (a), from A P8-05's finding F1: while the empty window stands (no thread open) the box does not consume
  // Escape, so the page's own handlers — the Keyboard-shortcuts dialog's close, a term highlight's clear — see that same
  // key and the dialog never needs a second press. The head already passed it through (the box registers its Escape only
  // while a passage is in the window: the two tests above and "registers its own Escape only while…" below); this pins
  // it for the empty window that carries the P9-03b control, which is what a selection on offer makes of it.
  it("P9-03b: the empty window that carries the control still leaves Escape to the page: no listener of the box's, the event untouched, the page's handlers each see it", async () => {
    const pageSaw = { documentCapture: vi.fn(), windowBubble: vi.fn() };
    let event!: KeyEvent;
    const run = await scenario(base({ target: first }), [
      (tree) => {
        // A selection is on offer, so the window shows the control…
        expect(look(tree).empty).toBe(true);
        expect(look(tree).card?.props.onExplain).toBeTypeOf("function");
        // …and the box has no key listener at all; two stand-ins for the page's: a dialog's (document, capture) and the keyboard layer's (window, bubble).
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
    // The window stays, empty, with the control and the width.
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(run.last().card?.props.onExplain).toBeTypeOf("function");
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("the figure lightbox: its own Escape closes it, and the window stays", async () => {
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
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("a term highlight: the real `useEscapeToClear` clears it, and the window stays", async () => {
    const clear = vi.fn();
    let event!: KeyEvent;
    const run = await scenario(base(), [() => void (event = press("Escape"))], () => useEscapeToClear(true, clear));
    await wait();

    expect(clear).toHaveBeenCalledTimes(1);
    // The highlight's own handler took the key (it prevents and stops it); the box added nothing to that.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(removeProperty).not.toHaveBeenCalled();
    run.mounted.unmount();
  });

  it("\"back\": the keyboard layer resolves Escape to the page's `back`, and the window stays", async () => {
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
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
    release();
  });

  it("a React `onKeyDown` handler such as the notes editor's: it runs, stops the key, and the window stays", async () => {
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
    expect(run.looks.every((l) => l.empty)).toBe(true);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    run.mounted.unmount();
    release();
  });
});

// ── With a thread showing, Escape returns the window to the empty state ────────────────────────────

describe("Escape with a passage in the window (P8-06, the manager's ruling)", () => {
  it("returns the window to the empty state, in place: the width stays reserved, nothing is taken off, the key goes no further", async () => {
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

    // Empty, then the passage, then empty again — never without a window.
    const kinds = run.looks.map(kind);
    expect(kinds[0]).toBe("empty");
    expect(kinds).toContain("window");
    expect(kinds[kinds.length - 1]).toBe("empty");
    expect(kinds).not.toContain("none");
    // The window's Escape goes no further, as it always did while it held a passage: "back" is not run.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(removeProperty).not.toHaveBeenCalled();
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(root)).toEqual(RESERVED);
    expect(scrollBy).not.toHaveBeenCalled();
    // …and the selection that stands is offered again — P9-03b (re-aimed): by the empty window's header control, not a
    // floating button.
    expect(run.last().card?.props.onExplain).toBeTypeOf("function");
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

    expect(run.last().empty).toBe(true);
    expect(events[0].stopPropagation).toHaveBeenCalledTimes(1);
    expect(events[1].stopPropagation).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(listening("keydown")).toBe(1 /* the stand-in for "back" alone */);
    run.mounted.unmount();
    release();
  });

  it("drops the thread as a Close used to — what was typed and the session's turns go — and the kept answer stays kept", async () => {
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
        // The empty state: no thread, no input.
        expect(look(tree).empty).toBe(true);
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

  it("Close, not Escape, is what hides the window — with a passage in it too — for the rest of the visit", async () => {
    const run = await scenario(base({ target: first }), [(tree) => click(tree), (tree) => close(tree)]);
    await wait();

    expect(run.last().card).toBeUndefined();
    expect(run.last().button).toBeDefined();
    expect(Object.fromEntries(root)).toEqual({});
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock");
    expect(removeProperty).toHaveBeenCalledWith("--explain-dock-width");
    expect(listening("keydown")).toBe(0);
    run.mounted.unmount();
  });
});

// ── Where no empty state stands behind the window, Escape closes it as it always did ───────────────

describe("Escape where no empty state stands (unchanged)", () => {
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

  it("the card (640 to 1023 px): closes, with no window behind it", async () => {
    stubWindow(900, 800);
    const run = await scenario(base({ target: first }), [(tree) => click(tree), () => press("Escape")]);
    await wait();

    expect(run.looks.some((l) => l.card)).toBe(true);
    expect(run.last().card).toBeUndefined();
    expect(Object.fromEntries(root)).toEqual({});
    run.mounted.unmount();
  });

  it("the sheet (under 640 px): closes, with no window behind it (re-aimed, P9-41: opened by the thumb bar's cell — the page's `explain` action, the box's `openRef` — not a floating pill)", async () => {
    stubWindow(390, 844);
    const openRef = { current: null as (() => void) | null };
    const run = await scenario(base({ target: first, openRef }), [() => openRef.current?.(), () => press("Escape")]);
    await wait();

    expect(run.last().card).toBeUndefined();
    run.mounted.unmount();
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

  it("the term highlight's hook is the one this file mounts: a capture listener on the document", () => {
    expect(read("src/components/reader/terms-strip.tsx")).toContain('document.addEventListener("keydown", onKeyDown, true)');
  });

  it("the notes editor's Escape is a React handler that stops the key itself", () => {
    const source = read("src/components/notes/note-editor.tsx");

    expect(source).toMatch(/if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\);/);
  });

  it("the box registers its own Escape only while a passage is in the window: one effect, gated on it", () => {
    const source = read("src/components/reader/explain-box.tsx");

    expect(source).toContain("const isOpen = open !== null; useEffect(() => { if (!isOpen) return; const onKeyDown");
    expect(source).not.toContain("setHidden(true); }; const onPointerDown");
  });
});
