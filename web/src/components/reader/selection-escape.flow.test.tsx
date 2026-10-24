import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-40 (round 2, Theme B weighed (b); ruling §1h.138 (c)): Escape does one thing at a time, nearest first. A selection standing with its buttons is put away
// first — the selection ends and the buttons go, nothing else; then the front card closes, one Escape one card (P11-17c); and only when neither is there does
// Escape leave the paper for the briefing, as the legend says ("Esc BACK"). The round-2 walk (`x32-escape-selection-*.json`) found the reader who pressed
// Escape to put the buttons away on the briefing, and, after Escape had closed the Explain card, a second Escape with the selection still standing leaving too.
//
// The pieces are mounted TOGETHER, as the page mounts them: the Explain card, the stickies and the figure card (`ExplainBox`, `StickyNotes`, `FigureHost`: one
// render, one stack, the real stores), the highlight strip's Escape (`takeStripEscape`, a document listener from the moment its host mounts), the selection's
// Escape (`useSelectionEscape`, with the closures the page hands it: a selection stands while the page holds one, and putting it away is letting go of it), and,
// as the stand-in of the keyboard layer, the window's "back" — Escape unless a field is focused (it blurs the field), Backspace unless typed into a field. The
// keys are pressed in the browser's order for a key press: window capture, document capture, the React root's bubble, document bubble, window bubble; a stop holds
// back the later nodes and not a neighbour on the same node. The components run on the staged hook runtime (no DOM in this suite). Invented text.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  const hooks = stagedRuntime.hooks;
  return {
    ...actual,
    ...hooks,
    // The runtime has no useSyncExternalStore: the snapshot is read at render and a change renders again.
    useSyncExternalStore<T>(subscribe: (notify: () => void) => () => void, getSnapshot: () => T): T {
      const [, bump] = hooks.useState(0);
      hooks.useEffect(() => subscribe(() => bump((n: number) => n + 1)), [subscribe]);
      return getSnapshot();
    },
  };
});

// zustand is an external module that imports the real React, which has no dispatcher on this runtime: its stores are made again with the
// same state and the same API, and a hook that reads them through the stand-in `useSyncExternalStore` above.
vi.mock("zustand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand")>();
  const { useSyncExternalStore } = await import("react");
  const make = (initializer: never) => {
    const store = actual.createStore(initializer);
    const useBound = (selector: (state: unknown) => unknown = (state) => state) =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getInitialState()));
    return Object.assign(useBound, store);
  };
  return { ...actual, create: (initializer?: never) => (initializer ? make(initializer) : make) };
});

import { useState } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { citableFromPaper } from "@/lib/notes/cite";
import { closeFigure, getOpenFigure, openFigure } from "@/lib/reader/figure-viewer";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { useNotesStore } from "@/store/notes";
import { useHighlightStrip } from "@/components/notes/highlight-strip";
import { takeStripEscape } from "@/components/notes/highlight-strip-host";
import { StickyNotes, takeStickyNote } from "@/components/notes/sticky-note";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { ExplainBox, type AskResult } from "./explain-box";
import { FigureHost } from "./figure-host";
import { takeFrontEscape, useSelectionEscape } from "./front-escape";
import type { ExplainSelection } from "./paper-body";

