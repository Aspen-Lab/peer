import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnchorMarker, PASSAGE_LOST_LINE, SQUARE_BLUE, passageIsLost, storedBodyOf } from "./note-tags";

// P10-36 (rule 1; P10-35's unsettled (b)): a note whose passage is found nowhere in the paper has no tag in it, so its
// "Note N" square on the notes page and in the notes window must not jump to the old paragraph (it would land on other
// words): it says so in one quiet line beside its heading. Every text is invented.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const QUOTE = "finest grains crept fastest";
const ANCHOR = { paperId: "p1", paragraphId: "paper-section-0-p1", quote: QUOTE, n: 2, start: 4, end: 4 + QUOTE.length };
const BODY = [{ paragraphs: ["Creep limits the life of hot parts.", `The ${QUOTE} when annealed.`] }];
const OTHER = [{ paragraphs: ["Creep limits the life of hot parts.", "Grain boundaries carry the strain."] }];

describe("the line", () => {
  it("is P10-35's quiet line, said once for the sticky window and the heading", () => {
    expect(PASSAGE_LOST_LINE).toBe("This passage is not in this version of the paper.");
    expect(read("src/components/notes/sticky-note.tsx")).toContain("PASSAGE_LOST_LINE");
    expect(read("src/components/notes/sticky-note.tsx")).not.toContain("This passage is not in this version of the paper.");
  });
});

describe("passageIsLost — the sticky whose passage the paper holds nowhere", () => {
  it("is lost when the body found no passage for it (the reading page told the store)", () => {
    expect(passageIsLost(ANCHOR, "h2", { h2: true }, null)).toBe(true);
    expect(passageIsLost(ANCHOR, "h2", {}, null)).toBe(false);
  });

  it("is lost when the paper the reader last had does not hold its words anywhere (the notes page has no body on show)", () => {
    expect(passageIsLost(ANCHOR, "h2", {}, OTHER)).toBe(true);
  });

  it("is not lost when the words stand where they were, or in another paragraph", () => {
    expect(passageIsLost(ANCHOR, "h2", {}, BODY)).toBe(false);
    expect(passageIsLost(ANCHOR, "h2", {}, [{ paragraphs: [`Intro. The ${QUOTE} early.`, "x"] }, ...BODY])).toBe(false);
  });

  it("is never lost for a note with no range (its passage crossed paragraphs: nothing to check)", () => {
    const { start, end, ...bare } = ANCHOR;
    void start; void end;
    expect(passageIsLost(bare, "h2", {}, OTHER)).toBe(false);
  });
});

