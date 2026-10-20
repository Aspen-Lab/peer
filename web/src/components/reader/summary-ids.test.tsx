import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANSWERS_BLOCK_ID, FLASH_MS, SUMMARY_ID_PREFIX, goToPassage } from "@/components/notes/note-tags";
import { stickyAnchorId } from "@/components/notes/sticky-note";
import type { PaperReading } from "@/lib/papers/reading";
import type { Claim, PaperReport } from "@/lib/papers/report";
import { SECTION_GAP } from "@/components/ui/band";
import { ForYourQuestions } from "./for-your-questions";
import { EXPLAIN_SOURCE_ATTRIBUTE, readSelection, type SelectionLike } from "./paper-body";
import { PaperWords, SUMMARY_ID, SummaryBlock } from "./paper-words";

// P11-17b rule 3 (C P11-14's defect (c), second half; B P11-03 §4 C-2): a note taken on a Summary or an answer selection is anchored by the id the
// selection reports for its block (`block.id || container.id || kind`, `paper-body.tsx`), and the notes' blue square scrolls to the element with that
// id. The Summary's and the answers' blocks therefore carry stable, unique ids — constants, not positions: the Summary is regenerated, and an id
// built from a count would name another block next time. The ids are held to what the page renders (`PaperWords`, `ForYourQuestions`,
// `SummaryBlock`) and, through the real selection reader on a small tree, to what the selection reports. Every text is invented.

// ── What the markup holds ──────────────────────────────────────────────────

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The elements that stand directly in the markup (depth 0), with their ids — what a container's blocks are. */
function blocksOf(html: string): { tag: string; id: string | null }[] {
  const out: { tag: string; id: string | null }[] = [];
  let depth = 0;
  for (const found of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s[^<>]*?)?)(\/?)>/g)) {
    const [, closing, tag, attributes, selfClosing] = found;
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 0) out.push({ tag, id: /\sid="([^"]*)"/.exec(attributes)?.[1] ?? null });
    if (!selfClosing && !VOID.has(tag.toLowerCase())) depth += 1;
  }
  return out;
}

const SENTENCES = [
  "Seaweed layers hold water in dry soil.",
  "We tested three layer depths over two seasons.",
  "Deeper layers kept more water than shallow ones.",
  "Runoff loss fell by a third in the deepest plots.",
];
const reading = (over: Partial<PaperReading["abstract"]> = {}, tldr?: string) =>
  ({ abstract: { sentences: SENTENCES, introCount: 2, marks: [], ...over }, provenance: { tldr } }) as unknown as PaperReading;
const SKIM: Claim[] = [{ text: "Deeper layers held more water.", evidence: SENTENCES[2], evidenceWhere: "abstract" }];

const words = (props: Partial<Parameters<typeof PaperWords>[0]> & { reading: PaperReading }) =>
  renderToStaticMarkup(createElement(PaperWords, { marks: [], skim: [], basis: null, quotedSkim: [], ...props }));

describe("SummaryBlock", () => {
  it("is the block's own element, under its id, around whatever the block draws", () => {
    const html = renderToStaticMarkup(createElement(SummaryBlock, { id: "summary-x" }, createElement("section", null, "Words")));
    expect(html).toBe('<div id="summary-x"><section>Words</section></div>');
  });

  it("carries the class it is given, and none when it is given none", () => {
    expect(renderToStaticMarkup(createElement(SummaryBlock, { id: "summary-x", className: "mt-12" }, createElement("section", null, "Words")))).toBe('<div id="summary-x" class="mt-12"><section>Words</section></div>');
    expect(renderToStaticMarkup(createElement(SummaryBlock, { id: "summary-x" }, createElement("section", null, "Words")))).not.toContain("class=");
  });

  it("draws nothing around nothing: a block that is not there leaves no empty element behind", () => {
    for (const nothing of [null, undefined, false]) {
      expect(renderToStaticMarkup(createElement(SummaryBlock, { id: "summary-x" }, nothing as never))).toBe("");
    }
    expect(renderToStaticMarkup(createElement(SummaryBlock, { id: "summary-x" }))).toBe("");
  });
});

