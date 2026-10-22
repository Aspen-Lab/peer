import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBodyOnShow } from "@/lib/notes/anchor-blocks";
import { readHighlight } from "@/lib/notes/blocks";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import type { Paper } from "@/types";
import { canHighlight, highlightSelection, type HighlightTarget } from "./highlight";
import { useHighlightStrip } from "./highlight-strip";
import { stickyAnchorId, takeStickyNote } from "./sticky-note";

// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): the two actions the page already has — Take notes (`takeStickyNote`, through the
// page's `useTakeNote`) and Highlight (`highlightSelection`, through `useHighlight`) — work on a selection in a caption or a heading as on a paragraph's. The
// hooks know the paragraphs of the body (`body[k].paragraphs[n]`), not the words of a heading or a caption; the store reads those from the body the page has
// on show (`setBodyOnShow`, told by `PaperBody`). The target carries its anchor in the shape every anchor has, so neither hook needs to change for it.
// Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" } as unknown as Paper;
const BODY = [
  { paragraphs: ["Intro words."] },
  {
    paragraphs: ["A first paragraph.", "A second paragraph of the tidal survey."],
    heading: "2 Methods of the tidal survey",
    figures: [{ label: "Figure 1", caption: "Creep against density in the invented survey.", imageUrl: "/f1.png" }],
  },
];
const HEADING_ID = "paper-section-1-p2";
const CAPTION_ID = "paper-section-1-p3";
const BOUNDS = { left: 100, top: 220, right: 220, bottom: 240 };
const target = (block: "heading" | "caption", passage: string, extra: Record<string, unknown> = {}): HighlightTarget =>
  ({
    sectionIndex: 1,
    paragraphIndex: block === "heading" ? 2 : 3,
    passage,
    source: "paper",
    paragraphId: block === "heading" ? HEADING_ID : CAPTION_ID,
    block,
    rect: BOUNDS,
    bounds: BOUNDS,
    ...extra,
  }) as HighlightTarget;
const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1");

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useWindows.setState({ windows: [], clock: 0 });
  useHighlightStrip.setState({ id: null, top: 0 });
  vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: () => {} }) });
  setBodyOnShow(BODY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setBodyOnShow(null);
});

describe("Highlight on a heading's or a caption's words", () => {
  it("is offered for them as for a paragraph's: the paper's body, a section and a block of it, words", () => {
    expect(canHighlight(target("heading", "Methods"))).toBe(true);
    expect(canHighlight(target("caption", "Creep against density"))).toBe(true);
  });

  it("makes a highlight on the caption's words, anchored to the figure, with the range the words stand at in the caption as the page draws it", () => {
    const made = highlightSelection(target("caption", "against density"), { paper: PAPER, body: BODY });
    expect(made).toEqual({ id: expect.any(String), created: true });
    const spot = readHighlight(noteOf()!.blocks.find((b) => b.id === made!.id)!)!;
    const text = "Figure 1 · Creep against density in the invented survey.";
    expect(spot).toMatchObject({ paperId: "p1", paragraphId: CAPTION_ID, quote: "against density", start: text.indexOf("against"), colour: "yellow" });
    expect(spot.end - spot.start).toBe("against density".length);
  });

  it("makes a highlight on the heading's words, at the occurrence the selection began at", () => {
    const text = "2 Methods of the tidal survey";
    const made = highlightSelection(target("heading", "tidal", { offset: text.indexOf("tidal") }), { paper: PAPER, body: BODY });
    expect(readHighlight(noteOf()!.blocks.find((b) => b.id === made!.id)!)).toMatchObject({ paragraphId: HEADING_ID, start: text.indexOf("tidal"), end: text.indexOf("tidal") + 5 });
  });

  it("raises the strip for it, as for a paragraph's, and takes away the note it made when nothing could be marked", () => {
    const made = highlightSelection(target("caption", "against density"), { paper: PAPER, body: BODY });
    expect(useHighlightStrip.getState()).toMatchObject({ id: made!.id, top: BOUNDS.top });
    useNotesStore.setState({ notes: {} });
    useHighlightStrip.setState({ id: null, top: 0 });
    expect(highlightSelection(target("caption", "words the caption does not hold"), { paper: PAPER, body: BODY })).toBeNull();
    expect(noteOf()).toBeUndefined();
    expect(useHighlightStrip.getState().id).toBeNull();
  });

  it("is nothing where the page shows no body: the words of a heading are not known (and the note made for it is taken away)", () => {
    setBodyOnShow(null);
    expect(highlightSelection(target("heading", "Methods"), { paper: PAPER, body: BODY })).toBeNull();
    expect(noteOf()).toBeUndefined();
  });
});

describe("Take notes on a heading's or a caption's words", () => {
  it("anchors a sticky to the block's own id", () => {
    expect(stickyAnchorId(target("heading", "Methods"))).toBe(HEADING_ID);
    expect(stickyAnchorId(target("caption", "Creep"))).toBe(CAPTION_ID);
  });

  it("makes the numbered sticky on a caption's words, with their range, and opens its window", () => {
    // `useTakeNote` hands the hook's lookup (`body[k].paragraphs[n]`), which has no such paragraph: undefined.
    const made = takeStickyNote({ ...target("caption", "against density"), paragraphText: undefined }, PAPER);
    expect(made).toEqual({ id: expect.any(String), n: 1 });
    const anchor = noteOf()!.blocks.find((b) => b.id === made!.id)!.anchor!;
    const text = "Figure 1 · Creep against density in the invented survey.";
    expect(anchor).toMatchObject({ paperId: "p1", paragraphId: CAPTION_ID, quote: "against density", n: 1, start: text.indexOf("against"), end: text.indexOf("against") + 15 });
    expect(useWindows.getState().windows.map((w) => w.id)).toEqual([made!.id]);
  });

  it("makes the numbered sticky on a heading's words, with their range", () => {
    const made = takeStickyNote({ ...target("heading", "Methods of the tidal"), paragraphText: undefined }, PAPER);
    const anchor = noteOf()!.blocks.find((b) => b.id === made!.id)!.anchor!;
    expect(anchor).toMatchObject({ paragraphId: HEADING_ID, start: 2, end: 2 + "Methods of the tidal".length });
  });

  it("numbers it in the one note beside the paragraphs' stickies", () => {
    takeStickyNote({ ...target("heading", "Methods"), paragraphText: undefined }, PAPER);
    takeStickyNote({ sectionIndex: 1, paragraphIndex: 0, passage: "first", paragraphId: "paper-section-1-p0", source: "paper", paragraphText: "A first paragraph." } as never, PAPER);
    takeStickyNote({ ...target("caption", "Creep"), paragraphText: undefined }, PAPER);
    expect(noteOf()!.blocks.filter((b) => b.type === "h3" && b.anchor).map((b) => b.anchor!.n)).toEqual([1, 2, 3]);
  });
});
