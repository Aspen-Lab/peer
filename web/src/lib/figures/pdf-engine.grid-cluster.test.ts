import { describe, expect, it, vi } from "vitest";
import { figurePdf, type FigurePage } from "./figure-pdf.test-helper";
import { clusterDrawings, extractPdfFigures } from "./pdf-engine";

// P12-55. R11a: the walk and distinct-box ceilings are higher (400,000 walks, 80,000 boxes) and the
// union-rect clustering uses a uniform grid, so it stays near-linear. Every input here is invented.

type Rect = [number, number, number, number];
const PAGE: Rect = [0, 0, 612, 792];

/** Holds the engine's 25 s extraction clock (`performance.now()`) still. A page of 400,000 paths costs
 *  seconds of CPU, which a busy runner can stretch past that clock; these tests are about what is
 *  walked and found, not how fast, so the clock never runs out. Restored by the caller. */
const holdClock = () => vi.spyOn(performance, "now").mockReturnValue(0);

/** The clustering loop exactly as it was before the grid (P12-41's head, 72571c63), kept as the
 *  reference the grid is compared with. Only the box-count limit is left out. */
function loopClusters(boxes: Rect[], pageRect: Rect): Rect[] {
  const tolerance = 3;
  const bySortKey = (a: Rect, b: Rect) => a[3] - b[3] || a[0] - b[0];
  const distinct = (list: Rect[]) => {
    const seen = new Map<string, Rect>();
    for (const r of list) seen.set(r.map((v) => v.toFixed(3)).join(","), r);
    return [...seen.values()].sort(bySortKey);
  };
  const neighbors = (a: Rect, b: Rect) =>
    !(a[2] < b[0] - tolerance || a[0] > b[2] + tolerance || a[3] < b[1] - tolerance || a[1] > b[3] + tolerance);
  const remaining = distinct(
    boxes
      .map((r): Rect => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])])
      .filter((r) => r[0] >= pageRect[0] && r[2] <= pageRect[2] && r[1] >= pageRect[1] && r[3] <= pageRect[3]),
  );
  const clusters: Rect[] = [];
  while (remaining.length) {
    const union: Rect = [...remaining[0]];
    let repeat = true;
    while (repeat) {
      repeat = false;
      for (let i = remaining.length - 1; i > 0; i--) {
        if (neighbors(remaining[i], union)) {
          union[0] = Math.min(union[0], remaining[i][0]);
          union[1] = Math.min(union[1], remaining[i][1]);
          union[2] = Math.max(union[2], remaining[i][2]);
          union[3] = Math.max(union[3], remaining[i][3]);
          remaining.splice(i, 1);
          repeat = true;
        }
      }
    }
    clusters.push(union);
    remaining.shift();
  }
  return distinct(clusters).filter((r) => r[2] - r[0] > tolerance && r[3] - r[1] > tolerance);
}

/** A small deterministic generator, so a failing scene can be rebuilt from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Scene = { name: string; boxes: Rect[]; page: Rect };

/** Invented scenes of every shape a figure page has: scattered markers, blobs that touch, long
 *  hairlines, page-sized frames, boxes written back to front, duplicates, boxes off the page. */
function scene(seed: number, count: number, page: Rect = PAGE): Scene {
  const next = random(seed);
  const at = (lo: number, hi: number) => lo + next() * (hi - lo);
  const [x0, y0, x1, y1] = page;
  const boxes: Rect[] = [];
  const kind = seed % 6;
  for (let i = 0; i < count; i++) {
    const pick = next();
    let box: Rect;
    if (kind === 0 || pick < 0.55) {
      // a marker or a short segment, spread over the page
      const x = at(x0, x1 - 8);
      const y = at(y0, y1 - 8);
      box = [x, y, x + at(0.2, 6), y + at(0.2, 6)];
    } else if (kind === 1 || pick < 0.75) {
      // a blob: markers packed round a few centres
      const cx = x0 + 80 + ((i * 7) % 5) * 90;
      const cy = y0 + 100 + ((i * 3) % 4) * 150;
      const x = cx + at(-40, 40);
      const y = cy + at(-40, 40);
      box = [x, y, x + at(0.5, 4), y + at(0.5, 4)];
    } else if (kind === 2 || pick < 0.88) {
      // a long hairline, page wide or page tall
      const horizontal = next() < 0.5;
      const x = at(x0, x1 - 20);
      const y = at(y0, y1 - 20);
      box = horizontal ? [x, y, x + at(20, x1 - x), y] : [x, y, x, y + at(20, y1 - y)];
    } else if (kind === 3 || pick < 0.96) {
      // a frame or a panel
      const x = at(x0, x1 - 60);
      const y = at(y0, y1 - 60);
      box = [x, y, x + at(30, x1 - x), y + at(30, y1 - y)];
    } else {
      // a box of the page's edge: back to front, off the page, or an exact duplicate
      const x = at(x0 - 30, x1 + 30);
      const y = at(y0 - 30, y1 + 30);
      box = pick < 0.98 ? [x + 5, y + 5, x, y] : boxes.length ? [...boxes[Math.floor(next() * boxes.length)]] as Rect : [x, y, x + 3, y + 3];
    }
    boxes.push(box);
  }
  return { name: `seed ${seed}, ${count} boxes${page === PAGE ? "" : ", offset page"}`, boxes, page };
}

