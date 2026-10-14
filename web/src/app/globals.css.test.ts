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

// P1-05 (§1f.13, §1f.14): the route's three tints. Light greens on the light
// palette (read the deepest, skim the faintest), low-luminance greens on the
// dark one, in every palette block (the dark palette is written twice), and
// used as a background only — never as a text colour, never anywhere else.
describe("globals.css — the route tint tokens (P1-05)", () => {
  const TOKENS = ["--color-route-read", "--color-route-background", "--color-route-skim"] as const;
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

  it("declares the three tokens in the light palette and in both dark palettes", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      for (const token of TOKENS) expect(() => value(block, token)).not.toThrow();
    }
  });

  it("keeps the two dark palettes in sync", () => {
    for (const token of TOKENS) expect(value(systemBlock, token)).toBe(value(darkBlock, token));
  });

  it("light: three light greens, read the deepest and skim the faintest", () => {
    const [read, background, skim] = TOKENS.map((token) => value(lightBlock, token));
    for (const tint of [read, background, skim]) {
      expect(isGreen(tint)).toBe(true);
      expect(luminance(tint)).toBeGreaterThan(0.7);
    }
    expect(luminance(read)).toBeLessThan(luminance(background));
    expect(luminance(background)).toBeLessThan(luminance(skim));
  });

  it("dark: three low-luminance greens, read the furthest from the dark ground", () => {
    const [read, background, skim] = TOKENS.map((token) => value(darkBlock, token));
    const ground = value(darkBlock, "--color-bg");
    for (const tint of [read, background, skim]) {
      expect(isGreen(tint)).toBe(true);
      expect(luminance(tint)).toBeLessThan(0.1);
      expect(luminance(tint)).toBeGreaterThan(luminance(ground));
    }
    expect(luminance(read)).toBeGreaterThan(luminance(background));
    expect(luminance(background)).toBeGreaterThan(luminance(skim));
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
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-read)]",
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-background)]",
      "components/reader/paper-body.tsx: bg-[color:var(--color-route-skim)]",
    ]);
  });
});

// P3-01 (§1h.1): the highlight a clicked term leaves in the body. A neutral
// grey in every palette block — none of the route's greens, so a marked word
// is never mistaken for a tier — used as a background only, by the body's one
// `<mark>`; the palette's muted and heading ink stay readable on it.
describe("globals.css — the term highlight token (P3-01)", () => {
  const TOKEN = "--color-term-mark";
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

  it("is a neutral grey, never one of the route's greens", () => {
    for (const block of [lightBlock, darkBlock]) {
      const [r, g, b] = channels(value(block, TOKEN));
      expect(r === g && g === b).toBe(true);
      for (const green of ["--color-route-read", "--color-route-background", "--color-route-skim"]) {
        expect(value(block, TOKEN)).not.toBe(value(block, green));
      }
    }
  });

  it("is a tint on its ground: darker than the light ground, lighter than the dark one, and visibly off both", () => {
    expect(luminance(value(lightBlock, TOKEN))).toBeLessThan(luminance(value(lightBlock, "--color-bg")));
    expect(luminance(value(darkBlock, TOKEN))).toBeGreaterThan(luminance(value(darkBlock, "--color-bg")));
    expect(contrast(value(lightBlock, TOKEN), value(lightBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.15);
    expect(contrast(value(darkBlock, TOKEN), value(darkBlock, "--color-bg"))).toBeGreaterThanOrEqual(1.4);
  });

  it("keeps the marked words readable: the heading ink on it ≥ 7:1, the muted ink ≥ 4.5:1, in both themes", () => {
    for (const block of [lightBlock, darkBlock]) {
      expect(contrast(value(block, "--color-heading"), value(block, TOKEN))).toBeGreaterThanOrEqual(7);
      expect(contrast(value(block, "--color-text-muted"), value(block, TOKEN))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is read only as a background — by the body's `<mark>` — and nowhere else", () => {
    expect(css).not.toMatch(/var\(--color-term-mark/);
    const root = new URL("..", import.meta.url).pathname;
    const reads: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = `${dir}/${name}`;
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !file.endsWith("app/globals.css")) {
          const source = readFileSync(file, "utf8");
          for (const match of source.matchAll(/[^\s"'`]*--color-term-mark[^\s"'`]*/g)) reads.push(`${file.slice(root.length)}: ${match[0]}`);
        }
      }
    };
    walk(root.replace(/\/$/, ""));
    expect(reads).toEqual([
      "components/reader/paper-body.tsx: bg-[color:var(--color-term-mark)]",
    ]);
  });
});

// P7-14 (R2): the reading spread's left panel pins by its TOP. It used to pin by its bottom when it
// was taller than the window — `top: min(4rem, 100vh - --panel-h - legend - 1rem)`, with `--panel-h`
// written by a ResizeObserver — so that the decision, then at the panel's bottom, stayed in view
// while the plate scrolled away. The commands are under the title now and the question box and the
// map moved to the column: `top: 4rem` and nothing to measure. A panel pinned by its top cannot show
// what is below the window, so the panel is the window's height at most: a flex column that scrolls as
// one (P9-04: nothing inside it scrolls or shrinks on its own — the Terms strip is an ordinary block in
// it, shown whole, where it had been a window of its own at the panel's foot; on a phone, in one column,
// it folds to two terms with a toggle). Source-text assertions, as above: a computed style in jsdom
// would not resolve `calc()` against custom properties the way a browser does.
describe("globals.css — the reader panel pins by its top (P7-14, R2)", () => {
  const utility = css.slice(css.indexOf("@utility reader-panel {"));
  const rule = utility.slice(0, utility.indexOf("\n}") + 2);

  it("is sticky, with a top of 4rem divided by the page zoom", () => {
    expect(rule).toMatch(/position:\s*sticky;/);
    expect(rule).toMatch(/top:\s*calc\(\s*4rem\s*\/\s*var\(--page-zoom,\s*1\)\s*\);/);
  });

  it("has no bottom-pin arithmetic: the top is not a min() of the window and the panel's height, and nothing reads --panel-h", () => {
    const top = /\btop:\s*([^;]*);/.exec(rule)?.[1] ?? "";

    expect(top).not.toMatch(/\bmin\(/);
    expect(top).not.toContain("100vh");
    expect(rule).not.toContain("--panel-h");
    expect(css).not.toContain("--panel-h:");
  });

  it("is a window-high flex column that scrolls only when its fixed blocks are taller than the window", () => {
    expect(rule).toMatch(/display:\s*flex;/);
    expect(rule).toMatch(/flex-direction:\s*column;/);
    // 100vh less the top (4rem), the key legend and a rem of air — each divided by the page zoom, as `top` is.
    expect(rule).toMatch(/max-height:\s*calc\(\(100vh\s*-\s*4rem\s*-\s*var\(--legend-h\)\s*-\s*1rem\)\s*\/\s*var\(--page-zoom,\s*1\)\);/);
    expect(rule).toMatch(/overflow-y:\s*auto;/);
  });

  it("keeps the focus ring inside the scroll port: 6px of side padding taken back by a negative margin", () => {
    expect(rule).toMatch(/margin-inline:\s*-6px;/);
    expect(rule).toMatch(/padding-inline:\s*6px;/);
  });

  it("keeps --legend-h, which the key legend's own height reads", () => {
    expect(css).toMatch(/--legend-h:\s*1\.75rem;/);
  });
});
