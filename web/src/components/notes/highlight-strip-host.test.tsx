import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17b rule 2 (owner item 8; B P11-04 §5; ruling §1h.112 D3): the margin's host of the highlight's colour strip. While `useHighlightStrip` names a
// highlight and the page has a margin it stands the strip at the mark's first line NOW (re-read on scroll and on resize, one animation frame
// each, so the strip is level with its mark), goes when the mark is more than a screen away or gone, stands clear of an open card the way the
// selection's three actions do (O-2), takes the Escape that hides it (the page's own Escape is "back to the briefing"), and goes with the paper.
// The host runs on the staged hook runtime (no DOM in this suite); `document` and `window` are recorders, the mark is a box the test moves.
// The strip itself is tested where it stands (`highlight-strip.test.tsx`). Every text is invented.
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

import type { ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { useMarginStore, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { citableFromPaper } from "@/lib/notes/cite";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import type { ViewRect } from "@/components/reader/paper-body";
import { CARD_SLACK_PX, MARGIN_INSET_PX, MODE_HYSTERESIS_PX } from "@/components/reader/selection-toolbar";
import type { Paper } from "@/types";
import { HighlightStrip, useHighlightStrip } from "./highlight-strip";
import {
  AWAY_SCREENS,
  HighlightStripHost,
  STRIP_ONE_ROW_WIDTH_PX,
  STRIP_ROW_PX,
  STRIP_TWO_ROWS_PX,
  markLine,
  stripStanding,
  takeStripEscape,
} from "./highlight-strip-host";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const HOST = read("src/components/notes/highlight-strip-host.tsx");
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;
/** The margin a shell would register: 280 px wide at the right, the masthead's foot down to the legend's strip. */
const MARGIN: MarginRect = { left: 1000, width: 280, top: 48, bottom: 860 };
const VIEW = { width: 1440, height: 900 };
const line = (top: number, left = 400): ViewRect => ({ left, top, right: left + 300, bottom: top + 18 });
const card = (top: number, bottom: number, left = 1000, right = 1280): ViewRect => ({ left, top, right, bottom });

// ── The pure parts ─────────────────────────────────────────────────────────

describe("stripStanding — where the strip stands, and whether it stays", () => {
  it("stands in the margin 8 px in from its left edge, level with the mark's first line, as wide as the margin less its insets", () => {
    expect(MARGIN_INSET_PX).toBe(8);
    expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [] })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
  });

  it("holds inside the band: never above the masthead's foot, nor with its foot below the legend's strip", () => {
    expect(STRIP_ROW_PX).toBe(34);
    expect(stripStanding({ mark: line(10), viewport: VIEW, margin: MARGIN, cards: [] })?.top).toBe(48);
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: MARGIN, cards: [] })?.top).toBe(860 - STRIP_ROW_PX);
  });

  it("wraps to two rows in a narrow margin, and holds those two rows inside the band", () => {
    expect(STRIP_TWO_ROWS_PX).toBe(58);
    const narrow: MarginRect = { ...MARGIN, width: 160 };
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: narrow, cards: [] })).toMatchObject({ mode: "margin", left: 1008, top: 860 - STRIP_TWO_ROWS_PX, width: 144 });
    // One row from the width that holds the six colours and the remove button on one line.
    const wide: MarginRect = { ...MARGIN, width: STRIP_ONE_ROW_WIDTH_PX + 2 * MARGIN_INSET_PX };
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: wide, cards: [] })?.top).toBe(860 - STRIP_ROW_PX);
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: { ...wide, width: wide.width - 1 }, cards: [] })?.top).toBe(860 - STRIP_TWO_ROWS_PX);
  });

  it("goes when the mark is more than a screen away, above or below, and stays up to that distance (held at the band's edge)", () => {
    expect(AWAY_SCREENS).toBe(1);
    // Wholly above the window by more than its height: gone. By less: held at the band's top.
    expect(stripStanding({ mark: { left: 400, top: -1000, right: 700, bottom: -982 }, viewport: VIEW, margin: MARGIN, cards: [] })).toBeNull();
    expect(stripStanding({ mark: { left: 400, top: -917, right: 700, bottom: -899 }, viewport: VIEW, margin: MARGIN, cards: [] })).toMatchObject({ mode: "margin", top: 48 });
    // Below the window by more than its height: gone. By less: held at the band's foot.
    expect(stripStanding({ mark: line(1801), viewport: VIEW, margin: MARGIN, cards: [] })).toBeNull();
    expect(stripStanding({ mark: line(1799), viewport: VIEW, margin: MARGIN, cards: [] })).toMatchObject({ mode: "margin", top: 860 - STRIP_ROW_PX });
  });

  describe("an open card covers the place (O-2: the rule the selection's actions follow)", () => {
    it("stands above the mark's first line, as the pill did, left-aligned with it", () => {
      const placed = stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [card(280, 600)] });
      expect(placed).toMatchObject({ mode: "above", left: 400, top: 300 - STRIP_ROW_PX - 6 });
    });

    it("keeps the margin when the card stands 4 px or more clear of the strip, and leaves it when it comes closer", () => {
      expect(CARD_SLACK_PX).toBe(4);
      const bottom = 300 + STRIP_ROW_PX;
      expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [card(bottom + CARD_SLACK_PX, 800)] })?.mode).toBe("margin");
      expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [card(bottom + CARD_SLACK_PX - 1, 800)] })?.mode).toBe("above");
    });

    it("returns to the margin only when the card is 12 px further clear (no flicker at a card's edge)", () => {
      expect(MODE_HYSTERESIS_PX).toBe(12);
      const bottom = 300 + STRIP_ROW_PX;
      const edge = card(bottom + CARD_SLACK_PX, 800);
      expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [edge], mode: "above" })?.mode).toBe("above");
      const clear = card(bottom + CARD_SLACK_PX + MODE_HYSTERESIS_PX, 800);
      expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [clear], mode: "above" })?.mode).toBe("margin");
      expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN, cards: [clear], mode: "margin" })?.mode).toBe("margin");
    });

    it("has nowhere to stand above a mark that has left the window: it goes", () => {
      const gone = stripStanding({ mark: { left: 400, top: -60, right: 700, bottom: -42 }, viewport: VIEW, margin: MARGIN, cards: [card(40, 200)] });
      expect(gone).toBeNull();
    });
  });
});

