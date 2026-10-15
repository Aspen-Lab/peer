import { beforeEach, describe, expect, it } from "vitest";
import { passageSegments, type AnchorSpot } from "@/components/notes/note-tags";
import { useNotesStore } from "@/store/notes";
import { paragraphAnchor, readSelection, type SelectionLike } from "./paper-body";

// P10-24 (walk X-B2′, BACKLOG-87): a selection that runs across an earlier note's tag still becomes a marked note.
// The tag [n] is a `<sup>` (a word joiner U+2060, then the button "[n]") that the browser's `toString()` reads as text
// ("⁠[1]"), so the passage was not found whole in the paragraph's text. The passage is now the paragraph's own
// words: the DOM range's text nodes outside a tag's `<sup>`. This project's Vitest has no DOM; a paragraph is built
// here as a tree of text, `<mark>` and tag `<sup>` nodes, and a selection cuts it the way a browser's range does.
// Every text is invented.

type Rect = { left: number; top: number; right: number; bottom: number };
interface FNode {
  nodeType: number;
  nodeName: string;
  data?: string;
  childNodes?: FNode[];
}
const text = (data: string): FNode => ({ nodeType: 3, nodeName: "#text", data });
const mark = (n: number, ...childNodes: FNode[]): FNode => ({ nodeType: 1, nodeName: "MARK", childNodes, data: String(n) });
/** The tag as `NoteTag` renders it: sup > word joiner, button > "[n]". */
const tag = (n: number): FNode => ({ nodeType: 1, nodeName: "SUP", childNodes: [text("⁠"), { nodeType: 1, nodeName: "BUTTON", childNodes: [text(`[${n}]`)] }] });

const PARAGRAPH = "Creep limits the life of hot parts. The finest grains crept fastest when annealed. Grain boundaries slide.";
const at = (words: string) => PARAGRAPH.indexOf(words);
const FIRST = "finest grains";
const SECOND = "boundaries slide";

/** The paragraph as the body renders it with notes 1 and 2: their words marked, each tag right after its mark. */
function rendered(): FNode[] {
  const a = at(FIRST);
  const b = at(SECOND);
  return [
    text(PARAGRAPH.slice(0, a)),
    mark(1, text(FIRST)),
    tag(1),
    text(PARAGRAPH.slice(a + FIRST.length, b)),
    mark(2, text(SECOND)),
    tag(2),
    text(PARAGRAPH.slice(b + SECOND.length)),
  ];
}

const textOf = (nodes: readonly FNode[]): string => nodes.map((n) => (n.nodeType === 3 ? n.data! : textOf(n.childNodes ?? []))).join("");

/**
 * A range from paragraph offset `from` to `to` (offsets count the paragraph's words, never a tag's): what `cloneContents`
 * holds — the text nodes cut at the ends, the marks cut around them, a tag whole when the range runs across the place
 * it stands (`from < place < to`: a range that only ends or starts there does not hold it).
 */
function cloneContents(nodes: readonly FNode[], from: number, to: number): FNode[] {
  const out: FNode[] = [];
  let pos = 0;
  const walk = (list: readonly FNode[], into: FNode[]) => {
    for (const node of list) {
      if (node.nodeName === "SUP") {
        if (from < pos && pos < to) into.push(node);
      } else if (node.nodeType === 3) {
        const length = node.data!.length;
        const lo = Math.max(from, pos);
        const hi = Math.min(to, pos + length);
        if (lo < hi) into.push(text(node.data!.slice(lo - pos, hi - pos)));
        pos += length;
      } else {
        const inner: FNode[] = [];
        const before = pos;
        walk(node.childNodes ?? [], inner);
        if (inner.length > 0 || (before >= from && pos <= to && pos > before)) into.push({ ...node, childNodes: inner });
      }
    }
  };
  walk(nodes, out);
  return out;
}

/** The DOM's selection over the rendered paragraph (section 1, paragraph 2): `toString()` reads every text node, a tag's too. */
function selectOver(from: number, to: number): SelectionLike {
  const host = { id: paragraphAnchor(1, 2), nodeType: 1, parentElement: null as unknown, tag: "div" };
  const p = {
    id: "",
    nodeType: 1,
    parentElement: host,
    closest: (selector: string) => (selector === "p" ? p : null),
  };
  Object.assign(host, {
    closest: (selector: string) => (selector === "#paper-body" ? host : null),
  });
  const end = { nodeType: 3, parentElement: p };
  const rect: Rect = { left: 10, top: 10, right: 90, bottom: 30 };
  const fragment = cloneContents(rendered(), from, to);
  const made = {
    startContainer: end,
    endContainer: end,
    endOffset: 5,
    cloneRange: () => made,
    cloneContents: () => ({ querySelector: () => null, childNodes: fragment }),
    getClientRects: () => [rect],
    getBoundingClientRect: () => rect,
  };
  return { rangeCount: 1, isCollapsed: false, toString: () => textOf(fragment), getRangeAt: () => made } as unknown as SelectionLike;
}

