import { describe, expect, it } from "vitest";
import {
  BLACK,
  DEFAULT_HIGHLIGHT_COLOUR,
  HIGHLIGHT_COLOURS,
  WHITE,
  contrast,
  deepFor,
  highlightColour,
  highlightPaint,
  inkFor,
  isHighlightColour,
  luminance,
} from "./highlight-colours";

// P11-07 (owner item 8; B P11-04 §4; ruling §1h.112 D3, D6): the six presets, and the words' colour on each — black or white,
// whichever has the higher WCAG ratio. The owner's words: "背高亮的文字必须和高亮颜色形成足够高的contrast" (the highlighted
// words must contrast enough with the highlight's colour; white or black, bright yellow with black by default).
//
// These tests are written so they can fail for the reason they test. The ratio is computed here a second time, straight from
// the WCAG 2.x definition and with no import from the module, so a wrong `luminance` or `contrast` cannot agree with itself;
// the ink checks use the other ink too, so a choice that is inverted is caught, not only a ratio that is low.

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; // sRGB's own threshold; WCAG 2.x's 0.03928 gives the same values
};
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const FILLS: Record<string, string> = { yellow: "#ffe600", green: "#8fe388", blue: "#7cc4ff", pink: "#ff9ec7", orange: "#ffb84d", ink: "#1e40af" };
const DEEPS: Record<string, string> = { yellow: "#dbc600", green: "#7bc375", blue: "#6ba9db", pink: "#db88ab", orange: "#db9e42", ink: "#3e5bba" };

describe("the contrast arithmetic", () => {
  it("is the WCAG 2.x ratio: black on white is 21:1, a colour on itself 1:1, and the order does not matter", () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 10);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 10);
    expect(luminance(BLACK)).toBe(0);
    expect(luminance(WHITE)).toBeCloseTo(1, 10);
  });

  it("agrees with the definition written out in this file, over a grid of colours and pairs", () => {
    const steps = [0, 51, 102, 153, 204, 255];
    for (const r of steps) for (const g of steps) for (const b of steps) {
      expect(luminance(hex(r, g, b))).toBeCloseTo(lum(hex(r, g, b)), 10);
      expect(contrast(hex(r, g, b), "#ffe600")).toBeCloseTo(ratio(hex(r, g, b), "#ffe600"), 10);
    }
  });

  it("gives the published figures: #767676 on white is the 4.54:1 of WCAG's own example, #777777 falls just under 4.5", () => {
    expect(contrast("#767676", WHITE)).toBeGreaterThan(4.5);
    expect(contrast("#777777", WHITE)).toBeLessThan(4.5);
  });
});

describe("the presets", () => {
  it("are six, in this order, with these names and fills, and Yellow is the default", () => {
    expect(HIGHLIGHT_COLOURS.map((one) => [one.id, one.name, one.fill])).toEqual([
      ["yellow", "Yellow", "#ffe600"],
      ["green", "Green", "#8fe388"],
      ["blue", "Blue", "#7cc4ff"],
      ["pink", "Pink", "#ff9ec7"],
      ["orange", "Orange", "#ffb84d"],
      ["ink", "Ink", "#1e40af"],
    ]);
    expect(DEFAULT_HIGHLIGHT_COLOUR).toBe("yellow");
  });

  it("every fill is a bright #rrggbb and no two presets share one", () => {
    const fills = HIGHLIGHT_COLOURS.map((one) => one.fill);
    for (const fill of fills) expect(fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(fills).size).toBe(fills.length);
  });

  it("an unknown, missing or malformed id reads as yellow", () => {
    for (const bad of ["mauve", "", undefined, null, 3, {}, "YELLOW"]) {
      expect(highlightColour(bad).id).toBe("yellow");
      expect(isHighlightColour(bad)).toBe(false);
      expect(highlightPaint(bad, 0)).toEqual({ bg: "#ffe600", ink: "#000000" });
      expect(deepFor(bad)).toBe("#dbc600");
    }
    for (const one of HIGHLIGHT_COLOURS) expect(isHighlightColour(one.id)).toBe(true);
  });
});

