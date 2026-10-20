import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { block, stickySpan, stickyText, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { NOTES_WINDOW_ID, useWindows } from "@/lib/reader/windows";
import { MarginCard, MarginCardShell, type MarginCardShellProps } from "@/components/reader/margin-card";
import { WysiwygField } from "./wysiwyg-field";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { reconcileWindow } from "./notes-window";
import { SUMMARY_ID } from "@/components/reader/paper-words";
import { ANSWERS_BLOCK_ID, SUMMARY_ID_PREFIX } from "./note-tags";
import { STICKY_SAVE_MS, StickyWindowView, blockFromHash, browserArrival, closeSticky, followHash, makeStickyWriter, passageFromHash, stickyFollowText, stickyRows, takeStickyNote, withoutSticky } from "./sticky-note";

// P10-09a (review 7.1; rubric B7–B10; ruling §1h.78): "Take notes" opens a numbered sticky at the right, its
// header "Note N" with the passage's first words quoted and a Close (×), a text area focused at once; typing writes
// through (debounced, at most 300 ms) into the paper's note; Escape closes the focused sticky; closing keeps
// everything. Every text is invented.

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the (hook-free) function components expanded. P11-14 (re-aimed, §1c): the window stands in `MarginCard`, which reads
 *  the margin's rect with a hook; the tree is expanded through its hook-free shell (`MarginCardShell`, with no margin: the right edge). */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (element.type === MarginCard) return [element, ...elements(MarginCardShell({ ...(element.props as unknown as MarginCardShellProps), frame: null }))];
  // the field has hooks (and is its own component, with its own tests): it is the leaf here
  if (typeof element.type === "function" && element.type !== WysiwygField) return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const QUOTE = "The finest grains crept fastest when the specimens were annealed at the lowest temperature of the series.";

const view = (extra: Partial<Parameters<typeof StickyWindowView>[0]> = {}) => ({
  n: 2, quote: QUOTE, text: "my words", front: true, top: 180, height: 260, z: 62,
  onText: vi.fn(), onClose: vi.fn(), onRaise: vi.fn(), onGo: vi.fn(),
  ...extra,
});

describe("StickyWindowView", () => {
  it("shows Note N, the passage's first words in quotes (at most 80 characters) and a Close", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html).toContain("Note 2");
    expect(html).toContain("“The finest grains crept fastest");
    expect(html).not.toContain("lowest temperature of the series");
    expect(html).toMatch(/aria-label="Close note 2"/);
    expect(html).toContain("×");
  });

  it("says in one quiet line that its passage is not in this version of the paper, and has no square to go to it (P10-35)", () => {
    const lost = renderToStaticMarkup(createElement(StickyWindowView, view({ lost: true })));
    expect(lost).toContain("This passage is not in this version of the paper.");
    expect(lost).not.toContain('aria-label="Go to the passage"');
    const found = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(found).not.toContain("not in this version");
    expect(found).toContain('aria-label="Go to the passage"');
  });

  it("is fixed at the right edge, 360 px wide, at its place in the stack", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html).toContain("fixed");
    expect(html).toContain("top:180px");
    expect(html).toContain("height:260px");
    expect(html).toContain("z-index:62");
    expect(html).toMatch(/right-0|right:0/);
    expect(html).toMatch(/w-\[min\(360px|width:min\(360px/);
  });

  it("has a text area focused at once, holding what was written, and the blue square before it", () => {
    const tree = elements(StickyWindowView(view()));
    const area = tree.find((el) => el.type === WysiwygField)!;
    expect(area.props.autoFocus).toBe(true);
    expect(area.props.value).toBe("my words");
    const onText = view().onText;
    const props = view({ onText });
    const area2 = elements(StickyWindowView(props)).find((el) => el.type === WysiwygField)!;
    (area2.props.onChange as (text: string) => void)("more");
    expect(onText).toHaveBeenCalledWith("more");
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html.indexOf('aria-label="Go to the passage"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="Go to the passage"')).toBeLessThan(html.indexOf('role="textbox"'));
  });

  it("goes back to the passage from the square, closes from the ×, raises from the header", () => {
    const props = view();
    const buttons = elements(StickyWindowView(props)).filter((el) => el.type === "button");
    const byLabel = (needle: string) => buttons.find((b) => String(b.props["aria-label"] ?? "").includes(needle))!;
    (byLabel("Go to the passage").props.onClick as () => void)();
    expect(props.onGo).toHaveBeenCalled();
    const stop = vi.fn();
    (byLabel("Close note").props.onClick as (e: unknown) => void)({ stopPropagation: stop });
    expect(props.onClose).toHaveBeenCalled();
    const header = buttons.find((b) => b.props["data-sticky-header"] !== undefined)!;
    (header.props.onClick as () => void)();
    expect(props.onRaise).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const props = view();
    const root = StickyWindowView(props) as ReactElement<Props>;
    (root.props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation: () => {}, preventDefault: () => {} });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    (root.props.onKeyDown as (e: unknown) => void)({ key: "a", stopPropagation: () => {}, preventDefault: () => {} });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only its header when it is behind another: no text area, no square", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view({ front: false, height: 40 })));
    expect(html).toContain("Note 2");
    expect(html).not.toContain('role="textbox"');
    expect(html).not.toContain("Go to the passage");
    expect(html).toContain("height:40px");
  });
});

