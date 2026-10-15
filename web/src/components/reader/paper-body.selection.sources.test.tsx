import { describe, expect, it } from "vitest";

// P10-08 (the owner's review of 2026-10-13, item 8.4: "不仅仅是正文，甚至可以是summary或者for your question里的answer，但是不包括最左边的各种功能button"):
// any selected text of the paper's body, of the Summary's blocks or of an answer under the question is an explain target, and a selection with an
// end inside a control, or in a place the page has not marked (the commands at the left, the map, the question bar, the notes), is not. The
// page marks the Summary's and the answers' containers with `data-explain-source`; the body's paragraphs are found by their anchors, as
// before. No DOM in this project's Vitest: a small tree stands in for it, with the one selector matcher `closest` needs.
import {
  EXPLAIN_SOURCE_ATTRIBUTE,
  MAX_SELECTION_CHARS,
  paragraphAnchor,
  readSelection,
  sameSelection,
  selectionTarget,
  type SelectionLike,
} from "./paper-body";

type Rect = { left: number; top: number; right: number; bottom: number };

interface Node_ {
  nodeType: number;
  tag: string;
  id: string;
  attrs: Record<string, string>;
  parentElement: Node_ | null;
  closest(selector: string): Node_ | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect?(): Rect;
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

/** A page in miniature: the body with one paragraph, a Summary container with two blocks, an answers container, and furniture outside both. */
function page() {
  const root = el("div", null);
  const body = el("div", root, {}, "paper-body");
  const host = el("div", body, {}, paragraphAnchor(1, 2));
  const p = el("p", host);
  const summary = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "summary" });
  const blockA = el("section", summary, {}, "block-a");
  const pa = el("p", blockA);
  const blockB = el("section", summary, { "data-explain-id": "block-b" });
  const pb = el("p", blockB);
  const answers = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "answer" });
  const answer = el("div", answers);
  const pans = el("p", answer);
  const commands = el("nav", root);
  const command = el("p", commands);
  const map = el("div", root);
  const mapText = el("p", map);
  const field = el("div", root);
  const textarea = el("textarea", field);
  return { root, body, p, summary, blockA, pa, blockB, pb, answers, pans, command, mapText, textarea, answer };
}

describe("selectionTarget — a selection of the Summary or an answer (P10-08)", () => {
  it("is the container's own id and the words, with no section or paragraph of the paper", () => {
    expect(selectionTarget({ anchorParagraphId: "block-a", focusParagraphId: "block-a", text: "  the  claim\n of the paper ", source: "summary" })).toEqual({
      sectionIndex: -1,
      paragraphIndex: -1,
      passage: "the claim of the paper",
      source: "summary",
      paragraphId: "block-a",
    });
    expect(selectionTarget({ anchorParagraphId: "answers", focusParagraphId: "answers", text: "x", source: "answer" })).toMatchObject({ source: "answer", paragraphId: "answers" });
  });

  it("keeps the cap, the non-empty rule and the one-container rule", () => {
    expect(selectionTarget({ anchorParagraphId: "a", focusParagraphId: "a", text: "x".repeat(MAX_SELECTION_CHARS), source: "summary" })).not.toBeNull();
    expect(selectionTarget({ anchorParagraphId: "a", focusParagraphId: "a", text: "x".repeat(MAX_SELECTION_CHARS + 1), source: "summary" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: "a", focusParagraphId: "a", text: " \n ", source: "answer" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: "a", focusParagraphId: "b", text: "x", source: "summary" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: null, focusParagraphId: null, text: "x", source: "answer" })).toBeNull();
  });

  it("is not the paper's body unless it says so: a source of \"paper\" still needs a paragraph's anchor", () => {
    expect(selectionTarget({ anchorParagraphId: "block-a", focusParagraphId: "block-a", text: "x" })).toBeNull();
    expect(selectionTarget({ anchorParagraphId: "block-a", focusParagraphId: "block-a", text: "x", source: "paper" })).toBeNull();
  });
});

