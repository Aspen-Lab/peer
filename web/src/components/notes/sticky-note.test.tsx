import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { block, stickySpan, stickyText, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { DOCK_VAR } from "@/components/reader/explain-dock";
import { NOTES_WINDOW_ID, bindWindowsReserve, useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { reconcileWindow } from "./notes-window";
import { STICKY_SAVE_MS, StickyWindowView, closeSticky, makeStickyWriter, passageFromHash, stickyFollowText, stickyRows, takeStickyNote, withoutSticky } from "./sticky-note";

// P10-09a (review 7.1; rubric B7–B10; ruling §1h.78): "Take notes" opens a numbered sticky at the right, its
// header "Note N" with the passage's first words quoted and a Close (×), a text area focused at once; typing writes
// through (debounced, at most 300 ms) into the paper's note; Escape closes the focused sticky; closing keeps
// everything. Every text is invented.

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the (hook-free) function components expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
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
    const area = tree.find((el) => el.type === "textarea")!;
    expect(area.props.autoFocus).toBe(true);
    expect(area.props.value).toBe("my words");
    const onText = view().onText;
    const props = view({ onText });
    const area2 = elements(StickyWindowView(props)).find((el) => el.type === "textarea")!;
    (area2.props.onChange as (e: unknown) => void)({ target: { value: "more" }, currentTarget: { value: "more" } });
    expect(onText).toHaveBeenCalledWith("more");
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html.indexOf('aria-label="Go to the passage"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="Go to the passage"')).toBeLessThan(html.indexOf("<textarea"));
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
    expect(html).not.toContain("<textarea");
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

describe("a sticky reserves the column and holds the selection in place (P10-09d, X-B1; rules 1 and 2)", () => {
  const target = { sectionIndex: 1, paragraphIndex: 2, passage: QUOTE };
  let unbind: (() => void) | undefined;
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  afterEach(() => {
    unbind?.();
    unbind = undefined;
    useWindows.setState({ windows: [], clock: 0 });
  });

  /** A page whose words sit 220 px lower once the column is reserved (a narrower text column wraps to more lines). */
  function page(width: number) {
    const props = new Map<string, string>();
    const style = { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) };
    unbind = bindWindowsReserve({ root: { style }, width: () => width, onResize: () => () => {} });
    return { props, top: () => (props.has(DOCK_VAR) ? 520 : 300) };
  }

  it("opening a sticky takes the shared reserve, so the text moves out of the column; closing the last gives it back", () => {
    const p = page(1440);
    const made = takeStickyNote(target, PAPER, undefined, vi.fn())!;
    expect(p.props.get(DOCK_VAR)).toBe("376px");
    closeSticky(Object.values(useNotesStore.getState().notes)[0].id, made.id);
    expect(p.props.has(DOCK_VAR)).toBe(false);
  });

  it("scrolls the page by what the reflow moved the selection, so the selected words stay where the eyes are", () => {
    const p = page(1440);
    const scroll = vi.fn();
    takeStickyNote({ ...target, measure: () => ({ bounds: { top: p.top() } }) as never }, PAPER, undefined, scroll);
    expect(scroll).toHaveBeenCalledExactlyOnceWith(220);
  });

  it("with the explain window's reserve already standing nothing moves, so nothing is scrolled", () => {
    const p = page(1440);
    p.props.set(DOCK_VAR, "376px");
    const scroll = vi.fn();
    takeStickyNote({ ...target, measure: () => ({ bounds: { top: 520 } }) as never }, PAPER, undefined, scroll);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("under 1024 px nothing is reserved and nothing is scrolled", () => {
    const p = page(800);
    const scroll = vi.fn();
    takeStickyNote({ ...target, measure: () => ({ bounds: { top: p.top() } }) as never }, PAPER, undefined, scroll);
    expect(p.props.has(DOCK_VAR)).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("the stickies' module opens windows through the store that the reserve is bound to", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/sticky-note.tsx"), "utf8");
    expect(src).toContain("holdInPlace(");
    expect(src).not.toContain("reserveDock(");
  });
});
