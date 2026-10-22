import { beforeEach, describe, expect, it } from "vitest";
import { anchorMap, highlightBlock, readHighlight, STICKY_QUOTE_MAX } from "@/lib/notes/blocks";
import type { Note } from "@/lib/notes/types";
import { anchorHolds, anchorRange, readingNoteFor, resolveAnchors, useNotesStore } from "./notes";

// P11-47 (round 3, Theme B walk, weighed (f); ruling §1h.148 rule 1): a highlight keeps ALL its words, whatever their number: the mark covers them, the note
// records them, every export carries them (`lib/notes/export.highlight.long.test.ts`), and a reload finds them again. The quote's limit was 1,200 characters
// (`HIGHLIGHT_QUOTE_MAX`, the selection's own cap, which is Explain's now), so a triple click on a long paragraph made nothing. A sticky taken on the same
// words is anchored over all of them too; its `quote` stays the passage's start, at most 300 characters (rule 3: a sticky is as it was). Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const PARAGRAPH = "paper-section-1-p2";

/** `n` or more characters of invented sentences, one paragraph. */
function sentences(n: number, seed = 0): string {
  let out = "";
  for (let k = seed; out.length < n; k += 1) out += `${out ? " " : ""}In plot ${k} the crew counted the invented tide pools twice.`;
  return out;
}

const state = () => useNotesStore.getState();
const noteId = () => state().ensureReadingNote(PAPER);
const noteOf = () => readingNoteFor(state().notes, "p1")!;
const highlights = () => noteOf().blocks.filter((b) => b.type === "highlight");

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
});

describe("addHighlight — any length inside one block (rule 1)", () => {
  it("keeps a passage over 1,200 characters whole: 1,201, 3,000 and 12,000 — the quote, the range and the check all say all of it", () => {
    for (const n of [1201, 3000, 12000]) {
      useNotesStore.setState({ notes: {} });
      const id = noteId();
      const passage = sentences(n);
      const paragraphText = `${sentences(200, 900)} ${passage} ${sentences(200, 950)}`;
      const made = state().addHighlight(id, { paperId: "p1", paragraphId: PARAGRAPH, passage, paragraphText });
      expect(made, String(n)).toMatchObject({ created: true });
      const spot = readHighlight(highlights()[0])!;
      expect(spot.quote.length, String(n)).toBe(passage.length);
      expect(spot.quote).toBe(passage);
      expect(paragraphText.slice(spot.start, spot.end)).toBe(passage);
      expect(anchorHolds(paragraphText, spot)).toBe(true);
      expect(anchorRange(paragraphText, spot)).toEqual({ start: spot.start, end: spot.end });
    }
  });

  it("is the whole paragraph for a triple click: the passage is the paragraph's words, the range is all of the paragraph's text", () => {
    const id = noteId();
    const paragraphText = sentences(3000);
    state().addHighlight(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: paragraphText, paragraphText, hint: 0 });
    const spot = readHighlight(highlights()[0])!;
    expect([spot.start, spot.end]).toEqual([0, paragraphText.length]);
    expect(spot.quote).toBe(paragraphText);
  });

  it("collapses a long passage's white space as a short one's, and finds it over the paragraph's own line breaks", () => {
    const id = noteId();
    const flat = sentences(2000);
    const paragraphText = flat.replace(/ /g, (space, at: number) => (at % 7 === 0 ? "\n" : space));
    state().addHighlight(id, { paperId: "p1", paragraphId: PARAGRAPH, passage: flat.replace(/ /g, "  "), paragraphText });
    const spot = readHighlight(highlights()[0])!;
    expect(spot.quote).toBe(flat);
    expect(paragraphText.slice(spot.start, spot.end).replace(/\s+/g, " ")).toBe(flat);
  });

  it("marks the occurrence the reader selected when a long passage stands twice: the hint picks the second", () => {
    const id = noteId();
    const passage = sentences(1500);
    const paragraphText = `${passage} Between them a line the passage does not hold. ${passage}`;
    const second = paragraphText.lastIndexOf(passage);
    state().addHighlight(id, { paperId: "p1", paragraphId: PARAGRAPH, passage, paragraphText, hint: second });
    expect(readHighlight(highlights()[0])).toMatchObject({ start: second, end: second + passage.length });
  });

  it("makes no second block for the same long range, and still none for a passage that is not in the paragraph", () => {
    const id = noteId();
    const passage = sentences(2500);
    const paragraphText = `Before. ${passage} After.`;
    const at = { paperId: "p1", paragraphId: PARAGRAPH, passage, paragraphText };
    expect(state().addHighlight(id, at)).toMatchObject({ created: true });
    expect(state().addHighlight(id, at)).toMatchObject({ created: false });
    expect(highlights()).toHaveLength(1);
    expect(state().addHighlight(id, { ...at, passage: `${passage} and then a sentence that is not there` })).toBeNull();
    expect(highlights()).toHaveLength(1);
  });
});

