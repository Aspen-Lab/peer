import { describe, expect, it } from "vitest";
import { carriesPaper, gapAt, PAPER_DRAG, readPaperDrag, writePaperDrag } from "./drag";
import type { Citable } from "./types";

/** jsdom has no DataTransfer; a drag only needs these three. */
function transfer(data: Record<string, string> = {}): DataTransfer {
  const store = { ...data };
  return {
    get types() {
      return Object.keys(store);
    },
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? "",
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

const PAPER: Citable = {
  id: "openalex:W2093274439",
  title: "Research electronic data capture (REDCap)",
  authors: ["Paul A. Harris", "Robert Taylor"],
  venue: "Journal of Biomedical Informatics",
  publishedDate: "2009-04-01",
  doi: "10.1016/j.jbi.2008.08.010",
};

describe("carrying a paper", () => {
  it("goes out and comes back whole", () => {
    const dt = transfer();
    writePaperDrag(dt, PAPER);
    expect(carriesPaper(dt)).toBe(true);
    expect(readPaperDrag(dt)).toEqual({ ...PAPER, abstract: undefined });
  });

  it("also writes the title, for whatever else takes a drop", () => {
    const dt = transfer();
    writePaperDrag(dt, PAPER);
    expect(dt.getData("text/plain")).toBe(PAPER.title);
  });

  it("knows a drag that is not ours", () => {
    const dt = transfer({ "text/plain": "some words", "Files": "" });
    expect(carriesPaper(dt)).toBe(false);
    expect(readPaperDrag(dt)).toBeNull();
    expect(carriesPaper(null)).toBe(false);
  });

  it("refuses a payload it cannot cite", () => {
    // Nothing here was written by us: a page can put any string under any
    // type. A record with no id or no title is not a paper.
    expect(readPaperDrag(transfer({ [PAPER_DRAG]: "{" }))).toBeNull();
    expect(readPaperDrag(transfer({ [PAPER_DRAG]: '"a string"' }))).toBeNull();
    expect(readPaperDrag(transfer({ [PAPER_DRAG]: '{"title":"No id"}' }))).toBeNull();
    expect(readPaperDrag(transfer({ [PAPER_DRAG]: '{"id":"x"}' }))).toBeNull();
  });

  it("drops the fields it cannot use rather than the paper", () => {
    const dt = transfer({
      [PAPER_DRAG]: JSON.stringify({ id: "x", title: "A paper", authors: ["Real", 7], venue: 12 }),
    });
    expect(readPaperDrag(dt)).toMatchObject({ id: "x", title: "A paper", authors: ["Real"], venue: undefined });
  });
});

describe("the gap under the pointer", () => {
  const row = (top: number, height = 20): HTMLElement =>
    ({ getBoundingClientRect: () => ({ top, height }) }) as unknown as HTMLElement;
  const rows = [row(0), row(20), row(40)];

  it("is the gap before the row the pointer is in the top half of", () => {
    expect(gapAt(rows, 5)).toBe(0);
    expect(gapAt(rows, 25)).toBe(1);
    expect(gapAt(rows, 45)).toBe(2);
  });

  it("is the gap after a row when the pointer is past its middle", () => {
    expect(gapAt(rows, 15)).toBe(1);
    expect(gapAt(rows, 35)).toBe(2);
  });

  it("is the end of the document below every row", () => {
    expect(gapAt(rows, 400)).toBe(3);
    expect(gapAt([], 10)).toBe(0);
  });
});
