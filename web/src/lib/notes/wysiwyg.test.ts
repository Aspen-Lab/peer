import { describe, expect, it } from "vitest";
import { FakeNode, fakeDocument, h, show, textNodes } from "@/test-support/fake-dom";
import { markEdit, parseInline, plainInline, strayCount, type MarkName } from "./inline";
import {
  HISTORY_GAP_MS,
  canonical,
  insertMarked,
  joinSources,
  marksAt,
  marksOpenAt,
  markSource,
  mountInline,
  newHistory,
  plainAt,
  plainOfSource,
  positionAt,
  readTree,
  readsDifferently,
  recordState,
  serializeInline,
  serializeTree,
  snapshot,
  sourceOfPlain,
  splitSource,
  stepBack,
  stepForward,
  treeOf,
} from "./wysiwyg";

// P10-16 (B16, the owner's ruling §1h.90 (a)): a note is what-you-see-is-what-you-get. The block being edited is the
// formatted text — never a `**`, `__`, `==` or backtick — and the DOM it becomes is written back to the stored source.
// The stored format is unchanged. These run on a stand-in DOM (`test-support/fake-dom.ts`: this project has no jsdom);
// what only a browser can say — focus, the selection, undo, latency — is measured in Chromium (the checkpoint).

const draw = (src: string, label: (k: string) => string = (k) => k): FakeNode => {
  const root = new FakeNode(1, "DIV");
  mountInline(fakeDocument, root as unknown as Node, treeOf(src, label));
  return root;
};
const down = (root: FakeNode): string => serializeInline(root as unknown as Node);
const at = (root: FakeNode, p: number, side: "start" | "end" = "end") => {
  const pos = positionAt(root as unknown as Node, p, side);
  return { node: pos.node as unknown as FakeNode, offset: pos.offset };
};
/** Types `s` where the browser would: into the text node the position names. */
function type(root: FakeNode, p: number, s: string, side: "start" | "end" = "end") {
  const pos = at(root, p, side);
  if (pos.node.nodeType === 3) {
    pos.node.data = pos.node.data.slice(0, pos.offset) + s + pos.node.data.slice(pos.offset);
  } else {
    const t = new FakeNode(3, "#text", s);
    pos.node.insertBefore(t, pos.node.childNodes[pos.offset] ?? null);
  }
}

const SOURCES: Record<string, string> = {
  plain: "alpha beta gamma",
  strong: "alpha **beta** gamma",
  em: "alpha *beta* gamma",
  emUnderscore: "alpha _beta_ gamma",
  underline: "alpha __beta__ gamma",
  highlight: "alpha ==beta== gamma",
  code: "alpha `beta` gamma",
  boldUnderline: "alpha __**beta**__ gamma",
  highlightUnderline: "==__alpha__== beta",
  threeDeep: "**==__alpha__==** beta",
  emInBold: "alpha **_beta_** gamma",
  boldInEm: "alpha _**beta**_ gamma",
  adjacent: "**alpha** *beta* __gamma__ ==delta==",
  adjacentNoSpace: "**a***b*",
  partOfWord: "al**ph**a",
  cite: "as shown [@rose2024] here",
  citeTwo: "[@a1; @b2] ends",
  wiki: "see [[Another note]] for more",
  link: "a [paper](https://example.org/p) b",
  url: "at https://example.org/x today",
  citeInBold: "**as [@rose2024] shows**",
  markStartsBlock: "**bold** first",
  markEndsBlock: "last **bold**",
  newline: "line one\nline two",
  newlineEnd: "line one\n",
  empty: "",
};

