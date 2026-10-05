import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAPER_KEYS, paperKeysFor } from "@/lib/reader/reader-keys";
import { KeyLegend } from "./key-legend";

// P1-08 (§1a.6, §1f.19): the legend lists the keys the page answers to — on
// an uploaded PDF's page that is every key but `x skip`.

const entries = (html: string) => [...html.matchAll(/<span class="text-text">([^<]*)<\/span> ([^<]*)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`);

describe("KeyLegend", () => {
  it("lists the whole table by default, x skip included", () => {
    const html = renderToStaticMarkup(createElement(KeyLegend));

    expect(entries(html)).toHaveLength(PAPER_KEYS.length);
    expect(entries(html)).toContain("x skip");
  });

  it("with an upload's keys, lists every key but skip", () => {
    const html = renderToStaticMarkup(createElement(KeyLegend, { keys: paperKeysFor({ upload: true }) }));

    expect(html).not.toContain("skip");
    expect(entries(html)).toHaveLength(PAPER_KEYS.length - 1);
    expect(entries(html)).toEqual(expect.arrayContaining(["j next", "s save", "c copy", "q ask"]));
  });
});