describe("P12-55 R11a grid clustering gives the loop's clusters", () => {
  const small = [1, 2, 3, 20, 150, 600, 1_999].flatMap((count) => [11, 12, 13, 14, 15, 16].map((seed) => scene(seed * 101 + count, count)));
  const offsetPage: Rect = [-20, -30, 420, 560]; // a page whose box does not start at 0, 0
  small.push(scene(41, 900, offsetPage), scene(42, 1_999, offsetPage), scene(43, 60, [0, 0, 200, 60]));

  it.each(small.map((s) => [s.name, s] as const))("equals the loop on %s", (_name, { boxes, page }) => {
    const grid = clusterDrawings(boxes, page);
    expect(grid).not.toBeNull();
    expect(grid).toEqual(loopClusters(boxes, page));
  });

  it("equals the loop on larger scenes as well, since the clusters do not depend on the count", () => {
    for (const s of [scene(7, 5_000), scene(8, 9_000), scene(9, 12_000)]) {
      expect(clusterDrawings(s.boxes, s.page)).toEqual(loopClusters(s.boxes, s.page));
    }
  }, 120_000);

  it("finds clusters at all in the scenes (the comparison is not between two empty lists)", () => {
    const sizes = small.map((s) => (clusterDrawings(s.boxes, s.page) ?? []).length);
    expect(sizes.filter((size) => size > 0).length).toBeGreaterThan(small.length / 2);
    expect(Math.max(...sizes)).toBeGreaterThan(3);
  });

  it("joins a box inside the union that touches none of the union's members", () => {
    // Two bars make an L whose union is 100 x 100; the box in the middle is 80 pt from either bar,
    // so only the union's own reach takes it in, as the loop does.
    const bars: Rect[] = [[0, 0, 100, 4], [0, 0, 4, 100], [90, 90, 95, 95]];
    expect(clusterDrawings(bars, PAGE)).toEqual([[0, 0, 100, 100]]);
    expect(loopClusters(bars, PAGE)).toEqual([[0, 0, 100, 100]]);
  });

  it("chains boxes through the reach the union has grown to, one 3 pt step at a time", () => {
    const steps: Rect[] = Array.from({ length: 40 }, (_, i): Rect => [10 + i * 7, 10 + i * 7, 14 + i * 7, 14 + i * 7]);
    expect(clusterDrawings(steps, PAGE)).toEqual([[10, 10, 14 + 39 * 7, 14 + 39 * 7]]);
    const apart = [...steps.slice(0, 20), ...steps.slice(21)]; // one step missing: a 10 pt gap
    expect(clusterDrawings(apart, PAGE)).toEqual(loopClusters(apart, PAGE));
    expect(clusterDrawings(apart, PAGE)?.length).toBe(2);
  });

  it("takes the seeds in the loop's order, so overlapping unions come out the same", () => {
    // Two interleaved L shapes: which one is seeded first decides what each union holds.
    const shapes: Rect[] = [
      [10, 10, 200, 14], [10, 10, 14, 200], [100, 100, 104, 300], [100, 100, 300, 104],
      [150, 150, 154, 154], [220, 220, 224, 224],
    ];
    expect(clusterDrawings(shapes, PAGE)).toEqual(loopClusters(shapes, PAGE));
  });
});