describe("the Summary's ids", () => {
  const ids = Object.values(SUMMARY_ID);

  it("are unique, begin with the prefix the notes' square knows the Summary by, and are plain words (valid as an element id, a selector and a hash)", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith(SUMMARY_ID_PREFIX), id).toBe(true);
      expect(id, id).toMatch(/^summary(-[a-z]+)+$/);
    }
  });

  it("are not the answers' id, nor a paper paragraph's, nor the page's other ids", () => {
    expect(ids).not.toContain(ANSWERS_BLOCK_ID);
    for (const id of ids) expect(id).not.toMatch(/^paper-section-/);
    for (const other of ["abstract-panel", "ask-answers-panel", "reader-common", "paper-body"]) expect(ids).not.toContain(other);
  });

  it("name the blocks of the page's Summary, each once: the words' four, the report's eleven", () => {
    expect(Object.keys(SUMMARY_ID).sort()).toEqual(
      ["abstract", "caveats", "claim", "forYou", "glance", "library", "method", "newHere", "nextStep", "proposal", "record", "related", "results", "skim", "tldr"].sort(),
    );
  });
});

describe("PaperWords — each block that stands in the Summary's container has its id", () => {
  it("with a model's skim: the deck, then the abstract", () => {
    const html = words({ reading: reading(), skim: SKIM, basis: "model-fulltext", quotedSkim: [] });
    expect(blocksOf(html).map((b) => b.id)).toEqual([SUMMARY_ID.skim, SUMMARY_ID.abstract]);
  });

  it("without one: the paper's own claim lifted into the deck's place, then the abstract", () => {
    const html = words({ reading: reading() });
    expect(blocksOf(html).map((b) => b.id)).toEqual([SUMMARY_ID.claim, SUMMARY_ID.abstract]);
  });

  it("with no abstract but a TL;DR: the TL;DR", () => {
    const html = words({ reading: reading({ sentences: [], introCount: 0 }, "An invented one-line summary of the paper.") });
    expect(blocksOf(html).map((b) => b.id)).toEqual([SUMMARY_ID.tldr]);
  });

  it("with neither, there is nothing to hold an id", () => {
    expect(words({ reading: reading({ sentences: [], introCount: 0 }) })).toBe("");
  });

  // The centre column drops the top gap of the first block it opens with (`reader-layout.tsx`: `[&>:first-child>:first-child>:first-child]:mt-0`), which is
  // the block's own element — and with a wrapper around it, the wrapper. A block that can open the column (a paper with no body: the lead claim, the
  // abstract) hands its top gap to the wrapper, so the rule drops it as it did; measured on the real page at 1280, 1440 and 390, light and dark.
  it("the abstract's top gap stands on the element around it, not on its toggle: the column's first-block rule reaches the former", () => {
    const html = words({ reading: reading(), skim: SKIM, basis: "model-fulltext", quotedSkim: [] });
    const wrapper = /<div id="summary-abstract"([^>]*)>(<section[^>]*>)/.exec(html);
    expect(wrapper).not.toBeNull();
    expect(wrapper![1]).toContain("mt-12");
    expect(wrapper![2]).not.toContain("mt-12");
  });

  it("the lead claim's top gap (the band's own, `SECTION_GAP`) stands on the element around it, and the band's own is taken off", () => {
    const html = words({ reading: reading() });
    const wrapper = /<div id="summary-claim" class="([^"]*)">(<section[^>]*>)/.exec(html);
    expect(wrapper).not.toBeNull();
    const classes = wrapper![1].replaceAll("&amp;", "&").replaceAll("&gt;", ">").split(" ");
    for (const gap of SECTION_GAP.split(" ")) expect(classes).toContain(gap);
    expect(classes).toContain("[&>section]:mt-0");
    // The band's own section still carries its gap in its markup (the class that the wrapper's rule overrides), as the claim has always been drawn.
    expect(wrapper![2]).toContain("mt-12");
  });

  it("keeps the abstract's toggle, whose footer the decided-read observer watches, inside the abstract's block, where it was", () => {
    const html = words({ reading: reading() });
    const abstract = html.slice(html.indexOf(`id="${SUMMARY_ID.abstract}"`));
    expect(abstract).toContain("<section");
    expect(abstract).toContain('aria-controls="abstract-panel"');
  });
});

describe("ForYourQuestions — the answers' block has its id", () => {
  const report: Pick<PaperReport, "forYourQuestions"> = {
    forYourQuestions: [{ question: "Does the layer hold water?", verdict: "answered", answers: [], readNext: [] }],
  };

  it("is the one element the answers draw, under the answers' id", () => {
    const html = renderToStaticMarkup(createElement(ForYourQuestions, { report, map: undefined }));
    expect(blocksOf(html)).toEqual([{ tag: "section", id: ANSWERS_BLOCK_ID }]);
  });

  it("draws nothing, and so no id, for a report with no answers", () => {
    expect(renderToStaticMarkup(createElement(ForYourQuestions, { report: { forYourQuestions: [] }, map: undefined }))).toBe("");
  });
});

