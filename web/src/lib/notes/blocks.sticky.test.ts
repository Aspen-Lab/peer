import { describe, expect, it } from "vitest";
import {
  STICKY_HEAD_MAX,
  STICKY_QUOTE_MAX,
  anchorMap,
  block,
  quoteHead,
  stickyParagraphs,
  stickyQuote,
  stickySpan,
  stickyText,
  stickyTitle,
  withStickyText,
} from "./blocks";
import type { Block, Note } from "./types";

// P10-09a (review 7.1; ruling §1h.78 (f)): a sticky note is stored in the paper's note as ONE `h3` block
// "Note N" carrying `anchor`, followed by its text as `text` blocks, one per paragraph typed. These are the
// pure helpers behind that. Every text is invented.

const ANCHOR = { paperId: "p1", paragraphId: "paper-section-1-p2", quote: "The finest grains crept fastest.", n: 1 };
const header = (n: number, paragraphId = "paper-section-1-p2"): Block => block("h3", stickyTitle(n), { anchor: { ...ANCHOR, n, paragraphId } });

describe("the title, the quote and its head", () => {
  it("names a sticky Note N", () => {
    expect(stickyTitle(1)).toBe("Note 1");
    expect(stickyTitle(12)).toBe("Note 12");
  });

  it("keeps the passage's start, whitespace collapsed, at most 300 characters", () => {
    expect(STICKY_QUOTE_MAX).toBe(300);
    expect(stickyQuote("  The  finest\n grains   crept. ")).toBe("The finest grains crept.");
    const long = `${"word ".repeat(100)}end`;
    const quote = stickyQuote(long);
    expect(quote.length).toBeLessThanOrEqual(300);
    expect(long.replace(/\s+/g, " ").startsWith(quote)).toBe(true);
  });

  it("shows the first words of a quote in at most 80 characters, with the cut marked", () => {
    expect(STICKY_HEAD_MAX).toBe(80);
    expect(quoteHead("Short quote.")).toBe("Short quote.");
    const head = quoteHead("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau");
    expect(head.length).toBeLessThanOrEqual(80);
    expect(head.endsWith("…")).toBe(true);
    expect(head.startsWith("alpha beta gamma")).toBe(true);
  });
});

describe("a sticky's text blocks", () => {
  it("is one block per paragraph typed, blanks dropped", () => {
    expect(stickyParagraphs("one\n\ntwo\n  \nthree")).toEqual(["one", "two", "three"]);
    expect(stickyParagraphs("")).toEqual([]);
  });

  it("owns its header and the text blocks right after it, up to the next block of another kind", () => {
    const blocks = [block("h2", "Questions"), header(1), block("text", "a"), block("text", "b"), header(2), block("text", "c")];
    expect(stickySpan(blocks, blocks[1].id)).toEqual({ start: 1, end: 4 });
    expect(stickySpan(blocks, blocks[4].id)).toEqual({ start: 4, end: 6 });
    expect(stickySpan(blocks, "missing")).toBeNull();
    expect(stickyText(blocks, blocks[1].id)).toBe("a\nb");
  });

  it("writes its own blocks and never another's", () => {
    const before = [block("h2", "Questions"), block("bullet", "keep me"), header(1), block("text", "old"), header(2), block("text", "other")];
    const after = withStickyText(before, before[2].id, "new one\nnew two");
    expect(after.map((b) => b.text)).toEqual(["Questions", "keep me", "Note 1", "new one", "new two", "Note 2", "other"]);
    expect(after[2]).toBe(before[2]);
    expect(after[3].id).toBe(before[3].id);
    expect(after.slice(5)).toEqual(before.slice(4));
  });

  it("leaves one empty text block when the text is cleared, and the number stays", () => {
    const before = [header(3), block("text", "x")];
    const after = withStickyText(before, before[0].id, "");
    expect(after).toHaveLength(2);
    expect(after[0].text).toBe("Note 3");
    expect(after[0].anchor?.n).toBe(3);
    expect(after[1].type).toBe("text");
    expect(after[1].text).toBe("");
  });
});

describe("anchorMap — the tags the paper's passages carry", () => {
  const note = (blocks: Block[]): Note => ({ id: "n", title: "t", blocks, sources: {}, createdAt: "", updatedAt: "", paperId: "p1" });

  it("lists, per paragraph, each sticky taken on it in order, by number and header id", () => {
    const blocks = [header(1, "paper-section-0-p0"), block("text", "a"), header(2, "paper-section-1-p2"), header(3, "paper-section-0-p0")];
    const map = anchorMap(note(blocks), "p1");
    expect(map["paper-section-0-p0"]).toEqual([{ id: blocks[0].id, n: 1 }, { id: blocks[3].id, n: 3 }]);
    expect(map["paper-section-1-p2"]).toEqual([{ id: blocks[2].id, n: 2 }]);
  });

  it("is empty without a note, and ignores another paper's anchors", () => {
    expect(anchorMap(undefined, "p1")).toEqual({});
    const other = block("h3", "Note 1", { anchor: { ...ANCHOR, paperId: "p2" } });
    expect(anchorMap(note([other]), "p1")).toEqual({});
  });
});
