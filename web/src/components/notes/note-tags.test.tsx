import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { useWindows } from "@/lib/reader/windows";
import { PaperBody, paragraphAnchor } from "@/components/reader/paper-body";
import type { Paper } from "@/types";
import { AnchorSquare, FLASH_MS, NoteTag, SQUARE_PX, goToPassage, passageSegments, registerPassageHost } from "./note-tags";

// P10-09a (review 7.1c; rubric B11): the passage a sticky was taken on carries a small reference tag, like a
// citation mark ([N], superscript, the label face) that opens that sticky; the sticky and the note's heading show a
// small blue square at the left of the text that scrolls the paper back to the passage — from the reading page —
// or, on the notes page, goes to the paper's page at the paragraph. Every text is invented.

const ANCHOR = { paperId: "p1", paragraphId: "paper-section-1-p0", quote: "q", n: 2 };

describe("NoteTag", () => {
  beforeEach(() => useWindows.setState({ windows: [], clock: 0 }));

  it("is a superscript [N] button in the label face that says what it opens", () => {
    const html = renderToStaticMarkup(createElement(NoteTag, { n: 2, id: "h2" }));
    expect(html).toContain("<sup");
    expect(html).toContain(">[2]<");
    expect(html).toContain('aria-label="Open note 2"');
    expect(html).toContain('type="button"');
    expect(html).toContain("select-none");
  });

  it("opens its sticky in the stack when pressed", () => {
    const tree = NoteTag({ n: 2, id: "h2" }) as unknown as { props: { children: [string, { props: { onClick: () => void } }] } };
    tree.props.children[1].props.onClick();
    expect(useWindows.getState().windows).toMatchObject([{ id: "h2", kind: "sticky", title: "Note 2" }]);
  });
});

