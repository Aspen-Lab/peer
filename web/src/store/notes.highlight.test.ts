import { beforeEach, describe, expect, it } from "vitest";
import { anchorMap, block, highlightBlock, readHighlight, stickyBlocks } from "@/lib/notes/blocks";
import type { Block, HighlightSpot } from "@/lib/notes/types";
import { inlineMath } from "@/lib/text/math";
import { useWindows } from "@/lib/reader/windows";
import { removeEmptyStickies } from "@/components/notes/sticky-note";
import {
  NOTES_STORE_VERSION,
  locatePassage,
  migrateNotes,
  readingNoteFor,
  repairAnchors,
  resolveAnchors,
  useNotesStore,
  withoutSticky,
} from "./notes";

// P11-07 (owner item 8; B P11-04 §2.2, §2.6–§2.8; invariants I2, I5, I6, I8, I9, I10, I12): a highlight is a block of the
// paper's note. `addHighlight` makes it only when the passage is found whole — at the occurrence the reader selected, by the
// offset hint — and never twice for one range; `setHighlightColour` and `removeHighlight` change it; the stickies' machinery
// never takes one, and a repaired anchor is written back into `highlight`. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const PARAGRAPH = "paper-section-1-p2";
// "the tide pools" stands twice: at 4 and at 45.
const TEXT = "See the tide pools at dawn. Later the tide pools were bare, and the snails were gone.";
const FIRST = TEXT.indexOf("the tide pools");
const SECOND = TEXT.lastIndexOf("the tide pools");
const AT = { paperId: "p1", paragraphId: PARAGRAPH, passage: "the tide pools", paragraphText: TEXT };

const state = () => useNotesStore.getState();
const noteId = () => state().ensureReadingNote(PAPER);
const noteOf = () => readingNoteFor(state().notes, "p1")!;
const highlights = () => noteOf().blocks.filter((b) => b.type === "highlight");
const blocksOf = (id: string) => state().notes[id].blocks;

describe("locatePassage — the hint picks the occurrence", () => {
  it("is as before without a hint: the first occurrence, or the first at or after `from`", () => {
    expect(locatePassage(TEXT, "the tide pools")).toEqual({ start: FIRST, end: FIRST + 14 });
    expect(locatePassage(TEXT, "the tide pools", FIRST + 1)).toEqual({ start: SECOND, end: SECOND + 14 });
    expect(locatePassage(TEXT, "the tide pools", SECOND + 1)).toBeNull();
  });

  it("returns the occurrence nearest the hint: the second when the hint stands there", () => {
    expect(FIRST).not.toBe(SECOND);
    expect(locatePassage(TEXT, "the tide pools", 0, SECOND)).toEqual({ start: SECOND, end: SECOND + 14 });
    expect(locatePassage(TEXT, "the tide pools", 0, SECOND + 5)).toEqual({ start: SECOND, end: SECOND + 14 });
    expect(locatePassage(TEXT, "the tide pools", 0, FIRST)).toEqual({ start: FIRST, end: FIRST + 14 });
    expect(locatePassage(TEXT, "the tide pools", 0, 0)).toEqual({ start: FIRST, end: FIRST + 14 });
  });

  it("takes the nearer of two when the hint stands between them, the earlier on a tie, and the last for a hint past the end", () => {
    const middle = Math.round((FIRST + SECOND) / 2);
    const nearerFirst = locatePassage(TEXT, "the tide pools", 0, middle - 1)!;
    const nearerSecond = locatePassage(TEXT, "the tide pools", 0, middle + 1)!;
    expect(nearerFirst.start).toBe(FIRST);
    expect(nearerSecond.start).toBe(SECOND);
    expect(locatePassage("ab ab", "ab", 0, 1)).toEqual({ start: 0, end: 2 }); // 1 is 1 from 0 and 2 from 3
    expect(locatePassage("ab ab", "ab", 0, 2)).toEqual({ start: 3, end: 5 }); // 2 is 2 from 0 and 1 from 3
    expect(locatePassage("a a", "a", 0, 1)).toEqual({ start: 0, end: 1 }); // equally near: the earlier
    expect(locatePassage(TEXT, "the tide pools", 0, 10_000)).toEqual({ start: SECOND, end: SECOND + 14 });
  });

  it("is only a hint: never required, never the cause of no result", () => {
    expect(locatePassage(TEXT, "the tide pools", 0, -50)?.start).toBe(FIRST);
    expect(locatePassage(TEXT, "the tide pools", 0, Number.NaN)?.start).toBe(FIRST);
    expect(locatePassage(TEXT, "the snails", 0, 3)).toEqual({ start: TEXT.indexOf("the snails"), end: TEXT.indexOf("the snails") + 10 });
    expect(locatePassage(TEXT, "no such words", 0, 3)).toBeNull();
  });

  it("keeps `from`: an occurrence before it is not offered, whatever the hint", () => {
    expect(locatePassage(TEXT, "the tide pools", FIRST + 1, FIRST)?.start).toBe(SECOND);
  });

  it("matches white space flexibly and finds no match inside a formula, hint or not", () => {
    const spaced = "the  tide\npools and the tide pools";
    expect(locatePassage(spaced, "the tide pools", 0, 30)).toEqual({ start: spaced.lastIndexOf("the tide pools"), end: spaced.length });
    expect(locatePassage(spaced, "the tide pools", 0, 0)).toEqual({ start: 0, end: "the  tide\npools".length });
    const math = `${inlineMath("the tide pools")} and the tide pools`;
    expect(locatePassage(math, "the tide pools", 0, 0)?.start).toBe(math.lastIndexOf("the tide pools"));
  });
});