describe("makeStickyWriter — writes through within 300 ms", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the last text once, no later than 300 ms after the last keystroke", () => {
    expect(STICKY_SAVE_MS).toBeLessThanOrEqual(300);
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.push("a");
    writer.push("ab");
    writer.push("abc");
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("abc");
  });

  it("flushes at once on close, and writes nothing when nothing was typed", () => {
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.flush();
    expect(write).not.toHaveBeenCalled();
    writer.push("x");
    writer.flush();
    expect(write).toHaveBeenCalledWith("x");
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("takeStickyNote", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });

  const target = { sectionIndex: 1, paragraphIndex: 2, passage: QUOTE };

  it("makes the paper's note without navigating, adds Note 1 anchored to the paragraph and opens its window", () => {
    const made = takeStickyNote(target, PAPER);
    const notes = Object.values(useNotesStore.getState().notes);
    expect(notes).toHaveLength(1);
    const head = notes[0].blocks.find((b) => b.id === made?.id);
    expect(head).toMatchObject({ type: "h3", text: "Note 1" });
    expect(head?.anchor).toMatchObject({ paperId: "p1", paragraphId: "paper-section-1-p2", n: 1 });
    expect(useWindows.getState().windows).toMatchObject([{ id: made?.id, kind: "sticky", title: "Note 1" }]);
  });

  it("numbers the next ones 2 and 3 in the order made, and the windows stand in the stack", () => {
    takeStickyNote(target, PAPER);
    takeStickyNote({ ...target, paragraphIndex: 0 }, PAPER);
    const third = takeStickyNote({ ...target, paragraphIndex: 1 }, PAPER);
    const note = Object.values(useNotesStore.getState().notes)[0];
    expect(note.stickyCount).toBe(3);
    expect(third?.n).toBe(3);
    expect(useWindows.getState().windows.map((w) => w.title)).toEqual(["Note 1", "Note 2", "Note 3"]);
  });
});

// P10-24 (X-B2′): the header quote never shows a note's tag, whether the quote was stored with one (an older note) or not.
describe("the sticky's header quote and passage carry no tag (P10-24, rule 1)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  const WITH_TAG = "The finest grains\u2060[1] crept fastest when the specimens were annealed";

  it("shows the quote without the tag's [n]", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view({ quote: WITH_TAG })));
    expect(html).toContain("“The finest grains crept fastest");
    expect(html).not.toContain("[1]");
    expect(html).not.toContain("\u2060");
  });

  it("takeStickyNote stores the passage's words and their range, never the tag", () => {
    const paragraphText = "Creep limits the life. The finest grains crept fastest when the specimens were annealed at rest.";
    const made = takeStickyNote({ sectionIndex: 1, paragraphIndex: 2, passage: WITH_TAG, paragraphText }, PAPER);
    const anchor = Object.values(useNotesStore.getState().notes)[0].blocks.find((b) => b.id === made?.id)?.anchor;
    expect(anchor?.quote).toBe("The finest grains crept fastest when the specimens were annealed");
    expect(paragraphText.slice(anchor!.start, anchor!.end)).toBe(anchor?.quote);
  });
});

describe("stickyRows", () => {
  const frame = { top: 100, bottom: 900, frontHeight: 260 };
  const heads: Block[] = [1, 2, 3].map((n) => block("h3", stickyTitle(n), { anchor: { paperId: "p1", paragraphId: `paper-section-0-p${n}`, quote: `quote ${n}`, n } }));
  const windows = heads.map((h, i) => ({ id: h.id, kind: "sticky" as const, title: h.text, order: i + 1 }));

  it("turns the open windows into rows with their number and quote, offset by a header each", () => {
    const rows = stickyRows(windows, heads, frame);
    expect(rows.map((r) => [r.n, r.quote, r.top])).toEqual([[1, "quote 1", 100], [2, "quote 2", 140], [3, "quote 3", 180]]);
    expect(rows.map((r) => r.front)).toEqual([false, false, true]);
  });

  it("drops a window whose note block is gone, and the other kinds", () => {
    const rows = stickyRows([...windows, { id: "gone", kind: "sticky", title: "x", order: 9 }, { id: "nn", kind: "notes", title: "n", order: 10 }], heads, frame);
    expect(rows).toHaveLength(3);
  });
});

