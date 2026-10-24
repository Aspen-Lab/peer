import { describe, expect, it } from "vitest";
import { canHighlight } from "@/components/notes/highlight";
import { ANCHOR_BLOCK_ATTRIBUTE, EXPLAIN_SOURCE_ATTRIBUTE, MAX_SELECTION_CHARS, paragraphAnchor, readSelection, type SelectionLike } from "./paper-body";
import { offeredActions } from "./selection-toolbar";

// P11-50 (found by C P11-47, its §9 item 2, checked in the browser; ruling §1h.155): a selection that runs from one Summary block into the next — or from
// one block of an answer into another — is offered all three buttons (a P10-08 pin: "across two blocks of the Summary is one container's worth"), and Explain
// this and Take notes work on it. Highlight makes nothing: the passage is not found whole in the first block's words, so there is nothing to mark, and
// the selection is left as it was. A button that does nothing is the defect. A highlight is one block's words (D5), so Highlight is offered only where it
// makes a mark: `readSelection` says the target spans two blocks (`spansBlocks: true`, set only when it is true, on the target the page hands to
// `canHighlight`), and `canHighlight` is false for it. Everything else reads, and is offered, as it was. No DOM in this project's Vitest: a small tree
// stands in for it. Every text is invented.

type Rect = { left: number; top: number; right: number; bottom: number };

interface Node_ {
  nodeType: number;
  tag: string;
  id: string;
  attrs: Record<string, string>;
  parentElement: Node_ | null;
  closest(selector: string): Node_ | null;
  getAttribute(name: string): string | null;
}

/** Whether `el` matches one simple selector: `tag`, `#id`, `[attr]`, `[attr='value']`, `[attr="value"]`. */
function matches(el: Node_, simple: string): boolean {
  const attr = /^\[([\w-]+)(?:=(?:'([^']*)'|"([^"]*)"))?\]$/.exec(simple);
  if (attr) {
    const value = attr[2] ?? attr[3];
    return value === undefined ? attr[1] in el.attrs : el.attrs[attr[1]] === value;
  }
  if (simple.startsWith("#")) return el.id === simple.slice(1);
  return el.tag === simple;
}

function el(tag: string, parent: Node_ | null, attrs: Record<string, string> = {}, id = ""): Node_ {
  const self: Node_ = {
    nodeType: 1,
    tag,
    id,
    attrs,
    parentElement: parent,
    getAttribute: (name) => attrs[name] ?? null,
    closest(selector) {
      const list = selector.split(",").map((part) => part.trim());
      for (let at: Node_ | null = self; at; at = at.parentElement) if (list.some((simple) => matches(at as Node_, simple))) return at;
      return null;
    },
  };
  return self;
}
const text = (parent: Node_) => ({ nodeType: 3, parentElement: parent });

const LINE: Rect[] = [{ left: 100, top: 200, right: 260, bottom: 220 }];

function selecting(start: { nodeType: number; parentElement: Node_ | null }, end = start, words = "a short passage", endOffset = 5): SelectionLike {
  const made = {
    startContainer: start,
    endContainer: end,
    endOffset,
    cloneRange: () => made,
    cloneContents: () => ({ querySelector: () => null }),
    getClientRects: () => LINE,
    getBoundingClientRect: () => LINE[0],
  };
  return { rangeCount: 1, isCollapsed: false, toString: () => words, getRangeAt: () => made as never };
}

/** A page in miniature: the body (two paragraphs, a heading, a figure with its caption), a Summary container with two blocks, an answers container with two blocks and one with a single block. */
function page() {
  const root = el("div", null);
  const body = el("div", root, {}, "paper-body");
  const host = el("div", body, {}, paragraphAnchor(1, 2));
  const p = el("p", host);
  const nextHost = el("div", body, {}, paragraphAnchor(1, 3));
  const next = el("p", nextHost);
  const heading = el("h3", body, { [ANCHOR_BLOCK_ATTRIBUTE]: "heading" }, paragraphAnchor(1, 4));
  const figure = el("figure", body, { [ANCHOR_BLOCK_ATTRIBUTE]: "caption" }, paragraphAnchor(1, 5));
  const caption = el("figcaption", figure);
  const summary = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "summary" });
  const blockA = el("section", summary, {}, "summary-proposal");
  const pa = el("p", blockA);
  const blockB = el("section", summary, {}, "summary-method");
  const pb = el("p", blockB);
  const answers = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "answer" });
  const answerA = el("section", answers, {}, "answers-block");
  const pansA = el("p", answerA);
  const answerB = el("section", answers, {}, "answers-more");
  const pansB = el("p", answerB);
  // The page's own shape: the answers are one block (`answers-block`) holding every question's answer, so two answers are two paragraphs of the one block.
  const oneAnswers = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "answer" });
  const oneBlock = el("section", oneAnswers, {}, "answers-block");
  const q1 = el("p", oneBlock);
  const q2 = el("p", oneBlock);
  return { p, next, heading, caption, pa, pb, pansA, pansB, q1, q2 };
}