describe("addHighlight", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("appends a highlight block to the note: no text, the whole passage, its range, Yellow", () => {
    const id = noteId();
    const before = blocksOf(id).length;
    const made = state().addHighlight(id, { ...AT, hint: FIRST });
    expect(made).toEqual({ id: expect.any(String), created: true });
    const blocks = blocksOf(id);
    expect(blocks).toHaveLength(before + 1);
    expect(blocks[before]).toMatchObject({ id: made?.id, type: "highlight", text: "" });
    expect(blocks[before].highlight).toEqual({ paperId: "p1", paragraphId: PARAGRAPH, quote: "the tide pools", start: FIRST, end: FIRST + 14, colour: "yellow" });
    expect(blocks[before].anchor).toBeUndefined();
  });

  it("lights the occurrence the reader selected, not the first one (I10)", () => {
    const id = noteId();
    const made = state().addHighlight(id, { ...AT, hint: SECOND });
    const spot = readHighlight(blocksOf(id).find((b) => b.id === made?.id))!;
    expect([spot.start, spot.end]).toEqual([SECOND, SECOND + 14]);
    expect(TEXT.slice(spot.start, spot.end)).toBe("the tide pools");
    // without a hint it is the first, as a sticky is
    const other = state().addHighlight(id, { ...AT });
    expect(readHighlight(blocksOf(id).find((b) => b.id === other?.id))?.start).toBe(FIRST);
  });

  it("keeps the passage whitespace-collapsed as the quote, and its range over the paragraph's own white space", () => {
    const id = noteId();
    const text = "Wave  action\nshaped the shore, and the shore shaped the snails.";
    const made = state().addHighlight(id, { ...AT, paragraphText: text, passage: "  action   shaped\nthe shore " });
    const spot = readHighlight(blocksOf(id).find((b) => b.id === made?.id))!;
    expect(spot.quote).toBe("action shaped the shore");
    expect(text.slice(spot.start, spot.end)).toBe("action\nshaped the shore");
  });

  it("takes a tag's text out of the passage, as a sticky does (P10-24)", () => {
    const id = noteId();
    const made = state().addHighlight(id, { ...AT, passage: "the⁠[2] tide pools", hint: FIRST });
    expect(readHighlight(blocksOf(id).find((b) => b.id === made?.id))?.quote).toBe("the tide pools");
  });

  it("takes the colour asked for, and Yellow for a colour it does not know", () => {
    const id = noteId();
    const blue = state().addHighlight(id, { ...AT, hint: FIRST, colour: "blue" });
    const odd = state().addHighlight(id, { ...AT, hint: SECOND, colour: "mauve" as unknown as "blue" });
    expect(readHighlight(blocksOf(id).find((b) => b.id === blue?.id))?.colour).toBe("blue");
    expect(readHighlight(blocksOf(id).find((b) => b.id === odd?.id))?.colour).toBe("yellow");
  });

  it("is not made when the passage is not found whole in the paragraph (I9), and the note is untouched", () => {
    const id = noteId();
    const note = state().notes[id];
    expect(state().addHighlight(id, { ...AT, passage: "the tide pools and the snails" })).toBeNull();
    expect(state().addHighlight(id, { ...AT, passage: "not in this paragraph" })).toBeNull();
    expect(state().addHighlight(id, { ...AT, passage: "   " })).toBeNull();
    expect(state().notes[id]).toBe(note);
  });

  // RE-AIMED (§1c), P11-47 (ruling §1h.148 rule 1): this test said a passage over 1,200 characters is not made. It is now, whole (`notes.highlight.long.test.ts`); what is kept is that none is
  // made without the paragraph's text or for a note that is not there, and that 1,200 characters still is.
  it("is not made without the paragraph's text or for a note that is not there; a passage over 1,200 characters is, whole", () => {
    const id = noteId();
    const note = state().notes[id];
    expect(state().addHighlight(id, { ...AT, paragraphText: undefined })).toBeNull();
    expect(state().addHighlight("missing", AT)).toBeNull();
    const long = "word ".repeat(300).trim();
    expect(long.length).toBeGreaterThan(1200);
    expect(state().notes[id]).toBe(note);
    expect(state().addHighlight(id, { ...AT, passage: long, paragraphText: long })).toMatchObject({ created: true });
    expect(readHighlight(highlights()[0])?.quote).toBe(long);
    useNotesStore.setState({ notes: {} });
    const again = noteId();
    const fits = "w".repeat(1200);
    expect(state().addHighlight(again, { ...AT, passage: fits, paragraphText: `x ${fits} y` })).toMatchObject({ created: true });
  });

  it("is not made inside a formula's TeX", () => {
    const id = noteId();
    const math = `We set ${inlineMath("a b c")} here, then a b c again.`;
    const made = state().addHighlight(id, { ...AT, paragraphText: math, passage: "a b c", hint: 0 });
    const spot = readHighlight(blocksOf(id).find((b) => b.id === made?.id))!;
    expect(spot.start).toBe(math.lastIndexOf("a b c"));
    expect(state().addHighlight(id, { ...AT, paragraphText: `only ${inlineMath("a b c")}`, passage: "a b c" })).toBeNull();
  });

  it("returns the existing highlight for an identical range, with created false — no duplicate, no recolour (I9)", () => {
    const id = noteId();
    const first = state().addHighlight(id, { ...AT, hint: SECOND, colour: "pink" })!;
    const note = state().notes[id];
    const again = state().addHighlight(id, { ...AT, hint: SECOND, colour: "green" });
    expect(again).toEqual({ id: first.id, created: false });
    expect(highlights()).toHaveLength(1);
    expect(readHighlight(highlights()[0])?.colour).toBe("pink");
    expect(state().notes[id]).toBe(note);
  });

  it("makes another for the same words at another place, and for an overlapping range", () => {
    const id = noteId();
    const a = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const b = state().addHighlight(id, { ...AT, hint: SECOND })!;
    const c = state().addHighlight(id, { ...AT, passage: "tide pools at dawn", hint: FIRST })!;
    expect([a.created, b.created, c.created]).toEqual([true, true, true]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(highlights()).toHaveLength(3);
  });

  it("does not take another paragraph's, or another paper's, identical range for a duplicate", () => {
    const id = noteId();
    state().addHighlight(id, { ...AT, hint: FIRST });
    expect(state().addHighlight(id, { ...AT, paragraphId: "paper-section-2-p0", hint: FIRST })?.created).toBe(true);
    expect(state().addHighlight(id, { ...AT, paperId: "p2", hint: FIRST })?.created).toBe(true);
    expect(highlights()).toHaveLength(3);
  });

  it("stamps the note's updatedAt, and changes nothing else of it", () => {
    const id = noteId();
    const note = state().notes[id];
    state().addHighlight(id, { ...AT, hint: FIRST });
    const after = state().notes[id];
    expect(after.updatedAt >= note.updatedAt).toBe(true);
    expect({ ...after, blocks: undefined, updatedAt: undefined }).toEqual({ ...note, blocks: undefined, updatedAt: undefined });
    expect(after.blocks.slice(0, note.blocks.length)).toEqual(note.blocks);
  });
});

