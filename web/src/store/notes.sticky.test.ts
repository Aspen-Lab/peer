import { beforeEach, describe, expect, it } from "vitest";
import { useNotesStore, readingNoteFor } from "./notes";

// P10-09a (review 7.1; ruling §1h.78 (f)): the paper's one note holds every sticky. `ensureReadingNote` makes the
// note without navigating and returns its id; `addSticky` appends "Note N" (an `h3` carrying `anchor`) and one empty
// text block, N = `stickyCount` + 1; `setStickyText` writes through into the sticky's own blocks.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };

describe("ensureReadingNote", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("makes the paper's note from the template the first time and returns its id", () => {
    const id = useNotesStore.getState().ensureReadingNote(PAPER);
    const note = useNotesStore.getState().notes[id];
    expect(note.paperId).toBe("p1");
    expect(note.blocks[0].type).toBe("paper");
    expect(readingNoteFor(useNotesStore.getState().notes, "p1")?.id).toBe(id);
  });

  it("returns the same note afterwards and makes no second", () => {
    const first = useNotesStore.getState().ensureReadingNote(PAPER);
    const second = useNotesStore.getState().ensureReadingNote(PAPER);
    expect(second).toBe(first);
    expect(Object.keys(useNotesStore.getState().notes)).toHaveLength(1);
  });
});

describe("addSticky", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("appends Note N at the end of the note: an anchored h3 and an empty text block", () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const before = useNotesStore.getState().notes[id].blocks.length;
    const sticky = addSticky(id, AT);
    const note = useNotesStore.getState().notes[id];
    expect(sticky?.n).toBe(1);
    expect(note.blocks).toHaveLength(before + 2);
    const head = note.blocks[before];
    expect(head).toMatchObject({ id: sticky?.id, type: "h3", text: "Note 1" });
    expect(head.anchor).toEqual({ paperId: "p1", paragraphId: AT.paragraphId, quote: AT.passage, n: 1 });
    expect(note.blocks[before + 1]).toMatchObject({ type: "text", text: "" });
    expect(note.stickyCount).toBe(1);
  });

  it("numbers 1, 2, 3 in the order made, and a deleted sticky's number is not given again", () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const a = addSticky(id, AT);
    addSticky(id, { ...AT, paragraphId: "paper-section-0-p0" });
    const blocks = useNotesStore.getState().notes[id].blocks.filter((b) => b.id !== a?.id);
    useNotesStore.getState().save(id, { blocks });
    const c = addSticky(id, AT);
    expect(c?.n).toBe(3);
    const numbers = useNotesStore.getState().notes[id].blocks.filter((b) => b.anchor).map((b) => b.anchor?.n);
    expect(numbers).toEqual([2, 3]);
  });

  it("keeps the quote at 300 characters, the passage's start", () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const passage = "x".repeat(50).concat(" ", "y".repeat(500));
    const sticky = addSticky(id, { ...AT, passage });
    const head = useNotesStore.getState().notes[id].blocks.find((b) => b.id === sticky?.id);
    expect(head?.anchor?.quote.length).toBeLessThanOrEqual(300);
    expect(passage.startsWith(head?.anchor?.quote ?? "?")).toBe(true);
  });

  it("does nothing for a note that is not there", () => {
    expect(useNotesStore.getState().addSticky("missing", AT)).toBeNull();
  });
});

describe("setStickyText", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("writes the sticky's paragraphs as its own text blocks and touches nothing else", () => {
    const { ensureReadingNote, addSticky, setStickyText } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const one = addSticky(id, AT);
    const two = addSticky(id, { ...AT, paragraphId: "paper-section-0-p0" });
    setStickyText(id, one!.id, "first\nsecond");
    setStickyText(id, two!.id, "other");
    const blocks = useNotesStore.getState().notes[id].blocks;
    const from = blocks.findIndex((b) => b.id === one!.id);
    expect(blocks.slice(from).map((b) => `${b.type}:${b.text}`)).toEqual(["h3:Note 1", "text:first", "text:second", "h3:Note 2", "text:other"]);
  });

  it("stamps the note and ignores a note or a sticky that is not there", () => {
    const { ensureReadingNote, addSticky, setStickyText } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const one = addSticky(id, AT);
    const before = useNotesStore.getState().notes[id].blocks;
    setStickyText("missing", one!.id, "x");
    setStickyText(id, "missing", "x");
    expect(useNotesStore.getState().notes[id].blocks).toEqual(before);
  });
});
