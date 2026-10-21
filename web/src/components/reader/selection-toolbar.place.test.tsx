import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as toolbarModule from "./selection-toolbar";
import { SelectionToolbarView, actionsPlace, toolbarPlace } from "./selection-toolbar";
import { MARGIN_CARD_SELECTOR, placeInMargin, type MarginRect } from "@/lib/reader/margin";

// P11-49 (round 3, Theme B readers r1 and r2; ruling §1h.149): over a card the group covers no control and as few of the card's words as it can.
//
//   rule 1  No control of a card is covered, wherever it stands: the header row, the notes window's formatting row, a sticky's buttons, the figure's zoom row, the Explain
//           card's input and its buttons. A card's controls are read from the page by what an element is (buttons, links, fields, a toolbar), not from a list of selectors.
//   rule 2  The header's free part is a place only if the whole group fits inside the header row (an 88-px group does not fit a 40-px row; the strip does). Otherwise the
//           candidates are just above the header, just below it (below the last of a stack) and level over the card's body where that covers no control: the smallest move
//           from the line wins, and over the body the place that covers the fewest of the card's words.
//   rule 3  The move is the nearest clear place the band allows: every top a place can begin at, at every left the margin allows.
//   rule 4  Nothing else changes: the level place with no card at that height is byte for byte as it was, and so are B2's floor, a window under 1024 px and P11-38's rule 1.
//
// The new reader and the new inputs are reached through the module's namespace, so the suite type-checks against the code as it stood before the rules.
// Every number is invented.

type Box = { left: number; top: number; right: number; bottom: number };
type Zone = { box: Box; parts: Box[] };
type Cleared = { left: number; top: number; how: string };
type Size = { width: number; height: number };
type Obstacles = { headers: Zone[]; controls: Box[]; words: Box[] };
type Input = { margin: MarginRect; size: Size; left: number; top: number; headers: readonly Zone[]; controls?: readonly Box[]; words?: readonly Box[] };
const api = toolbarModule as unknown as {
  clearOfHeaders: (input: Input) => Cleared;
  readCardObstacles?: (root: unknown) => Obstacles;
  CONTROL_SELECTOR?: string;
};

const MARGIN: MarginRect = { left: 1080, width: 360, top: 48, bottom: 960 };
const GROUP: Size = { width: 112, height: 90 };
const STRIP: Size = { width: 216, height: 34 };
const LEFT = MARGIN.left + 8;
const sq = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const sized = (box: Box) => ({ ...box, width: box.right - box.left, height: box.bottom - box.top });
const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const boxOf = (spot: { left: number; top: number }, size: Size = GROUP): Box => sq(spot.left, spot.top, spot.left + size.width, spot.top + size.height);
const put = (over: Partial<Input> = {}) => api.clearOfHeaders({ margin: MARGIN, size: GROUP, left: LEFT, top: 400, headers: [], ...over });
/** The words of a card the group covers, in px² of their line boxes (what the place minimises). */
const under = (spot: { left: number; top: number }, words: readonly Box[], size: Size = GROUP) =>
  words.reduce((sum, w) => sum + Math.max(0, Math.min(boxOf(spot, size).right, w.right) - Math.max(spot.left, w.left)) * Math.max(0, Math.min(boxOf(spot, size).bottom, w.bottom) - Math.max(spot.top, w.top)), 0);

// ── The cards, as the page draws them (invented numbers, 1440 x 900) ─────────────────────────────────────────────────────
const notesHeader: Zone = { box: sq(1080, 48, 1440, 88), parts: [sq(1097, 60, 1183, 76), sq(1191, 56, 1298, 80), sq(1314, 56, 1391, 80), sq(1399, 52, 1431, 84)] };
/** The notes window's formatting row (B I U H </> H2 bullets numbers), 40 px tall, under its header. */
const formatRow = sq(1093, 89, 1427, 129);
const formatButtons = [sq(1093, 93, 1125, 125), sq(1129, 93, 1161, 125), sq(1165, 93, 1197, 125)];
/** The Explain card's top row (the X and the title), from the card's top (300) to the row's foot (353). */
const explainRow: Zone = { box: sq(1080, 300, 1440, 353), parts: [sq(1097, 316, 1133, 353), sq(1145, 326, 1226, 342)] };
/** The link in the Explain card's quote line, and its input row at the card's foot. */
const quoteLink = sq(1117, 388, 1199, 404);
const input = sq(1093, 808, 1366, 846);
const send = sq(1374, 812, 1428, 846);
/** A sticky's "Go to the passage" square, at the start of its text. */
const goTo = sq(1093, 312, 1107, 326);
const stickyHeader: Zone = { box: sq(1080, 380, 1440, 420), parts: [sq(1092, 392, 1140, 408), sq(1148, 392, 1190, 408), sq(1400, 380, 1440, 420)] };

