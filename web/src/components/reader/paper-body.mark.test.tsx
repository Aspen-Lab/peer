import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import { inlineMath } from "@/lib/text/math";
import type { Paper } from "@/types";
import { goToPassage } from "@/components/notes/note-tags";
import { PaperBody, coveringSegments, paragraphAnchor, readSelection, type CoveringSegment, type SelectionLike } from "./paper-body";

// P10-09f (review 7.1c; walk X-B3, B11; rules 2 and 4): the highlighter. The words a sticky note was taken on stay
// marked in the paper — a `<mark data-note="N">` in the highlighter token — with the note's tag [N] right after
// them, not at the paragraph's end; two notes in one paragraph each mark their own words; a note whose range the
// text no longer holds draws no mark and its tag stands at the paragraph's end. The mark never changes the paragraph's
// text, its order or the selection behaviour. Every text is invented.

const paper: Paper = {
  id: "p1", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const FORMULA_PARAGRAPH = `The load ${inlineMath("x_{1}")} meets the grain boundaries twice.`;
const doc: ExtractedDocument = {
  source: "pdf", pageCount: 2, figureCaptions: [], equations: [],
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", text: `Creep limits the life.\n\nGrain boundaries carry the strain.\n\n${FORMULA_PARAGRAPH}`, page: 1 },
  ],
};
const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } };
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
const P1 = "Grain boundaries carry the strain.";
const P2 = reading.body[0].paragraphs[2];

const spot = (id: string, n: number, text: string, start: number, end: number) => ({ id, n, start, end, quote: text.slice(start, end) });
const render = (noteAnchors?: Record<string, ReturnType<typeof spot>[] | { id: string; n: number }[]>) =>
  renderToStaticMarkup(createElement(PaperBody, { reading, ...(noteAnchors ? { noteAnchors } : {}) }));
const paragraphHtml = (html: string, i: number) => {
  const from = html.indexOf(`<div id="${paragraphAnchor(0, i)}"`);
  return html.slice(from, html.indexOf("</p>", from) + 4);
};
const TAG = (n: number) => `<sup[^>]*>\u2060<button[^>]*aria-label="Open note ${n}"[^>]*>\\[${n}\\]</button></sup>`;