describe("a highlight never counts as a sticky (I5)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("leaves the next sticky's number alone: Note 1 after any number of highlights, then Note 2", () => {
    const id = noteId();
    state().addHighlight(id, { ...AT, hint: FIRST });
    state().addHighlight(id, { ...AT, hint: SECOND });
    expect(state().notes[id].stickyCount ?? 0).toBe(0);
    const first = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT });
    state().addHighlight(id, { ...AT, passage: "the snails", hint: 0 });
    const second = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "tide", paragraphText: TEXT });
    expect([first?.n, second?.n]).toEqual([1, 2]);
    expect(state().notes[id].stickyCount).toBe(2);
    expect(blocksOf(id).filter((b) => b.anchor).map((b) => b.anchor?.n)).toEqual([1, 2]);
  });
});

describe("setHighlightColour", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("recolours that highlight and nothing else", () => {
    const id = noteId();
    const a = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const b = state().addHighlight(id, { ...AT, hint: SECOND })!;
    const before = blocksOf(id);
    state().setHighlightColour(id, b.id, "orange");
    const after = blocksOf(id);
    expect(readHighlight(after.find((x) => x.id === b.id))?.colour).toBe("orange");
    expect(readHighlight(after.find((x) => x.id === a.id))?.colour).toBe("yellow");
    expect(after.find((x) => x.id === a.id)).toBe(before.find((x) => x.id === a.id));
    const was = readHighlight(before.find((x) => x.id === b.id))!;
    expect({ ...readHighlight(after.find((x) => x.id === b.id))!, colour: "yellow" }).toEqual(was);
    expect(after).toHaveLength(before.length);
  });

  it("is a no-op for the same colour, a colour the table does not know, and a block that is not a highlight", () => {
    const id = noteId();
    const a = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const note = state().notes[id];
    state().setHighlightColour(id, a.id, "yellow");
    state().setHighlightColour(id, a.id, "mauve" as unknown as "blue");
    state().setHighlightColour(id, sticky.id, "blue");
    state().setHighlightColour(id, blocksOf(id)[0].id, "blue");
    state().setHighlightColour(id, "missing", "blue");
    state().setHighlightColour("missing", a.id, "blue");
    expect(state().notes[id]).toBe(note);
    expect(noteOf().blocks.find((b) => b.id === sticky.id)?.highlight).toBeUndefined();
  });
});

