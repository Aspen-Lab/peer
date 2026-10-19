import { afterEach, describe, expect, it, vi } from "vitest";
import type { HighlightColourId } from "@/lib/notes/types";
import { FLASH_MS, goToPassage, passageSegments, registerPassageHost, type PassageSegment } from "./note-tags";
import { coveringSegments, type CoveringSegment } from "@/components/reader/paper-body";

// P11-09 (owner item 8; B P11-04 §3.2, §3.3; ruling §1h.112): a highlight takes part in the paragraph's one tree of marks.
// On equal ranges a sticky is the outer and, between two highlights, the earlier `order`; and the square of a highlight
// (the notes row's) flashes its marks the way a sticky's flashes its own. Every text is invented.

const TEXT = "Grain boundaries carry the strain."; // 34 characters

interface Spot {
  id: string;
  n: number;
  start?: number;
  end?: number;
  quote?: string;
  colour?: HighlightColourId;
  order?: number;
}
const sticky = (id: string, n: number, start: number, end: number): Spot => ({ id, n, start, end, quote: TEXT.slice(start, end) });
const light = (id: string, start: number, end: number, order: number, colour: HighlightColourId = "yellow"): Spot => ({
  id, n: 0, start, end, quote: TEXT.slice(start, end), colour, order,
});

/** `[id@depth …]` a mark with the marks inside it; `(id@depth …)` a nested part of a later mark; `<id>` a tag. */
function tree(segments: readonly (PassageSegment | CoveringSegment)[]): string {
  return segments
    .map((one) => {
      if (one.kind === "text") return TEXT.slice(one.from, one.to);
      if (one.kind === "tag") return `<${one.spot.id}>`;
      const inner = tree(one.inner);
      return "part" in one && one.part ? `(${one.spot.id}@${one.depth} ${inner})` : `[${one.spot.id}@${one.depth} ${inner}]`;
    })
    .join("");
}

describe("passageSegments — the tie of two marks over the same words (P11-09)", () => {
  it("a sticky is the outer and a highlight inside it, whichever is listed first and whatever their numbers", () => {
    for (const spots of [[sticky("s", 4, 6, 16), light("h", 6, 16, 0)], [light("h", 6, 16, 0), sticky("s", 4, 6, 16)], [light("h", 6, 16, 0), sticky("s", 9, 6, 16)]]) {
      expect(tree(passageSegments(TEXT, spots))).toBe("Grain [s@0 [h@1 boundaries]] carry the strain.");
    }
  });

  it("between two highlights the earlier order is the outer, whichever is listed first", () => {
    for (const spots of [[light("late", 6, 16, 7), light("early", 6, 16, 2)], [light("early", 6, 16, 2), light("late", 6, 16, 7)]]) {
      expect(tree(passageSegments(TEXT, spots))).toBe("Grain [early@0 [late@1 boundaries]] carry the strain.");
    }
  });

  it("two stickies are still told by their numbers (a paragraph with no highlight sorts as it did)", () => {
    for (const spots of [[sticky("b", 4, 6, 16), sticky("a", 2, 6, 16)], [sticky("a", 2, 6, 16), sticky("b", 4, 6, 16)]]) {
      expect(tree(passageSegments(TEXT, spots))).toBe("Grain [a@0 [b@1 boundaries]] carry the strain.");
    }
  });

  it("a longer range is still the outer, whatever its kind or order", () => {
    expect(tree(passageSegments(TEXT, [sticky("s", 1, 6, 16), light("h", 0, 22, 9)]))).toBe("[h@0 Grain [s@1 boundaries] carry] the strain.");
  });

  it("keeps the paragraph's words in order whatever it holds (I1)", () => {
    const words = (segments: readonly PassageSegment[]): string =>
      segments.map((one) => (one.kind === "text" ? TEXT.slice(one.from, one.to) : one.kind === "mark" ? words(one.inner) : "")).join("");
    const spots = [light("a", 0, 16, 0), light("b", 6, 22, 1), sticky("s", 1, 6, 16), light("c", 17, 22, 2, "green")];
    expect(words(passageSegments(TEXT, spots))).toBe(TEXT);
  });
});

describe("coveringSegments — the tie of two clipped marks (P11-09)", () => {
  // `a` holds 0–16; the two others both start inside it (6) and run out of it (22): their first words are parts inside `a`,
  // the one told first (a sticky before a highlight, the earlier order between highlights) being the outer part.
  it("lays a sticky's lost words outside a highlight's of the same range", () => {
    for (const spots of [
      [light("a", 0, 16, 0), sticky("s", 3, 6, 22), light("h", 6, 22, 1)],
      [light("h", 6, 22, 1), sticky("s", 3, 6, 22), light("a", 0, 16, 0)],
    ]) {
      expect(tree(coveringSegments(TEXT, spots))).toBe("[a@0 Grain (s@1 (h@2 boundaries))][s@0 [h@1  carry]] the strain.");
    }
  });

  it("lays the earlier highlight's lost words outside the later one's", () => {
    for (const spots of [
      [light("a", 0, 16, 0), light("late", 6, 22, 5), light("early", 6, 22, 3)],
      [light("early", 6, 22, 3), light("late", 6, 22, 5), light("a", 0, 16, 0)],
    ]) {
      const out = tree(coveringSegments(TEXT, spots));
      expect(out.indexOf("(early@")).toBeGreaterThan(-1);
      expect(out.indexOf("(early@")).toBeLessThan(out.indexOf("(late@"));
      expect(out).toContain("(early@1 (late@2 boundaries))");
    }
  });
});

