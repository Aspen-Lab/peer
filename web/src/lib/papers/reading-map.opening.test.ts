import { describe, expect, it } from "vitest";
import { withSectionIds, type DraftSection, type ExtractedDocument } from "./html-text";
import { buildReadingMap, openingOf, readableSections } from "./reading-map";
import { isBoilerplate, splitSentences } from "./skim";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import arxivPdfDocJson from "./__fixtures__/arxiv-2609.02113.doc.json";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";

// P9-56 (N9; ruling §1h.73 (b)): a reading-map opening line is its paragraph's first sentence, whole, when
// that sentence is at most 400 characters; a longer one is cut at a word with one "…" and no stop, comma,
// colon or dash in front of it, so a cut line never reads as a finished one. The head cut at 160 and
// returned the cut bare: 39 of the 53 lines of the owner's paper read as finished sentences and were not
// (P9-W4 §5 N9). The text here is invented; the lengths are the point.

/** Invented words: none is a field opener (`isBoilerplate`) and none ends a sentence. */
const WORDS = ["glaze", "kiln", "firing", "slip", "ash", "cobalt", "tile", "batch", "cone", "oxide", "crackle", "bisque", "ramp", "soak", "shelf", "wadding", "vent", "damper"];

/** One sentence of exactly `n` characters ("The glaze kiln …"), its only stop the last character. */
function sentenceOf(n: number): string {
  let text = "The";
  for (let i = 0; text.length < n; i++) text += ` ${WORDS[i % WORDS.length]}`;
  return `${text.slice(0, n - 1).replace(/ $/, "x")}.`;
}

const SECOND = "The second kiln cycle ran another hour.";

/** A paragraph whose first sentence is `n` characters long, with a second sentence after it. */
const paragraphOf = (n: number) => `${sentenceOf(n)} ${SECOND}`;

/** What the line shows before a mark: the opening without its closing "…". */
const beforeMark = (opening: string) => opening.slice(0, -1);

function doc(paragraphs: string[]): ExtractedDocument {
  const sections: DraftSection[] = [{ heading: "1 Firing", canonical: "methods", text: paragraphs.join("\n\n") }];
  return { sections: withSectionIds(sections), figureCaptions: [], source: "pdf" };
}

describe("the invented sentences are what the tests below say they are", () => {
  it.each([80, 210, 380, 400, 401, 420, 740])("a first sentence of %i characters is one non-boilerplate sentence, then a second", (n) => {
    const first = sentenceOf(n);

    expect(first).toHaveLength(n);
    expect(first.match(/[.!?]/g)).toHaveLength(1);
    expect(isBoilerplate(first)).toBe(false);
    expect(splitSentences(paragraphOf(n))).toEqual([first, SECOND]);
  });
});

describe("rule 1: the opening is the paragraph's first sentence, whole, when it is at most 400 characters", () => {
  it.each([80, 210, 380, 400])("a first sentence of %i characters stands whole, with no mark and nothing after it", (n) => {
    expect(openingOf(paragraphOf(n))).toBe(sentenceOf(n));
  });

  it("skips a field opener and then takes the next sentence whole, however long it is up to 400", () => {
    const lead = "In recent years glaze work has grown across many studios.";
    const next = sentenceOf(330);

    expect(isBoilerplate(lead)).toBe(true);
    expect(openingOf(`${lead} ${next} ${SECOND}`)).toBe(next);
  });

  it("grows a short first sentence by whole sentences up to 400 characters, and not one character past", () => {
    const first = "Short opening explains context.";
    // Capitalised: a lower-case start would be read as a continuation of the first sentence (`splitSentences`).
    const fits = `X${"x".repeat(400 - first.length - 3)}.`;
    const over = `X${"x".repeat(400 - first.length - 2)}.`;

    expect(`${first} ${fits}`).toHaveLength(400);
    expect(`${first} ${over}`).toHaveLength(401);
    expect(splitSentences(`${first} ${over}`)).toEqual([first, over]);
    expect(openingOf(`${first} ${fits} ${SECOND}`)).toBe(`${first} ${fits}`);
    // One character over: the later sentence is left out whole, and the short one stands alone, unmarked.
    expect(openingOf(`${first} ${over} ${SECOND}`)).toBe(first);
  });
});

