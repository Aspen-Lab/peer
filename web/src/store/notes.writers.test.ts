import { beforeEach, describe, expect, it } from "vitest";
import { block, stickyText } from "@/lib/notes/blocks";
import { mergeText, readingNoteFor, useNotesStore } from "./notes";

// P10-29 (BACKLOG-71): two editors on one note. The sticky writes through `setStickyText` carrying the text it last saw
// (`base`); a write against a stale base is merged by block — the words only one side changed stay, the words both sides
// changed in the same place are the later write's. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };

describe("mergeText — three-way, by the words each side changed", () => {
  it("keeps both when the two sides changed different places", () => {
    expect(mergeText("one two three", "ONE two three", "one two THREE")).toBe("ONE two THREE");
  });

  it("keeps both when each side added words at the same place, the stored ones first, and a space between", () => {
    expect(mergeText("start ", "start beta", "start alpha")).toBe("start alpha beta");
    expect(mergeText("hi", "hi there", "hi all")).toBe("hi all there");
  });

  it("keeps the same text both sides arrived at once, and treats words that touch as one place (the later stands)", () => {
    expect(mergeText("a b", "a new b", "a new b")).toBe("a new b");
    expect(mergeText("a b", "a new b", "a new b!")).toBe("a new b");
  });

  it("where both rewrote the same words, the later (the writer's own) stands", () => {
    expect(mergeText("the old words", "the mine words", "the theirs words")).toBe("the mine words");
  });

  it("is the other side when only one changed, and never splits a pair of surrogates", () => {
    expect(mergeText("same", "same", "changed")).toBe("changed");
    expect(mergeText("same", "changed", "same")).toBe("changed");
    expect(mergeText("x \u{1F600}", "x \u{1F601}", "y \u{1F600}")).toBe("y \u{1F601}");
  });
});

describe("setStickyText against a stale base — two writers on one note", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const setup = () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const made = addSticky(noteId, AT)!;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    return { noteId, made, blocks };
  };

  it("the same block: the window's words and the sticky's words, typed within half a second, both stay", () => {
    const { noteId, made, blocks } = setup();
    useNotesStore.getState().setStickyText(noteId, made.id, "first line");
    // The window's editor saves its words into the sticky's own block...
    useNotesStore.getState().save(noteId, { blocks: blocks().map((b) => (b.text === "first line" ? { ...b, text: "window: first line" } : b)) });
    // ...while the sticky, which last saw "first line", writes its own typing.
    useNotesStore.getState().setStickyText(noteId, made.id, "first line, sticky", "first line");
    expect(stickyText(blocks(), made.id)).toBe("window: first line, sticky");
  });

  it("the same block, the same place: both words stay", () => {
    const { noteId, made, blocks } = setup();
    useNotesStore.getState().setStickyText(noteId, made.id, "base");
    useNotesStore.getState().save(noteId, { blocks: blocks().map((b) => (b.text === "base" ? { ...b, text: "base alpha" } : b)) });
    useNotesStore.getState().setStickyText(noteId, made.id, "base beta", "base");
    expect(stickyText(blocks(), made.id)).toBe("base alpha beta");
  });

  it("different blocks: a paragraph the window changed and one the sticky changed both stay", () => {
    const { noteId, made, blocks } = setup();
    useNotesStore.getState().setStickyText(noteId, made.id, "para one\npara two");
    useNotesStore.getState().save(noteId, { blocks: blocks().map((b) => (b.text === "para one" ? { ...b, text: "para one, window" } : b)) });
    useNotesStore.getState().setStickyText(noteId, made.id, "para one\npara two, sticky", "para one\npara two");
    expect(stickyText(blocks(), made.id)).toBe("para one, window\npara two, sticky");
  });

  it("a block both rewrote is the later write's only for that block; the other block keeps the window's edit", () => {
    const { noteId, made, blocks } = setup();
    useNotesStore.getState().setStickyText(noteId, made.id, "alpha\nbeta");
    useNotesStore.getState().save(noteId, {
      blocks: blocks().map((b) => (b.text === "alpha" ? { ...b, text: "omega" } : b.text === "beta" ? { ...b, text: "window beta" } : b)),
    });
    useNotesStore.getState().setStickyText(noteId, made.id, "gamma\nbeta", "alpha\nbeta");
    expect(stickyText(blocks(), made.id)).toBe("gamma\nwindow beta");
  });

  it("a write with no base, or with the base that is stored, is a plain write", () => {
    const { noteId, made, blocks } = setup();
    useNotesStore.getState().setStickyText(noteId, made.id, "one");
    useNotesStore.getState().setStickyText(noteId, made.id, "two", "one");
    expect(stickyText(blocks(), made.id)).toBe("two");
    useNotesStore.getState().setStickyText(noteId, made.id, "three");
    expect(stickyText(blocks(), made.id)).toBe("three");
  });

  it("touches nothing else in the note", () => {
    const { noteId, made, blocks } = setup();
    const other = block("text", "elsewhere, in the window");
    useNotesStore.getState().save(noteId, { blocks: [...blocks(), block("h2", "From the window"), other] });
    useNotesStore.getState().setStickyText(noteId, made.id, "sticky words", "");
    expect(blocks().find((b) => b.id === other.id)?.text).toBe("elsewhere, in the window");
    expect(stickyText(blocks(), made.id)).toBe("sticky words");
  });
});

describe("removeEmptySticky — an empty sticky is taken out with its anchor, once", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("removes a sticky with no words and keeps its number spent; one with words stays", () => {
    const { ensureReadingNote, addSticky, setStickyText, removeEmptySticky } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const a = addSticky(noteId, AT)!;
    const b = addSticky(noteId, AT)!;
    setStickyText(noteId, a.id, "words");
    removeEmptySticky(noteId, a.id);
    removeEmptySticky(noteId, b.id);
    const note = useNotesStore.getState().notes[noteId];
    expect(note.blocks.some((x) => x.id === a.id)).toBe(true);
    expect(note.blocks.some((x) => x.id === b.id)).toBe(false);
    expect(note.blocks.some((x) => x.anchor?.n === 2)).toBe(false);
    expect(note.stickyCount).toBe(2);
    expect(addSticky(noteId, AT)?.n).toBe(3);
  });

  it("a stale copy saved after the removal (the window's flush on leaving) does not bring the empty sticky back", () => {
    const { ensureReadingNote, addSticky, removeEmptySticky, save } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const stale = useNotesStore.getState().notes[noteId].blocks;
    const b = addSticky(noteId, AT)!;
    const withEmpty = useNotesStore.getState().notes[noteId].blocks;
    removeEmptySticky(noteId, b.id);
    save(noteId, { blocks: [...withEmpty, block("h2", "From the window"), block("text", "typed in the window")] });
    const blocks = useNotesStore.getState().notes[noteId].blocks;
    expect(blocks.some((x) => x.id === b.id)).toBe(false);
    expect(blocks.some((x) => x.text === "typed in the window")).toBe(true);
    expect(stale.length).toBeLessThan(withEmpty.length);
  });

  it("a sticky the window gave words to is not brought back as empty, and not removed", () => {
    const { ensureReadingNote, addSticky, removeEmptySticky, save } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const b = addSticky(noteId, AT)!;
    const blocks = useNotesStore.getState().notes[noteId].blocks;
    save(noteId, { blocks: blocks.map((x, i) => (i === blocks.length - 1 ? { ...x, text: "window words" } : x)) });
    removeEmptySticky(noteId, b.id);
    expect(stickyText(readingNoteFor(useNotesStore.getState().notes, "p1")!.blocks, b.id)).toBe("window words");
  });
});
