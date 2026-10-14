import { beforeEach, describe, expect, it } from "vitest";
import { inlineMath } from "@/lib/text/math";
import { useNotesStore, readingNoteFor, locatePassage } from "./notes";

// P10-09a (review 7.1; ruling §1h.78 (f)): the paper's one note holds every sticky. `ensureReadingNote` makes the
// note without navigating and returns its id; `addSticky` appends "Note N" (an `h3` carrying `anchor`) and one empty
// text block, N = `stickyCount` + 1; `setStickyText` writes through into the sticky's own blocks.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };

describe("ensureReadingNote", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  // Re-aimed (§1c, P10-09e rule 1): the first block is the title line (an h1), no longer a paper card.
  it("makes the paper's note (its title line) the first time and returns its id", () => {
    const id = useNotesStore.getState().ensureReadingNote(PAPER);
    const note = useNotesStore.getState().notes[id];
    expect(note.paperId).toBe("p1");
    expect(note.blocks.map((b) => [b.type, b.text])).toEqual([["h1", "A Paper"]]);
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

// P10-09f (review 7.1c; walk X-B3, B11; rule 1): the anchor knows where the words are. `start` / `end` are the
// character offsets of the selection in the paragraph's text (the string the body renders), found by locating the
// passage in the paragraph at creation — the first occurrence; not found whole, they are absent.
describe("locatePassage", () => {
  it("finds the passage's first occurrence in the paragraph", () => {
    const paragraph = "Creep limits the life. Grain boundaries carry the strain. Grain boundaries slide.";
    expect(locatePassage(paragraph, "Grain boundaries")).toEqual({ start: 23, end: 39 });
    expect(paragraph.slice(23, 39)).toBe("Grain boundaries");
  });

  it("matches across the paragraph's own white space (the passage arrives collapsed)", () => {
    const paragraph = "The finest  grains\ncrept fastest.";
    const hit = locatePassage(paragraph, "finest grains crept");
    expect(hit && paragraph.slice(hit.start, hit.end)).toBe("finest  grains\ncrept");
  });

  it("is null when the passage is not found whole, or is empty", () => {
    expect(locatePassage("Creep limits the life.", "Creep limits the wear")).toBeNull();
    expect(locatePassage("Creep limits the life.", "   ")).toBeNull();
  });

  it("never lands inside a formula: a formula's TeX is not the paragraph's prose", () => {
    const paragraph = `The load ${inlineMath("grain size")} meets the grain size twice.`;
    const hit = locatePassage(paragraph, "grain size");
    expect(hit).not.toBeNull();
    expect(hit!.start).toBe(paragraph.lastIndexOf("grain size"));
    expect(locatePassage(`A ${inlineMath("x y")} B`, "x y")).toBeNull();
  });
});

describe("addSticky — the selection's place", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const PARAGRAPH = "Creep limits the life of hot parts. The finest grains crept fastest when annealed.";

  it("stores start and end beside the quote when it is handed the paragraph's text", () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const sticky = addSticky(id, { ...AT, passage: "finest grains crept", paragraphText: PARAGRAPH });
    const anchor = useNotesStore.getState().notes[id].blocks.find((b) => b.id === sticky?.id)?.anchor;
    expect(anchor).toEqual({ paperId: "p1", paragraphId: AT.paragraphId, quote: "finest grains crept", n: 1, start: 40, end: 59 });
    expect(PARAGRAPH.slice(anchor!.start, anchor!.end)).toBe("finest grains crept");
  });

  it("leaves start and end out when the passage is not found whole, or no paragraph text came", () => {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const id = ensureReadingNote(PAPER);
    const lost = addSticky(id, { ...AT, passage: "grains crept slowest", paragraphText: PARAGRAPH });
    const none = addSticky(id, { ...AT, passage: "finest grains" });
    const blocks = useNotesStore.getState().notes[id].blocks;
    for (const made of [lost, none]) {
      const anchor = blocks.find((b) => b.id === made?.id)?.anchor;
      expect(anchor).toBeDefined();
      expect("start" in anchor!).toBe(false);
      expect("end" in anchor!).toBe(false);
    }
  });
});