describe("rule 1: no markup is ever visible", () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    it(`the surface for "${name}" says exactly plainInline`, () => {
      const root = draw(src);
      expect(root.textContent).toBe(plainInline(src));
      expect(plainOfSource(src)).toBe(plainInline(src));
    });
  }

  it("no delimiter is in any text node of a marked block", () => {
    for (const src of ["**a** __b__ ==c== *d* `e`", "==__alpha__== **beta**", "**_x_** and _**y**_"]) {
      const root = draw(src);
      for (const t of textNodes(root)) expect(t.data).not.toMatch(/\*\*|__|==|`/);
      expect(root.textContent).not.toMatch(/[*`]|==|__/);
    }
  });

  it("draws the marks as the read view does: strong, em, u, mark, code; a chip is not editable and carries its source", () => {
    expect(show(draw("a **b** *c* __d__ ==e== `f`"))).toBe("a <strong>b</strong> <em>c</em> <u>d</u> <mark>e</mark> <code>f</code>");
    expect(show(draw("x [@k1] y [[Note]] z"))).toBe("x [(k1)] y [Note] z");
    const root = draw("x [@k1] y");
    const c = root.childNodes[1];
    expect(c.getAttribute("contenteditable")).toBe("false");
    expect(c.getAttribute("data-src")).toBe("[@k1]");
  });

  it("a citation reads as its label, like the read view, and the words count it the same", () => {
    const label = (k: string) => (k === "rose2024" ? "Rose et al., 2024" : `@${k}`);
    const root = draw("as [@rose2024] shows", label);
    expect(root.textContent).toBe("as (Rose et al., 2024) shows");
    expect(plainOfSource("as [@rose2024] shows", label)).toBe(root.textContent);
    expect(down(root)).toBe("as [@rose2024] shows");
  });

  it("every text node knows its place in the source", () => {
    for (const src of Object.values(SOURCES)) {
      const walk = (nodes: ReturnType<typeof treeOf>) => {
        for (const n of nodes) {
          if (n.kind === "text") expect(src.slice(n.from, n.to)).toBe(n.text);
          else if (n.kind === "mark") {
            expect(src.slice(n.inner, n.close)).toBe(n.kids.map((k) => src.slice(k.from, k.to)).join("").length ? src.slice(n.inner, n.close) : "");
            walk(n.kids);
          } else expect(src.slice(n.from, n.to)).toBe(n.src);
        }
      };
      walk(treeOf(src));
    }
  });
});