describe("rule 2: a first sentence over 400 characters is cut at a word with one \"…\"", () => {
  it.each([401, 420, 740])("a first sentence of %i characters: one mark, at most 400 characters with it, a word's end before it", (n) => {
    const first = sentenceOf(n);
    const opening = openingOf(paragraphOf(n)) as string;
    const kept = beforeMark(opening);

    expect(opening.endsWith("…")).toBe(true);
    expect(opening.match(/…/g)).toHaveLength(1);
    expect(opening.length).toBeLessThanOrEqual(400);
    // The room is used: only the last word (seven letters at most) and its space are given up.
    expect(opening.length).toBeGreaterThan(385);
    // The paper's own words, verbatim, and the sentence goes on with a space: cut at a word.
    expect(first.startsWith(kept)).toBe(true);
    expect(/\s/.test(first[kept.length])).toBe(true);
    // Nothing that reads as an end, or as more to come, stands in front of the mark.
    expect(kept).toMatch(/[\p{L}\p{N}]$/u);
    expect(opening).not.toMatch(/[\s,;:.!?\-–—(\[]…$/);
  });

  it("is a line of 400 characters with its mark when the cap falls on a word's end", () => {
    // "Veln " is five characters, so the 400th character of the sentence is a space.
    const first = `Veln ${"veln ".repeat(89)}veln.`;
    expect(first).toHaveLength(455);

    expect(openingOf(`${first} ${SECOND}`)).toBe(`Veln ${"veln ".repeat(78)}veln…`);
    expect(`Veln ${"veln ".repeat(78)}veln…`).toHaveLength(400);
  });

  it("backs up to the last whole word when the cap falls inside a word", () => {
    // "abcde " is six characters, so the 400th character is the fourth letter of a word.
    const first = `Abcde ${"abcde ".repeat(79)}abcde.`;
    expect(first).toHaveLength(486);

    expect(openingOf(`${first} ${SECOND}`)).toBe(`Abcde ${"abcde ".repeat(64)}abcde…`);
  });

  /** A first sentence whose 399th character is the last of `tail`, with a space and more words after it. */
  function sentenceCutAfter(tail: string): string {
    const units = Math.floor((399 - tail.length) / 5);
    const spare = 399 - tail.length - units * 5;
    return `A${"b".repeat(3 + spare)} ${"abcd ".repeat(units - 1)}${tail} and the next words go on to the end of the sentence.`;
  }

  it.each([
    ["a comma", "efgh,", "efgh…"],
    ["a colon", "efgh:", "efgh…"],
    ["a semicolon", "efgh;", "efgh…"],
    ["a hyphen set off by spaces", "efgh -", "efgh…"],
    ["an en dash", "efgh –", "efgh…"],
    ["an em dash", "efgh —", "efgh…"],
    ["a stop that ends an abbreviation", "see Okafor et al.", "see Okafor et al…"],
    ["an open bracket", "efgh (", "efgh…"],
  ])("never puts the mark after %s", (_name, tail, ending) => {
    const first = sentenceCutAfter(tail);
    expect(splitSentences(`${first} ${SECOND}`)).toEqual([first, SECOND]);
    expect(first.slice(0, 399).endsWith(tail)).toBe(true);

    const opening = openingOf(`${first} ${SECOND}`) as string;

    expect(opening.endsWith(ending)).toBe(true);
    expect(opening).not.toMatch(/[\s,;:.!?\-–—(\[]…$/);
    expect(first.startsWith(beforeMark(opening))).toBe(true);
  });

  it("cuts an unbroken run with no word to end on at the room's edge, still with the mark", () => {
    const first = `Zz${"q".repeat(600)}.`;
    const opening = openingOf(`${first} ${SECOND}`) as string;

    expect(opening).toHaveLength(400);
    expect(opening.endsWith("…")).toBe(true);
    expect(first.startsWith(beforeMark(opening))).toBe(true);
  });

  it("reaches the map's lines through buildReadingMap: five paragraphs, first sentences of 80 / 210 / 380 / 420 / 740", () => {
    const sizes = [80, 210, 380, 420, 740];
    const lines = buildReadingMap(doc(sizes.map(paragraphOf))).sections[0].paragraphs.map((line) => line.opening as string);

    expect(lines.map((line) => line.length).slice(0, 3)).toEqual([80, 210, 380]);
    expect(lines.slice(0, 3)).toEqual([80, 210, 380].map(sentenceOf));
    const cut: Array<[number, number]> = [[3, 420], [4, 740]];
    for (const [at, n] of cut) {
      expect(lines[at].endsWith("…")).toBe(true);
      expect(lines[at].length).toBeLessThanOrEqual(400);
      expect(sentenceOf(n).startsWith(beforeMark(lines[at]))).toBe(true);
    }
  });
});

describe("rule 3: where a sentence ends, the starts, and a formula's introduction are as they were", () => {
  it("does not end a first sentence of more than 160 characters at an initial, \"et al.\" or \"Fig.\"", () => {
    const first =
      "As J. R. Okafor et al. report in Fig. 4, the shelf wadding held the slip glaze tile batch through every cone ramp and soak, " +
      "and the damper vent stayed open while the crackle oxide cobalt ash bisque cooled over the next nine hours without any visible crack in the stoneware.";
    expect(first.length).toBeGreaterThan(160);
    expect(first.length).toBeLessThanOrEqual(400);
    expect(splitSentences(`${first} ${SECOND}`)).toEqual([first, SECOND]);

    expect(openingOf(`${first} ${SECOND}`)).toBe(first);
  });

  it("keeps a line that introduces a formula, ending on a colon, whole: short, or longer than the old 160", () => {
    const short = "The cooling time then follows from the expression below:";
    const long =
      "Writing the relaxation of the glaze layer as a function of the ramp rate and the soak time, with the shelf wadding held at the " +
      "cone temperature throughout, the cooling curve of the whole batch then follows from the expression below:";
    expect(long.length).toBeGreaterThan(200);
    expect(long.length).toBeLessThanOrEqual(400);

    expect(openingOf(short)).toBe(short);
    expect(openingOf(long)).toBe(long);
  });

  it("starts at the first non-boilerplate sentence, as it did", () => {
    const lead = "Glaze chemistry has attracted enormous attention across many studios.";
    const claim = "We show that a cobalt oxide slip recovers the crackle pattern after a second firing.";

    expect(isBoilerplate(lead)).toBe(true);
    expect(openingOf(`${lead} ${claim}`)).toBe(claim);
  });

  it("is null when every sentence is a field opener, as it was", () => {
    expect(
      openingOf(
        "In recent years this field has grown rapidly across many disciplines. " +
          "Glaze chemistry remains a grand challenge in applied ceramics.",
      ),
    ).toBeNull();
  });
});

describe("the committed fixtures: no opening is cut without a mark", () => {
  function withIds(json: unknown): ExtractedDocument {
    const document = json as Omit<ExtractedDocument, "sections"> & { sections: DraftSection[] };
    return { ...document, sections: withSectionIds(document.sections) };
  }
  const FIXTURES: Array<[string, ExtractedDocument]> = [
    ["arxiv-2609.02697 (LaTeXML HTML)", withIds(arxivHtmlDocJson)],
    ["arxiv-2609.02113 (PDF)", withIds(arxivPdfDocJson)],
    ["zenodo-W7208807247 (PDF)", withIds(zenodoDocJson)],
  ];

  /** An opening that ends on a sentence end, on the mark, or is its whole paragraph is not a bare cut. */
  const SENTENCE_END = /[.!?]["'”’)\]]*$/;

  it.each(FIXTURES)("%s: every opening ends on a sentence end, on \"…\", or is its whole paragraph; none is bare-cut", (_name, fixture) => {
    const rendered = readableSections(fixture);
    const map = buildReadingMap(fixture);
    const bare: string[] = [];
    let lines = 0;

    map.sections.forEach((row, k) => {
      for (const line of row.paragraphs) {
        if (line.opening === null) continue;
        lines += 1;
        const paragraph = rendered[k].paragraphs[line.index];
        expect(line.opening.length).toBeLessThanOrEqual(400);
        if (line.opening.endsWith("…")) {
          // A marked line is a verbatim stretch of its paragraph, and the paragraph goes on after it.
          const kept = beforeMark(line.opening);
          expect(paragraph.includes(kept)).toBe(true);
          expect(paragraph.length).toBeGreaterThan(kept.length);
          continue;
        }
        if (SENTENCE_END.test(line.opening) || line.opening === paragraph) continue;
        bare.push(line.opening.slice(-40));
      }
    });

    expect(lines).toBeGreaterThan(0);
    expect(bare).toEqual([]);
  });
});
