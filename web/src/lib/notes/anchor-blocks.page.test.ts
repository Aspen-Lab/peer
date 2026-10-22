import { describe, expect, it } from "vitest";
import { el, rangeStartingAt, text, textNodesOf } from "@/test-support/fake-text-dom";
import {
  ANSWERS_BLOCK_ID,
  SUMMARY_ID_PREFIX,
  boundaryOf,
  isPageBlockId,
  rawSpanOf,
  readBlockText,
  selectionStartIn,
} from "./anchor-blocks";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c), which amends D8): a Summary block and the answers are blocks a highlight is
// anchored to. They are not paragraphs of the paper: the page draws their words from many components, so a block's words are what its element holds —
// its text nodes, white space collapsed to one space, a line of its own for each block-level element — and a highlight's range is a range of those words.
// This is the pure part of it: which ids are page blocks, and the text model (words, where each text node's words stand, where a selection began).
// No DOM here (plain Node): `test-support/fake-text-dom.ts` stands in for the members read. Every text is invented.

describe("the ids of the page's blocks", () => {
  it("are the Summary's blocks (`summary-…`) and the answers' block", () => {
    expect(SUMMARY_ID_PREFIX).toBe("summary-");
    expect(ANSWERS_BLOCK_ID).toBe("answers-block");
    for (const id of ["summary-skim", "summary-abstract", "summary-new-here", "summary-library", "answers-block"]) expect(isPageBlockId(id), id).toBe(true);
  });

  it("are no paragraph of the paper, no bare kind a block with no id is reported as, nothing else", () => {
    for (const id of ["paper-section-1-p2", "summary", "answer", "summary-", "answers", "answers-block-2", "", " summary-x", undefined, null, 3]) expect(isPageBlockId(id), String(id)).toBe(false);
  });
});

describe("readBlockText — the words of a block", () => {
  it("is the text nodes in order, white space collapsed to one space", () => {
    const root = el("div", { id: "summary-x" }, "Deeper  seaweed\n layers ", el("b", {}, "held"), " more   water.");
    expect(readBlockText(root).text).toBe("Deeper seaweed layers held more water.");
  });

  it("puts one space where a block-level element begins and ends, none at an inline element's", () => {
    const blocks = el("div", {}, el("p", {}, "First line."), el("p", {}, "Second line."));
    expect(readBlockText(blocks).text).toBe("First line. Second line.");
    const inline = el("div", {}, el("span", {}, "Foo"), el("em", {}, "bar"), "baz");
    expect(readBlockText(inline).text).toBe("Foobarbaz");
  });

  it("asks the environment which elements are block-level, hidden and formulas (the browser reads the computed style)", () => {
    const root = el("div", {}, el("span", {}, "left"), el("span", {}, "right"), el("i", {}, "gone"), el("span", { class: "tex" }, "x²"));
    const read = readBlockText(root, {
      isBlock: (n) => n.nodeName === "SPAN",
      isHidden: (n) => n.nodeName === "I",
      isFormula: (n) => (n as unknown as { attrs: Record<string, string> }).attrs.class === "tex",
    });
    expect(read.text).toBe("left right \u0000");
  });

  it("reads a line break as a line of its own: the words either side of it are a space apart, as a selection reads them", () => {
    expect(readBlockText(el("p", {}, "First", el("br"), "second")).text).toBe("First second");
    expect(readBlockText(el("p", {}, "First ", el("br"), " second")).text).toBe("First second");
  });

  it("reads a text node as the page draws it when the environment says so (a label set in capitals is read as capitals by a selection), by the same characters", () => {
    const label = text("How it was done");
    const root = el("div", {}, el("span", {}, label), el("span", {}, " and more"));
    const read = readBlockText(root, { textOf: (node) => (node === label ? node.data.toUpperCase() : node.data) });
    expect(read.text).toBe("HOW IT WAS DONE and more");
    expect(read.runs[0].node).toBe(label);
    expect(rawSpanOf(read.runs[0], 0, 10)).toEqual({ start: 0, end: 10 });
    // a drawing that changes the number of characters would put every later character out of place: the node's own data stands
    expect(readBlockText(el("div", {}, "Straße"), { textOf: () => "STRASSE" }).text).toBe("Straße");
    expect(readBlockText(el("div", {}, "plain"), { textOf: () => undefined as never }).text).toBe("plain");
  });

  it("leaves out what the selection reader leaves out: scripts, styles, hidden elements and a superscript's words", () => {
    const root = el("div", {}, "a", el("script", {}, "var x"), el("style", {}, ".y{}"), el("span", { hidden: "" }, "hid"), el("sup", {}, "[3]"), "b");
    expect(readBlockText(root).text).toBe("ab");
  });

  it("is empty for an element with no words, and never throws on a node it does not know", () => {
    expect(readBlockText(el("div", {})).text).toBe("");
    expect(readBlockText(el("div", {}, "  \n ")).text).toBe("");
    const odd = el("div", {}, "x");
    (odd.childNodes as unknown[]).push({ nodeType: 8, nodeName: "#comment", data: "c" });
    expect(readBlockText(odd).text).toBe("x");
  });

  it("holds each text node's place: the words it gave, from where to where, and where each of its characters went", () => {
    const first = text("Seaweed  holds");
    const second = text(" water");
    const root = el("div", {}, first, el("b", {}, second));
    const read = readBlockText(root);
    expect(read.text).toBe("Seaweed holds water");
    expect(read.runs.map((r) => [r.node, r.from, r.to])).toEqual([
      [first, 0, 13],
      [second, 13, 19],
    ]);
    // the second space of "Seaweed  holds" is dropped (it collapsed into the first); the leading space of " water" is kept, it is the single space
    expect(read.runs[0].emit.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, -1, 8]);
    expect(read.runs[1].emit).toEqual([13, 14, 15, 16, 17, 18]);
    expect(read.text.slice(read.runs[1].from, read.runs[1].to)).toBe(" water");
  });

  it("drops the leading space of a block and of a text node that follows a space", () => {
    const a = text("one ");
    const b = text(" two");
    const read = readBlockText(el("div", {}, "  ", a, b));
    expect(read.text).toBe("one two");
    expect(read.runs.map((r) => r.node)).toEqual([a, b]);
    expect(read.runs[1].emit).toEqual([-1, 4, 5, 6]);
  });
});

