// P11-48 (ruling §1h.152): the text-size steps scale the paper's own text.
//
// The steps (Larger text / Smaller text) set `--reading-scale` on the two wrap points of reader-layout.tsx, and
// globals.css multiplies a size by it at the USE site, one rule per size class (6-09). Three rules were there, for
// `text-lead`, `text-body` and `text-body-lg`; the paper's body and its headings on Paper digestion are `text-title`,
// the Summary's claims are `reading-prose`, and neither was among them, so pressing Larger text on those did nothing.
//
// The rule of the ruling: every piece of READING text inside the wrappers scales; the controls, the labels (the mono
// captions and eyebrows) and everything outside the wrappers do not. This file holds the inventory of every size class
// the wrappers' components use, with a verdict and the reason for each, and checks three things against the source:
//   1. each verdict is what globals.css does (a scaled class has its rule, in the use-site form, on a token that exists;
//      a class that is not scaled has none);
//   2. every size class the wrappers' components use has a verdict (a new one fails here until someone decides);
//   3. the scale never leaves the wrappers (every rule is under `.reading-scaled`; reader-layout.tsx has three).
//
// Source-text assertions, as globals.css.test.ts explains: jsdom does not compute `calc()` over a custom property or
// the cascade the way a browser does, so a computed-style assertion here would prove nothing. The computed sizes at
// each step are in the P11-48 checkpoint, measured in Chromium.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*$/gm, "$1");

const css = stripComments(read("./globals.css"));

// `.reading-scaled <selector> { font-size: calc(var(--text-x) * var(--reading-scale, 1)); }`, the only form allowed.
const RULE = /\.reading-scaled\s+([^{}]+?)\s*\{\s*font-size:\s*calc\(var\((--text-[a-z-]+)\)\s*\*\s*var\(--reading-scale,\s*1\)\);?\s*\}/g;
const rules = new Map<string, string>();
for (const match of css.matchAll(RULE)) rules.set(match[1].replace(/\s+/g, " "), match[2]);

// What scales, by selector, with the token it multiplies and the reason.
const SCALED: ReadonlyArray<{ klass: string; selector: string; token: string; reading: string }> = [
  { klass: "text-lead", selector: '[class~="text-lead"]', token: "--text-lead", reading: "the abstract, the report's lines, the answers' questions (6-09)" },
  { klass: "text-body", selector: '[class~="text-body"]', token: "--text-body", reading: "the question bar, the answers, the quoted evidence (6-09)" },
  { klass: "text-body-lg", selector: '[class~="text-body-lg"]', token: "--text-body-lg", reading: "emphasised body (6-09)" },
  { klass: "text-title", selector: '[class~="text-title"]', token: "--text-title", reading: "the paper's body and its section headings on Paper digestion" },
  { klass: "text-title-lg", selector: '[class~="text-title-lg"]', token: "--text-title-lg", reading: "the Summary's deck: Peer's skim line over the abstract" },
  { klass: "text-display-sm", selector: '[class~="text-display-sm"]', token: "--text-display-sm", reading: "the Summary's one loud sentence, the paper's own claim at Tier 0" },
  {
    klass: "text-body-sm",
    selector: '[class~="text-body-sm"][class~="font-reading"]',
    token: "--text-body-sm",
    reading: "serif prose at the small step: the answers' reasons, the matted figures' captions, the question bar's suggested questions",
  },
  { klass: "reading-prose", selector: '[class~="reading-prose"]', token: "--text-lead", reading: "the Summary's claims and quotes: the utility is the lead size under another name" },
  { klass: "annotation", selector: 'figcaption[class~="annotation"]', token: "--text-caption", reading: "the paper's figure captions: its own words, in the mono note form" },
];

// What does not scale, and why. Every size class the wrappers' components use is in one list or the other.
const NOT_SCALED: Readonly<Record<string, string>> = {
  "text-micro": "an eyebrow size; not used inside the wrappers (the left pane's plate)",
  "text-caption": "labels: the verdict lines, the footers, the pills of the plain-language controls",
  "text-meta": "labels and attributions: the section links, the chips, the mono meta rows, the unrendered-formula fallback",
  "text-display-xs": "not used inside the wrappers",
  "text-display": "not used inside the wrappers",
  "text-display-lg": "not used inside the wrappers",
  "text-display-xl": "not used inside the wrappers",
  annotation: "the mono note form: labels, footers, counters; its one reading use (the figure caption) has its own rule above",
  eyebrow: "the label form",
};
const SIZE_CLASSES = new Set([...SCALED.map((entry) => entry.klass), ...Object.keys(NOT_SCALED)]);