describe("AnchorSquare — the blue square", () => {
  it("is a button labelled Go to the passage, at least 12 px square, blue", () => {
    expect(SQUARE_PX).toBeGreaterThanOrEqual(12);
    const html = renderToStaticMarkup(createElement(AnchorSquare, { onClick: () => {} }));
    expect(html).toContain('aria-label="Go to the passage"');
    expect(html).toContain('type="button"');
    expect(html).toContain(`width:${SQUARE_PX}px`);
    expect(html).toContain(`height:${SQUARE_PX}px`);
    // P10-46 (§1c, re-aimed): the blue is the `--color-anchor` token now, not a literal `#3b82f6` (globals.css.test.ts pins its value).
    expect(html).toMatch(/background(-color)?:var\(--color-anchor\)/i);
    expect(html).not.toMatch(/#3b82f6/i);
  });
});

// P10-20 (walk X-B2): a note taken on words inside another note's range is drawn as its own mark inside the outer one
// (two shades; a third inside them shares the second), and a tag stands joined to its words by a word joiner.
describe("passageSegments — a note inside another note's words (P10-20)", () => {
  const TEXT = "Grain boundaries carry the strain."; // 34 characters
  const spot = (n: number, start: number, end: number) => ({ id: `h${n}`, n, start, end, quote: TEXT.slice(start, end) });
  const tree = (segments: ReturnType<typeof passageSegments>): string =>
    segments
      .map((one) => {
        if (one.kind === "text") return TEXT.slice(one.from, one.to);
        if (one.kind === "tag") return `<tag${one.spot.n}>`;
        return `[${one.spot.n}@${one.depth} ${tree(one.inner)}]${one.spot.n}`;
      })
      .join("");

  it("nests a range inside another: the inner mark in the outer one, each with its own words", () => {
    expect(tree(passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 16)]))).toBe(`[1@0 Grain [2@1 boundaries]2]1 carry the strain.`);
    expect(tree(passageSegments(TEXT, [spot(2, 6, 16), spot(1, 0, 22)]))).toBe(`[1@0 Grain [2@1 boundaries]2 carry]1 the strain.`);
  });

  it("nests a range equal to another: the earlier note is the outer one", () => {
    expect(tree(passageSegments(TEXT, [spot(4, 6, 16), spot(2, 6, 16)]))).toBe(`Grain [2@0 [4@1 boundaries]4]2 carry the strain.`);
  });

  it("leaves overlapping, not nested, ranges as before: the later mark starts where the earlier ends", () => {
    expect(tree(passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 22)]))).toBe(`[1@0 Grain boundaries]1[2@0  carry]2 the strain.`);
  });

  it("puts a range inside the later part of an overlapping pair into that later mark", () => {
    expect(tree(passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 22), spot(3, 17, 22)]))).toBe(
      `[1@0 Grain boundaries]1[2@0  [3@1 carry]3]2 the strain.`,
    );
  });

  it("draws three in one paragraph: a third inside the second is a mark in the second, and shares its level", () => {
    const segments = passageSegments(TEXT, [spot(1, 0, 22), spot(2, 6, 22), spot(3, 6, 16)]);
    expect(tree(segments)).toBe(`[1@0 Grain [2@1 [3@2 boundaries]3 carry]2]1 the strain.`);
    expect(segments.filter((one) => one.kind === "mark")).toHaveLength(1);
  });

  it("draws a sibling inner mark after an inner mark, and keeps a tail mark after the outer", () => {
    expect(tree(passageSegments(TEXT, [spot(1, 0, 22), spot(2, 0, 5), spot(3, 17, 22), spot(4, 27, 33)]))).toBe(
      `[1@0 [2@1 Grain]2 boundaries [3@1 carry]3]1 the [4@0 strain]4.`,
    );
  });

  it("ends a mark at its last word: the white space the selection ran on over stays plain text after the tag", () => {
    const trailing = { id: "h1", n: 1, start: 0, end: 17, quote: "Grain boundaries" }; // "Grain boundaries "
    const segments = passageSegments(TEXT, [trailing]);
    expect(tree(segments)).toBe(`[1@0 Grain boundaries]1 carry the strain.`);
    expect(segments[0]).toMatchObject({ kind: "mark", from: 0, to: 16 });
    const blank = { id: "h2", n: 2, start: 5, end: 6, quote: "" }; // one space: nothing to mark
    expect(passageSegments(TEXT, [blank]).some((one) => one.kind === "mark")).toBe(false);
  });

  it("still joins back to the paragraph: the outer runs and marks, in order, are exactly its text", () => {
    const segments = passageSegments(TEXT, [spot(1, 0, 22), spot(2, 6, 16), spot(3, 6, 16), spot(4, 27, 33)]);
    expect(segments.flatMap((one) => (one.kind === "tag" ? [] : [TEXT.slice(one.from, one.to)])).join("")).toBe(TEXT);
  });
});

describe("NoteTag — a tag never wraps away from its words (P10-20)", () => {
  it("opens with a word joiner and does not wrap itself, so no line begins with the tag", () => {
    const html = renderToStaticMarkup(createElement(NoteTag, { n: 2, id: "h2" }));
    expect(html).toMatch(/^<sup[^>]*whitespace-nowrap[^>]*>\u2060<button/);
  });
});