describe("clearOfHeaders — no control of a card is covered (P11-49 rule 1; ruling §1h.149)", () => {
  it("stands just below the notes window's formatting row, not over it: the row is a control, and the header above it is nowhere near the group", () => {
    const got = put({ headers: [notesHeader], controls: [formatRow, ...formatButtons], top: 100 });
    expect(got).toEqual({ left: LEFT, top: 129, how: "below" });
    for (const control of [formatRow, ...formatButtons]) expect(meets(boxOf(got), control)).toBe(false);
  });

  it("stands level, slid along the margin, beside a sticky's button when that is the nearest clear place: its square is a control, and the group goes round it", () => {
    expect(put({ controls: [goTo], top: 300 })).toEqual({ left: goTo.right + 4, top: 300, how: "aside" });
    expect(put({ controls: [goTo], top: 330 })).toEqual({ left: LEFT, top: 330, how: "level" });
  });

  it("stands above the Explain card's input and Send when no left clears them and above is nearer, below when below is", () => {
    const above = put({ controls: [input, send], top: 780 });
    expect(above).toEqual({ left: LEFT, top: 808 - GROUP.height, how: "above" });
    const below = put({ controls: [input, send], top: 830 });
    expect(below).toEqual({ left: LEFT, top: 846, how: "below" });
    for (const got of [above, below]) for (const control of [input, send]) expect(meets(boxOf(got), control), got.how).toBe(false);
  });

  it("stands level, slid right of the link in the Explain card's quote line, with the line at the link's height", () => {
    expect(put({ controls: [quoteLink], top: 380 })).toEqual({ left: quoteLink.right + 4, top: 380, how: "aside" });
  });

  it("covers no control at any height of the line, wherever the control stands — in the band, in the margin, whole", () => {
    const controls = [formatRow, ...formatButtons, goTo, quoteLink, sq(1330, 560, 1430, 600), input, send];
    for (let top = 52; top <= 870; top += 7) {
      const got = put({ headers: [notesHeader, explainRow], controls, top });
      if (got.how === "held") continue;
      for (const control of controls) expect(meets(boxOf(got), control), `${top}: ${got.how}`).toBe(false);
      expect(got.left).toBeGreaterThanOrEqual(LEFT);
      expect(got.left + GROUP.width).toBeLessThanOrEqual(MARGIN.left + MARGIN.width - 8);
      expect(got.top).toBeGreaterThanOrEqual(MARGIN.top);
      expect(got.top + GROUP.height).toBeLessThanOrEqual(MARGIN.bottom);
    }
  });

  it("is `actionsPlace`'s too: the controls go through, the place says how it cleared them, and the pill above the selection is as it was", () => {
    const place = (over: Record<string, unknown>) =>
      actionsPlace({ bounds: { left: 300, top: 300, right: 520, bottom: 322 }, viewport: { width: 1440, height: 1000 }, margin: MARGIN, sizes: { margin: GROUP, above: { width: 285, height: 32 } }, ...over } as never) as
        | (ReturnType<typeof actionsPlace> & { clear?: string })
        | null;
    expect(place({ controls: [goTo] })).toEqual({ mode: "margin", left: goTo.right + 4, top: 300, below: false, clear: "aside" });
    const pill = { mode: "above", ...toolbarPlace({ bounds: { left: 300, top: 300, right: 520, bottom: 322 }, viewport: { width: 1440, height: 1000 }, size: { width: 285, height: 32 } })! };
    expect(place({ margin: null, controls: [goTo], words: [sq(300, 280, 500, 300)] })).toEqual(pill);
  });
});

