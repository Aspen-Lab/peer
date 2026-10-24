import { beforeEach, describe, expect, it } from "vitest";
import { anchorMap, readHighlight } from "@/lib/notes/blocks";
import { findInBlock, readingNoteFor, resolveAnchors, useNotesStore } from "./notes";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c)): a highlight on a Summary block or an answer rides the notes store like a
// paragraph's, with two differences the store has to know. (1) The block is not a paragraph of the paper: `resolveAnchors`, which looks for a paragraph's
// words in the whole body when the paragraph no longer holds them, must leave a page block's highlight alone — it would otherwise find the same words in
// the paper (an abstract sentence is quoted in the Summary) and move the highlight into a paragraph of the paper, or call it lost. (2) The block's words
// are the page's, found again by quote when the block is drawn again (`findInBlock`). Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"] };
const BODY = [{ paragraphs: ["Deeper layers kept more water than shallow ones."] }];

describe("resolveAnchors leaves a page block's anchors alone", () => {
  const spot = (id: string, over: Record<string, unknown> = {}) => ({ id, n: 0, start: 0, end: 19, quote: "Deeper layers kept more water", colour: "yellow" as const, order: 0, ...over });

  it("keeps a Summary block's and the answers' highlight in its block: no search of the paper, no move, nothing lost", () => {
    const anchors = { "summary-proposal": [spot("h1")], "answers-block": [spot("h2", { quote: "Deeper layers" })] };
    const { map, fixes, lost } = resolveAnchors(BODY, anchors);
    expect(map).toEqual(anchors);
    expect(fixes).toEqual([]);
    expect(lost).toEqual([]);
  });

  it("keeps it though the paper holds the same words (which would otherwise move it into the paragraph) and though the paper holds none (which would call it lost)", () => {
    const same = resolveAnchors(BODY, { "summary-abstract": [spot("h1", { start: 40, end: 60 })] });
    expect(same.map["summary-abstract"]).toHaveLength(1);
    expect(same.map["paper-section-0-p0"]).toBeUndefined();
    expect(same.fixes).toEqual([]);
    const none = resolveAnchors([{ paragraphs: ["Nothing alike."] }], { "summary-abstract": [spot("h1")] });
    expect(none.lost).toEqual([]);
    expect(none.map["summary-abstract"]).toHaveLength(1);
  });

  it("still repairs a paragraph's anchor beside it, as it did", () => {
    const { map, fixes } = resolveAnchors(BODY, {
      "summary-method": [spot("h1")],
      "paper-section-0-p5": [spot("h2", { start: 0, end: 13, quote: "Deeper layers" })],
    });
    expect(map["summary-method"]).toHaveLength(1);
    expect(fixes).toEqual([{ id: "h2", was: { paragraphId: "paper-section-0-p5", start: 0, end: 13 }, paragraphId: "paper-section-0-p0", start: 0, end: 13 }]);
  });
});

describe("findInBlock — the words of a highlight in a block drawn again", () => {
  const TEXT = "Soil water rose. The deeper layers held more water, and soil water stayed high.";
  const FIRST = TEXT.indexOf("Soil water");
  const SECOND = TEXT.indexOf("soil water");
  const spot = (start: number, quote = "soil water") => ({ start, end: start + quote.length, quote });

  it("keeps the stored range while the block still holds the words there", () => {
    expect(findInBlock(TEXT, spot(SECOND))).toEqual({ start: SECOND, end: SECOND + 10 });
  });

  it("finds the words again where they stand now when the block has changed: the occurrence nearest the old place", () => {
    const moved = `A new opening sentence. ${TEXT}`;
    const shift = moved.length - TEXT.length;
    expect(findInBlock(moved, spot(SECOND))).toEqual({ start: SECOND + shift, end: SECOND + shift + 10 });
    expect(findInBlock(moved, spot(FIRST, "Soil water"))).toEqual({ start: FIRST + shift, end: FIRST + shift + 10 });
  });

  it("is null when the block no longer holds the words — never other words in their place", () => {
    expect(findInBlock("The soil held less this year, and nothing alike was said.", spot(SECOND))).toBeNull();
    // the stored range now holds other words; the quote is nowhere
    expect(findInBlock("Another sentence about the deeper layers entirely.", spot(11))).toBeNull();
    expect(findInBlock("", spot(0))).toBeNull();
  });

  it("matches white space loosely, as the paragraph's search does", () => {
    expect(findInBlock("See the soil  water here.", { start: 0, end: 10, quote: "soil water" })).toEqual({ start: 8, end: 19 });
  });
});

describe("a highlight on a page block in the note", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const make = (over: Partial<Parameters<ReturnType<typeof useNotesStore.getState>["addHighlight"]>[1]> = {}) => {
    const noteId = useNotesStore.getState().ensureReadingNote(PAPER);
    const made = useNotesStore.getState().addHighlight(noteId, {
      paperId: "p1",
      paragraphId: "summary-proposal",
      passage: "held more water",
      paragraphText: "The deeper layers held more water, and the shallow ones less.",
      ...over,
    });
    return { noteId, made };
  };

  it("is made from the words the page block holds (the caller reads them from the block), anchored to the block's id", () => {
    const { noteId, made } = make();
    expect(made).toEqual({ id: expect.any(String), created: true });
    const block = useNotesStore.getState().notes[noteId].blocks.find((b) => b.id === made!.id)!;
    expect(readHighlight(block)).toEqual({ paperId: "p1", paragraphId: "summary-proposal", quote: "held more water", start: 18, end: 33, colour: "yellow" });
  });

  it("for the same words again is the one it has, in the same block — and a second block for the same words in another page block", () => {
    const first = make();
    expect(make().made).toEqual({ id: first.made!.id, created: false });
    const other = make({ paragraphId: "answers-block" });
    expect(other.made).toEqual({ id: expect.any(String), created: true });
    expect(other.made!.id).not.toBe(first.made!.id);
  });

  it("is carried by the anchor map under the block's id, with its colour, for the block's painter", () => {
    const { noteId } = make();
    useNotesStore.getState().setHighlightColour(noteId, readingNoteFor(useNotesStore.getState().notes, "p1")!.blocks.find((b) => b.type === "highlight")!.id, "ink");
    const map = anchorMap(readingNoteFor(useNotesStore.getState().notes, "p1"), "p1");
    expect(Object.keys(map)).toEqual(["summary-proposal"]);
    expect(map["summary-proposal"][0]).toMatchObject({ n: 0, start: 18, end: 33, quote: "held more water", colour: "ink" });
  });

  it("is made with nothing in the store when the block's words are not given (the block is not on the page)", () => {
    const { noteId, made } = make({ paragraphText: undefined });
    expect(made).toBeNull();
    expect(useNotesStore.getState().notes[noteId].blocks.some((b) => b.type === "highlight")).toBe(false);
  });
});
