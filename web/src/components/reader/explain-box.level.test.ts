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
/** A paragraph of a block (P11-39, step 2): a block-level element of its own with its words and the box it fills — a point inside the box hits it (or, with `inner`, an inline element inside it). */
interface Para {
  block: string;
  words: Words[];
  box: { top: number; bottom: number };
  display?: string;
  inner?: boolean | "contents";
}
interface Fake {
  id: string;
  block: string;
  display: string;
  parentElement: Fake | null;
  isConnected: boolean;
  contains: (other: Fake) => boolean;
}
let page: Record<string, Words[]>;
let paras: Record<string, Para>;
let fakes: Map<string, Fake>;
let asked: string[];
let nodesRead: number;
let hits: number;
function stubPage() {
  page = {};
  paras = {};
  fakes = new Map();
  asked = [];
  nodesRead = 0;
  hits = 0;
  const fakeOf = (id: string, block: string, display: string, parent: Fake | null): Fake => {
    const made: Fake = {
      id,
      block,
      display,
      parentElement: parent,
      isConnected: true,
      contains: (other) => {
        for (let at: Fake | null = other; at; at = at.parentElement) if (at === made) return true;
        return false;
      },
    };
    fakes.set(id, made);
    return made;
  };
  const rootFake = (id: string) => fakes.get(id) ?? fakeOf(id, id, "block", null);
  const paraFake = (id: string) => fakes.get(id) ?? fakeOf(id, paras[id].block, paras[id].display ?? "block", rootFake(paras[id].block));
  const textNode = (words: Words) => ({
    nodeType: 3,
    data: words.data,
    words,
    parentElement: { closest: (selector: string) => (words.inAriaHidden && selector.includes("aria-hidden") ? {} : null) },
  });
  vi.stubGlobal("getComputedStyle", (element: Fake) => ({ display: element.display }));
  vi.stubGlobal("document", {
    getElementById: (id: string) => {
      asked.push(id);
      return page[id] ? rootFake(id) : null;
    },
    elementFromPoint: (_x: number, y: number) => {
      hits += 1;
      const id = Object.keys(paras).find((key) => paras[key].box.top <= y && y < paras[key].box.bottom);
      if (id === undefined) return null;
      if (!paras[id].inner) return paraFake(id);
      // An inline element inside the paragraph, with a `display: contents` wrapper between them when `inner` says so.
      const wrapper = paras[id].inner === "contents" ? (fakes.get(`${id}/wrap`) ?? fakeOf(`${id}/wrap`, paras[id].block, "contents", paraFake(id))) : paraFake(id);
      return fakes.get(`${id}/inner`) ?? fakeOf(`${id}/inner`, paras[id].block, "inline", wrapper);
    },
    createTreeWalker: (root: Fake) => {
      const own = root.id in page ? page[root.id] : [];
      const inside = root.id in page ? Object.keys(paras).filter((key) => paras[key].block === root.id).flatMap((key) => paras[key].words) : (paras[root.id]?.words ?? []);
      const nodes = [...own, ...inside].map(textNode);
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
}
beforeEach(stubPage);
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

describe("levelTopOf — the paragraph that holds the selection's start (P11-39 step 2; the owner's \"被选中的文字段落\")", () => {
  /** The answers' block with three answers and their evidence quotes: the disclosure line, then paragraphs. */
  const answersPage = () => {
    page["answers-block"] = [{ data: "Answers generated by AI based on this paper", top: 176.8 }];
    paras.a1 = { block: "answers-block", words: [{ data: "The index was higher under thicker layers", top: 289 }], box: { top: 284, bottom: 330 } };
    paras.a1q = { block: "answers-block", words: [{ data: "Grazers shape the algal film", top: 342 }], box: { top: 342, bottom: 364 } };
    paras.a2 = { block: "answers-block", words: [{ data: "Probes logged the soil water", top: 385 }], box: { top: 380, bottom: 408 } };
  };
  const answer = (top: number): ExplainSelection => selection({ source: "answer", paragraphId: "answers-block", bounds: { left: 100, top, right: 420, bottom: top + 20 } });
  const levelOf = (at: ExplainSelection) => levelTopOf(at, { rect: at.rect, bounds: at.bounds });

  it("is the first line of the paragraph at the selection's first line: the first answer, a later answer, the evidence quote, a later line of an answer", () => {
    answersPage();
    expect(levelOf(answer(291))).toBe(289);
    expect(levelOf(answer(382))).toBe(385);
    expect(levelOf(answer(344))).toBe(342);
    expect(levelOf(answer(312))).toBe(289);
  });

  it("is the paragraph a selection STARTS in: its first line is the point read, whatever the selection's other lines hold", () => {
    answersPage();
    const across = selection({ source: "answer", paragraphId: "answers-block", bounds: { left: 100, top: 383, right: 420, bottom: 520 } });
    expect(levelOf(across)).toBe(385);
  });

  it("reads the point once for a selection and keeps its paragraph: the page moving another paragraph under the point does not change it; a new selection reads again", () => {
    answersPage();
    const at = answer(382);
    expect(levelOf(at)).toBe(385);
    expect(hits).toBe(1);
    // The page moves up by 60: a2's line is at 325, and the paragraph under the old point is another one.
    for (const key of Object.keys(paras)) {
      paras[key].box = { top: paras[key].box.top - 60, bottom: paras[key].box.bottom - 60 };
      for (const words of paras[key].words) words.top = (words.top as number) - 60;
    }
    expect(levelOf(at)).toBe(325);
    expect(hits).toBe(1);
    // Another selection (another object) at the same point reads the page as it is now: the paragraph under it is the evidence quote, which has moved to 354 - 60.
    expect(levelOf(answer(382))).not.toBe(325);
    expect(hits).toBe(2);
  });

  it("walks up to the nearest block-level element: past an inline element; a list item and a block span are paragraphs", () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 520 }];
    paras.line = { block: "summary-proposal", display: "block", words: [{ data: "It lays seaweed", top: 555 }], box: { top: 550, bottom: 576 }, inner: true };
    paras.item = { block: "summary-proposal", display: "list-item", words: [{ data: "Probes log", top: 600 }], box: { top: 595, bottom: 620 } };
    const at = (top: number) => selection({ source: "summary", paragraphId: "summary-proposal", bounds: { left: 100, top, right: 420, bottom: top + 20 } });
    expect(levelOf(at(557))).toBe(555);
    expect(levelOf(at(602))).toBe(600);
  });

  it("a `display: contents` wrapper between an inline element and its paragraph is no line of its own", () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 520 }];
    paras.line = { block: "summary-proposal", display: "block", words: [{ data: "It lays seaweed", top: 555 }], box: { top: 550, bottom: 576 }, inner: "contents" };
    const at = selection({ source: "summary", paragraphId: "summary-proposal", bounds: { left: 100, top: 557, right: 420, bottom: 577 } });
    expect(levelOf(at)).toBe(555);
    expect(fakes.get("line/wrap")?.display).toBe("contents");
  });

  it("is the block's first line where no paragraph of the block is found: nothing at the point, a paragraph of another block there, the block itself, a paragraph that has left the page", () => {
    answersPage();
    expect(levelOf(answer(368))).toBe(176.8);
    page["summary-method"] = [{ data: "How it was done", top: 700 }];
    paras.other = { block: "summary-method", words: [{ data: "Probes", top: 701 }], box: { top: 700, bottom: 730 } };
    expect(levelOf(answer(702))).toBe(176.8);
    const kept = answer(382);
    expect(levelOf(kept)).toBe(385);
    (fakes.get("a2") as Fake).isConnected = false;
    expect(levelOf(kept)).toBe(176.8);
  });

  it("is the block's first line where the page cannot hit-test or read a style, and for a paragraph that draws no word", () => {
    answersPage();
    vi.stubGlobal("getComputedStyle", undefined);
    expect(levelOf(answer(382))).toBe(176.8);
    vi.stubGlobal("getComputedStyle", (element: Fake) => ({ display: element.display }));
    paras.a2.words = [{ data: "Probes logged the soil water", top: null }];
    expect(levelOf(answer(382))).toBe(176.8);
  });

  it("is not read for a body paragraph's selection: nothing is asked of the page", () => {
    answersPage();
    const body = selection({ sectionIndex: 0, paragraphIndex: 0, bounds: { left: 100, top: 382, right: 420, bottom: 402 } });
    expect(levelTopOf(body, { rect: body.rect, bounds: body.bounds, paragraph: box(300) })).toBe(300);
    expect(hits).toBe(0);
    expect(asked).toEqual([]);
  });
});
