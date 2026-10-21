import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-39 (round 2, Theme B weighed (a); B3 as amended, ruling §1h.128; ruling §1h.138 (b): the owner's P9 words, the card level with "被选中的文字段落",
// §1h.49 (a)): a selection in a Summary block or in an answer opens the card LEVEL with the first line of the block it is in, as a body paragraph's card
// is level with the paragraph's first line — not at the masthead's foot (P10-08's `DOCK_TOP_PX`, 206 px above the selection at 1440 x 900 for the Summary,
// 245 px for an answer, and, for a block lower in the Summary, a card that no longer spanned the selection). The block is found from the selection's own
// anchor (`paragraphId`: `summary-…` — `paper-words.tsx`'s `SUMMARY_ID` — or `answers-block`, `anchor-blocks.ts`'s `isPageBlockId`) and its first line of
// text is read from the page, as the page's own marks are read; the card's top is that line, before the answer lands and after, held in the margin's band for
// the card's 250-px floor (P11-26) and no more. A body paragraph's card is as it was. The box runs on the minimal hook runtime (no DOM here): the page is a
// miniature — an element by id, a walk over its text nodes, a range's rects. Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { ExplainTurn } from "@/store/explain-threads";
import { ExplainBox, ExplainCard, type AskResult } from "./explain-box";
import { DOCK_STACK_FLOOR_PX, DOCK_TOP_PX, columnBottomPx } from "./explain-dock";
import type { ReplyResult } from "./explain-thread";
import type { ExplainSelection } from "./paper-body";

const FIRST_ANSWER: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const REPLY: ExplainTurn = { role: "peer", text: "A bigger share of plates changes how the metal carries load.", peer: true };
const reading = {
  body: [{ id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] }],
  map: { totalMinutes: 1, sections: [] },
} as unknown as Pick<PaperReading, "body" | "map">;

/** A Summary block's selection: no paragraph of the paper (`paragraph` is absent, as `readSelection` leaves it), the block's own id. */
const summary: ExplainSelection = {
  sectionIndex: -1,
  paragraphIndex: -1,
  passage: "Peer's reading of the alloy's rafting.",
  source: "summary",
  paragraphId: "summary-proposal",
  rect: { left: 300, top: 640, right: 420, bottom: 660 },
  bounds: { left: 100, top: 620, right: 420, bottom: 660 },
};
const answer: ExplainSelection = { ...summary, passage: "The ratio is the share of plates.", source: "answer", paragraphId: "answers-block" };
/** A body paragraph's selection: the paragraph's own box is reported (`paragraph`), its top is the paragraph's first line. */
const paragraph = (top: number): ExplainSelection => ({
  sectionIndex: 0,
  paragraphIndex: 0,
  passage: "Hot parts creep under load.",
  rect: { left: 300, top: top + 60, right: 420, bottom: top + 80 },
  bounds: { left: 100, top: top + 40, right: 420, bottom: top + 80 },
  paragraph: { left: 120, top, right: 760, bottom: top + 260 },
});
/** The same selection, measured again as the page scrolls (it stays where it is: the page moves the block, `page` below). */
const measured = (selection: ExplainSelection): ExplainSelection => ({
  ...selection,
  measure: () => ({ rect: { ...selection.rect }, bounds: { ...selection.bounds } }),
});

// ── A miniature page: blocks by id, each a list of text nodes with where its first line stands, and paragraphs inside them ───────────────