describe("rule 2: the DOM serialises back to the source, losslessly", () => {
  for (const [name, src] of Object.entries(SOURCES)) {
    it(`serializeInline(render("${name}")) is the source`, () => {
      expect(down(draw(src))).toBe(src);
    });
  }

  it("a character typed inside a bold word stays bold", () => {
    const root = draw("alpha **beta** gamma");
    type(root, 8, "X"); // inside "beta", after "be"
    expect(down(root)).toBe("alpha **beXta** gamma");
    expect(strayCount(down(root))).toBe(0);
  });

  it("at a mark's edge, the character joins the mark when typed at its END and does not at its START (the caret takes the format of the character before it)", () => {
    const end = draw("alpha **beta** gamma");
    type(end, 10, "!"); // plain offset 10 = after "beta"
    expect(down(end)).toBe("alpha **beta!** gamma");

    const start = draw("alpha **beta** gamma");
    type(start, 6, "!"); // plain offset 6 = before "beta"
    expect(down(start)).toBe("alpha !**beta** gamma");
  });

  it("where the caret sits at a mark's edge: the end is inside it, the start is in the text before it", () => {
    const root = draw("alpha **beta** gamma");
    const strong = root.childNodes[1];
    expect(at(root, 10).node).toBe(strong.childNodes[0]);
    expect(at(root, 10).offset).toBe(4);
    expect(at(root, 6).node).toBe(root.childNodes[0]);
    expect(at(root, 6).offset).toBe(6);
    // a selection over the word starts in the mark and ends in it
    expect(at(root, 6, "start").node).toBe(strong.childNodes[0]);
    expect(at(root, 10, "end").node).toBe(strong.childNodes[0]);
  });

  it("an empty mark left by a deletion is dropped", () => {
    const root = draw("alpha **beta** gamma");
    textNodes(root)[1].data = "";
    expect(down(root)).toBe("alpha  gamma");
    const nested = draw("**==__x__==** y");
    textNodes(nested)[0].data = "";
    expect(down(nested)).toBe(" y");
  });

  it("edge spaces typed inside a mark are written outside it, so the stored mark still reads (no `**alpha **`)", () => {
    const root = draw("**alpha** beta");
    type(root, 5, " "); // a space typed at the end of the bold word, inside it
    expect(down(root)).toBe("**alpha**  beta");
    expect(strayCount(down(root))).toBe(0);
    expect(parseInline(down(root))[0].kind).toBe("strong");
    const lead = draw("x **alpha**");
    type(lead, 2, " ", "start");
    expect(parseInline(down(lead)).some((t) => t.kind === "strong")).toBe(true);
  });

  it("a mark typed through to a line break is written line by line (a mark cannot span one)", () => {
    const root = draw("**ab**");
    type(root, 1, "\n");
    expect(down(root)).toBe("**a**\n**b**");
    expect(plainInline(down(root))).toBe("a\nb");
  });

  it("two marks of one kind side by side are one, and a mark inside itself is not doubled", () => {
    const root = h("div", {}, h("strong", {}, "al"), h("strong", {}, "pha"));
    expect(down(root)).toBe("**alpha**");
    expect(down(h("div", {}, h("strong", {}, "a", h("strong", {}, "b"), "c")))).toBe("**abc**");
    expect(canonical("**a****b**")).toBe("**ab**");
  });

  it("a browser's own elements are read as what they mean: <b> is bold, <i> italic, <div> and <span> only their text", () => {
    expect(down(h("div", {}, h("b", {}, "x"), " ", h("i", {}, "y"), h("span", { style: "color:red" }, " z"), h("div", {}, " w")))).toBe("**x** *y* z w");
  });

  it("a <br> the browser leaves as the last child is not a line break; one between words is; a pad is not", () => {
    expect(down(h("div", {}, "abc", h("br")))).toBe("abc");
    expect(down(h("div", {}, "a", h("br"), "b"))).toBe("a\nb");
    expect(down(h("div", {}, "abc\n", h("br", { "data-pad": "" })))).toBe("abc\n");
    expect(show(draw("abc\n"))).toBe("abc\n");
    expect(draw("abc\n").lastChild?.getAttribute("data-pad")).not.toBeNull();
    expect(draw("abc").lastChild?.nodeType).toBe(3);
  });

  it("italic inside bold is written with an underscore, bold inside italic too, so the dialect reads both back", () => {
    const a = h("div", {}, h("strong", {}, h("em", {}, "x")));
    expect(down(a)).toBe("**_x_**");
    const b = h("div", {}, h("em", {}, h("strong", {}, "x")));
    expect(down(b)).toBe("_**x**_");
    for (const src of [down(a), down(b)]) {
      expect(plainInline(src)).toBe("x");
      expect(strayCount(src)).toBe(0);
    }
  });

  it("underline is written across whole words: a letter typed against it joins it, never a half-read delimiter", () => {
    const root = h("div", {}, "a ", h("u", {}, "alpha"), "x b");
    expect(down(root)).toBe("a __alphax__ b");
    const before = h("div", {}, "a x", h("u", {}, "alpha"), " b");
    expect(down(before)).toBe("a __xalpha__ b");
  });

  it("a mark the dialect cannot read back is left unwritten, never shown (underline beside a word in another mark; a star inside bold)", () => {
    const hidden = h("div", {}, "x ", h("u", {}, "a_b"), " y");
    const src = down(hidden);
    expect(plainInline(src)).toBe("x a_b y");
    expect(src).toBe("x a_b y");
    expect(plainInline(down(h("div", {}, h("strong", {}, "b"), h("u", {}, "u"), h("strong", {}, "c"))))).toBe("buc");
    expect(down(h("div", {}, h("strong", {}, "a*b")))).not.toContain("**a*b**");
    expect(plainInline(down(h("div", {}, h("strong", {}, "a*b"))))).toBe("a*b");
    expect(down(h("div", {}, h("mark", {}, "x = 1")))).not.toContain("==x = 1==");
  });

  it("code is one literal run; a backtick or newline in it takes the code mark off", () => {
    expect(down(h("div", {}, h("code", {}, "a_b"), " x"))).toBe("`a_b` x");
    expect(down(h("div", {}, h("code", {}, "a`b")))).toBe("a`b");
  });

  it("a delimiter typed as characters is read as a mark on the next render: the dialect has no escape", () => {
    const root = draw("alpha beta");
    type(root, 10, " **b**");
    const src = down(root);
    expect(src).toBe("alpha beta **b**");
    // the surface is then drawn again from the source, and the stars are gone
    expect(readsDifferently(src, snapshot(root as unknown as Node).plain)).toBe(true);
    expect(draw(src).textContent).toBe("alpha beta b");
    // a lone delimiter that matches nothing stays what it is: words
    const lone = draw("a == b");
    expect(down(lone)).toBe("a == b");
    expect(readsDifferently("a == b", "a == b")).toBe(false);
  });

  it("pasted text is words: a pasted `a **b** c` becomes the text a, bold b, c, and the stored source is as typed", () => {
    const root = draw("");
    type(root, 0, "a **b** c");
    expect(down(root)).toBe("a **b** c");
    expect(draw(down(root)).textContent).toBe("a b c");
  });
});

