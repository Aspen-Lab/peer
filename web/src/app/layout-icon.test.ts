import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TAB-ICON-THEME round 3 (ABC-JEV-INTEGRATION.md §1am, finding F2).
//
// Round-2 A2 (docs/jev-abc/TAB-ICON-THEME-A2-20260928T042554Z.md, Check 6 /
// mutation M2) proved that dropping `id="peer-tab-icon"` from layout.tsx's
// hand-authored `<link>` fails ZERO of the existing tests: tab-icon.ts's
// `paintTabIcon()` is deliberately defensive
// (`if (!link) return;`), so a dropped/typo'd id would make the tab icon
// simply freeze at its last-painted colours forever, with no test failure,
// no console error, and no visible glitch on the theme active at the time —
// the same silent-failure shape as the round-1 bug this whole feature
// exists to fix (docs/jev-abc/TAB-ICON-THEME-A-20260928T031927Z.md: a
// second, un-themed icon link competing with ours after navigation).
//
// This file is the guard §1am asks for. It reads layout.tsx as TEXT rather
// than rendering it, for two reasons: (1) this repo's tests run in Vitest's
// Node environment with no jsdom (see tab-icon.test.ts's own header
// comment) — there is no DOM to render a Server Component into here; (2)
// even with a DOM available, the actual risk is upstream of rendering
// (someone edits the JSX and drops/renames the id, or Next's file-based
// icon.svg/apple-icon.svg/favicon.ico metadata convention silently comes
// back because a file with one of those names reappears under app/) — a
// source-text + filesystem check catches both directly, the same
// established pattern this repo already uses for CSS
// (src/app/globals.css.test.ts: `readFileSync(new URL("./globals.css",
// import.meta.url), "utf8")`) and for directory scans
// (src/lib/env/no-client-dev-flags.test.ts's recursive `sourceFiles()`).
// Paths below are resolved relative to THIS file via `import.meta.url`, not
// `process.cwd()`, so the test is independent of where vitest is invoked
// from.

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const LAYOUT_PATH = path.join(APP_DIR, "layout.tsx");
const PUBLIC_ICON_PATH = path.join(APP_DIR, "..", "..", "public", "icon.svg");

/** Every file under `dir`, recursively — same shape as the existing
 *  `sourceFiles()` helper in no-client-dev-flags.test.ts, minus the
 *  extension filter (here we want to catch a file of ANY extension named
 *  icon, apple-icon or favicon — e.g. icon.png or favicon.ico). */
function filesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesRecursive(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

describe("layout.tsx — the tab-icon <link> can't silently disappear (§1am F2)", () => {
  it('contains exactly one icon <link> with rel="icon", id="peer-tab-icon", href="/icon.svg", type="image/svg+xml"', () => {
    const source = fs.readFileSync(LAYOUT_PATH, "utf8");

    // `[^>]*` matches across newlines by default (unlike `.`, a negated
    // character class needs no `s`/dotall flag) — tolerates the tag's
    // attributes being spread one-per-line, in any order, exactly as
    // layout.tsx actually formats them.
    const linkTags = source.match(/<link\b[^>]*>/g) ?? [];
    const iconLinks = linkTags.filter((tag) => /\brel\s*=\s*"icon"/.test(tag));

    expect(iconLinks).toHaveLength(1);
    const tag = iconLinks[0];
    expect(tag).toMatch(/\bid\s*=\s*"peer-tab-icon"/);
    expect(tag).toMatch(/\bhref\s*=\s*"\/icon\.svg"/);
    expect(tag).toMatch(/\btype\s*=\s*"image\/svg\+xml"/);
  });

  it("has no icon.*/apple-icon.*/favicon.* file anywhere under src/app (Next's file-based metadata icon must never silently come back)", () => {
    const offenders = filesRecursive(APP_DIR)
      .map((full) => path.relative(APP_DIR, full).replace(/\\/g, "/"))
      .filter((rel) => /(^|\/)(icon|apple-icon|favicon)\.[^/]+$/i.test(rel));

    expect(offenders).toEqual([]);
  });

  it("web/public/icon.svg exists — the no-JS / first-paint fallback stays in place", () => {
    expect(fs.existsSync(PUBLIC_ICON_PATH)).toBe(true);
  });
});
