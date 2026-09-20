import { describe, expect, it } from "vitest";
import type { Citable, Note } from "./types";
import { authorYear, baseKey, keyFor, sourceOf, surname, yearOf } from "./cite";
import { citedIn, parseInline, plainInline } from "./inline";
import {
  block,
  citedKeys,
  excerpt,
  indentBlock,
  isUntouched,
  listNumber,
  moveBlock,
  parseMarkdown,
  shortcut,
  wordCount,
} from "./blocks";
import { fileName, reference, toBibtex, toMarkdown } from "./export";
import { abstractOpening, outlineDraft, readingNote, relatedWorkDraft } from "./templates";

const ROSE: Citable = {
  id: "zenodo:1",
  title: "Applications of Machine Learning",
  authors: ["Dr. R. Reena Rose", "Ms.Sangeetha Ma", "A. Third"],
  venue: "Zenodo",
  publishedDate: "2024-03-01",
  url: "https://zenodo.org/records/1",
  abstract:
    "Machine learning is used across fields. This paper surveys its applications. It closes with open problems.",
};
const ROSE_AGAIN: Citable = { ...ROSE, id: "zenodo:2", title: "Applications of Deep Learning" };
const SOLO: Citable = { id: "arxiv:9", title: "The Theory of Everything & More", authors: ["Anna Müller"], publishedDate: "2021" };

describe("citing", () => {
  it("reads the surname the way the record writes the name", () => {
    expect(surname("Dr. R. Reena Rose")).toBe("Rose");
    expect(surname("Smith, John")).toBe("Smith");
    expect(surname("Martin Luther King Jr.")).toBe("King");
    expect(surname("")).toBe("");
  });

  it("takes the year from a date or a bare year, and invents none", () => {
    expect(yearOf("2024-05-01")).toBe(2024);
    expect(yearOf("2021")).toBe(2021);
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf("soon")).toBeUndefined();
  });

  it("builds BibTeX-style keys: surname, year, first word that carries meaning", () => {
    expect(baseKey(ROSE)).toBe("rose2024applications");
    expect(baseKey(SOLO)).toBe("muller2021theory");
    expect(baseKey({ title: "On Graphs", authors: [], publishedDate: undefined })).toBe("graphs");
  });

  it("keeps a paper's key in a note and never gives two papers the same one", () => {
    const sources = { rose2024applications: sourceOf(ROSE, "rose2024applications") };
    expect(keyFor(ROSE, sources)).toBe("rose2024applications");
    expect(keyFor(ROSE_AGAIN, sources)).toBe("rose2024applicationsb");
  });

  it("reads a citation as author and year", () => {
    expect(authorYear(sourceOf(ROSE, "k"))).toBe("Rose et al., 2024");
    expect(authorYear(sourceOf({ ...ROSE, authors: ["A Rose", "B Ma"] }, "k"))).toBe("Rose & Ma, 2024");
    expect(authorYear(sourceOf(SOLO, "k"))).toBe("Müller, 2021");
    expect(authorYear(sourceOf({ ...SOLO, publishedDate: undefined }, "k"))).toBe("Müller, n.d.");
    expect(authorYear(sourceOf({ ...SOLO, authors: [] }, "k"))).toBe("The Theory of, 2021");
  });
});

describe("inline markdown", () => {
  it("keeps each token's place in the source, so a click can find the caret", () => {
    const tokens = parseInline("a **b** c");
    expect(tokens).toEqual([
      { kind: "text", text: "a ", from: 0, inner: 0, to: 2 },
      { kind: "strong", text: "b", from: 2, inner: 4, to: 7 },
      { kind: "text", text: " c", from: 7, inner: 7, to: 9 },
    ]);
  });

  it("reads emphasis, code, links and bare links", () => {
    const kinds = (s: string) => parseInline(s).map((t) => t.kind);
    expect(kinds("*x* _y_ `z`")).toEqual(["em", "text", "em", "text", "code"]);
    expect(kinds("[docs](https://x.org)")).toEqual(["link"]);
    const url = parseInline("see https://x.org/a.")[1];
    expect(url).toMatchObject({ kind: "url", href: "https://x.org/a" });
  });

  it("leaves underscores inside words alone", () => {
    expect(parseInline("snake_case_word").map((t) => t.kind)).toEqual(["text"]);
  });

  it("reads Pandoc citations, one or several, and nothing that is not a key", () => {
    expect(parseInline("[@rose2024applications]")[0]).toMatchObject({ kind: "cite", keys: ["rose2024applications"] });
    expect(parseInline("[@a; @b]")[0]).toMatchObject({ kind: "cite", keys: ["a", "b"] });
    expect(parseInline("[@not a key]").map((t) => t.kind)).toEqual(["text"]);
    expect(citedIn("As [@a] and [@b; @a] show")).toEqual(["a", "b", "a"]);
  });

  it("reads Obsidian links to other notes", () => {
    expect(parseInline("see [[Reading list]]")[1]).toMatchObject({ kind: "wiki", target: "Reading list" });
  });

  it("gives the words without their markup, citations resolved", () => {
    expect(plainInline("**Bold** claim [@k]", () => "Rose, 2024")).toBe("Bold claim (Rose, 2024)");
  });
});