describe("rule 2: the source after every edit has no stray delimiter", () => {
  // a seeded walk: a source, then a hundred browser-like edits of the DOM (type, delete, split a text, wrap a run in a mark)
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const WORDS = ["alpha", "beta", "gamma", "delta", "x", "snake_case", "a=b", "2*3"];

  it("never leaves a delimiter in a text node it did not start with, and never shows one (800 edits over 8 sources)", () => {
    const starts = ["alpha beta gamma", "alpha **beta** gamma", "==__alpha__== beta", "**a** *b* __c__ ==d==", "x `code` [@k1] y", "**_x_** _**y**_ z", "al**ph**a", "**one two**"];
    for (const start of starts) {
      let src = start;
      for (let i = 0; i < 100; i++) {
        const root = draw(src);
        const total = root.textContent.length;
        const op = rnd(4);
        if (op === 0) type(root, rnd(total + 1), WORDS[rnd(WORDS.length)], rnd(2) ? "start" : "end");
        else if (op === 1 && total > 0) {
          const t = textNodes(root).filter((n) => n.data.length > 0);
          const n = t[rnd(t.length)];
          if (n) {
            const k = rnd(n.data.length);
            n.data = n.data.slice(0, k) + n.data.slice(k + 1);
          }
        } else if (op === 2) {
          const t = textNodes(root).filter((n) => n.data.length > 1);
          const n = t[rnd(t.length)];
          if (n && n.parentNode) {
            const k = 1 + rnd(n.data.length - 1);
            const mark = ["strong", "em", "u", "mark"][rnd(4)];
            const parent = n.parentNode;
            const head = new FakeNode(3, "#text", n.data.slice(0, k));
            const wrapped = h(mark, {}, n.data.slice(k));
            parent.insertBefore(head, n);
            parent.insertBefore(wrapped, n);
            parent.removeChild(n);
          }
        } else if (total > 0) {
          const t = textNodes(root).filter((n) => n.data.length > 0);
          const n = t[rnd(t.length)];
          if (n) n.data = n.data.replace(/\s/, "  ");
        }
        const next = down(root);
        // the words are what the DOM said, apart from the stars/underscores a reader typed as characters
        if (!readsDifferently(next, root.textContent)) {
          expect(plainInline(next)).toBe(root.textContent);
          expect(strayCount(next)).toBeLessThanOrEqual(strayCount(src));
          // and the source is a fixed point of draw + write
          expect(down(draw(next))).toBe(next);
        }
        src = readsDifferently(next, root.textContent) ? canonical(next) : next;
      }
    }
  });
});

