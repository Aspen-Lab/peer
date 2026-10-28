import { describe, expect, it } from "vitest";
import { MARKERS, isWrapping, markEdit, parseInline, plainInline, portableUnderline, type Inline } from "./inline";

// P12-77 rule 2 (O2; A P12-71 §6): Markdown has no underline of its own. The notes' `__x__` is read as BOLD by CommonMark, Obsidian and
// Pandoc, so an underlined word came out of the app bold. `<u>x</u>` is the form they read as underline.
//
//   READ    `parseInline` reads `<u>x</u>` as underline wherever Markdown comes in (a paste is stored as it is and parsed here) and still reads
//           an old `__x__` exactly as it did: the same token, the same positions, the same refusals.
//   WRITE   `portableUnderline(src)` is a block's source with every underline in `<u>…</u>`, for a Markdown that leaves the app. The stored
//           form, and what the toolbar writes (`MARKERS.underline`), is unchanged, so no stored note and no earlier export changes.

/** A source as the shape it reads to: each token's kind, its words, and what it holds — no positions, so `__x__` and `<u>x</u>` compare. */
type Shape = string | [string, Shape[]];
const shape = (src: string): Shape[] =>
  parseInline(src).map((t): Shape => (isWrapping(t) ? [t.kind, shape(t.text)] : t.kind === "text" ? t.text : t.kind));

/** The marker each underline in `src` is opened with, at any depth. */
const openers = (src: string, base = 0): string[] =>
  parseInline(src).flatMap((t) => (isWrapping(t) ? [...(t.kind === "underline" ? [src.slice(t.from, t.inner)] : []), ...openers(t.text, base)] : []));

describe("<u>…</u> is read as underline (O2)", () => {
  it("with its source positions: the opening tag is three characters, the closing four", () => {
    expect(parseInline("a <u>b</u> c")).toEqual([
      { kind: "text", text: "a ", from: 0, inner: 0, to: 2 },
      { kind: "underline", text: "b", from: 2, inner: 5, to: 10 },
      { kind: "text", text: " c", from: 10, inner: 10, to: 12 },
    ]);
  });

  it("reads the same underline as `__x__` does: the same words under the same kind, alone and among the other marks", () => {
    const pairs: [string, string][] = [
      ["a __b__ c", "a <u>b</u> c"],
      ["**__both__**", "**<u>both</u>**"],
      ["__**both**__", "<u>**both**</u>"],
      ["==__x__==", "==<u>x</u>=="],
      ["*__x__*", "*<u>x</u>*"],
      ["__two words here__", "<u>two words here</u>"],
    ];
    for (const [old, now] of pairs) expect(shape(now), now).toEqual(shape(old));
    expect(plainInline("a <u>b</u> c")).toBe("a b c");
    expect(plainInline("**<u>f</u>** and <u>g</u>")).toBe("f and g");
  });

  it("is not held to whole words, which `__` is: a tag cannot be taken for the middle of a word", () => {
    expect(parseInline("a<u>b</u>c").map((t) => t.kind)).toEqual(["text", "underline", "text"]);
    expect(parseInline("a__b__c").map((t) => t.kind)).toEqual(["text"]);
  });

  it("keeps the dialect's edges: a word, not a space, against each tag; nothing empty; no line break inside; no tag of its own kind inside", () => {
    for (const text of ["<u></u>", "<u> x </u>", "<u> x</u>", "<u>x </u>", "<u>a\nb</u>", "<u>x", "x</u>", "<u>a<u>b", "<u>a</u"]) {
      expect(parseInline(text).map((t) => t.kind), JSON.stringify(text)).toEqual(["text"]);
    }
    // the inner pair is the underline, the outer opening tag a literal one
    expect(shape("<u>a<u>b</u>")).toEqual(["<u>a", ["underline", ["b"]]]);
  });

  it("is not case-sensitive, as in HTML, and holds the escapes the dialect has", () => {
    expect(parseInline("<U>x</U>").map((t) => t.kind)).toEqual(["underline"]);
    const [t] = parseInline("<u>a\\*b</u>");
    expect(t.kind === "underline" && parseInline(t.text).map((x) => (x.kind === "text" ? x.text : x.kind))).toEqual(["a", "*", "b"]);
  });

  it("leaves a tag inside code, and a tag with no pair, as text", () => {
    expect(parseInline("`<u>x</u>`").map((t) => t.kind)).toEqual(["code"]);
    expect(parseInline("1 < 2 and 3 > 2").map((t) => t.kind)).toEqual(["text"]);
    expect(parseInline("<b>x</b>").map((t) => t.kind)).toEqual(["text"]);
  });
});

