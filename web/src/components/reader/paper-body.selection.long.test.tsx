import { describe, expect, it } from "vitest";

// P11-47 (round 3, Theme B walk, weighed (f); ruling §1h.148 rules 1 and 3): a selection inside ONE block — a paragraph, a caption, a heading, a Summary
// block, an answer — is a target whatever its length. It was a target only up to 1,200 characters (the Explain route's passage cap), so a triple-click
// on a paragraph of 1,300 to 3,000 characters offered nothing, not Highlight, not Take notes: on the owner's paper 10 of 13 paragraphs. The cap is
// Explain's now (`MAX_SELECTION_CHARS`, which the explain request clips at); the selection has none. A selection across two blocks is still no target
// (D5), long or short: a paragraph's two ends are in two places, and a Summary or answer selection over the cap must stay in one block. A selection of up
// to 1,200 characters is read exactly as it was (rule 3). No DOM in this project's Vitest: a small tree stands in for it. Every text is invented.
import { EXPLAIN_SOURCE_ATTRIBUTE, MAX_SELECTION_CHARS, paragraphAnchor, readSelection, selectionTarget, type SelectionLike } from "./paper-body";

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

/** Whether `el` matches one simple selector: `tag`, `#id`, `[attr]`, `[attr='value']`. */
function matches(el: Node_, simple: string): boolean {
  const attr = /^\[([\w-]+)(?:='([^']*)')?\]$/.exec(simple);
  if (attr) return attr[2] === undefined ? attr[1] in el.attrs : el.attrs[attr[1]] === attr[2];
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

function selecting(start: { nodeType: number; parentElement: Node_ | null }, end = start, words = "a short passage", endOffset = 5, hasFormula = false): SelectionLike {
  const made = {
    startContainer: start,
    endContainer: end,
    endOffset,
    cloneRange: () => made,
    cloneContents: () => ({ querySelector: (selector: string) => (hasFormula && selector.includes(".katex") ? {} : null) }),
    getClientRects: () => LINE,
    getBoundingClientRect: () => LINE[0],
  };
  return { rangeCount: 1, isCollapsed: false, toString: () => words, getRangeAt: () => made as never };
}

/** A page in miniature: the body with two paragraphs, a Summary container with two blocks, an answers container with one block. */
function page() {
  const root = el("div", null);
  const body = el("div", root, {}, "paper-body");
  const host = el("div", body, {}, paragraphAnchor(1, 2));
  const p = el("p", host);
  const nextHost = el("div", body, {}, paragraphAnchor(1, 3));
  const next = el("p", nextHost);
  const summary = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "summary" });
  const blockA = el("section", summary, {}, "summary-proposal");
  const pa = el("p", blockA);
  const blockB = el("section", summary, {}, "summary-method");
  const pb = el("p", blockB);
  const answers = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "answer" });
  const answer = el("section", answers, {}, "answers-block");
  const pans = el("p", answer);
  return { p, next, pa, pb, pans };
}

/** Invented words, at least `n` characters long, with the odd double space and (unless `breaks` is false) the odd line break a selection carries. A triple click on one paragraph carries no break inside it. */
function words(n: number, breaks = true): string {
  let out = "";
  for (let i = 0; out.length < n; i += 1) out += `pool${i} counted${i % 7}${i % 3 === 0 ? "  " : breaks && i % 5 === 0 ? "\n" : " "}`;
  return out;
}
const collapsed = (value: string) => value.replace(/\s+/g, " ").trim();