describe("passageFromHash — the notes page's square arrives with the paragraph in the address", () => {
  it("reads a paragraph's id and nothing else", () => {
    expect(passageFromHash("#paper-section-1-p2")).toBe("paper-section-1-p2");
    expect(passageFromHash("#paper-section-1")).toBeNull();
    expect(passageFromHash("#elsewhere")).toBeNull();
    expect(passageFromHash("")).toBeNull();
    expect(passageFromHash("#%E0%A4%A")).toBeNull();
  });

  it("a Summary block's id or the answers' block is not a paragraph: it is the other function's, and a paragraph is not theirs", () => {
    expect(passageFromHash("#summary-proposal")).toBeNull();
    expect(passageFromHash("#answers-block")).toBeNull();
    expect(blockFromHash("#paper-section-1-p2")).toBeNull();
  });
});

// P11-20 rule 1 (C P11-17b "For the manager" 1; ruling §1h.118): the notes PAGE's blue square for a note taken on a Summary block or an answer
// navigates to `/papers/<id>#summary-proposal` or `#answers-block`; the paper opens on Paper digestion, and the arrival knew only the paper's own
// paragraphs, so the page stayed at the top. `blockFromHash` names those two kinds; `followHash` is the arrival (the poll the page always had, for a
// paragraph, now for either). The tab is chosen in `use-reader-tab.ts` (its own test). Invented ids.
describe("blockFromHash — the notes page's square arrives with a Summary block or the answers' block in the address", () => {
  it("reads a Summary block's id and the answers' block, and nothing else", () => {
    expect(blockFromHash("#summary-proposal")).toBe("summary-proposal");
    expect(blockFromHash("#summary-new-here")).toBe("summary-new-here");
    expect(blockFromHash("#answers-block")).toBe("answers-block");
    expect(blockFromHash("#summary-")).toBeNull();
    expect(blockFromHash("#summary")).toBeNull();
    expect(blockFromHash("#Summary-proposal")).toBeNull();
    expect(blockFromHash("#summary-proposal x")).toBeNull();
    expect(blockFromHash("#answers")).toBeNull();
    expect(blockFromHash("#answers-block-2")).toBeNull();
    expect(blockFromHash("#elsewhere")).toBeNull();
    expect(blockFromHash("")).toBeNull();
    expect(blockFromHash("#%E0%A4%A")).toBeNull();
  });

  it("knows every id the page gives a Summary block, and the answers' block: the square can arrive at any block it can leave from", () => {
    for (const id of Object.values(SUMMARY_ID)) expect(blockFromHash(`#${id}`), id).toBe(id);
    expect(blockFromHash(`#${ANSWERS_BLOCK_ID}`)).toBe(ANSWERS_BLOCK_ID);
    expect(SUMMARY_ID_PREFIX).toBe("summary-");
  });
});