describe("an old __text__ is read as it always was (O2)", () => {
  // The reading today: `__x__` is underline in this app (CommonMark, Obsidian and Pandoc read it as bold). It needs a word, not a space, against each
  // `__`; the `__` must not touch a letter, a digit or an underscore outside; a single `_` may sit inside; nothing crosses a line.
  it("is underline, with the positions it had: two characters of marker each side", () => {
    expect(parseInline("a __b__ ==c==")).toEqual([
      { kind: "text", text: "a ", from: 0, inner: 0, to: 2 },
      { kind: "underline", text: "b", from: 2, inner: 4, to: 7 },
      { kind: "text", text: " ", from: 7, inner: 7, to: 8 },
      { kind: "mark", text: "c", from: 8, inner: 10, to: 13 },
    ]);
  });

  it("refuses what it refused: a space inside, a word outside, three underscores, a pair across a line, a single underscore at an edge", () => {
    for (const text of ["__ x __", "a__b__c", "snake__case__name", "___x___", "__a\nb__", "__x", "x__", "__a_ __"]) {
      expect(parseInline(text).map((t) => t.kind), JSON.stringify(text)).toEqual(["text"]);
    }
    expect(parseInline("__a_b__").map((t) => t.kind)).toEqual(["underline"]);
  });

  it("is still what the toolbar writes: the markers are unchanged, and so is a selection's underline", () => {
    expect(MARKERS).toEqual({ strong: "**", em: "*", underline: "__", mark: "==", code: "`" });
    const e = markEdit("alpha beta", 6, 10, "underline");
    expect("alpha beta".slice(0, e.from) + e.text + "alpha beta".slice(e.to)).toBe("alpha __beta__");
  });

  it("is read beside the new form in one block: both are underline", () => {
    expect(parseInline("__old__ and <u>new</u>").map((t) => t.kind)).toEqual(["underline", "text", "underline"]);
  });
});

describe("portableUnderline writes a block's underline as <u>…</u> (O2)", () => {
  const written: [string, string][] = [
    ["a __b__ c", "a <u>b</u> c"],
    ["__two words__", "<u>two words</u>"],
    ["**__both__**", "**<u>both</u>**"],
    ["__**both**__", "<u>**both**</u>"],
    ["==__x__==", "==<u>x</u>=="],
    ["***__x__***", "***<u>x</u>***"],
    ["__a__ and __b__ and **c**", "<u>a</u> and <u>b</u> and **c**"],
    ["__a\\_b__", "<u>a\\_b</u>"],
    ["__a_b__", "<u>a_b</u>"],
    ["__outer **mid _in_** end__", "<u>outer **mid _in_** end</u>"],
  ];

  it.each(written)("%s → %s", (src, out) => {
    expect(portableUnderline(src)).toBe(out);
  });

  it("changes nothing that is not an underline, character for character", () => {
    const keeps = [
      "",
      "plain words",
      "**bold** *italic* _italic_ ==mark== `code`",
      "`__x__` stays in code",
      "[__a__](https://example.org/a__b__c) a link's text and address",
      "https://example.org/a__b__c a bare address",
      "[@lin2024; @roe2023] and [[Another note]]",
      "snake__case__name and a_b_c and __ x __ and ___x___",
      "a__b__c is not underline here either",
      "an escape \\* \\_ \\= stays",
      "1 < 2 and 3 > 2 and <b>x</b>",
      "already <u>written</u>",
      "***bold italic***",
      "trailing space ",
    ];
    for (const src of keeps) expect(portableUnderline(src), JSON.stringify(src)).toBe(src);
  });

  it("writes every underline of every sample with an opening <u>, never `__`, at any depth — and leaves the meaning where it was", () => {
    for (const [src] of written) {
      const out = portableUnderline(src);

      expect(openers(out).every((o) => o === "<u>"), out).toBe(true);
      expect(openers(out), out).toHaveLength(openers(src).length);
      expect(shape(out), out).toEqual(shape(src));
      expect(plainInline(out), out).toBe(plainInline(src));
    }
  });

  it("is idempotent, and a source already in the new form comes back as it is", () => {
    for (const [src, out] of written) {
      expect(portableUnderline(out)).toBe(out);
      expect(portableUnderline(portableUnderline(src))).toBe(out);
    }
  });

  it("one note's blocks — bold, italic, underline, a two-level list — come out with only the underline changed", () => {
    // the blocks' stored text, as the Markdown route writes it verbatim today (`- ` / two spaces of indent are the route's, not the text's)
    const blocks = ["**Bold** and *italic* and __underlined__ in one line", "first item with __under__", "nested item with __under__ and **bold** and *em*"];

    expect(blocks.map(portableUnderline)).toEqual([
      "**Bold** and *italic* and <u>underlined</u> in one line",
      "first item with <u>under</u>",
      "nested item with <u>under</u> and **bold** and *em*",
    ]);
  });
});

describe("the helper reads what parseInline reads (no second dialect)", () => {
  it("every token of the output covers the output, and the underlines are where the source had them, in order", () => {
    const src = "a __b__ **c __d__ e** ==__f__== g";
    const out = portableUnderline(src);
    const words = (s: string, acc: string[] = []): string[] => {
      for (const t of parseInline(s) as Inline[]) {
        if (isWrapping(t)) {
          if (t.kind === "underline") acc.push(t.text.replace(/\*\*|==/g, ""));
          words(t.text, acc);
        }
      }
      return acc;
    };

    expect(words(out)).toEqual(words(src));
    expect(words(src)).toEqual(["b", "d", "f"]);
  });
});