describe("goToPassage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeDoc(present: boolean) {
    const classes = new Set<string>();
    const el = {
      scrollIntoView: vi.fn(),
      classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
    };
    return { el, classes, doc: { getElementById: (id: string) => (present && id === ANCHOR.paragraphId ? el : null) } as unknown as Document };
  }

  it("scrolls the paragraph to the top of the window and marks it for a moment", () => {
    vi.useFakeTimers();
    const { el, classes, doc } = fakeDoc(true);
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(classes.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(classes.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("goes to the paper's page at the paragraph when it is not on this page (the notes page)", () => {
    const { doc } = fakeDoc(false);
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#paper-section-1-p0");
  });

  it("asks the reading page to show the paper's text first when the page has registered", () => {
    const { el, doc } = fakeDoc(true);
    const reveal = vi.fn((run: () => void) => run());
    const off = registerPassageHost({ paperId: "p1", reveal });
    const navigate = vi.fn();
    goToPassage(ANCHOR, { doc, navigate });
    off();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    goToPassage(ANCHOR, { doc, navigate });
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});

describe("PaperBody — the tags after a passage", () => {
  const paper: Paper = {
    id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const doc: ExtractedDocument = {
    source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
    sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life.\n\nGrain boundaries carry the strain.", page: 1 }],
  };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
  const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));

  it("draws one [N] per sticky on a paragraph, in order, and none elsewhere", () => {
    const noteAnchors = { [paragraphAnchor(0, 1)]: [{ id: "a", n: 1 }, { id: "b", n: 3 }] };
    const html = renderToStaticMarkup(createElement(PaperBody, { reading, noteAnchors }));
    expect(html.match(/aria-label="Open note \d+"/g)).toEqual(['aria-label="Open note 1"', 'aria-label="Open note 3"']);
    const second = html.slice(html.indexOf(`id="${paragraphAnchor(0, 1)}"`));
    expect(second).toContain(">[1]<");
    expect(html.slice(0, html.indexOf(`id="${paragraphAnchor(0, 1)}"`))).not.toContain("[1]");
  });

  it("changes nothing without anchors", () => {
    const plain = renderToStaticMarkup(createElement(PaperBody, { reading }));
    expect(renderToStaticMarkup(createElement(PaperBody, { reading, noteAnchors: {} }))).toBe(plain);
  });
});

// P10-09f (review 7.1c; walk X-B3, B11; rules 2 and 3): the anchored words are marked, the tag stands right after
// them, and the square flashes the mark. `passageSegments` cuts a paragraph's text into plain runs and marked ranges
// (the text itself is never changed: the runs, joined, are the paragraph); a mark is drawn only where the anchor's
// range still holds the words it was taken on.
describe("passageSegments", () => {
  const TEXT = "Grain boundaries carry the strain."; // 34 characters
  const spot = (n: number, start: number | undefined, end: number | undefined) => ({
    id: `h${n}`,
    n,
    ...(start !== undefined && end !== undefined ? { start, end, quote: TEXT.slice(start, end) } : {}),
  });
  const shape = (segments: ReturnType<typeof passageSegments>) =>
    segments.map((one) => (one.kind === "tag" ? `tag${one.spot.n}` : `${one.kind}:${TEXT.slice(one.from, one.to)}`));

  // P10-20: a mark's content as a string, nested marks in brackets: `[N …]N`, text between.
  const tree = (segments: ReturnType<typeof passageSegments>): string =>
    segments
      .map((one) => {
        if (one.kind === "text") return TEXT.slice(one.from, one.to);
        if (one.kind === "tag") return `<tag${one.spot.n}>`;
        return `[${one.spot.n} ${tree(one.inner)}]${one.spot.n}`;
      })
      .join("");

  it("is the whole text as one run with no note, and with notes that carry no range the tags follow it", () => {
    expect(shape(passageSegments(TEXT, []))).toEqual([`text:${TEXT}`]);
    expect(shape(passageSegments(TEXT, [spot(1, undefined, undefined), spot(2, undefined, undefined)]))).toEqual([`text:${TEXT}`, "tag1", "tag2"]);
  });

  it("marks each note's own words: text, mark, text, mark, text", () => {
    expect(shape(passageSegments(TEXT, [spot(2, 17, 22), spot(1, 0, 5)]))).toEqual([
      "mark:Grain",
      "text: boundaries ",
      "mark:carry",
      "text: the strain.",
    ]);
  });

  it("starts a later note's mark where the earlier one ends (no nesting)", () => {
    const segments = passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 22)]);
    expect(shape(segments)).toEqual(["mark:Grain boundaries", "mark: carry", "text: the strain."]);
    expect(segments.filter((one) => one.kind === "mark").map((one) => (one.kind === "mark" ? one.spot.n : 0))).toEqual([1, 2]);
  });

  it("draws a note whose words lie wholly inside an earlier mark as its own mark inside that one (P10-20; was: its tag only)", () => {
    const segments = passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 16)]);
    expect(shape(segments)).toEqual(["mark:Grain boundaries", `text:${TEXT.slice(16)}`]);
    expect(tree(segments)).toBe(`[1 Grain [2 boundaries]2]1${TEXT.slice(16)}`);
  });

  it("draws no mark where the range no longer holds the words (the text changed), or is out of the text", () => {
    const stale = { ...spot(1, 0, 5), quote: "Grains" };
    expect(shape(passageSegments(TEXT, [stale]))).toEqual([`text:${TEXT}`, "tag1"]);
    expect(shape(passageSegments(TEXT, [{ ...spot(1, 0, 5), start: 30, end: 90 }]))).toEqual([`text:${TEXT}`, "tag1"]);
    expect(shape(passageSegments(TEXT, [{ ...spot(1, 0, 5), start: 5, end: 5 }]))).toEqual([`text:${TEXT}`, "tag1"]);
  });

  it("compares the quote with the words white space collapsed, and by their start when the passage is longer than the quote", () => {
    const wrapped = "Grain  boundaries\ncarry the strain.";
    const long = { id: "h1", n: 1, start: 0, end: 29, quote: "Grain boundaries carry the" };
    const segments = passageSegments(wrapped, [long]);
    expect(segments[0]).toMatchObject({ kind: "mark", from: 0, to: 29 });
  });

  it("never cuts a formula: a range with an end inside one is not marked", () => {
    const text = `The load ${String.fromCodePoint(0x27e6)}x_{1}${String.fromCodePoint(0x27e7)} meets it.`;
    const inside = { id: "h1", n: 1, start: 4, end: 14, quote: text.slice(4, 14) };
    expect(passageSegments(text, [inside]).some((one) => one.kind === "mark")).toBe(false);
    const whole = { id: "h1", n: 1, start: 4, end: text.length, quote: text.slice(4) };
    expect(passageSegments(text, [whole])[1]).toMatchObject({ kind: "mark" });
  });

  it("joins back to the paragraph: the runs and marks, in order, are exactly its text", () => {
    const segments = passageSegments(TEXT, [spot(1, 0, 16), spot(2, 6, 22), spot(3, undefined, undefined)]);
    expect(segments.flatMap((one) => (one.kind === "tag" ? [] : [TEXT.slice(one.from, one.to)])).join("")).toBe(TEXT);
  });
});