describe("markLine — the first line of a highlight's mark, read now", () => {
  const box = (top: number): ViewRect => ({ left: 100, top, right: 220, bottom: top + 18 });
  const docOf = (found: unknown) => {
    const asked: string[] = [];
    return { asked, doc: { querySelector: (selector: string) => (asked.push(selector), found) } as unknown as Pick<Document, "querySelector"> };
  };

  it("asks for the highlight's own mark and its nested parts by block id, and reads the first client rect", () => {
    const { asked, doc } = docOf({ getClientRects: () => [box(300), box(318)], getBoundingClientRect: () => ({ left: 100, top: 300, right: 400, bottom: 336 }) });
    expect(markLine(doc, "h1")).toEqual(box(300));
    expect(asked).toEqual(['mark[data-highlight="h1"], mark[data-highlight-part="h1"]']);
  });

  it("falls back on the bounding box where the mark reports no line boxes, and is null with no mark on the page", () => {
    const { doc } = docOf({ getClientRects: () => [], getBoundingClientRect: () => box(40) });
    expect(markLine(doc, "h1")).toEqual(box(40));
    expect(markLine(docOf(null).doc, "h1")).toBeNull();
  });

  it("copies the numbers: the strip never holds the live rect", () => {
    const live = { left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2, x: 1, y: 2 };
    const { doc } = docOf({ getClientRects: () => [live], getBoundingClientRect: () => live });
    expect(markLine(doc, "h1")).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
  });
});