describe("storedBodyOf — the body of the paper's reading kept in this browser", () => {
  // re-aimed (§1c): an entry now carries the version and a recent time, which the gates below need (same cases as before)
  const NOW = 1_800_000_000_000;
  const entry = (ts: number, paragraphs: string[], version = 12) => ({ ts: NOW - 1000 * ts, reading: { version, body: [{ paragraphs }] } });
  const store = (value: unknown) => ({ getItem: () => (typeof value === "string" ? value : JSON.stringify(value)) });

  it("is the newest reading kept under the paper's id, and no other paper's", () => {
    const cache = { "p1|public|": entry(20, ["old"]), "p1|up|3": entry(10, ["new"]), "p2|public|": entry(5, ["other"]) };
    expect(storedBodyOf("p1", store(cache), NOW)).toEqual([{ paragraphs: ["new"] }]);
    expect(storedBodyOf("p3", store(cache), NOW)).toBeNull();
  });

  it("is null when the storage is empty, unreadable, or not a reading", () => {
    expect(storedBodyOf("p1", store({}), NOW)).toBeNull();
    expect(storedBodyOf("p1", store("{not json"), NOW)).toBeNull();
    expect(storedBodyOf("p1", { getItem: () => { throw new Error("blocked"); } }, NOW)).toBeNull();
    expect(storedBodyOf("p1", store({ "p1|public|": { ts: NOW, reading: { version: 12, body: "x" } } }), NOW)).toBeNull();
    expect(storedBodyOf("p1", store({ "p1|public|": { ts: NOW, reading: { version: 12, body: [{ paragraphs: [3] }] } } }), NOW)).toBeNull();
  });

  // P10-36 (the manager's fix): a cached reading is used only as `use-reading.ts` uses it — the current version, inside a day.
  it("does not know a reading of another version: its body may be an older split, and a repaired note must not be called lost by it", () => {
    const stale = { "p1|public|": entry(10, ["Creep limits the life of hot parts."], 11) };
    expect(storedBodyOf("p1", store(stale), NOW)).toBeNull();
    expect(passageIsLost(ANCHOR, "h2", {}, storedBodyOf("p1", store(stale), NOW))).toBe(false);
    // and the newer entry wins over an older-version one, not the other way round
    expect(storedBodyOf("p1", store({ ...stale, "p1|up|3": entry(50, ["kept"]) }), NOW)).toEqual([{ paragraphs: ["kept"] }]);
  });

  it("does not know a reading older than a day (the page would fetch it again), and uses one just inside the day", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const aged = (age: number) => ({ "p1|public|": { ts: NOW - age, reading: { version: 12, body: [{ paragraphs: ["x"] }] } } });
    expect(storedBodyOf("p1", store(aged(DAY)), NOW)).toBeNull();
    expect(passageIsLost(ANCHOR, "h2", {}, storedBodyOf("p1", store(aged(DAY + 1)), NOW))).toBe(false);
    expect(storedBodyOf("p1", store(aged(DAY - 1)), NOW)).toEqual([{ paragraphs: ["x"] }]);
    expect(storedBodyOf("p1", store({ "p1|public|": { reading: { version: 12, body: [{ paragraphs: ["x"] }] } } }), NOW)).toBeNull();
  });

  it("keeps its two gates the ones use-reading.ts applies", () => {
    const reading = read("src/components/reader/use-reading.ts");
    const tags = read("src/components/notes/note-tags.tsx");
    expect(tags).toContain(`const READING_VERSION: PaperReading["version"] = ${/READING_VERSION: PaperReading\["version"\] = (\d+)/.exec(reading)?.[1]};`);
    expect(reading).toContain("const TTL_MS = 24 * 60 * 60 * 1000;");
    expect(tags).toContain("const READING_TTL_MS = 24 * 60 * 60 * 1000;");
  });
});

describe("AnchorMarker — the square, or the line", () => {
  it("is the blue square that goes to the passage while the passage is there", () => {
    const html = renderToStaticMarkup(createElement(AnchorMarker, { lost: false, n: 2, onGo: () => {} }));
    expect(html).toContain('aria-label="Go to the passage"');
    expect(html).not.toContain(PASSAGE_LOST_LINE);
  });

  // P10-39 (§1c, re-aimed): the line is no longer the marker's — the note editor draws it after the heading's words
  // (note-tags.lostline.test.tsx); the marker keeps the quiet square and the rest of this test.
  it("has no blue square to go to the old paragraph when the passage is lost (the line follows the heading, drawn by the editor)", () => {
    const go = vi.fn();
    const html = renderToStaticMarkup(createElement(AnchorMarker, { lost: true, n: 2, onGo: go }));
    expect(html).not.toContain(PASSAGE_LOST_LINE);
    expect(html).not.toContain('aria-label="Go to the passage"');
    expect(html.toLowerCase()).not.toContain(SQUARE_BLUE);
    expect(go).not.toHaveBeenCalled();
  });

  it("opens the note in place where there is a sticky to open (the reading page), and is not a button where there is not", () => {
    const open = vi.fn();
    const withOpen = createElement(AnchorMarker, { lost: true, n: 2, onGo: () => {}, onOpen: open });
    const tree = AnchorMarker({ lost: true, n: 2, onGo: () => {}, onOpen: open }) as unknown as { props: { children: { props: { onClick?: () => void } }[] } };
    expect(renderToStaticMarkup(withOpen)).toContain('aria-label="Open note 2"');
    const button = tree.props.children.find((c) => c && typeof c === "object" && "props" in c && c.props.onClick);
    button?.props.onClick?.();
    expect(open).toHaveBeenCalledTimes(1);
    const bare = renderToStaticMarkup(createElement(AnchorMarker, { lost: true, n: 2, onGo: () => {} }));
    expect(bare).not.toContain("<button");
    expect(bare).toContain("<span");
  });
});

describe("AnchorLink — the wiring", () => {
  const source = read("src/components/notes/note-tags.tsx");
  it("asks whether the passage is lost, from what the reading page told and from the stored reading", () => {
    expect(source).toMatch(/useLostPassages/);
    expect(source).toMatch(/storedBodyOf\(/);
    expect(source).toMatch(/passageIsLost\(/);
  });
});