describe("P12-55 R11a bounds", () => {
  const markers = (count: number): Rect[] => Array.from({ length: count }, (_, i): Rect => {
    const x = 20 + (i % 400) * 1.25;
    const y = 20 + Math.floor(i / 400) * 0.75;
    return [x, y, x + 1, y + 1];
  });

  it("clusters 80,000 distinct boxes and gives up at 80,001", () => {
    const at = clusterDrawings(markers(80_000), PAGE);
    expect(at).toEqual([[20, 20, 20 + 399 * 1.25 + 1, 20 + 199 * 0.75 + 1]]);
    expect(clusterDrawings(markers(80_001), PAGE)).toBeNull();
  }, 60_000);

  it("counts a box once however often it is drawn: 160,000 operators over 80,000 positions are not past the bound", () => {
    expect(clusterDrawings([...markers(80_000), ...markers(80_000)], PAGE)).toEqual(clusterDrawings(markers(80_000), PAGE));
  }, 60_000);

  it("gives up, bounded, on 80,000 distinct large overlapping boxes (each in some 1,600 cells)", () => {
    const large = Array.from({ length: 80_000 }, (_, i): Rect => {
      const x = 10 + (i % 280) * 0.5;
      const y = 10 + Math.floor(i / 280) * 0.5;
      return [x, y, x + 300, y + 300];
    });
    expect(clusterDrawings(large, PAGE)).toBeNull();
  }, 60_000);

  it("keeps a page of a few thousand large overlapping boxes, well inside its work bound", () => {
    const large = Array.from({ length: 4_000 }, (_, i): Rect => [(i * 7) % 300, (i * 13) % 500, ((i * 7) % 300) + 250, ((i * 13) % 500) + 250]);
    expect(clusterDrawings(large, PAGE)).toEqual(loopClusters(large, PAGE));
  }, 60_000);
});

describe("P12-55 R11a dense vector pages keep their figure", () => {
  const opts = { maxPages: 1, maxFigures: 1, onlyPage: 1, label: "Figure 1", measureOnly: true };
  // 300 x 200 markers, 1 pt square, on a lattice of 1.25 x 0.75 pt (all exact in binary), from (100, 100)
  // down to (474.75, 250.25) from the top; the caption is 18 pt under it.
  const marker = (index: number) => {
    const x = 100 + (index % 300) * 1.25;
    const top = 100 + Math.floor(index / 300) * 0.75;
    return `${x} ${791 - top} 1 1 re f`;
  };

  it("finds one chart drawn with 100,000 path operations at 60,000 positions, which the old ceilings refused", async () => {
    const operators = Array.from({ length: 100_000 }, (_, i) => marker(i % 60_000));
    const page: FigurePage = { text: [["Figure 1. Invented dense scatter chart.", 100, 268, 9]], drawingOps: [operators.join("\n")] };
    const mupdf = await import("mupdf");
    const spy = vi.spyOn(mupdf.Path.prototype, "walk");
    const clock = holdClock();
    try {
      const result = await extractPdfFigures(figurePdf([page]), opts);
      expect(spy.mock.calls.length).toBe(100_000);
      expect(result.figures.map((figure) => figure.box)).toEqual([[100, 100, 474.75, 250.25]]);
      expect(result.reason).toBeNull();
    } finally { spy.mockRestore(); clock.mockRestore(); }
  }, 120_000);

  it("accepts the later panel when 399,999 clipped paths and the panel make exactly the 400,000 walks", async () => {
    const operators = ["q 0 0 10 10 re W n", ...Array(399_999).fill("100 100 1 1 re f"), "Q", "90 542 360 150 re f"];
    const page: FigurePage = { text: [["Figure 1. Invented visible panel.", 90, 268, 9]], drawingOps: [operators.join("\n")] };
    const mupdf = await import("mupdf");
    const spy = vi.spyOn(mupdf.Path.prototype, "walk");
    const clock = holdClock();
    try {
      const result = await extractPdfFigures(figurePdf([page]), opts);
      expect(spy.mock.calls.length).toBe(400_000);
      expect(result.figures.map((figure) => figure.box)).toEqual([[90, 100, 450, 250]]);
      expect(result.reason).toBeNull();
    } finally { spy.mockRestore(); clock.mockRestore(); }
  }, 120_000);
});