// ── What the selection reports, and where the square goes ──────────────────

interface Node_ {
  nodeType: number;
  tag: string;
  id: string;
  attrs: Record<string, string>;
  parentElement: Node_ | null;
  closest(selector: string): Node_ | null;
  getAttribute(name: string): string | null;
}

function node(tag: string, parent: Node_ | null, attrs: Record<string, string> = {}, id = ""): Node_ {
  const self: Node_ = {
    nodeType: 1,
    tag,
    id,
    attrs,
    parentElement: parent,
    getAttribute: (name) => attrs[name] ?? null,
    closest(selector) {
      const wanted = selector.split(",").map((part) => part.trim());
      const matches = (el: Node_, simple: string) => {
        const attr = /^\[([\w-]+)(?:='([^']*)')?\]$/.exec(simple);
        if (attr) return attr[2] === undefined ? attr[1] in el.attrs : el.attrs[attr[1]] === attr[2];
        return el.tag === simple;
      };
      for (let at: Node_ | null = self; at; at = at.parentElement) if (wanted.some((simple) => matches(at as Node_, simple))) return at;
      return null;
    },
  };
  return self;
}

const LINE = [{ left: 100, top: 200, right: 260, bottom: 220 }];
function selecting(inside: Node_, words = "a short passage"): SelectionLike {
  const start = { nodeType: 3, parentElement: inside };
  const made = { startContainer: start, endContainer: start, endOffset: 5, cloneRange: () => made, cloneContents: () => ({ querySelector: () => null }), getClientRects: () => LINE, getBoundingClientRect: () => LINE[0] };
  return { rangeCount: 1, isCollapsed: false, toString: () => words, getRangeAt: () => made as never };
}

describe("the id the selection reports is the id the square goes to", () => {
  afterEach(() => vi.useRealTimers());

  /** A Summary container whose blocks are the elements the page draws, each with the id it renders; a selection inside each. */
  const container = (source: "summary" | "answer", ids: readonly string[]) => {
    const root = node("div", null);
    const box = node("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: source });
    return ids.map((id) => ({ id, block: node("section", box, {}, id) }));
  };
  const everyId = [...Object.values(SUMMARY_ID)];

  it("a selection in any Summary block reports that block's id as its paragraph", () => {
    for (const { id, block } of container("summary", everyId)) {
      const target = readSelection(selecting(node("p", block)));
      expect(target, id).toMatchObject({ source: "summary", sectionIndex: -1, paragraphIndex: -1, paragraphId: id });
    }
  });

  it("a selection in the answers reports the answers' block", () => {
    const [{ block }] = container("answer", [ANSWERS_BLOCK_ID]);
    expect(readSelection(selecting(node("p", block)))).toMatchObject({ source: "answer", paragraphId: ANSWERS_BLOCK_ID });
  });

  it("the note is anchored by that id (never `paper-section--1-p-1`), and the square scrolls to the element that carries it and flashes it", () => {
    vi.useFakeTimers();
    for (const [source, ids] of [["summary", everyId], ["answer", [ANSWERS_BLOCK_ID]]] as const) {
      for (const { id, block } of container(source, ids)) {
        const target = readSelection(selecting(node("p", block)));
        expect(target).not.toBeNull();
        const paragraphId = stickyAnchorId(target!);
        expect(paragraphId, id).toBe(id);
        const classes = new Set<string>();
        const el = {
          scrollIntoView: vi.fn(),
          classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
          querySelectorAll: () => [],
        };
        const navigate = vi.fn();
        goToPassage({ paperId: "p1", paragraphId, quote: "a short passage", n: 1 }, { doc: { getElementById: (wanted: string) => (wanted === block.id ? el : null) } as unknown as Document, navigate });
        expect(el.scrollIntoView, id).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
        expect(classes.size, id).toBeGreaterThan(0);
        vi.advanceTimersByTime(FLASH_MS + 1);
        expect(classes.size, id).toBe(0);
        expect(navigate, id).not.toHaveBeenCalled();
      }
    }
  });

  it("a block with no id of its own is reported as the bare word for its container — the dead end this rule closes", () => {
    const root = node("div", null);
    const box = node("div", root, { [EXPLAIN_SOURCE_ATTRIBUTE]: "summary" });
    const bare = node("section", box);
    expect(readSelection(selecting(node("p", bare)))).toMatchObject({ paragraphId: "summary" });
  });
});
