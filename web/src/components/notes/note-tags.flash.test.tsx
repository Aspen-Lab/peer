import { afterEach, describe, expect, it, vi } from "vitest";
import { FLASH_MS, goToPassage } from "./note-tags";

// P10-46 (P10-43's unsettled 2): a note whose first words stand in a nested part (`<mark data-note-part="N">`, inside an
// earlier note's mark) and whose rest is its own `<mark data-note="N">` flashes ALL its words, not the later mark alone.
// The paragraph is a small fake in document order (the real `querySelectorAll` of a selector list returns document order).
// Every text is invented.

const ANCHOR = { paperId: "p1", paragraphId: "paper-section-1-p0", quote: "q", n: 3, start: 6, end: 22 };

type FakeMark = { attrs: Record<string, string>; classes: Set<string>; classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void } };

function fakeMark(attrs: Record<string, string>): FakeMark {
  const classes = new Set<string>();
  return {
    attrs,
    classes,
    classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) },
  };
}

/** The attribute selectors a comma list names, e.g. `mark[data-note="3"], mark[data-note-part="3"]`. */
function selectorsOf(selector: string): { attr: string; value: string }[] {
  return [...selector.matchAll(/mark\[(data-note(?:-part)?)="(\d+)"\]/g)].map((match) => ({ attr: match[1], value: match[2] }));
}

function fakeParagraph(marks: FakeMark[]) {
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
    querySelector: (selector: string) => {
      const wanted = selectorsOf(selector);
      return marks.find((one) => wanted.some(({ attr, value }) => one.attrs[attr] === value)) ?? null;
    },
  };
  return { paragraph, paragraphClasses, doc: { getElementById: (id: string) => (id === ANCHOR.paragraphId ? paragraph : null) } as unknown as Document };
}

describe("goToPassage — the flash covers all of a note's marked words (P10-46)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Reading order: the outer note 1's mark, the overlapping note 3's first words nested in it, note 3's rest, note 4 after.
  const build = () => {
    const outer = fakeMark({ "data-note": "1" });
    const part = fakeMark({ "data-note-part": "3" });
    const rest = fakeMark({ "data-note": "3" });
    const after = fakeMark({ "data-note": "4" });
    return { outer, part, rest, after, ...fakeParagraph([outer, part, rest, after]) };
  };

  it("flashes the nested part and the main mark of a note together, and no other note's mark", () => {
    vi.useFakeTimers();
    const { outer, part, rest, after, paragraph, paragraphClasses, doc } = build();
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    expect(part.classes.size).toBeGreaterThan(0);
    expect(rest.classes.size).toBeGreaterThan(0);
    expect([...part.classes].sort()).toEqual([...rest.classes].sort());
    expect(outer.classes.size).toBe(0);
    expect(after.classes.size).toBe(0);
    expect(paragraphClasses.size).toBe(0);
    expect(paragraph.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
  });

  it("takes the flash off every one of them after FLASH_MS", () => {
    vi.useFakeTimers();
    const { part, rest, doc } = build();
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(part.classes.size).toBeGreaterThan(0);
    expect(rest.classes.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(2);
    expect(part.classes.size).toBe(0);
    expect(rest.classes.size).toBe(0);
  });

  it("flashes a nested note's own mark (data-note) when it has no part, as before", () => {
    vi.useFakeTimers();
    const outer = fakeMark({ "data-note": "1" });
    const inside = fakeMark({ "data-note": "3" });
    const { doc } = fakeParagraph([outer, inside]);
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    expect(inside.classes.size).toBeGreaterThan(0);
    expect(outer.classes.size).toBe(0);
  });

  it("flashes a note that is only a nested part (no main mark drawn)", () => {
    vi.useFakeTimers();
    const part = fakeMark({ "data-note-part": "3" });
    const { doc, paragraphClasses } = fakeParagraph([part]);
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    expect(part.classes.size).toBeGreaterThan(0);
    expect(paragraphClasses.size).toBe(0);
  });

  it("falls back to the whole paragraph when the note has no mark drawn", () => {
    vi.useFakeTimers();
    const other = fakeMark({ "data-note": "1" });
    const { doc, paragraphClasses } = fakeParagraph([other]);
    goToPassage(ANCHOR, { doc, navigate: vi.fn() });
    expect(other.classes.size).toBe(0);
    expect(paragraphClasses.size).toBeGreaterThan(0);
  });
});