describe("takeStripEscape — the Escape that hides the strip", () => {
  const escape = (over: Record<string, unknown> = {}) => ({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });
  const page = (over: { strip?: boolean; modal?: boolean } = {}) => ({
    querySelector: (selector: string) => (selector === "[data-highlight-strip]" ? (over.strip === false ? null : {}) : selector === '[aria-modal="true"]' && over.modal ? {} : null),
  });

  beforeEach(() => useHighlightStrip.setState({ id: "h1", top: 300 }));
  afterEach(() => useHighlightStrip.setState({ id: null, top: 0 }));

  it("hides the strip and takes the key, so the page's back never sees it", () => {
    const event = escape();
    expect(takeStripEscape(event, page())).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(useHighlightStrip.getState().id).toBeNull();
  });

  it("leaves the key when no strip stands, when it was handled already, when a modal dialog is over the page, and for every other key", () => {
    for (const [name, event, doc] of [
      ["no strip", escape(), page({ strip: false })],
      ["handled", escape({ defaultPrevented: true }), page()],
      ["modal", escape(), page({ modal: true })],
      ["another key", escape({ key: "Enter" }), page()],
    ] as const) {
      expect(takeStripEscape(event, doc), name).toBe(false);
      expect(event.preventDefault, name).not.toHaveBeenCalled();
      expect(useHighlightStrip.getState().id, name).toBe("h1");
    }
  });
});

// ── The host ───────────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;
let docListeners: Map<string, Set<Listener>>;
let winListeners: Map<string, Set<Listener>>;
let frames: Array<(time: number) => void>;
let askedFrames: number;
let mark: ViewRect | null;
let cards: ViewRect[];
let stripThere: boolean;
const fire = (map: Map<string, Set<Listener>>, type: string, event?: unknown) => [...(map.get(type) ?? [])].forEach((one) => one(event));

function stubPage() {
  docListeners = new Map();
  winListeners = new Map();
  frames = [];
  askedFrames = 0;
  mark = null;
  cards = [];
  stripThere = false;
  const track = (map: Map<string, Set<Listener>>) => ({
    addEventListener: (type: string, fn: Listener) => void map.set(type, (map.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: Listener) => void map.get(type)?.delete(fn),
  });
  vi.stubGlobal("document", {
    ...track(docListeners),
    documentElement: {},
    querySelector: (selector: string) => {
      if (selector.startsWith("mark[data-highlight")) return mark ? { getClientRects: () => [mark], getBoundingClientRect: () => mark } : null;
      if (selector === "[data-highlight-strip]") return stripThere ? {} : null;
      return null;
    },
    querySelectorAll: () =>
      cards.map((one) => ({ getBoundingClientRect: () => ({ ...one, width: one.right - one.left, height: one.bottom - one.top }) })),
  });
  vi.stubGlobal("window", {
    ...track(winListeners),
    innerWidth: VIEW.width,
    innerHeight: VIEW.height,
    requestAnimationFrame: (cb: (time: number) => void) => {
      askedFrames += 1;
      frames.push(cb);
      return askedFrames;
    },
    cancelAnimationFrame: (handle: number) => void handle,
  });
}

/** React's renders after a change nothing discrete started: the staged runtime renders once per event. */
function settle() {
  for (let i = 0; i < 4; i += 1) stagedRuntime.event(() => {});
}

/** One animation frame: the callbacks asked for so far, inside one discrete event, then React's renders. */
function frame() {
  const run = frames.splice(0);
  stagedRuntime.event(() => run.forEach((cb) => cb(0)));
  settle();
}

function mountHost(paperId = "p1") {
  const mounted = stagedRuntime.mount(() => HighlightStripHost({ paperId }));
  stagedRuntime.flush();
  settle();
  return {
    get tree(): ReactElement | null {
      return mounted.value as ReactElement | null;
    },
    get props(): { noteId: string; blockId: string; top: number; left: number; width: number } {
      return (mounted.value as ReactElement).props as never;
    },
    /** A discrete event: the handler, then React's renders. */
    act(handler: () => void) {
      stagedRuntime.event(handler);
      settle();
    },
    unmount: () => mounted.unmount(),
  };
}

let noteId: string;
beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  noteId = useNotesStore.getState().ensureReadingNote(citableFromPaper(PAPER));
  useHighlightStrip.setState({ id: null, top: 0 });
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useMarginStore.setState({ rect: MARGIN });
  stubPage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useMarginStore.setState({ rect: null });
  useHighlightStrip.setState({ id: null, top: 0 });
  useWindows.setState({ windows: [], clock: 0, origin: null });
});

