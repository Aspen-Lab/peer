import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingQuote } from "@/lib/papers/reading";
import { QuoteList } from "./quote-list";

// P11-32 (§1h.130; C P11-28's unsettled 5): a quote list never repeats a key. `QuoteList` keyed each sentence by its heading and its words, so a reading with two
// identical quotes under one heading (the same sentence twice in a section, or two sections that share a heading) made React log "Encountered two children with the
// same key" and raised the dev overlay. The server renderer does not look for repeated keys (it logged nothing for the pair below), so this reads the keys off the
// element tree `QuoteList` returns, which is what React's own reconciler reads. Every text is invented.

const section = (heading: string): ReadingQuote["from"] => ({ kind: "section", heading, canonical: "results" });
const figure = (label: string): ReadingQuote["from"] => ({ kind: "figure", heading: label, canonical: "figure" });
const quote = (text: string, from: ReadingQuote["from"] = section("3 Results")): ReadingQuote => ({ text, from });

/** The keys of every `<li>` in what `QuoteList` returns, in order. `QuoteList` has no hooks, so it is called as the function it is. */
function keysOf(quotes: ReadingQuote[]): Array<string | null> {
  const keys: Array<string | null> = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isValidElement<{ children?: ReactNode }>(node)) return;
    if (node.type === "li") keys.push(node.key);
    walk(node.props.children);
  };
  walk(QuoteList({ block: "findings", quotes }));
  return keys;
}

describe("QuoteList — a key is never repeated (P11-32)", () => {
  it("gives two identical quotes under one heading two different keys", () => {
    const twice = quote("Samples were held at fixed stress.");
    const keys = keysOf([twice, { ...twice }]);

    expect(keys).toHaveLength(2);
    expect(keys.every((key) => typeof key === "string" && key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it("gives three of them, and a figure's caption repeated, a key each", () => {
    const sentence = quote("The rate rose with stress.");
    const caption = quote("Creep against density.", figure("Figure 1"));
    const keys = keysOf([sentence, caption, { ...sentence }, { ...caption }, { ...sentence }]);

    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(5);
  });

  it("keeps the keys of quotes that never collided distinct too: the same words under two headings, two sentences under one", () => {
    const keys = keysOf([
      quote("The rate rose with stress.", section("3 Results")),
      quote("The rate rose with stress.", section("4 Discussion")),
      quote("Samples were held at fixed stress.", section("3 Results")),
    ]);

    expect(new Set(keys).size).toBe(3);
  });

  it("gives the same list the same keys each time it is drawn (stable: nothing random, nothing of the clock)", () => {
    const twice = quote("Samples were held at fixed stress.");
    const list = [twice, { ...twice }, quote("The rate rose with stress.")];

    expect(keysOf(list)).toEqual(keysOf(list));
  });

  it("changes neither the words nor their order: both copies are drawn, where they stood", () => {
    const twice = quote("Samples were held at fixed stress.");
    const html = renderToStaticMarkup(
      createElement(QuoteList, {
        block: "findings",
        quotes: [quote("First, a different sentence."), twice, { ...twice }, quote("Last, another sentence.")],
      }),
    );
    const order = ["First, a different sentence.", "Samples were held at fixed stress.", "Samples were held at fixed stress.", "Last, another sentence."];
    const at: number[] = [];
    let from = 0;
    for (const words of order) {
      const index = html.indexOf(words, from);
      expect(index, words).toBeGreaterThanOrEqual(from);
      at.push(index);
      from = index + words.length;
    }
    expect(html.split("Samples were held at fixed stress.").length - 1).toBe(2);
  });

  it("draws nothing for no quotes, as it did", () => {
    expect(keysOf([])).toEqual([]);
    expect(renderToStaticMarkup(createElement(QuoteList, { block: "findings", quotes: [] }))).toBe("");
  });
});