describe("followHash — the arrival waits for its block, then goes there once (the paragraph's poll, as it was)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** A page that holds the ids put in `present` — and none before. A block it holds is where it should be (top 80). */
  const pageHolding = () => {
    const present = new Set<string>();
    const block = { getBoundingClientRect: () => ({ top: 80 }), scrollIntoView: () => {} } as unknown as HTMLElement;
    return { present, doc: { getElementById: (asked: string) => (present.has(asked) ? block : null) } };
  };
  /** A window that never runs a frame and is never moved: the arrival of a block is landed again in it only by its two-second limit (item 3b). */
  const stillWindow = { frame: () => () => {}, scrollY: () => 0, onUserMove: () => () => {} };

  for (const id of ["summary-proposal", "answers-block", "paper-section-0-p2"]) {
    it(`#${id}: goes to it once the page holds it — not before, and not twice`, () => {
      const seen: string[] = [];
      const { present, doc } = pageHolding();
      // Re-aimed (P11-20 item 3b, §1c): a block's arrival now also starts its landing again, so it is given a window (`stillWindow`); what it asserts is as it was.
      followHash(`#${id}`, doc, (target) => seen.push(target), stillWindow);
      vi.advanceTimersByTime(250 * 3);
      expect(seen).toEqual([]);
      present.add(id);
      vi.advanceTimersByTime(250);
      expect(seen).toEqual([id]);
      vi.advanceTimersByTime(250 * 10);
      expect(seen).toEqual([id]);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("gives up after forty looks, a quarter second apart, and goes nowhere", () => {
    const seen: string[] = [];
    let looks = 0;
    followHash("#summary-proposal", { getElementById: () => (looks++, null) }, (target) => seen.push(target));
    vi.advanceTimersByTime(250 * 39);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(250);
    expect(looks).toBe(40);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaving the page stops the wait", () => {
    const seen: string[] = [];
    const { present, doc } = pageHolding();
    const stop = followHash("#answers-block", doc, (target) => seen.push(target));
    expect(typeof stop).toBe("function");
    stop?.();
    present.add("answers-block");
    vi.advanceTimersByTime(250 * 5);
    expect(seen).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an address with no block or paragraph in it starts no wait at all", () => {
    for (const hash of ["", "#", "#elsewhere", "#paper-section-1", "#summary-"]) {
      expect(followHash(hash, { getElementById: () => null }, () => {}), hash).toBeUndefined();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("StickyNotes arrives through it, with the address the window has now and the paper it shows", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/sticky-note.tsx"), "utf8");
    expect(src).toMatch(/followHash\(window\.location\.hash,\s*document,/);
    expect(src).not.toMatch(/passageFromHash\(window\.location\.hash\)/);
  });
});

// P11-20 follow-up (ruling §1h.119, item 3b): on a phone the page settles late — the one column's figure card, 197 px at the top for an upload with no
// picture, is taken out of the page about a second after the Summary shows, in the middle of the arrival's smooth scroll, which keeps its first target
// and ends 186 px past the block (top −106 at 390 × 844). For the new arrivals only — a Summary block, the answers' block — `followHash` lands the block
// again once the page has settled: after the images on the page have loaded or failed, and two frames in which the scroll has not moved, at most one
// extra correction, within two seconds of the first scroll, and none if the reader has moved the page themselves. A paragraph's arrival is what it was.
describe("followHash — a Summary block or the answers' block is landed again once the page has settled (item 3b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A page and a window to watch: the block's top and its scroll calls, the images, the frames asked for and the scroll position, by hand. */
  const rig = (id: string, top: number, images: { complete: boolean }[] = []) => {
    const state = { top, y: 0 };
    const scrolls: unknown[] = [];
    const element = { getBoundingClientRect: () => ({ top: state.top }), scrollIntoView: (options: unknown) => scrolls.push(options) } as unknown as HTMLElement;
    const handlers = images.map(() => new Map<string, () => void>());
    const imgs = images.map((image, i) => ({
      complete: image.complete,
      addEventListener: (type: string, run: () => void) => void handlers[i].set(type, run),
      removeEventListener: (type: string) => void handlers[i].delete(type),
    }));
    const frames: (() => void)[] = [];
    const moves: (() => void)[] = [];
    const env = {
      frame: (run: () => void) => {
        frames.push(run);
        return () => {
          const at = frames.indexOf(run);
          if (at >= 0) frames.splice(at, 1);
        };
      },
      scrollY: () => state.y,
      onUserMove: (told: () => void) => {
        moves.push(told);
        return () => {
          const at = moves.indexOf(told);
          if (at >= 0) moves.splice(at, 1);
        };
      },
    };
    const doc = { getElementById: (asked: string) => (asked === id ? element : null), images: imgs };
    const gone: string[] = [];
    return { state, scrolls, handlers, imgs, frames, moves, env, doc, gone, frame: () => frames.shift()?.() };
  };
  const arrive = (hash: string, r: ReturnType<typeof rig>) => {
    const stop = followHash(hash, r.doc, (id) => r.gone.push(id), r.env);
    vi.advanceTimersByTime(250);
    return stop;
  };

  it("a block the page left 186 px past its place is landed again after two frames with the scroll still: once, at the top of the window, at once", () => {
    const r = rig("summary-proposal", -106.2);
    arrive("#summary-proposal", r);
    expect(r.gone).toEqual(["summary-proposal"]);
    expect(r.scrolls).toEqual([]);
    r.frame();
    expect(r.scrolls).toEqual([]);
    r.frame();
    expect(r.scrolls).toEqual([{ block: "start", behavior: "instant" }]);
    expect(r.frames).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(r.scrolls).toHaveLength(1);
  });

  it("the answers' block is a new arrival too", () => {
    const r = rig("answers-block", 300);
    arrive("#answers-block", r);
    r.frame();
    r.frame();
    expect(r.scrolls).toHaveLength(1);
  });

  it("a block already within two pixels of 80 is left where it is", () => {
    for (const top of [80, 79.4, 81.9]) {
      const r = rig("summary-proposal", top);
      arrive("#summary-proposal", r);
      r.frame();
      r.frame();
      expect(r.scrolls, String(top)).toEqual([]);
    }
  });

  it("waits for the images on the page to load or fail, then two frames", () => {
    const r = rig("summary-proposal", -106, [{ complete: true }, { complete: false }, { complete: false }]);
    arrive("#summary-proposal", r);
    expect(r.frames).toHaveLength(0);
    r.handlers[1].get("load")?.();
    expect(r.frames).toHaveLength(0);
    r.handlers[2].get("error")?.();
    expect(r.frames).toHaveLength(1);
    r.frame();
    r.frame();
    expect(r.scrolls).toHaveLength(1);
  });

  it("while the scroll is still moving the two frames are not yet: the correction comes after two that agree", () => {
    const r = rig("summary-proposal", -106);
    arrive("#summary-proposal", r);
    r.state.y = 100;
    r.frame();
    r.state.y = 400;
    r.frame();
    r.frame();
    expect(r.scrolls).toEqual([]);
    r.frame();
    expect(r.scrolls).toHaveLength(1);
  });

  it("an image that never settles does not keep it waiting: at two seconds from the first scroll it lands the block, once", () => {
    const r = rig("summary-proposal", -106, [{ complete: false }]);
    arrive("#summary-proposal", r);
    vi.advanceTimersByTime(1999);
    expect(r.scrolls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(r.scrolls).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(r.scrolls).toHaveLength(1);
    expect(r.moves).toEqual([]);
  });

  it("a reader who has moved the page themselves is not pulled back", () => {
    const r = rig("summary-proposal", -106);
    arrive("#summary-proposal", r);
    r.moves[0]?.();
    r.frame();
    r.frame();
    vi.advanceTimersByTime(5000);
    expect(r.scrolls).toEqual([]);
    expect(r.frames).toEqual([]);
  });

  it("leaving the page stops it: no frame, no listener, no correction", () => {
    const r = rig("summary-proposal", -106);
    const stop = arrive("#summary-proposal", r);
    stop?.();
    expect(r.frames).toEqual([]);
    expect(r.moves).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(r.scrolls).toEqual([]);
  });

  it("a paragraph's arrival is what it was: no look at the images, no frame, no listener, no correction", () => {
    const r = rig("paper-section-0-p2", -106, [{ complete: false }]);
    arrive("#paper-section-0-p2", r);
    expect(r.gone).toEqual(["paper-section-0-p2"]);
    expect(r.frames).toEqual([]);
    expect(r.moves).toEqual([]);
    expect(r.handlers[0].size).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(r.scrolls).toEqual([]);
  });
});

// P11-20 follow-up (ruling §1h.123, rule 1b): on `/notes/<id>` the blue square for a body note reached its paragraph only after about 9 s. The arrival's poll —
// a look every 250 ms, forty looks — is a timer, and on a long page it is queued behind the work of drawing it: the paragraph was in the page long before the next
// look ran. An arrival now lands as soon as its target is drawn — a paragraph, a Summary block or the answers' block: it is told when the page's tree changes
// (`onTreeChange`, a MutationObserver in the browser) and looks then, and once as the page is mounted; the poll stays as the outer bound.
describe("followHash — an arrival lands as soon as its target is drawn (rule 1b)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A page that draws `id` when `draw()` is called, and tells whoever watches its tree, as the browser's observer does. */
  const rig = (id: string) => {
    const state = { drawn: false, watchers: 0, stopped: 0, told: undefined as (() => void) | undefined };
    const element = { getBoundingClientRect: () => ({ top: 80 }), scrollIntoView: () => {} } as unknown as HTMLElement;
    const doc = { getElementById: (asked: string) => (state.drawn && asked === id ? element : null) };
    const env = {
      frame: () => () => {},
      scrollY: () => 0,
      onUserMove: () => () => {},
      onTreeChange: (told: () => void) => {
        state.watchers += 1;
        state.told = told;
        return () => {
          state.stopped += 1;
          state.told = undefined;
        };
      },
    };
    const gone: string[] = [];
    return { state, doc, env, gone, draw: () => { state.drawn = true; state.told?.(); } };
  };

  for (const id of ["paper-section-0-p2", "summary-proposal", "answers-block"]) {
    it(`#${id}: lands at the moment the page's tree changes to hold it — not at the next look, and not twice`, () => {
      const r = rig(id);
      followHash(`#${id}`, r.doc, (target) => r.gone.push(target), r.env);
      expect(r.state.watchers).toBe(1);
      vi.advanceTimersByTime(250 * 5);
      expect(r.gone).toEqual([]);
      // drawn between two looks of the poll: the observer's call, with no timer advanced, lands it
      r.draw();
      expect(r.gone).toEqual([id]);
      expect(r.state.stopped).toBe(1);
      vi.advanceTimersByTime(250 * 10);
      expect(r.gone).toEqual([id]);
      r.state.told?.();
      expect(r.gone).toEqual([id]);
    });
  }

  it("a target the page already holds when it is mounted is landed once the page's own effects have run, with no timer advanced", async () => {
    const r = rig("paper-section-0-p2");
    r.state.drawn = true;
    followHash("#paper-section-0-p2", r.doc, (target) => r.gone.push(target), r.env);
    expect(r.gone).toEqual([]);
    await Promise.resolve();
    expect(r.gone).toEqual(["paper-section-0-p2"]);
    expect(r.state.stopped).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the paragraph's arrival ends at the landing: no timer left, no listener of the moves of the page", () => {
    const r = rig("paper-section-0-p2");
    followHash("#paper-section-0-p2", r.doc, (target) => r.gone.push(target), r.env);
    r.draw();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaving the page stops the watching: no landing from a later change of the tree", () => {
    const r = rig("summary-proposal");
    const stop = followHash("#summary-proposal", r.doc, (target) => r.gone.push(target), r.env);
    stop?.();
    expect(r.state.stopped).toBe(1);
    r.draw();
    expect(r.gone).toEqual([]);
  });

  it("the poll is still the outer bound: after forty looks it gives up, and the watching with it", () => {
    const r = rig("summary-proposal");
    followHash("#summary-proposal", r.doc, (target) => r.gone.push(target), r.env);
    vi.advanceTimersByTime(250 * 40);
    expect(r.state.stopped).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    r.draw();
    expect(r.gone).toEqual([]);
  });

  it("where there is no page to watch (no observer) the poll lands it, as it always did", () => {
    const r = rig("paper-section-0-p2");
    const { onTreeChange: _unused, ...quiet } = r.env;
    void _unused;
    followHash("#paper-section-0-p2", r.doc, (target) => r.gone.push(target), quiet);
    r.state.drawn = true;
    vi.advanceTimersByTime(250);
    expect(r.gone).toEqual(["paper-section-0-p2"]);
  });

  it("the browser's own environment watches the tree where there is an observer, and is quiet where there is none", () => {
    expect(typeof browserArrival.onTreeChange).toBe("function");
    expect(() => browserArrival.onTreeChange?.(() => {})()).not.toThrow();
  });

  it("StickyNotes asks for it with the browser's environment: it passes no environment of its own", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/sticky-note.tsx"), "utf8");
    expect(src).toMatch(/followHash\(window\.location\.hash,\s*document,\s*\(id\) =>/);
    expect(src).toMatch(/onTreeChange: \(told\) => \{[\s\S]*?new MutationObserver\(told\)[\s\S]*?observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);
  });
});

// ── P10-09c ───────────────────────────────────────────────────────────────

describe("stickyRows — with the notes window in the stack (P10-09c, B9)", () => {
  const frame = { top: 100, bottom: 900, frontHeight: 260 };
  const heads: Block[] = [1, 2, 3].map((n) => block("h3", stickyTitle(n), { anchor: { paperId: "p1", paragraphId: `paper-section-0-p${n}`, quote: `quote ${n}`, n } }));
  const win = (i: number, order: number) => ({ id: heads[i].id, kind: "sticky" as const, title: heads[i].text, order });
  const notes = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });

  it("leaves a slot for the notes window: three stickies and the notes window are four cards, 40 px apart", () => {
    const rows = stickyRows([win(0, 1), win(1, 2), win(2, 3), notes(4)], heads, frame);
    expect(rows.map((r) => [r.n, r.top, r.front])).toEqual([[1, 100, false], [2, 140, false], [3, 180, false]]);
    // The notes window opened between the stickies: the later stickies sit under its header.
    const between = stickyRows([win(0, 1), notes(2), win(1, 3), win(2, 4)], heads, frame);
    expect(between.map((r) => [r.n, r.top, r.front])).toEqual([[1, 100, false], [2, 180, false], [3, 220, true]]);
  });

  it("brings a raised sticky in front of the notes window, and none of them is in front when the notes window is", () => {
    const rows = stickyRows([win(0, 5), win(1, 2), notes(3), win(2, 4)], heads, frame);
    expect(rows.map((r) => [r.n, r.front])).toEqual([[2, false], [3, false], [1, true]]);
    expect(stickyRows([win(0, 1), win(1, 2), notes(9)], heads, frame).some((r) => r.front)).toBe(false);
  });
});

describe("the source (P10-09c, rule 2) — one column, one layout", () => {
  it("StickyNotes lays out over the stack's windows and takes the column from lib/reader/windows", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/sticky-note.tsx"), "utf8");
    expect(src).toContain("stackRows(");
    expect(src).toContain("useColumn(");
    expect(src).not.toContain("function useColumn");
  });
});

describe("stickyFollowText — a sticky follows its blocks (P10-09c, rule 3)", () => {
  it("takes the stored text when its blocks changed outside and it holds no unsaved keystroke", () => {
    expect(stickyFollowText({ local: "my words", stored: "my words, and the window's", pending: false })).toBe("my words, and the window's");
    expect(stickyFollowText({ local: "", stored: "typed in the window", pending: false })).toBe("typed in the window");
  });

  it("keeps its own text while a keystroke of its own is not yet written", () => {
    expect(stickyFollowText({ local: "my words, one more", stored: "my words", pending: true })).toBeNull();
  });

  it("does not take back what it wrote itself: the store keeps paragraphs, not the blank lines or trailing spaces typed", () => {
    expect(stickyFollowText({ local: "first\n\nsecond  \n", stored: "first\nsecond", pending: false })).toBeNull();
    expect(stickyFollowText({ local: "same", stored: "same", pending: false })).toBeNull();
  });
});

describe("makeStickyWriter — leaves the notes window time to show it (P10-09c)", () => {
  it("writes through in 150 ms or less, so the open notes window shows a sticky's words within 300 ms of the last key", () => {
    expect(STICKY_SAVE_MS).toBeLessThanOrEqual(150);
  });
});

describe("makeStickyWriter — pending (P10-09c)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says whether a keystroke is waiting to be written", () => {
    const writer = makeStickyWriter(vi.fn());
    expect(writer.pending()).toBe(false);
    writer.push("a");
    expect(writer.pending()).toBe(true);
    vi.advanceTimersByTime(STICKY_SAVE_MS);
    expect(writer.pending()).toBe(false);
    writer.push("b");
    writer.flush();
    expect(writer.pending()).toBe(false);
  });
});