/** One text node of a block: its words, where its line stands (`top`; null: it draws nothing — the block is hidden), and whether it stands inside an `aria-hidden` element (a scrambling line's words do: `ScrambleText`). */
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
  inner?: boolean;
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
let looked: string[];
let hits: number;
function stubPage() {
  page = {};
  paras = {};
  fakes = new Map();
  looked = [];
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
    ...recorder(),
    documentElement: { style: { setProperty: vi.fn(), removeProperty: vi.fn() } },
    getElementById: (id: string) => {
      looked.push(id);
      return page[id] ? rootFake(id) : null;
    },
    elementFromPoint: (_x: number, y: number) => {
      hits += 1;
      const id = Object.keys(paras).find((key) => paras[key].box.top <= y && y < paras[key].box.bottom);
      if (id === undefined) return null;
      return paras[id].inner ? (fakes.get(`${id}/inner`) ?? fakeOf(`${id}/inner`, paras[id].block, "inline", paraFake(id))) : paraFake(id);
    },
    createTreeWalker: (root: Fake) => {
      const own = root.id in page ? page[root.id] : [];
      const inside = root.id in page ? Object.keys(paras).filter((key) => paras[key].block === root.id).flatMap((key) => paras[key].words) : (paras[root.id]?.words ?? []);
      const nodes = [...own, ...inside].map(textNode);
      let at = 0;
      return { nextNode: () => nodes[at++] ?? null };
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

let listeners: Map<string, Set<(event: unknown) => void>>;
const fire = (type: string, event: unknown) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
function recorder() {
  return {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
}
function stubWindow(width: number, height: number) {
  vi.stubGlobal("window", { ...recorder(), innerWidth: width, innerHeight: height, scrollBy: vi.fn(), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: (id: number) => clearTimeout(id) });
}

let openRef: { current: (() => void) | null };
beforeEach(() => {
  listeners = new Map();
  openRef = { current: null };
  stubWindow(1440, 900);
  stubPage();
});
afterEach(() => vi.unstubAllGlobals());

// ── The box, as the entry tests drive it ──────────────────────────────────────────────────────────────────────

type Props = Parameters<typeof ExplainBox>[0];
type Props2 = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props2>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props2>;
  return [element, ...elements(element.props.children)];
}

interface Look {
  status: string | null;
  top: number | undefined;
  card: boolean;
}
const look = (tree: ReactNode): Look => {
  const card = elements(tree).find((el) => el.type === ExplainCard);
  const status = card?.props.status as { kind: string } | undefined;
  return { status: status?.kind ?? null, top: (card?.props.style as { top?: number } | undefined)?.top, card: card !== undefined };
};

type Step = (tree: ReactNode, ctx: { props: Props; rerender: () => void }) => void;
async function scenario(initial: Props, steps: Step[]) {
  const ctx = { props: initial, rerender: () => {}, tree: null as ReactNode };
  const looks: Look[] = [];
  const mounted = await hookRuntime.mount(() => {
    const tree = ExplainBox(ctx.props);
    const [step, setStep] = useState(0);
    const [, setTick] = useState(0);
    ctx.rerender = () => setTick((n) => n + 1);
    looks.push(look(tree));
    ctx.tree = tree;
    useEffect(() => {
      const run = steps[step];
      if (!run) return;
      run(ctx.tree, ctx);
      setStep(step + 1);
    }, [step]);
    return tree;
  });
  return { looks, mounted, last: () => looks[looks.length - 1], tops: () => looks.filter((l) => l.card).map((l) => l.top) };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
const open = () => openRef.current?.();
const selectNext =
  (next: ExplainSelection | null): Step =>
  (_tree, ctx) => {
    ctx.props = { ...ctx.props, target: next };
    ctx.rerender();
  };

/** A reader with a key, a paper with a body, no selection yet. */
const base = (over: Partial<Props> = {}): Props => ({
  target: null,
  terms: [],
  canAsk: true,
  onAsk: vi.fn(async (): Promise<AskResult> => FIRST_ANSWER),
  cached: FIRST_ANSWER,
  cachedTurns: [],
  onReply: vi.fn(async (): Promise<ReplyResult> => REPLY),
  onResetThread: vi.fn(),
  reading,
  openRef,
  ...over,
});

/** The band's foot at 1440 x 900: 860, the legend's top less its margin. */
const FOOT = columnBottomPx(900, 28);
/** The lowest a card stands: its 250-px floor above the band's foot (P11-26, `placeInMargin`). */
const LOWEST = FOOT - DOCK_STACK_FLOOR_PX;

describe("ExplainBox — a Summary block's card stands level with the first line of its block (P11-39, ruling §1h.138 (b))", () => {
  it("opens level with the block's first line, not at the masthead's foot: the Summary's block at 300 with the selection at 640", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 300 }, { data: "Peer's reading of the alloy's rafting.", top: 340 }];
    const run = await scenario(base({ target: summary }), [() => open()]);
    await wait();

    expect(run.last().card).toBe(true);
    expect(run.last().top).toBe(300);
    expect(looked).toContain("summary-proposal");
    run.mounted.unmount();
  });

  it("is level before the answer lands and after it: the same top for the loading card and the answered one", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 300 }, { data: "Peer's reading of the alloy's rafting.", top: 340 }];
    let land: (result: AskResult) => void = () => {};
    const onAsk = vi.fn(() => new Promise<AskResult>((resolve) => (land = resolve)));
    const run = await scenario(base({ target: summary, cached: undefined, onAsk }), [() => open(), () => land(FIRST_ANSWER)]);
    await wait();

    const cards = run.looks.filter((l) => l.card);
    expect(cards.map((l) => l.status)).toContain("loading");
    expect(cards.map((l) => l.status)).toContain("answer");
    expect(cards.map((l) => l.top)).toEqual(cards.map(() => 300));
    run.mounted.unmount();
  });

  it("a block lower in the Summary: the card stands level with that block (520), where it stood at the masthead's foot and spanned 48 to 403", async () => {
    page["summary-method"] = [{ data: "How it was done", top: 520 }, { data: "Probes logged the water.", top: 560 }];
    const lower: ExplainSelection = { ...summary, paragraphId: "summary-method", bounds: { left: 100, top: 560, right: 420, bottom: 600 }, rect: { left: 300, top: 580, right: 420, bottom: 600 } };
    const run = await scenario(base({ target: lower }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(520);
    run.mounted.unmount();
  });

  it("is the first line of the block that holds the selection: another block of the page does not matter", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 300 }];
    page["summary-method"] = [{ data: "How it was done", top: 500 }];
    page["summary-results"] = [{ data: "What they found", top: 200 }];
    const run = await scenario(base({ target: { ...summary, paragraphId: "summary-method" } }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(500);
    run.mounted.unmount();
  });

  it("where the room under the block's line is less than the card's 250-px floor the top rises just enough, and no more", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 780 }];
    const run = await scenario(base({ target: summary }), [() => open()]);
    await wait();

    expect(LOWEST).toBe(610);
    expect(run.last().top).toBe(LOWEST);
    run.mounted.unmount();
  });

  it("a block whose first line is above the masthead (scrolled up under it) holds the card at the masthead's foot", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: -120 }];
    const run = await scenario(base({ target: summary }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(DOCK_TOP_PX);
    run.mounted.unmount();
  });

  it("reads the first line of the block's words: a node of white space and a node that draws nothing are passed over, and words inside an aria-hidden element (a scrambling line) are the line", async () => {
    page["summary-proposal"] = [
      { data: "  \n ", top: 295 },
      { data: "Hidden words", top: null },
      { data: "Deeper seaweed layers held more soil water.", top: 312, inAriaHidden: true },
      { data: "Peer's reading of the alloy's rafting.", top: 340 },
    ];
    const run = await scenario(base({ target: summary }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(312);
    run.mounted.unmount();
  });

  it("follows its block as the page scrolls: the card's top is read again with the selection, and held between the masthead's foot and the floor", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 400 }];
    const tops: Array<number | undefined> = [];
    const scrollTo = (top: number): Step => () => {
      (page["summary-proposal"] as Words[])[0].top = top;
      fire("scroll", {});
    };
    const record: Step = (tree) => tops.push(look(tree).top);
    const run = await scenario(base({ target: measured(summary) }), [() => open(), record, scrollTo(300), record, scrollTo(-250), record, scrollTo(5000), record, scrollTo(480), record]);
    await wait();

    expect(tops).toEqual([400, 300, DOCK_TOP_PX, LOWEST, 480]);
    run.mounted.unmount();
  });

  it("with no block element to measure — a selection reported under the bare kind, or a block that is not on the page — the card is level with the selection's own first line", async () => {
    for (const paragraphId of ["summary", "answers", undefined, "summary-gone"] as Array<string | undefined>) {
      const run = await scenario(base({ target: { ...summary, paragraphId } }), [() => open()]);
      await wait();

      // bounds.top 620 is lower than the floor's 610 allows: the top rises to it.
      expect(run.last().top, String(paragraphId)).toBe(LOWEST);
      run.mounted.unmount();
    }
    const high: ExplainSelection = { ...summary, paragraphId: "summary", bounds: { ...summary.bounds, top: 400, bottom: 440 } };
    const run = await scenario(base({ target: high }), [() => open()]);
    await wait();
    expect(run.last().top).toBe(400);
    run.mounted.unmount();
  });

  it("a block with no words on the screen (every text node draws nothing) is the same: the selection's own first line", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: null }, { data: "Peer's reading.", top: null }];
    const high: ExplainSelection = { ...summary, bounds: { ...summary.bounds, top: 400, bottom: 440 } };
    const run = await scenario(base({ target: high }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(400);
    run.mounted.unmount();
  });

  it("while a card stands for a body paragraph, a selection in a Summary block takes it to that block's first line, and one in the body takes it back to the paragraph's", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 300 }];
    const tops: Array<number | undefined> = [];
    const run = await scenario(base({ target: paragraph(400) }), [
      () => open(),
      (tree) => tops.push(look(tree).top),
      selectNext(summary),
      (tree) => tops.push(look(tree).top),
      selectNext(paragraph(350)),
    ]);
    await wait();
    tops.push(run.last().top);

    expect(tops).toEqual([400, 300, 350]);
    run.mounted.unmount();
  });
});

