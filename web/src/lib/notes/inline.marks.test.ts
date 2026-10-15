import { describe, expect, it } from "vitest";
import { MARKERS, markEdit, parseInline, plainInline, type MarkName } from "./inline";

// P10-09b (review 7.6, B16): underline `__…__` and highlight `==…==` join bold `**…**` and italic `*…*`
// as inline marks. What is stored is the text with its marks, so they survive a reload and an export.

const apply = (src: string, start: number, end: number, mark: MarkName) => {
  const e = markEdit(src, start, end, mark);
  return { out: src.slice(0, e.from) + e.text + src.slice(e.to), caret: e.caret };
};

describe("the new marks parse", () => {
  it("reads __underline__ and ==highlight== with their source positions", () => {
    expect(parseInline("a __b__ ==c==")).toEqual([
      { kind: "text", text: "a ", from: 0, inner: 0, to: 2 },
      { kind: "underline", text: "b", from: 2, inner: 4, to: 7 },
      { kind: "text", text: " ", from: 7, inner: 7, to: 8 },
      { kind: "mark", text: "c", from: 8, inner: 10, to: 13 },
    ]);
  });

  it("needs a word at both edges: spaces inside the markers, or a bare == between spaces, are text", () => {
    expect(parseInline("a == b == c").map((t) => t.kind)).toEqual(["text"]);
    expect(parseInline("__ x __").map((t) => t.kind)).toEqual(["text"]);
    expect(parseInline("snake_case_name and a_b").map((t) => t.kind)).toEqual(["text"]);
  });

  it("leaves a mark's own markers alone in code, and keeps italic _em_ as it was", () => {
    expect(parseInline("`__x__`").map((t) => t.kind)).toEqual(["code"]);
    expect(parseInline("_em_").map((t) => t.kind)).toEqual(["em"]);
    expect(parseInline("**strong** and *em*").map((t) => t.kind)).toEqual(["strong", "text", "em"]);
  });

  it("nests: a mark inside a bold run is a mark, not literal underscores", () => {
    const [t] = parseInline("**__both__**");
    expect(t.kind).toBe("strong");
    expect(t.kind === "strong" && parseInline(t.text).map((x) => x.kind)).toEqual(["underline"]);
    expect(parseInline("==**hi**==")[0].kind).toBe("mark");
  });

  it("plain text drops every mark, nested ones included, and keeps the words", () => {
    expect(plainInline("a __b__ ==c== **d** *e* **__f__**")).toBe("a b c d e f");
  });
});

describe("markEdit — what a toolbar button or a key does to the selection", () => {
  it("names the markers", () => {
    expect(MARKERS).toEqual({ strong: "**", em: "*", underline: "__", mark: "==", code: "`" });
  });

  it("wraps the selection, caret after it", () => {
    expect(apply("hello world", 6, 11, "strong")).toEqual({ out: "hello **world**", caret: 15 });
    expect(apply("hello world", 0, 5, "underline").out).toBe("__hello__ world");
    expect(apply("hello world", 0, 5, "mark").out).toBe("==hello== world");
    expect(apply("hello world", 0, 5, "em").out).toBe("*hello* world");
  });

  it("with nothing selected writes the pair and leaves the caret between", () => {
    expect(apply("hello", 5, 5, "mark")).toEqual({ out: "hello====", caret: 7 });
    expect(apply("", 0, 0, "strong")).toEqual({ out: "****", caret: 2 });
  });

  it("keeps the markers off the selection's spaces, which would stop them from parsing", () => {
    const r = apply("a word b", 1, 7, "strong");
    expect(r.out).toBe("a **word** b");
    expect(parseInline(r.out).map((t) => t.kind)).toEqual(["text", "strong", "text"]);
  });

  it("takes the mark off again: the markers around the selection, or inside it", () => {
    expect(apply("**world**", 2, 7, "strong")).toEqual({ out: "world", caret: 5 });
    expect(apply("say **world**", 4, 13, "strong").out).toBe("say world");
    expect(apply("__x__", 2, 3, "underline").out).toBe("x");
    expect(apply("==x==", 2, 3, "mark").out).toBe("x");
  });

  it("does not read italic's single star inside bold's double as italic already there", () => {
    expect(apply("**x**", 2, 3, "em").out).toBe("***x***");
  });

  it("every result parses back to the mark that was asked for", () => {
    const kinds: Record<MarkName, string> = { strong: "strong", em: "em", underline: "underline", mark: "mark", code: "code" };
    for (const m of Object.keys(kinds) as MarkName[]) {
      const { out } = apply("one two three", 4, 7, m);
      expect(parseInline(out).map((t) => t.kind)).toContain(kinds[m]);
    }
  });
});
