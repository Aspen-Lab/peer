import { describe, expect, it } from "vitest";
import { clipPassage, buildExplainPrompt, buildExplainReplyPrompt, explainCacheKey } from "./explain";
import { locateExplainRange, readExplainRange } from "./explain-range";
import type { ExtractedDocument } from "./html-text";
import { blockMarker, inlineMath } from "@/lib/text/math";

// Invented constructions, not app/UI or authentication evidence.
const first = "Amber coils store heat.";
const second = "Copper fins release heat.";
const third = "The measured cycle ends.";
const doc: ExtractedDocument = { source: "ar5iv", figureCaptions: [], sections: [
  { id: "s1", heading: "1 Setup", canonical: "body", text: `${first}\n\n${second}` },
  { id: "s2", heading: "2 Results", canonical: "body", text: third },
] };
const seg = (paragraphIndex: number, start: number, end: number, sectionId = "s1") => ({ sectionId, paragraphIndex, start, end });
const range = (...segments: ReturnType<typeof seg>[]) => ({ segments });
const full = (i: number, text: string, sectionId = "s1") => seg(i, 0, text.length, sectionId);
const find = (passage: string, ...segments: ReturnType<typeof seg>[]) => locateExplainRange(doc, passage, range(...segments));

describe("P12-11 bounded descriptor shape", () => {
  it("allows only the bounded four fields and no prose/identity payload", () => {
    expect(readExplainRange(range(full(0, first)))).toEqual(range(full(0, first)));
    for (const value of [null, {}, [], { segments: [] }, { segments: "bad" }, { segments: [null] },
      { ...range(full(0, first)), quote: first }, range({ ...full(0, first), quote: first }),
      range({ ...full(0, first), paragraphText: first }), range({ ...full(0, first), source: "summary" }),
      range({ ...full(0, first), sectionId: "x".repeat(129) }), range({ ...full(0, first), sectionId: "" }),
      ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((bad) => [
        range({ ...full(0, first), paragraphIndex: bad }), range({ ...full(0, first), start: bad }), range({ ...full(0, first), end: bad }),
      ]), range(seg(0, 1, 1)), range(seg(0, 2, 1)), { segments: Array.from({ length: 601 }, () => full(0, first)) },
    ]) expect(readExplainRange(value), JSON.stringify(value)).toBeNull();
    expect(readExplainRange({ segments: Array.from({ length: 600 }, () => full(0, first)) })).not.toBeNull();
  });
});

