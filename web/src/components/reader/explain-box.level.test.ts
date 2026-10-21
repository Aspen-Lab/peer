import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-39 (ruling §1h.138 (b); B3 as amended, §1h.128): where the Explain card's top is level with. A body paragraph's selection is level with the paragraph's
// first line (`where.paragraph`, as P9-03b made it); a selection in a Summary block or in an answer has no paragraph of the paper, and is level with the first
// line of the page block it is in — found from the selection's own anchor (`paragraphId`: `summary-…` or `answers-block`, `anchor-blocks.ts`'s `isPageBlockId`)
// and read from the page: the first text of the block that draws (white space and a node that draws nothing passed over; words inside an `aria-hidden` element are drawn
// words — a scrambling line, the answers' caret — and count). Where no such line can be read there
// is nothing to be level with but the selection's own first line (`undefined`: `placePanel`'s and the box's own fallback). The page here is a miniature: an
// element by id, a walk over its text nodes, a range's rects (the Node tests have no DOM). Every text is invented.
import { levelTopOf, pageBlockLineTop } from "./explain-box";
import type { ExplainSelection } from "./paper-body";

/** One text node of a block: its words, where its line stands (`top`; null: it draws nothing), and whether it stands inside an `aria-hidden` element (a scrambling line's words do: `ScrambleText`). */
interface Words {
  data: string;
  top: number | null;
  inAriaHidden?: boolean;
}
let page: Record<string, Words[]>;
let asked: string[];
let nodesRead: number;
beforeEach(() => {
  page = {};
  asked = [];
  nodesRead = 0;
  const textNode = (words: Words) => ({
    nodeType: 3,
    data: words.data,
    words,
    parentElement: { closest: (selector: string) => (words.inAriaHidden && selector.includes("aria-hidden") ? {} : null) },
  });
  vi.stubGlobal("document", {
    getElementById: (id: string) => {
      asked.push(id);
      return page[id] ? { id } : null;
    },
    createTreeWalker: (root: { id: string }) => {
      const nodes = (page[root.id] ?? []).map(textNode);
      let at = 0;
      return {
        nextNode: () => {
          nodesRead += 1;
          return nodes[at++] ?? null;
        },
      };
    },
    createRange: () => {
      let current: Words | undefined;
      return {
        selectNodeContents: (node: { words: Words }) => {
          current = node.words;
        },
        getClientRects: () => (current && current.top !== null ? [{ left: 120, right: 700, top: current.top, bottom: current.top + 20 }] : []),
      };
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const selection = (over: Partial<ExplainSelection>): ExplainSelection => ({
  sectionIndex: -1,
  paragraphIndex: -1,
  passage: "Peer's reading of the alloy's rafting.",
  rect: { left: 300, top: 640, right: 420, bottom: 660 },
  bounds: { left: 100, top: 620, right: 420, bottom: 660 },
  ...over,
});
const box = (top: number) => ({ left: 120, top, right: 760, bottom: top + 260 });

describe("levelTopOf — a body paragraph's selection is level with the paragraph (rule 2: as it was)", () => {
  it("is the top of the paragraph's box, for a selection with no source and for the paper's own", () => {
    for (const source of [undefined, "paper"] as const) {
      const body = selection({ sectionIndex: 0, paragraphIndex: 1, ...(source ? { source } : {}) });
      expect(levelTopOf(body, { rect: body.rect, bounds: body.bounds, paragraph: box(300) }), String(source)).toBe(300);
    }
  });

  it("is undefined where the body reported no paragraph (the selection's own first line stands in), and reads no block of the page", () => {
    const body = selection({ sectionIndex: 0, paragraphIndex: 1 });
    page["summary-proposal"] = [{ data: "What it proposes", top: 100 }];
    expect(levelTopOf(body, { rect: body.rect, bounds: body.bounds })).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("is a caption's or a heading's own block for a selection there (their element's box is reported as the paragraph's), not a Summary's", () => {
    for (const block of ["caption", "heading"] as const) {
      const at = selection({ sectionIndex: 0, paragraphIndex: 2, block, paragraphId: "paper-section-0-p2" });
      expect(levelTopOf(at, { rect: at.rect, bounds: at.bounds, paragraph: box(410) }), block).toBe(410);
    }
    expect(asked).toEqual([]);
  });
});

describe("levelTopOf — a Summary block's or an answer's selection is level with the first line of its block (rule 1)", () => {
  it("is the first line of the Summary block the anchor names", () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 312.5 }, { data: "Peer's reading of the alloy's rafting.", top: 352 }];
    page["summary-method"] = [{ data: "How it was done", top: 700 }];
    const at = selection({ source: "summary", paragraphId: "summary-proposal" });
    expect(levelTopOf(at, { rect: at.rect, bounds: at.bounds })).toBe(312.5);
    expect(asked).toEqual(["summary-proposal"]);
  });

  it("is the first line of the answers' block for an answer", () => {
    page["answers-block"] = [{ data: "Answers generated by AI based on this paper", top: 176.8 }, { data: "The ratio is the share of plates.", top: 293.3 }];
    const at = selection({ source: "answer", paragraphId: "answers-block" });
    expect(levelTopOf(at, { rect: at.rect, bounds: at.bounds })).toBe(176.8);
  });

  it("does not use a paragraph box the body reported: the block's line wins for a Summary or an answer", () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 312 }];
    const at = selection({ source: "summary", paragraphId: "summary-proposal" });
    expect(levelTopOf(at, { rect: at.rect, bounds: at.bounds, paragraph: box(90) })).toBe(312);
  });

  it("is undefined for a block it cannot read: the selection's own first line stands in, never the masthead's foot", () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: null }];
    for (const [source, paragraphId] of [
      ["summary", "summary"],
      ["answer", "answers"],
      ["summary", undefined],
      ["summary", "summary-gone"],
      ["summary", "summary-proposal"],
    ] as const) {
      const at = selection({ source, paragraphId });
      expect(levelTopOf(at, { rect: at.rect, bounds: at.bounds }), `${source} ${paragraphId}`).toBeUndefined();
    }
  });
});