describe("ExplainBox — an answer's card stands level with the first line of the answers' block (P11-39, ruling §1h.138 (b))", () => {
  it("opens level with the block's first line (the answers' block), before the answer lands and after", async () => {
    page["answers-block"] = [{ data: "▸", top: 196, inAriaHidden: true }, { data: "Answers generated by AI based on this paper", top: 200 }, { data: "The ratio is the share of plates.", top: 293 }];
    let land: (result: AskResult) => void = () => {};
    const onAsk = vi.fn(() => new Promise<AskResult>((resolve) => (land = resolve)));
    const run = await scenario(base({ target: answer, cached: undefined, onAsk }), [() => open(), () => land(FIRST_ANSWER)]);
    await wait();

    const cards = run.looks.filter((l) => l.card);
    expect(cards.map((l) => l.status)).toContain("loading");
    expect(cards.map((l) => l.status)).toContain("answer");
    expect(cards.map((l) => l.top)).toEqual(cards.map(() => 196));
    expect(looked).toContain("answers-block");
    run.mounted.unmount();
  });

  it("holds the floor and the masthead's foot as a Summary block's does", async () => {
    page["answers-block"] = [{ data: "Answers generated by AI based on this paper", top: 800 }];
    const low = await scenario(base({ target: answer }), [() => open()]);
    await wait();
    expect(low.last().top).toBe(LOWEST);
    low.mounted.unmount();

    page["answers-block"] = [{ data: "Answers generated by AI based on this paper", top: -40 }];
    const high = await scenario(base({ target: answer }), [() => open()]);
    await wait();
    expect(high.last().top).toBe(DOCK_TOP_PX);
    high.mounted.unmount();
  });
});