describe("PaperBody — the words a sticky was taken on are marked", () => {
  it("wraps the anchored words in <mark data-note> and puts the tag right after them", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16)] }), 1);
    expect(html).toMatch(new RegExp(`<p><mark data-note="1"[^>]*>Grain boundaries</mark>${TAG(1)} carry the strain\\.</p>`));
  });

  it("marks each note's own words in one paragraph, each with its own tag after its own words", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5), spot("b", 2, P1, 17, 22)] }), 1);
    expect(html).toMatch(
      new RegExp(`<p><mark data-note="1"[^>]*>Grain</mark>${TAG(1)} boundaries <mark data-note="2"[^>]*>carry</mark>${TAG(2)} the strain\\.</p>`),
    );
  });

  // Re-aimed (§1c, P10-43): the later note's mark no longer starts only where the earlier ends; its first words, inside the
  // earlier mark, are marked too (a nested part, `data-note-part`). Kept: the earlier mark and its tag, then the later note's
  // mark after that tag and its own tag after its own end; two marks of `data-note`, and the marks never cross.
  it("gives an overlapping note's mark after the earlier tag, and its own tag after its own end (P10-43: its first words are marked inside the earlier mark as well)", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(html).toMatch(new RegExp(`</mark>${TAG(1)}<mark data-note="2"[^>]*> carry</mark>${TAG(2)} the strain\\.</p>`));
    expect(html.match(/<mark data-note=/g)).toHaveLength(2);
    expect(html.match(/<mark\b/g)).toHaveLength(3);
  });

  it("draws a note taken inside another's words as its own mark inside the outer one, its tag right after its own words (P10-20)", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 16)] }), 1);
    expect(html).toMatch(
      new RegExp(`<p><mark data-note="1"[^>]*>Grain <mark data-note="2"[^>]*>boundaries</mark>${TAG(2)}</mark>${TAG(1)} carry the strain\\.</p>`),
    );
    expect(html.match(/<mark\b/g)).toHaveLength(2);
  });

  it("draws equal ranges as two marks, the earlier note outside; and three in one paragraph (P10-20)", () => {
    const equal = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 2, P1, 6, 16), spot("b", 4, P1, 6, 16)] }), 1);
    expect(equal).toMatch(new RegExp(`Grain <mark data-note="2"[^>]*><mark data-note="4"[^>]*>boundaries</mark>${TAG(4)}</mark>${TAG(2)} carry`));
    const three = paragraphHtml(
      render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 22), spot("b", 2, P1, 6, 22), spot("c", 3, P1, 6, 16)] }),
      1,
    );
    expect(three.match(/<mark\b/g)).toHaveLength(3);
    expect(three).toMatch(
      new RegExp(
        `<mark data-note="1"[^>]*>Grain <mark data-note="2"[^>]*><mark data-note="3"[^>]*>boundaries</mark>${TAG(3)} carry</mark>${TAG(2)}</mark>${TAG(1)} the strain`,
      ),
    );
  });

  it("gives an inner mark a second shade, and the third shares it; the outer keeps the highlighter token (P10-20)", () => {
    const html = paragraphHtml(
      render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 22), spot("b", 2, P1, 6, 22), spot("c", 3, P1, 6, 16)] }),
      1,
    );
    const open = (n: number) => new RegExp(`<mark data-note="${n}"[^>]*>`).exec(html)![0];
    expect(open(1)).toContain("bg-[color:var(--color-note-mark)]");
    for (const n of [2, 3]) {
      expect(open(n)).toContain("bg-[color:var(--color-note-nested)]");
      expect(open(n)).not.toContain("--color-note-mark)");
    }
  });

  it("ends a mark at its last word: the space the selection ran on over stands after the tag, not before it (P10-20)", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [{ id: "a", n: 1, start: 0, end: 17, quote: "Grain boundaries" }] }), 1);
    expect(html).toMatch(new RegExp(`<p><mark data-note="1"[^>]*>Grain boundaries</mark>${TAG(1)} carry the strain\\.</p>`));
  });

  // Re-aimed (§1c, P10-43): an overlapping pair used to draw no nested shade; the overlap now does (the later note's words inside the earlier mark).
  it("draws an overlapping pair's marks level, the overlap alone in the nested shade (P10-20, P10-43)", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(html.match(/--color-note-nested/g)).toHaveLength(1);
    expect(/<mark data-note="1"[^>]*>/.exec(html)![0]).toContain("--color-note-mark");
    expect(/<mark data-note="2"[^>]*>/.exec(html)![0]).toContain("--color-note-mark");
  });

  // Re-aimed (§1c, P10-35 rule 1): the second half — a range the text no longer holds — used to draw the tag at the paragraph's
  // end; a mark and a tag are never drawn where the paragraph does not hold the note's words, so it now draws neither (the quote
  // "Grains" is nowhere in this body). A note with no range keeps its tag at the paragraph's end.
  it("draws the tag at the paragraph's end, and no mark, for a note with no range; nothing at all for a range the text no longer holds", () => {
    const none = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [{ id: "a", n: 1 }] }), 1);
    expect(none).not.toContain("<mark");
    expect(none).toMatch(new RegExp(`<p>${P1.replace(".", "\\.")}${TAG(1)}</p>`));
    const stale = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [{ id: "a", n: 1, start: 0, end: 5, quote: "Grains" }] }), 1);
    expect(stale).not.toContain("<mark");
    expect(stale).not.toContain("Open note");
    expect(stale).toContain(`<p>${P1}</p>`);
  });

  it("marks words that follow a formula without disturbing it, and never a range that cuts one", () => {
    const start = P2.indexOf("grain boundaries");
    const html = paragraphHtml(render({ [paragraphAnchor(0, 2)]: [spot("a", 1, P2, start, start + 16)] }), 2);
    expect(html).toContain('<annotation encoding="application/x-tex">x_{1}</annotation>');
    expect(html).toMatch(/<mark data-note="1"[^>]*>grain boundaries<\/mark>/);
    const cut = paragraphHtml(render({ [paragraphAnchor(0, 2)]: [spot("a", 1, P2, 4, 14)] }), 2);
    expect(cut).not.toContain("<mark");
  });

  it("is drawn in the highlighter token, a background only, with the paragraph's own ink", () => {
    const tag = /<mark[^>]*>/.exec(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5)] }))![0];
    expect(tag).toContain("bg-[color:var(--color-note-mark)]");
    expect(tag).toContain("text-inherit");
    expect(tag).not.toMatch(/route-(?:strong|medium|faint|background)/);
  });

  it("changes nothing else: without its marks and tags the body is the body without notes", () => {
    const bare = render();
    const marked = render({
      [paragraphAnchor(0, 0)]: [{ id: "z", n: 3 }],
      [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 5), spot("b", 2, P1, 17, 22)],
    });
    const stripped = marked.replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "").replace(/<sup[^>]*>.*?<\/sup>/g, "");
    expect(stripped).toBe(bare);
    expect(render({})).toBe(bare);
  });

  it("keeps the text of a paragraph with a formula, in order, when a range is marked after the formula", () => {
    const at = P2.indexOf("grain");
    const text = (html: string) => paragraphHtml(html, 2).replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "");
    expect(text(render({ [paragraphAnchor(0, 2)]: [spot("c", 4, P2, at, at + 5)] }))).toBe(text(render()));
  });
});

