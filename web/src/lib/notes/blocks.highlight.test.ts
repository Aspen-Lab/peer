import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_QUOTE_MAX,
  anchorMap,
  block,
  citedKeys,
  excerpt,
  highlightBlock,
  isTextual,
  isUntouched,
  readHighlight,
  stickySpan,
  stickyTitle,
  wordCount,
} from "./blocks";
import type { Block, HighlightSpot } from "./types";

// P11-07 (owner item 8; B P11-04 §2.2, §2.6–§2.8; ruling §1h.112): a highlight is a block of its own — `type: "highlight"`,
// no text, its words and place in `highlight`. These are the pure helpers behind that. Every text is invented.

const SPOT: HighlightSpot = {
  paperId: "p1",
  paragraphId: "paper-section-1-p2",
  quote: "the tide pools were bare",
  start: 40,
  end: 64,
  colour: "green",
};
const sticky = (n: number, paragraphId = "paper-section-1-p2"): Block =>
  block("h3", stickyTitle(n), { anchor: { paperId: "p1", paragraphId, quote: "The finest grains.", n } });

describe("highlightBlock", () => {
  it("makes a highlight block with no text and the spot as it was given", () => {
    const made = highlightBlock(SPOT);
    expect(made).toMatchObject({ type: "highlight", text: "", highlight: SPOT });
    expect(made.anchor).toBeUndefined();
    expect(Object.keys(made).sort()).toEqual(["highlight", "id", "text", "type"]);
  });

  it("gives every block its own id", () => {
    expect(highlightBlock(SPOT).id).not.toBe(highlightBlock(SPOT).id);
  });

  it("keeps a whole passage: the quote's limit is 1,200 characters, the selection's own cap", () => {
    expect(HIGHLIGHT_QUOTE_MAX).toBe(1200);
  });
});

describe("readHighlight — the sanitiser (invariant I8)", () => {
  it("returns the stored spot of a well-formed highlight", () => {
    expect(readHighlight(highlightBlock(SPOT))).toEqual(SPOT);
  });

  it("reads a colour the table does not know — or none — as yellow", () => {
    for (const colour of ["mauve", "", "YELLOW", undefined, null, 7, {}, []]) {
      const stored = { ...highlightBlock(SPOT), highlight: { ...SPOT, colour } } as unknown as Block;
      expect(readHighlight(stored)?.colour, JSON.stringify(colour)).toBe("yellow");
      expect(readHighlight(stored)?.quote).toBe(SPOT.quote);
    }
    const noColour = { ...highlightBlock(SPOT), highlight: { ...SPOT, colour: undefined } } as unknown as Block;
    delete (noColour.highlight as Partial<HighlightSpot>).colour;
    expect(readHighlight(noColour)?.colour).toBe("yellow");
  });

  it("does not touch what was stored: the block is the same afterwards", () => {
    const stored = { ...highlightBlock(SPOT), highlight: { ...SPOT, colour: "mauve" } } as unknown as Block;
    const before = JSON.stringify(stored);
    readHighlight(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });

  it("never throws, and reads nothing, from a block whose highlight is missing or malformed", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "highlight",
      7,
      {},
      { highlight: SPOT }, // no type
      { type: "highlight" },
      { type: "highlight", highlight: null },
      { type: "highlight", highlight: "words" },
      { type: "highlight", highlight: 3 },
      { type: "highlight", highlight: [] },
      { type: "highlight", highlight: {} },
      { type: "highlight", highlight: { ...SPOT, paperId: undefined } },
      { type: "highlight", highlight: { ...SPOT, paperId: 4 } },
      { type: "highlight", highlight: { ...SPOT, paragraphId: null } },
      { type: "highlight", highlight: { ...SPOT, quote: undefined } },
      { type: "highlight", highlight: { ...SPOT, quote: "" } },
      { type: "highlight", highlight: { ...SPOT, quote: 12 } },
      { type: "highlight", highlight: { ...SPOT, start: "40" } },
      { type: "highlight", highlight: { ...SPOT, start: 1.5 } },
      { type: "highlight", highlight: { ...SPOT, start: NaN } },
      { type: "highlight", highlight: { ...SPOT, end: undefined } },
      { type: "highlight", highlight: { ...SPOT, end: Infinity } },
      { type: "highlight", highlight: { ...SPOT, start: -1 } },
      { type: "highlight", highlight: { ...SPOT, start: 64, end: 40 } },
      { type: "highlight", highlight: { ...SPOT, start: 40, end: 40 } },
    ];
    for (const one of bad) {
      expect(() => readHighlight(one as Block), JSON.stringify(one)).not.toThrow();
      expect(readHighlight(one as Block), JSON.stringify(one)).toBeNull();
    }
  });

  it("reads nothing from a block of another type that carries a stray `highlight` field", () => {
    expect(readHighlight({ ...block("text", "words"), highlight: SPOT })).toBeNull();
    expect(readHighlight({ ...sticky(1), highlight: SPOT })).toBeNull();
  });
});

