import { describe, expect, it } from "vitest";
import { DOCK_MIN_VIEWPORT_PX } from "./explain-dock";
import { SHELL_MIN_VIEWPORT_PX } from "./pane-layout";
import { PANEL_STICKY_CLASS, PANEL_TAIL_CLASS, SPREAD_GRID, SPREAD_QUERY, TWO_XL_PANEL_PX, XL_CAP_PX } from "./spread";

// P11-10 rule 3 (B P11-01 §2.2, §4 C2; ruling §1h.113 (a)): `useSpread` — the one switch between the one-column page and the spread — now
// asks for the three-pane shell's width, 64rem = 1024 css px (it asked for 80rem, the old two-column spread's xl). Everything below this
// describe is the old spread's own arithmetic. It is KEPT, not rewritten, because the constants it pins still stand: `SPREAD_GRID` and
// the caps are what the loading mat and the error states (`loading.tsx`, `page.tsx`'s `width="spread"` sites) still lay out with, and
// `PANEL_*` / `COLUMN_CLASS` are what `reader-layout.tsx` still imports until the blocks move into the shell (P11-16 retires them with
// it). Re-aimed: nothing in them; the file's new first describe is the new rule.
describe("SPREAD_QUERY — the shell's width (P11-10)", () => {
  it("is (min-width: 64rem)", () => {
    expect(SPREAD_QUERY).toBe("(min-width: 64rem)");
  });

  it("is 1024 css px at the browser's 16px root: the shell's minimum and the explain dock's, one threshold", () => {
    const rem = Number(/min-width:\s*([\d.]+)rem/.exec(SPREAD_QUERY)?.[1]);
    expect(rem * 16).toBe(SHELL_MIN_VIEWPORT_PX);
    expect(rem * 16).toBe(DOCK_MIN_VIEWPORT_PX);
  });

  it("is no longer the xl breakpoint", () => {
    expect(SPREAD_QUERY).not.toContain("80rem");
  });
});

// P6-03 (A P6-02 S1, mutation M8): the spread's panel tracks were pinned by no
// test. Widening the xl panel from 320 to 360 left every test green, although
// the panel's width, the reading column's width and the explain box's side room
// all follow from that one number. `reading-prefs.test.ts` ties the page
// container's caps to this file's constants; this ties `SPREAD_GRID`'s tracks
// and gaps to the arithmetic `spread.ts`'s own comments state.
//
// The numbers below are written once each, on purpose: changing the panel
// track means changing this test knowingly, here, together with the column it
// leaves and the cap that holds it.

/** The left panel's track at xl (1280 to 1535): the plate, the title, the commands. */
const XL_PANEL_PX = 320;
/** The left panel's track from 2xl (1536 up). */
const TWO_XL_PANEL_TRACK_PX = 360;
/** The reading column at 1x at xl: the cap less the page's padding, the gap and the panel. */
const XL_COLUMN_PX = 640;
/** The page's own side padding inside the cap's border box: 24px a side (`px-6`). */
const PAGE_PADDING_PX = 48;
/** Tailwind's spacing unit, `--spacing: 0.25rem`, at the browser's 16px root. */
const SPACING_UNIT_PX = 4;
/** The gap between panel and column, in spacing units: `xl:gap-x-16`, `2xl:gap-x-24`. */
const XL_GAP_UNITS = 16;
const TWO_XL_GAP_UNITS = 24;

const XL_GAP_PX = XL_GAP_UNITS * SPACING_UNIT_PX;
const TWO_XL_GAP_PX = TWO_XL_GAP_UNITS * SPACING_UNIT_PX;

// Whole class tokens, not substrings: `2xl:grid-cols-[...]` contains
// `xl:grid-cols-[...]`, so a substring check could pass on the wrong breakpoint.
const tokens = SPREAD_GRID.split(/\s+/);

describe("SPREAD_GRID's panel tracks and gaps", () => {
  it("holds the panel track at xl and at 2xl, each beside a flexible reading column", () => {
    // Verbatim: `xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]` and
    // `2xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]`.
    expect(tokens).toContain(`xl:grid-cols-[minmax(0,${XL_PANEL_PX}px)_minmax(0,1fr)]`);
    expect(tokens).toContain(`2xl:grid-cols-[minmax(0,${TWO_XL_PANEL_TRACK_PX}px)_minmax(0,1fr)]`);
  });

  it("holds the gap between panel and column at xl and at 2xl", () => {
    // Verbatim: `xl:gap-x-16` and `2xl:gap-x-24`.
    expect(tokens).toContain(`xl:gap-x-${XL_GAP_UNITS}`);
    expect(tokens).toContain(`2xl:gap-x-${TWO_XL_GAP_UNITS}`);
  });
});

describe("SPREAD_GRID's tracks against the caps spread.ts documents", () => {
  it("at xl: the 1072 cap less 48 padding, 64 gap and the 320 panel leaves a 640 column", () => {
    expect(XL_GAP_PX).toBe(64);
    expect(XL_CAP_PX - PAGE_PADDING_PX - XL_GAP_PX - XL_PANEL_PX).toBe(XL_COLUMN_PX);
  });

  it("at 2xl: the 360 panel, the 96 gap and 48 padding are the fixed 504 share", () => {
    expect(TWO_XL_GAP_PX).toBe(96);
    expect(TWO_XL_PANEL_TRACK_PX + TWO_XL_GAP_PX + PAGE_PADDING_PX).toBe(TWO_XL_PANEL_PX);
  });
});

// P10-21 rule 3 (A P10-14 §8 item 7): at the very foot of the page, at 1280 x 720, the sticky part stops where its
// holder ends, 64 px above the window's bottom, and its top (43.9 px) stood 4 px under the masthead's bottom (48 px).
// The part's bottom margin is -12 px, so it ends 12 px below the holder: its top is 55.9 px there. The layout is not
// computed in this runtime; the page's pixels are measured in docs/reading-helper-abc/P10-21-C-*.md.
describe("PANEL_TAIL_CLASS keeps the strip under the masthead at the foot of the page", () => {
  it("the sticky part has a negative bottom margin, so the holder's end never lifts its top into the masthead", () => {
    expect(PANEL_TAIL_CLASS.split(/\s+/)).toContain("xl:-mb-3");
  });

  it("still pins under the masthead and drops the strip's own top gap, as P10-04b built it", () => {
    expect(PANEL_TAIL_CLASS.split(/\s+/)).toContain(PANEL_STICKY_CLASS);
    expect(PANEL_TAIL_CLASS).toContain("xl:[&>:first-child]:mt-0");
  });
});
