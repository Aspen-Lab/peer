import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBodyOnShow, type AnchorSection } from "@/lib/notes/anchor-blocks";
import { anchorMap, readHighlight } from "@/lib/notes/blocks";
import { resolveAnchors, useLostPassages, useNotesStore } from "./notes";

// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): a note, or a highlight, taken in a figure's caption or in a section's
// heading is anchored like one taken in a paragraph — a `paper-section-<k>-p<n>` id, where n counts the section's paragraphs, then its heading, then
// its captions — and is found again by its quote when the page's blocks move. The store reads the block's words from the body the page has on show
// when the caller gives no paragraph text (the hooks that call it know only the section's paragraphs). Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch." };
const id = (s: number, p: number) => `paper-section-${s}-p${p}`;
const SECTION: AnchorSection = {
  paragraphs: ["Creep limits the life of hot parts.", "Grain boundaries carry the strain."],
  heading: "2 Methods of the tidal survey",
  figures: [
    { label: "Figure 1", caption: "Creep against density in the invented survey.", imageUrl: "/f1.png" },
    { label: "Figure 2", caption: "A sketch of the specimen, drawn by hand." },
  ],
};
const BODY: AnchorSection[] = [{ paragraphs: ["Intro words."] }, SECTION];
const HEADING = id(1, 2);
const CAPTION_1 = id(1, 3);
const CAPTION_2 = id(1, 4);
const noteOf = () => Object.values(useNotesStore.getState().notes)[0];

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useLostPassages.setState({ lost: {} });
});
afterEach(() => setBodyOnShow(null));

describe("a note or a highlight taken on a heading or a caption", () => {
  it("anchors a sticky on the caption's words, with the range the words stand at in the caption as the page draws it", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const made = addSticky(noteId, { paperId: "p1", paragraphId: CAPTION_1, passage: "Creep against density" });
    expect(made).not.toBeNull();
    const heading = noteOf().blocks.find((b) => b.id === made!.id)!;
    const text = "Figure 1 · Creep against density in the invented survey.";
    const start = text.indexOf("Creep against density");
    expect(heading.anchor).toMatchObject({ paperId: "p1", paragraphId: CAPTION_1, quote: "Creep against density", n: 1, start, end: start + "Creep against density".length });
  });

  it("anchors a sticky on the heading's words", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const made = addSticky(ensureReadingNote(PAPER), { paperId: "p1", paragraphId: HEADING, passage: "Methods of the tidal" });
    const anchor = noteOf().blocks.find((b) => b.id === made!.id)!.anchor!;
    expect(anchor).toMatchObject({ paragraphId: HEADING, start: 2, end: 2 + "Methods of the tidal".length });
  });

  it("makes a highlight on a caption's words, at the occurrence the selection began at", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addHighlight } = useNotesStore.getState();
    const made = addHighlight(ensureReadingNote(PAPER), { paperId: "p1", paragraphId: CAPTION_2, passage: "sketch of the specimen" });
    expect(made).toEqual({ id: expect.any(String), created: true });
    const spot = readHighlight(noteOf().blocks.find((b) => b.id === made!.id)!)!;
    const text = "Figure 2 · A sketch of the specimen, drawn by hand.";
    expect(spot).toMatchObject({ paragraphId: CAPTION_2, quote: "sketch of the specimen", start: text.indexOf("sketch"), end: text.indexOf("sketch") + 22, colour: "yellow" });
  });

  it("is given the text by the caller before the body on show: a paragraph's own text stays the one used", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addHighlight } = useNotesStore.getState();
    const made = addHighlight(ensureReadingNote(PAPER), { paperId: "p1", paragraphId: id(1, 0), passage: "hot parts", paragraphText: "Creep limits the life of hot parts." });
    expect(readHighlight(noteOf().blocks.find((b) => b.id === made!.id)!)).toMatchObject({ start: 25, end: 34 });
  });

  it("without a body on show a block's note has no range (its tag stands at the end) and a highlight is not made — as with no paragraph text", () => {
    const { ensureReadingNote, addSticky, addHighlight } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const made = addSticky(noteId, { paperId: "p1", paragraphId: HEADING, passage: "Methods" });
    const anchor = noteOf().blocks.find((b) => b.id === made!.id)!.anchor!;
    expect(anchor.start).toBeUndefined();
    expect(anchor.end).toBeUndefined();
    expect(addHighlight(noteId, { paperId: "p1", paragraphId: HEADING, passage: "Methods" })).toBeNull();
  });

  it("makes no second highlight on a range the note already highlights in the caption", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addHighlight } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const first = addHighlight(noteId, { paperId: "p1", paragraphId: CAPTION_1, passage: "invented survey" });
    const second = addHighlight(noteId, { paperId: "p1", paragraphId: CAPTION_1, passage: "invented survey" });
    expect(second).toEqual({ id: first!.id, created: false });
  });

  it("rides the paper's anchor map like a paragraph's: keyed by the block's id", () => {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addSticky, addHighlight } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    addSticky(noteId, { paperId: "p1", paragraphId: HEADING, passage: "tidal survey" });
    addHighlight(noteId, { paperId: "p1", paragraphId: CAPTION_1, passage: "invented survey" });
    const map = anchorMap(noteOf(), "p1");
    expect(Object.keys(map).sort()).toEqual([HEADING, CAPTION_1].sort());
    expect(map[HEADING][0]).toMatchObject({ n: 1, quote: "tidal survey" });
    expect(map[CAPTION_1][0]).toMatchObject({ n: 0, colour: "yellow", quote: "invented survey" });
  });
});

