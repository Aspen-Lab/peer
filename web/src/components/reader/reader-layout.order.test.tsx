import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderLayout } from "./reader-layout";

// P7-14 (R2 + Q1, the owner's review): the commands sit directly under the title, in both
// layouts. The decision block carries them ("Read it here", Save, Copy, ...), and it used to
// stand after the question box and the map in the spread's panel, and after the abstract in the
// one-column page (a CSS re-order would have made a screen reader announce it before the
// abstract, so the DOM order was chosen on purpose). The owner asked for the commands first and
// answered Q1 "the narrow layout too": the decision block now follows the title in the DOM in
// both layouts, before the abstract, before "Before you read". `ReaderLayout` takes `spread`
// as a prop, so both structures render here with markers; nothing is mounted but the layout.

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);

function render(spread: boolean, over: Record<string, ReactNode> = {}): string {
  return renderToStaticMarkup(
    createElement(ReaderLayout, {
      spread,
      plate: mark("PLATE"),
      title: mark("TITLE"),
      ask: mark("ASK"),
      words: mark("WORDS"),
      decision: mark("DECISION"),
      additions: mark("ADDITIONS"),
      next: mark("NEXT"),
      ...over,
    }),
  );
}

const order = (html: string, names: string[]) => names.map((name) => html.indexOf(`data-mark="${name}"`));
const ascending = (indexes: number[]) => indexes.every((at, i) => at >= 0 && (i === 0 || at > indexes[i - 1]));

describe("ReaderLayout — the decision follows the title (P7-14, R2)", () => {
  it("one column: plate, title, decision, then the question box, the abstract, the additions, Next", () => {
    const html = render(false);

    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "ASK", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });

  it("one column, no question box: the decision still stands before the abstract (Q1)", () => {
    const html = render(false, { ask: undefined });

    expect(html).not.toContain("ASK");
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "WORDS", "ADDITIONS", "NEXT"]))).toBe(true);
  });

  it("the spread's panel: plate, title, decision, then the question box — and nothing of the column in it", () => {
    const html = render(true);
    const panelAt = html.indexOf("data-reader-panel");
    const columnAt = html.indexOf("xl:flex xl:flex-col");

    expect(panelAt).toBeGreaterThan(-1);
    expect(columnAt).toBeGreaterThan(panelAt);
    expect(ascending(order(html, ["PLATE", "TITLE", "DECISION", "ASK"]))).toBe(true);
    for (const name of ["PLATE", "TITLE", "DECISION", "ASK"]) {
      const at = html.indexOf(`data-mark="${name}"`);
      expect(at).toBeGreaterThan(panelAt);
      expect(at).toBeLessThan(columnAt);
    }
    // The column holds the abstract, the additions and Next, in that order.
    expect(ascending([columnAt, ...order(html, ["WORDS", "ADDITIONS", "NEXT"])])).toBe(true);
  });

  it("the spread: the decision stands before the question box even when nothing else fills the panel", () => {
    const html = render(true, { plate: null });

    expect(ascending(order(html, ["TITLE", "DECISION", "ASK"]))).toBe(true);
  });
});

describe("reader-layout.tsx source — the decision before the abstract and the question box (P7-14, R2)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reader-layout.tsx"), "utf8");
  // The two returns of `ReaderLayout`: the one-column fragment, then the spread's grid.
  const body = source.slice(source.indexOf("export function ReaderLayout"));
  const stacked = body.slice(body.indexOf("if (!p.spread)"), body.indexOf("<div className={SPREAD_GRID}"));
  const spread = body.slice(body.indexOf("<div className={SPREAD_GRID}"));

  it("renders {p.decision} right after {p.title}, before {p.ask} and {p.words}, in the one-column return", () => {
    const at = (needle: string) => stacked.indexOf(needle);

    expect(at("{p.title}")).toBeGreaterThan(-1);
    expect(at("{p.decision}")).toBeGreaterThan(at("{p.title}"));
    expect(at("{p.ask}")).toBeGreaterThan(at("{p.decision}"));
    expect(at("{p.words}")).toBeGreaterThan(at("{p.decision}"));
    expect(stacked.slice(at("{p.title}") + "{p.title}".length, at("{p.decision}")).trim()).toBe("");
  });

  it("renders {p.decision} right after {p.title}, before {p.ask}, in the spread's panel", () => {
    const at = (needle: string) => spread.indexOf(needle);

    expect(at("{p.decision}")).toBeGreaterThan(at("{p.title}"));
    expect(at("{p.ask}")).toBeGreaterThan(at("{p.decision}"));
    expect(spread.slice(at("{p.title}") + "{p.title}".length, at("{p.decision}")).trim()).toBe("");
  });

  it("no longer says the question box comes immediately after the title", () => {
    expect(source).not.toMatch(/immediately after the title/);
  });

  it("writes no panel-height variable: the panel pins by its top and needs no measuring", () => {
    expect(source).not.toContain("--panel-h");
    expect(source).not.toContain("ResizeObserver");
  });
});