describe("clearOfHeaders — a header's free part is a place only where the whole group fits (P11-49 rule 2; ruling §1h.149)", () => {
  it("does not stand on a 40-px header's free part: the group is 90 tall, so it stands just below the header, whatever the line, however much room the row leaves", () => {
    for (const line of [380, 390, 400, 410]) {
      const got = put({ headers: [stickyHeader], top: line });
      expect(got, String(line)).toEqual({ left: LEFT, top: 420, how: "below" });
    }
  });

  it("does not stand on the Explain card's 53-px row either, though its title is short and leaves the row's whole right side free", () => {
    const short: Zone = { box: explainRow.box, parts: [sq(1097, 316, 1133, 353), sq(1145, 326, 1180, 342)] };
    for (const line of [310, 320, 340]) {
      const got = put({ headers: [short], top: line });
      expect(got.how, String(line)).toBe("below");
      expect(got.top, String(line)).toBe(353);
    }
  });

  it("stands on the free part of a row that holds it whole: a 120-px row, level with the line, beside what the row's text and controls hold", () => {
    const tall: Zone = { box: sq(1080, 380, 1440, 500), parts: [sq(1092, 392, 1140, 408), sq(1400, 380, 1440, 420)] };
    const got = put({ headers: [tall], top: 400 });
    expect(got).toEqual({ left: 1144, top: 400, how: "free" });
    expect(boxOf(got).bottom).toBeLessThanOrEqual(tall.box.bottom);
    // …and moves the least that puts it wholly inside the row: a line near the row's foot lifts it just enough.
    expect(put({ headers: [tall], top: 440 })).toEqual({ left: LEFT, top: 410, how: "free" });
  });

  it("lets the strip stand on a 40-px header's free part: it is 34 tall, so the nearest top wholly inside the row, level with the line as nearly as the row allows", () => {
    const row: Zone = { box: sq(1000, 280, 1360, 320), parts: [sq(1012, 292, 1060, 308), sq(1068, 292, 1090, 308), sq(1320, 280, 1360, 320)] };
    const at = (top: number) => api.clearOfHeaders({ margin: { left: 1000, width: 360, top: 48, bottom: 860 }, size: STRIP, left: 1008, top, headers: [row] });
    expect(at(300)).toEqual({ left: 1094, top: 286, how: "free" });
    expect(at(282)).toEqual({ left: 1094, top: 282, how: "free" });
    expect(at(270)).toEqual({ left: 1094, top: 280, how: "free" });
  });

  it("never stands half over a header row: a place that meets the row is wholly inside it, whatever the line", () => {
    const rows: Zone[] = [stickyHeader, explainRow, notesHeader, { box: sq(1080, 380, 1440, 500), parts: [sq(1092, 392, 1140, 408)] }];
    for (const row of rows) {
      for (let top = 300; top <= 520; top += 11) {
        const got = put({ headers: [row], top });
        if (got.how === "held") continue;
        const box = boxOf(got);
        if (!meets(box, row.box)) continue;
        expect(box.left >= row.box.left && box.right <= row.box.right && box.top >= row.box.top && box.bottom <= row.box.bottom, `${top}`).toBe(true);
        expect(row.parts.some((part) => meets(box, { ...part, left: part.left - 4, right: part.right + 4 })), `${top}`).toBe(false);
      }
    }
  });

  it("takes the smallest move from the line among just above, just below and level over the body: words do not buy a longer move", () => {
    // The Explain card's row (300–353), its quote under it; the line at 320. Above the row is 110 px away and covers no word; below is 33 and covers the quote's words.
    const quote = [sq(1097, 365, 1424, 381), sq(1097, 385, 1424, 401), sq(1097, 405, 1200, 421)];
    const got = put({ headers: [explainRow], words: quote, top: 320 });
    expect(got.how).toBe("below");
    expect(got.top).toBe(353);
    // A line at the quote's height stands level over it.
    expect(put({ headers: [explainRow], words: quote, top: 380 }).top).toBe(380);
  });

  it("covers the fewest of the card's words over the body: level with the line, the left that leaves the most of them uncovered, over the nearer to the margin's edge", () => {
    // Three lines of a quote, the last shorter: at the margin's left edge the group covers all three; to the right of them, none.
    const words = [sq(1097, 365, 1300, 381), sq(1097, 385, 1300, 401), sq(1097, 405, 1200, 421)];
    const before = under({ left: LEFT, top: 353 }, words);
    const got = put({ words, top: 353 });
    expect(got).toEqual({ left: 1300 + 4, top: 353, how: "aside" });
    expect(under(got, words)).toBeLessThan(before);
    expect(under(got, words)).toBe(0);
  });

  it("keeps the margin's left edge where moving would save less than about half a word, so the group does not wander along the margin as the lines pass under it", () => {
    const full = [sq(1097, 365, 1424, 381), sq(1097, 385, 1424, 401), sq(1097, 405, 1424, 421)];
    expect(put({ words: full, top: 353 })).toEqual({ left: LEFT, top: 353, how: "level" });
    // One line a few pixels shorter on the left side only changes the sums by a few hundred px².
    const ragged = [sq(1097, 365, 1424, 381), sq(1097, 385, 1424, 401), sq(1097, 405, 1415, 421)];
    expect(put({ words: ragged, top: 353 })).toEqual({ left: LEFT, top: 353, how: "level" });
  });
});