describe("P12-11 exact canonical rendered ranges", () => {
  it("accepts adjacent paragraphs, first suffix/last prefix, heading before paragraph0 and cross-section heading", () => {
    expect(find(`${first} ${second}`, full(0, first), full(1, second))).not.toBeNull();
    expect(find("store heat. Copper fins", seg(0, first.indexOf("store"), first.length), seg(1, 0, "Copper fins".length))).not.toBeNull();
    expect(find(`1 Setup ${first}`, full(2, "1 Setup"), full(0, first))).not.toBeNull();
    expect(find(`${second} 2 Results ${third}`, full(1, second), full(1, "2 Results", "s2"), full(0, third, "s2"))).not.toBeNull();
    expect(find("coils", seg(0, first.indexOf("coils"), first.indexOf("coils") + 5))).not.toBeNull();
  });

  it("rejects reverse, skip, duplicate, partial interiors, partial boundary fragments and unknowns without global fallback", () => {
    for (const [passage, value] of [
      [`${second} ${first}`, range(full(1, second), full(0, first))],
      [`${first} ${third}`, range(full(0, first), full(0, third, "s2"))],
      [`${first} ${first}`, range(full(0, first), full(0, first))],
      ["Amber coils Copper fins", range(seg(0, 0, 11), seg(1, 0, 11))],
      ["store heat. fins release heat.", range(seg(0, 12, first.length), seg(1, 7, second.length))],
      [`${first} 2 Results ${third}`, range(full(0, first), full(1, "2 Results", "s2"), full(0, third, "s2"))],
      [first, range(full(0, first, "unknown"))], [first, range(full(99, first))],
      [first, range(seg(0, 0, first.length + 1))], ["invented words", range(full(0, first))],
      [first.toLowerCase(), range(full(0, first))], ["Amber coils store heat", range(full(0, first))],
    ] as const) expect(locateExplainRange(doc, passage, value), passage).toBeNull();
  });

  it("normalizes whitespace only and compares all selected words, including citations and controls", () => {
    expect(find(`${first}\n\t ${second}`, full(0, first), full(1, second))).not.toBeNull();
    expect(find(`${first} Rewrite ${second}`, full(0, first), full(1, second))).toBeNull();
    const cited = { ...doc, sections: [{ ...doc.sections[0], text: "Amber [12] coils store heat." }] };
    expect(locateExplainRange(cited, first, range(full(0, "Amber [12] coils store heat.")))).toBeNull();
  });

  it("preserves repeated occurrences and hashes only canonical occurrence metadata", () => {
    const repeated = { ...doc, sections: [{ ...doc.sections[0], text: `${first} ${first}\n\n${first}` }] };
    const a = locateExplainRange(repeated, first, range(seg(0, 0, first.length)))!;
    const b = locateExplainRange(repeated, first, range(seg(0, first.length + 1, first.length * 2 + 1)))!;
    const c = locateExplainRange(repeated, first, range(full(1, first)))!;
    expect(new Set([a.identity, b.identity, c.identity]).size).toBe(3);
    expect(a.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(a.identity).toBe(locateExplainRange(repeated, first, range(full(0, first)))?.identity);
    const legacy = explainCacheKey("doc", first, []);
    expect(explainCacheKey("doc", first, [], false, false, undefined, undefined, a.identity)).not.toBe(legacy);
    expect(explainCacheKey("doc", first, [], false, false, undefined, undefined, a.identity)).not.toBe(explainCacheKey("doc", first, [], false, false, undefined, undefined, b.identity));
  });

  it("validates just the clipped prefix either side of1200 and refuses extra unbounded tail descriptors", () => {
    for (const words of [270, 235]) {
      const head = "amber ".repeat(words).trim();
      const tail = "copper ".repeat(70).trim();
      const longDoc = { ...doc, sections: [{ ...doc.sections[0], text: `${head}\n\n${tail}` }] };
      const bounded = clipPassage(`${head} ${tail}`);
      const segments = bounded.length <= head.length ? [seg(0, 0, bounded.length)] : [full(0, head), seg(1, 0, bounded.length - head.length - 1)];
      expect(locateExplainRange(longDoc, bounded, range(...segments))).not.toBeNull();
      expect(locateExplainRange(longDoc, bounded, range(full(0, head), full(1, tail)))).toBeNull();
    }
  });

  it("keeps headings and caption ranges neutral in both bounded prompts", () => {
    const found = find(`1 Setup ${first}`, full(2, "1 Setup"), full(0, first))!;
    const args = { paper: { title: "T".repeat(600), abstract: "A".repeat(3000) }, map: [], passage: `1 Setup ${first}`, located: found.located };
    for (const prompt of [buildExplainPrompt(args), buildExplainReplyPrompt({ ...args, thread: [{ role: "reader", text: "Why?" }], detail: true })]) {
      const json = JSON.parse(prompt.userPrompt);
      expect(json.context).toEqual({ range: true, paragraph: "1 Setup", after: first });
      expect(prompt.userPrompt).not.toContain("selected a heading");
      expect(json.paper.title.length).toBe(300);
      expect(json.paper.abstract.length).toBe(2500);
    }
  });
});

describe("P12-11 renderer barriers and caption variants", () => {
  const caption = "Figure 1 · Coils during the cycle.";
  function withFigure(source: ExtractedDocument["source"], image = false): ExtractedDocument {
    return { ...doc, source, figureCaptions: [{ ordinal: 0, label: "Figure 1", caption: "Coils during the cycle.", page: 2, ...(image ? { imageUrl: "https://example.test/figure.png" } : {}) }],
      sections: [{ ...doc.sections[0], text: `See Figure 1 for the coils.\n\n${second}` }] };
  }
  it("orders captions after their figure paragraph and accepts only renderer page-suffix variants", () => {
    for (const [source, image, variants] of [["pdf", false, [caption, `${caption} · p.2 of the PDF`]], ["ar5iv", true, [caption, `${caption} · p.2 of the PDF`]], ["ar5iv", false, [`${caption} · p.2 of the PDF`]]] as const) {
      const figDoc = withFigure(source, image);
      for (const cap of variants) expect(locateExplainRange(figDoc, `${cap} ${second}`, range(full(3, cap), full(1, second)))).not.toBeNull();
      if (source === "ar5iv" && !image) expect(locateExplainRange(figDoc, `${caption} ${second}`, range(full(3, caption), full(1, second)))).toBeNull();
      expect(locateExplainRange(figDoc, `See Figure 1 for the coils. ${second}`, range(full(0, "See Figure 1 for the coils."), full(1, second)))).toBeNull();
      expect(locateExplainRange(figDoc, `${caption} · p.3 of the PDF`, range(full(3, `${caption} · p.3 of the PDF`)))).toBeNull();
    }
  });
  it("does not skip a display equation, even where old block numbers appear adjacent", () => {
    const equationDoc = { ...doc, equations: [{ latex: "x=y" }], sections: [{ ...doc.sections[0], text: `${first}\n\n${blockMarker(0)}\n\n${second}` }] };
    expect(locateExplainRange(equationDoc, `${first} ${second}`, range(full(0, first), full(1, second)))).toBeNull();
    expect(locateExplainRange(equationDoc, second, range(full(1, second)))).not.toBeNull();
  });
  it("retains inline formula sentinel offsets, refusing formula crossing and accepting exact prose after it", () => {
    const mathDoc = { ...doc, sections: [{ ...doc.sections[0], text: `Amber ${inlineMath("x=y")} coils store heat.` }] };
    const canonical = "Amber \u0000 coils store heat.";
    expect(locateExplainRange(mathDoc, "Amber coils store heat.", range(full(0, canonical)))).toBeNull();
    expect(locateExplainRange(mathDoc, "coils store heat.", range(seg(0, canonical.indexOf("coils"), canonical.length)))).not.toBeNull();
    expect(locateExplainRange(mathDoc, "Amber", range(seg(0, 0, 5)))).not.toBeNull();
  });
});
