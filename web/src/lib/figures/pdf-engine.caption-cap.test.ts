// P12-68 (B P12-39 M8): the figure engine's caption cap goes from 500 to 1,500 characters, and the view's room with
// it. A long caption was cut at 500 in the engine (`MAX_FIGURE_TEXT_CHARS`) and again where a sentence ended in
// the view (`FIGURE_CAPTION_CHARS`), so a figure's whole caption never reached a reader. R8a (P12-47: a caption
// ends at a pitch jump) is what keeps a longer cap from swallowing the paragraph below. Every PDF and every word
// here is invented and built in the test with `figurePdf`; the owner's papers are never a fixture.
import { describe, expect, it } from "vitest";
import { figureCaption } from "@/components/reader/matted-figure";
import { figurePdf, panel, type FigurePage, type TextRun } from "./figure-pdf.test-helper";
import { FIGURE_EXTRACTION_REVISION } from "./figure-revision";
import { extractPdfFigures } from "./pdf-engine";

const options = { maxPages: 24, maxFigures: 12 };
/** The caption each figure of the page was given, in the pool (every page) and in the route (one page, one label). */
const captionsOf = async (page: FigurePage, extra: Record<string, unknown> = {}) =>
  (await extractPdfFigures(figurePdf([page]), { ...options, measureOnly: true, ...extra })).figures.map((figure) => figure.caption);
const inRoute = { onlyPage: 1, label: "Figure 1", maxFigures: 1 };

// ── Invented captions of an exact length ─────────────────────────────────────────────────────────────

const WORDS = [
  "soil", "water", "held", "beneath", "the", "thick", "layer", "across", "three", "orchards", "while",
  "bare", "plots", "dried", "faster", "than", "mulched", "rows", "after", "each", "irrigation",
];
/** `n` characters of running text with no stop in it: words, single spaces, no trailing space. */
function run(n: number, from = 0): string {
  let out = "";
  for (let i = from; out.length < n; i += 1) out += (out ? " " : "") + WORDS[i % WORDS.length];
  out = out.slice(0, n);
  return out.endsWith(" ") ? `${out.slice(0, -1)}x` : out;
}
/** One sentence of exactly `n` characters: a capital, running text, a stop. */
function sentence(n: number, from = 0): string {
  const body = run(n - 1, from);
  return `${body[0]!.toUpperCase()}${body.slice(1)}.`;
}
/** "Figure 1." and sentences, in all exactly `total` characters (the last sentence takes what is left). */
function captionOf(total: number): string {
  const sizes = [150, 190, 160, 210, 170];
  let text = "Figure 1.";
  sizes.forEach((size, at) => {
    if (text.length + 1 + size + 40 < total) text += ` ${sentence(size, at * 3)}`;
  });
  return `${text} ${sentence(total - text.length - 1, 7)}`;
}
/** A caption set in lines of at most `width` characters, each a run of the page, `pitch` pt apart from `baseline`. */
function setLines(text: string, baseline: number, pitch = 11, width = 100): TextRun[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last]!.length + 1 + word.length <= width) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines.map((line, at) => [line, 40, baseline + at * pitch, 9]);
}
const FIGURE = panel(40, 100, 180, 150);
const pageOf = (text: string, ...more: TextRun[]): FigurePage => ({ text: [...setLines(text, 268), ...more], shapes: FIGURE });

const CAPTION = captionOf(1200);
const BODY = "The body paragraph begins here and goes on for a while under the figure, as a paragraph of the text does.";

describe("P12-68: the fixtures are the captions they say they are", () => {
  it("builds a caption of exactly 1,200 characters, set in a dozen lines, that ends on a stop", () => {
    expect(CAPTION).toHaveLength(1200);
    expect(CAPTION).toMatch(/^Figure 1\. .*\.$/);
    expect(setLines(CAPTION, 268).length).toBeGreaterThanOrEqual(12);
    expect(setLines(CAPTION, 268).map(([line]) => line).join(" ")).toBe(CAPTION);
    // Long enough that the old cap of 500 would have cut it.
    expect(CAPTION.length).toBeGreaterThan(500);
  });
});

describe("P12-68: a caption of 1,200 characters is found whole and printed whole", () => {
  it("is the engine's whole caption, in the pool and in the route", async () => {
    expect(await captionsOf(pageOf(CAPTION))).toEqual([CAPTION]);
    expect(await captionsOf(pageOf(CAPTION), inRoute)).toEqual([CAPTION]);
  });

  it("reaches the view whole: what the figure prints under the picture is the engine's caption", async () => {
    const [found] = await captionsOf(pageOf(CAPTION));
    expect(found).toHaveLength(1200);
    expect(figureCaption(found)).toBe(CAPTION);
  });

  it("does not take the paragraph set apart below it: the caption still ends at its pitch jump (R8a)", async () => {
    // Caption lines 11 pt apart. A body line 22 pt under the last one is set apart by twice the pitch. Taken, the
    // 1,200 characters and the body's 105 would be inside the new cap: R8a alone keeps it out.
    const lastBaseline = setLines(CAPTION, 268).at(-1)![2];
    const page = pageOf(CAPTION, ...setLines(BODY, lastBaseline + 22));
    expect(await captionsOf(page)).toEqual([CAPTION]);
    expect(await captionsOf(page, inRoute)).toEqual([CAPTION]);
  });

  it("would have taken that paragraph at the caption's own pitch (the control: the cap alone does not keep it out)", async () => {
    const lastBaseline = setLines(CAPTION, 268).at(-1)![2];
    const joined = await captionsOf(pageOf(CAPTION, ...setLines(BODY, lastBaseline + 11)));
    expect(joined).toEqual([`${CAPTION} ${BODY}`]);
  });
});

describe("P12-68: the cap is 1,500 characters, not 500", () => {
  it("cuts a caption of 2,000 characters at 1,500, in the pool and in the route", async () => {
    const long = captionOf(2000);
    expect(long).toHaveLength(2000);
    const [pool] = await captionsOf(pageOf(long));
    const [route] = await captionsOf(pageOf(long), inRoute);
    expect(pool).toHaveLength(1500);
    expect(route).toBe(pool);
    expect(long.startsWith(pool!)).toBe(true);
  });

  it("keeps a caption of 1,499 characters, and of exactly 1,500, as the engine found it", async () => {
    for (const total of [1499, 1500]) {
      const text = captionOf(total);
      expect(await captionsOf(pageOf(text))).toEqual([text]);
    }
  });

  it("hands the view a 1,500-character cut that the view cuts back to a sentence end, as it always has", async () => {
    const [cut] = await captionsOf(pageOf(captionOf(2000)));
    const printed = figureCaption(cut)!;
    expect(printed.length).toBeLessThanOrEqual(1500);
    expect(printed).toMatch(/\.$/);
    expect(cut!.startsWith(printed)).toBe(true);
  });
});

describe("P12-68: the figure revision", () => {
  it("moved past 8, the revision before a caption could be 1,500 characters, so derived figure caches are rebuilt", () => {
    // Captions longer than 500 characters change (`isSameFigure` compares captions exactly, BACKLOG-60), and the
    // sizes cache and the figure-request `v` key on this number. Any later number retires what 8 stored.
    const revision = Number(FIGURE_EXTRACTION_REVISION);
    expect(Number.isInteger(revision)).toBe(true);
    expect(revision).toBeGreaterThan(8);
  });
});
