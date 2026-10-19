// The colours a highlight can wear (P11-07; owner item 8; B P11-04 §4; ruling §1h.112 D3, D6), as pure functions.
//
// Six presets and no custom colour, the same fills in both themes. The words on a highlight are black or white,
// whichever has the higher WCAG 2.x contrast against the colour actually painted — and whichever it is, the ratio
// cannot fall under √21 ≈ 4.58:1 for ANY colour (the two ratios cross at relative luminance 0.179, where each is 4.58), so
// the words of a highlight are legible whatever the fill. The presets are chosen away from that band: every one
// gives 8.7:1 or more on its fill. Nothing here reads the DOM, the theme or the store.

import type { HighlightColourId } from "./types";

export interface HighlightColour {
  id: HighlightColourId;
  /** What the strip, the notes row and the screen reader call it. */
  name: string;
  /** The colour behind the words, `#rrggbb`. */
  fill: string;
}

/** The six presets, in the order the strip shows them. Yellow is the owner's default (a bright yellow, black words). */
export const HIGHLIGHT_COLOURS: readonly HighlightColour[] = [
  { id: "yellow", name: "Yellow", fill: "#ffe600" },
  { id: "green", name: "Green", fill: "#8fe388" },
  { id: "blue", name: "Blue", fill: "#7cc4ff" },
  { id: "pink", name: "Pink", fill: "#ff9ec7" },
  { id: "orange", name: "Orange", fill: "#ffb84d" },
  { id: "ink", name: "Ink", fill: "#1e40af" },
];

/** The colour of a new highlight, and of a stored one the table no longer knows (ruling §1h.112 D4). */
export const DEFAULT_HIGHLIGHT_COLOUR: HighlightColourId = "yellow";

export const BLACK = "#000000";
export const WHITE = "#ffffff";

/** How far the fill moves toward its ink for the "deep" shade a highlight wears when it sits inside another mark. */
export const DEEP_SHARE = 0.14;

/** Whether `id` is one of the presets. */
export function isHighlightColour(id: unknown): id is HighlightColourId {
  return typeof id === "string" && HIGHLIGHT_COLOURS.some((one) => one.id === id);
}

/** The preset for `id`; an unknown, missing or malformed id reads as yellow. */
export function highlightColour(id: unknown): HighlightColour {
  return HIGHLIGHT_COLOURS.find((one) => one.id === id) ?? HIGHLIGHT_COLOURS[0];
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.x relative luminance of a `#rrggbb` colour: 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colours, 1 to 21, whichever order they come in. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The words' colour on `fill`: black or white, the higher contrast; a tie is black. */
export function inkFor(fill: string): string {
  return contrast(fill, BLACK) >= contrast(fill, WHITE) ? BLACK : WHITE;
}

/** The preset's fill moved `DEEP_SHARE` toward its ink: the shade it wears nested inside another mark, so the inner one reads. */
export function deepFor(id: unknown): string {
  const { fill } = highlightColour(id);
  const ink = channels(inkFor(fill));
  return toHex(channels(fill).map((v, i) => Math.round(v + (ink[i] - v) * DEEP_SHARE)));
}

/** What a highlight's mark paints: its fill at depth 0, the deep shade nested at depth 1 or more, and the ink best on the one painted. */
export function highlightPaint(id: unknown, depth: number): { bg: string; ink: string } {
  const bg = depth >= 1 ? deepFor(id) : highlightColour(id).fill;
  return { bg, ink: inkFor(bg) };
}