describe("rule 3: the selection is the words, mapped between the DOM and the source", () => {
  it("a DOM position is a plain offset and back", () => {
    for (const src of Object.values(SOURCES)) {
      const root = draw(src);
      const total = root.textContent.length;
      for (let p = 0; p <= total; p++) {
        for (const side of ["start", "end"] as const) {
          const pos = at(root, p, side);
          const back = plainAt(root as unknown as Node, pos.node as unknown as Node, pos.offset);
          // a position inside a citation or link is its nearer edge; every other is itself
          const inChip = textNodes(root).some((t) => t.parentNode?.getAttribute("data-chip") !== null && t.parentNode !== root && false);
          const chips = root.childNodes.filter((c) => c.nodeType === 1 && c.getAttribute("data-chip") !== null);
          let start = 0;
          let strictlyInside = false;
          const walk = (n: FakeNode) => {
            for (const c of n.childNodes) {
              if (c.getAttribute?.("data-chip") !== null && c.nodeType === 1) {
                if (p > start && p < start + c.textContent.length) strictlyInside = true;
                start += c.textContent.length;
              } else if (c.nodeType === 3) start += c.data.length;
              else walk(c);
            }
          };
          start = 0;
          walk(root);
          void inChip;
          void chips;
          if (!strictlyInside) expect(back).toBe(p);
        }
      }
    }
  });

  it("the words 'beta' of 'alpha beta gamma' are source offsets 8..12 once bold, 6..10 before", () => {
    expect(sourceOfPlain(treeOf("alpha **beta** gamma"), 6, "start")).toBe(8);
    expect(sourceOfPlain(treeOf("alpha **beta** gamma"), 10, "end")).toBe(12);
    expect(sourceOfPlain(treeOf("alpha beta gamma"), 6, "start")).toBe(6);
    expect(sourceOfPlain(treeOf("alpha beta gamma"), 10, "end")).toBe(10);
  });

  it("a position inside a citation is the citation's edge: it is selected whole or not at all", () => {
    const root = draw("see [@rose2024] now");
    const c = root.childNodes[1];
    expect(plainAt(root as unknown as Node, c.childNodes[0] as unknown as Node, 3)).toBe(4 + "(rose2024)".length);
    expect(plainAt(root as unknown as Node, c as unknown as Node, 0)).toBe(4);
    expect(sourceOfPlain(treeOf("see [@rose2024] now"), 6, "end")).toBe(4);
  });

  const press = (src: string, from: number, to: number, mark: MarkName) => markSource(src, from, to, mark)?.text ?? null;

  it("Ctrl/⌘ B over 'beta' gives `alpha **beta** gamma`; the selection is still over 'beta'", () => {
    const next = press("alpha beta gamma", 6, 10, "strong");
    expect(next).toBe("alpha **beta** gamma");
    const root = draw(next!);
    // the same plain range 6..10 is the word, and it sits inside the bold
    const a = at(root, 6, "start");
    const b = at(root, 10, "end");
    expect(a.node).toBe(root.childNodes[1].childNodes[0]);
    expect(b.node).toBe(root.childNodes[1].childNodes[0]);
    expect(a.node.data.slice(a.offset, b.offset)).toBe("beta");
  });

  it("then Ctrl/⌘ U on the same selection nests the underline OUTSIDE the bold: `alpha __**beta**__ gamma`", () => {
    const bold = press("alpha beta gamma", 6, 10, "strong")!;
    const next = press(bold, 6, 10, "underline");
    expect(next).toBe("alpha __**beta**__ gamma");
    expect(plainInline(next!)).toBe("alpha beta gamma");
    expect(strayCount(next!)).toBe(0);
    // then highlight: the nesting P10-13 fixes, `==` outermost
    const hi = press(next!, 6, 10, "mark");
    expect(hi).toBe("alpha ==__**beta**__== gamma");
    expect(strayCount(hi!)).toBe(0);
  });

  it("the toggle off: pressing the same mark again over the same words takes it off", () => {
    const hi = "alpha ==__**beta**__== gamma";
    expect(press(hi, 6, 10, "mark")).toBe("alpha __**beta**__ gamma");
    expect(press("alpha __**beta**__ gamma", 6, 10, "underline")).toBe("alpha **beta** gamma");
    expect(press("alpha **beta** gamma", 6, 10, "strong")).toBe("alpha beta gamma");
  });

  it("every key over the same selection leaves the visible words alone, and no other mark is lost", () => {
    let src = "alpha beta gamma";
    const steps: [MarkName, string | null][] = [
      ["strong", "alpha **beta** gamma"],
      ["underline", "alpha __**beta**__ gamma"],
      ["mark", "alpha ==__**beta**__== gamma"],
      // bold, underline and italic together have no spelling in the dialect (no star in bold, no underscore in underline): refused
      ["em", null],
      ["underline", "alpha ==**beta**== gamma"],
      ["em", "alpha _==**beta**==_ gamma"],
      ["strong", "alpha _==beta==_ gamma"],
      ["mark", "alpha _beta_ gamma"],
    ];
    for (const [m, want] of steps) {
      const next = markSource(src, 6, 10, m);
      expect(next?.text ?? null).toBe(want);
      if (next) src = next.text;
      expect(plainOfSource(src)).toBe("alpha beta gamma");
      expect(strayCount(src)).toBe(0);
      expect(draw(src).textContent).toBe("alpha beta gamma");
      expect(down(draw(src))).toBe(src);
    }
  });

  it("italic over bold is spelled so the dialect reads it (`**_beta_**`), not `***beta***` with its stars shown", () => {
    const next = press("alpha **beta** gamma", 6, 10, "em");
    expect(next).toBe("alpha **_beta_** gamma");
    expect(plainInline(next!)).toBe("alpha beta gamma");
    expect(press("alpha *beta* gamma", 6, 10, "strong")).toBe("alpha **_beta_** gamma");
  });

  it("an edit that would leave a delimiter unmatched writes nothing", () => {
    expect(markEdit("__alpha__==beta==", 9, 13, "mark").text).toBe("");
    expect(press("__alpha__==beta==", 5, 9, "mark")).toBeNull();
  });

  it("a selection of part of a word with underline takes the whole word (underline is read across whole words)", () => {
    expect(press("alpha beta gamma", 8, 10, "underline")).toBe("alpha __beta__ gamma");
  });

  it("a selection over a citation marks around it, whole", () => {
    const src = "as [@k1] shows";
    const next = press(src, 3, 3 + "(k1)".length, "strong");
    expect(next).toBe("as **[@k1]** shows");
    expect(draw(next!).textContent).toBe("as (k1) shows");
  });

  it("nothing selected: a mark key toggles the mark for what is typed next — the surface keeps it pending and writes the typed text wearing it", () => {
    // at the end of "alpha ": bold on, then "beta" typed
    const a = insertMarked("alpha ", 6, "b", ["strong"]);
    expect(a.text).toBe("alpha **b**");
    expect(a.plain).toBe(7);
    // inside a bold word: bold toggled off, the word is split around the typed text
    const marks = marksAt("alpha **beta** gamma", 8);
    expect(marks).toEqual(["strong"]);
    const b = insertMarked("alpha **beta** gamma", 8, "X", []);
    expect(b.text).toBe("alpha **be**X**ta** gamma");
    // underline pending over bold already there
    const c = insertMarked("alpha **beta** gamma", 8, "X", ["strong", "underline"]);
    expect(c.text).toBe("alpha **__beXta__** gamma"); // underline is read across the whole word
    expect(strayCount(c.text)).toBe(0);
    expect(plainInline(c.text)).toBe("alpha beXta gamma");
  });
});