/** Invented words, at least `n` characters long once the white space is collapsed. */
function words(n: number): string {
  let out = "";
  for (let i = 0; collapsed(out).length < n; i += 1) out += `pool${i} counted${i % 7} `;
  return out;
}
function collapsed(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
/** What the new field says about a read, without naming it in the type (the field is the fix's, and this file must compile on the commit before it). */
const spans = (read: unknown): unknown => (read as { spansBlocks?: unknown } | null)?.spansBlocks;
/** Whether the read carries the field at all: it is set only when it is true. */
const carries = (read: unknown): boolean => read !== null && typeof read === "object" && "spansBlocks" in read;
/** What the margin offers for a read, as the page asks it (`canHighlight` of the target, a handler for Highlight, a key). */
const offered = (read: Parameters<typeof canHighlight>[0]) => offeredActions({ canExplain: true, onHighlight: () => undefined, canHighlight: canHighlight(read) });

describe("readSelection — a selection across two blocks of one Summary or answer says so (P11-50, ruling §1h.155 rule 1)", () => {
  it("across two Summary blocks, short: still a target of the first block's id (Explain this and Take notes keep it), and it spans blocks", () => {
    const { pa, pb } = page();
    const read = readSelection(selecting(text(pa), text(pb), "the end of one block and the start of the next", 40));
    expect(read).toMatchObject({ source: "summary", sectionIndex: -1, paragraphIndex: -1, paragraphId: "summary-proposal", passage: "the end of one block and the start of the next" });
    expect(spans(read)).toBe(true);
  });

  it("the rest of that target is what it was: the same fields, the same places on screen, nothing but the one new field", () => {
    const { pa, pb } = page();
    const read = readSelection(selecting(text(pa), text(pb), "the end of one block and the start of the next", 40));
    const before = Object.fromEntries(Object.entries(read as object).filter(([key]) => key !== "spansBlocks"));
    expect(before).toEqual({
      sectionIndex: -1,
      paragraphIndex: -1,
      passage: "the end of one block and the start of the next",
      source: "summary",
      paragraphId: "summary-proposal",
      rect: LINE[0],
      bounds: LINE[0],
      measure: expect.any(Function),
    });
    expect(Object.keys(read as object).sort()).toEqual([...Object.keys(before), "spansBlocks"].sort());
  });

  it("at the cap — 1,200 characters across two blocks — is a target that spans; one over it is no target, as before", () => {
    const { pa, pb } = page();
    const read = readSelection(selecting(text(pa), text(pb), "y".repeat(MAX_SELECTION_CHARS), 40));
    expect(read).toMatchObject({ source: "summary", paragraphId: "summary-proposal" });
    expect(spans(read)).toBe(true);
    expect(readSelection(selecting(text(pa), text(pb), "y".repeat(MAX_SELECTION_CHARS + 1), 40))).toBeNull();
    expect(readSelection(selecting(text(pa), text(pb), words(3000), 40))).toBeNull();
  });

  it("a drag that runs on into the next block and ends at the start of its text carries a break in its words: it spans too", () => {
    const { pa, pb } = page();
    const read = readSelection(selecting(text(pa), text(pb), "the end of one block\nthe start of the next", 0));
    expect(read).toMatchObject({ source: "summary", paragraphId: "summary-proposal" });
    expect(spans(read)).toBe(true);
  });

  it("across two blocks of an answer container: a target of the first block's id, and it spans", () => {
    const { pansA, pansB } = page();
    const read = readSelection(selecting(text(pansA), text(pansB), "the end of one answer and the start of the next", 40));
    expect(read).toMatchObject({ source: "answer", paragraphId: "answers-block", passage: "the end of one answer and the start of the next" });
    expect(spans(read)).toBe(true);
  });

  it("across two answers of the page's one answers block (one id): one block, so it does not span — the block's words hold the whole passage", () => {
    const { q1, q2 } = page();
    const read = readSelection(selecting(text(q1), text(q2), "the end of one answer and the start of the next", 40));
    expect(read).toMatchObject({ source: "answer", paragraphId: "answers-block" });
    expect(carries(read)).toBe(false);
  });
});

describe("readSelection — everything else carries no such field (ruling §1h.155 rule 2)", () => {
  it("a short drag inside one Summary block, and one of any length", () => {
    const { pb } = page();
    for (const passage of ["a short passage", words(300), words(1200), words(3000)]) {
      const read = readSelection(selecting(text(pb), text(pb), passage, 5));
      expect(read, String(passage.length)).toMatchObject({ source: "summary", paragraphId: "summary-method", passage: collapsed(passage) });
      expect(carries(read), String(passage.length)).toBe(false);
    }
  });

  it("a triple click on a Summary block — the browser ends it at the start of the next block, with no break in the words — is that one block, short or long", () => {
    const { pa, pb } = page();
    for (const passage of [words(300), words(1800)]) {
      const read = readSelection(selecting(text(pa), text(pb), `${collapsed(passage)}\n\n`, 0));
      expect(read, String(passage.length)).toMatchObject({ source: "summary", paragraphId: "summary-proposal", passage: collapsed(passage) });
      expect(carries(read), String(passage.length)).toBe(false);
    }
  });

  it("a triple click on an answer's block, and a drag inside one answer, of any length", () => {
    const { pansA, pansB } = page();
    const triple = readSelection(selecting(text(pansA), text(pansB), `${collapsed(words(500))}\n\n`, 0));
    expect(triple).toMatchObject({ source: "answer", paragraphId: "answers-block" });
    expect(carries(triple)).toBe(false);
    for (const passage of ["a short passage", words(2500)]) {
      const read = readSelection(selecting(text(pansB), text(pansB), passage, 5));
      expect(read).toMatchObject({ source: "answer", paragraphId: "answers-more" });
      expect(carries(read)).toBe(false);
    }
  });

  it("inside one paragraph of the body, a triple click on one, a heading's words and a caption's words, of any length", () => {
    const { p, next, heading, caption } = page();
    for (const passage of ["a short passage", words(300), words(3000)]) {
      const inside = readSelection(selecting(text(p), text(p), passage, 5));
      expect(inside, String(passage.length)).toMatchObject({ source: "paper", paragraphId: paragraphAnchor(1, 2) });
      expect(carries(inside), String(passage.length)).toBe(false);
    }
    const triple = readSelection(selecting(text(p), text(next), `${collapsed(words(900))}\n\n`, 0));
    expect(triple).toMatchObject({ source: "paper", paragraphId: paragraphAnchor(1, 2) });
    expect(carries(triple)).toBe(false);
    const inHeading = readSelection(selecting(text(heading), text(heading), "Invented methods", 5));
    expect(inHeading).toMatchObject({ source: "paper", block: "heading", paragraphId: paragraphAnchor(1, 4) });
    expect(carries(inHeading)).toBe(false);
    const inCaption = readSelection(selecting(text(caption), text(caption), "Invented layout of the plots", 5));
    expect(inCaption).toMatchObject({ source: "paper", block: "caption", paragraphId: paragraphAnchor(1, 5) });
    expect(carries(inCaption)).toBe(false);
  });

  it("across two paragraphs of the body (or a heading and a paragraph) it is no target at all, as before: nothing to flag", () => {
    const { p, next, heading } = page();
    expect(readSelection(selecting(text(p), text(next), words(300), 40))).toBeNull();
    expect(readSelection(selecting(text(p), text(next), "a short passage across", 40))).toBeNull();
    expect(readSelection(selecting(text(heading), text(p), "a short passage across", 40))).toBeNull();
  });
});

describe("canHighlight and the margin's offering follow the field (ruling §1h.155 rule 1)", () => {
  it("a selection across two Summary blocks, or across two blocks of an answer, is not offered Highlight; it is still offered Explain this and Take notes", () => {
    const { pa, pb, pansA, pansB } = page();
    const summary = readSelection(selecting(text(pa), text(pb), "the end of one block and the start of the next", 40));
    const answer = readSelection(selecting(text(pansA), text(pansB), "the end of one answer and the start of the next", 40));
    for (const read of [summary, answer]) {
      expect(read).not.toBeNull();
      expect(canHighlight(read)).toBe(false);
      expect(offered(read)).toEqual(["explain", "note"]);
    }
  });

  it("every other selection is offered what it was: the three actions", () => {
    const { p, next, heading, caption, pa, pb, pansA, q1, q2 } = page();
    const reads = {
      "inside a Summary block": readSelection(selecting(text(pb), text(pb), "a short passage", 5)),
      "inside a Summary block, long": readSelection(selecting(text(pb), text(pb), words(3000), 5)),
      "triple click on a Summary block": readSelection(selecting(text(pa), text(pb), `${collapsed(words(500))}\n\n`, 0)),
      "inside an answer": readSelection(selecting(text(pansA), text(pansA), "a short passage", 5)),
      "across two answers of the one answers block": readSelection(selecting(text(q1), text(q2), "the end of one answer and the start of the next", 40)),
      "inside a paragraph": readSelection(selecting(text(p), text(p), "a short passage", 5)),
      "triple click on a paragraph": readSelection(selecting(text(p), text(next), `${collapsed(words(900))}\n\n`, 0)),
      "inside a heading": readSelection(selecting(text(heading), text(heading), "Invented methods", 5)),
      "inside a caption": readSelection(selecting(text(caption), text(caption), "Invented layout", 5)),
    };
    for (const [name, read] of Object.entries(reads)) {
      expect(read, name).not.toBeNull();
      expect(canHighlight(read), name).toBe(true);
      expect(offered(read), name).toEqual(["explain", "note", "highlight"]);
    }
  });
});
