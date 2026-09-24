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
import { readFileSync } from "node:fs";
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