describe("clearOfHeaders — the move is the nearest clear place the band allows (P11-49 rule 3; ruling §1h.149)", () => {
  it("stands below the Explain card's row and beside its quote's link when that is nearest: the left is found at the top it is wanted at, not only at the margin's edge", () => {
    const got = put({ headers: [explainRow], controls: [quoteLink], top: 320 });
    expect(got).toEqual({ left: quoteLink.right + 4, top: 353, how: "below" });
    expect(meets(boxOf(got), quoteLink)).toBe(false);
  });

  it("stands above a header, beside a control, when above is nearer: the control's side is found at the top above the header too", () => {
    const header: Zone = { box: sq(1080, 440, 1440, 480), parts: [sq(1092, 452, 1140, 468), sq(1148, 452, 1330, 468), sq(1400, 440, 1440, 480)] };
    const link = sq(1100, 350, 1190, 366);
    const got = put({ headers: [header], controls: [link], top: 400 });
    expect(got).toEqual({ left: 1194, top: 440 - GROUP.height, how: "above" });
  });

  it("slides to touch a control rather than move a whole group's height: a gap too narrow for the margin of a few pixels is still a clear place", () => {
    const left = sq(1090, 380, 1130, 420);
    const right = sq(1242, 380, 1432, 420);
    const got = put({ controls: [left, right], top: 380 });
    expect(got).toEqual({ left: 1130, top: 380, how: "aside" });
    expect(meets(boxOf(got), left) || meets(boxOf(got), right)).toBe(false);
  });

  it("takes the nearest top that a control or a header makes, not only a header's edge: below the notes window's row, not below its header", () => {
    // The line at 60 is inside the header (48–88): just below the header would cover the formatting row; the nearest clear place is under the row.
    const got = put({ headers: [notesHeader], controls: [formatRow], top: 60 });
    expect(got).toEqual({ left: LEFT, top: 129, how: "below" });
  });

  it("goes below when above and below are as near, and stays inside the band", () => {
    const header: Zone = { box: sq(1080, 440, 1440, 480), parts: [sq(1092, 452, 1140, 468)] };
    expect(put({ headers: [header], top: 415 })).toEqual({ left: LEFT, top: 480, how: "below" });
    // No room below in the band: above.
    const low: Zone = { box: sq(1080, 900, 1440, 940), parts: [sq(1092, 912, 1140, 928)] };
    expect(put({ headers: [low], top: 880 })).toEqual({ left: LEFT, top: 900 - GROUP.height, how: "above" });
    // No room above in the band: below.
    const high: Zone = { box: sq(1080, 60, 1440, 100), parts: [sq(1092, 72, 1140, 88)] };
    expect(put({ headers: [high], top: 70 })).toEqual({ left: LEFT, top: 100, how: "below" });
  });

  it("is held, saying so, only where no place in the band is clear", () => {
    const wall = sq(1080, 48, 1440, 960);
    const got = put({ controls: [wall] });
    expect(got).toEqual({ left: LEFT, top: 400, how: "held" });
  });

  // The cases the round's readers measured an excess in, and why no nearer place is clear. The figure card at the band's top and a stack of three: the headers' rows and the
  // zoom row stand from the card's top down; the group does not fit one of them, and a place that meets a row is not whole inside it, so the nearest is under the last row.
  it("stands under the figure card's zoom row at the band's top, 50 px from the line: the places between are over its header and its zoom row, which the group does not fit", () => {
    const figureHeader: Zone = { box: sq(1081, 49, 1439, 89), parts: [sq(1093, 61, 1154, 76), sq(1399, 49, 1439, 89)] };
    const zoomRow: Zone = { box: sq(1081, 89, 1439, 125), parts: [sq(1089, 94, 1122, 122), sq(1190, 94, 1223, 122), sq(1235, 94, 1282, 122)] };
    const got = put({ headers: [figureHeader, zoomRow], top: 75 });
    expect(got).toEqual({ left: LEFT, top: 125, how: "below" });
  });

  it("stands under the last of a stack of three cards' headers and the zoom row, 207 px from the line at the band's top: nothing is nearer that is clear", () => {
    const rows: Zone[] = [
      { box: sq(1007, 126, 1366, 166), parts: [sq(1009, 128, 1045, 164), sq(1057, 138, 1148, 153)] },
      { box: sq(1007, 166, 1365, 206), parts: [sq(1019, 178, 1065, 193), sq(1325, 166, 1365, 206)] },
      { box: sq(1007, 206, 1365, 246), parts: [sq(1019, 218, 1080, 233), sq(1325, 206, 1365, 246)] },
      { box: sq(1007, 246, 1365, 282), parts: [sq(1015, 251, 1048, 279), sq(1116, 251, 1149, 279), sq(1161, 251, 1208, 279)] },
    ];
    const margin: MarginRect = { left: 1006, width: 360, top: 48, bottom: 728 };
    const got = api.clearOfHeaders({ margin, size: GROUP, left: 1014, top: 75, headers: rows });
    expect(got).toEqual({ left: 1014, top: 282, how: "below" });
  });
});