// ── A selection inside a mark is still a target ─────────────────────────────

interface Stub {
  id: string;
  nodeType: number;
  tag: string;
  parentElement: Stub | null;
  closest(selector: string): Stub | null;
}
function stub(tag: string, id: string, parent: Stub | null, inBody = true): Stub {
  const self: Stub = {
    id, nodeType: 1, tag, parentElement: parent,
    closest(selector) {
      if (selector === "#paper-body") return inBody ? self : null;
      if (selector === "p") {
        for (let at: Stub | null = self; at; at = at.parentElement) if (at.tag === "p") return at;
      }
      return null;
    },
  };
  return self;
}

describe("a selection inside a mark", () => {
  const host = stub("div", paragraphAnchor(0, 1), null);
  const p = stub("p", "", host);
  const mark = stub("mark", "", p);
  const inside = { nodeType: 3, parentElement: mark };
  const plainWords = { nodeType: 3, parentElement: p };
  const rect = { left: 10, top: 10, right: 90, bottom: 30 };
  const selection = (start: unknown, end: unknown): SelectionLike => {
    const range = {
      startContainer: start, endContainer: end, endOffset: 3, cloneRange: () => range,
      cloneContents: () => ({ querySelector: () => null }), getClientRects: () => [rect], getBoundingClientRect: () => rect,
    };
    return { rangeCount: 1, isCollapsed: false, toString: () => "boundaries carry", getRangeAt: () => range } as unknown as SelectionLike;
  };

  it("is still a target of its paragraph, whether it sits wholly in the mark or runs out of it", () => {
    expect(readSelection(selection(inside, inside))).toMatchObject({ sectionIndex: 0, paragraphIndex: 1, passage: "boundaries carry", paragraphId: paragraphAnchor(0, 1) });
    expect(readSelection(selection(inside, plainWords))).toMatchObject({ paragraphId: paragraphAnchor(0, 1) });
    expect(readSelection(selection(plainWords, inside))).toMatchObject({ paragraphId: paragraphAnchor(0, 1) });
  });

  it("lies inside the paragraph's <p>, where the selection reads from", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16)] }), 1);
    expect(html.indexOf("<p>")).toBeLessThan(html.indexOf("<mark"));
    expect(html.indexOf("</mark>")).toBeLessThan(html.indexOf("</p>"));
  });
});

// ── The second shade of a nested mark (P10-20) ──────────────────────────────