describe("an empty sticky leaves nothing behind (P10-09c, rule 4)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  const target = { sectionIndex: 0, paragraphIndex: 1, passage: QUOTE };
  const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1")!;

  it("withoutSticky removes the heading and its empty text blocks, and only those", () => {
    const a = block("h3", "Note 1", { anchor: { paperId: "p1", paragraphId: "paper-section-0-p0", quote: "q", n: 1 } });
    const b = block("h3", "Note 2", { anchor: { paperId: "p1", paragraphId: "paper-section-0-p1", quote: "q", n: 2 } });
    const blocks = [block("h2", "Questions"), a, block("text", "kept words"), b, block("text", ""), block("text", "  ")];
    const out = withoutSticky(blocks, b.id);
    expect(out.map((x) => x.id)).toEqual([blocks[0].id, a.id, blocks[2].id]);
    // A sticky with words in it is not touched.
    expect(withoutSticky(blocks, a.id)).toBe(blocks);
    expect(withoutSticky(blocks, "missing")).toBe(blocks);
  });

  it("closing an empty sticky removes its heading and text from the note and closes the window", () => {
    takeStickyNote(target, PAPER);
    const before = noteOf().blocks.length;
    const second = takeStickyNote(target, PAPER)!;
    expect(noteOf().blocks.length).toBe(before + 2);
    closeSticky(noteOf().id, second.id);
    expect(noteOf().blocks.length).toBe(before);
    expect(noteOf().blocks.some((b) => b.id === second.id)).toBe(false);
    expect(useWindows.getState().windows.map((w) => w.title)).toEqual(["Note 1"]);
  });

  it("frees nothing else: the number is not reused, the other stickies and their words stay", () => {
    const first = takeStickyNote(target, PAPER)!;
    const second = takeStickyNote(target, PAPER)!;
    useNotesStore.getState().setStickyText(noteOf().id, first.id, "words of the first");
    closeSticky(noteOf().id, second.id);
    expect(noteOf().stickyCount).toBe(2);
    expect(stickyText(noteOf().blocks, first.id)).toBe("words of the first");
    const third = takeStickyNote(target, PAPER)!;
    expect(third.n).toBe(3);
  });

  it("closing a sticky with words in it keeps its heading and its words", () => {
    const made = takeStickyNote(target, PAPER)!;
    useNotesStore.getState().setStickyText(noteOf().id, made.id, "worth keeping");
    closeSticky(noteOf().id, made.id);
    expect(stickySpan(noteOf().blocks, made.id)).not.toBeNull();
    expect(stickyText(noteOf().blocks, made.id)).toBe("worth keeping");
    expect(useWindows.getState().windows).toEqual([]);
  });
});