describe("a mark the reader closes by typing its delimiter ends there", () => {
  it("the marks still open where a mark just closed: the text typed next is outside it, inside the ones around it", () => {
    expect(marksOpenAt("hello *italic*", 12)).toEqual([]);
    expect(marksOpenAt("**one _two_ three**", 7)).toEqual(["strong"]);
    expect(marksOpenAt("**one** two", 3)).toEqual([]);
    expect(marksOpenAt("**one two**", 3)).toEqual(["strong"]);
  });

  it("typed text with no marks wanted lands after the mark: `hello *italic*` + ` and` is `hello *italic* and`", () => {
    const next = insertMarked("hello *italic*", 12, " ", []);
    expect(next.text).toBe("hello *italic* ");
    expect(next.caret).toBe(15);
    expect(next.plain).toBe(13);
  });

  it("a delimiter typed through the editor's own insertion is read as a mark, and the visible words tell it", () => {
    const next = insertMarked("third **bold word*", 17, "*", []);
    expect(next.text).toBe("third **bold word**");
    expect(readsDifferently(next.text, "third **bold word**")).toBe(true);
    expect(plainOfSource(next.text)).toBe("third bold word");
  });
});

describe("undo gives back the selection a step had when it was left", () => {
  const S = (text: string, from: number, to = from) => ({ text, from, to });
  it("an edit records the selection just before it on the state it leaves", () => {
    let h = newHistory(S("alpha beta", 10));
    h = recordState(h, S("alpha **beta**", 6, 10), "edit", 1, { from: 6, to: 10 });
    h = recordState(h, S("alpha **beta** x", 16), "type", 5000, { from: 10, to: 10 });
    expect(h.states.map((st) => [st.text, st.from, st.to])).toEqual([
      ["alpha beta", 6, 10],
      ["alpha **beta**", 10, 10],
      ["alpha **beta** x", 16, 16],
    ]);
    // undoing the typing puts the caret where it was when the typing began
    expect(stepBack(h)!.state).toEqual(S("alpha **beta**", 10, 10));
  });
});

