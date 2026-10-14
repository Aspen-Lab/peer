import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAPER_KEYS, paperKeysFor } from "@/lib/reader/reader-keys";
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