describe("where a raw offset falls in the words, and a range of the words in a text node", () => {
  const first = text("Seaweed  holds");
  const root = el("div", {}, first, el("b", {}, " water"));
  const read = readBlockText(root);
  const [one, two] = read.runs;

  it("boundaryOf: the place in the words of a boundary between two characters of the node", () => {
    expect(boundaryOf(one, 0)).toBe(0);
    expect(boundaryOf(one, 7)).toBe(7);
    // a boundary before the dropped space, or after it, stands where the next kept character stands
    expect(boundaryOf(one, 8)).toBe(8);
    expect(boundaryOf(one, 9)).toBe(8);
    expect(boundaryOf(one, first.data.length)).toBe(13);
    expect(boundaryOf(two, 0)).toBe(13);
  });

  it("rawSpanOf: the raw start and end of the words [start, end) that fall in the node, or null when none do", () => {
    expect(rawSpanOf(one, 0, 7)).toEqual({ start: 0, end: 7 });
    // "holds" is at 8..13 in the words and 9..14 in the node
    expect(rawSpanOf(one, 8, 13)).toEqual({ start: 9, end: 14 });
    // a range that starts before the node and ends inside it
    expect(rawSpanOf(one, 0, 3)).toEqual({ start: 0, end: 3 });
    // a range that starts inside the node and runs past its end takes the node to its end
    expect(rawSpanOf(two, 14, 99)).toEqual({ start: 1, end: 6 });
    expect(rawSpanOf(one, 13, 19)).toBeNull();
    expect(rawSpanOf(two, 0, 13)).toBeNull();
  });
});

describe("selectionStartIn — where the reader's selection began in the words", () => {
  const first = text("A soil water. ");
  const second = text("More soil water.");
  const root = el("div", {}, el("p", {}, first), el("p", {}, second));
  const read = readBlockText(root);

  it("is the place of the range's start in the words: in the first node, in the second", () => {
    expect(read.text).toBe("A soil water. More soil water.");
    expect(selectionStartIn(read, rangeStartingAt(root, first, 2))).toBe(2);
    expect(selectionStartIn(read, rangeStartingAt(root, second, 5))).toBe(19);
  });

  it("tells the second 'soil water' from the first", () => {
    const at = selectionStartIn(read, rangeStartingAt(root, second, 5));
    expect(read.text.slice(at, at! + 10)).toBe("soil water");
    expect(at).toBeGreaterThan(read.text.indexOf("soil water"));
  });

  it("is undefined when the range cannot tell (a point it cannot compare), never a throw", () => {
    const broken = { startContainer: first, startOffset: 1, comparePoint: () => { throw new Error("WrongDocumentError"); } };
    expect(selectionStartIn(read, broken)).toBeUndefined();
    expect(selectionStartIn(read, null)).toBeUndefined();
    expect(textNodesOf(root)).toHaveLength(2);
  });
});
