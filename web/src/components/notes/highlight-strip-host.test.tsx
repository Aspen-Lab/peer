import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17b rule 2 (owner item 8; B P11-04 §5; ruling §1h.112 D3): the margin's host of the highlight's colour strip. While `useHighlightStrip` names a
// highlight and the page has a margin it stands the strip at the mark's first line NOW (re-read on scroll and on resize, one animation frame
// each, so the strip is level with its mark), goes the moment no part of its mark is in the window (P11-27 rule 3) or the mark is gone, stands in the margin
// over an open card the way the selection's three actions do (P11-27 rule 1; it stood clear of one above the mark, O-2), takes the Escape that hides it (the page's own Escape is "back to the briefing"), and goes with the paper.
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
import { MARGIN_INSET_PX } from "@/components/reader/selection-toolbar";
import type { Paper } from "@/types";
import { HighlightStrip, useHighlightStrip } from "./highlight-strip";
import {
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
    expect(stripStanding({ mark: line(300), viewport: VIEW, margin: MARGIN })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
  });

  it("holds inside the band: never above the masthead's foot, nor with its foot below the legend's strip", () => {
    expect(STRIP_ROW_PX).toBe(34);
    // P11-27 rule 3, RE-AIMED (§1c): the mark was `line(10)`, wholly under the masthead — the strip is not held for a mark that is out of the window now
    // (it goes); the clamp is pinned with a mark that still has a pixel in the window (`line(31)` ends at 49, the band's top is 48).
    expect(stripStanding({ mark: line(31), viewport: VIEW, margin: MARGIN })?.top).toBe(48);
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: MARGIN })?.top).toBe(860 - STRIP_ROW_PX);
  });

  it("wraps to two rows in a narrow margin, and holds those two rows inside the band", () => {
    expect(STRIP_TWO_ROWS_PX).toBe(58);
    const narrow: MarginRect = { ...MARGIN, width: 160 };
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: narrow })).toMatchObject({ mode: "margin", left: 1008, top: 860 - STRIP_TWO_ROWS_PX, width: 144 });
    // One row from the width that holds the six colours and the remove button on one line.
    const wide: MarginRect = { ...MARGIN, width: STRIP_ONE_ROW_WIDTH_PX + 2 * MARGIN_INSET_PX };
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: wide })?.top).toBe(860 - STRIP_ROW_PX);
    expect(stripStanding({ mark: line(850), viewport: VIEW, margin: { ...wide, width: wide.width - 1 } })?.top).toBe(860 - STRIP_TWO_ROWS_PX);
  });

  // P11-27 rule 3, RE-AIMED (§1c) (ruling §1h.123): was "goes when the mark is more than a screen away, above or below, and stays up to that distance (held at
  // the band's edge)", with `AWAY_SCREENS` = 1. The same marks, the same distances; the answer is now that the strip goes as soon as the mark is out of the
  // window, a screen away or a pixel (the margin of a window's height is retired with `AWAY_SCREENS`; the pixel edges are pinned in the P11-27 rule 3 block).
  it("goes when the mark is out of the window, above or below, however far: a screen away, or less (it was held at the band's edge up to a screen)", () => {
    expect(stripStanding({ mark: { left: 400, top: -1000, right: 700, bottom: -982 }, viewport: VIEW, margin: MARGIN })).toBeNull();
    expect(stripStanding({ mark: { left: 400, top: -917, right: 700, bottom: -899 }, viewport: VIEW, margin: MARGIN })).toBeNull();
    expect(stripStanding({ mark: line(1801), viewport: VIEW, margin: MARGIN })).toBeNull();
    expect(stripStanding({ mark: line(1799), viewport: VIEW, margin: MARGIN })).toBeNull();
  });

  // P11-27 rule 1, RE-AIMED (§1c) — ruling §1h.122 amends §1h.113 (b) O-2: the strip follows the rule the selection's actions follow, and that rule is now that
  // the group stays in the margin, over the card. The four tests keep their cards and flip their answers (they stood the strip above the mark, as the pill
  // did, and pinned the 4 px of slack and the 12 px of hysteresis); the cards go in as `cards`, which `stripStanding` no longer takes and so ignores.
  describe("an open card covers the place (re-aimed: the strip stays in the margin, over it)", () => {
    const standing = (cards: ViewRect[], mark: ViewRect = line(300), more: Record<string, unknown> = {}) =>
      stripStanding({ mark, viewport: VIEW, margin: MARGIN, cards, ...more } as Parameters<typeof stripStanding>[0]);

    it("stands in the margin, level with the mark's first line, over the card (it stood above the mark, left-aligned with it, as the pill did)", () => {
      expect(standing([card(280, 600)])).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
    });

    it("keeps the margin whatever the card's distance from the strip: 4 px clear, 3 px clear, covering (it left it when the card came within 4 px)", () => {
      const bottom = 300 + STRIP_ROW_PX;
      for (const gap of [4, 3, 0, -20]) expect(standing([card(bottom + gap, 800)])?.mode, String(gap)).toBe("margin");
    });

    it("has one mode: a strip drawn above before (the `mode` it was drawn in) changes nothing (it returned to the margin only 12 px further clear)", () => {
      const bottom = 300 + STRIP_ROW_PX;
      for (const mode of ["above", "margin"]) for (const gap of [4, 16, 40]) expect(standing([card(bottom + gap, 800)], line(300), { mode })?.mode, `${mode} ${gap}`).toBe("margin");
    });

    // Rule 3 flips this one back (RE-AIMED again, §1c): it stood above the mark where a card covered the place and went where there was no room above a mark
    // that had left the window (O-2); rule 1 held it at the band's top; the mark out of the window now takes it away, card or no card (ruling §1h.123).
    it("has nowhere to stand for a mark that has left the window, over a card as without one: it goes", () => {
      const gone = standing([card(40, 200)], { left: 400, top: -60, right: 700, bottom: -42 });
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
/** P11-27: the lines of the mark after its first, for a highlight that runs over more than one line. */
let extraLines: ViewRect[];
let cards: ViewRect[];
let stripThere: boolean;
const fire = (map: Map<string, Set<Listener>>, type: string, event?: unknown) => [...(map.get(type) ?? [])].forEach((one) => one(event));

function stubPage() {
  docListeners = new Map();
  winListeners = new Map();
  frames = [];
  askedFrames = 0;
  mark = null;
  extraLines = [];
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
      if (selector.startsWith("mark[data-highlight")) return mark ? { getClientRects: () => [mark, ...extraLines], getBoundingClientRect: () => mark } : null;
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

/** The host a test mounted, taken down after it: its subscriptions are on stores that outlive the test. */
let standing: { unmount: () => void } | null = null;

function mountHost(paperId = "p1") {
  const mounted = stagedRuntime.mount(() => HighlightStripHost({ paperId }));
  standing = mounted;
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
  standing?.unmount();
  standing = null;
  useMarginStore.setState({ rect: null });
  useHighlightStrip.setState({ id: null, top: 0 });
  useWindows.setState({ windows: [], clock: 0, origin: null });
  vi.unstubAllGlobals();
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

  // P11-27 rule 3, RE-AIMED (§1c) (ruling §1h.123): was "holds at the band's top while the mark is above the window by less than a screen, and goes when it is
  // more than a screen away". The mark goes to the same places; the strip is held at the band's top only while a pixel of the mark is under the masthead's foot
  // (the first scroll, 40 px above the top of its line, leaves the last line at 49), and goes the moment it is out — a screen away or less. Kept: it is gone for
  // good (the store forgets it), scrolling back does not bring it up, a click on the mark does.
  it("holds at the band's top while a pixel of the mark is in the window, and goes the moment it is out, however near: it is gone for good", () => {
    const host = raised();
    mark = { left: 400, top: 31, right: 700, bottom: 49 };
    host.act(() => fire(winListeners, "scroll"));
    frame();
    expect(host.props.top).toBe(48);
    mark = { left: 400, top: -500, right: 700, bottom: -482 };
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

  // P11-27 rule 1, RE-AIMED (§1c): was "re-reads the mark when the window stack changes (a card opens in the margin) and stands above the mark when the card
  // covers its place". The same card opens and closes; the strip stays at the margin's left, level with the mark, all the time (ruling §1h.122).
  it("stays in the margin, level with the mark, when a card opens in the margin at its height, and when it closes", () => {
    const host = raised();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
    cards = [card(280, 600)];
    host.act(() => useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" }));
    frame();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
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

// ── P11-27 rule 1 (owner item 5; round 1's walk X-1; ruling §1h.122): the strip follows the rule the selection's actions follow ─────────────────────────────
// With a margin it stands in the margin, level with the mark's first line, 8 px in from the margin's left edge, whatever card stands at that height: over
// the card (the strip is `z-[70]`, over the stack's cards), never above the mark over the centre column's words. Cards the caller still lists are ignored.
describe("stripStanding — over a card the strip stays in the margin (P11-27 rule 1)", () => {
  const stand = (extra: Record<string, unknown> = {}, mark = line(300)) => {
    const input = { mark, viewport: VIEW, margin: MARGIN, ...extra };
    return stripStanding(input as Parameters<typeof stripStanding>[0]);
  };

  it("stands in the margin, level with the mark, with the Explain card, a sticky or a figure at that height", () => {
    for (const cards of [[card(280, 600)], [card(48, 860)], [card(300, 560)], [card(280, 600), card(48, 120)]]) {
      expect(stand({ cards })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
    }
  });

  it("stands where it stood with a card 3 px under it, over it, on its very rect", () => {
    expect(stand({ cards: [card(300 + STRIP_ROW_PX + 3, 800)] })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
    expect(stand({ cards: [card(100, 297)] })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
    expect(stand({ cards: [card(300, 300 + STRIP_ROW_PX)] })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
  });

  it("is never above the mark while a margin stands, at any height of the mark, with a card over the whole band", () => {
    for (let top = 40; top <= 880; top += 20) {
      const got = stand({ cards: [card(48, 860)] }, line(top))!;
      expect(got.mode, String(top)).toBe("margin");
      expect(got.left, String(top)).toBe(1008);
    }
  });

  it("has retired the O-2 fallback: no slack to a card, no hysteresis", async () => {
    const toolbar = (await import("@/components/reader/selection-toolbar")) as Record<string, unknown>;
    expect(toolbar.CARD_SLACK_PX).toBeUndefined();
    expect(toolbar.MODE_HYSTERESIS_PX).toBeUndefined();
  });
});

describe("HighlightStripHost — over a card (P11-27 rule 1)", () => {
  it("stays in the margin, level with its mark, when a card opens at that height: over the card, never above the mark", () => {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
    cards = [card(280, 600)];
    host.act(() => useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" }));
    frame();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
    cards = [];
    host.act(() => useWindows.getState().close("sticky-1"));
    frame();
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
  });

  it("stands in the margin from the first, with a card already at the mark's height when the strip is raised", () => {
    cards = [card(48, 860)];
    const host = mountHost();
    mark = line(412);
    host.act(() => useHighlightStrip.getState().show("h1", 412));
    expect(host.props).toMatchObject({ left: 1008, top: 412, width: 264 });
  });
});

// ── P11-27 rule 3 (round 1's walk, Theme-B readers; ruling §1h.123): the strip leaves when its mark leaves the window ─────────────────────────────────────
// It shows only while some part of its mark is inside the window — below the masthead's foot (the margin's band top) and above the window's foot, the
// bounds the selection's actions use. Scrolled out, above or below, it goes at once and the store forgets it: scrolling back does not bring it up; a click
// on the mark does, as it did. Held at the band's edge while a later line of the mark is still in. Escape, a press elsewhere and a new selection hide it, and a
// press on the strip keeps it, as they did (`highlight-strip.tsx`).
describe("stripStanding — the strip leaves when its mark leaves the window (P11-27 rule 3)", () => {
  const stand = (mark: ViewRect, box?: ViewRect) => stripStanding({ mark, ...(box ? { box } : {}), viewport: VIEW, margin: MARGIN, cards: [] } as Parameters<typeof stripStanding>[0]);
  const at = (top: number, bottom = top + 18): ViewRect => ({ left: 400, top, right: 700, bottom });

  it("goes the moment the mark's last line is above the band's top, however near the window it is", () => {
    expect(stand(at(-300))).toBeNull();
    expect(stand(at(-60, -42))).toBeNull();
    expect(stand(at(30, 48))).toBeNull();
  });

  it("stays while one pixel of the mark is under the masthead's foot, held at the band's top", () => {
    expect(stand(at(31, 49))).toMatchObject({ mode: "margin", top: 48 });
  });

  it("goes the moment the mark's top is at the window's foot or below it", () => {
    expect(stand(at(900))).toBeNull();
    expect(stand(at(1000))).toBeNull();
    expect(stand(at(1500))).toBeNull();
  });

  it("stays while one pixel of the mark is inside the window's foot, held at the band's foot", () => {
    expect(stand(at(899))).toMatchObject({ mode: "margin", top: 860 - STRIP_ROW_PX });
  });

  it("has retired the screen of grace: a mark a screen away used to keep its strip", () => {
    return import("./highlight-strip-host").then((host) => {
      expect((host as Record<string, unknown>).AWAY_SCREENS).toBeUndefined();
    });
  });

  it("stays while a later line of the mark is still in the window: the whole mark's box counts, not only its first line", () => {
    const first = at(-10, 8);
    expect(stand(first)).toBeNull();
    expect(stand(first, { left: 400, top: -10, right: 700, bottom: 66 })).toMatchObject({ mode: "margin", top: 48 });
    expect(stand(first, { left: 400, top: -10, right: 700, bottom: 40 })).toBeNull();
    // Below the window the first line is the one in view: the box does not matter.
    expect(stand(at(880, 898), { left: 400, top: 880, right: 700, bottom: 950 })).toMatchObject({ mode: "margin" });
    expect(stand(at(901, 919), { left: 400, top: 901, right: 700, bottom: 980 })).toBeNull();
  });
});

describe("markBox — the whole of a highlight's mark, read now (P11-27 rule 3)", () => {
  const box = (top: number, bottom = top + 18): ViewRect => ({ left: 100, top, right: 220, bottom });
  const docOf = (found: Record<string, unknown> | null) => {
    const asked: string[] = [];
    return { asked, doc: { querySelector: (selector: string) => (asked.push(selector), found) } as unknown as Pick<Document, "querySelector"> };
  };

  it("runs from the top of the first piece's first line to the bottom of the last line of the highlight's own mark", async () => {
    const { markBox } = (await import("./highlight-strip-host")) as unknown as { markBox: (doc: Pick<Document, "querySelector">, id: string) => ViewRect | null };
    const { asked, doc } = docOf({ getClientRects: () => [box(300), box(318), box(336)], getBoundingClientRect: () => ({ left: 100, top: 300, right: 400, bottom: 354 }) });
    expect(markBox(doc, "h1")).toEqual({ left: 100, top: 300, right: 220, bottom: 354 });
    expect(asked).toEqual(['mark[data-highlight="h1"], mark[data-highlight-part="h1"]', 'mark[data-highlight="h1"]']);
  });

  it("falls back on the bounding box, copies the numbers, and is null with no mark on the page", async () => {
    const { markBox } = (await import("./highlight-strip-host")) as unknown as { markBox: (doc: Pick<Document, "querySelector">, id: string) => ViewRect | null };
    expect(markBox(docOf({ getClientRects: () => [], getBoundingClientRect: () => box(40, 76) }).doc, "h1")).toEqual(box(40, 76));
    const live = { left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2, x: 1, y: 2 };
    expect(markBox(docOf({ getClientRects: () => [live], getBoundingClientRect: () => live }).doc, "h1")).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    expect(markBox(docOf(null).doc, "h1")).toBeNull();
  });
});

describe("HighlightStripHost — the strip leaves when its mark leaves the window (P11-27 rule 3)", () => {
  function raised() {
    const host = mountHost();
    mark = line(300);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    return host;
  }
  const scrollTo = (host: ReturnType<typeof mountHost>, next: ViewRect | null, lines: ViewRect[] = []) => {
    mark = next;
    extraLines = lines;
    host.act(() => fire(winListeners, "scroll"));
    frame();
  };

  it("goes when the mark scrolls out above, and scrolling back does not bring it up", () => {
    const host = raised();
    scrollTo(host, line(-300));
    expect(host.tree).toBeNull();
    expect(useHighlightStrip.getState().id).toBeNull();
    scrollTo(host, line(300));
    expect(host.tree).toBeNull();
  });

  it("goes when the mark scrolls out below, and scrolling back does not bring it up", () => {
    const host = raised();
    scrollTo(host, line(950));
    expect(host.tree).toBeNull();
    expect(useHighlightStrip.getState().id).toBeNull();
    scrollTo(host, line(300));
    expect(host.tree).toBeNull();
  });

  it("comes back by a click on the mark (the store names it again), level with the mark", () => {
    const host = raised();
    scrollTo(host, line(-300));
    expect(host.tree).toBeNull();
    scrollTo(host, line(300));
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.tree?.type).toBe(HighlightStrip);
    expect(host.props).toMatchObject({ left: 1008, top: 300 });
  });

  it("follows the mark while any part of it is in the window, held at the band's top while only a later line is", () => {
    const host = raised();
    scrollTo(host, line(-10), [{ left: 400, top: 8, right: 700, bottom: 26 }, { left: 400, top: 26, right: 700, bottom: 44 }, { left: 400, top: 44, right: 700, bottom: 62 }]);
    expect(host.tree?.type).toBe(HighlightStrip);
    expect(host.props.top).toBe(48);
    // The last line goes under the masthead too: the whole mark is out, the strip goes.
    scrollTo(host, line(-80), [{ left: 400, top: -62, right: 700, bottom: -44 }, { left: 400, top: -44, right: 700, bottom: -26 }]);
    expect(host.tree).toBeNull();
    expect(useHighlightStrip.getState().id).toBeNull();
  });

  it("keeps today's other ways out: Escape hides it, a press on the strip keeps it (the strip's own listeners), and a new selection hides it", () => {
    const host = raised();
    stripThere = true;
    const event = { key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    host.act(() => fire(docListeners, "keydown", event));
    expect(host.tree).toBeNull();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    host.act(() => useHighlightStrip.getState().show("h1", 300));
    expect(host.tree?.type).toBe(HighlightStrip);
    host.act(() => useHighlightStrip.getState().hide());
    expect(host.tree).toBeNull();
  });

  it("is not made to go by a card opening at its height (rule 1): only the mark leaving the window takes it away", () => {
    const host = raised();
    cards = [card(48, 860)];
    host.act(() => useWindows.getState().open({ id: "sticky-1", kind: "sticky", title: "Note 1" }));
    frame();
    expect(host.tree?.type).toBe(HighlightStrip);
    expect(host.props.top).toBe(300);
  });
});