// A sticky and the notes window open on the one note. The sticky's side is its writer and `stickyFollowText`, the window's
// side is `reconcileWindow` (what it does when the stored blocks change under its editor); the note is the real store's.
describe("a sticky and the notes window on one note (P10-09c, rule 3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const made = takeStickyNote({ sectionIndex: 0, paragraphIndex: 0, passage: QUOTE }, PAPER)!;
    const noteId = readingNoteFor(useNotesStore.getState().notes, "p1")!.id;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    const writer = makeStickyWriter((text) => useNotesStore.getState().setStickyText(noteId, made.id, text));
    return { made, noteId, blocks, writer };
  };

  it("typing in the sticky shows in the window within 300 ms, and the window's editor starts afresh with it", () => {
    const { made, blocks, writer } = setup();
    const windowCopy = blocks(); // the editor's copy, nothing unsaved
    writer.push("typed in the sticky");
    vi.advanceTimersByTime(300);
    expect(stickyText(blocks(), made.id)).toBe("typed in the sticky");
    const verdict = reconcileWindow(windowCopy, windowCopy, blocks());
    expect(verdict.kind).toBe("restart");
    expect(verdict.kind === "restart" && stickyText(verdict.blocks, made.id)).toBe("typed in the sticky");
  });

  it("typing in the window shows in the sticky, and the sticky's text area takes it", () => {
    const { made, noteId, blocks, writer } = setup();
    writer.push("first");
    vi.advanceTimersByTime(300);
    // The window's editor changes the sticky's own text block and its save lands.
    const edited = blocks().map((b) => (b.text === "first" ? { ...b, text: "first, and more from the window" } : b));
    useNotesStore.getState().save(noteId, { blocks: edited });
    expect(stickyFollowText({ local: "first", stored: stickyText(blocks(), made.id), pending: writer.pending() })).toBe("first, and more from the window");
  });

  it("no overwrite from the sticky: a keystroke waiting to be written is kept, and lands over the stored text after", () => {
    const { made, noteId, blocks, writer } = setup();
    writer.push("sticky words");
    vi.advanceTimersByTime(300);
    const edited = blocks().map((b) => (b.text === "sticky words" ? { ...b, text: "window version" } : b));
    useNotesStore.getState().save(noteId, { blocks: edited });
    writer.push("sticky words, more");
    expect(stickyFollowText({ local: "sticky words, more", stored: stickyText(blocks(), made.id), pending: writer.pending() })).toBeNull();
    vi.advanceTimersByTime(300);
    expect(stickyText(blocks(), made.id)).toBe("sticky words, more");
  });

  it("no overwrite from the window: its unsaved typing and the sticky's new words are merged, not one over the other", () => {
    const { made, noteId, blocks, writer } = setup();
    const base = blocks();
    // The window's editor holds unsaved blocks of its own (typed in the last half second) — under a heading of its own,
    // since a text block right after a sticky's last one would be that sticky's...
    const mine = [...base, block("h2", "From the window"), block("text", "typed in the window")];
    // ...when the sticky's words arrive in the store.
    writer.push("typed in the sticky");
    vi.advanceTimersByTime(300);
    const verdict = reconcileWindow(base, mine, blocks());
    expect(verdict.kind).toBe("merge");
    if (verdict.kind !== "merge") return;
    expect(stickyText(verdict.blocks, made.id)).toBe("typed in the sticky");
    expect(verdict.blocks.some((b) => b.text === "typed in the window")).toBe(true);
    // The window saves the merge over the editor's own flush: the store holds both.
    useNotesStore.getState().save(noteId, { blocks: verdict.blocks });
    expect(stickyText(blocks(), made.id)).toBe("typed in the sticky");
    expect(blocks().some((b) => b.text === "typed in the window")).toBe(true);
  });
});