// A scene's own oracle, written without the code's helpers: a place is clear when it meets no control and meets a header row only whole inside it, clear of what the row holds
// (a few pixels horizontally); `nearest` scans every top and every integer left, by distance from the line.
describe("clearOfHeaders — no clear place is nearer than the one it takes (P11-49 rule 3: a property over invented scenes)", () => {
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const clearAt = (box: Box, headers: readonly Zone[], controls: readonly Box[]) => {
    if (controls.some((control) => meets(box, control))) return false;
    for (const zone of headers) {
      if (!meets(box, zone.box)) continue;
      const inside = box.left >= zone.box.left && box.right <= zone.box.right && box.top >= zone.box.top && box.bottom <= zone.box.bottom;
      if (!inside) return false;
      if (zone.parts.some((part) => meets(box, { ...part, left: part.left - 4, right: part.right + 4 }))) return false;
    }
    return true;
  };

  it("holds for 160 scenes of headers, parts and controls, for the group and for the strip, in two margins", () => {
    const rand = seeded(49);
    const int = (low: number, high: number) => low + Math.floor(rand() * (high - low + 1));
    let scenes = 0;
    let held = 0;
    for (let scene = 0; scene < 160; scene++) {
      const margin: MarginRect = scene % 2 === 0 ? MARGIN : { left: 744, width: 280, top: 48, bottom: 700 };
      const size = scene % 3 === 0 ? STRIP : GROUP;
      const headers: Zone[] = [];
      const controls: Box[] = [];
      for (let n = int(0, 3); n > 0; n--) {
        const top = int(margin.top, margin.bottom - 60);
        const height = int(30, 56);
        const box = sq(margin.left, top, margin.left + margin.width, top + height);
        const parts: Box[] = [];
        for (let p = int(1, 3); p > 0; p--) {
          const left = int(box.left + 8, box.right - 60);
          parts.push(sq(left, box.top + 6, Math.min(box.right, left + int(20, 120)), box.bottom - 6));
        }
        headers.push({ box, parts });
      }
      for (let n = int(0, 5); n > 0; n--) {
        const left = int(margin.left, margin.left + margin.width - 20);
        const top = int(margin.top, margin.bottom - 20);
        controls.push(sq(left, top, Math.min(margin.left + margin.width, left + int(14, 150)), top + int(14, 60)));
      }
      const top = int(margin.top, margin.bottom - size.height);
      const left = margin.left + 8;
      const got = api.clearOfHeaders({ margin, size, left, top, headers, controls });
      scenes += 1;
      const lowest = margin.left + 8;
      const highest = Math.max(lowest, margin.left + margin.width - 8 - size.width);
      // The oracle: the nearest top (by distance from the line) with any integer left clear, in the band.
      let nearest: number | null = null;
      for (let delta = 0; delta <= margin.bottom - margin.top && nearest === null; delta++) {
        for (const y of delta === 0 ? [top] : [top + delta, top - delta]) {
          if (y < margin.top || y + size.height > margin.bottom) continue;
          for (let x = lowest; x <= highest; x++) if (clearAt(sq(x, y, x + size.width, y + size.height), headers, controls)) nearest = delta;
          if (nearest !== null) break;
        }
      }
      if (nearest === null) {
        held += 1;
        expect(got.how, `scene ${scene}`).toBe("held");
        continue;
      }
      expect(got.how, `scene ${scene}`).not.toBe("held");
      expect(clearAt(boxOf(got, size), headers, controls), `scene ${scene}: the place is clear`).toBe(true);
      expect(got.left, `scene ${scene}`).toBeGreaterThanOrEqual(lowest);
      expect(got.left, `scene ${scene}`).toBeLessThanOrEqual(highest);
      expect(Math.abs(got.top - top), `scene ${scene}: the move is the nearest (${nearest})`).toBeLessThanOrEqual(nearest);
    }
    expect(scenes).toBe(160);
    expect(held).toBeLessThan(40);
  });
});