describe("ExplainBox — a body paragraph's card is as it was (P11-39, rule 2)", () => {
  it("stands level with the paragraph's first line, and reads no block of the page for it", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 100 }];
    page["answers-block"] = [{ data: "Answers generated by AI", top: 120 }];
    for (const top of [230, 330, 450]) {
      const run = await scenario(base({ target: paragraph(top) }), [() => open()]);
      await wait();

      expect(run.last().top, String(top)).toBe(top);
      run.mounted.unmount();
    }
    expect(looked).toEqual([]);
  });

  it("is the same with the source named `paper`, before the answer lands and after, and under the floor it rises as before", async () => {
    let land: (result: AskResult) => void = () => {};
    const onAsk = vi.fn(() => new Promise<AskResult>((resolve) => (land = resolve)));
    const run = await scenario(base({ target: { ...paragraph(330), source: "paper" }, cached: undefined, onAsk }), [() => open(), () => land(FIRST_ANSWER)]);
    await wait();
    const cards = run.looks.filter((l) => l.card);
    expect(cards.map((l) => l.status)).toContain("loading");
    expect(cards.map((l) => l.status)).toContain("answer");
    expect(cards.map((l) => l.top)).toEqual(cards.map(() => 330));
    run.mounted.unmount();

    const low = await scenario(base({ target: paragraph(800) }), [() => open()]);
    await wait();
    expect(low.last().top).toBe(LOWEST);
    low.mounted.unmount();
    expect(looked).toEqual([]);
  });
});

