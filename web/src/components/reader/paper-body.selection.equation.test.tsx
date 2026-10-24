import { describe, expect, it } from "vitest";

// P11-56 (round 4, Theme B walk E-2; ruling §1h.165 rules 1 and 2): a triple click on a paragraph that stands before a displayed equation selected the paragraph and
// was offered nothing — not Explain this, not Take notes, not Highlight (2 of 55 paragraphs of the owner's paper; a drag over the same words was offered all three). The browser
// ends a triple click's selection at offset 0 of the next block, and here the next block is the equation: its `code` (a PDF's line as printed) or, for a paper drawn from
// HTML, KaTeX's markup. `readSelection` rolled that end back to the paragraph (`endsAtNextStart`), as for a next paragraph — and then asked the range's CLONED contents
// whether they held a formula (`FORMULA_SELECTOR`). A range's `cloneContents()` carries a clone of every ancestor its end sits in, empty (the end is at offset 0: none of the
// next block's words are in it) — and an equation's `code`, or its `.katex`, is one of them. The paragraph's selection was read as a selection with a formula in it.
//
// No DOM in this project's Vitest, and the cause is what a DOM's `cloneContents()` returns, so a small tree stands in for one that does what a DOM does: the range's
// ends, `cloneContents()` by the DOM spec's own steps (the partially contained ancestors are cloned, empty where nothing of them is in the range), `setEnd`,
// `selectNodeContents`, `toString`. Every text is invented.
import { ANCHOR_BLOCK_ATTRIBUTE, paragraphAnchor, readSelection, type SelectionLike } from "./paper-body";

// ── A DOM, as far as the reading needs one: elements, text, and a Range whose `cloneContents()` is the DOM's ──

type Rect = { left: number; top: number; right: number; bottom: number };
type TNode = TText | TEl;

class TText {
  readonly nodeType = 3;
  readonly nodeName = "#text";
  parent: TEl | null = null;
  constructor(public data: string) {}
  get parentElement(): TEl | null {
    return this.parent;
  }
}

/** Whether `el` matches one simple selector: `tag`, `#id`, `.class`, `[attr]`, `[attr=value]` (value in either kind of quote). */
function matchesOne(el: TEl, simple: string): boolean {
  const attr = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]$/.exec(simple);
  if (attr) {
    const value = attr[2] ?? attr[3];
    return value === undefined ? attr[1] in el.attrs : el.attrs[attr[1]] === value;
  }
  if (simple.startsWith("#")) return el.id === simple.slice(1);
  if (simple.startsWith(".")) return (el.attrs.class ?? "").split(/\s+/).includes(simple.slice(1));
  return el.tag === simple;
}
const matches = (el: TEl, selector: string) => selector.split(",").some((simple) => matchesOne(el, simple.trim()));

