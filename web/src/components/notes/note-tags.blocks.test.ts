import { afterEach, describe, expect, it, vi } from "vitest";
import { goToPassage, passageIsLost, storedBodyOf } from "./note-tags";

// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): the blue square and the lost check work for a note or a highlight taken on a
// heading or a caption as for a paragraph's. The square scrolls to the element that carries the anchor's id (the heading, or the caption's figure) and
// flashes the marks inside it; the lost check reads the stored reading's headings and captions as well as its paragraphs. Every text is invented.

const BODY = [
  { paragraphs: ["Intro words."] },
  {
    paragraphs: ["A first paragraph.", "A second one."],
    heading: "2 Methods of the tidal survey",
    figures: [{ label: "Figure 1", caption: "Creep against density in the invented survey.", imageUrl: "/f1.png" }],
  },
];
const HEADING = { paperId: "p1", paragraphId: "paper-section-1-p2", quote: "tidal survey", n: 1, start: 17, end: 29 };
const CAPTION = { paperId: "p1", paragraphId: "paper-section-1-p3", quote: "against density", n: 2, start: 17, end: 32 };

describe("goToPassage — a heading's or a caption's anchor", () => {
  afterEach(() => vi.useRealTimers());

  function element(marks: Array<{ n: string; classes: Set<string> }>) {
    const classes = new Set<string>();
    return {
      classes,
      scrollIntoView: vi.fn(),
      classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
      querySelectorAll: (selector: string) =>
        marks
          .filter((m) => selector.includes(`data-note="${m.n}"`))
          .map((m) => ({ classList: { add: (...c: string[]) => c.forEach((x) => m.classes.add(x)), remove: (...c: string[]) => c.forEach((x) => m.classes.delete(x)) } })),
    };
  }

  it("scrolls to the element that carries the id and flashes the note's mark inside it", () => {
    vi.useFakeTimers();
    const mark = { n: "1", classes: new Set<string>() };
    const heading = element([mark]);
    const asked: string[] = [];
    const doc = { getElementById: (id: string) => (asked.push(id), id === HEADING.paragraphId ? heading : null) } as unknown as Document;
    const navigate = vi.fn();
    goToPassage(HEADING, { doc, navigate });
    expect(asked).toEqual([HEADING.paragraphId]);
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(mark.classes.size).toBeGreaterThan(0);
    expect(heading.classes.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("flashes the whole caption's figure where it holds no mark for the note (the words are gone), and goes to the paper's page where the id is not on this one", () => {
    vi.useFakeTimers();
    const figure = element([]);
    goToPassage(CAPTION, { doc: { getElementById: () => figure } as unknown as Document, navigate: vi.fn() });
    expect(figure.classes.size).toBeGreaterThan(0);
    const navigate = vi.fn();
    goToPassage(CAPTION, { doc: { getElementById: () => null } as unknown as Document, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#paper-section-1-p3");
  });
});

describe("passageIsLost — a heading's or a caption's note, against the reading the reader last had", () => {
  it("is not lost when the heading or the caption still holds its words", () => {
    expect(passageIsLost(HEADING, "h1", {}, BODY)).toBe(false);
    expect(passageIsLost(CAPTION, "h2", {}, BODY)).toBe(false);
  });

  it("is lost when the paper's heading or caption no longer holds them", () => {
    const renamed = [BODY[0], { ...BODY[1], heading: "2 Methods of the field study" }];
    expect(passageIsLost(HEADING, "h1", {}, renamed)).toBe(true);
    const recaptioned = [BODY[0], { ...BODY[1], figures: [{ label: "Figure 1", caption: "Another caption entirely." }] }];
    expect(passageIsLost(CAPTION, "h2", {}, recaptioned)).toBe(true);
  });

  it("is not lost when the heading moved to another place in the section: found again by its quote", () => {
    const grown = [BODY[0], { ...BODY[1], paragraphs: [...BODY[1].paragraphs, "A third paragraph."] }];
    expect(passageIsLost(HEADING, "h1", {}, grown)).toBe(false);
  });
});

describe("storedBodyOf — the reading kept in this browser keeps its headings and captions", () => {
  it("gives back the sections as stored, headings and figures with them", () => {
    const entry = { ts: 1_000, reading: { version: 18, body: BODY } };
    const storage = { getItem: () => JSON.stringify({ "p1|key": entry }) };
    const body = storedBodyOf("p1", storage, 2_000);
    expect(body).toEqual(BODY);
    expect(passageIsLost(HEADING, "h1", {}, body)).toBe(false);
  });
});
