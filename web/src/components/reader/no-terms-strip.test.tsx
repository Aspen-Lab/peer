import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import { ReaderLayout } from "./reader-layout";

// P10-02 (ruling §1h.78; the owner's review of 2026-10-13, item 5: "把 terms to know 这个功能删掉，代码删掉";
// rubric A13): "Terms to know" is gone from the reading page — the strip, its slot in the layout, its copy and
// the state that served only it. What stays is the paper's own definitions: `lib/papers/terms.ts` feeds the
// Tier 0 definition in "Explain this" and the plate's terms, and is not touched.
//
// A render test and source scans (no DOM in this Vitest, and `Reader` cannot be mounted here): the layout draws
// nothing for a `terms` slot even if a caller still hands one, and nothing in the source names the strip.

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);

/** The props the page gives the layout on a paper Peer has read in full — and a stray `terms`, which no caller should have. */
function render(spread: boolean): string {
  return renderToStaticMarkup(
    createElement(ReaderLayout, {
      spread,
      plate: mark("PLATE"),
      title: mark("TITLE"),
      decision: mark("DECISION"),
      tabs: mark("TABS"),
      tab: "digestion",
      common: mark("COMMON"),
      words: mark("WORDS"),
      additions: mark("ADDITIONS"),
      next: mark("NEXT"),
      terms: mark("Terms to know"),
    } as never),
  );
}

const root = resolve(process.cwd(), "src");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = `${dir}/${name}`;
    if (statSync(file).isDirectory()) return sources(file);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}
/** The code of a file, its comments dropped: a comment that remembers the strip is not the strip. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("the reader renders no 'Terms to know' (P10-02, review item 5, A13)", () => {
  it("the layout draws no terms slot, in one column or on the spread, whatever a caller hands it", () => {
    for (const spread of [false, true]) {
      const html = render(spread);
      expect(html).not.toContain("Terms to know");
      expect(html).not.toContain('data-mark="Terms to know"');
      // The remaining blocks are all there, in the order they were.
      const order = ["PLATE", "TITLE", "DECISION", "TABS", "COMMON", "WORDS", "ADDITIONS", "NEXT"].map((name) => html.indexOf(`data-mark="${name}"`));
      expect(order.every((index) => index >= 0)).toBe(true);
    }
  });

  it("reader-layout.tsx has no `terms` prop and no terms slot", () => {
    const layout = read("src/components/reader/reader-layout.tsx");

    expect(layout).not.toMatch(/\bterms\??:/);
    expect(layout).not.toContain("p.terms");
  });

  it("the strip's file, its tests and its copy are deleted", () => {
    for (const file of ["terms-strip.tsx", "terms-strip.test.tsx", "terms-strip.escape.test.tsx"]) {
      expect(existsSync(resolve(root, "components/reader", file))).toBe(false);
    }
    expect("TERMS" in copy).toBe(false);
  });

  it("no source file names the strip, imports it, or carries its heading; the page hands the layout no terms slot", () => {
    const hits: string[] = [];
    for (const file of sources(root)) {
      const text = code(readFileSync(file, "utf8"));
      if (/["'`]Terms to know["'`]|TermsStrip|terms-strip|\bTERMS\b\.|import[^;]*\bTERMS\b/.test(text)) hits.push(file.slice(root.length + 1));
    }

    expect(hits).toEqual([]);
    expect(code(read("src/app/papers/[id]/page.tsx"))).not.toMatch(/^\s*terms=\{\s*$/m);
  });

  it("the paper's own definitions still feed 'Explain this' and the plate: the page still hands the box its terms", () => {
    const page = read("src/app/papers/[id]/page.tsx");

    expect(page).toMatch(/<ExplainBox [^>]*terms=\{terms\}/);
    expect(page).toContain("mergeTerms(tier0Terms, report?.terms)");
    expect(page).toMatch(/terms=\{plateTerms\}/);
  });
});