describe("pageBlockLineTop — the first line of a page block, read from the page", () => {
  it("is the top of the block's first words", () => {
    page["summary-results"] = [{ data: "What they found, and how big", top: 268.25 }, { data: "Soil water stayed higher.", top: 300 }];
    expect(pageBlockLineTop("summary-results")).toBe(268.25);
    page["answers-block"] = [{ data: "Answers generated by AI", top: 90 }];
    expect(pageBlockLineTop("answers-block")).toBe(90);
  });

  it("passes over white space and a node that draws nothing", () => {
    page["summary-method"] = [
      { data: "  \n  ", top: 70 },
      { data: "Closed words", top: null },
      { data: "How it was done", top: 90 },
    ];
    expect(pageBlockLineTop("summary-method")).toBe(90);
  });

  it("takes words inside an aria-hidden element for the line: a fresh report's lines are drawn so (ScrambleText), the Summary's skim line among them, and the answers' caret is part of its line", () => {
    page["summary-skim"] = [
      { data: "Deeper seaweed layers held more soil water.", top: 221.2, inAriaHidden: true },
      { data: "Grazers shape the algal film of a rock pool.", top: 254.5 },
    ];
    expect(pageBlockLineTop("summary-skim")).toBe(221.2);
    page["answers-block"] = [
      { data: "▸", top: 75, inAriaHidden: true },
      { data: "Answers generated by AI", top: 90 },
    ];
    expect(pageBlockLineTop("answers-block")).toBe(75);
  });

  it("is undefined for an id that is no page block (the bare kinds a block with no id is reported under, a paragraph's anchor, anything else), and asks the page nothing", () => {
    page["summary"] = [{ data: "words", top: 10 }];
    page["answers"] = [{ data: "words", top: 10 }];
    page["paper-section-1-p2"] = [{ data: "words", top: 10 }];
    page["summary-"] = [{ data: "words", top: 10 }];
    for (const id of ["summary", "answers", "paper-section-1-p2", "summary-", "", undefined, null, 42, {}]) expect(pageBlockLineTop(id), String(id)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("is undefined for a block that is not on the page, and for one with no words that draw", () => {
    expect(pageBlockLineTop("summary-gone")).toBeUndefined();
    page["summary-proposal"] = [{ data: "What it proposes", top: null }, { data: "   ", top: 5 }];
    expect(pageBlockLineTop("summary-proposal")).toBeUndefined();
    page["summary-method"] = [];
    expect(pageBlockLineTop("summary-method")).toBeUndefined();
  });

  it("gives up on a block that draws no word in its first sixty-four text nodes: a block hidden whole costs a bounded walk, not the whole text", () => {
    page["summary-results"] = [...Array.from({ length: 200 }, (_, i) => ({ data: `hidden ${i}`, top: null })), { data: "What they found", top: 100 }];
    expect(pageBlockLineTop("summary-results")).toBeUndefined();
    expect(nodesRead).toBeLessThanOrEqual(65);
    page["summary-method"] = [...Array.from({ length: 60 }, (_, i) => ({ data: `hidden ${i}`, top: null })), { data: "How it was done", top: 140 }];
    expect(pageBlockLineTop("summary-method")).toBe(140);
  });

  it("is undefined where there is no document (a server render), and says nothing of a page that cannot be walked", () => {
    vi.stubGlobal("document", undefined);
    expect(pageBlockLineTop("summary-proposal")).toBeUndefined();
    vi.stubGlobal("document", { getElementById: () => ({ id: "summary-proposal" }) });
    expect(pageBlockLineTop("summary-proposal")).toBeUndefined();
  });
});
