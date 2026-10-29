import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickySpan, stickyText } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { STICKY_SAVE_MS, makeStickyWriter, stickyFollow, stickyHoldsFocus, takeStickyNote } from "./sticky-note";

// P12-66 rule 1 (B P12-52, M2 and M3; ruling §1h.437): focus stays put. The sticky follows the notes window's save by starting its editor afresh
// (a new `key`); the new editor used to take the focus whether or not the old one held it, so a reader typing in the window had the caret moved
// to the end of the sticky's block. Now it takes the focus back only if the old one held it. There is no DOM here, so the decision is tested as
// the functions the card calls, in the order the card calls them, on the real store; the page itself was driven by the Playwright run named in the
// checkpoint. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const QUOTE = "The finest grains crept fastest when the specimens were annealed at the lowest temperature of the series.";
const target = { sectionIndex: 0, paragraphIndex: 1, passage: QUOTE };
const source = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

/** The element the document says holds the focus, as far as the decision reads it: `closest` answers as the DOM does. */
const inside = (headerId: string) => ({
  closest: (selector: string) => (selector === "[data-sticky-editor]" ? { getAttribute: (name: string) => (name === "data-sticky-editor" ? headerId : null) } : null),
});
const elsewhere = { closest: () => null };

const contentOf = (blocks: readonly Block[], headerId: string): Block[] => {
  const span = stickySpan(blocks, headerId);
  return span ? blocks.slice(span.start + 1, span.end) : [];
};
/** The sticky's editor typed in: the same blocks with new words, owned by the sticky as the card's `onDoc` makes them. */
const typed = (blocks: readonly Block[], text: string, headerId: string): Block[] => blocks.map((b) => ({ ...b, text, stickyId: headerId }));

describe("stickyHoldsFocus — does the sticky's editor hold the focus (P12-66, rule 1)", () => {
  it("is true for an element inside this sticky's editor", () => {
    expect(stickyHoldsFocus(inside("h-1"), "h-1")).toBe(true);
  });

  it("is false for the notes window, the page, another sticky's editor, nothing at all", () => {
    expect(stickyHoldsFocus(elsewhere, "h-1")).toBe(false);
    expect(stickyHoldsFocus(inside("h-2"), "h-1")).toBe(false);
    expect(stickyHoldsFocus(null, "h-1")).toBe(false);
    expect(stickyHoldsFocus(undefined, "h-1")).toBe(false);
  });
});

describe("stickyFollow — the re-key decision, focus inside and outside the sticky (P12-66, rule 1)", () => {
  const writerOf = (pending: boolean) => ({ pending: () => pending, sync: vi.fn() });
  const stored = JSON.stringify([{ id: "b1", type: "text", text: "hello sticky bbb" }]);
  const shown = [{ id: "b1", type: "text", text: "hello sticky" }] as Block[];

  it("re-keys with the focus asked for when the sticky's editor held it", () => {
    expect(stickyFollow({ stored, content: shown, writer: writerOf(false), held: true })).toEqual({ content: JSON.parse(stored), refocus: true });
  });

  it("re-keys with no focus asked for when the focus is in the notes window, the page or the header: the reader's caret is not moved", () => {
    expect(stickyFollow({ stored, content: shown, writer: writerOf(false), held: false })).toEqual({ content: JSON.parse(stored), refocus: false });
  });
});

