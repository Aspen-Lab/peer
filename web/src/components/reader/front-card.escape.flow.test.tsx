import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17c rule 1 (C P11-15 "For the manager" 1; owner item 1): one Escape closes exactly one card — the front one. The four cards of the
// margin's stack that answer Escape — the explain card, a sticky, the notes window and the figure — are mounted TOGETHER here, each as the
// page mounts it (`ExplainBox`, `StickyNotes`, `NotesWindow`, `FigureHost`: one render, one stack, the real stores), and the keys are
// pressed in the browser's order: the document's bubble listeners in the order they were registered, then the window's — where the
// keyboard layer's "back to the briefing" stands — unless one of them stopped the key. For each kind in front with the other three behind:
// one Escape closes that card and only it, the next closes the card that is the front now, the page's back never runs while a card is open,
// and it runs for the Escape after the last. A card takes the key wherever the focus is (the document recorder has no focus at all).
// The components run on the staged hook runtime (no DOM in this suite), the stores are read the way React reads them. Invented text.
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
import { NOTES_WINDOW_ID, useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { NotesWindow } from "@/components/notes/notes-window";
import { StickyNotes, takeStickyNote } from "@/components/notes/sticky-note";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { Paper } from "@/types";
import { ExplainBox, type AskResult } from "./explain-box";
import { FigureHost } from "./figure-host";
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
const target: ExplainSelection = {
  sectionIndex: 0,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};

// ── The browser's order for a key press, in miniature ──────────────────────────────────────────────

interface KeyEvent {
  key: string;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}
type Listener = (event: KeyEvent) => void;
let onDocument: Listener[];
let onWindow: Listener[];
let modal: unknown;
let back: number;

function node(list: () => Listener[], replace: (next: Listener[]) => void) {
  return {
    addEventListener: (type: string, fn: Listener) => {
      if (type === "keydown") replace([...list(), fn]);
    },
    removeEventListener: (type: string, fn: Listener) => {
      if (type === "keydown") replace(list().filter((one) => one !== fn));
    },
  };
}

/** Press Escape: the document's listeners all run (a stop holds back the window, not a neighbour); then the window's, "back" among them. */
function press(): KeyEvent {
  const event: KeyEvent = {
    key: "Escape",
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  stagedRuntime.event(() => {
    for (const fn of [...onDocument]) fn(event);
    if (!event.stopped) for (const fn of [...onWindow]) fn(event);
  });
  settle();
  return event;
}

/** A render and a layout effect's update each render again before the paint; the staged runtime renders once per event. */
function settle() {
  for (let i = 0; i < 4; i += 1) stagedRuntime.event(() => {});
}

function stubPage() {
  onDocument = [];
  onWindow = [];
  modal = null;
  back = 0;
  vi.stubGlobal("document", {
    ...node(() => onDocument, (next) => void (onDocument = next)),
    querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? modal : null),
    documentElement: { style: { setProperty: () => {}, removeProperty: () => {} } },
    activeElement: null,
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
  // The keyboard layer: a window listener in the bubble phase; Escape is "back to the briefing".
  window.addEventListener("keydown", ((event: KeyEvent) => {
    if (event.key === "Escape") back += 1;
  }) as never);
}

// ── The page ───────────────────────────────────────────────────────────────────────────────────────

type Kind = "sticky" | "notes" | "explain" | "figure";
const KINDS: readonly Kind[] = ["sticky", "notes", "explain", "figure"];

let openExplain: { current: (() => void) | null };
let showNotes: (shown: boolean) => void;
let notesClosed: number;

function Page() {
  const [notes, setNotes] = useState(false);
  showNotes = setNotes;
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
  // The notes window is mounted by the page's button, and closed by its parent: the parent's close is the window leaving the stack.
  if (notes) {
    NotesWindow({
      paper: PAPER,
      onClose: () => {
        notesClosed += 1;
        useWindows.getState().close(NOTES_WINDOW_ID);
      },
    });
  }
  return null;
}

let mounted: { unmount: () => void };
const stickyId = () => useWindows.getState().windows.find((w) => w.kind === "sticky")?.id;

/** Which of the four stand in the stack now, in the order they were opened. */
function standing(): Kind[] {
  const list: Kind[] = [];
  for (const w of useWindows.getState().windows) list.push(w.kind as Kind);
  return list;
}

function open(kind: Kind) {
  stagedRuntime.event(() => {
    if (kind === "sticky") takeStickyNote({ sectionIndex: 0, paragraphIndex: 0, passage: "Hot parts creep." }, citableFromPaper(PAPER));
    else if (kind === "notes") showNotes(true);
    else if (kind === "explain") openExplain.current?.();
    else
      openFigure({ key: "Figure 1:1", src: "/api/figure/p1/1", label: "Figure 1", caption: "Invented caption.", natural: { width: 600, height: 400 }, origin: null });
  });
  stagedRuntime.flush();
  settle();
}

beforeEach(() => {
  stubPage();
  closeFigure();
  openExplain = { current: null };
  notesClosed = 0;
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
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useNotesStore.setState({ notes: {} });
});

describe("the four cards are mounted together, each as the page mounts it", () => {
  it("opens each into the one stack, the last opened in front, and the note holds the sticky's heading", () => {
    for (const kind of KINDS) open(kind);
    expect(standing()).toEqual(["sticky", "notes", "explain", "figure"]);
    expect(readingNoteFor(useNotesStore.getState().notes, PAPER.id)?.blocks.some((b) => b.id === stickyId() && b.type === "h3")).toBe(true);
    expect(getOpenFigure()).not.toBeNull();
  });
});

describe("one Escape closes exactly one card — the front one — wherever the focus is", () => {
  for (const front of KINDS) {
    it(`${front} in front, the other three behind: it goes first, then each new front in turn; the page's back runs only after the last`, () => {
      // The three behind open first, in the order of KINDS; the front kind last.
      const behind = KINDS.filter((kind) => kind !== front);
      for (const kind of [...behind, front]) open(kind);
      expect(standing()).toEqual([...behind, front]);

      // The cards in the order they should leave: the front, then the latest of the others, and so on.
      const leaving = [front, ...[...behind].reverse()];
      let stillOpen = [...behind, front];
      for (const kind of leaving) {
        const event = press();
        stillOpen = stillOpen.filter((one) => one !== kind);
        expect(standing(), `after the Escape that closes ${kind}`).toEqual(stillOpen);
        expect(event.defaultPrevented, `${kind}: the key is taken`).toBe(true);
        expect(event.stopped, `${kind}: and goes no further`).toBe(true);
        expect(back, "the page's back does not run while a card is open").toBe(0);
      }
      expect(getOpenFigure()).toBeNull();
      expect(notesClosed).toBe(front === "notes" || behind.includes("notes") ? 1 : 0);

      // Nothing is open: the next Escape is the page's.
      const last = press();
      expect(last.defaultPrevented).toBe(false);
      expect(back).toBe(1);
    });
  }

  it("with a sticky in front and the figure and Explain behind, the first Escape closes the sticky — not Explain, a card the reader cannot see answering", () => {
    open("explain");
    open("figure");
    open("sticky");
    press();
    expect(standing()).toEqual(["explain", "figure"]);
    expect(getOpenFigure()).not.toBeNull();
  });

  it("leaves a key something handled already, and a modal dialog over the page — whichever card is in front", () => {
    for (const front of KINDS) {
      const behind = KINDS.filter((kind) => kind !== front);
      for (const kind of [...behind, front]) open(kind);
      const before = standing();
      modal = {};
      const underModal = press();
      expect(underModal.defaultPrevented, `${front} in front, a modal over the page`).toBe(false);
      expect(standing()).toEqual(before);
      modal = null;
      // A key handled before it reached the document (a control's own Escape): the first listener finds it handled, as every other.
      const handled: KeyEvent = { key: "Escape", defaultPrevented: true, stopped: false, preventDefault() {}, stopPropagation() {} };
      stagedRuntime.event(() => {
        for (const fn of [...onDocument]) fn(handled);
      });
      settle();
      expect(standing(), `${front} in front, a handled key`).toEqual(before);
      // Clear the page for the next kind.
      for (let i = 0; i < 8 && standing().length > 0; i += 1) press();
      expect(getOpenFigure()).toBeNull();
      back = 0;
    }
  });
});