// The components that draw what stands inside the wrappers (`common`, `words`, `additions` of page.tsx), with what they draw.
const WRAPPED_FILES = [
  "../components/reader/question-field.tsx",
  "../components/reader/for-your-questions.tsx",
  "../components/reader/paper-words.tsx",
  "../components/reader/lead-claim.tsx",
  "../components/reader/abstract-toggle.tsx",
  "../components/reader/paper-body.tsx",
  "../components/reader/claim-list.tsx",
  "../components/reader/quote-list.tsx",
  "../components/reader/report-sections.tsx",
  "../components/reader/evidence-quote.tsx",
  "../components/reader/matted-figure.tsx",
  "../components/reader/math.tsx",
  "../components/reader/plain-button.tsx",
  "../components/reader/record-block.tsx",
  "../components/reader/in-your-library.tsx",
];

describe("globals.css — the text steps scale the reading text inside the wrappers (P11-48, §1h.152)", () => {
  it("has a use-site rule for every class of reading text, on a token that is plain px", () => {
    for (const { selector, token } of SCALED) {
      expect(rules.get(selector), `no \`.reading-scaled ${selector}\` rule`).toBe(token);
      expect(read("./globals.css"), `${token} is not a plain px size`).toMatch(new RegExp(`${token}:\\s*[\\d.]+px;`));
    }
  });

  it("has no rule for anything else: the labels and the controls keep their size", () => {
    expect([...rules.keys()].sort()).toEqual(SCALED.map((entry) => entry.selector).sort());
  });

  it("scales the paper's own body and headings, drawn `font-reading text-title`", () => {
    const body = read("../components/reader/paper-body.tsx");
    expect(body).toMatch(/font-reading text-title leading-\[1\.65\]/);
    expect(body).toMatch(/font-medium text-heading text-title leading-\[1\.3\]/);
    expect(rules.get('[class~="text-title"]')).toBe("--text-title");
  });

  it("puts every size-setting rule under `.reading-scaled`, so nothing outside the wrappers moves", () => {
    const scaled = css.match(/font-size:\s*calc\([^;}]*--reading-scale[^;}]*\)/g) ?? [];
    expect(scaled).toHaveLength(rules.size);
    // The ruled centre cap scales its measure; every font rule remains scoped.
    for (const block of css.matchAll(/([^{}]+)\{[^{}]*--reading-scale[^{}]*\}/g)) {
      if (block[1].trim() === ".reader-centre-inner") {
        expect(block[0].slice(block[0].indexOf("{") + 1, -1).trim().replace(/\s+/g, " ")).toBe("max-width: calc(38em * var(--reading-scale, 1)); margin-inline: auto;");
        continue;
      }
      expect(block[1].trim().startsWith(".reading-scaled"), `unscoped rule: ${block[1].trim().slice(0, 60)}`).toBe(true);
    }
  });

  it("keeps the scale to the three wrappers of reader-layout.tsx (the left pane, the cards and the legend are outside)", () => {
    const layout = stripComments(read("../components/reader/reader-layout.tsx"));
    expect(layout.match(/className="reading-scaled[ "]/g) ?? []).toHaveLength(3);
    // P12-15: the stable common key preserves native Range ancestry through resize.
    expect(layout).toMatch(/<div key="common" id=\{COMMON_ID\} className="reading-scaled scroll-mt-20" style=\{readingScaleStyle\}>\{p\.common\}<\/div>/);
    expect(layout).toMatch(/<div className="reading-scaled" style=\{readingScaleStyle\}>\{p\.words\}<\/div>/);
    expect(layout).toMatch(/<div className="reading-scaled" style=\{readingScaleStyle\}>\{p\.additions\}<\/div>/);
  });

  it("gives a verdict to every size class the wrappers' components use, and none is behind a variant", () => {
    const TOKEN = /(?<![\w-])((?:[\w[\]@():>&-]+:)*)(text-(?:micro|caption|meta|body-sm|body-lg|body|lead|title-lg|title|display-xs|display-sm|display-lg|display-xl|display|xs|sm|base|lg|xl|[2-9]xl)|reading-prose|annotation|eyebrow)(?![\w-])/g;
    const ARBITRARY = /(?<![\w-])(?:[\w[\]@():>&-]+:)*text-\[[^\]\s]*(?:px|rem|em|cqw|vw|vh|clamp)[^\]\s]*\]/g;
    for (const file of WRAPPED_FILES) {
      const source = stripComments(read(file));
      for (const [, variant, token] of source.matchAll(TOKEN)) {
        expect(SIZE_CLASSES.has(token), `${file} uses \`${token}\`, which has no verdict`).toBe(true);
        // A rule here matches the whole class token, so `sm:text-title` would stay at its size while `text-title` scales.
        expect(variant, `${file} uses \`${variant}${token}\`: a rule cannot match a size behind a variant`).toBe("");
      }
      expect(source.match(ARBITRARY) ?? [], `${file} sets a literal size inside the wrappers`).toEqual([]);
    }
  });

  it("scales the Summary's deck, claims and lead sentence, which are drawn with the classes the rules name", () => {
    const words = read("../components/reader/paper-words.tsx");
    expect(words).toMatch(/font-reading text-title-lg leading-\[1\.45\]/);
    expect(read("../components/reader/claim-list.tsx")).toMatch(/rv rv-late reading-prose space-y-4 measure-paper/);
    expect(read("../components/reader/quote-list.tsx")).toMatch(/reading-prose space-y-4/);
    expect(read("../components/reader/lead-claim.tsx")).toMatch(/text-heading text-display-sm/);
    expect(read("../components/reader/paper-body.tsx")).toMatch(/<figcaption className="annotation mt-2 leading-\[1\.6\] text-text-faint measure-mono">/);
  });
});