// The sequences of B P12-52, on the real store: the sticky's side is its writer and `stickyFollow` (with the focus asked of `stickyHoldsFocus`),
// the window's side is its whole-note save. `shown` is what the sticky's editor shows.
describe("a sticky and the notes window on one block (P12-66, rule 1; B P12-52 rows h, h2, b, c)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const made = takeStickyNote(target, PAPER)!;
    const noteId = readingNoteFor(useNotesStore.getState().notes, "p1")!.id;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    useNotesStore.getState().setStickyText(noteId, made.id, "hello sticky");
    const stored = () => JSON.stringify(contentOf(blocks(), made.id));
    // The card's own writer, as `StickyWindow` makes it.
    const writer = makeStickyWriter((next, base) => {
      useNotesStore.getState().setStickyBlocks(noteId, made.id, JSON.parse(next) as Block[], base ? (JSON.parse(base) as Block[]) : undefined);
      return stored();
    });
    writer.sync(stored());
    // The window's editor changes the sticky's block and its whole-note save lands.
    const windowSaves = (text: string) => {
      const span = stickySpan(blocks(), made.id)!;
      useNotesStore.getState().save(noteId, { blocks: blocks().map((b, i) => (i > span.start && i < span.end ? { ...b, text } : b)) });
    };
    return { made, blocks, stored, writer, windowSaves };
  };

  it("h, h2 (M2): the reader types in the window and pauses; every save of the window re-keys the sticky without asking for the focus, 5 of 5", () => {
    const { made, blocks, stored, writer, windowSaves } = setup();
    let shown = contentOf(blocks(), made.id);
    const words = ["hello sticky bbb", "hello sticky bbb ccc", "hello sticky bbb ccc ddd", "hello sticky bbb ccc ddd eee", "hello sticky bbb ccc ddd eee fff"];
    for (const text of words) {
      windowSaves(text); // the window's 500 ms save lands
      const step = stickyFollow({ stored: stored(), content: shown, writer, held: stickyHoldsFocus(elsewhere, made.id) });
      expect(step).not.toBeNull(); // the sticky still follows
      expect(step!.refocus).toBe(false); // and does not take the caret
      expect(step!.content.map((b) => b.text).join("\n")).toBe(text);
      shown = step!.content;
    }
  });

  it("the same save while the reader is in the sticky itself: the sticky takes the focus back", () => {
    const { made, blocks, stored, writer, windowSaves } = setup();
    const shown = contentOf(blocks(), made.id);
    windowSaves("hello sticky bbb");
    const step = stickyFollow({ stored: stored(), content: shown, writer, held: stickyHoldsFocus(inside(made.id), made.id) });
    expect(step?.refocus).toBe(true);
  });

  it("b, c (M3): the window's save lands over the sticky's pending key (no re-key); the sticky's own merged write re-keys it with the focus asked for", () => {
    const { made, blocks, stored, writer, windowSaves } = setup();
    // The sticky is typed in: its local copy runs ahead of the store, a write is waiting.
    let shown = typed(contentOf(blocks(), made.id), "hello sticky aaa", made.id);
    writer.push(JSON.stringify(shown));
    // The window's save lands meanwhile: nothing is followed while a key waits.
    windowSaves("hello sticky bbb");
    expect(stickyFollow({ stored: stored(), content: shown, writer, held: stickyHoldsFocus(inside(made.id), made.id) })).toBeNull();
    // The sticky's writer fires: the store holds both words, and the sticky's copy lacks the window's.
    vi.advanceTimersByTime(STICKY_SAVE_MS);
    const merged = stickyText(blocks(), made.id);
    expect(merged).toContain("aaa");
    expect(merged).toContain("bbb");
    const step = stickyFollow({ stored: stored(), content: shown, writer, held: stickyHoldsFocus(inside(made.id), made.id) });
    expect(step).not.toBeNull();
    // Re-keyed under the typing hand: the focus is asked for (and taken in the editor's own mount, rule 2), so the next key lands in it.
    expect(step!.refocus).toBe(true);
    expect(step!.content.map((b) => b.text).join("\n")).toBe(merged);
    shown = step!.content;
    // Idle again: the store and the editor agree, nothing more to follow.
    expect(stickyFollow({ stored: stored(), content: shown, writer, held: true })).toBeNull();
  });
});

// No DOM here: the card's markup is read as source. The page run (Playwright, in the checkpoint) is its behaviour.
describe("the card — the source (P12-66, rule 1)", () => {
  const card = source("./sticky-note.tsx");

  it("marks its editor's holder, records the focus in the render that re-keys, and asks the new editor for it only then", () => {
    expect(card).toContain("data-sticky-editor={row.id}");
    expect(card).toContain("const [refocus, setRefocus] = useState(true)"); // a new card opens ready to write in
    expect(card).toContain("autoFocus={refocus}");
    const branch = card.slice(card.indexOf("if (stored !== seen) {"), card.indexOf("useEffect(() => registerStickyWriter"));
    expect(branch).toContain("stickyHoldsFocus(");
    expect(branch).toContain("setRefocus(step.refocus)");
    expect(branch).toContain("setEditorVersion((v) => v + 1)");
    expect(card).not.toMatch(/<NoteEditor key=\{editorVersion\} compact transient autoFocus\n/);
  });
});