// P11-14 rule 3 (re-aimed, §1c): was "a sticky reserves the column and holds the selection in place (P10-09d, X-B1; rules 1 and 2)" — five
// cases about the shared reserve (`bindWindowsReserve`, `--explain-dock`) and the scroll that kept the selected words where the eyes
// are (`holdInPlace`). The margin is a track of the reader's shell now, so opening or closing a sticky moves nothing: there is no reserve
// to take, no reflow to measure across and no scroll to make. What the old cases protected — the selected words stay where the eyes are
// when a sticky opens or closes, and a sticky opens only in the stack — is asserted below on the new mechanism.
describe("a sticky reserves nothing and moves nothing (P11-14, rule 3; was P10-09d, X-B1)", () => {
  const target = { sectionIndex: 1, paragraphIndex: 2, passage: QUOTE };
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });
  afterEach(() => useWindows.setState({ windows: [], clock: 0, origin: null }));

  it("opening a sticky only joins the stack: it never asks where the selection is to compensate for a reflow, and scrolls nothing", () => {
    const measure = vi.fn(() => ({ bounds: { top: 300 } }) as never);
    const scrollBy = vi.fn();
    vi.stubGlobal("window", { scrollBy });
    try {
      const made = takeStickyNote({ ...target, measure }, PAPER)!;
      expect(useWindows.getState().windows.map((w) => w.id)).toEqual([made.id]);
      // The one read of the selection is where the first card opens (R-open) — once, not before and after a change of the layout.
      expect(measure).toHaveBeenCalledTimes(1);
      expect(scrollBy).not.toHaveBeenCalled();
      closeSticky(Object.values(useNotesStore.getState().notes)[0].id, made.id);
      expect(useWindows.getState().windows).toEqual([]);
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the stickies' module opens windows through the stack's store, and takes no reserve and holds no place", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/sticky-note.tsx"), "utf8");
    expect(src).toContain("useWindows.getState().open(");
    expect(src).not.toContain("holdInPlace(");
    expect(src).not.toContain("reserveDock(");
  });
});