// P11-53 (ruling §1h.159): no word of the reading text passes its column, at any text step.
//
// The paper's paragraphs wrap only at spaces and hyphens (`overflow-wrap: normal`), and `hyphens: auto` breaks nothing where the
// browser has no dictionary for the paper's language. Since P11-48 scales the paper's own text, a run with no break opportunity (a
// chemical name joined by slashes, a URL) grows with the step: at 1.32 / 1.45 / 1.6 it passed a 416-px column by 30 / 74 / 125 px, over
// the column's padding, the separator and the margin's cards, and on a phone it made the page wider than the window.
//
// The rule is one declaration on the wrapper, `.reading-scaled { overflow-wrap: break-word }`, and it is inherited, so it reaches the
// paper's body, its headings and captions, the Summary's blocks and the answers, which all stand inside the three wrappers. `break-word`
// (not `anywhere`, not `word-break: break-all`) breaks a word only when it cannot fit on a line of its own: a line that fits today wraps
// exactly as it does today, and the hyphens, the justification and the column's width are left as they are. What that does to the
// layout (the run's right edge against the column's, the page's scrollWidth, the line count of every paragraph at scale 1) is in the
// P11-53 checkpoint, measured in Chromium; jsdom lays nothing out, so this file holds the source the measurement stands on.
describe("globals.css — a run wider than its line breaks inside the reading text (P11-53, §1h.159)", () => {
  // Every rule block of the sheet, comments gone: [selector, declarations]. An `@media` block's own rules are in it, its header is not.
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [match[1].trim(), match[2].trim()] as const);
  const declarationsOf = (body: string) => body.split(";").map((declaration) => declaration.trim().replace(/\s+/g, " ")).filter(Boolean);

  it("sets `overflow-wrap: break-word` once, on the wrapper, which the words inside inherit", () => {
    const onWrapper = blocks.filter(([selector]) => selector === ".reading-scaled");
    expect(onWrapper, "one rule, on `.reading-scaled` itself").toHaveLength(1);
    expect(declarationsOf(onWrapper[0][1])).toEqual(["overflow-wrap: break-word"]);
  });

  it("changes nothing else about how a line breaks: every rule under `.reading-scaled` is a size, bar the one wrapper rule", () => {
    for (const [selector, body] of blocks.filter(([selector]) => selector.startsWith(".reading-scaled"))) {
      if (selector === ".reading-scaled") continue;
      expect(declarationsOf(body).map((declaration) => declaration.split(":")[0]), `${selector} sets more than a size`).toEqual(["font-size"]);
    }
  });

  it("leaves the hyphenation and the justification of `reading-justify` as they are", () => {
    const utility = css.match(/@utility reading-justify\s*\{([^{}]*)\}/);
    expect(utility, "`reading-justify` is gone").not.toBeNull();
    const declarations = declarationsOf(utility![1]);
    expect(declarations).toContain("text-align: justify");
    expect(declarations).toContain("hyphens: auto");
    expect(declarations.filter((declaration) => /^(overflow-wrap|word-break)\b/.test(declaration))).toEqual([]);
  });

  it("is not taken back by any component the wrappers hold: none sets `break-normal`, `wrap-normal` or a `word-break`", () => {
    const TAKEN_BACK = /(?<![\w-])(?:[\w[\]@():>&-]+:)*(?:break-normal|break-keep|break-all|wrap-normal|\[overflow-wrap:normal\]|\[word-break:[^\]]*\])(?![\w-])/g;
    for (const file of WRAPPED_FILES) {
      expect(stripComments(read(file)).match(TAKEN_BACK) ?? [], `${file} resets how a word breaks`).toEqual([]);
    }
  });
});