describe("rule 4: Enter splits, Backspace joins, the marks stay whole", () => {
  it("splitting inside a bold word closes the bold on the left and opens it on the right", () => {
    expect(splitSource("alpha **beta** gamma", 8)).toEqual({ head: "alpha **be**", tail: "**ta** gamma" });
    expect(splitSource("alpha beta", 5)).toEqual({ head: "alpha", tail: " beta" });
  });

  it("splitting at a selection drops what it covers; a split at a mark's edge leaves no empty mark", () => {
    expect(splitSource("alpha **beta** gamma", 6, 10)).toEqual({ head: "alpha ", tail: " gamma" });
    expect(splitSource("alpha **beta** gamma", 10)).toEqual({ head: "alpha **beta**", tail: " gamma" });
    expect(splitSource("**alpha** beta", 0)).toEqual({ head: "", tail: "**alpha** beta" });
    expect(splitSource("==__alpha__== b", 2)).toEqual({ head: "==__al__==", tail: "==__pha__== b" });
  });

  it("splitting a block with a citation never cuts into it", () => {
    expect(splitSource("a [@k1] b", 2)).toEqual({ head: "a ", tail: "[@k1] b" });
    expect(splitSource("a [@k1] b", 2 + "(k1)".length)).toEqual({ head: "a [@k1]", tail: " b" });
  });

  it("joining two blocks keeps their marks, and merges the one a split cut: **al** + **pha** is **alpha**", () => {
    expect(joinSources("**al**", "**pha** beta")).toEqual({ text: "**alpha** beta", caret: 4, plain: 2 });
    expect(joinSources("__a__", "__b__").text).toBe("__ab__");
    expect(joinSources("alpha ", "**beta**")).toEqual({ text: "alpha **beta**", caret: 6, plain: 6 });
    expect(joinSources("", "x").text).toBe("x");
  });

  it("joining then splitting at the join is the original pair (marks are not lost either way)", () => {
    const j = joinSources("one **two**", " three __four__");
    expect(splitSource(j.text, j.plain)).toEqual({ head: "one **two**", tail: " three __four__" });
  });
});

