import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCK_MIN_VIEWPORT_PX } from "./explain-dock";
import { SHELL_MIN_VIEWPORT_PX } from "./pane-layout";
import * as spread from "./spread";
import { SPREAD_GRID, SPREAD_QUERY, TWO_XL_PANEL_PX, XL_CAP_PX } from "./spread";

// P11-10 rule 3 (B P11-01 §2.2, §4 C2; ruling §1h.113 (a)): `useSpread` — the one switch between the one-column page and the spread — now
// asks for the three-pane shell's width, 64rem = 1024 css px (it asked for 80rem, the old two-column spread's xl). Everything below this
// describe is the old spread's own arithmetic. It is KEPT, not rewritten, because the constants it pins still stand: `SPREAD_GRID` and
// the caps are what the loading mat and the error states (`loading.tsx`, `page.tsx`'s `width="spread"` sites) still lay out with. The
// `PANEL_*` / `COLUMN_CLASS` constants are retired (P11-16 follow-up, ruling §1h.115 item 5), and so is the describe that pinned
// `PANEL_TAIL_CLASS`; the file's last describe pins their absence. Re-aimed: nothing; the file's new first describe is the new rule.
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

// Retired (P11-16 follow-up, ruling §1h.115 item 5): the old spread's panel, its sticky part, its tail and its reading column. P10-21's
// "PANEL_TAIL_CLASS keeps the strip under the masthead at the foot of the page" (its two cases, "the sticky part has a negative bottom
// margin…" and "still pins under the masthead and drops the strip's own top gap…") pinned a class nothing imported once the blocks moved
// into the shell's panes (P11-16): the strip stands in the left pane's fixed zone, and where that pane stands under the masthead is the
// shell's own rule (`.reader-left` in globals.css, `reader-shell.tsx`), not this class. They are retired with the constant. What stands in
// their place: the four names are gone, from this module and from every file under src/, and `SPREAD_GRID` is kept exactly while the
// loading mat and the error states still lay out with it.
const RETIRED = ["PANEL_CLASS", "PANEL_STICKY_CLASS", "PANEL_TAIL_CLASS", "COLUMN_CLASS"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the old spread's panel and column constants are retired (ruling §1h.115 item 5)", () => {
  it("spread.ts exports none of PANEL_CLASS, PANEL_STICKY_CLASS, PANEL_TAIL_CLASS, COLUMN_CLASS", () => {
    const exported = Object.keys(spread);
    for (const name of RETIRED) expect(exported).not.toContain(name);
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/spread.ts"), "utf8");
    for (const name of RETIRED) expect(source).not.toMatch(new RegExp(`export\\s+const\\s+${name}\\b`));
  });

  it("no file under src/ imports or defines them (this test names them only to forbid them)", () => {
    const root = resolve(process.cwd(), "src");
    const self = resolve(process.cwd(), "src/components/reader/spread.test.ts");
    const pattern = new RegExp(`\\b(${RETIRED.join("|")})\\b`);
    // Another test names them to forbid them too (`reader-layout.order.test.tsx`, on the layout's source): a test that only forbids a
    // name is not a user of it, so tests are read for imports and definitions, every other file for any mention outside a comment.
    const users = sourceFiles(root)
      .filter((file) => file !== self)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        if (/\.test\.tsx?$/.test(file)) {
          return RETIRED.some((name) => new RegExp(`import[^;]*\\b${name}\\b[^;]*from|const\\s+${name}\\b`).test(text));
        }
        return pattern.test(text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
      })
      .map((file) => relative(root, file));
    expect(users).toEqual([]);
  });

  it("SPREAD_GRID stays, because the loading mat and the error states still lay out with it", () => {
    // When neither uses it any more it is dead too, and this test is the reminder to retire it with them.
    const loading = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/loading.tsx"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    expect(loading).toMatch(/className=\{SPREAD_GRID\}/);
    expect(page).toMatch(/className=\{SPREAD_GRID\}/);
    expect(typeof spread.SPREAD_GRID).toBe("string");
  });
});
