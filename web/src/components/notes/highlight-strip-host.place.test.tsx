import { describe, expect, it } from "vitest";
import type { MarginRect } from "@/lib/reader/margin";
import { STRIP_ONE_ROW_WIDTH_PX, STRIP_ROW_PX, stripStanding } from "./highlight-strip-host";

// P11-49 (round 3, Theme B readers r1 and r2; ruling §1h.149): the strip follows the rules the selection's actions follow. Over a card it covers no control (rule 1: a toolbar's row,
// a card's button, the Explain card's input and Send), the header's free part is a place for it only wholly inside the row — it is 34 px tall, so a 40-px row holds it —
// (rule 2), it takes the nearest clear place the band allows at every left the margin allows (rule 3), and where no card stands at its height it is as it was (rule 4). The strip
// takes `controls` and `words` as the group does; its place is made by the same `clearOfHeaders`. Every number is invented.

type Box = { left: number; top: number; right: number; bottom: number };
type Zone = { box: Box; parts: Box[] };
type Standing = { mode: string; left: number; top: number; width: number; clear?: string } | null;
const sq = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const MARGIN: MarginRect = { left: 1000, width: 280, top: 48, bottom: 860 };
const WIDE: MarginRect = { ...MARGIN, width: 360 };
const VIEW = { width: 1440, height: 900 };
const line = (top: number): Box => sq(400, top, 700, top + 18);
const stand = (mark: Box, over: Record<string, unknown> = {}) => stripStanding({ mark, viewport: VIEW, margin: MARGIN, ...over } as Parameters<typeof stripStanding>[0]) as Standing;
const boxOf = (got: NonNullable<Standing>, wide = STRIP_ONE_ROW_WIDTH_PX): Box => sq(got.left, got.top, got.left + wide, got.top + STRIP_ROW_PX);

describe("stripStanding — no control of a card is covered (P11-49 rule 1; ruling §1h.149)", () => {
  const row = sq(1013, 300, 1267, 340);
  const button = sq(1013, 300, 1027, 314);

  it("stands just below a toolbar's row, not over it, when that is the nearest clear place", () => {
    const got = stand(line(310), { controls: [row, sq(1013, 304, 1045, 336)] })!;
    expect(got).toMatchObject({ mode: "margin", left: 1008, top: 340, width: 264, clear: "below" });
    expect(meets(boxOf(got), row)).toBe(false);
  });

  it("stands level, slid along the margin, beside a card's button: the strip goes round it", () => {
    const got = stand(line(300), { controls: [button] })!;
    expect(got).toEqual({ mode: "margin", left: 1031, top: 300, width: 264, clear: "aside" });
    expect(meets(boxOf(got), button)).toBe(false);
  });

  it("covers no control at any height of the mark, in either margin, whole", () => {
    const controls = [row, button, sq(1130, 560, 1270, 600), sq(1013, 700, 1200, 740)];
    for (const margin of [MARGIN, WIDE]) {
      for (let top = 40; top <= 870; top += 9) {
        const got = stand(line(top), { margin, controls });
        if (got === null || got.clear === "held") continue;
        for (const control of controls) expect(meets(boxOf(got), control), `${top}`).toBe(false);
        expect(got.left).toBeGreaterThanOrEqual(margin.left + 8);
        expect(got.width).toBe(margin.width - 16);
      }
    }
  });
});