describe("resolveAnchors — heading and caption anchors", () => {
  /** A map with one spot in `paragraphId`, made from the body on show. */
  function anchored(paragraphId: string, passage: string, as: "sticky" | "highlight" = "sticky") {
    setBodyOnShow(BODY);
    const { ensureReadingNote, addSticky, addHighlight } = useNotesStore.getState();
    const noteId = ensureReadingNote(PAPER);
    const made = as === "sticky" ? addSticky(noteId, { paperId: "p1", paragraphId, passage }) : addHighlight(noteId, { paperId: "p1", paragraphId, passage });
    setBodyOnShow(null);
    return { map: anchorMap(noteOf(), "p1"), headerId: made!.id };
  }

  it("keeps an anchor whose block still holds its words, with no search, for a heading and for a caption", () => {
    const h = anchored(HEADING, "tidal survey");
    const c = anchored(CAPTION_2, "by hand", "highlight");
    expect(resolveAnchors(BODY, h.map)).toEqual({ map: h.map, fixes: [], lost: [] });
    expect(resolveAnchors(BODY, c.map)).toEqual({ map: c.map, fixes: [], lost: [] });
  });

  it("reads only the block an anchor stands in when its words are still there", () => {
    const { map } = anchored(HEADING, "tidal survey");
    const reads: string[] = [];
    const paragraphs = new Proxy(SECTION.paragraphs as string[], {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.push(key);
        return Reflect.get(target, key);
      },
    });
    resolveAnchors([{ paragraphs: ["Intro words."] }, { ...SECTION, paragraphs }], map);
    expect(reads).toEqual([]);
  });

  it("finds a heading again when a paragraph was added before it: the id moved from p2 to p3, the anchor is repaired once", () => {
    const { map, headerId } = anchored(HEADING, "tidal survey");
    const grown: AnchorSection[] = [{ paragraphs: ["Intro words."] }, { ...SECTION, paragraphs: [...SECTION.paragraphs, "A paragraph the new reading found."] }];
    const result = resolveAnchors(grown, map);
    expect(result.lost).toEqual([]);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]).toMatchObject({ id: headerId, paragraphId: id(1, 3) });
    expect(Object.keys(result.map)).toEqual([id(1, 3)]);
    expect(result.map[id(1, 3)][0]).toMatchObject({ id: headerId, start: 2 + "Methods of the ".length });
  });

  it("finds a caption again when a figure was added before it", () => {
    const { map, headerId } = anchored(CAPTION_2, "by hand");
    const more: AnchorSection[] = [{ paragraphs: ["Intro words."] }, { ...SECTION, figures: [{ label: "Figure 0", caption: "Another one." }, ...SECTION.figures!] }];
    const result = resolveAnchors(more, map);
    expect(result.lost).toEqual([]);
    expect(result.fixes[0]).toMatchObject({ id: headerId, paragraphId: id(1, 5) });
  });

  it("says a heading's note is lost when the paper no longer holds its words", () => {
    const { map, headerId } = anchored(HEADING, "tidal survey");
    const renamed: AnchorSection[] = [{ paragraphs: ["Intro words."] }, { ...SECTION, heading: "2 Methods of the field study" }];
    expect(resolveAnchors(renamed, map)).toMatchObject({ lost: [headerId], fixes: [] });
  });

  it("is what a body of the old shape gave: sections with paragraphs alone resolve as they did", () => {
    const { map } = anchored(id(1, 0), "hot parts");
    const old = [{ paragraphs: ["Intro words."] }, { paragraphs: SECTION.paragraphs }];
    expect(resolveAnchors(old, map).lost).toEqual([]);
  });
});
