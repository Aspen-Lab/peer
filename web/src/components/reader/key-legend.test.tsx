import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAPER_KEYS, paperKeysFor, type PaperKey } from "@/lib/reader/reader-keys";
import { KeyLegend } from "./key-legend";

// P1-08 (§1a.6, §1f.19): the legend lists the keys the page answers to — on
// an uploaded PDF's page that is every key but `x skip`; P7-12 (R4): and but
// `o open`, the page offers no "Open the PDF" command.

const entries = (html: string) => [...html.matchAll(/<span class="text-text">([^<]*)<\/span> ([^<]*)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`);

describe("KeyLegend", () => {
  it("lists the whole table by default, x skip included", () => {
    const html = renderToStaticMarkup(createElement(KeyLegend));

    expect(entries(html)).toHaveLength(PAPER_KEYS.length);
    expect(entries(html)).toContain("x skip");
    expect(entries(html)).toContain("o open");
  });

  it("with an upload's keys, lists every key but skip and open", () => {
    const html = renderToStaticMarkup(createElement(KeyLegend, { keys: paperKeysFor({ upload: true }) }));

    expect(html).not.toContain("skip");
    expect(html).not.toContain("open");
    expect(entries(html)).toHaveLength(PAPER_KEYS.length - 2);
    expect(entries(html)).toEqual(expect.arrayContaining(["j next", "s save", "c copy", "q ask"]));
  });
});

// P11-13 (rule 3): the two new keys are in the one table, so they are in the legend: `n notes` and `h highlight`.
describe("KeyLegend — the selection's keys (P11-13)", () => {
  it("says n notes and h highlight, for a paper and for an upload alike", () => {
    for (const keys of [PAPER_KEYS, paperKeysFor({ upload: true })]) {
      expect(entries(renderToStaticMarkup(createElement(KeyLegend, { keys })))).toEqual(expect.arrayContaining(["n notes", "h highlight", "e explain"]));
    }
  });
});

// P10-21 rule 7 (round 2's reader, confirmed by the director): the fixed strip at the foot of the page was a
// translucent, blurred bar (`glass-bar`), and the paper's words showed through it, garbled, while the page was
// scrolled. It takes the page's surface colour, opaque.
describe("KeyLegend — an opaque strip", () => {
  it("takes the surface background and is not glass", () => {
    const html = renderToStaticMarkup(createElement(KeyLegend));
    const tag = /<footer\b[^>]*>|<div\b[^>]*fixed[^>]*>|<nav\b[^>]*fixed[^>]*>/.exec(html)?.[0] ?? "";
    const classes = (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);

    expect(classes).toContain("bottom-0");
    expect(classes).toContain("fixed");
    expect(classes).toContain("bg-surface");
    expect(classes).not.toContain("glass-bar");
    expect(classes.some((c) => /^bg-\S+\/\d+$/.test(c) || /backdrop/.test(c))).toBe(false);
  });
});

// ── P11-17a rule 2 (BACKLOG-98, §1h.114 (d)): the line is whole at every width from 768 to 1,440 px ────────────────────
// Since P11-13 added `n` and `h`, the strip (one line, `overflow-hidden`, centred) clipped its outer entries below about
// 1,024 px. Every entry it shows must now be whole and on screen, for a public paper (14 entries) and an upload (12: no
// `x skip`, no `o open`).
//
// THE WIDTH MODEL. The legend is set in `eyebrow`: Roboto Mono 400 at `--text-caption` (11.5px), tracked `--tracking-mono`
// (0.06em). A monospace face gives every character one advance, the key cap's and the space's included, so an entry is
// `characters × CHAR_PX` wide. CHAR_PX was measured in the browser — Chromium (Playwright's chromium-1194, headless), the
// built app of 8d7ea474 at 1,280 px, light and dark alike (P11-17a's width table): the line's first entry starts at
// 137.92 px and its last ends at 1,142.06 px; less 13 gaps of 20 px that is 744.14 px for 98 characters, 7.5933 px each
// (every six-character entry 45.56 px, `Esc briefing` 91.11 px). Rounded up to 7.594. The gap and the side padding are
// read off the rendered classes (Tailwind's spacing step is 0.25rem, 4 px at the root's 16 px). The line needs
// `Σ characters × CHAR_PX + (entries − 1) × gap + 2 × padding`, and it is whole when that is no more than the window.
const CHAR_PX = 7.594;
const SPACING_PX = 4;
const WIDTHS = [768, 862, 940, 1003, 1024, 1280, 1440] as const;
/** Dropped first to last: each is taught on the page itself (the commands' own `[o]`, `[x]`, `[c]` keys), and an upload's
 *  page has neither `o open` nor `x skip`, so below 856 px every page's legend is the upload's. */
const DROPPED_FIRST_TO_LAST = ["o open", "x skip", "c copy"];
const OWNERS_THREE = ["n notes", "h highlight", "e explain"];

type Entry = { classes: string[]; text: string };

function legendLine(keys: readonly PaperKey[]) {
  const html = renderToStaticMarkup(createElement(KeyLegend, { keys }));
  const container = (/<div\b[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);
  const items: Entry[] = [...html.matchAll(/<span class="([^"]*)"><span class="text-text">([^<]*)<\/span> ([^<]*)<\/span>/g)].map((m) => ({
    classes: m[1].split(/\s+/),
    text: `${m[2]} ${m[3]}`,
  }));
  return { container, items, gap: spacing(container, "gap-x"), pad: spacing(container, "px") };
}

/** `gap-x-3` → 12, `px-4` → 16, `gap-x-[10px]` → 10. */
function spacing(classes: string[], prefix: string): number {
  for (const c of classes) {
    const step = new RegExp(`^${prefix}-(\\d+(?:\\.\\d+)?)$`).exec(c);
    if (step) return Number(step[1]) * SPACING_PX;
    const literal = new RegExp(`^${prefix}-\\[(\\d+(?:\\.\\d+)?)px\\]$`).exec(c);
    if (literal) return Number(literal[1]);
  }
  throw new Error(`no ${prefix}-* class on the legend`);
}

/** From what window width an entry is shown: always, or from its `min-[Npx]:inline`. */
function shownFrom(entry: Entry): number {
  if (!entry.classes.includes("hidden")) return 0;
  const from = entry.classes.map((c) => /^min-\[(\d+)px\]:inline$/.exec(c)?.[1]).find((n) => n !== undefined);
  return from === undefined ? Number.POSITIVE_INFINITY : Number(from);
}

function need(entries: Entry[], gap: number, pad: number): number {
  return entries.reduce((sum, e) => sum + e.text.length * CHAR_PX, 0) + Math.max(0, entries.length - 1) * gap + 2 * pad;
}

const SETS = [
  { name: "a public paper", keys: PAPER_KEYS, count: 14 },
  { name: "an upload", keys: paperKeysFor({ upload: true }), count: 12 },
];

describe("KeyLegend — whole at every width from 768 to 1,440 px (P11-17a rule 2)", () => {
  it("at 768 px with the whole table (14 entries), the entries it shows fit the line: none is clipped", () => {
    const { items, gap, pad } = legendLine(PAPER_KEYS);
    expect(items).toHaveLength(14);
    const shown = items.filter((e) => shownFrom(e) <= 768);

    expect(need(shown, gap, pad)).toBeLessThanOrEqual(768);
  });

  it("fits at every measured width, for a public paper and an upload", () => {
    for (const { name, keys, count } of SETS) {
      const { items, gap, pad } = legendLine(keys);
      expect(items, name).toHaveLength(count);
      for (const width of WIDTHS) {
        const shown = items.filter((e) => shownFrom(e) <= width);
        expect(need(shown, gap, pad), `${name} at ${width} px: ${shown.map((e) => e.text).join(", ")}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it("drops an entry only where the width needs it: at each measured width, the next one back would not fit", () => {
    for (const { name, keys } of SETS) {
      const { items, gap, pad } = legendLine(keys);
      for (const width of WIDTHS) {
        const hidden = items.filter((e) => shownFrom(e) > width);
        if (hidden.length === 0) continue;
        const nextBack = hidden.reduce((a, b) => (shownFrom(b) < shownFrom(a) ? b : a));
        const withIt = items.filter((e) => shownFrom(e) <= width || e === nextBack);
        expect(need(withIt, gap, pad), `${name} at ${width} px drops ${nextBack.text} though it fits`).toBeGreaterThan(width);
      }
    }
  });

  it("shows the whole table from 940 px up, and every entry of an upload's from 800 px up", () => {
    for (const width of [940, 1003, 1024, 1280, 1440]) {
      expect(legendLine(PAPER_KEYS).items.every((e) => shownFrom(e) <= width), `${width} px`).toBe(true);
    }
    expect(legendLine(paperKeysFor({ upload: true })).items.every((e) => shownFrom(e) <= 800)).toBe(true);
  });

  it("never drops the owner's three, and drops only o open, x skip and c copy, in that order", () => {
    const { items } = legendLine(PAPER_KEYS);
    for (const text of OWNERS_THREE) expect(shownFrom(items.find((e) => e.text === text)!), text).toBe(0);
    const droppable = items.filter((e) => shownFrom(e) > 0);
    expect(droppable.map((e) => e.text).sort()).toEqual([...DROPPED_FIRST_TO_LAST].sort());
    const from = DROPPED_FIRST_TO_LAST.map((text) => shownFrom(items.find((e) => e.text === text)!));
    expect(from).toEqual([...from].sort((a, b) => b - a));
    expect(new Set(from).size).toBe(from.length);
    for (const f of from) expect(f).toBeLessThanOrEqual(1440);
  });

  it("is one line: the strip does not wrap and no entry breaks", () => {
    const { container, items } = legendLine(PAPER_KEYS);
    expect(container).toContain("md:flex");
    expect(container.some((c) => /(^|:)flex-wrap/.test(c))).toBe(false);
    for (const e of items) expect(e.classes, e.text).toContain("whitespace-nowrap");
  });

  it("rests on what was measured: eyebrow, 11.5 px, 0.06em, Roboto Mono (change one and re-measure CHAR_PX)", () => {
    const { container } = legendLine(PAPER_KEYS);
    const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
    const eyebrow = /@utility eyebrow \{([^}]*)\}/.exec(css)?.[1] ?? "";

    expect(container).toContain("eyebrow");
    expect(css).toMatch(/--text-caption: 11\.5px;/);
    expect(css).toMatch(/--tracking-mono: 0\.06em;/);
    expect(css).toMatch(/--font-mono: var\(--font-roboto-mono\)/);
    expect(eyebrow).toMatch(/font-family: var\(--font-mono\);/);
    expect(eyebrow).toMatch(/font-size: var\(--text-caption\);/);
    expect(eyebrow).toMatch(/letter-spacing: var\(--tracking-mono\);/);
    // Roboto Mono's advance is 0.6em: 11.5 × (0.6 + 0.06) = 7.59, the measured 7.5933 to within a hundredth.
    expect(Math.abs(11.5 * (0.6 + 0.06) - CHAR_PX)).toBeLessThan(0.01);
  });
});