describe("HighlightStripHost — raising the strip", () => {
  it("draws nothing until a highlight names the strip", () => {
    const host = mountHost();
    expect(host.tree).toBeNull();
  });

  it("stands the strip for the highlight in the paper's note, in the margin's frame, level with the mark's first line", () => {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.tree?.type).toBe(HighlightStrip);
    expect(host.props).toEqual({ noteId: expect.any(String), blockId: "h1", top: 300, left: 1008, width: 264 });
    expect(host.props.noteId).toBe(readingNoteFor(useNotesStore.getState().notes, "p1")?.id);
    expect(host.props.noteId).toBe(noteId);
  });

  it("stands at the mark's line now, not at the height the click or the selection reported", () => {
    const host = mountHost();
    mark = line(412);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.props.top).toBe(412);
  });

  it("draws nothing where the page has no margin (under 1024): the mark is still drawn and its colour is changed from the notes window", () => {
    useMarginStore.setState({ rect: null });
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.tree).toBeNull();
    // The margin appears (the window widened): the strip that was raised stands.
    host.act(() => useMarginStore.setState({ rect: MARGIN }));
    expect(host.tree?.type).toBe(HighlightStrip);
  });

  it("draws nothing for a paper that has no note of its own: the page keys the host by the paper, and a highlight is in its paper's note", () => {
    const host = mountHost("another-paper");
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.tree).toBeNull();
  });

  it("follows the margin when the reader drags a divider: the strip's left and width are the margin's now", () => {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    host.act(() => useMarginStore.setState({ rect: { ...MARGIN, left: 900, width: 380 } }));
    expect(host.props).toMatchObject({ left: 908, width: 364 });
  });
});

