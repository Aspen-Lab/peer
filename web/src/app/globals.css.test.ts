// 6-09 / A6-01: protective test for the font-scale-reaches-the-prose fix.
//
// The bug: a `calc()` written INSIDE a custom property's own declaration
// (`--text-body: calc(14.5px * var(--reading-scale, 1));` at `:root`) is
// resolved once, at that declaration site — so it can never see a
// `--reading-scale` a descendant later sets. The fix moves the `calc()` to
// the USE site instead: the three tokens go back to plain px, and three
// scoped rules (next to the `[class~="rounded-full"]` override) multiply
// `font-size` by `var(--reading-scale, 1)` only inside `.reading-scaled`.
//
// `jsdom` doesn't reliably compute cascade-layer precedence or `calc()`
// against custom properties the way a real browser does (B's second-pass
// note), so a computed-style assertion here would risk a false negative.
// A source-text assertion against the CSS itself is deterministic and,
// checked by reverting the fix, genuinely fails on the pre-fix file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("globals.css — reading-scale reaches the prose (6-09)", () => {
  it("keeps --text-lead / --text-body / --text-body-lg as plain px, not calc()", () => {
    expect(css).toMatch(/--text-lead:\s*16\.5px;/);
    expect(css).toMatch(/--text-body:\s*14\.5px;/);
    expect(css).toMatch(/--text-body-lg:\s*15\.5px;/);
    // None of the three tokens' own declarations reference --reading-scale —
    // that would put the calc() back at the declaration site, which is
    // exactly the bug (a var() resolved at :root never sees a descendant's
    // value).
    expect(css).not.toMatch(/--text-lead:\s*calc\([^;]*--reading-scale/);
    expect(css).not.toMatch(/--text-body:\s*calc\([^;]*--reading-scale/);
    expect(css).not.toMatch(/--text-body-lg:\s*calc\([^;]*--reading-scale/);
  });

  it("applies --reading-scale at the use site, scoped to .reading-scaled", () => {
    expect(css).toMatch(
      /\.reading-scaled \[class~="text-lead"\]\s*\{\s*font-size:\s*calc\(var\(--text-lead\)\s*\*\s*var\(--reading-scale,\s*1\)\);?\s*\}/,
    );
    expect(css).toMatch(
      /\.reading-scaled \[class~="text-body"\]\s*\{\s*font-size:\s*calc\(var\(--text-body\)\s*\*\s*var\(--reading-scale,\s*1\)\);?\s*\}/,
    );
    expect(css).toMatch(
      /\.reading-scaled \[class~="text-body-lg"\]\s*\{\s*font-size:\s*calc\(var\(--text-body-lg\)\s*\*\s*var\(--reading-scale,\s*1\)\);?\s*\}/,
    );
  });
});

// 9-32 (A9-16): protective test for the supplement-upload button's green
// tone — it used to be a raw Tailwind `bg-emerald-700`/`bg-emerald-800`,
// wired to nothing in this file's own token system, which every other
// `tone` in `components/ui/button.tsx` reads instead. A source-text
// assertion (this file's own established pattern, see the 6-09 tests
// above) is what actually proves the token is declared in all three
// palette blocks — a computed-style check would need a real browser to
// resolve `color-mix`/custom-property cascade the way jsdom cannot.
describe("globals.css — --color-positive tokens for the green tone (9-32)", () => {
  it("declares --color-positive and --color-positive-strong in the light palette", () => {
    const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("/* Dark palette"));
    expect(rootBlock).toMatch(/--color-positive:\s*#[0-9a-f]{6};/);
    expect(rootBlock).toMatch(/--color-positive-strong:\s*#[0-9a-f]{6};/);
  });

  it("declares both tokens in the explicit dark palette (html[data-mode=\"dark\"])", () => {
    const darkBlock = css.slice(
      css.indexOf('html[data-mode="dark"] {'),
      css.indexOf('/* Dark palette — "system"'),
    );
    expect(darkBlock).toMatch(/--color-positive:\s*#[0-9a-f]{6};/);
    expect(darkBlock).toMatch(/--color-positive-strong:\s*#[0-9a-f]{6};/);
  });

  it("declares both tokens in the system-dark palette, kept in sync with the explicit one", () => {
    const systemDarkStart = css.indexOf('html[data-mode="system"] {');
    const systemDarkBlock = css.slice(systemDarkStart, css.indexOf("/* ── Material", systemDarkStart));
    expect(systemDarkBlock).toMatch(/--color-positive:\s*#[0-9a-f]{6};/);
    expect(systemDarkBlock).toMatch(/--color-positive-strong:\s*#[0-9a-f]{6};/);
  });

  it("the button's green tone reads the tokens, not a raw Tailwind color", () => {
    const buttonSource = readFileSync(
      new URL("../components/ui/button.tsx", import.meta.url),
      "utf8",
    );
    const greenLine = buttonSource.split("\n").find((line) => line.trim().startsWith("green:"));
    expect(greenLine).toBeDefined();
    expect(greenLine).toContain("var(--color-positive)");
    expect(greenLine).toContain("var(--color-positive-strong)");
    expect(greenLine).not.toMatch(/emerald/);
  });
});

// P1-05 (§1f.13, §1f.14): the route's tints. Light greens on the light
// palette, low-luminance greens on the dark one, in every palette block (the
// dark palette is written twice), and used as a background only — never as a
// text colour, never anywhere else. P10-06 (review 3.2): three of them are
// ordered by how much a section says about the question (strong the deepest,
// faint the lightest) and the fourth is the model's background mark.
describe("globals.css — the route tint tokens (P1-05, P10-06)", () => {
  const GRADED = ["--color-route-strong", "--color-route-medium", "--color-route-faint"] as const;
  const TOKENS = [...GRADED, "--color-route-background"] as const;
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("/* Dark palette"));
  const darkBlock = css.slice(css.indexOf('html[data-mode="dark"] {'), css.indexOf('/* Dark palette — "system"'));
  const systemStart = css.indexOf('html[data-mode="system"] {');
  const systemBlock = css.slice(systemStart, css.indexOf("/* ── Material", systemStart));

  const value = (block: string, token: string): string => {
    const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6});`).exec(block);
    if (!match) throw new Error(`${token} is not declared as a #rrggbb colour in this block`);
    return match[1];
  };
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const isGreen = (hex: string) => {
    const [r, g, b] = channels(hex);
    return g > r && g > b;
  };

  it("declares the four tokens in the light palette and in both dark palettes", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      for (const token of TOKENS) expect(() => value(block, token)).not.toThrow();
    }
  });

  it("keeps the two dark palettes in sync", () => {
    for (const token of TOKENS) expect(value(systemBlock, token)).toBe(value(darkBlock, token));
  });

  it("light: light greens, strong the deepest, then medium, then faint — each step visibly apart", () => {
    const [strong, medium, faint] = GRADED.map((token) => value(lightBlock, token));
    for (const token of TOKENS) {
      expect(isGreen(value(lightBlock, token))).toBe(true);
      expect(luminance(value(lightBlock, token))).toBeGreaterThan(0.7);
    }
    expect(luminance(strong)).toBeLessThan(luminance(medium));
    expect(luminance(medium)).toBeLessThan(luminance(faint));
    // P10-06 (A9): three visibly different greens, not three near-equal ones.
    expect(luminance(medium) - luminance(strong)).toBeGreaterThanOrEqual(0.06);
    // P10-26 (A's X-A5 / §8 item 4) RE-AIMED: the faint step was 0.05 in luminance and 1.05:1 from the medium, with the
    // faint tint itself at 1.03:1 against the page — barely there. The faint green is now a step darker, against the
    // page at >= 1.06:1, which closes the gap to the medium; the order stays, the step is >= 0.02 and >= 1.02:1.
    expect(luminance(faint) - luminance(medium)).toBeGreaterThanOrEqual(0.02);
    expect(contrast(strong, medium)).toBeGreaterThanOrEqual(1.08);
    expect(contrast(medium, faint)).toBeGreaterThanOrEqual(1.02);
  });

  it("light: the faint tint can be seen against the page (>= 1.06:1), and the ink on it is still readable", () => {
    const faint = value(lightBlock, "--color-route-faint");
    const page = value(lightBlock, "--color-bg");
    expect(contrast(faint, page)).toBeGreaterThanOrEqual(1.06);
    expect(contrast(value(lightBlock, "--color-text-muted"), faint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(value(lightBlock, "--color-heading"), faint)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark: low-luminance greens, strong the furthest from the dark ground, then medium, then faint — each step visibly apart", () => {
    const [strong, medium, faint] = GRADED.map((token) => value(darkBlock, token));
    const ground = value(darkBlock, "--color-bg");
    for (const token of TOKENS) {
      const tint = value(darkBlock, token);
      expect(isGreen(tint)).toBe(true);
      expect(luminance(tint)).toBeLessThan(0.1);
      expect(luminance(tint)).toBeGreaterThan(luminance(ground));
    }
    expect(luminance(strong)).toBeGreaterThan(luminance(medium));
    expect(luminance(medium)).toBeGreaterThan(luminance(faint));
    expect(luminance(strong) - luminance(medium)).toBeGreaterThanOrEqual(0.01);
    expect(luminance(medium) - luminance(faint)).toBeGreaterThanOrEqual(0.01);
    expect(contrast(strong, medium)).toBeGreaterThanOrEqual(1.1);
    expect(contrast(medium, faint)).toBeGreaterThanOrEqual(1.1);
  });

  it("the model's background mark is a fourth green, none of the three graded ones", () => {
    for (const block of [lightBlock, darkBlock]) {
      for (const token of GRADED) expect(value(block, "--color-route-background")).not.toBe(value(block, token));
    }
  });

  it("keeps the tinted text readable: the palette's muted and heading text on every tint ≥ 4.5:1", () => {
    for (const block of [lightBlock, darkBlock]) {
      for (const token of TOKENS) {
        expect(contrast(value(block, "--color-text-muted"), value(block, token))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(value(block, "--color-heading"), value(block, token))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("is read only as a background, and only by the route tint (§1f.14: the greens stay in these tokens)", () => {
    // In this stylesheet the tokens are declared and never read.
    expect(css).not.toMatch(/var\(--color-route-/);
    // In the source, every read is a background utility on one of the three
    // tokens, and they all live in the one tier → tint table.
    const root = new URL("..", import.meta.url).pathname;
    const reads: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = `${dir}/${name}`;
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !file.endsWith("app/globals.css")) {
          const source = readFileSync(file, "utf8");
          for (const match of source.matchAll(/[^\s"'`]*--color-route-[^\s"'`]*/g)) reads.push(`${file.slice(root.length)}: ${match[0]}`);
        }
      }
    };
    walk(root.replace(/\/$/, ""));
    expect(reads).toEqual([
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-strong)]",
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-medium)]",
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-background)]",
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-faint)]",
    ]);
  });
});

// P10-09f (review 7.1c; walk X-B3): the highlighter. The words a sticky note was taken on stay marked in the paper,
// in a pale yellow in every palette block (it replaces P3-01's grey term highlight, which went with the Terms strip):
// none of the route's greens, so a marked passage is never mistaken for a tier; used as a background only, by the
// body's note `<mark>`; the palette's muted ink (the paragraph's own) stays ≥ 4.5:1 on it, the heading ink ≥ 7:1.
describe("globals.css — the highlighter token (P10-09f)", () => {
  const TOKEN = "--color-note-mark";
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("/* Dark palette"));
  const darkBlock = css.slice(css.indexOf('html[data-mode="dark"] {'), css.indexOf('/* Dark palette — "system"'));
  const systemStart = css.indexOf('html[data-mode="system"] {');
  const systemBlock = css.slice(systemStart, css.indexOf("/* ── Material", systemStart));

  const value = (block: string, token: string): string => {
    const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6});`).exec(block);
    if (!match) throw new Error(`${token} is not declared as a #rrggbb colour in this block`);
    return match[1];
  };
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("is declared in the light palette and in both dark palettes, the two dark ones in sync", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) expect(() => value(block, TOKEN)).not.toThrow();
    expect(value(systemBlock, TOKEN)).toBe(value(darkBlock, TOKEN));
  });

  it("is a pale yellow (red and green high, blue lowest), never one of the route's greens", () => {
    for (const block of [lightBlock, darkBlock]) {
      const [r, g, b] = channels(value(block, TOKEN));
      expect(r).toBeGreaterThanOrEqual(g);
      expect(g).toBeGreaterThan(b);
      expect(r - b).toBeGreaterThanOrEqual(24);
      for (const green of ["--color-route-strong", "--color-route-medium", "--color-route-faint", "--color-route-background"]) {
        expect(value(block, TOKEN)).not.toBe(value(block, green));
      }
    }
  });

  it("is a tint on its ground: darker than the light ground, lighter than the dark one, and visibly off both", () => {
    expect(luminance(value(lightBlock, TOKEN))).toBeLessThan(luminance(value(lightBlock, "--color-bg")));
    expect(luminance(value(darkBlock, TOKEN))).toBeGreaterThan(luminance(value(darkBlock, "--color-bg")));
    expect(contrast(value(lightBlock, TOKEN), value(lightBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.1);
    expect(contrast(value(darkBlock, TOKEN), value(darkBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.4);
  });

  it("keeps the marked words readable: the heading ink on it ≥ 7:1, the muted ink ≥ 4.5:1, in both themes", () => {
    for (const block of [lightBlock, darkBlock]) {
      expect(contrast(value(block, "--color-heading"), value(block, TOKEN))).toBeGreaterThanOrEqual(7);
      expect(contrast(value(block, "--color-text-muted"), value(block, TOKEN))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is read only as a background — by the body's note `<mark>` — and nowhere else", () => {
    expect(css).not.toMatch(/var\(--color-note-mark/);
    const root = new URL("..", import.meta.url).pathname;
    const reads: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = `${dir}/${name}`;
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !file.endsWith("app/globals.css")) {
          const source = readFileSync(file, "utf8");
          for (const match of source.matchAll(/[^\s"'`]*--color-note-mark[^\s"'`]*/g)) reads.push(`${file.slice(root.length)}: ${match[0]}`);
        }
      }
    };
    walk(root.replace(/\/$/, ""));
    expect(reads).toEqual([
      "components/reader/paper-body.tsx: bg-[color:var(--color-note-mark)]",
    ]);
  });
});

// P7-14 (R2): the reading spread's left panel pins by its TOP. It used to pin by its bottom when it
// was taller than the window — `top: min(4rem, 100vh - --panel-h - legend - 1rem)`, with `--panel-h`
// written by a ResizeObserver — so that the decision, then at the panel's bottom, stayed in view
// while the plate scrolled away. The commands are under the title now and the question box and the
// map moved to the column: `top: 4rem` and nothing to measure. A panel pinned by its top cannot show
// what is below the window, so the panel is the window's height at most. Source-text assertions, as
// above: a computed style in jsdom would not resolve `calc()` against custom properties the way a
// browser does.
//
// P11-10 (B P11-01 §2; ruling §1h.113 (a)) RE-AIM. `@utility reader-panel` — the sticky part of the old
// two-column spread's panel — is replaced by the pane rule: the left pane of the three-pane shell is
// `.reader-left`, pinned the same way. Its five tests are aimed at the new selector, each named:
//   "is sticky, with a top of 4rem ..."          same assertions on `.reader-left`
//   "has no bottom-pin arithmetic ..."           same assertions on `.reader-left`
//   "is a window-high flex column ..."           same assertions on `.reader-left` (the max-height calc is verbatim)
//   "keeps the focus ring inside the scroll port"  was `margin-inline: -6px; padding-inline: 6px`; the pane is a full-bleed column
//                                                with its own side padding, `padding-inline: 16px 8px`, no negative margin
// P11-37 (B P11-36 §3.5; BACKLOG-105) RE-AIM, two tests, no assertion weakened: under Fit the masthead (48 px) is outside the page's CSS zoom and the
// article's 1rem of top padding and the key legend are inside it, so the pane's `top` is `calc(3rem / zoom + 1rem)` (the first-paint position; 4rem at zoom
// 1) and its `max-height` is `(100vh - 4rem) / zoom - legend - 1rem` (the same lengths at zoom 1). The claims are the ones they were: "is sticky, with a top
// that is the first-paint position" and "is a window-high flex column ... that keeps the legend and a rem clear"; the painted numbers, at every Fit
// zoom, are pinned in `components/reader/left-pane.fit-top.test.ts`.
//   "keeps --legend-h ..."                       unchanged
// and the rule's new parts have tests of their own below.
describe("globals.css — the reader's left pane pins by its top (P7-14, R2; re-aimed by P11-10)", () => {
  const ruleOf = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} is in globals.css`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}", start) + 2);
  };
  const rule = ruleOf(".reader-left");

  it("replaces @utility reader-panel: the old utility is gone", () => {
    expect(css).not.toContain("@utility reader-panel");
  });

  it("is sticky, with a top of the masthead's 3rem divided by the page zoom plus the article's 1rem (4rem at zoom 1)", () => {
    expect(rule).toMatch(/position:\s*sticky;/);
    expect(rule).toMatch(/top:\s*calc\(\s*3rem\s*\/\s*var\(--page-zoom,\s*1\)\s*\+\s*1rem\s*\);/);
  });

  it("has no bottom-pin arithmetic: the top is not a min() of the window and the panel's height, and nothing reads --panel-h", () => {
    const top = /\btop:\s*([^;]*);/.exec(rule)?.[1] ?? "";

    expect(top).not.toMatch(/\bmin\(/);
    expect(top).not.toContain("100vh");
    expect(rule).not.toContain("--panel-h");
    expect(css).not.toContain("--panel-h:");
  });

  it("is a window-high flex column that scrolls only when its blocks are taller than the window", () => {
    expect(rule).toMatch(/display:\s*flex;/);
    expect(rule).toMatch(/flex-direction:\s*column;/);
    // 100vh less the 4rem above the grid, divided by the page zoom (the window is not zoomed), less the key legend and a rem of air (both inside the zoom,
    // so they stay local lengths).
    expect(rule).toMatch(/max-height:\s*calc\(\(100vh\s*-\s*4rem\)\s*\/\s*var\(--page-zoom,\s*1\)\s*-\s*var\(--legend-h\)\s*-\s*1rem\);/);
    expect(rule).toMatch(/overflow-y:\s*auto;/);
  });

  it("keeps the focus ring inside the scroll port: side padding on the pane, and no negative margin to take it back", () => {
    expect(rule).toMatch(/padding-inline:\s*16px\s+8px;/);
    expect(rule).not.toMatch(/margin-inline:/);
  });

  it("keeps --legend-h, which the key legend's own height reads", () => {
    expect(css).toMatch(/--legend-h:\s*1\.75rem;/);
  });

  // P10-21 (A P10-14 §8 item 7): at the very foot of the page the sticky part stops where its holder ends, 64 px above the window's
  // bottom at 1280 x 720, and its top (43.9 px) stood 4 px under the masthead's bottom (48 px). A -12 px bottom margin let it end
  // 12 px below the holder: its top was 55.9 px there (B P11-01 §6 item 14; measured by the C).
  //
  // P11-23 rule 1 (A P11-21 X-A1), RE-AIMED from "keeps P10-21's -12px bottom margin": 12 px was 8 px short of the 20 the pane needs (the page's 4rem of
  // bottom room less the 44 px the window-high pane keeps above the window's bottom), so the whole pane stepped up about 8 px as the page ended. The margin
  // is the whole of that room, -4rem: the holder's end never lifts the pane's top into the masthead, and never moves it at all. The rule that causes it
  // (the overhang against the page's room and the pane's clearance, at every Fit zoom) is pinned in `components/reader/left-pane.foot.test.ts`.
  it("keeps a bottom margin that is the whole of the page's foot room (-4rem; P10-21's -12px fell 8 px short), so the holder's end never lifts the pane", () => {
    expect(rule).toMatch(/margin-bottom:\s*-4rem;/);
  });

  it("is split in two when it is given a fixed zone and a scroll zone: the pane clips, the scroll zone is the one scroller", () => {
    expect(ruleOf('.reader-left[data-mode="split"]')).toMatch(/overflow:\s*hidden;/);
    const scroll = ruleOf(".reader-left-scroll");
    expect(scroll).toMatch(/flex:\s*1 1 auto;/);
    expect(scroll).toMatch(/min-height:\s*0;/);
    expect(scroll).toMatch(/overflow-y:\s*auto;/);
    expect(ruleOf(".reader-left-fixed")).toMatch(/flex:\s*none;/);
  });
});

// P11-10 rule 3 (B P11-01 §2.1, §2.3; ruling §1h.113 (a)): the grid, the rail, the peek, the dividers, the centre.
describe("globals.css — the reader's three panes (P11-10)", () => {
  const ruleOf = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} is in globals.css`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}", start) + 2);
  };

  it("the grid is the left track, a 12px divider and the reading column", () => {
    const grid = ruleOf(".reader-shell");
    expect(grid).toMatch(/display:\s*grid;/);
    expect(grid).toMatch(/grid-template-columns:\s*var\(--left-w\) 12px minmax\(0, 1fr\);/);
    expect(grid).toMatch(/--left-w:\s*var\(--left-pane-w, 320px\);/);
  });

  it("the left track is the rail's 48px in the rail and in the peek: the peek moves nothing", () => {
    const rail = ruleOf('.reader-shell[data-left-state="peek"]');
    expect(css).toContain('.reader-shell[data-left-state="rail"],\n.reader-shell[data-left-state="peek"] {');
    expect(rail).toMatch(/--left-w:\s*48px;/);
  });

  it("the rail hides the pane (it is inert as well, from the shell) and the peek draws it over the centre, below the masthead, on the tokens", () => {
    const both = ruleOf('.reader-left[data-state="peek"]');
    expect(both).toMatch(/position:\s*fixed;/);
    expect(both).toMatch(/z-index:\s*40;/);
    expect(both).toMatch(/background:\s*var\(--color-surface\);/);
    expect(both).toMatch(/border-right:\s*1px solid var\(--color-border-strong\);/);
    expect(both).toMatch(/top:\s*calc\(3rem \/ var\(--page-zoom, 1\)\);/);
    // The masthead is z-50; the peek stays under it.
    expect(Number(/z-index:\s*(\d+);/.exec(both)?.[1])).toBeLessThan(50);
    expect(ruleOf('.reader-left[data-state="rail"]')).toMatch(/visibility:\s*hidden;/);
    expect(ruleOf('.reader-left[data-state="rail"]')).toMatch(/pointer-events:\s*none;/);
    expect(css).toMatch(/\.reader-left\[data-state="peek"\] \{[^}]*box-shadow:/);
  });

  it("slides only where the reader has not asked for less motion", () => {
    const at = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .reader-left");
    expect(at).toBeGreaterThan(0);
    const media = css.slice(at, css.indexOf("\n}\n", at));
    expect(media).toContain("transform 160ms");
    // The only transitions declared on the panes are inside that block.
    const outside = css.replace(media, "");
    expect(outside).not.toMatch(/\.reader-left[^{]*\{[^}]*transition/);
  });

  it("the rail's button is not shown when the pane is pinned (the UA's [hidden] would lose to its display)", () => {
    expect(ruleOf(".reader-rail-button[hidden]")).toMatch(/display:\s*none;/);
  });

  it("the dividers are 12px of col-resize hit area with a 1px line in the strong border token, the accent on hover, focus and drag", () => {
    expect(ruleOf(".reader-divider")).toMatch(/cursor:\s*col-resize;/);
    expect(ruleOf(".reader-divider")).toMatch(/touch-action:\s*none;/);
    const hit = ruleOf(".reader-divider,\n.reader-divider-rest");
    expect(hit).toMatch(/width:\s*12px;/);
    expect(hit).toMatch(/align-self:\s*stretch;/);
    const line = ruleOf(".reader-divider::before,\n.reader-divider-rest::before");
    expect(line).toMatch(/width:\s*1px;/);
    expect(line).toMatch(/background:\s*var\(--color-border-strong\);/);
    const lit = css.slice(css.indexOf(".reader-divider:hover::before"));
    expect(lit.slice(0, lit.indexOf("\n}") + 2)).toMatch(/\.reader-divider\[data-dragging\]::before[^}]*background:\s*var\(--color-accent\);/);
  });

  it("the centre's content is capped at 38em and centred, and the prose measures are lifted inside it", () => {
    const inner = ruleOf(".reader-centre-inner");
    expect(inner).toMatch(/max-width:\s*38em;/);
    expect(inner).toMatch(/margin-inline:\s*auto;/);
    expect(ruleOf(".reader-centre .measure,\n.reader-centre .measure-paper")).toMatch(/max-width:\s*none;/);
    expect(ruleOf(".reader-centre")).toMatch(/min-width:\s*0;/);
  });

  it("the margin is an empty stretch cell with nothing drawn in it", () => {
    const margin = ruleOf(".reader-margin");
    expect(margin).toMatch(/align-self:\s*stretch;/);
    expect(margin).not.toMatch(/background|border|padding/);
  });

  // Re-aimed by the manager at P11-14's landing (§1c; ruling §1h.117): P11-14 retired the reserve, and the neutraliser this case pinned
  // went with it, as the case's own comment said it would. What it guarded — no second gutter beside the margin's own track — is now the
  // absence of both rules (and `explain-dock.retired.test.ts` pins the layout side).
  it("the shell needs no neutraliser: the old reserve is gone, so no second gutter stands beside the margin's own track", () => {
    expect(css).not.toContain(".peer-main-content");
    expect(css).not.toMatch(/padding-right:\s*var\(--explain-dock/);
  });
});

// P10-46 (P10-43's unsettled 3; BACKLOG-70): the nested shade is a clearer step from the highlighter, and the anchor
// square's blue is a token (`--color-anchor`), read where the literal `#3b82f6` was.
describe("globals.css — the nested shade and the anchor blue (P10-46)", () => {
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("/* Dark palette"));
  const darkBlock = css.slice(css.indexOf('html[data-mode="dark"] {'), css.indexOf('/* Dark palette — "system"'));
  const systemStart = css.indexOf('html[data-mode="system"] {');
  const systemBlock = css.slice(systemStart, css.indexOf("/* ── Material", systemStart));

  const value = (block: string, token: string): string => {
    const match = new RegExp(`${token}:\\s*(#[0-9a-f]{6});`).exec(block);
    if (!match) throw new Error(`${token} is not declared as a #rrggbb colour in this block`);
    return match[1];
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const s = parseInt(hex.slice(at, at + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("sets the nested mark visibly apart from the highlighter: at least 1.08:1 between them, light and dark", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      expect(contrast(value(block, "--color-note-mark"), value(block, "--color-note-nested"))).toBeGreaterThanOrEqual(1.08);
    }
  });

  it("keeps the ink on both marks at 4.5:1 (muted) and 7:1 (heading), light and dark; the highlighter stays off the page by 1.1:1 / 1.4:1", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      for (const token of ["--color-note-mark", "--color-note-nested"]) {
        expect(contrast(value(block, "--color-text-muted"), value(block, token))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(value(block, "--color-heading"), value(block, token))).toBeGreaterThanOrEqual(7);
      }
    }
    expect(contrast(value(lightBlock, "--color-note-mark"), value(lightBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.1);
    expect(contrast(value(darkBlock, "--color-note-mark"), value(darkBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.4);
  });

  it("declares --color-anchor in the light palette and both dark ones (the two dark in sync), a blue that reads on its page (3:1)", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(value(block, "--color-anchor").slice(at, at + 2), 16));
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
      expect(contrast(value(block, "--color-anchor"), value(block, "--color-bg"))).toBeGreaterThanOrEqual(3);
    }
    expect(value(systemBlock, "--color-anchor")).toBe(value(darkBlock, "--color-anchor"));
  });

  it("leaves no literal #3b82f6 in the reader's components, and the anchor square reads the token", () => {
    const root = new URL("../components", import.meta.url).pathname.replace(/\/$/, "");
    const literals: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = `${dir}/${name}`;
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && /#3b82f6/i.test(readFileSync(file, "utf8"))) literals.push(file.slice(root.length));
      }
    };
    walk(root);
    expect(literals).toEqual([]);
    expect(readFileSync(`${root}/notes/note-tags.tsx`, "utf8")).toContain("var(--color-anchor)");
  });
});