/** The passage the page hands on for the words `from … to` of the paragraph. */
function passageOf(words: string): string | undefined {
  const start = at(words);
  return readSelection(selectOver(start, start + words.length))?.passage;
}

describe("the fake selection reads like a browser's — tag text included", () => {
  it("has the tag's word joiner and [n] in toString", () => {
    expect(selectOver(at("The finest"), at("crept") + 5).toString()).toBe("The finest grains⁠[1] crept");
  });
});

describe("readSelection — the passage is the paragraph's words, never a tag (P10-24, rule 1)", () => {
  it("across one tag: the words on both sides, without the joiner or [1]", () => {
    expect(passageOf("The finest grains crept fastest")).toBe("The finest grains crept fastest");
    expect(passageOf("grains crept")).toBe("grains crept");
  });

  it("across two tags", () => {
    expect(passageOf("finest grains crept fastest when annealed. Grain boundaries slide.")).toBe(
      "finest grains crept fastest when annealed. Grain boundaries slide.",
    );
  });

  it("inside a mark, and in plain text: as before", () => {
    expect(passageOf("grains")).toBe("grains");
    expect(passageOf("limits the life")).toBe("limits the life");
  });

  it("a range that ends at a tag's place carries no [n]", () => {
    expect(passageOf("The finest grains")).toBe("The finest grains");
  });
});

describe("a note over words that cross a tag gets its range and its mark (P10-24, X-B2′)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  const spotsOf = (noteId: string): AnchorSpot[] =>
    useNotesStore
      .getState()
      .notes[noteId].blocks.filter((b) => b.anchor)
      .map((b) => ({ id: b.id, n: b.anchor!.n, start: b.anchor!.start, end: b.anchor!.end, quote: b.anchor!.quote }));

  function takeOn(words: string): { noteId: string; spots: AnchorSpot[] } {
    const { ensureReadingNote, addSticky } = useNotesStore.getState();
    const noteId = ensureReadingNote({ id: "p1", title: "A Paper", authors: [], publishedDate: "2024", abstract: "" });
    // two earlier notes, as the body drew them
    for (const earlier of [FIRST, SECOND]) {
      addSticky(noteId, { paperId: "p1", paragraphId: paragraphAnchor(1, 2), passage: earlier, paragraphText: PARAGRAPH });
    }
    const passage = passageOf(words);
    expect(passage).toBeDefined();
    addSticky(noteId, { paperId: "p1", paragraphId: paragraphAnchor(1, 2), passage: passage!, paragraphText: PARAGRAPH });
    return { noteId, spots: spotsOf(noteId) };
  }

  it("a selection across one tag: the anchor's offsets are the paragraph's offsets", () => {
    const { spots } = takeOn("The finest grains crept fastest");
    const third = spots[2];
    expect(third.n).toBe(3);
    expect(third.start).toBe(at("The finest grains crept fastest"));
    expect(third.end).toBe(at("The finest grains crept fastest") + "The finest grains crept fastest".length);
    expect(PARAGRAPH.slice(third.start, third.end)).toBe(third.quote);
    expect(third.quote).not.toMatch(/\[\d+\]|⁠/);
    // drawn: its own mark (around note 1's, the P10-20 nesting), not a tag at the paragraph's end
    const segments = passageSegments(PARAGRAPH, spots);
    expect(segments.some((s) => s.kind === "tag")).toBe(false);
  });

  it("a selection that starts inside a mark and runs across its tag: the later mark starts where the earlier ends (P10-20's overlap)", () => {
    const { spots } = takeOn("grains crept fastest");
    const third = spots[2];
    expect(PARAGRAPH.slice(third.start, third.end)).toBe("grains crept fastest");
    const marks = passageSegments(PARAGRAPH, spots).filter((s) => s.kind === "mark");
    expect(marks.map((m) => (m.kind === "mark" ? m.spot.n : 0))).toEqual([1, 3, 2]);
    const [one, three] = marks;
    expect(three.kind === "mark" && one.kind === "mark" && three.from).toBe(one.kind === "mark" ? one.to : -1);
    expect(passageSegments(PARAGRAPH, spots).some((s) => s.kind === "tag")).toBe(false);
  });

  it("a selection across both tags", () => {
    const words = "finest grains crept fastest when annealed. Grain boundaries slide.";
    const { spots } = takeOn(words);
    const third = spots[2];
    expect(PARAGRAPH.slice(third.start, third.end)).toBe(words);
    expect(passageSegments(PARAGRAPH, spots).some((s) => s.kind === "tag")).toBe(false);
  });

  it("a selection inside a mark: as before", () => {
    const { spots } = takeOn("grains");
    expect(PARAGRAPH.slice(spots[2].start, spots[2].end)).toBe("grains");
  });
});