describe("isTextual and the readers of a note's words (invariants I12)", () => {
  it("a highlight takes no caret and holds no text: isTextual is false, like a divider and a paper card", () => {
    expect(isTextual("highlight")).toBe(false);
    expect(isTextual("divider")).toBe(false);
    expect(isTextual("text")).toBe(true);
    expect(isTextual("h3")).toBe(true);
  });

  it("a note holding a highlight is not untouched — 'Write' never reuses or discards it", () => {
    const empty = { title: "", blocks: [block("text")] };
    expect(isUntouched(empty)).toBe(true);
    expect(isUntouched({ title: "", blocks: [block("text"), highlightBlock(SPOT)] })).toBe(false);
    expect(isUntouched({ title: "", blocks: [highlightBlock(SPOT)] })).toBe(false);
  });

  it("is not counted as words, not in the excerpt and cites nothing", () => {
    const note = { blocks: [block("text", "my words"), highlightBlock(SPOT)], sources: {} };
    expect(wordCount(note)).toBe(2);
    expect(excerpt(note)).toBe("my words");
    expect(citedKeys(note)).toEqual([]);
  });
});

describe("stickySpan — a sticky ends at a highlight (invariant I6)", () => {
  it("does not take a highlight for one of the sticky's text blocks", () => {
    const header = sticky(1);
    const blocks = [header, block("text", "mine"), highlightBlock(SPOT), block("text", "after the highlight")];
    expect(stickySpan(blocks, header.id)).toEqual({ start: 0, end: 2 });
  });

  it("does not find a sticky at a highlight's id", () => {
    const highlight = highlightBlock(SPOT);
    expect(stickySpan([sticky(1), highlight], highlight.id)).toBeNull();
  });
});

describe("anchorMap — a spot for each highlight, the stickies' spots as they were", () => {
  it("is byte-identical for stickies: { id, n } and, with a range, { id, n, start, end, quote }", () => {
    const bare = sticky(1);
    const ranged = { ...sticky(2), anchor: { ...sticky(2).anchor!, start: 4, end: 20, quote: "The finest grains." } };
    const map = anchorMap({ blocks: [bare, block("text"), ranged, block("text")] }, "p1");
    expect(JSON.stringify(map)).toBe(
      JSON.stringify({
        "paper-section-1-p2": [
          { id: bare.id, n: 1 },
          { id: ranged.id, n: 2, start: 4, end: 20, quote: "The finest grains." },
        ],
      }),
    );
  });

  it("emits { id, n: 0, start, end, quote, colour, order } for a highlight, `order` its index among the note's blocks", () => {
    const first = highlightBlock(SPOT);
    const second = highlightBlock({ ...SPOT, paragraphId: "paper-section-0-p0", start: 0, end: 5, quote: "Tides", colour: "ink" });
    const map = anchorMap({ blocks: [block("h1", "T"), first, block("text"), second] }, "p1");
    expect(map).toEqual({
      "paper-section-1-p2": [{ id: first.id, n: 0, start: 40, end: 64, quote: "the tide pools were bare", colour: "green", order: 1 }],
      "paper-section-0-p0": [{ id: second.id, n: 0, start: 0, end: 5, quote: "Tides", colour: "ink", order: 3 }],
    });
  });

  it("puts a sticky and a highlight of one paragraph in the same list, the sticky without `colour` or `order`", () => {
    const header = sticky(1);
    const highlight = highlightBlock(SPOT);
    const list = anchorMap({ blocks: [header, block("text"), highlight] }, "p1")["paper-section-1-p2"];
    expect(list).toHaveLength(2);
    expect(Object.keys(list[0])).toEqual(["id", "n"]);
    expect(list[1]).toMatchObject({ id: highlight.id, n: 0, colour: "green", order: 2 });
  });

  it("reads a stored colour the table does not know as yellow, and leaves out a highlight it cannot read", () => {
    const odd = { ...highlightBlock(SPOT), highlight: { ...SPOT, colour: "mauve" } } as unknown as Block;
    const broken = { ...highlightBlock(SPOT), highlight: { quote: "x" } } as unknown as Block;
    const bare = { ...highlightBlock(SPOT), highlight: undefined } as Block;
    const map = anchorMap({ blocks: [odd, broken, bare] }, "p1");
    expect(map["paper-section-1-p2"]).toEqual([{ id: odd.id, n: 0, start: 40, end: 64, quote: SPOT.quote, colour: "yellow", order: 0 }]);
  });

  it("leaves out a highlight of another paper", () => {
    const other = highlightBlock({ ...SPOT, paperId: "p2" });
    expect(anchorMap({ blocks: [other] }, "p1")).toEqual({});
    expect(Object.keys(anchorMap({ blocks: [other] }, "p2"))).toEqual(["paper-section-1-p2"]);
  });
});