describe("goToPassage — the flash lands on the marked words", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeParagraph(withMark: boolean) {
    const paragraphClasses = new Set<string>();
    const markClasses = new Set<string>();
    const set = (classes: Set<string>) => ({ add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) });
    const mark = { classList: set(markClasses) };
    const asked: string[] = [];
    const paragraph = {
      scrollIntoView: vi.fn(),
      classList: set(paragraphClasses),
      // P10-46 (§1c, re-aimed): the flash asks for every mark of the note (`querySelectorAll`), not the first alone.
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return withMark && selector.includes('mark[data-note="2"]') ? [mark] : [];
      },
    };
    return { paragraph, paragraphClasses, markClasses, asked, doc: { getElementById: (id: string) => (id === ANCHOR.paragraphId ? paragraph : null) } as unknown as Document };
  }

  it("still scrolls the paragraph to the top of the window, and marks the words, not the paragraph, for FLASH_MS", () => {
    vi.useFakeTimers();
    const { paragraph, paragraphClasses, markClasses, doc } = fakeParagraph(true);
    goToPassage({ ...ANCHOR, start: 0, end: 5 }, { doc, navigate: vi.fn() });
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(markClasses.size).toBeGreaterThan(0);
    expect(paragraphClasses.size).toBe(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(markClasses.size).toBe(0);
  });

  it("marks the whole paragraph when the range is not drawn (no <mark> for the note)", () => {
    vi.useFakeTimers();
    const { paragraphClasses, doc } = fakeParagraph(false);
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    expect(paragraphClasses.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(paragraphClasses.size).toBe(0);
  });
});