class TEl {
  readonly nodeType = 1;
  parent: TEl | null = null;
  childNodes: TNode[] = [];
  constructor(
    public tag: string,
    public attrs: Record<string, string> = {},
  ) {}
  get nodeName(): string {
    return this.tag.toUpperCase();
  }
  get id(): string {
    return this.attrs.id ?? "";
  }
  get parentElement(): TEl | null {
    return this.parent;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  closest(selector: string): TEl | null {
    return matches(this, selector) ? this : (this.parent?.closest(selector) ?? null);
  }
  /** A box, so the paragraph's `<p>` can give one (P8-02). */
  getBoundingClientRect(): Rect {
    return { left: 120, top: 180, right: 760, bottom: 330 };
  }
  querySelector(selector: string): TEl | null {
    for (const child of this.childNodes) {
      if (child.nodeType !== 1) continue;
      if (matches(child, selector)) return child;
      const inner = child.querySelector(selector);
      if (inner) return inner;
    }
    return null;
  }
}

/** An element with its children: strings become text nodes. */
function h(tag: string, attrs: Record<string, string>, ...children: Array<string | TNode>): TEl {
  const el = new TEl(tag, attrs);
  for (const child of children) {
    const node = typeof child === "string" ? new TText(child) : child;
    node.parent = el;
    el.childNodes.push(node);
  }
  return el;
}

type Point = { node: TNode; offset: number };

const lengthOf = (node: TNode): number => (node.nodeType === 3 ? node.data.length : node.childNodes.length);
const rootOf = (node: TNode): TNode => {
  let at: TNode = node;
  while (at.parent) at = at.parent;
  return at;
};
const preorder = (root: TNode): TNode[] => (root.nodeType === 3 ? [root] : [root, ...root.childNodes.flatMap(preorder)]);
const isInclusiveAncestor = (a: TNode, b: TNode): boolean => {
  for (let at: TNode | null = b; at; at = at.parent) if (at === a) return true;
  return false;
};

/** The DOM's "position of a boundary point relative to another": -1 before, 0 equal, 1 after. */
function compare(a: Point, b: Point): number {
  if (a.node === b.node) return Math.sign(a.offset - b.offset);
  const order = preorder(rootOf(a.node));
  if (order.indexOf(a.node) > order.indexOf(b.node)) return -compare(b, a);
  if (isInclusiveAncestor(a.node, b.node)) {
    let child: TNode = b.node;
    while (child.parent !== a.node) child = child.parent as TEl;
    if ((a.node as TEl).childNodes.indexOf(child) < a.offset) return 1;
  }
  return -1;
}

const shallow = (node: TNode): TNode => (node.nodeType === 3 ? new TText(node.data) : new TEl(node.tag, node.attrs));
function deep(node: TNode): TNode {
  const copy = shallow(node);
  if (node.nodeType === 1) for (const child of node.childNodes) append(copy as TEl, deep(child));
  return copy;
}
function append(parent: TEl, child: TNode) {
  child.parent = parent;
  parent.childNodes.push(child);
}

/** `Range.cloneContents()` by the DOM spec's steps: the partially contained ancestors of each end are cloned (empty where nothing of them is in the range), what lies between whole. */
function cloneContents(start: Point, end: Point): TEl {
  const fragment = new TEl("#fragment");
  if (compare(start, end) === 0) return fragment;
  if (start.node === end.node && start.node.nodeType === 3) {
    append(fragment, new TText(start.node.data.slice(start.offset, end.offset)));
    return fragment;
  }
  let common: TNode = start.node;
  while (!isInclusiveAncestor(common, end.node)) common = common.parent as TEl;
  const children = (common as TEl).childNodes;
  const partly = (child: TNode) => isInclusiveAncestor(child, start.node) !== isInclusiveAncestor(child, end.node);
  const whole = (child: TNode) => compare({ node: child, offset: 0 }, start) > 0 && compare({ node: child, offset: lengthOf(child) }, end) < 0;
  const first = isInclusiveAncestor(start.node, end.node) ? undefined : children.find(partly);
  const last = isInclusiveAncestor(end.node, start.node) ? undefined : [...children].reverse().find(partly);
  if (first?.nodeType === 3) append(fragment, new TText(first.data.slice(start.offset)));
  else if (first) {
    const copy = shallow(first) as TEl;
    append(fragment, copy);
    for (const child of cloneContents(start, { node: first, offset: lengthOf(first) }).childNodes) append(copy, child);
  }
  for (const child of children) if (whole(child)) append(fragment, deep(child));
  if (last?.nodeType === 3) append(fragment, new TText(last.data.slice(0, end.offset)));
  else if (last) {
    const copy = shallow(last) as TEl;
    append(fragment, copy);
    for (const child of cloneContents({ node: last, offset: 0 }, end).childNodes) append(copy, child);
  }
  return fragment;
}

const textOf = (node: TNode): string => (node.nodeType === 3 ? node.data : node.childNodes.map(textOf).join(""));

const LINE: Rect[] = [{ left: 100, top: 200, right: 300, bottom: 220 }];

/** A Range as a DOM keeps it: the ends move, `cloneRange` is a copy of its own, `cloneContents` is the DOM's. */
function makeRange(start: Point, end: Point) {
  const made = {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
    cloneRange: () => makeRange({ node: made.startContainer, offset: made.startOffset }, { node: made.endContainer, offset: made.endOffset }),
    setEnd(node: TNode, offset: number) {
      made.endContainer = node;
      made.endOffset = offset;
    },
    selectNodeContents(node: TNode) {
      made.startContainer = node;
      made.startOffset = 0;
      made.endContainer = node;
      made.endOffset = lengthOf(node);
    },
    cloneContents: () => cloneContents({ node: made.startContainer, offset: made.startOffset }, { node: made.endContainer, offset: made.endOffset }),
    toString: () => textOf(made.cloneContents()),
    getClientRects: () => LINE,
    getBoundingClientRect: () => LINE[0],
  };
  return made;
}

function selecting(start: Point, end: Point, words: string): SelectionLike {
  const range = makeRange(start, end);
  return { rangeCount: 1, isCollapsed: false, toString: () => words, getRangeAt: () => range as never };
}
const at = (node: TNode, offset = 0): Point => ({ node, offset });
const firstText = (el: TEl): TText => el.childNodes.find((c): c is TText => c.nodeType === 3) as TText;

// ── A page in miniature: the body's anchored paragraphs and what the paper sets after them ──

const SAY = "Tide pools counted along the invented shore rose in the second walk.";
const NEXT = "The next paragraph carries other invented words about the plots.";
const EQUATION = "Y = a + b X + c Z (1)";

function page() {
  // A PDF's displayed equation, as `Equation` draws it: no TeX, the line as printed in a `code` (math.tsx).
  const pdfCode = h("code", { class: "block whitespace-pre-wrap font-mono text-body text-text" }, EQUATION);
  const pdfEq = h("div", { class: "group/eq relative my-6 flex" }, h("div", { class: "min-w-0 flex-1 overflow-x-auto" }, pdfCode), h("div", { class: "shrink-0" }, h("span", {}, "(1)")));
  // A paper drawn from HTML: KaTeX's markup (`output: htmlAndMathml`), MathML first.
  const mi = h("mi", {}, "Y");
  const texEq = h(
    "div",
    { class: "group/eq relative my-6 flex" },
    h(
      "div",
      { class: "min-w-0 flex-1 overflow-x-auto" },
      h("span", { class: "block" }, h("span", { class: "katex-display" }, h("span", { class: "katex" }, h("span", { class: "katex-mathml" }, h("math", {}, h("semantics", {}, h("mrow", {}, mi)))), h("span", { class: "katex-html" }, h("span", { class: "base" }, "Y"))))),
    ),
  );
  const figureButton = h("button", { class: "block h-full w-full" }, h("img", {}));
  const caption = h("figcaption", { id: paragraphAnchor(0, 5), [ANCHOR_BLOCK_ATTRIBUTE]: "caption" }, "Figure 1. Invented layout of five plots.");
  const figure = h("figure", {}, figureButton, caption);
  const rule = h("span", { class: "block h-px bg-border-strong" });

  const pBeforePdf = h("p", {}, SAY);
  const pBeforeTex = h("p", {}, SAY);
  const pBeforeFigure = h("p", {}, SAY);
  const pBeforeHeading = h("p", {}, SAY);
  const pBeforeRule = h("p", {}, SAY);
  const pNext = h("p", {}, NEXT);
  const pFormulaFirst = h("p", {}, h("span", { class: "inline-block max-w-full" }, h("span", { class: "katex" }, h("span", { class: "katex-mathml" }, "x"))), " opens with a formula, then goes on with invented words.");
  const heading = h("h3", { id: paragraphAnchor(1, 3), [ANCHOR_BLOCK_ATTRIBUTE]: "heading", class: "font-reading" }, "2 Methods");

  const hosts = {
    pdf: h("div", { id: paragraphAnchor(0, 0) }, pBeforePdf, pdfEq),
    tex: h("div", { id: paragraphAnchor(0, 1) }, pBeforeTex, texEq),
    figure: h("div", { id: paragraphAnchor(0, 2) }, pBeforeFigure, figure),
    next: h("div", { id: paragraphAnchor(0, 3) }, pNext),
    formulaFirst: h("div", { id: paragraphAnchor(0, 4) }, pFormulaFirst),
    last: h("div", { id: paragraphAnchor(1, 0) }, pBeforeRule),
  };
  const section0 = h("section", {}, h("div", {}, hosts.pdf, hosts.tex, hosts.figure, hosts.next, hosts.formulaFirst, h("div", { id: paragraphAnchor(0, 9) }, pBeforeHeading)));
  const section1 = h("section", {}, heading, h("div", {}, hosts.last));
  const body = h("div", { id: "paper-body" }, section0, section1, rule);
  h("div", {}, body);
  return { pBeforePdf, pBeforeTex, pBeforeFigure, pBeforeHeading, pBeforeRule, pNext, pFormulaFirst, pdfCode, pdfEq, mi, figureButton, caption, heading, rule, hosts, body };
}

describe("readSelection — a triple click on a paragraph that stands before a displayed equation (P11-56, ruling §1h.165 rule 1)", () => {
  it("is the paragraph, offered, when the browser ends it at offset 0 of a PDF equation's code", () => {
    const { pBeforePdf, pdfCode } = page();
    const read = readSelection(selecting(at(firstText(pBeforePdf)), at(pdfCode), `${SAY}\n\n`));

    expect(read).toMatchObject({ sectionIndex: 0, paragraphIndex: 0, paragraphId: paragraphAnchor(0, 0), source: "paper", passage: SAY, offset: 0 });
    // The passage is the paragraph's words: nothing of the equation is in it, and it is one block (a highlight is offered).
    expect(read?.passage).not.toContain("Y =");
    expect(read).not.toHaveProperty("spansBlocks");
  });

  it("…whether the end is the code element or its text, and whether the equation's text is a PDF's or KaTeX's markup", () => {
    const { pBeforePdf, pdfCode, pBeforeTex, mi } = page();
    const codeText = firstText(pdfCode);
    expect(readSelection(selecting(at(firstText(pBeforePdf)), at(codeText), `${SAY}\n\n`))).toMatchObject({ paragraphIndex: 0, passage: SAY });
    // KaTeX's markup puts MathML first: the browser ends the selection at offset 0 of the first `mi` inside `.katex-mathml`, inside `.katex-display`.
    expect(readSelection(selecting(at(firstText(pBeforeTex)), at(mi), `${SAY}\n\n`))).toMatchObject({ paragraphIndex: 1, paragraphId: paragraphAnchor(0, 1), passage: SAY });
    // …and the same at the start of its text.
    expect(readSelection(selecting(at(firstText(pBeforeTex)), at(firstText(mi)), `${SAY}\n\n`))).toMatchObject({ paragraphIndex: 1, passage: SAY });
  });

  it("is the paragraph before a figure, a heading, a caption, a rule or a paragraph — the browser's end at the start of any block (as it was)", () => {
    const w = page();
    const words = `${SAY}\n\n`;
    expect(readSelection(selecting(at(firstText(w.pBeforeFigure)), at(w.figureButton), words)), "figure").toMatchObject({ paragraphIndex: 2, passage: SAY });
    expect(readSelection(selecting(at(firstText(w.pBeforeFigure)), at(firstText(w.caption)), words)), "caption").toMatchObject({ paragraphIndex: 2, passage: SAY });
    expect(readSelection(selecting(at(firstText(w.pBeforeHeading)), at(w.heading), words)), "heading").toMatchObject({ paragraphIndex: 9, passage: SAY });
    expect(readSelection(selecting(at(firstText(w.pBeforeRule)), at(w.rule), words)), "rule").toMatchObject({ sectionIndex: 1, paragraphIndex: 0, passage: SAY });
    expect(readSelection(selecting(at(firstText(w.pNext)), at(w.pFormulaFirst), `${NEXT}\n\n`)), "paragraph").toMatchObject({ paragraphIndex: 3, passage: NEXT });
  });

  it("is the paragraph before a paragraph that opens with a drawn formula: the end is inside that paragraph's `.katex`, at offset 0", () => {
    const w = page();
    const inFormula = ((w.pFormulaFirst.childNodes[0] as TEl).childNodes[0] as TEl).childNodes[0] as TEl; // span.inline-block > span.katex > span.katex-mathml
    expect(readSelection(selecting(at(firstText(w.pNext)), at(firstText(inFormula)), `${NEXT}\n\n`))).toMatchObject({ paragraphIndex: 3, passage: NEXT });
  });

  it("keeps a note tag's text out of the passage, as before: the tag is a `<sup>` inside the paragraph", () => {
    const { hosts, pdfCode } = page();
    const tagged = h("p", {}, "Tide pools counted ", h("sup", {}, "⁠", h("button", {}, "[1]")), " along the invented shore.");
    tagged.parent = hosts.pdf;
    hosts.pdf.childNodes[0] = tagged;
    const read = readSelection(selecting(at(firstText(tagged)), at(pdfCode), "Tide pools counted ⁠[1] along the invented shore.\n\n"));

    expect(read?.passage).toBe("Tide pools counted along the invented shore.");
  });

  it("is the tail of the paragraph for a drag that starts inside it and ends at the start of the equation, with the offset it started at", () => {
    const { pBeforePdf, pdfCode } = page();
    const read = readSelection(selecting(at(firstText(pBeforePdf), 5), at(pdfCode), `${SAY.slice(5)}\n\n`));

    expect(read).toMatchObject({ paragraphIndex: 0, passage: SAY.slice(5), offset: 5 });
  });
});

describe("readSelection — nothing else changes (P11-56, ruling §1h.165 rule 2)", () => {
  it("is still null for a drag that really runs into the next paragraph and ends at the start of the equation (its words carry a break inside)", () => {
    const w = page();
    // from the first paragraph through the second one to the start of THAT paragraph's equation, and to the start of the paragraph after it
    expect(readSelection(selecting(at(firstText(w.pBeforePdf)), at(w.mi), `${SAY}\n\n${SAY}\n\n`))).toBeNull();
    expect(readSelection(selecting(at(firstText(w.pBeforePdf)), at(w.pNext), `${SAY}\n\n${SAY}\n\n`))).toBeNull();
  });

  it("is still null for a drag that ends INSIDE the equation, and for one made inside it: that text is a formula's, not the paper's words", () => {
    const { pBeforePdf, pdfCode } = page();
    const codeText = firstText(pdfCode);
    expect(readSelection(selecting(at(firstText(pBeforePdf)), at(codeText, 4), `${SAY}\n\nY = `))).toBeNull();
    expect(readSelection(selecting(at(firstText(pBeforePdf)), at(codeText, 4), `${SAY}Y = `))).toBeNull();
    expect(readSelection(selecting(at(codeText, 0), at(codeText, 5), "Y = a"))).toBeNull();
    expect(readSelection(selecting(at(codeText, 0), at(codeText, EQUATION.length), EQUATION))).toBeNull();
  });

  it("is still null for a paragraph with a drawn formula of its own in it, though the browser ends the selection at the start of the equation", () => {
    const { hosts, pdfCode } = page();
    const mixed = h("p", {}, "Tide pools counted along the ", h("span", { class: "katex" }, h("span", { class: "katex-mathml" }, "x")), " shore.");
    mixed.parent = hosts.pdf;
    hosts.pdf.childNodes[0] = mixed;
    expect(readSelection(selecting(at(firstText(mixed)), at(pdfCode), "Tide pools counted along the x shore.\n\n"))).toBeNull();
  });

  it("does not stretch a selection that ends at the start of a text inside its own paragraph to the paragraph's end: a formula after it stays out of it", () => {
    const { hosts } = page();
    const tail = new TText(" shore, then a drawn formula: ");
    const formula = h("span", { class: "katex" }, h("span", { class: "katex-mathml" }, "x"));
    const own = h("p", {}, "Tide pools counted along the invented", tail, formula);
    own.parent = hosts.pdf;
    hosts.pdf.childNodes[0] = own;
    // both ends are in the one paragraph: the end at offset 0 of its second text is no "start of the next block"
    expect(readSelection(selecting(at(firstText(own)), at(tail, 0), "Tide pools counted along the invented"))).toMatchObject({ paragraphIndex: 0, passage: "Tide pools counted along the invented" });
  });

  it("is still null across a paragraph and the figure's caption when the words run into the caption", () => {
    const { pBeforeFigure, caption } = page();
    expect(readSelection(selecting(at(firstText(pBeforeFigure)), at(firstText(caption), 6), `${SAY}\n\nFigure`))).toBeNull();
  });
});