// ── Rule 4: nothing else changes ─────────────────────────────────────────────────────────────────────────────────────────
describe("the place is as it was where no card is at its height (P11-49 rule 4; ruling §1h.149)", () => {
  const far = { headers: [{ box: sq(1080, 700, 1440, 740), parts: [sq(1092, 712, 1140, 728)] }], controls: [sq(1093, 750, 1427, 790), sq(1093, 800, 1200, 830)], words: [sq(1097, 840, 1424, 856), sq(1097, 900, 1424, 916)] };

  it("is the margin's left edge and the line's top, `level`, byte for byte, with cards standing above and below the group's reach", () => {
    for (const top of [60, 120, 200, 300, 420, 520, 600]) {
      expect(put({ ...far, top }), String(top)).toEqual({ left: LEFT, top, how: "level" });
      expect(Object.keys(put({ ...far, top })).sort()).toEqual(["how", "left", "top"]);
    }
  });

  it("is `actionsPlace`'s level place, with no key of the place added", () => {
    const place = (bounds: Box, over: Record<string, unknown> = {}) =>
      actionsPlace({ bounds, viewport: { width: 1440, height: 1000 }, margin: MARGIN, sizes: { margin: GROUP, above: { width: 285, height: 32 } }, ...over } as never);
    expect(place(sq(300, 400, 520, 422), far)).toEqual({ mode: "margin", left: LEFT, top: 400, below: false });
    expect(place(sq(300, 400, 520, 422))).toEqual({ mode: "margin", left: LEFT, top: 400, below: false });
  });

  it("keeps B2's floor: near the band's foot the group rises just enough to stand whole, with cards above it", () => {
    const place = actionsPlace({ bounds: sq(300, 940, 520, 962), viewport: { width: 1440, height: 1000 }, margin: MARGIN, sizes: { margin: GROUP, above: { width: 285, height: 32 } }, ...far } as never)!;
    expect(place.top).toBe(MARGIN.bottom - GROUP.height);
    expect(place.top).toBe(placeInMargin(MARGIN, 940, GROUP.height));
    expect(place.mode).toBe("margin");
  });

  it("says how it cleared a card on its element, `aside` included, and nothing when it stands level", () => {
    const view = (place: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(SelectionToolbarView, { place, canExplain: true, onExplain: () => {}, onTakeNote: () => {}, onHighlight: () => {} } as never));
    expect(view({ mode: "margin", left: 1111, top: 300, below: false, clear: "aside" })).toContain('data-header-clear="aside"');
    expect(view({ mode: "margin", left: 1088, top: 300, below: false })).not.toContain("data-header-clear");
  });

  it("is the pill above the selection under 1024 px, whatever the page holds", () => {
    const bounds = sq(300, 400, 520, 422);
    const pill = { mode: "above", ...toolbarPlace({ bounds, viewport: { width: 1000, height: 800 }, size: { width: 285, height: 32 } })! };
    const got = actionsPlace({ bounds, viewport: { width: 1000, height: 800 }, margin: null, sizes: { margin: GROUP, above: { width: 285, height: 32 } }, headers: [stickyHeader], controls: [sq(300, 380, 520, 440)], words: [sq(300, 400, 520, 422)] } as never);
    expect(got).toEqual(pill);
  });
});