describe("removeHighlight", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("takes that highlight out and leaves every other block as it was", () => {
    const id = noteId();
    const a = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const b = state().addHighlight(id, { ...AT, hint: SECOND })!;
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const before = blocksOf(id);
    state().removeHighlight(id, a.id);
    const after = blocksOf(id);
    expect(after.map((x) => x.id)).toEqual(before.filter((x) => x.id !== a.id).map((x) => x.id));
    for (const x of after) expect(x).toBe(before.find((y) => y.id === x.id));
    expect(after.some((x) => x.id === b.id) && after.some((x) => x.id === sticky.id)).toBe(true);
    expect(anchorMap(noteOf(), "p1")[PARAGRAPH].map((s) => s.id)).toEqual([b.id, sticky.id]);
  });

  it("takes out no block that is not a highlight, and does nothing for an id or a note that is not there", () => {
    const id = noteId();
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const note = state().notes[id];
    state().removeHighlight(id, sticky.id);
    state().removeHighlight(id, blocksOf(id)[0].id);
    state().removeHighlight(id, "missing");
    expect(() => state().removeHighlight("missing", sticky.id)).not.toThrow();
    expect(state().notes[id]).toBe(note);
  });

  it("is how a highlight made once can be made again: the range is free after the removal", () => {
    const id = noteId();
    const first = state().addHighlight(id, { ...AT, hint: FIRST })!;
    state().removeHighlight(id, first.id);
    const again = state().addHighlight(id, { ...AT, hint: FIRST })!;
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
  });
});