// ── Step 2 (the manager's, after round 2's walk): the card is level with the PARAGRAPH that holds the selection's start ─────────────────
//
// `answers-block` is one section holding every answer, so "the first line of the block" stood 112 to 117 px above a selection in the first answer and further above
// one in a later answer: not "the selected paragraph's first line" (§1h.49 (a)). A selection in the answers or in a Summary block now finds the paragraph it starts in — the
// block-level element at its first line (`document.elementFromPoint`, read once and kept for that selection), the unit the highlights' text model calls a line of its own —
// and the card is level with that paragraph's first drawn line, held for the floor as before. Where no paragraph can be found, the block's first line, as before.

/** The answers' block as the page draws it with three answers (one long enough to wrap) and a "Read next" line: the disclosure line, then paragraphs. */
function answersPage() {
  page["answers-block"] = [{ data: "Answers generated by AI based on this paper", top: 176.8 }];
  paras.q = { block: "answers-block", words: [{ data: "I want to learn the parameter", top: 218 }], box: { top: 218, bottom: 244 } };
  paras.a1 = { block: "answers-block", words: [{ data: "The index was higher under thicker layers", top: 289 }], box: { top: 284, bottom: 330 } };
  paras.a1q = { block: "answers-block", words: [{ data: "Grazers shape the algal film", top: 342 }], box: { top: 342, bottom: 364 } };
  paras.a2 = { block: "answers-block", words: [{ data: "Probes logged the soil water", top: 385 }], box: { top: 380, bottom: 408 } };
  paras.a2q = { block: "answers-block", words: [{ data: "Pools with more shade held fewer grazers", top: 414 }], box: { top: 414, bottom: 459 } };
  paras.a3 = { block: "answers-block", words: [{ data: "One orchard was tested", top: 480 }], box: { top: 475, bottom: 503 } };
}
/** A selection in the answers whose first line stands at `top` (it ends `height` lower). */
const inAnswers = (top: number, height = 20): ExplainSelection => ({
  ...answer,
  rect: { left: 300, top: top + height - 20, right: 420, bottom: top + height },
  bounds: { left: 100, top, right: 420, bottom: top + height },
});