describe("selectionTarget — one block, any length (ruling §1h.148 rule 1)", () => {
  const id = paragraphAnchor(2, 3);

  it("is a target for a paragraph's selection over 1,200 characters: 1,201, 3,000 and 20,000", () => {
    for (const n of [1201, 3000, 20000]) {
      const long = words(n);
      expect(collapsed(long).length).toBeGreaterThan(1200);
      expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: long }), String(n)).toEqual({
        sectionIndex: 2,
        paragraphIndex: 3,
        passage: collapsed(long),
        source: "paper",
        paragraphId: id,
      });
    }
  });

  it("is a target for a Summary block's and an answer's selection over 1,200 characters too", () => {
    const long = words(3000);
    expect(selectionTarget({ anchorParagraphId: "summary-method", focusParagraphId: "summary-method", text: long, source: "summary" })).toEqual({
      sectionIndex: -1,
      paragraphIndex: -1,
      passage: collapsed(long),
      source: "summary",
      paragraphId: "summary-method",
    });
    expect(selectionTarget({ anchorParagraphId: "answers-block", focusParagraphId: "answers-block", text: long, source: "answer" })).toMatchObject({ source: "answer", passage: collapsed(long) });
  });

  it("is still nothing for an empty selection, two paragraphs, or a place that is no paragraph — whatever the length", () => {
    const long = words(3000);
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: " \n\t " })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: paragraphAnchor(2, 4), text: long })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: "paper-section-2", focusParagraphId: "paper-section-2", text: long })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: null, focusParagraphId: null, text: long })).toBeNull();
  });

  it("keeps 1,200 as Explain's cap: the constant is still the route's passage cap, and a selection up to it is read exactly as it was (rule 3)", () => {
    expect(MAX_SELECTION_CHARS).toBe(1200);
    for (const n of [1, 80, 800, 1199, 1200]) {
      const text = "x".repeat(n);
      expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text })).toEqual({ sectionIndex: 2, paragraphIndex: 3, passage: text, source: "paper", paragraphId: id });
    }
    expect(selectionTarget({ anchorParagraphId: id, focusParagraphId: id, text: `${"x ".repeat(500)}\n\n\n      ${"y ".repeat(50)}` })).not.toBeNull();
  });
});

describe("readSelection — a long selection inside one block (ruling §1h.148 rule 1)", () => {
  it("a drag across 2,000 characters inside one paragraph: the paragraph's id, the whole passage", () => {
    const { p } = page();
    const long = words(2000);
    const read = readSelection(selecting(text(p), text(p), long));
    expect(read).toMatchObject({ source: "paper", sectionIndex: 1, paragraphIndex: 2, paragraphId: paragraphAnchor(1, 2), passage: collapsed(long) });
    expect(read?.passage.length).toBeGreaterThan(1200);
  });

  it("a triple click on a paragraph of 3,000 characters — the browser ends it at the start of the next paragraph — is the whole paragraph", () => {
    const { p, next } = page();
    const long = words(3000, false);
    const read = readSelection(selecting(text(p), text(next), `${long}\n\n`, 0));
    expect(read).toMatchObject({ source: "paper", paragraphId: paragraphAnchor(1, 2), passage: collapsed(long) });
  });

  it("a long selection across two paragraphs is no target (D5): the ends are in two places", () => {
    const { p, next } = page();
    expect(readSelection(selecting(text(p), text(next), words(3000), 40))).toBeNull();
    expect(readSelection(selecting(text(p), text(next), words(300), 40))).toBeNull();
  });

  it("a long selection with a drawn formula in it is no target, as a short one is not", () => {
    const { p } = page();
    expect(readSelection(selecting(text(p), text(p), words(3000), 5, true))).toBeNull();
    expect(readSelection(selecting(text(p), text(p), words(300), 5, true))).toBeNull();
  });

  it("a Summary block's selection over 1,200 characters is a target, with the block's own id", () => {
    const { pb } = page();
    const long = words(1500);
    expect(readSelection(selecting(text(pb), text(pb), long))).toMatchObject({ source: "summary", sectionIndex: -1, paragraphId: "summary-method", passage: collapsed(long) });
  });

  it("an answer's selection over 1,200 characters is a target", () => {
    const { pans } = page();
    const long = words(2500);
    expect(readSelection(selecting(text(pans), text(pans), long))).toMatchObject({ source: "answer", paragraphId: "answers-block", passage: collapsed(long) });
  });

  it("a Summary selection over 1,200 characters across two blocks is no target (D5), though a short one across two stays as it was: one container's worth", () => {
    const { pa, pb } = page();
    expect(readSelection(selecting(text(pa), text(pb), words(1500), 40))).toBeNull();
    expect(readSelection(selecting(text(pa), text(pb), words(300), 40))).toMatchObject({ source: "summary", paragraphId: "summary-proposal" });
    expect(readSelection(selecting(text(pa), text(pb), words(1190), 40))).toMatchObject({ source: "summary", paragraphId: "summary-proposal" });
  });

  it("a long triple click on a Summary block, ending at the start of the next block, is that block's words", () => {
    const { pa, pb } = page();
    const long = words(1800, false);
    expect(readSelection(selecting(text(pa), text(pb), `${long}\n\n`, 0))).toMatchObject({ source: "summary", paragraphId: "summary-proposal", passage: collapsed(long) });
  });
});
