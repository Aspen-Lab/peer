import { describe, expect, it } from "vitest";
import { passageSegments, rangeOf } from "@/components/notes/note-tags";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";
import { anchorHolds, anchorRange } from "./notes";

// P10-36 (rule 2; P10-35's unsettled (e)): a note's range was checked twice — `anchorHolds` in the store and `rangeOf` in
// the paper's marks — and the two had to move together. There is one check now (`anchorRange`): `anchorHolds` is its yes or
// no, `rangeOf` its range. These cases are the edges the two must agree on. Every text is invented.

const TEXT = "Grain boundaries carry the strain when the load is held.";
const MATH = `The load ${MATH_OPEN}x_{1}${MATH_CLOSE} meets it.`;
const spot = (text: string, start: number, end: number, quote = text.slice(start, end).trim()) => ({ start, end, quote });

const CASES: { name: string; text: string; spot: { start: number; end: number; quote: string }; holds: boolean }[] = [
  { name: "the words at the range", text: TEXT, spot: spot(TEXT, 0, 16), holds: true },
  { name: "a quote shorter than the range (the passage is longer than its quote)", text: TEXT, spot: { start: 0, end: 29, quote: "Grain boundaries carry the" }, holds: true },
  { name: "other words under the range", text: TEXT, spot: { start: 0, end: 16, quote: "Creep limits" }, holds: false },
  { name: "an empty range", text: TEXT, spot: { start: 6, end: 6, quote: "" }, holds: false },
  { name: "an inverted range", text: TEXT, spot: { start: 9, end: 3, quote: "ar" }, holds: false },
  { name: "a range of white space only", text: "Grain   boundaries", spot: { start: 5, end: 8, quote: "" }, holds: false },
  { name: "a range that ends at the paragraph's end", text: TEXT, spot: spot(TEXT, 36, TEXT.length), holds: true },
  { name: "a range that runs one past the paragraph's end", text: TEXT, spot: { start: 36, end: TEXT.length + 1, quote: "the load is held." }, holds: false },
  { name: "a range that starts below zero", text: TEXT, spot: { start: -1, end: 5, quote: "Grain" }, holds: false },
  { name: "a range that is not whole numbers", text: TEXT, spot: { start: 0.5, end: 5, quote: "rain" }, holds: false },
  { name: "a whole formula", text: MATH, spot: spot(MATH, 9, 17), holds: true },
  { name: "a range that ends inside a formula", text: MATH, spot: spot(MATH, 4, 14), holds: false },
  { name: "a range that starts inside a formula", text: MATH, spot: spot(MATH, 12, MATH.length), holds: false },
  { name: "the words with the white space of the selection run on", text: TEXT, spot: { start: 0, end: 17, quote: "Grain boundaries" }, holds: true },
];

describe("one range check — anchorHolds, anchorRange and rangeOf say the same thing (P10-36)", () => {
  for (const one of CASES) {
    it(`agrees on ${one.name}`, () => {
      expect(anchorHolds(one.text, one.spot)).toBe(one.holds);
      expect(anchorRange(one.text, one.spot) !== null).toBe(one.holds);
      expect(rangeOf(one.text, { id: "h1", n: 1, ...one.spot }) !== null).toBe(one.holds);
      // the paper draws a mark exactly where the check holds, and only a tag where it does not
      const marks = passageSegments(one.text, [{ id: "h1", n: 1, ...one.spot }]).filter((s) => s.kind === "mark");
      expect(marks.length).toBe(one.holds ? 1 : 0);
    });
  }

  it("gives the range a mark ends at: the white space the selection ran on over is left out", () => {
    expect(anchorRange(TEXT, { start: 0, end: 17, quote: "Grain boundaries" })).toEqual({ start: 0, end: 16 });
    expect(rangeOf(TEXT, { id: "h1", n: 1, start: 0, end: 17, quote: "Grain boundaries" })).toEqual({ start: 0, end: 16 });
  });

  it("has no range for a note that never had one", () => {
    expect(rangeOf(TEXT, { id: "h1", n: 1 })).toBeNull();
    expect(rangeOf(TEXT, { id: "h1", n: 1, start: 0, end: 5 })).toBeNull();
  });
});