describe("rule 4: undo is a stack of sources, one step per run of typing", () => {
  const S = (text: string, from = text.length, to = from) => ({ text, from, to });

  it("a typed word is one step: undo restores the text before it, with the selection it had", () => {
    let h = newHistory(S("alpha ", 6));
    h = recordState(h, S("alpha b"), "type", 1000);
    h = recordState(h, S("alpha be"), "type", 1100);
    h = recordState(h, S("alpha bet"), "type", 1200);
    expect(h.states).toHaveLength(2);
    const back = stepBack(h)!;
    expect(back.state).toEqual(S("alpha ", 6));
    expect(stepBack(back.history)).toBeNull();
  });

  it("a pause, a different kind of edit, or a mark starts a new step", () => {
    let h = newHistory(S("a"));
    h = recordState(h, S("ab"), "type", 1000);
    h = recordState(h, S("abc"), "type", 1000 + HISTORY_GAP_MS + 1);
    h = recordState(h, S("ab"), "delete", 1000 + HISTORY_GAP_MS + 5);
    h = recordState(h, S("**ab**"), "edit", 1000 + HISTORY_GAP_MS + 6);
    h = recordState(h, S("**abc**"), "type", 1000 + HISTORY_GAP_MS + 7);
    expect(h.states.map((s) => s.text)).toEqual(["a", "ab", "abc", "ab", "**ab**", "**abc**"]);
  });

  it("redo returns what undo took; a new edit after undo drops what was ahead", () => {
    let h = newHistory(S("a"));
    h = recordState(h, S("ab"), "edit", 1);
    h = recordState(h, S("abc"), "edit", 2);
    const u1 = stepBack(h)!;
    const u2 = stepBack(u1.history)!;
    expect(u2.state.text).toBe("a");
    const r1 = stepForward(u2.history)!;
    expect(r1.state.text).toBe("ab");
    const forked = recordState(r1.history, S("abX"), "edit", 3);
    expect(forked.states.map((s) => s.text)).toEqual(["a", "ab", "abX"]);
    expect(stepForward(forked)).toBeNull();
  });

  it("an undo of a mark brings back the source without it", () => {
    let h = newHistory(S("alpha beta", 6, 10));
    h = recordState(h, S("alpha **beta**", 6, 10), "edit", 5);
    expect(stepBack(h)!.state).toEqual(S("alpha beta", 6, 10));
  });

  it("keeps at most 200 steps", () => {
    let h = newHistory(S("0"));
    for (let i = 1; i < 300; i++) h = recordState(h, S(String(i)), "edit", i);
    expect(h.states.length).toBe(200);
    expect(h.states[h.at].text).toBe("299");
  });
});

describe("serializeTree and canonical", () => {
  it("the canonical spelling of a source is a fixed point", () => {
    for (const src of Object.values(SOURCES)) expect(canonical(canonical(src))).toBe(canonical(src));
  });

  it("an emphasised run keeps the delimiter it was read with", () => {
    expect(canonical("a _b_ c")).toBe("a _b_ c");
    expect(canonical("a *b* c")).toBe("a *b* c");
  });

  it("serializeTree places each text node in the source it wrote", () => {
    const { src, tree } = serializeTree(readTree(draw("a **b** c") as unknown as Node));
    const texts: string[] = [];
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.kind === "text") texts.push(src.slice(n.from, n.to));
        else if (n.kind === "mark") walk(n.kids);
      }
    };
    walk(tree);
    expect(texts).toEqual(["a ", "b", " c"]);
  });
});

describe("the cost of a keystroke", () => {
  it("serialising a 20,000-character block with a hundred marks takes well under a frame", () => {
    const words = Array.from({ length: 2500 }, (_, i) => (i % 25 === 0 ? `**w${i}**` : i % 31 === 0 ? `__u${i}__` : `word${i}`)).join(" ");
    const root = draw(words);
    expect(root.textContent.length).toBeGreaterThan(15000);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) serializeInline(root as unknown as Node);
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(16);
  });
});