const MARGIN: MarginRect = { left: 1000, width: 400, top: 48, bottom: 860 };
const PAPER: Paper = {
  id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw.", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const reading = {
  body: [{ id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep.", "We define the rafting ratio."] }],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;
const TARGET: ExplainSelection = {
  sectionIndex: 0,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};

// ── The browser's order for a key press, in miniature ──────────────────────────────────────────────

interface Field {
  tagName: string;
  isContentEditable?: boolean;
}
interface KeyEvent {
  key: string;
  target: Field | null;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}
type Listener = (event: KeyEvent) => void;
interface Registration {
  fn: Listener;
  capture: boolean;
}
let onWindow: Registration[];
let onDocument: Registration[];
let modal: unknown;
let focus: Field | null;
let back: number;
let blurred: number;

const isCapture = (options: unknown) => options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
function node(list: () => Registration[], replace: (next: Registration[]) => void) {
  return {
    addEventListener: (type: string, fn: Listener, options?: unknown) => {
      if (type === "keydown") replace([...list(), { fn, capture: isCapture(options) }]);
    },
    removeEventListener: (type: string, fn: Listener, options?: unknown) => {
      if (type === "keydown") replace(list().filter((one) => !(one.fn === fn && one.capture === isCapture(options))));
    },
  };
}

/** Press `key` with the focus where `focus` says: window capture, document capture, document bubble, window bubble. A stop holds back the later nodes only. */
function press(key = "Escape"): KeyEvent {
  const event: KeyEvent = {
    key,
    target: focus,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  const stages: Array<() => Listener[]> = [
    () => onWindow.filter((one) => one.capture).map((one) => one.fn),
    () => onDocument.filter((one) => one.capture).map((one) => one.fn),
    () => onDocument.filter((one) => !one.capture).map((one) => one.fn),
    () => onWindow.filter((one) => !one.capture).map((one) => one.fn),
  ];
  stagedRuntime.event(() => {
    for (const stage of stages) {
      if (event.stopped) break;
      for (const fn of stage()) fn(event);
    }
  });
  settle();
  return event;
}

/** A render and a layout effect's update each render again before the paint; the staged runtime renders once per event. */
function settle() {
  for (let i = 0; i < 4; i += 1) stagedRuntime.event(() => {});
}

const isField = (el: Field | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true);

function stubPage() {
  onDocument = [];
  onWindow = [];
  modal = null;
  focus = null;
  back = 0;
  blurred = 0;
  vi.stubGlobal("document", {
    ...node(() => onDocument, (next) => void (onDocument = next)),
    querySelector: (selector: string) =>
      selector === '[aria-modal="true"]' ? modal : selector === "[data-highlight-strip]" ? (useHighlightStrip.getState().id !== null ? {} : null) : null,
    documentElement: { style: { setProperty: () => {}, removeProperty: () => {} } },
    get activeElement() {
      return focus;
    },
    body: {},
  });
  vi.stubGlobal("window", {
    ...node(() => onWindow, (next) => void (onWindow = next)),
    innerWidth: 1440,
    innerHeight: 900,
    location: { hash: "", pathname: "/papers/x" },
    scrollBy: () => {},
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  // The highlight host's Escape, from the moment it mounts: the first of the document's bubble listeners (`highlight-strip-host.tsx`).
  document.addEventListener("keydown", ((event: KeyEvent) => void takeStripEscape(event, document)) as never);
  // The keyboard layer (`keyboard.tsx`): a window listener in the bubble phase. Escape blurs a field that has the focus, else it is "back to the briefing";
  // Backspace is "back" unless it is typed into a field.
  window.addEventListener("keydown", ((event: KeyEvent) => {
    if (event.key === "Escape") {
      if (isField(focus)) blurred += 1;
      else back += 1;
    } else if (event.key === "Backspace" && !isField(event.target)) back += 1;
  }) as never);
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────────

type Kind = "sticky" | "explain" | "figure";

let openExplain: { current: (() => void) | null };
/** The page's hold on the selection (`explainTarget`), and the times it was asked to let go of the document's selection. */
let hold: (next: ExplainSelection | null) => void;
let held: ExplainSelection | null;
let letGo: number;

function Page() {
  const [target, setTarget] = useState<ExplainSelection | null>(TARGET);
  hold = setTarget;
  held = target;
  ExplainBox({
    target,
    terms: [],
    canAsk: true,
    onAsk: vi.fn(async (): Promise<AskResult> => ANSWER),
    cached: ANSWER,
    cachedTurns: [],
    reading,
    openRef: openExplain,
  });
  StickyNotes({ paper: PAPER, reveal: (run: () => void) => run() });
  FigureHost();
  // What the page hands the hook: a selection stands while the page holds one; putting it away lets go of the document's and of the page's hold.
  useSelectionEscape({
    standing: () => target !== null,
    end: () => {
      letGo += 1;
      setTarget(null);
    },
  });
  return null;
}

let mounted: { unmount: () => void };
const cards = (): Kind[] => useWindows.getState().windows.map((w) => w.kind as Kind);
const selecting = () => held !== null;

function open(kind: Kind) {
  stagedRuntime.event(() => {
    if (kind === "sticky") takeStickyNote({ sectionIndex: 0, paragraphIndex: 0, passage: "Hot parts creep." }, citableFromPaper(PAPER));
    else if (kind === "explain") openExplain.current?.();
    else openFigure({ key: "Figure 1:1", src: "/api/figure/p1/1", label: "Figure 1", caption: "Invented caption.", natural: { width: 600, height: 400 }, origin: null });
  });
  stagedRuntime.flush();
  settle();
}
/** The reader selects words again: the page holds a new selection. */
function select() {
  stagedRuntime.event(() => hold({ ...TARGET }));
  settle();
}

beforeEach(() => {
  stubPage();
  closeFigure();
  useHighlightStrip.getState().hide();
  openExplain = { current: null };
  letGo = 0;
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
  useNotesStore.setState({ notes: {} });
  useNotesStore.getState().ensureReadingNote(citableFromPaper(PAPER));
  mounted = stagedRuntime.mount(Page);
  stagedRuntime.flush();
  settle();
});
afterEach(() => {
  mounted.unmount();
  closeFigure();
  useHighlightStrip.getState().hide();
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useNotesStore.setState({ notes: {} });
});

describe("Escape puts the selection away first, then the cards, then leaves the paper", () => {
  it("a selection and its buttons, no card: the first Escape ends the selection and stays on the paper; the second leaves", () => {
    expect(selecting()).toBe(true);
    const first = press();
    expect(selecting(), "the selection has ended").toBe(false);
    expect(letGo, "the document's selection was let go of once").toBe(1);
    expect(first.defaultPrevented, "the key is taken").toBe(true);
    expect(first.stopped, "and goes no further").toBe(true);
    expect(back, "the page stays").toBe(0);
    const second = press();
    expect(second.defaultPrevented).toBe(false);
    expect(back, "with nothing left, Escape is the page's back").toBe(1);
  });

  it("a selection and the Explain card: the selection, then the card, then the briefing", () => {
    open("explain");
    expect(cards()).toEqual(["explain"]);
    press();
    expect(selecting(), "Escape 1: the selection ends").toBe(false);
    expect(cards(), "Escape 1: the card stays").toEqual(["explain"]);
    expect(back).toBe(0);
    press();
    expect(cards(), "Escape 2: the card closes").toEqual([]);
    expect(back).toBe(0);
    press();
    expect(back, "Escape 3: the briefing").toBe(1);
  });

  it("a selection over a stack of three cards: the selection first, then one card per Escape — the front one — then the briefing", () => {
    for (const kind of ["explain", "figure", "sticky"] as const) open(kind);
    expect(cards()).toEqual(["explain", "figure", "sticky"]);
    press();
    expect(selecting()).toBe(false);
    expect(cards(), "no card closed by the first").toEqual(["explain", "figure", "sticky"]);
    press();
    expect(cards(), "the front card, the sticky").toEqual(["explain", "figure"]);
    press();
    expect(cards(), "then the figure").toEqual(["explain"]);
    expect(getOpenFigure()).toBeNull();
    press();
    expect(cards()).toEqual([]);
    expect(back).toBe(0);
    press();
    expect(back).toBe(1);
  });

  it("a selection made again is put away again: the step is not used up by the first", () => {
    open("explain");
    press();
    expect(selecting()).toBe(false);
    select();
    expect(selecting()).toBe(true);
    press();
    expect(selecting(), "the new selection ends").toBe(false);
    expect(cards(), "and the card is still there").toEqual(["explain"]);
    expect(letGo).toBe(2);
    expect(back).toBe(0);
  });

  it("with no selection the cards and the briefing go as they did: one card per Escape, then back", () => {
    open("explain");
    open("sticky");
    stagedRuntime.event(() => hold(null));
    settle();
    expect(selecting()).toBe(false);
    press();
    expect(cards()).toEqual(["explain"]);
    press();
    expect(cards()).toEqual([]);
    expect(back).toBe(0);
    press();
    expect(back).toBe(1);
    expect(letGo, "a selection that is not there is not let go of").toBe(0);
  });

  it("the highlight's strip goes before a card, and a card before the briefing, as before", () => {
    open("explain");
    stagedRuntime.event(() => hold(null));
    settle();
    useHighlightStrip.getState().show("h1", 300);
    press();
    expect(useHighlightStrip.getState().id, "Escape 1: the strip").toBeNull();
    expect(cards()).toEqual(["explain"]);
    press();
    expect(cards(), "Escape 2: the card").toEqual([]);
    expect(back).toBe(0);
    press();
    expect(back, "Escape 3: the briefing").toBe(1);
  });
});

describe("a field keeps its own Escape; Backspace keeps its own meaning", () => {
  it("Escape typed into the Explain card's input is the card's: it closes, the selection stands, the page stays", () => {
    open("explain");
    focus = { tagName: "TEXTAREA" };
    const event = press();
    expect(cards(), "the card closed").toEqual([]);
    expect(selecting(), "the selection was not touched").toBe(true);
    expect(letGo).toBe(0);
    expect(event.defaultPrevented).toBe(true);
    expect(back).toBe(0);
    expect(blurred).toBe(0);
  });

  it("Escape typed into a field of the page (the question box, a sticky's editor, the notes editor) is the field's: the selection stands, the page stays", () => {
    for (const field of [{ tagName: "TEXTAREA" }, { tagName: "INPUT" }, { tagName: "DIV", isContentEditable: true }]) {
      focus = field;
      blurred = 0;
      press();
      expect(selecting(), field.tagName).toBe(true);
      expect(letGo).toBe(0);
      expect(blurred, `${field.tagName}: the keyboard layer blurs the field`).toBe(1);
      expect(back).toBe(0);
    }
  });

  it("Backspace is back, with a selection standing or not; the selection is not what it ends", () => {
    open("explain");
    const event = press("Backspace");
    expect(back).toBe(1);
    expect(event.defaultPrevented).toBe(false);
    expect(letGo).toBe(0);
    expect(cards()).toEqual(["explain"]);
  });

  it("Backspace typed into a field is the field's", () => {
    focus = { tagName: "DIV", isContentEditable: true };
    press("Backspace");
    expect(back).toBe(0);
    expect(selecting()).toBe(true);
  });

  it("a modal dialog over the page keeps its Escape: the selection stands and the key is not taken", () => {
    modal = {};
    const event = press();
    expect(event.defaultPrevented).toBe(false);
    expect(selecting()).toBe(true);
    expect(letGo).toBe(0);
  });

  it("a key something handled already is not taken a second time", () => {
    const handled: KeyEvent = { key: "Escape", target: null, defaultPrevented: true, stopped: false, preventDefault() {}, stopPropagation() {} };
    stagedRuntime.event(() => {
      for (const one of onDocument.filter((r) => r.capture)) one.fn(handled);
    });
    settle();
    expect(selecting()).toBe(true);
    expect(letGo).toBe(0);
  });
});

describe("the listener stands in the capture phase, so no order of registration puts a card before the selection", () => {
  it("a card whose Escape listener was registered before the selection's hook is still answered second", () => {
    // A card mounted before the page's hook (the strip's host and the figure's stand on the document from the moment they mount): its listener is the
    // first of the document's bubble listeners, and the page's hook is registered after it.
    mounted.unmount();
    document.addEventListener("keydown", ((event: KeyEvent) => void takeFrontEscape(event, document, { kind: "sticky" }, (id) => useWindows.getState().close(id))) as never);
    mounted = stagedRuntime.mount(Page);
    stagedRuntime.flush();
    settle();
    open("sticky");
    expect(cards()).toEqual(["sticky"]);
    press();
    expect(selecting(), "the selection ended first").toBe(false);
    expect(cards(), "the card stayed").toEqual(["sticky"]);
    press();
    expect(cards(), "then the card").toEqual([]);
    expect(back).toBe(0);
  });
});