describe("ExplainBox — an answer's card stands level with its own answer (P11-39 step 2; ruling §1h.138 (b), the owner's \"被选中的文字段落\")", () => {
  it("is level with the first answer's paragraph, not the answers' first line: the selection at 291, the paragraph's first line at 289, the section's at 176.8", async () => {
    answersPage();
    const run = await scenario(base({ target: inAnswers(291) }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(289);
    run.mounted.unmount();
  });

  it("is level with a later answer's paragraph, whichever it is: the second (385) and the third (480), and the evidence quote and the question's own paragraph when it starts there", async () => {
    answersPage();
    for (const [at, line] of [[382, 385], [477, 480], [344, 342], [414, 414], [220, 218]] as const) {
      const run = await scenario(base({ target: inAnswers(at) }), [() => open()]);
      await wait();

      expect(run.last().top, `selection at ${at}`).toBe(line);
      run.mounted.unmount();
    }
  });

  it("is level with the paragraph's first line for a selection on a later line of it: the selection at 312 is on the second line of the paragraph that begins at 289", async () => {
    answersPage();
    const run = await scenario(base({ target: inAnswers(312) }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(289);
    run.mounted.unmount();
  });

  it("is level with the paragraph that holds the selection's START, whatever it runs on into: from the second answer down into the third", async () => {
    answersPage();
    const run = await scenario(base({ target: inAnswers(383, 120) }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(385);
    run.mounted.unmount();
  });

  it("is the same before the answer lands and after it", async () => {
    answersPage();
    let land: (result: AskResult) => void = () => {};
    const onAsk = vi.fn(() => new Promise<AskResult>((resolve) => (land = resolve)));
    const run = await scenario(base({ target: inAnswers(382), cached: undefined, onAsk }), [() => open(), () => land(FIRST_ANSWER)]);
    await wait();

    const cards = run.looks.filter((l) => l.card);
    expect(cards.map((l) => l.status)).toContain("loading");
    expect(cards.map((l) => l.status)).toContain("answer");
    expect(cards.map((l) => l.top)).toEqual(cards.map(() => 385));
    run.mounted.unmount();
  });

  it("walks up from an inline element to the paragraph it is in, and reads the point of the selection's first line only once for a selection (the paragraph is kept for it)", async () => {
    answersPage();
    paras.a2.inner = true;
    const run = await scenario(base({ target: inAnswers(382) }), [() => open()]);
    await wait();

    expect(run.last().top).toBe(385);
    expect(hits).toBe(1);
    run.mounted.unmount();
  });

  it("follows its paragraph as the page scrolls, and keeps to it when another paragraph comes under the point where the selection began", async () => {
    answersPage();
    const tops: Array<number | undefined> = [];
    const scrollBy = (shift: number): Step => () => {
      // The page moves up by `shift`: every word and every box; the selection's own rects are the box's own reading (below), so another paragraph now stands at its old place.
      for (const key of Object.keys(paras)) {
        paras[key].box = { top: paras[key].box.top - shift, bottom: paras[key].box.bottom - shift };
        for (const words of paras[key].words) words.top = (words.top as number) - shift;
      }
      fire("scroll", {});
    };
    const record: Step = (tree) => tops.push(look(tree).top);
    const run = await scenario(base({ target: measured(inAnswers(382)) }), [() => open(), record, scrollBy(60), record, scrollBy(200), record, scrollBy(-400), record]);
    await wait();

    // a2's first line: 385, then 325, then 125, then 525.
    expect(tops).toEqual([385, 325, 125, 525]);
    run.mounted.unmount();
  });

  it("holds the floor and the masthead's foot as a body paragraph's card does: a paragraph low in the window, one above the masthead", async () => {
    answersPage();
    paras.a3.words[0].top = 800;
    paras.a3.box = { top: 795, bottom: 820 };
    const low = await scenario(base({ target: inAnswers(797) }), [() => open()]);
    await wait();
    expect(low.last().top).toBe(LOWEST);
    low.mounted.unmount();

    paras.a3.words[0].top = -60;
    paras.a3.box = { top: -65, bottom: -40 };
    const high = await scenario(base({ target: inAnswers(-62) }), [() => open()]);
    await wait();
    expect(high.last().top).toBe(DOCK_TOP_PX);
    high.mounted.unmount();
  });

  it("falls back on the block's first line where no paragraph of the block is found: nothing at the point, a paragraph of another block there, a paragraph kept that has left the page", async () => {
    answersPage();
    // Nothing at 370 (between two paragraphs).
    const gap = await scenario(base({ target: inAnswers(366, 8) }), [() => open()]);
    await wait();
    expect(gap.last().top).toBe(176.8);
    gap.mounted.unmount();

    // A paragraph of another block there.
    page["summary-method"] = [{ data: "How it was done", top: 700 }];
    paras.other = { block: "summary-method", words: [{ data: "Probes", top: 701 }], box: { top: 700, bottom: 730 } };
    const other = await scenario(base({ target: inAnswers(702) }), [() => open()]);
    await wait();
    expect(other.last().top).toBe(176.8);
    other.mounted.unmount();

    // The paragraph kept for the selection leaves the page (the block was drawn again): the block's first line, not a stale paragraph.
    const target = measured(inAnswers(382));
    const left = await scenario(base({ target }), [
      () => open(),
      () => {
        (fakes.get("a2") as Fake).isConnected = false;
        fire("scroll", {});
      },
    ]);
    await wait();
    expect(left.last().top).toBe(176.8);
    left.mounted.unmount();
  });

  it("with no way to hit-test or to read a style (a page without them) it is the block's first line, as before this step", async () => {
    answersPage();
    vi.stubGlobal("document", { ...(document as unknown as Record<string, unknown>), elementFromPoint: undefined });
    const run = await scenario(base({ target: inAnswers(382) }), [() => open()]);
    await wait();
    expect(run.last().top).toBe(176.8);
    run.mounted.unmount();
  });
});

describe("ExplainBox — a Summary block that holds several paragraphs: the card is level with the paragraph that holds the selection (P11-39 step 2)", () => {
  it("stands at the paragraph the selection starts in, and not at the block's first line (its label): the label at 240, the lead at 275, a key result at 335", async () => {
    page["summary-results"] = [{ data: "What they found, and how big", top: 240 }];
    paras.lead = { block: "summary-results", words: [{ data: "Soil water stayed higher.", top: 275 }], box: { top: 270, bottom: 296 } };
    paras.result = { block: "summary-results", words: [{ data: "Water kept", top: 335 }], box: { top: 330, bottom: 360 } };
    for (const [at, line] of [[277, 275], [337, 335]] as const) {
      const run = await scenario(base({ target: { ...summary, paragraphId: "summary-results", bounds: { left: 100, top: at, right: 420, bottom: at + 20 } } }), [() => open()]);
      await wait();

      expect(run.last().top, `selection at ${at}`).toBe(line);
      run.mounted.unmount();
    }
  });

  it("is a block-level element wherever its tag: a span drawn as a block (a Summary line is one), a list item, a paragraph; an inline element inside it is walked past", async () => {
    page["summary-proposal"] = [{ data: "What it proposes", top: 520 }];
    paras.line = { block: "summary-proposal", display: "block", words: [{ data: "It lays seaweed", top: 555 }], box: { top: 550, bottom: 576 }, inner: true };
    paras.item = { block: "summary-proposal", display: "list-item", words: [{ data: "Probes log", top: 600 }], box: { top: 595, bottom: 620 } };
    for (const [at, line] of [[557, 555], [602, 600]] as const) {
      const run = await scenario(base({ target: { ...summary, bounds: { left: 100, top: at, right: 420, bottom: at + 20 } } }), [() => open()]);
      await wait();

      expect(run.last().top, `selection at ${at}`).toBe(line);
      run.mounted.unmount();
    }
  });
});