describe("readSelection — where a selection may be (P10-08, review 8.4)", () => {
  it("the paper's body: yes, as before, and it says so", () => {
    const { p } = page();
    const read = readSelection(selecting(text(p)));
    expect(read).toMatchObject({ source: "paper", sectionIndex: 1, paragraphIndex: 2, paragraphId: paragraphAnchor(1, 2), passage: "a short passage" });
  });

  it("a block of the Summary: yes — the block's own id (its data-explain-id, else its id), no section or paragraph of the paper", () => {
    const { pa, pb } = page();

    expect(readSelection(selecting(text(pa)))).toMatchObject({ source: "summary", sectionIndex: -1, paragraphIndex: -1, paragraphId: "block-a", passage: "a short passage" });
    expect(readSelection(selecting(text(pb)))).toMatchObject({ source: "summary", paragraphId: "block-b" });
  });

  it("an answer under the question: yes", () => {
    const { pans } = page();
    expect(readSelection(selecting(text(pans)))).toMatchObject({ source: "answer", sectionIndex: -1, paragraphId: "answer", passage: "a short passage" });
  });

  it("the container with no id of its own is named for what it is", () => {
    const { answers } = page();
    const bare = el("span", answers);
    expect(readSelection(selecting(text(bare)))).toMatchObject({ source: "answer", paragraphId: "answer" });
  });

  it("across two blocks of the Summary is one container's worth: yes; across the Summary and an answer: no", () => {
    const { pa, pb, pans } = page();

    expect(readSelection(selecting(text(pa), text(pb), "the end of one block and the start of the next"))).toMatchObject({ source: "summary", paragraphId: "block-a" });
    expect(readSelection(selecting(text(pa), text(pans)))).toBeNull();
  });

  it("across the paper and the Summary: no", () => {
    const { p, pa } = page();
    expect(readSelection(selecting(text(p), text(pa)))).toBeNull();
  });

  it("the commands at the left, the map, the question bar: no — they are in no marked container", () => {
    const { command, mapText, textarea } = page();

    expect(readSelection(selecting(text(command)))).toBeNull();
    expect(readSelection(selecting(text(mapText)))).toBeNull();
    expect(readSelection(selecting(text(textarea)))).toBeNull();
  });

  it("a control inside a marked container: no — a button, a link, a field, a label, a summary", () => {
    for (const tag of ["button", "a", "input", "textarea", "select", "label", "summary"]) {
      const { blockA } = page();
      const control = el(tag, blockA);
      expect(readSelection(selecting(text(control))), tag).toBeNull();
    }
    const { blockA } = page();
    const tab = el("div", blockA, { role: "tab" });
    expect(readSelection(selecting(text(el("span", tab))))).toBeNull();
    const editable = el("div", blockA, { contenteditable: "true" });
    expect(readSelection(selecting(text(editable)))).toBeNull();
  });

  it("a container marked with another value is none; so is one marked with nothing the page knows", () => {
    const root = el("div", null);
    const odd = el("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "notes" });
    expect(readSelection(selecting(text(el("p", odd))))).toBeNull();
  });

  it("a triple click that ends at the start of the next block is the first block's words", () => {
    const { pa, pb } = page();
    const read = readSelection(selecting(text(pa), pb as never, "A whole block of the Summary.\n\n", 0));
    expect(read).toMatchObject({ source: "summary", paragraphId: "block-a" });
  });

  it("keeps the 1,200-character cap and the formula rule for these sources", () => {
    const { pa } = page();
    expect(readSelection(selecting(text(pa), text(pa), "x".repeat(MAX_SELECTION_CHARS + 1)))).toBeNull();
    const withFormula = selecting(text(pa));
    withFormula.getRangeAt(0).cloneContents = () => ({ querySelector: (selector: string) => (selector.includes(".katex") ? {} : null) });
    expect(readSelection(withFormula)).toBeNull();
  });

  it("measures itself again, and has no paragraph box (the window stands at the masthead's foot)", () => {
    const { pa } = page();
    const read = readSelection(selecting(text(pa)));
    expect(read).not.toHaveProperty("paragraph");
    expect(read?.measure?.()?.rect).toEqual(LINE[0]);
  });

  it("the same words in the Summary and in the body are different selections", () => {
    const { p, pa } = page();
    const inBody = readSelection(selecting(text(p)));
    const inSummary = readSelection(selecting(text(pa)));

    expect(sameSelection(inBody, inSummary)).toBe(false);
    expect(sameSelection(inSummary, readSelection(selecting(text(pa))))).toBe(true);
    const other = readSelection(selecting(text(page().pb)));
    expect(sameSelection(inSummary, other)).toBe(false);
  });
});