describe("blocks", () => {
  it("turns Markdown typed at the start of a block into its kind", () => {
    expect(shortcut("# Title")).toEqual({ type: "h1", text: "Title" });
    expect(shortcut("### x")).toEqual({ type: "h3", text: "x" });
    expect(shortcut("- item")).toEqual({ type: "bullet", text: "item" });
    expect(shortcut("1. first")).toEqual({ type: "numbered", text: "first" });
    expect(shortcut("[] task")).toEqual({ type: "todo", text: "task" });
    expect(shortcut("[x] done")).toEqual({ type: "todo", text: "done", checked: true });
    expect(shortcut("> said")).toEqual({ type: "quote", text: "said" });
    expect(shortcut("```js")).toEqual({ type: "code", text: "js" });
    expect(shortcut("#hashtag")).toBeNull();
    expect(shortcut("plain")).toBeNull();
  });

  it("numbers a list across nested children, and restarts after a break", () => {
    const blocks = [
      block("numbered", "a"),
      block("bullet", "nested", { indent: 1 }),
      block("numbered", "b"),
      block("text", "break"),
      block("numbered", "c"),
    ];
    expect([0, 2, 4].map((i) => listNumber(blocks, i))).toEqual([1, 2, 1]);
  });

  it("moves a block into a gap counted before the move", () => {
    const [a, b, c] = [block("text", "a"), block("text", "b"), block("text", "c")];
    const text = (bs: typeof a[]) => bs.map((x) => x.text).join("");
    expect(text(moveBlock([a, b, c], 0, 3))).toBe("bca");
    expect(text(moveBlock([a, b, c], 2, 0))).toBe("cab");
    expect(text(moveBlock([a, b, c], 1, 1))).toBe("abc");
  });

  it("indents what nests, within bounds, and leaves headings at the margin", () => {
    const blocks = [block("bullet", "x"), block("h2", "Section")];
    expect(indentBlock(blocks, 0, 1)[0].indent).toBe(1);
    expect(indentBlock(indentBlock(blocks, 0, 1), 0, -5)[0].indent).toBeUndefined();
    expect(indentBlock(blocks, 1, 1)).toBe(blocks);
  });

  it("reads pasted Markdown as blocks, and mends text wrapped by a PDF", () => {
    const blocks = parseMarkdown(
      [
        "# Title",
        "A sentence that a PDF",
        "broke across two lines.",
        "",
        "- one",
        "  - nested",
        "- [x] done",
        "1. first",
        "> quoted",
        "> on two lines",
        "---",
        "```",
        "let x = 1;",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((b) => [b.type, b.text, b.indent ?? 0])).toEqual([
      ["h1", "Title", 0],
      ["text", "A sentence that a PDF broke across two lines.", 0],
      ["bullet", "one", 0],
      ["bullet", "nested", 1],
      ["todo", "done", 0],
      ["numbered", "first", 0],
      ["quote", "quoted\non two lines", 0],
      ["divider", "", 0],
      ["code", "let x = 1;", 0],
    ]);
    expect(blocks[4].checked).toBe(true);
  });

  it("lists cited keys in order of first appearance, paper cards included", () => {
    const note = { blocks: [block("paper", "", { cite: "b" }), block("text", "[@a] then [@b; @c]")] };
    expect(citedKeys(note)).toEqual(["b", "a", "c"]);
  });

  it("knows a note nobody has written in, so Write reuses it", () => {
    expect(isUntouched({ title: "", blocks: [block("text")] })).toBe(true);
    expect(isUntouched({ title: "", blocks: [block("text", "   ")] })).toBe(true);
    expect(isUntouched({ title: "Draft", blocks: [block("text")] })).toBe(false);
    expect(isUntouched({ title: "", blocks: [block("text", "a word")] })).toBe(false);
    expect(isUntouched({ title: "", blocks: [block("paper", "", { cite: "k" })] })).toBe(false);
    expect(isUntouched(readingNote(ROSE))).toBe(false);
  });

  it("excerpts the prose, not the headings, with citations read as authors", () => {
    const note = {
      blocks: [block("h2", "Heading"), block("text", "Shown **here** [@k]."), block("code", "hidden")],
      sources: { k: sourceOf(SOLO, "k") },
    };
    expect(excerpt(note)).toBe("Shown here (Müller, 2021).");
    expect(wordCount(note)).toBe(6);
  });
});

function noteOf(partial: Partial<Note>): Note {
  return {
    id: "n",
    title: "Draft",
    blocks: [],
    sources: {},
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-19T12:00:00.000Z",
    ...partial,
  };
}

describe("export", () => {
  const sources = { rose2024applications: sourceOf(ROSE, "rose2024applications"), muller2021theory: sourceOf(SOLO, "muller2021theory") };

  it("writes Markdown Obsidian and Pandoc both read, prompts left behind", () => {
    const md = toMarkdown(
      noteOf({
        title: 'A "draft"',
        sources,
        blocks: [
          block("h1", "Intro"),
          block("text", "As [@muller2021theory] argues.  "),
          block("text", "", { hint: "never exported" }),
          block("bullet", "one"),
          block("bullet", "two", { indent: 1 }),
          block("numbered", "first"),
          block("numbered", "second"),
          block("todo", "check", { checked: true }),
          block("quote", "line one\nline two"),
          block("code", "x = 1"),
          block("divider"),
          block("paper", "", { cite: "rose2024applications" }),
        ],
      }),
    );
    expect(md).toBe(
      [
        "---",
        'title: "A \\"draft\\""',
        "created: 2026-09-18",
        "updated: 2026-09-19",
        "---",
        "",
        "# Intro",
        "",
        "As [@muller2021theory] argues.",
        "",
        "- one",
        "    - two",
        "1. first",
        "2. second",
        "- [x] check",
        "",
        "> line one",
        "> line two",
        "",
        "```",
        "x = 1",
        "```",
        "",
        "---",
        "",
        "> [@rose2024applications] Rose et al., 2024. *Applications of Machine Learning*. Zenodo. <https://zenodo.org/records/1>",
        "",
        "## References",
        "",
        "- [@muller2021theory] Anna Müller (2021). The Theory of Everything & More.",
        "- [@rose2024applications] Dr. R. Reena Rose, Ms.Sangeetha Ma, A. Third (2024). Applications of Machine Learning. *Zenodo*. https://zenodo.org/records/1",
        "",
      ].join("\n"),
    );
    expect(md).not.toContain("never exported");
  });

  it("writes BibTeX with the same keys, honorifics dropped and specials escaped", () => {
    const bib = toBibtex(noteOf({ sources, blocks: [block("text", "[@muller2021theory] [@rose2024applications]")] }));
    expect(bib).toContain("@misc{muller2021theory,\n  title = {{The Theory of Everything \\& More}},\n  author = {Anna Müller},\n  year = {2021},\n}");
    expect(bib).toContain("author = {R. Reena Rose and Sangeetha Ma and A. Third}");
    expect(bib).toContain("howpublished = {Zenodo}");
  });

  it("leads a reference with the title when the record names no author", () => {
    const anonymous = sourceOf({ ...SOLO, authors: [], venue: "SIAM" }, "theory2021");
    expect(reference(anonymous)).toBe("The Theory of Everything & More. (2021). *SIAM*.");
  });

  it("names files after the note", () => {
    expect(fileName({ title: "Related work: GNNs" }, "md")).toBe("Related-work-GNNs.md");
    expect(fileName({ title: "" }, "bib")).toBe("note.bib");
  });
});

describe("templates", () => {
  it("opens an abstract on its first two sentences, the cut marked", () => {
    expect(abstractOpening(ROSE.abstract)).toBe(
      "Machine learning is used across fields. This paper surveys its applications. …",
    );
    expect(abstractOpening("One sentence only.")).toBe("One sentence only.");
    expect(abstractOpening("")).toBeNull();
  });

  it("gives a paper its own notes: its card, its words, headings to answer", () => {
    const note = readingNote(ROSE, "2026-09-18T00:00:00.000Z");
    expect(note.paperId).toBe(ROSE.id);
    expect(note.title).toBe(ROSE.title);
    expect(note.blocks[0]).toMatchObject({ type: "paper", cite: "rose2024applications" });
    expect(note.sources.rose2024applications.paperId).toBe(ROSE.id);
    expect(note.blocks[1]).toMatchObject({ type: "quote" });
    // What the reader is to write is a prompt, not text.
    for (const b of note.blocks.filter((x) => x.hint)) expect(b.text).toBe("");
  });

  it("drafts related work with one paragraph per paper, keys kept apart", () => {
    const note = relatedWorkDraft([ROSE, ROSE_AGAIN]);
    const opening = note.blocks.filter((b) => b.text.startsWith("[@")).map((b) => b.text);
    expect(opening).toEqual(["[@rose2024applications] ", "[@rose2024applicationsb] "]);
    expect(Object.keys(note.sources)).toHaveLength(2);
  });

  it("outlines a paper, citing the chosen papers under related work", () => {
    const withPapers = outlineDraft([SOLO]);
    expect(withPapers.blocks.some((b) => b.text === "[@muller2021theory] ")).toBe(true);
    const bare = outlineDraft([]);
    expect(bare.sources).toEqual({});
    expect(bare.blocks.filter((b) => b.type === "h2").map((b) => b.text)).toEqual([
      "Abstract",
      "1 Introduction",
      "2 Related work",
      "3 Method",
      "4 Experiments",
      "5 Results",
      "6 Discussion",
      "7 Conclusion",
    ]);
  });
});
