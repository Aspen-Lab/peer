import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineText } from "@/components/notes/inline-text";
import { block } from "./blocks";
import { toMarkdown, toPlainText, toWordHtml } from "./export";
import { isWrapping, markEdit, parseInline, plainInline, type MarkName } from "./inline";
import type { Note } from "./types";

// P10-13 (B16, ruling §1h.87 (h)): a mark laid over marked text nests — underline + highlight on one word is
// `==__alpha__==`, never `==alpha__==__ ==hl==` — and the nested marks survive every export.

const apply = (src: string, start: number, end: number, mark: MarkName) => {
  const e = markEdit(src, start, end, mark);
  return { out: src.slice(0, e.from) + e.text + src.slice(e.to), caret: e.caret, edit: e };
};

/** Every text run (at any depth of nesting) that still holds a lone `__` or `==`: a delimiter that matched nothing. */
function strays(src: string): string[] {
  return parseInline(src).flatMap((t) => (t.kind === "text" ? (/__|==/.test(t.text) ? [t.text] : []) : isWrapping(t) ? strays(t.text) : []));
}

/** Every kind in the parse, nested ones included, outermost first. */
function kinds(src: string): string[] {
  return parseInline(src).flatMap((t) => (isWrapping(t) ? [t.kind, ...kinds(t.text)] : t.kind === "text" ? [] : [t.kind]));
}

describe("a mark over a marked range nests (rule 1)", () => {
  it("underline then highlight on one word: ==__alpha__==, with the word selected inside, equal to, or covering the underline", () => {
    expect(apply("__alpha__", 2, 7, "mark").out).toBe("==__alpha__==");
    expect(apply("__alpha__", 0, 9, "mark").out).toBe("==__alpha__==");
    expect(apply("__alpha__", 0, 9, "mark").caret).toBe(13);
    expect(apply("==alpha==", 2, 7, "underline").out).toBe("__==alpha==__");
    expect(apply("**alpha**", 2, 7, "mark").out).toBe("==**alpha**==");
  });

  it("the walk's three steps: underline, highlight, then bold on part of it", () => {
    const u = apply("alpha", 0, 5, "underline");
    expect(u.out).toBe("__alpha__");
    const h = apply(u.out, 0, u.out.length, "mark");
    expect(h.out).toBe("==__alpha__==");
    expect(strays(h.out)).toEqual([]);
    expect(kinds(h.out)).toEqual(["mark", "underline"]);
    // "pha" of the word: bold goes inside the underline, whole; no stray delimiter
    const b = apply(h.out, 6, 9, "strong");
    expect(strays(b.out)).toEqual([]);
    expect(kinds(b.out)).toContain("strong");
  });

  it("the whole word wraps when the selection is the content of the mark it sits in, however deep", () => {
    expect(apply("==__alpha__==", 4, 9, "strong").out).toBe("**==__alpha__==**");
    expect(apply("__==alpha==__", 4, 9, "strong").out).toBe("**__==alpha==__**");
  });

  it("a part of a marked run takes the mark inside it", () => {
    expect(apply("__alpha beta__", 8, 12, "mark").out).toBe("__alpha ==beta==__");
    expect(apply("==alpha beta==", 2, 7, "underline").out).toBe("==__alpha__ beta==");
  });

  it("the same mark again takes it off: around the word, inside the markers, or around a longer selection", () => {
    expect(apply("==__alpha__==", 0, 13, "mark").out).toBe("__alpha__");
    expect(apply("==__alpha__==", 2, 11, "underline").out).toBe("==alpha==");
    expect(apply("==__alpha__==", 4, 9, "underline").out).toBe("==alpha==");
    expect(apply("==__alpha__==", 4, 9, "underline").caret).toBe(9);
    expect(apply("see ==__alpha__== now", 4, 17, "underline").out).toBe("see ==alpha== now");
    // a selection that is only partly underlined gets the underline whole, never a second one inside
    expect(apply("see ==__alpha__== now", 0, 21, "underline").out).toBe("__see ==alpha== now__");
    expect(apply("__alpha__ and ==beta==", 0, 22, "mark").out).toBe("==__alpha__ and beta==");
  });

  it("a part of a run that already has the mark leaves the rest marked, with spaces outside the markers", () => {
    expect(apply("==alpha beta gamma==", 8, 12, "mark").out).toBe("==alpha== beta ==gamma==");
    expect(apply("==alpha beta==", 8, 12, "mark").out).toBe("==alpha== beta");
    expect(apply("==alpha beta==", 2, 7, "mark").out).toBe("alpha ==beta==");
  });

  it("across a mark's boundary the selection grows to the mark's edges first", () => {
    // "pha__ be" crosses the closing __ of __alpha__
    expect(apply("__alpha__ beta", 5, 12, "mark").out).toBe("==__alpha__ be==ta");
    // from the plain text into the middle of a highlight
    expect(apply("x ==alpha beta== y", 0, 8, "underline").out).toBe("__x ==alpha beta==__ y");
    // only the opening markers selected
    expect(apply("__alpha__", 0, 2, "mark").out).toBe("==__alpha__==");
  });

  it("underline does not start in the middle of a word, where it would not parse: the word is taken whole", () => {
    expect(apply("alpha", 1, 3, "underline").out).toBe("__alpha__");
    expect(apply("an alpha beta", 5, 7, "underline").out).toBe("an __alpha__ beta");
  });

  it("with nothing selected the pair is still written, caret between (unchanged)", () => {
    expect(apply("hello", 5, 5, "mark")).toMatchObject({ out: "hello====", caret: 7 });
    expect(apply("====", 2, 2, "mark").out).toBe("");
  });
});