// ── The flash on a highlight (rule 2) ───────────────────────────────────────

type FakeMark = { attrs: Record<string, string>; classes: Set<string>; classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void } };
const fakeMark = (attrs: Record<string, string>): FakeMark => {
  const classes = new Set<string>();
  return { attrs, classes, classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) } };
};
/** The attribute selectors a comma list names, e.g. `mark[data-highlight="h1"], mark[data-highlight-part="h1"]`. */
const selectorsOf = (selector: string) => [...selector.matchAll(/mark\[(data-[a-z-]+)="([^"]*)"\]/g)].map((m) => ({ attr: m[1], value: m[2] }));

function fakeParagraph(marks: FakeMark[], id = "paper-section-1-p0") {
  const paragraphClasses = new Set<string>();
  const paragraph = {
    scrollIntoView: vi.fn(),
    classList: {
      add: (...c: string[]) => c.forEach((x) => paragraphClasses.add(x)),
      remove: (...c: string[]) => c.forEach((x) => paragraphClasses.delete(x)),
    },
    querySelectorAll: (selector: string) => {
      const wanted = selectorsOf(selector);
      return marks.filter((one) => wanted.some(({ attr, value }) => one.attrs[attr] === value));
    },
  };
  return { paragraph, paragraphClasses, doc: { getElementById: (want: string) => (want === id ? paragraph : null) } as unknown as Document };
}

const GOAL = { paperId: "p1", paragraphId: "paper-section-1-p0", highlightId: "h1" };
// A goal typed as a highlight's: `goToPassage` takes a sticky's anchor or this.
const go = goToPassage as unknown as (goal: typeof GOAL, env: { doc: Document; navigate: (href: string) => void }) => void;

describe("goToPassage — a highlight is flashed through its marks (P11-09, rule 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Reading order: the first highlight's mark with the second's nested part, the second's own mark, a sticky's mark, the first's part of a third.
  const build = () => {
    const outer = fakeMark({ "data-highlight": "h1" });
    const other = fakeMark({ "data-highlight": "h2" });
    const part = fakeMark({ "data-highlight-part": "h1" });
    const stickyMark = fakeMark({ "data-note": "1" });
    const stickyPart = fakeMark({ "data-note-part": "1" });
    return { outer, other, part, stickyMark, stickyPart, ...fakeParagraph([outer, part, other, stickyMark, stickyPart]) };
  };

  it("flashes the highlight's own mark and its nested parts together, and no other highlight's or sticky's mark", () => {
    vi.useFakeTimers();
    const { outer, part, other, stickyMark, stickyPart, paragraph, paragraphClasses, doc } = build();
    go(GOAL, { doc, navigate: vi.fn() });
    expect(outer.classes.size).toBeGreaterThan(0);
    expect(part.classes.size).toBeGreaterThan(0);
    expect([...outer.classes].sort()).toEqual([...part.classes].sort());
    for (const none of [other, stickyMark, stickyPart]) expect(none.classes.size).toBe(0);
    expect(paragraphClasses.size).toBe(0);
    expect(paragraph.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
  });

  it("flashes with the very classes a sticky's mark flashes with (P10-46), and takes them off after FLASH_MS", () => {
    vi.useFakeTimers();
    const sticky = fakeMark({ "data-note": "3" });
    const withSticky = fakeParagraph([sticky]);
    goToPassage({ paperId: "p1", paragraphId: "paper-section-1-p0", quote: "q", n: 3, start: 6, end: 22 }, { doc: withSticky.doc, navigate: vi.fn() });
    const stickyClasses = [...sticky.classes].sort();
    expect(stickyClasses).toContain("outline");
    const { outer, part, doc } = build();
    go(GOAL, { doc, navigate: vi.fn() });
    expect([...outer.classes].sort()).toEqual(stickyClasses);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(outer.classes.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(2);
    expect(outer.classes.size).toBe(0);
    expect(part.classes.size).toBe(0);
  });

  it("flashes a highlight that is only a nested part", () => {
    vi.useFakeTimers();
    const part = fakeMark({ "data-highlight-part": "h1" });
    const { doc, paragraphClasses } = fakeParagraph([part]);
    go(GOAL, { doc, navigate: vi.fn() });
    expect(part.classes.size).toBeGreaterThan(0);
    expect(paragraphClasses.size).toBe(0);
  });

  it("flashes the whole paragraph when no mark of the highlight is drawn (its passage is lost)", () => {
    vi.useFakeTimers();
    const other = fakeMark({ "data-highlight": "h2" });
    const { doc, paragraphClasses } = fakeParagraph([other]);
    go(GOAL, { doc, navigate: vi.fn() });
    expect(other.classes.size).toBe(0);
    expect(paragraphClasses.size).toBeGreaterThan(0);
  });

  it("goes to the paper's page at the paragraph when it is not on this page, and asks the reading page to show the text first when it has registered", () => {
    const navigate = vi.fn();
    go(GOAL, { doc: { getElementById: () => null } as unknown as Document, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#paper-section-1-p0");
    const { paragraph, doc } = fakeParagraph([fakeMark({ "data-highlight": "h1" })]);
    const reveal = vi.fn((run: () => void) => run());
    const off = registerPassageHost({ paperId: "p1", reveal });
    const again = vi.fn();
    go(GOAL, { doc, navigate: again });
    off();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(paragraph.scrollIntoView).toHaveBeenCalled();
    expect(again).not.toHaveBeenCalled();
  });
});