describe("the stickies' removals never take a highlight (I6)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });

  const SPOT: HighlightSpot = { paperId: "p1", paragraphId: PARAGRAPH, quote: "the snails", start: 0, end: 10, colour: "yellow" };

  it("withoutSticky finds no sticky at a highlight's id, and removes an empty sticky without the highlight next to it", () => {
    const { header, blocks } = stickyBlocks({ paperId: "p1", paragraphId: PARAGRAPH, quote: "q", n: 1 });
    const mark = highlightBlock(SPOT);
    const all = [...blocks, mark, block("text", "after")];
    expect(withoutSticky(all, mark.id)).toBe(all);
    expect(withoutSticky(all, header.id).map((b) => b.id)).toEqual([mark.id, all[3].id]);
    expect(withoutSticky([header, mark, block("text")], header.id).map((b) => b.id)).toContain(mark.id);
  });

  it("removeEmptySticky at a highlight's id leaves the note as it is; at an empty sticky's, the highlight stays", () => {
    const id = noteId();
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const mark = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const note = state().notes[id];
    state().removeEmptySticky(id, mark.id);
    expect(state().notes[id]).toBe(note);
    state().removeEmptySticky(id, sticky.id);
    expect(blocksOf(id).some((b) => b.id === sticky.id)).toBe(false);
    expect(blocksOf(id).some((b) => b.id === mark.id)).toBe(true);
  });

  it("a stale save that still holds the empty sticky is cleaned of it, not of the highlight (P10-29)", () => {
    const id = noteId();
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const mark = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const stale = [...blocksOf(id)];
    state().removeEmptySticky(id, sticky.id);
    state().save(id, { blocks: stale });
    expect(blocksOf(id).some((b) => b.id === sticky.id)).toBe(false);
    expect(blocksOf(id).some((b) => b.id === mark.id)).toBe(true);
  });

  it("removeEmptyStickies, on leaving the page, takes the empty stickies and keeps every highlight — even one a window names", () => {
    const id = noteId();
    const empty = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const mark = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const odd = state().addHighlight(id, { ...AT, hint: SECOND })!;
    useWindows.getState().open({ id: empty.id, kind: "sticky", title: "Note 1" });
    useWindows.getState().open({ id: odd.id, kind: "sticky", title: "?" }); // a window that should never name a highlight
    removeEmptyStickies("p1");
    expect(blocksOf(id).some((b) => b.id === empty.id)).toBe(false);
    expect(blocksOf(id).filter((b) => b.type === "highlight").map((b) => b.id)).toEqual([mark.id, odd.id]);
  });
});