describe("HighlightStripHost — level with its mark, a frame at a time", () => {
  function raised() {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    return host;
  }

  it("listens to the page's scroll (in the capture phase, so a scrolled pane counts) and to the window's resize, while the strip stands", () => {
    const host = raised();
    expect(winListeners.get("scroll")?.size).toBe(1);
    expect(winListeners.get("resize")?.size).toBe(1);
    host.act(() => useHighlightStrip.getState().hide());
    expect(winListeners.get("scroll")?.size ?? 0).toBe(0);
    expect(winListeners.get("resize")?.size ?? 0).toBe(0);
  });

  it("moves with the mark within the frame of a scroll: 200 px up, 200 px up", () => {
    const host = raised();
    mark = line(100);
    host.act(() => fire(winListeners, "scroll"));
    expect(frames).toHaveLength(1);
    frame();
    expect(host.props.top).toBe(100);
    expect(host.tree?.type).toBe(HighlightStrip);
  });

  it("asks for one frame however many scroll and resize events arrive before it (one measure per frame)", () => {
    const host = raised();
    const before = askedFrames;
    host.act(() => {
      for (let i = 0; i < 20; i += 1) fire(winListeners, "scroll");
      fire(winListeners, "resize");
    });
    expect(askedFrames - before).toBe(1);
    frame();
    // The next scroll asks again.
    host.act(() => fire(winListeners, "scroll"));
    expect(askedFrames - before).toBe(2);
  });

  it("holds at the band's top while the mark is above the window by less than a screen, and goes when it is more than a screen away", () => {
    const host = raised();
    mark = { left: 400, top: -500, right: 700, bottom: -482 };
    host.act(() => fire(winListeners, "scroll"));
    frame();
    expect(host.props.top).toBe(48);
    mark = { left: 400, top: -1200, right: 700, bottom: -1182 };
    host.act(() => fire(winListeners, "scroll"));
    frame();
    expect(host.tree).toBeNull();
    // Gone for good: the store no longer names it, so scrolling back does not bring it up; a click on the mark does.
    expect(useHighlightStrip.getState().id).toBeNull();
    mark = line(300);
    host.act(() => fire(winListeners, "scroll"));
    frame();
    expect(host.tree).toBeNull();
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.props.top).toBe(300);
  });

  it("goes when the mark is gone from the page (the passage was lost, the tab changed)", () => {
    const host = raised();
    mark = null;
    host.act(() => fire(winListeners, "scroll"));
    frame();
    expect(host.tree).toBeNull();
    expect(useHighlightStrip.getState().id).toBeNull();
  });

  it("re-reads the mark when the window stack changes (a card opens in the margin) and stands above the mark when the card covers its place", () => {
    const host = raised();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
    cards = [card(280, 600)];
    host.act(() => useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" }));
    frame();
    expect(host.props).toMatchObject({ left: 400, top: 300 - STRIP_ROW_PX - 6 });
    cards = [];
    host.act(() => useWindows.getState().close("sticky-1"));
    frame();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
  });

  it("measures again when the margin changes (a divider drag moves the text column and so the mark)", () => {
    const host = raised();
    mark = line(344);
    host.act(() => useMarginStore.setState({ rect: { ...MARGIN, width: 300 } }));
    expect(host.props).toMatchObject({ top: 344, width: 284 });
  });

  it("reads the window's size at the measure, not at the mount", () => {
    const host = raised();
    (window as unknown as { innerHeight: number }).innerHeight = 400;
    mark = line(1500);
    host.act(() => fire(winListeners, "resize"));
    frame();
    // 1500 is beyond 400 + 400: more than a screen away now.
    expect(host.tree).toBeNull();
  });
});

describe("HighlightStripHost — Escape, and the paper changing", () => {
  const escape = (over: Record<string, unknown> = {}) => ({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });

  it("stands for Escape from the moment the host mounts, once, and goes with it", () => {
    const host = mountHost();
    expect(docListeners.get("keydown")?.size).toBe(1);
    host.unmount();
    expect(docListeners.get("keydown")?.size ?? 0).toBe(0);
  });

  it("takes the Escape that hides the strip, so the page's back to the briefing never sees it", () => {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    stripThere = true;
    const event = escape();
    host.act(() => fire(docListeners, "keydown", event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(useHighlightStrip.getState().id).toBeNull();
    expect(host.tree).toBeNull();
  });

  it("does not take the Escape of a page with no strip: that one is the page's", () => {
    const host = mountHost();
    const event = escape();
    host.act(() => fire(docListeners, "keydown", event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("hides the strip when the host unmounts: the page keys it by the paper, and a strip never follows the reader to the next paper", () => {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(useHighlightStrip.getState().id).toBe("h1");
    host.unmount();
    expect(useHighlightStrip.getState().id).toBeNull();
  });
});

describe("the host's source", () => {
  it("leaves the page alone: no timer, nothing stored, nothing sent, no logging", () => {
    const c = code(HOST);
    expect(c).not.toMatch(/setTimeout|setInterval|localStorage|sessionStorage|fetch\(|console\.|scrollBy|scrollTo\(/);
  });

  it("takes the frame with `flushSync`, so the strip is repainted in the frame of the scroll that moved its mark", () => {
    expect(code(HOST)).toMatch(/flushSync\(/);
    expect(code(HOST)).toMatch(/requestAnimationFrame/);
  });
});