describe("the words on a highlight", () => {
  it("are black on Yellow, as the owner asked, and black or white on the others by the higher ratio", () => {
    expect(highlightPaint("yellow", 0)).toEqual({ bg: "#ffe600", ink: "#000000" });
    expect(inkFor("#ffffff")).toBe(BLACK);
    expect(inkFor("#000000")).toBe(WHITE);
    expect(highlightPaint("ink", 0)).toEqual({ bg: "#1e40af", ink: "#ffffff" });
    for (const one of HIGHLIGHT_COLOURS.filter((c) => c.id !== "ink")) expect(inkFor(one.fill)).toBe(BLACK);
  });

  it("reach 4.5:1 on every fill and on every deep shade — and 8.7:1 on the fills, 6:1 on the deep shades", () => {
    for (const one of HIGHLIGHT_COLOURS) {
      const fill = highlightPaint(one.id, 0);
      const deep = highlightPaint(one.id, 1);
      expect(fill.bg).toBe(FILLS[one.id]);
      expect(deep.bg).toBe(DEEPS[one.id]);
      expect(ratio(fill.ink, fill.bg), `${one.id} on its fill`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(deep.ink, deep.bg), `${one.id} on its deep shade`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(fill.ink, fill.bg), `${one.id} on its fill`).toBeGreaterThanOrEqual(8.7);
      expect(ratio(deep.ink, deep.bg), `${one.id} on its deep shade`).toBeGreaterThanOrEqual(6);
    }
  });

  it("are the better ink, not merely a good one: the other ink is lower on every fill, and under 3:1 on Yellow", () => {
    for (const one of HIGHLIGHT_COLOURS) {
      for (const depth of [0, 1]) {
        const { bg, ink } = highlightPaint(one.id, depth);
        const other = ink === BLACK ? WHITE : BLACK;
        expect(ratio(ink, bg), `${one.id} depth ${depth}`).toBeGreaterThan(ratio(other, bg));
      }
    }
    // An inverted choice (white words on Yellow, 1.27:1) is caught here, whatever the threshold above.
    expect(ratio(WHITE, FILLS.yellow)).toBeLessThan(3);
    expect(ratio(highlightPaint("yellow", 0).ink, FILLS.yellow)).toBeGreaterThan(16);
    expect(ratio(BLACK, FILLS.ink)).toBeLessThan(3);
  });

  it("are chosen over the whole of sRGB: no colour, on a 16-step grid of 4,096, ever gets under 4.58:1", () => {
    let worst = Infinity;
    let at = "";
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const fill = hex(r, g, b);
      const ink = inkFor(fill);
      const got = ratio(ink, fill);
      // the ink is the better of the two, by this file's own arithmetic
      expect(got).toBeCloseTo(Math.max(ratio(BLACK, fill), ratio(WHITE, fill)), 10);
      if (got < worst) [worst, at] = [got, fill];
    }
    expect(worst, `the worst colour was ${at}`).toBeGreaterThanOrEqual(4.58);
  });

  it("switch from white to black where the two ratios cross, at luminance √0.0525 − 0.05 ≈ 0.179 (an 8-bit grey cannot tie exactly; the module breaks a tie toward black)", () => {
    const grey = (v: number) => hex(v, v, v);
    expect(lum(grey(117))).toBeLessThan(0.179);
    expect(lum(grey(118))).toBeGreaterThan(0.179);
    expect(inkFor(grey(117))).toBe(WHITE);
    expect(inkFor(grey(118))).toBe(BLACK);
  });
});

describe("the deep shade", () => {
  it("is the fill moved 14% toward its ink, channel by channel", () => {
    expect(deepFor("yellow")).toBe("#dbc600");
    expect(deepFor("green")).toBe("#7bc375");
    expect(deepFor("blue")).toBe("#6ba9db");
    expect(deepFor("pink")).toBe("#db88ab");
    expect(deepFor("orange")).toBe("#db9e42");
    // a dark fill moves toward white, not black
    expect(deepFor("ink")).toBe("#3e5bba");
    expect(lum(deepFor("ink"))).toBeGreaterThan(lum(FILLS.ink));
    for (const id of ["yellow", "green", "blue", "pink", "orange"]) expect(lum(deepFor(id))).toBeLessThan(lum(FILLS[id]));
  });

  it("stands apart from its fill — a nested highlight reads against the one around it", () => {
    for (const one of HIGHLIGHT_COLOURS) expect(ratio(deepFor(one.id), one.fill), one.id).toBeGreaterThanOrEqual(1.3);
  });

  it("is what depth 1 and deeper paint, and depth 0 (or none) the fill", () => {
    for (const one of HIGHLIGHT_COLOURS) {
      expect(highlightPaint(one.id, 0).bg).toBe(one.fill);
      expect(highlightPaint(one.id, -1).bg).toBe(one.fill);
      expect(highlightPaint(one.id, 1).bg).toBe(deepFor(one.id));
      expect(highlightPaint(one.id, 4).bg).toBe(deepFor(one.id));
    }
  });
});