describe("stripStanding — the header's free part, whole inside the row (P11-49 rule 2; ruling §1h.149)", () => {
  it("stands in the Explain card's 53-px row when its title is short and the margin is wide: level with the mark, as nearly as the row allows", () => {
    const explainRow: Zone = { box: sq(1000, 291, 1360, 343), parts: [sq(1017, 307, 1053, 343), sq(1065, 317, 1100, 333)] };
    const got = stand(line(300), { margin: WIDE, headers: [explainRow] })!;
    expect(got).toEqual({ mode: "margin", left: 1104, top: 300, width: 344, clear: "free" });
    expect(got.top + STRIP_ROW_PX).toBeLessThanOrEqual(343);
    // A mark in the row's lower part is lifted just enough to stand whole inside it (the move to below the row would be longer).
    expect(stand(line(320), { margin: WIDE, headers: [explainRow] })).toEqual({ mode: "margin", left: 1104, top: 309, width: 344, clear: "free" });
  });

  it("does not stand on a free part too narrow for it: just below the row", () => {
    const explainRow: Zone = { box: sq(1000, 291, 1280, 343), parts: [sq(1017, 307, 1053, 343), sq(1065, 317, 1100, 333)] };
    expect(stand(line(300), { headers: [explainRow] })).toMatchObject({ top: 343, clear: "below" });
  });

  it("never stands half over a header row: a place that meets the row is wholly inside it", () => {
    const rows: Zone[] = [
      { box: sq(1000, 280, 1360, 320), parts: [sq(1012, 292, 1060, 308), sq(1068, 292, 1090, 308), sq(1320, 280, 1360, 320)] },
      { box: sq(1000, 280, 1280, 320), parts: [sq(1012, 292, 1060, 308), sq(1068, 292, 1230, 308), sq(1240, 280, 1280, 320)] },
    ];
    for (const row of rows) {
      for (let top = 240; top <= 340; top += 5) {
        const got = stand(line(top), { margin: row.box.right === 1360 ? WIDE : MARGIN, headers: [row] })!;
        if (got.clear === "held") continue;
        const box = boxOf(got);
        if (!meets(box, row.box)) continue;
        expect(box.left >= row.box.left && box.right <= row.box.right && box.top >= row.box.top && box.bottom <= row.box.bottom, `${top}`).toBe(true);
      }
    }
  });
});

describe("stripStanding — the nearest clear place, and the words (P11-49 rules 2 and 3; ruling §1h.149)", () => {
  it("stands above a card's control beside another when above is nearer: the left is found at the top above too", () => {
    const toolbar = sq(1013, 300, 1267, 340);
    const link = sq(1013, 240, 1060, 256);
    const got = stand(line(318), { controls: [toolbar, link] })!;
    // Below the row is 22 px from the mark; above it is 52: below, level with the margin's edge.
    expect(got).toMatchObject({ top: 340, left: 1008, clear: "below" });
    const up = stand(line(302), { controls: [toolbar, link] })!;
    // Above the row (266) is 36 px from a mark at 302, below it (340) is 38: above, and the link above it is slid past.
    expect(up).toMatchObject({ top: 300 - 34, clear: "above" });
    expect(meets(boxOf(up), link)).toBe(false);
  });

  it("covers the fewest of the card's words over the body: level with the mark, slid to where the lines leave the most room", () => {
    const words = [sq(1010, 296, 1200, 312)];
    const got = stand(line(300), { words })!;
    expect(got).toEqual({ mode: "margin", left: 1056, top: 300, width: 264, clear: "aside" });
  });

  it("keeps the margin's left edge where there are no words to avoid, and where it would save less than half a word", () => {
    expect(stand(line(300), { words: [sq(1010, 296, 1272, 312)] })).toEqual({ mode: "margin", left: 1008, top: 300, width: 264 });
  });
});

describe("stripStanding — as it was where no card stands at its height (P11-49 rule 4; ruling §1h.149)", () => {
  const far = { headers: [{ box: sq(1000, 600, 1280, 640), parts: [sq(1012, 612, 1060, 628)] }], controls: [sq(1013, 650, 1267, 690)], words: [sq(1010, 700, 1270, 716)] };

  it("is the margin's left edge and the mark's top, with no key of the place added, byte for byte", () => {
    for (const top of [60, 150, 300, 420, 520]) {
      expect(stand(line(top), far), String(top)).toEqual({ mode: "margin", left: 1008, top, width: 264 });
      expect(stand(line(top)), String(top)).toEqual({ mode: "margin", left: 1008, top, width: 264 });
    }
  });

  it("keeps B2's floor: near the band's foot the strip rises just enough to stand whole, and goes with its mark", () => {
    expect(stand(line(850), far)?.top).toBe(860 - STRIP_ROW_PX);
    expect(stand({ left: 400, top: 1801, right: 700, bottom: 1819 }, far)).toBeNull();
  });
});