// ── the property ───────────────────────────────────────────────────────────

const SOURCES = [
  "alpha",
  "alpha beta",
  "x alpha y",
  "__alpha__",
  "==alpha==",
  "**alpha**",
  "*alpha*",
  "a __alpha beta__ c",
  "a ==alpha beta== c",
  "a **alpha beta** c",
  "==__alpha__==",
  "__==alpha==__",
  "**__alpha__**",
  "==**alpha**==",
  "__alpha__ ==beta==",
  "==alpha== __beta__",
  "__alpha__==beta==",
  "p __q ==r== s__ t",
  "p ==q __r__ s== t",
  "==a **b __c__ d** e==",
];
const FOUR: MarkName[] = ["strong", "em", "underline", "mark"];

describe("after every edit the source parses with no stray delimiter (the four marks over every selection)", () => {
  it("the sources themselves start clean", () => {
    for (const s of SOURCES) expect(strays(s), s).toEqual([]);
  });

  it("inside, equal, across, partial: every selection of every source, every mark", () => {
    let n = 0;
    let refused = 0;
    const bad: string[] = [];
    for (const src of SOURCES) {
      for (let a = 0; a < src.length; a++) {
        for (let b = a + 1; b <= src.length; b++) {
          if (src.slice(a, b).trim() === "") continue;
          for (const m of FOUR) {
            // `*` inside `**` (or the other way round) is the dialect's own limit, not this fix's: stars are left out
            if ((m === "em" || m === "strong") && src.includes("*")) continue;
            const { out, edit } = apply(src, a, b, m);
            n++;
            if (edit.text === "" && edit.from === edit.to) refused++;
            const s = strays(out);
            if (s.length) bad.push(`${m} (${a},${b}) of ${JSON.stringify(src)} -> ${JSON.stringify(out)} strays ${JSON.stringify(s)}`);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(4000);
    expect(bad.slice(0, 8)).toEqual([]);
    // the refusal (below) is the exception, never the way most edits end
    expect(refused / n).toBeLessThan(0.01);
  });

  it("an edit that would leave a neighbour's delimiter unmatched is refused, not garbled", () => {
    // taking the highlight off `beta` would put the word against the underline's closing __
    const e = markEdit("__alpha__==beta==", 9, 17, "mark");
    expect(e.text).toBe("");
    expect(e.from).toBe(e.to);
    expect(strays("__alpha__==beta==")).toEqual([]);
  });

  it("a mark and then the same mark on the result is the way back: bold, underline, highlight over every selection", () => {
    const bad: string[] = [];
    for (const src of SOURCES.filter((s) => !s.includes("*"))) {
      for (let a = 0; a < src.length; a++) {
        for (let b = a + 1; b <= src.length; b++) {
          if (src.slice(a, b).trim() === "" || /^\s|\s$/.test(src.slice(a, b))) continue;
          for (const m of ["underline", "mark"] as MarkName[]) {
            const once = apply(src, a, b, m);
            const e = once.edit;
            if (e.text === "" && e.from === e.to) continue; // refused: the edit would have left a delimiter unmatched
            const twice = apply(once.out, e.from, e.from + e.text.length, m);
            if (strays(twice.out).length) bad.push(`${m} twice (${a},${b}) of ${JSON.stringify(src)} -> ${JSON.stringify(twice.out)}`);
          }
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });

  it("two different marks in turn, on the whole result each time, keep both and leave nothing over", () => {
    for (const [m1, m2] of [["underline", "mark"], ["mark", "underline"], ["strong", "mark"], ["underline", "strong"]] as [MarkName, MarkName][]) {
      const one = apply("alpha", 0, 5, m1);
      const two = apply(one.out, 0, one.out.length, m2);
      expect(strays(two.out)).toEqual([]);
      expect(kinds(two.out)).toEqual(expect.arrayContaining([m1 === "mark" ? "mark" : m1, m2 === "mark" ? "mark" : m2]));
      expect(plainInline(two.out)).toBe("alpha");
    }
  });
});

// ── the exports (rule 2) ───────────────────────────────────────────────────

const NEST = "==__alpha__== and **==beta==** and __==gamma==__";
const NOTE: Note = {
  id: "n1",
  title: "Nested marks",
  blocks: [block("text", NEST), block("bullet", "==__delta__==")],
  sources: {},
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};

describe("the marks survive every export, nested ones too (rule 2)", () => {
  it("plainInline drops every delimiter: ==__alpha__== is alpha", () => {
    expect(plainInline("==__alpha__==")).toBe("alpha");
    expect(plainInline(NEST)).toBe("alpha and beta and gamma");
  });

  it("the parse of a nested mark holds both: a mark whose text is an underline", () => {
    const [t] = parseInline("==__alpha__==");
    expect(t.kind).toBe("mark");
    expect(t.kind === "mark" && parseInline(t.text).map((x) => x.kind)).toEqual(["underline"]);
    expect(kinds("==__alpha__==")).toEqual(["mark", "underline"]);
  });

  it("rendered, the note shows a <mark> holding a <u>, and no delimiter", () => {
    const html = renderToStaticMarkup(createElement(InlineText, { text: "==__alpha__==", sources: {}, noteId: () => null, onMissingNote: () => {} }));
    expect(html).toMatch(/<mark[^>]*>\s*<u[^>]*>alpha<\/u>\s*<\/mark>/);
    expect(html).not.toMatch(/__|==/);
  });

  it("the plain-text and copy export is the words only", () => {
    const text = toPlainText(NOTE);
    expect(text).toContain("alpha and beta and gamma");
    expect(text).toContain("- delta");
    expect(text).not.toMatch(/__|==|\*\*/);
  });

  // Re-aimed (P12-77 O2): was "the Markdown export keeps the marks as written" and held `==__alpha__== … __==gamma==__` and `- ==__delta__==`.
  // CommonMark, Obsidian and Pandoc read `__x__` as bold, so the Markdown leaves with each underline as `<u>x</u>`; every other mark, the nesting
  // and the list marker are as they were.
  it("the Markdown export keeps the marks, the underline as <u>…</u>", () => {
    const md = toMarkdown(NOTE);
    expect(md).toContain("==<u>alpha</u>== and **==beta==** and <u>==gamma==</u>");
    expect(md).toContain("- ==<u>delta</u>==");
    expect(md).not.toContain("__");
  });

  it("the Word export has the highlight holding the underline", () => {
    const html = toWordHtml(NOTE);
    expect(html).toMatch(/<mark[^>]*>\s*<u>alpha<\/u>\s*<\/mark>/);
    expect(html).not.toMatch(/__|==/);
  });
});
