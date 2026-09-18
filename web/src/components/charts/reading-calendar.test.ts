import { describe, expect, it } from "vitest";
import { CAL_DAYS, FUTURE, cellsFromCounts, daysRead, streakWeeks } from "./reading-calendar";

// Thursday 17 September 2026, mid-afternoon UTC.
const THURSDAY = Date.UTC(2026, 8, 17, 15, 0, 0);
const at = (w: number, d: number) => w * CAL_DAYS + d;

describe("cellsFromCounts", () => {
  it("puts today in its own weekday's row, not always in the bottom one", () => {
    // The grid used to end on today in the bottom row whatever day it was, so
    // on a Thursday the row the profile labels "Mon" was a Saturday.
    const cells = cellsFromCounts(new Map([["2026-09-17", 3]]), 2, THURSDAY);
    expect(cells[at(1, 4)]).toBe(3); // Sunday is row 0, Thursday row 4
  });

  it("marks the rest of the week in progress as future", () => {
    const cells = cellsFromCounts(new Map(), 2, THURSDAY);
    expect(cells[at(1, 5)]).toBe(FUTURE); // Friday the 18th
    expect(cells[at(1, 6)]).toBe(FUTURE); // Saturday the 19th
    expect(cells[at(1, 4)]).toBe(0); // today, nothing read yet
  });

  it("keeps the labelled rows on their weekdays", () => {
    // Row 1 is Monday in every column — here the 7th and the 14th.
    const cells = cellsFromCounts(
      new Map([
        ["2026-09-07", 1],
        ["2026-09-14", 2],
      ]),
      2,
      THURSDAY,
    );
    expect(cells[at(0, 1)]).toBe(1);
    expect(cells[at(1, 1)]).toBe(2);
  });

  it("does not count days that have not happened", () => {
    const cells = cellsFromCounts(new Map([["2026-09-17", 1]]), 2, THURSDAY);
    expect(daysRead(cells)).toBe(1);
  });
});

describe("streakWeeks", () => {
  const weeksOf = (active: boolean[]) =>
    active.flatMap((on) => [on ? 1 : 0, 0, 0, 0, 0, 0, 0]);

  it("counts consecutive weeks back from this one", () => {
    expect(streakWeeks(weeksOf([false, true, true]), 3)).toBe(2);
  });

  it("does not let the week in progress break it before anything is read", () => {
    // Sunday morning: the new week is a day old and empty so far.
    expect(streakWeeks(weeksOf([true, true, false]), 3)).toBe(2);
  });

  it("is broken by a finished week with nothing in it", () => {
    expect(streakWeeks(weeksOf([true, false, false]), 3)).toBe(0);
  });
});