// ── Rule 1, the page's side: what a card's controls are, read from the DOM ───────────────────────────────────────────────
// The fakes below carry what the reader asks of an element — its tag and role, its text, its rects and its computed style — and nothing else.
describe("readCardObstacles — a card's controls and words, read from the page by what they are (P11-49 rule 1)", () => {
  type Spec = { tag: string; box: Box; text?: string; role?: string; style?: Record<string, string>; lines?: Box[]; kids?: Spec[] };
  type Fake = Record<string, unknown> & { children: Fake[] };
  const make = (spec: Spec, parent: Fake | null, doc: unknown): Fake => {
    const node: Fake = {
      tagName: spec.tag.toUpperCase(),
      parentElement: parent,
      ownerDocument: doc,
      __style: spec.style ?? {},
      __role: spec.role ?? null,
      children: [],
      childNodes: [],
      textContent: "",
      getBoundingClientRect: () => sized(spec.box),
      getClientRects: () => (spec.lines ?? [spec.box]).map(sized),
      getAttribute: (name: string) => (name === "role" ? (spec.role ?? null) : null),
      querySelector: (selector: string) => (selector === "svg" ? (find(node, (n) => String(n.tagName) === "SVG") ?? null) : null),
    };
    const own = spec.text ? [{ nodeType: 3, nodeValue: spec.text, __lines: spec.lines ?? [spec.box] }] : [];
    node.children = (spec.kids ?? []).map((kid) => make(kid, node, doc));
    node.childNodes = [...own, ...node.children.map(() => ({ nodeType: 1, nodeValue: null }))];
    node.textContent = [spec.text ?? "", ...node.children.map((kid) => String(kid.textContent))].join("");
    return node;
  };
  const find = (node: Fake, test: (n: Fake) => boolean): Fake | undefined => {
    for (const kid of node.children) {
      if (test(kid)) return kid;
      const deeper = find(kid, test);
      if (deeper) return deeper;
    }
    return undefined;
  };
  const all = (node: Fake, into: Fake[] = []): Fake[] => {
    for (const kid of node.children) {
      into.push(kid);
      all(kid, into);
    }
    return into;
  };
  const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const ROLES = new Set(["button", "toolbar", "link", "menuitem", "tab", "switch", "checkbox", "radio", "slider", "combobox"]);
  const asked: string[] = [];
  const card = (kind: string, box: Box, kids: Spec[]): Fake => {
    const doc = {
      createRange: () => {
        let of: { __lines?: Box[] } | null = null;
        return { selectNodeContents: (node: { __lines?: Box[] }) => void (of = node), getBoundingClientRect: () => sized(sq(0, 0, 0, 0)), getClientRects: () => (of?.__lines ?? []).map(sized) };
      },
      defaultView: { getComputedStyle: (element: { __style?: Record<string, string> }) => ({ overflowX: "visible", overflowY: "visible", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", borderTopWidth: "0px", borderTopStyle: "none", borderTopColor: "rgba(0, 0, 0, 0)", ...element.__style }) },
    };
    const root = make({ tag: "section", box, style: { overflowX: "hidden", overflowY: "hidden" }, kids }, null, doc);
    Object.assign(root, {
      getAttribute: (name: string) => (name === "data-margin-card" ? kind : null),
      firstElementChild: root.children[0] ?? null,
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return all(root).filter((n) => INTERACTIVE.has(String(n.tagName)) || ROLES.has(String(n.__role)));
      },
    });
    return root;
  };
  const read = (...cards: Fake[]) => api.readCardObstacles!({ querySelectorAll: () => cards });
  const header = (box: Box, kids: Spec[]): Spec => ({ tag: "div", box, kids });
  const BODY_STYLE = { overflowX: "hidden", overflowY: "auto" };

  it("reads the notes window's formatting row, its buttons and a block's handle, and leaves out the header's own controls, a button that is only a hit area and a button scrolled out of sight", () => {
    const notes = card("notes", sq(1080, 48, 1440, 354), [
      header(sq(1080, 48, 1440, 89), [
        { tag: "button", box: sq(1081, 48, 1399, 88), kids: [{ tag: "span", box: sq(1097, 60, 1183, 76), text: "Your notes" }] },
        { tag: "button", box: sq(1399, 52, 1431, 84), text: "×" },
      ]),
      {
        tag: "div",
        box: sq(1081, 89, 1439, 320),
        style: BODY_STYLE,
        kids: [
          { tag: "div", role: "toolbar", box: formatRow, kids: formatButtons.map((box, n) => ({ tag: "button", box, text: "BIU"[n] })) },
          { tag: "button", box: sq(1093, 146, 1107, 166), text: "+" },
          { tag: "button", box: sq(1093, 208, 1427, 304) },
          { tag: "button", box: sq(1093, 340, 1107, 360), text: "+" },
        ],
      },
    ]);
    const got = read(notes);
    expect(got.controls).toHaveLength(5);
    expect(got.controls).toEqual(expect.arrayContaining([formatRow, ...formatButtons, sq(1093, 146, 1107, 166)]));
    expect(got.controls).not.toContainEqual(sq(1093, 208, 1427, 304));
    expect(got.controls.some((control) => control.top >= 320)).toBe(false);
    expect(got.controls.some((control) => control.top < 89)).toBe(false);
  });

  it("counts a button that paints a surface of its own though it holds nothing (a sticky's blue square), and a field though it holds nothing (the Explain card's input)", () => {
    const sticky = card("sticky", sq(1080, 245, 1440, 860), [
      header(sq(1080, 245, 1440, 287), [{ tag: "button", box: sq(1081, 246, 1399, 286), text: "Note 1" }]),
      { tag: "button", box: goTo, style: { backgroundColor: "rgb(60, 90, 200)" } },
      { tag: "textarea", box: input },
      { tag: "button", box: send, text: "Send" },
      { tag: "a", box: quoteLink, text: "§2. Methods" },
    ]);
    const got = read(sticky);
    expect(got.controls).toEqual([goTo, input, send, quoteLink]);
  });

  it("leaves a picture's button out — the picture is the card's content, the button paints nothing — and a writing surface: its words are the card's words, not a control", () => {
    const figure = card("figure", sq(1080, 48, 1440, 860), [
      header(sq(1080, 48, 1440, 90), [{ tag: "button", box: sq(1081, 49, 1399, 89), text: "Figure 1" }]),
      { tag: "div", box: sq(1081, 125, 1439, 800), style: { overflowX: "hidden", overflowY: "hidden" }, kids: [{ tag: "button", box: sq(1088, 363, 1432, 562), kids: [{ tag: "canvas", box: sq(1088, 363, 1432, 562) }] }] },
      { tag: "div", role: "textbox", box: sq(1115, 299, 1427, 492), text: "Typed words", lines: [sq(1115, 299, 1240, 315)] },
    ]);
    const got = read(figure);
    expect(got.controls).toEqual([]);
    expect(got.words).toContainEqual(sq(1115, 299, 1240, 315));
  });

  it("holds a control inside a header row to the row (its parts), and a zoom row's buttons to the row: they are not listed again as controls", () => {
    const zoomBox = sq(1081, 89, 1439, 125);
    const withZoom = card("figure", sq(1080, 48, 1440, 860), [
      header(sq(1080, 48, 1440, 90), [{ tag: "button", box: sq(1399, 49, 1439, 89), kids: [{ tag: "svg", box: sq(1409, 59, 1429, 79) }] }]),
      { tag: "div", box: zoomBox, kids: [{ tag: "button", box: sq(1089, 94, 1122, 122), text: "−" }] },
    ]);
    Object.assign(withZoom, { querySelector: (selector: string) => (selector === "[data-figure-zoom-row]" ? (withZoom.children[1] ?? null) : null) });
    const got = read(withZoom);
    expect(got.headers).toHaveLength(2);
    expect(got.controls).toEqual([]);
  });

  it("asks the card by what an element is — buttons, roles, links, fields, a toolbar — and by no attribute the app made up", () => {
    asked.length = 0;
    read(card("sticky", sq(1080, 245, 1440, 505), [header(sq(1080, 245, 1440, 285), [])]));
    expect(asked).toHaveLength(1);
    const selector = api.CONTROL_SELECTOR ?? asked[0];
    expect(selector).toBe(asked[0]);
    for (const token of ["button", "[role=button]", "[role=toolbar]", "a[href]", "input", "select", "textarea"]) expect(selector).toContain(token);
    expect(selector).not.toMatch(/data-|\[class|\.|#/);
  });

  it("reads each line of a text as a rect, seen through the card and the scrolling body it stands in, and not the words of an icon, a script or a field", () => {
    const answer = card("explain", sq(1080, 300, 1440, 860), [
      header(sq(1080, 300, 1440, 353), []),
      {
        tag: "div",
        box: sq(1081, 353, 1439, 700),
        style: BODY_STYLE,
        kids: [
          { tag: "p", box: sq(1096, 360, 1424, 420), text: "A paragraph of the answer", lines: [sq(1096, 360, 1424, 376), sq(1096, 380, 1300, 396)] },
          { tag: "p", box: sq(1096, 690, 1424, 750), text: "A line half scrolled out", lines: [sq(1096, 690, 1424, 706), sq(1096, 710, 1424, 726)] },
          { tag: "svg", box: sq(1096, 430, 1116, 450), text: "icon words" },
          { tag: "textarea", box: sq(1096, 440, 1424, 470), text: "draft" },
        ],
      },
    ]);
    const got = read(answer);
    expect(got.words).toEqual([sq(1096, 360, 1424, 376), sq(1096, 380, 1300, 396), sq(1096, 690, 1424, 700)]);
  });

  it("is empty with no card open, and asks the page only through the margin's selector", () => {
    const rootAsked: string[] = [];
    expect(api.readCardObstacles!({ querySelectorAll: (selector: string) => (rootAsked.push(selector), []) })).toEqual({ headers: [], controls: [], words: [] });
    expect(rootAsked).toEqual([MARGIN_CARD_SELECTOR]);
  });

  it("leaves out a card with no box, and tolerates a card that cannot be asked for its controls (a stand-in): no controls, no words, its header still read", () => {
    const plain = { getAttribute: () => "sticky", getBoundingClientRect: () => sized(sq(1080, 380, 1440, 640)), firstElementChild: null, querySelector: () => null };
    expect(api.readCardObstacles!({ querySelectorAll: () => [plain, { getBoundingClientRect: () => sized(sq(0, 0, 0, 0)) }] })).toEqual({ headers: [], controls: [], words: [] });
  });
});