describe("repairAnchors writes a repaired highlight back into `highlight` (P10-35 for highlights)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  // The paper's paragraphs moved: the paragraph that was `paper-section-1-p2` is now `paper-section-1-p3`.
  const MOVED = [{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", "Something new.", TEXT] }];
  const OLD_PARAGRAPH = "paper-section-1-p2";

  it("moves the paragraph id and the range of a highlight whose words moved, and writes nothing into `anchor`", () => {
    const id = noteId();
    const made = state().addHighlight(id, { ...AT, hint: SECOND })!;
    const { map, fixes, lost } = resolveAnchors(MOVED, anchorMap(noteOf(), "p1"));
    expect(lost).toEqual([]);
    expect(fixes).toEqual([{ id: made.id, was: { paragraphId: OLD_PARAGRAPH, start: SECOND, end: SECOND + 14 }, paragraphId: "paper-section-1-p3", start: SECOND, end: SECOND + 14 }]);
    expect(map["paper-section-1-p3"][0]).toMatchObject({ id: made.id, n: 0, colour: "yellow" });
    const before = state().notes[id];
    repairAnchors(fixes);
    const stored = blocksOf(id).find((b) => b.id === made.id)!;
    expect(stored.highlight).toEqual({ paperId: "p1", paragraphId: "paper-section-1-p3", quote: "the tide pools", start: SECOND, end: SECOND + 14, colour: "yellow" });
    expect(stored.anchor).toBeUndefined();
    expect(stored.type).toBe("highlight");
    expect(state().notes[id].updatedAt).toBe(before.updatedAt); // a repair is not the reader's edit
  });

  it("finds the occurrence nearest where it stood when the words moved to a paragraph that holds them twice", () => {
    const id = noteId();
    const made = state().addHighlight(id, { ...AT, hint: SECOND })!;
    const { fixes } = resolveAnchors(MOVED, anchorMap(noteOf(), "p1"));
    repairAnchors(fixes);
    expect(readHighlight(blocksOf(id).find((b) => b.id === made.id))).toMatchObject({ start: SECOND, end: SECOND + 14 });
  });

  it("repairs a sticky and a highlight in the same pass, each in its own field", () => {
    const id = noteId();
    const sticky = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: "the snails", paragraphText: TEXT })!;
    const mark = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const { fixes } = resolveAnchors(MOVED, anchorMap(noteOf(), "p1"));
    expect(fixes.map((f) => f.id).sort()).toEqual([sticky.id, mark.id].sort());
    repairAnchors(fixes);
    const head = blocksOf(id).find((b) => b.id === sticky.id)!;
    expect(head.anchor?.paragraphId).toBe("paper-section-1-p3");
    expect(head.highlight).toBeUndefined();
    expect(readHighlight(blocksOf(id).find((b) => b.id === mark.id))?.paragraphId).toBe("paper-section-1-p3");
  });

  it("leaves a highlight that changed since the fix was worked out, and one whose words are gone", () => {
    const id = noteId();
    const made = state().addHighlight(id, { ...AT, hint: FIRST })!;
    const { fixes } = resolveAnchors(MOVED, anchorMap(noteOf(), "p1"));
    state().setHighlightColour(id, made.id, "blue"); // an unrelated change keeps the fix valid
    // but a highlight moved by something else meanwhile is not overwritten
    useNotesStore.setState((s) => ({
      notes: { ...s.notes, [id]: { ...s.notes[id], blocks: s.notes[id].blocks.map((b) => (b.id === made.id ? { ...b, highlight: { ...b.highlight!, start: 1, end: 15 } } : b)) } },
    }));
    repairAnchors(fixes);
    expect(readHighlight(blocksOf(id).find((b) => b.id === made.id))).toMatchObject({ paragraphId: PARAGRAPH, start: 1, end: 15, colour: "blue" });
    const gone = resolveAnchors([{ paragraphs: ["Nothing here."] }], anchorMap(noteOf(), "p1"));
    expect(gone.lost).toEqual([made.id]);
    expect(gone.fixes).toEqual([]);
    expect(gone.map).toEqual({});
  });

  it("does not write when nothing moved", () => {
    const id = noteId();
    state().addHighlight(id, { ...AT, hint: FIRST });
    const note = state().notes[id];
    const body = [{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", TEXT] }];
    const { fixes } = resolveAnchors(body, anchorMap(note, "p1"));
    expect(fixes).toEqual([]);
    repairAnchors(fixes);
    expect(state().notes[id]).toBe(note);
  });
});

describe("no store version, no migration (§2.7)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("keeps NOTES_STORE_VERSION at 2 and leaves a store holding highlights as it is", () => {
    expect(NOTES_STORE_VERSION).toBe(2);
    const id = noteId();
    state().addHighlight(id, { ...AT, hint: SECOND, colour: "ink" });
    const persisted = JSON.parse(JSON.stringify({ notes: state().notes })) as { notes: Record<string, { blocks: Block[] }> };
    expect(migrateNotes(persisted, 2)).toBe(persisted);
    expect(readHighlight(persisted.notes[id].blocks.find((b) => b.type === "highlight"))).toMatchObject({ colour: "ink", start: SECOND });
  });

  it("keeps a reading note's highlights when an older store is migrated", () => {
    const id = noteId();
    state().save(id, { blocks: [block("h1", "A Paper"), highlightBlock({ paperId: "p1", paragraphId: PARAGRAPH, quote: "x", start: 0, end: 1, colour: "pink" })] });
    const migrated = migrateNotes({ notes: state().notes }, 1) as { notes: Record<string, { blocks: Block[] }> };
    expect(migrated.notes[id].blocks.map((b) => b.type)).toEqual(["h1", "highlight"]);
  });

  it("reads a stored highlight with a colour the table no longer has as yellow, and draws a broken one nowhere", () => {
    const id = noteId();
    const odd = { ...highlightBlock({ paperId: "p1", paragraphId: PARAGRAPH, quote: "the snails", start: 0, end: 10, colour: "yellow" }), highlight: { paperId: "p1", paragraphId: PARAGRAPH, quote: "the snails", start: 0, end: 10, colour: "teal" } } as unknown as Block;
    const broken = { id: "broken", type: "highlight", text: "", highlight: "garbage" } as unknown as Block;
    state().save(id, { blocks: [...blocksOf(id), odd, broken] });
    const map = anchorMap(noteOf(), "p1");
    expect(map[PARAGRAPH]).toHaveLength(1);
    expect(map[PARAGRAPH][0]).toMatchObject({ id: odd.id, colour: "yellow" });
  });
});