describe("the nested mark's token", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const TOKEN = "--color-note-nested";
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("/* Dark palette"));
  const darkBlock = css.slice(css.indexOf('html[data-mode="dark"] {'), css.indexOf('/* Dark palette — "system"'));
  const systemStart = css.indexOf('html[data-mode="system"] {');
  const systemBlock = css.slice(systemStart, css.indexOf("/* ── Material", systemStart));
  const value = (block: string, token: string) => new RegExp(`${token}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1] ?? "";
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const s = parseInt(hex.slice(at, at + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("is declared in every palette block, differs from the highlighter, and keeps the muted ink at 4.5:1", () => {
    for (const block of [lightBlock, darkBlock, systemBlock]) {
      expect(value(block, TOKEN)).toMatch(/^#[0-9a-f]{6}$/);
      expect(value(block, TOKEN)).not.toBe(value(block, "--color-note-mark"));
      expect(contrast(value(block, "--color-text-muted"), value(block, TOKEN))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(value(block, "--color-heading"), value(block, TOKEN))).toBeGreaterThanOrEqual(7);
    }
    expect(value(systemBlock, TOKEN)).toBe(value(darkBlock, TOKEN));
  });
});

// ── P10-43 (A P10-27 §5 (a)): an overlapping note's mark covers all its words ──────────────────────────────────────
// A note whose selection starts inside an earlier note's mark and ends after it used to draw its own mark only over the
// words after the earlier tag; its first words wore the earlier note's mark alone. Now the later note's mark covers all its
// words: where the two overlap, the overlap carries both (the nested shade P10-20 uses for a mark inside a mark), and each
// tag still stands right after its own note's last word.
describe("an overlapping note's mark covers all its words (P10-43)", () => {
  type Seg = CoveringSegment;
  /** `[n@depth …]n` a note's mark with its tag after; `(n@depth …)` the part of a later note's mark that lies inside an earlier mark (no tag). */
  const tree = (segments: Seg[]): string =>
    segments
      .map((one) => {
        if (one.kind === "text") return P1.slice(one.from, one.to);
        if (one.kind === "tag") return `<tag${one.spot.n}>`;
        return one.part ? `(${one.spot.n}@${one.depth} ${tree(one.inner)})` : `[${one.spot.n}@${one.depth} ${tree(one.inner)}]${one.spot.n}`;
      })
      .join("");
  const words = (segments: Seg[]): string => segments.map((one) => (one.kind === "text" ? P1.slice(one.from, one.to) : one.kind === "mark" ? words(one.inner) : "")).join("");
  const partsOf = (segments: Seg[], n: number): string[] =>
    segments.flatMap((one) =>
      one.kind === "mark" ? [...(one.spot.n === n ? [words(one.inner)] : []), ...partsOf(one.inner, n)] : [],
    );

  it("outer: a note taken inside another's words is its own mark inside it, as before", () => {
    expect(tree(coveringSegments(P1, [spot("a", 1, P1, 0, 22), spot("b", 2, P1, 6, 16)]))).toBe(`[1@0 Grain [2@1 boundaries]2 carry]1 the strain.`);
  });

  it("overlapping-start: the later note's first words, inside the earlier mark, carry both; the rest follows the earlier tag", () => {
    const segments = coveringSegments(P1, [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)]);
    expect(tree(segments)).toBe(`[1@0 Grain (2@1 boundaries)]1[2@0  carry]2 the strain.`);
    expect(partsOf(segments, 2).join("")).toBe("boundaries carry");
  });

  it("overlapping-end: the same when the later-numbered note is the one that starts first", () => {
    const segments = coveringSegments(P1, [spot("a", 2, P1, 0, 16), spot("b", 1, P1, 6, 22)]);
    expect(tree(segments)).toBe(`[2@0 Grain (1@1 boundaries)]2[1@0  carry]1 the strain.`);
  });

  it("after: a note on later words is untouched", () => {
    expect(tree(coveringSegments(P1, [spot("a", 1, P1, 0, 16), spot("b", 3, P1, 27, 33)]))).toBe(`[1@0 Grain boundaries]1 carry the [3@0 strain]3.`);
  });

  it("four on one paragraph (outer, inside, overlapping, after): every note's words are all marked, and the text is the paragraph", () => {
    const segments = coveringSegments(P1, [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 12), spot("c", 3, P1, 8, 22), spot("d", 4, P1, 27, 33)]);
    expect(tree(segments)).toBe(`[1@0 Grain [2@1 bo(3@2 unda)]2(3@1 ries)]1[3@0  carry]3 the [4@0 strain]4.`);
    expect(partsOf(segments, 3).join("")).toBe(P1.slice(8, 22));
    expect(words(segments)).toBe(P1);
  });

  it("DOM: the later mark's first words sit inside the earlier mark, each tag right after its own note's last word, in order", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(html).toMatch(
      new RegExp(
        `<p><mark data-note="1"[^>]*>Grain <mark data-note-part="2"[^>]*>boundaries</mark></mark>${TAG(1)}<mark data-note="2"[^>]*> carry</mark>${TAG(2)} the strain\\.</p>`,
      ),
    );
    expect(html.match(/<mark\b/g)).toHaveLength(3);
    expect(html.indexOf("Open note 1")).toBeLessThan(html.indexOf("Open note 2"));
  });

  it("DOM: the overlap wears the nested shade; the part after the earlier tag keeps the highlighter", () => {
    const html = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(/<mark data-note-part="2"[^>]*>/.exec(html)![0]).toContain("bg-[color:var(--color-note-nested)]");
    expect(/<mark data-note="2"[^>]*>/.exec(html)![0]).toContain("bg-[color:var(--color-note-mark)]");
  });

  it("DOM: the text and the tags of the paragraph are unchanged by the extra mark", () => {
    const bare = paragraphHtml(render(), 1).replace(/<[^>]+>/g, "");
    const marked = paragraphHtml(render({ [paragraphAnchor(0, 1)]: [spot("a", 1, P1, 0, 16), spot("b", 2, P1, 6, 22)] }), 1);
    expect(marked.replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "")).toBe(bare);
    expect(marked.match(/Open note \d/g)).toEqual(["Open note 1", "Open note 2"]);
  });
});

// ── P10-51 (round 6's reader 2): a later note that starts inside an earlier note's mark and crosses its tag ──────────
// Round 6's real drag stored note 1 at 100–154 and note 2 at 133–175 in one paragraph. The page drew note 2 over its
// words after note 1's tag only, and the dump (which listed `mark[data-note]` alone) showed no part of note 2 over the 21
// shared characters. The paragraph here is invented, with a quote that matches the text at those offsets.
describe("a later note that starts inside an earlier mark and crosses its tag has its shared words as its own (P10-51)", () => {
  const LEAD = "Layered oxides are an old subject; this first sentence only carries the offsets, so read on now: an ";
  const PAR = `${LEAD}important class of high-capacity intercalation cathode materials for Li-ion cells follows.`;
  const textOf = (segments: CoveringSegment[]): string =>
    segments.map((one) => (one.kind === "text" ? PAR.slice(one.from, one.to) : one.kind === "mark" ? textOf(one.inner) : "")).join("");
  const parts = (segments: CoveringSegment[], n: number): string[] =>
    segments.flatMap((one) =>
      one.kind === "mark" ? [...(one.spot.n === n && one.part ? [textOf(one.inner)] : []), ...parts(one.inner, n)] : [],
    );
  const marksOf = (segments: CoveringSegment[], n: number): string[] =>
    segments.flatMap((one) =>
      one.kind === "mark" ? [...(one.spot.n === n && !one.part ? [textOf(one.inner)] : []), ...marksOf(one.inner, n)] : [],
    );
  const html = (start1: number, start2: number) => {
    const doc2: ExtractedDocument = { ...doc, sections: [{ ...doc.sections[0], text: PAR }] };
    const reading2 = buildReading(paper, { ...fullText, doc: doc2 }, new Date("2026-10-05T00:00:00.000Z"));
    const notes = { [paragraphAnchor(0, 0)]: [spot("a", 1, PAR, start1, 154), spot("b", 2, PAR, start2, 175)] };
    const out = renderToStaticMarkup(createElement(PaperBody, { reading: reading2, noteAnchors: notes }));
    return out.slice(out.indexOf("<p>"), out.indexOf("</p>") + 4);
  };

  it("has the invented paragraph's offsets right (note 1 at 100–154, note 2 at 133–175)", () => {
    expect(PAR.slice(100, 154)).toBe("important class of high-capacity intercalation cathode");
    expect(PAR.slice(133, 175)).toBe("intercalation cathode materials for Li-ion");
    expect(PAR.slice(133, 154)).toBe("intercalation cathode");
  });

  it("segments: note 2's 21 shared words are a nested part inside note 1's mark, its rest is its own mark after note 1's tag", () => {
    const segments = coveringSegments(PAR, [spot("a", 1, PAR, 100, 154), spot("b", 2, PAR, 133, 175)]);
    expect(parts(segments, 2)).toEqual(["intercalation cathode"]);
    expect(marksOf(segments, 1)).toEqual(["important class of high-capacity intercalation cathode"]);
    expect(marksOf(segments, 2)).toEqual([" materials for Li-ion"]);
    expect(textOf(segments)).toBe(PAR);
    // Reading order: text, note 1's mark (holding note 2's part; its tag follows it), note 2's mark (its tag follows it), text.
    expect(segments.map((one) => (one.kind === "tag" ? `T${one.spot.n}` : one.kind === "mark" ? `M${one.spot.n}` : "x"))).toEqual(["x", "M1", "M2", "x"]);
  });

  it("DOM: the part sits inside mark 1 in the nested shade, tag 1 follows mark 1, mark 2 and its tag follow after it", () => {
    const out = html(100, 133);
    expect(out).toMatch(
      new RegExp(
        `<mark data-note="1"[^>]*>important class of high-capacity <mark data-note-part="2"[^>]*>intercalation cathode</mark></mark>${TAG(1)}<mark data-note="2"[^>]*> materials for Li-ion</mark>${TAG(2)} cells follows\\.</p>`,
      ),
    );
    expect(/<mark data-note-part="2"[^>]*>/.exec(out)![0]).toContain("bg-[color:var(--color-note-nested)]");
    expect(out.match(/<mark\b/g)).toHaveLength(3);
  });

  // The later note starts exactly where the earlier mark starts (and runs past its tag): the longer range is the outer mark
  // (`passageSegments`, P10-20), so the later note's words are all its own outer mark and the earlier note's words stand
  // nested inside it — every word of both notes is drawn, no part is needed, and each tag follows its own note's last word.
  it("starting exactly at the earlier mark's start: both notes' words are all drawn, the longer outside, each tag after its own last word", () => {
    const segments = coveringSegments(PAR, [spot("a", 1, PAR, 100, 154), spot("b", 2, PAR, 100, 175)]);
    expect(marksOf(segments, 2)).toEqual(["important class of high-capacity intercalation cathode materials for Li-ion"]);
    expect(marksOf(segments, 1)).toEqual(["important class of high-capacity intercalation cathode"]);
    expect(textOf(segments)).toBe(PAR);
    const out = html(100, 100);
    expect(out).toMatch(
      new RegExp(
        `<mark data-note="2"[^>]*><mark data-note="1"[^>]*>important class of high-capacity intercalation cathode</mark>${TAG(1)} materials for Li-ion</mark>${TAG(2)} cells follows\\.</p>`,
      ),
    );
    expect(/<mark data-note="2"[^>]*>/.exec(out)![0]).toContain("bg-[color:var(--color-note-mark)]");
    expect(/<mark data-note="1"[^>]*>/.exec(out)![0]).toContain("bg-[color:var(--color-note-nested)]");
    expect(out.match(/<mark\b/g)).toHaveLength(2);
  });

  // Rule 2: the flash lands on the shared words too. The paragraph's real markup (what `PaperBody` draws) is read into a
  // small stand-in whose `querySelectorAll` answers the attribute selectors `goToPassage` asks, in reading order.
  it("flash: opening note 2 outlines its part (the shared words) and its own mark, and not note 1's", () => {
    vi.useFakeTimers();
    try {
      const out = html(100, 133);
      const marks = [...out.matchAll(/<mark (data-note(?:-part)?)="(\d+)"/g)].map((m) => ({ attr: m[1], n: m[2], classes: new Set<string>() }));
      expect(marks.map((m) => `${m.attr}=${m.n}`)).toEqual(["data-note=1", "data-note-part=2", "data-note=2"]);
      const marked = marks.map((m) => ({ ...m, classList: { add: (...c: string[]) => c.forEach((x) => m.classes.add(x)), remove: (...c: string[]) => c.forEach((x) => m.classes.delete(x)) } }));
      const paragraph = {
        scrollIntoView: () => undefined,
        classList: { add: () => undefined, remove: () => undefined },
        querySelectorAll: (selector: string) => {
          const wanted = [...selector.matchAll(/mark\[(data-note(?:-part)?)="(\d+)"\]/g)].map((m) => ({ attr: m[1], n: m[2] }));
          return marked.filter((m) => wanted.some((w) => w.attr === m.attr && w.n === m.n));
        },
      };
      goToPassage({ paperId: "p1", paragraphId: "paper-section-0-p0", quote: PAR.slice(133, 175), n: 2, start: 133, end: 175 }, {
        doc: { getElementById: () => paragraph } as unknown as Document,
        navigate: () => undefined,
      });
      expect(marked.map((m) => `${m.attr}=${m.n}:${m.classes.has("outline")}`)).toEqual(["data-note=1:false", "data-note-part=2:true", "data-note=2:true"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