describe("a long highlight on reload and on a re-read", () => {
  const passage = sentences(2800);
  const text = `Before the passage. ${passage} After the passage.`;
  const start = text.indexOf(passage);

  const spotBlock = () => highlightBlock({ paperId: "p1", paragraphId: PARAGRAPH, quote: passage, start, end: start + passage.length, colour: "yellow" });
  const noteWith = (blocks: Note["blocks"]): Note => ({ id: "n", title: "T", blocks, sources: {}, paperId: "p1", createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z" });

  it("is read back whole from what the browser stored (a JSON round trip), and is on the anchor map with all its words", () => {
    const block = spotBlock();
    const stored = JSON.parse(JSON.stringify(noteWith([block]))) as Note;
    expect(readHighlight(stored.blocks[0])).toEqual(readHighlight(block));
    const map = anchorMap(stored, "p1");
    expect(map[PARAGRAPH]).toEqual([{ id: block.id, n: 0, start, end: start + passage.length, quote: passage, colour: "yellow", order: 0 }]);
  });

  it("is drawn as stored when the body still holds the words there: no search, no repair", () => {
    const map = anchorMap(noteWith([spotBlock()]), "p1");
    const resolved = resolveAnchors([{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", text] }], map);
    expect(resolved.fixes).toEqual([]);
    expect(resolved.lost).toEqual([]);
    expect(resolved.map[PARAGRAPH]).toHaveLength(1);
  });

  it("is found again, whole, when a paragraph is added before it and the positional id moves", () => {
    const map = anchorMap(noteWith([spotBlock()]), "p1");
    const resolved = resolveAnchors([{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", "A new paragraph.", text] }], map);
    expect(resolved.lost).toEqual([]);
    expect(resolved.fixes).toHaveLength(1);
    expect(resolved.fixes[0]).toMatchObject({ paragraphId: "paper-section-1-p3" });
    const fix = resolved.fixes[0];
    expect(fix.end - fix.start).toBe(passage.length);
    expect(text.slice(fix.start, fix.end)).toBe(passage);
  });

  it("is lost, drawn nowhere, when the body no longer holds the words, however long they were", () => {
    const map = anchorMap(noteWith([spotBlock()]), "p1");
    const resolved = resolveAnchors([{ paragraphs: ["Intro."] }, { paragraphs: ["A.", "B.", `${passage.slice(0, 1000)} changed ${passage.slice(1000)}`] }], map);
    expect(resolved.lost).toHaveLength(1);
    expect(resolved.map[PARAGRAPH]).toBeUndefined();
  });
});

describe("addSticky on a long selection — the range covers every word, the quote is the start (rule 3: as it was)", () => {
  it("anchors a sticky over all 3,000 characters, with a quote of the passage's first 300", () => {
    const id = noteId();
    const passage = sentences(3000);
    const paragraphText = `Before. ${passage} After.`;
    const made = state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage, paragraphText });
    expect(made).toMatchObject({ n: 1 });
    const anchor = noteOf().blocks.find((b) => b.anchor)!.anchor!;
    expect(STICKY_QUOTE_MAX).toBe(300);
    expect(anchor.quote).toBe(passage.slice(0, STICKY_QUOTE_MAX).trimEnd());
    expect(paragraphText.slice(anchor.start, anchor.end)).toBe(passage);
    expect(anchorRange(paragraphText, { start: anchor.start!, end: anchor.end!, quote: anchor.quote })).toEqual({ start: anchor.start, end: anchor.end });
  });

  it("anchors a sticky on a selection of up to 1,200 characters exactly as it did: the range is the selection, the quote its first 300", () => {
    const id = noteId();
    const passage = sentences(1100).slice(0, 1100).replace(/\s+\S*$/, "");
    const paragraphText = `Before. ${passage} After.`;
    state().addSticky(id, { paperId: "p1", paragraphId: PARAGRAPH, passage, paragraphText });
    const anchor = noteOf().blocks.find((b) => b.anchor)!.anchor!;
    expect(anchor).toMatchObject({ paperId: "p1", paragraphId: PARAGRAPH, n: 1, start: 8, end: 8 + passage.length });
    expect(anchor.quote).toBe(passage.slice(0, STICKY_QUOTE_MAX).trimEnd());
  });
});
