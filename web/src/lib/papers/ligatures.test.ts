import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIGATURE_CANDIDATES, LIGATURE_WORDS, applyLigatures, learnLigatures, restoreLigatures } from "./ligatures";
import { prose, type Run } from "./minimal-pdf.test-helper";
import { extractPdfTextFromBytes, readPages } from "./pdf-text";

// P12-67 (§1h.439): a font that sets fi / fl / ff / ffi / ffl as glyphs with no Unicode mapping comes out of pdf.js as
// a private-use character. Every paper below is invented; the codes are the ones the symptom showed.
const FI = "\uE103"; // "\uE103gure"
const FL = "\uE104"; // "in\uE104uence"
const FF = "\uE09D"; // "di\uE09Derent"

/** A paper in three texts: the body, a heading, a caption. Where the font ligated, the code stands. */
const PAPER = [
  // body: ligated everywhere the font did it
  `The ${FI}rst ${FI}gure shows the ${FL}ow. The in${FL}uence of the test is di${FF}erent and the e${FF}ect is clear.`,
  // heading: the same words in a face that did not ligate them
  "The First Figure and the Flow",
  // caption: the same words, plainly
  "Figure 1. The influence is different and the effect is clear in the first flow.",
];

describe("learnLigatures — rule 1: the code's ligature is learned from the paper (P12-67)", () => {
  it("learns fi, fl and ff from words the paper prints both ways", () => {
    const learned = learnLigatures(PAPER);
    expect(learned.get(FI)).toBe("fi");
    expect(learned.get(FL)).toBe("fl");
    expect(learned.get(FF)).toBe("ff");
    expect(learned.size).toBe(3);
  });

  it("learns ffi and ffl, which only a three-letter candidate can spell", () => {
    const A = "\uE0A1";
    const B = "\uE0A2";
    const learned = learnLigatures([
      `The e${A}cient o${A}ce and the su${A}cient sta${A}.`,
      `An a${B}uent o${B}ine man was ba${B}ed.`,
      "efficient office sufficient staffing; affluent offline baffled",
    ]);
    expect(learned.get(A)).toBe("ffi");
    expect(learned.get(B)).toBe("ffl");
  });

  it("learns nothing from a paper with no private-use character", () => {
    expect(learnLigatures(["The first figure shows the flow.", "An influence, a difference."]).size).toBe(0);
    expect(learnLigatures([]).size).toBe(0);
    expect(learnLigatures([""]).size).toBe(0);
  });

  it("leaves a code alone when only one word confirms it", () => {
    const A = "\uE105";
    // "figure" is printed plainly; "firuk" is no word of the paper's or the list's, so the code has one confirming word.
    const learned = learnLigatures([`The ${A}gure and the ${A}ruk.`, "The figure is clear."]);
    expect(learned.has(A)).toBe(false);
  });

  it("counts a word once however often it occurs", () => {
    const A = "\uE105";
    const learned = learnLigatures([
      `${A}gure ${A}gure ${A}gure ${A}gure ${A}gure ${A}gure`,
      "figure figure figure figure figure figure figure figure",
    ]);
    expect(learned.has(A)).toBe(false);
  });

  it("learns a code from two confirming words and no rival", () => {
    const A = "\uE105";
    const learned = learnLigatures([`The ${A}ne ${A}ve.`, "A fine day; a five."]);
    expect(learned.get(A)).toBe("fi");
  });

  it("leaves a code alone on a tie between two candidates", () => {
    const A = "\uE105";
    // fi: fine, five. fl: flat, flag. Two words each.
    const learned = learnLigatures([`${A}ne ${A}ve ${A}at ${A}ag`, "fine five flat flag"]);
    expect(learned.has(A)).toBe(false);
  });

  it("wants twice the runner-up: two to one wins, three to two does not, four to two wins", () => {
    const A = "\uE105";
    const fiWords = ["ne", "ve", "re", "sh"]; // fine five fire fish
    const flWords = ["at", "ag", "ow"]; // flat flag flow
    const plain = "fine five fire fish flat flag flow";
    const paper = (fi: number, fl: number) =>
      learnLigatures([[...fiWords.slice(0, fi), ...flWords.slice(0, fl)].map((tail) => `${A}${tail}`).join(" "), plain]);

    expect(paper(2, 1).get(A)).toBe("fi");
    expect(paper(3, 2).has(A)).toBe(false);
    expect(paper(4, 2).get(A)).toBe("fi");
    // The runner-up wins just the same when it is the second candidate.
    expect(paper(1, 2).get(A)).toBe("fl");
    expect(paper(2, 3).has(A)).toBe(false);
  });

  it("matches case-insensitively", () => {
    const A = "\uE105";
    const learned = learnLigatures([`${A}rst ${A}GURE ${A}rm`, "First FIGURE; Firm."]);
    expect(learned.get(A)).toBe("fi");
  });

  it("does not take a word that still carries a private-use code for a word the paper prints plainly", () => {
    const A = "\uE105";
    const B = "\uE106";
    // "zoffar" and "muffel" are printed, but only as broken as the other code spells them (and they are no words of
    // the list's, which would settle the common ones).
    const learned = learnLigatures([`zo${A}ar mu${A}el`, `zo${B}ar mu${B}el`]);
    expect(learned.size).toBe(0);
  });

  it("lets a word with two different codes confirm nothing", () => {
    const A = "\uE105";
    const B = "\uE106";
    // "figure" confirms A once; "first" is printed too, but the word that would stand for it still carries B.
    const learned = learnLigatures([`${A}gure ${A}rst${B}`, "figure first"]);
    expect(learned.has(A)).toBe(false);
    expect(learned.has(B)).toBe(false);
    // The same code twice in one word is one code.
    const twice = learnLigatures([`${A}x${A}gure ${A}rst ${A}gure`, "fixfigure first figure"]);
    expect(twice.get(A)).toBe("fi");
  });

  it("never learns a code that stands alone, even when the paper prints a word the candidate spells", () => {
    const BULLET = "\uF0B7";
    // "fi" and "fifi" are printed; the bullets are the words "\uF0B7" and "\uF0B7\uF0B7", with no letter in them.
    const learned = learnLigatures([`${BULLET} one ${BULLET} two ${BULLET}${BULLET} three`, "Wi-Fi: fi, fifi."]);
    expect(learned.size).toBe(0);
  });

  it("reads a word through the punctuation, digits and hyphens around it", () => {
    const A = "\uE105";
    const learned = learnLigatures([`(${A}ne) 3${A}ve; well-${A}ne, "${A}ve".`, "fine five"]);
    expect(learned.get(A)).toBe("fi");
  });

  it("pools the evidence of every text: the body's code is confirmed by the heading and the caption", () => {
    const A = "\uE105";
    expect(learnLigatures([`${A}ne ${A}ve`, "Fine", "five"]).get(A)).toBe("fi");
    // Any iterable, read once.
    function* texts() {
      yield `${A}ne ${A}ve`;
      yield "fine five";
    }
    expect(learnLigatures(texts()).get(A)).toBe("fi");
    expect(learnLigatures(new Set([`${A}ne ${A}ve`, "fine five"])).get(A)).toBe("fi");
  });

  it("learns each code on its own evidence: one code can be fi where another is fl", () => {
    const A = "\uE105";
    const B = "\uE106";
    const learned = learnLigatures([`${A}ne ${A}ve ${B}at ${B}ag`, "fine five flat flag"]);
    expect(learned.get(A)).toBe("fi");
    expect(learned.get(B)).toBe("fl");
  });

  it("takes the private-use area as U+E000–U+F8FF, edges included, and nothing around it", () => {
    const FIRST = "\uE000";
    const LAST = "\uF8FF";
    const learned = learnLigatures([`${FIRST}ne ${FIRST}ve ${LAST}at ${LAST}ag`, "fine five flat flag"]);
    expect(learned.get(FIRST)).toBe("fi");
    expect(learned.get(LAST)).toBe("fl");
    // U+F900 is a CJK compatibility ideograph: a letter, outside the area. It is a plain word, never a code.
    const outside = learnLigatures(["\uF900ne \uF900ve \uF900at", "fine five flat"]);
    expect(outside.size).toBe(0);
  });

  it("returns a new map on every call, the same answer for the same paper", () => {
    const one = learnLigatures(PAPER);
    const two = learnLigatures(PAPER);
    expect(one).not.toBe(two);
    expect([...one]).toEqual([...two]);
  });
});

// ── §1h.444: the other f-ligatures, and a short list of common words as a second witness ────────────────────

describe("learnLigatures — the other f-ligatures a font may set (P12-67, §1h.444)", () => {
  it("has ft, fb, fh, fj, fk, fft, ffb and ffh as candidates, after the five it always had", () => {
    expect([...LIGATURE_CANDIDATES]).toEqual(["fi", "fl", "ff", "ffi", "ffl", "ft", "fb", "fh", "fj", "fk", "fft", "ffb", "ffh"]);
  });

  it.each(["fi", "fl", "ff", "ffi", "ffl", "ft", "fb", "fh", "fj", "fk", "fft", "ffb", "ffh"])("learns %s from the paper's own words", (ligature) => {
    const A = "\uE105";
    // words no list knows, so that only the paper's own can settle it
    const words = [`zo${ligature}ar`, `mu${ligature}el`];
    for (const word of words) expect(LIGATURE_WORDS).not.toContain(word);
    const learned = learnLigatures([words.map((word) => word.replace(ligature, A)).join(" "), words.join(" ")]);
    expect(learned.get(A)).toBe(ligature);
  });

  it("settles ft on the paper's own words: real words the list does not know", () => {
    const A = "\uE09D";
    const broken = `The lo${A}y tower, the he${A}y stone and the cra${A}y fox.`;
    // lofty, hefty, crafty: no word of the list, so with nothing printed plainly the code stays
    expect(learnLigatures([broken]).has(A)).toBe(false);
    expect(learnLigatures([broken, "A lofty tower; a hefty stone; a crafty fox."]).get(A)).toBe("ft");
  });
});

describe("learnLigatures — the second witness: a short list of common words (P12-67, §1h.444)", () => {
  const A = "\uE104";
  const B = "\uE09D";

  it("is a few hundred lower-case words, a word once, each holding a letter pair of a candidate", () => {
    expect(LIGATURE_WORDS.length).toBeGreaterThanOrEqual(200);
    expect(LIGATURE_WORDS.length).toBeLessThanOrEqual(800);
    expect(new Set(LIGATURE_WORDS).size).toBe(LIGATURE_WORDS.length);
    for (const word of LIGATURE_WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
      expect(LIGATURE_CANDIDATES.some((candidate) => word.includes(candidate))).toBe(true);
    }
    for (const word of [
      "influence", "fluctuation", "conflict", "reflect", "flow", "flux", "fluorescence", "flat", "flexible", "field", "figure",
      "first", "final", "specific", "significant", "efficient", "effect", "different", "after", "software", "shift", "left",
      "soft", "lift", "craft", "draft",
    ]) {
      expect(LIGATURE_WORDS).toContain(word);
    }
    // the five every font has have a good many words; each of the others, but fk, at least one
    for (const candidate of ["fi", "fl", "ff", "ffi", "ffl", "ft"]) {
      expect(LIGATURE_WORDS.filter((word) => word.includes(candidate)).length).toBeGreaterThanOrEqual(15);
    }
    for (const candidate of LIGATURE_CANDIDATES.filter((c) => c !== "fk")) {
      expect(LIGATURE_WORDS.some((word) => word.includes(candidate))).toBe(true);
    }
  });

  it("settles a code whose words appear only in ligature form: fl and ft in one paper, nothing printed plainly", () => {
    const learned = learnLigatures([
      `The in${A}uence of the tide, the con${A}icts at the pools, the ${A}uctuations of the level and the re${A}ected light.`,
      `It was recorded a${B}er dusk with the so${B}ware, shi${B}ing the li${B}ed samples.`,
    ]);
    expect(learned.get(A)).toBe("fl");
    expect(learned.get(B)).toBe("ft");
    expect(learned.size).toBe(2);
  });

  it("reads the usual endings of a word of the list, and only those", () => {
    // conflicts, reflected, influencing (the e back), fluctuations, shifting, lifted, firstly, stiffer
    expect(learnLigatures([`con${A}icts re${A}ected`]).get(A)).toBe("fl");
    expect(learnLigatures([`in${A}uencing ${A}uctuations`]).get(A)).toBe("fl");
    expect(learnLigatures([`shi${B}ing li${B}ed`]).get(B)).toBe("ft");
    expect(learnLigatures([`\uE103rstly sti\uE09Der`]).get("\uE103")).toBeUndefined();
    expect(learnLigatures([`\uE103rstly \uE103nally`]).get("\uE103")).toBe("fi");
    // an ending that makes no word of it settles nothing
    expect(learnLigatures([`in${A}uencxx con${A}ictzz`]).has(A)).toBe(false);
  });

  it("leaves a code alone when its words are in neither the paper nor the list", () => {
    expect(learnLigatures([`The ${A}rzum, the ${A}qvex and a ${A}zzop.`, "The first figure and the flow."]).has(A)).toBe(false);
  });

  it("wants two different words of the list, as the paper does", () => {
    expect(learnLigatures([`in${A}uence in${A}uence in${A}uence ${A}ruk`]).has(A)).toBe(false);
    expect(learnLigatures([`in${A}uence con${A}ict ${A}ruk`]).get(A)).toBe("fl");
  });

  it("wants twice the runner-up among the list's words: two to one wins, two to two does not", () => {
    // fl: influence, conflict. fi: finite.
    expect(learnLigatures([`in${A}uence con${A}ict ${A}nite`]).get(A)).toBe("fl");
    // fi: finite, first
    expect(learnLigatures([`in${A}uence con${A}ict ${A}nite ${A}rst`]).has(A)).toBe(false);
  });

  it("never overrides a confident vote of the paper: the paper's fi stands against four words of the list for fl", () => {
    const text = `${A}rst ${A}gure in${A}uence con${A}ict ${A}uctuation re${A}ect`;
    // the paper prints "first" and "figure" plainly: two to nothing for fi, which the list's four fl words do not overrule
    expect(learnLigatures([text, "The first figure."]).get(A)).toBe("fi");
    // without the paper's words, the list decides: four fl words, two fi
    expect(learnLigatures([text]).get(A)).toBe("fl");
  });

  it("gives way to the list only when the paper's vote is not confident: one plain word is not a vote", () => {
    const text = `${A}gure in${A}uence con${A}ict ${A}uctuation`;
    // the paper prints "figure": one word for fi, not confident; the list adds influence, conflict and fluctuation for fl
    expect(learnLigatures([text, "The figure."]).get(A)).toBe("fl");
  });

  it("counts the paper's plain words with the list's: a word only the paper knows helps the list's", () => {
    // "lofty" is only the paper's, "after" only the list's: two words for ft
    expect(learnLigatures([`lo${B}y a${B}er`, "A lofty tower."]).get(B)).toBe("ft");
    expect(learnLigatures([`lo${B}y a${B}er`]).has(B)).toBe(false);
  });
});

// ── Rule 2: applied everywhere ───────────────────────────────────────────────────────────────────────────────

/** The paper's own words, as a finished document: the title, sections, captions, and an equation. */
function invented() {
  return {
    title: `Tidal ${FL}ow at Invented Shorelines`,
    sections: [
      {
        id: "s0",
        heading: `The ${FI}rst Survey`,
        canonical: "methods",
        text: `The ${FI}rst ${FI}gure shows the ${FL}ow. The in${FL}uence of the tide is di${FF}erent here and its e${FF}ect is clear. A ${FI}sh stayed.`,
        page: 1,
      },
      {
        id: "s1",
        heading: "Results",
        canonical: "results",
        text: "Plainly: the first figure, the flow, the influence, the effect, and a different tide.",
        page: 2,
      },
    ],
    figureCaptions: [
      { ordinal: 1, label: "Figure 1", caption: `The ${FI}rst survey and the ${FL}ow it measured.`, page: 2, at: 0.75, width: 400, height: 300 },
    ],
    equations: [{ text: `x = ${FI}y`, number: "(1)" }],
    source: "pdf" as const,
    pageCount: 2,
    reason: null,
  };
}

describe("applyLigatures — rule 2: every occurrence of a learned code is its ligature's letters (P12-67)", () => {
  const learned = new Map([
    [FI, "fi"],
    [FL, "fl"],
    [FF, "ff"],
  ]);

  it("replaces every occurrence, not only the words that confirmed the code", () => {
    expect(applyLigatures(`The ${FI}rst ${FI}gure, a ${FI}sh, in${FL}uence, di${FF}erent, e${FF}ect, ${FI}${FI}x.`, learned)).toBe(
      "The first figure, a fish, influence, different, effect, fifix.",
    );
    // the code three times in one word
    expect(applyLigatures(`${FF}o${FF}o${FF}`, learned)).toBe("ffoffoff");
  });

  it("keeps a code that was not learned where it is, in the word it is in", () => {
    const OTHER = "\uE105";
    expect(applyLigatures(`${OTHER}gure ${FI}gure ${FI}${OTHER}x`, learned)).toBe(`${OTHER}gure figure fi${OTHER}x`);
  });

  it("changes no character outside the private-use area", () => {
    const NBSP = String.fromCharCode(0xa0);
    const plain = `Café naïve über – — − ± µm${NBSP}“quoted” 中文 😀 ﬁ ﬂ 100% (a+b) \t\n\n done`;
    expect(applyLigatures(plain, learned)).toBe(plain);
    const mixed = `${plain} ${FI}gure ${plain}`;
    expect(applyLigatures(mixed, learned)).toBe(`${plain} figure ${plain}`);
    // U+F900 is a CJK compatibility ideograph, just outside the area
    expect(applyLigatures("\uF900gure", learned)).toBe("\uF900gure");
  });

  it("leaves a code that stands alone, not inside a word, as it is", () => {
    for (const text of [
      `${FI}`,
      ` ${FI} `,
      `(${FI})`,
      `1 ${FI} 2`,
      `3${FI}`,
      `${FI}${FI}`,
      `${FI}.`,
      `- ${FI}\n${FL}\t${FF}`,
      "\uF0B7 a bullet",
    ]) {
      expect(applyLigatures(text, learned)).toBe(text);
    }
    expect(applyLigatures(`${FI} ${FI}gure ${FI}`, learned)).toBe(`${FI} figure ${FI}`);
  });

  it("returns the very same string when there is nothing to do", () => {
    const text = "No private-use character here, only the first figure.";
    expect(applyLigatures(text, learned)).toBe(text);
    expect(applyLigatures(`${FI}gure`, new Map())).toBe(`${FI}gure`);
    expect(applyLigatures("", learned)).toBe("");
  });
});

describe("restoreLigatures — rule 2: the title, the headings, the bodies and the captions (P12-67)", () => {
  it("restores the code in the title, every heading, every text and every caption, learned from all of them", () => {
    const doc = invented();
    const out = restoreLigatures(doc);
    expect(out.title).toBe("Tidal flow at Invented Shorelines");
    expect(out.sections[0]?.heading).toBe("The first Survey");
    expect(out.sections[0]?.text).toBe(
      "The first figure shows the flow. The influence of the tide is different here and its effect is clear. A fish stayed.",
    );
    expect(out.figureCaptions[0]?.caption).toBe("The first survey and the flow it measured.");
    // not a private-use character is left anywhere in what the reader reads
    expect(JSON.stringify({ title: out.title, sections: out.sections, figureCaptions: out.figureCaptions })).not.toMatch(
      /[\uE000-\uF8FF]/,
    );
  });

  it("learns from words spread over different places: a heading's and a body's codes are confirmed by a caption", () => {
    const out = restoreLigatures({
      title: `The ${FL}ow`,
      sections: [
        { heading: `${FI}gure notes`, text: "Plain words." },
        { heading: "Plain", text: `The ${FI}rst, and the ${FL}ow beside it.` },
      ],
      figureCaptions: [{ label: "Figure 1", caption: "A plain figure, a plain first and a plain flow." }],
    });
    // fi: figure (a heading) and first (a body), each printed plainly in a caption.
    expect(out.sections[0]?.heading).toBe("figure notes");
    expect(out.sections[1]?.text).toBe(`The first, and the ${FL}ow beside it.`);
    // fl: "flow" is the one word that carries the code (title and body), so the code is left as it is.
    expect(out.title).toBe(`The ${FL}ow`);
  });

  it("carries everything else over as it was: ids, buckets, pages, sizes, the equations, the source", () => {
    const doc = invented();
    const out = restoreLigatures(doc);
    expect(out.sections.map((s) => [s.id, s.canonical, s.page])).toEqual([
      ["s0", "methods", 1],
      ["s1", "results", 2],
    ]);
    expect(out.figureCaptions[0]).toMatchObject({ ordinal: 1, label: "Figure 1", page: 2, at: 0.75, width: 400, height: 300 });
    expect(out.equations).toEqual([{ text: `x = ${FI}y`, number: "(1)" }]);
    expect(out.source).toBe("pdf");
    expect(out.pageCount).toBe(2);
    expect(out.reason).toBeNull();
    expect(Object.keys(out)).toEqual(Object.keys(doc));
  });

  it("does not change the document it is given", () => {
    const doc = invented();
    const before = JSON.stringify(doc);
    const out = restoreLigatures(doc);
    expect(out).not.toBe(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("measure: three codes, six words each printed both ways — every occurrence reads correctly after", () => {
    const doc = invented();
    const count = (d: { title?: string | null; sections: { heading: string; text: string }[]; figureCaptions: { caption: string }[] }) =>
      (
        [d.title ?? "", ...d.sections.flatMap((s) => [s.heading, s.text]), ...d.figureCaptions.map((c) => c.caption)].join("\n").match(
          /[\uE000-\uF8FF]/g,
        ) ?? []
      ).length;
    // before: the codes stay
    expect(count(doc)).toBe(11);
    // after: each code is its letters
    const out = restoreLigatures(doc);
    expect(count(out)).toBe(0);
    const words = [out.title, ...out.sections.map((s) => s.text), ...out.figureCaptions.map((c) => c.caption)].join(" ").toLowerCase();
    for (const word of ["figure", "first", "influence", "flow", "different", "effect"]) expect(words).toContain(word);
    for (const wrong of ["fiigure", "flirst", "fiflow", "ffirst", "diflerent", "eflect", "difierent"]) expect(words).not.toContain(wrong);
  });

  it("a code with one confirming word, or a tie, stays unchanged while the others are restored", () => {
    const ONE = "\uE105"; // "firuk" is no word: one confirming word
    const TIE = "\uE106"; // fi: fine, five. fl: flat, flag
    const out = restoreLigatures({
      sections: [
        {
          heading: "A",
          text: `The ${FI}rst ${FI}gure. The ${ONE}gure and the ${ONE}ruk. ${TIE}ne ${TIE}ve ${TIE}at ${TIE}ag.`,
        },
        { heading: "B", text: "first figure; figure; fine five flat flag" },
      ],
    });
    expect(out.sections[0]?.text).toBe(`The first figure. The ${ONE}gure and the ${ONE}ruk. ${TIE}ne ${TIE}ve ${TIE}at ${TIE}ag.`);
  });

  it("a paper with no private-use code comes back as the same object, byte for byte", () => {
    const doc = {
      title: "A Plain Paper",
      sections: [{ id: "s0", heading: "1 Introduction", canonical: "introduction", text: "The first figure shows the flow – ± 5%." }],
      figureCaptions: [{ ordinal: 1, label: "Figure 1", caption: "The influence of the effect." }],
      source: "pdf" as const,
    };
    const before = JSON.stringify(doc);
    const out = restoreLigatures(doc);
    expect(out).toBe(doc);
    expect(JSON.stringify(out)).toBe(before);
  });

  it("a paper whose codes have no evidence comes back as the same object, the codes where they were", () => {
    const doc = {
      title: `The ${FL}ow`,
      sections: [{ heading: "Plain", text: `Only the ${FI}rst, once.` }],
      figureCaptions: [],
    };
    expect(restoreLigatures(doc)).toBe(doc);
  });

  it("tolerates a document with no title, no sections or no captions", () => {
    expect(restoreLigatures({})).toEqual({});
    expect(restoreLigatures({ title: null, sections: [], figureCaptions: [] })).toEqual({ title: null, sections: [], figureCaptions: [] });
    const out = restoreLigatures({ sections: [{ text: `${FI}rst ${FI}gure`, heading: undefined }, { heading: "first figure" }] });
    expect(out.sections?.[0]?.text).toBe("first figure");
  });
});

// ── Through the extractor: a PDF whose font names its ligature glyphs by code, read by pdf.js ─────────────────

/**
 * A real, minimal PDF like `minimalPdf`'s, but the font is the way the symptom's papers have it: the ligatures are
 * glyphs named only by their code ("uniE103"), so pdf.js reads each as a private-use character. Each distinct
 * private-use character in the text becomes the font's own byte 1, 2, 3, … The two Unicode ligatures U+FB01 and
 * U+FB02 are coded the same way under their standard glyph names ("fi", "fl"), as the font of a paper that maps
 * some of its ligatures has them.
 */
function ligaturePdf(pages: Run[][]): Buffer {
  const isCoded = (ch: string) => (ch >= "\uE000" && ch <= "\uF8FF") || ch === "\uFB01" || ch === "\uFB02";
  const glyphName = (ch: string) =>
    ch === "\uFB01" ? "/fi" : ch === "\uFB02" ? "/fl" : `/uni${ch.charCodeAt(0).toString(16).toUpperCase()}`;
  const codes = new Map<string, number>();
  for (const runs of pages) {
    for (const [text] of runs) {
      for (const ch of text) if (isCoded(ch) && !codes.has(ch)) codes.set(ch, codes.size + 1);
    }
  }
  const names = [...codes.keys()].map(glyphName).join(" ");
  const encoding = names
    ? `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [1 ${names}] >>`
    : "/WinAnsiEncoding";
  // The ligature glyphs have widths of their own, as in a real font; without them pdf.js sets a space around each.
  const widths = names
    ? ` /FirstChar 1 /LastChar 255 /Widths [${Array.from({ length: 255 }, (_, i) => (i + 1 === 32 ? 278 : 556)).join(" ")}]`
    : "";
  const font = (base: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding ${encoding}${widths} >>`;
  const escape = (text: string) =>
    [...text]
      .map((ch) => {
        const code = codes.get(ch);
        if (code !== undefined) return `\\${code.toString(8).padStart(3, "0")}`;
        return ch === "\\" || ch === "(" || ch === ")" ? `\\${ch}` : ch;
      })
      .join("");
  const objects: string[] = [font("Helvetica"), font("Helvetica-Bold"), ""];
  const pagesId = 3;
  const kids: number[] = [];
  for (const runs of pages) {
    const stream = runs
      .map(([text, x, top, size, bold]) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${842 - top} Td (${escape(text)}) Tj ET`)
      .join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const contents = objects.length;
    objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contents} 0 R >>`,
    );
    kids.push(objects.length);
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const catalog = objects.length;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractPdfTextFromBytes — a font that sets its ligatures as private-use glyphs reads as letters (P12-67)", () => {
  const PAGES: Run[][] = [
    [
      [`Tidal ${FL}ow at Invented Shorelines`, 72, 80, 18],
      ["Abstract", 72, 130, 14],
      ...prose(
        [
          `We study how the ${FL}ow of water shapes an invented shoreline across ten visits.`,
          `The ${FI}rst survey was di${FF}erent from the later ones in a way the notes explain.`,
        ],
        150,
      ),
      ["1 Introduction", 72, 210, 11],
      ...prose(
        [
          `Every ${FI}gure in this paper shows the in${FL}uence of the tide on the beach.`,
          `A tide has an e${FF}ect on the sand, and the e${FF}ect is easy to see at low water.`,
        ],
        230,
      ),
    ],
    [
      ["2 Methods", 72, 80, 11],
      ...prose(
        [
          "The first survey counted the stones; the figure of ten sites was kept for later.",
          "We took the flow to be steady, and the influence of the wind to be small.",
        ],
        100,
      ),
      ["3 Results", 72, 160, 11],
      ...prose(["The effect was different at the pools, where the tide came in more slowly."], 180),
      [`Figure 1: The ${FI}rst survey and the ${FL}ow it measured.`, 72, 250, 9],
    ],
  ];

  it("reads the PDF as private-use characters in pdf.js, and as letters in the document", async () => {
    const bytes = ligaturePdf(PAGES);
    // the precondition: pdf.js hands over private-use characters here, as it does for the owner's papers
    const raw = (await readPages(bytes)).flatMap((page) => page.items.map((item) => item.str)).join("");
    expect(raw.match(/[\uE000-\uF8FF]/g)?.length).toBe(10);
    expect(new Set(raw.match(/[\uE000-\uF8FF]/g))).toEqual(new Set([FI, FL, FF]));

    const result = await extractPdfTextFromBytes(bytes);

    expect(result.ok).toBe(true);
    const doc = result.doc!;
    const everything = [
      doc.title ?? "",
      ...doc.sections.flatMap((section) => [section.heading, section.text]),
      ...doc.figureCaptions.flatMap((caption) => [caption.label, caption.caption]),
    ].join("\n");
    expect(everything).not.toMatch(/[\uE000-\uF8FF]/);
    expect(doc.title).toBe("Tidal flow at Invented Shorelines");
    const text = doc.sections.map((section) => section.text).join("\n");
    expect(text).toContain("We study how the flow of water shapes an invented shoreline across ten visits.");
    expect(text).toContain("The first survey was different from the later ones in a way the notes explain.");
    expect(text).toContain("Every figure in this paper shows the influence of the tide on the beach.");
    expect(text).toContain("A tide has an effect on the sand, and the effect is easy to see at low water.");
    expect(doc.figureCaptions.map((caption) => caption.caption)).toEqual(["The first survey and the flow it measured."]);
  });

  it("reads a PDF with no private-use glyph exactly as before", async () => {
    const spelled = PAGES.map((page) =>
      page.map(([text, ...rest]): Run => [text.split(FI).join("fi").split(FL).join("fl").split(FF).join("ff"), ...rest]),
    );
    const result = await extractPdfTextFromBytes(ligaturePdf(spelled));
    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe("Tidal flow at Invented Shorelines");
    const text = result.doc?.sections.map((section) => section.text).join("\n") ?? "";
    expect(text).toContain("The first survey was different from the later ones in a way the notes explain.");
    expect(text).toContain("A tide has an effect on the sand, and the effect is easy to see at low water.");
  });
});

// ── §1h.443: the codes are repaired on the page text, before the outline reads it ─────────────────────────────

describe("extractPdfTextFromBytes — the ligatures are repaired before the outline and page 1's text are made (P12-67, §1h.443)", () => {
  const DOI = "https://doi.org/10.1234/peer.ligature.0001";
  const UFL = String.fromCharCode(0xfb02); // a real Unicode ligature, fl
  const PLAIN_METHODS: Run[] = prose(
    [
      "The first survey counted the stones; the figure of ten sites was kept for later.",
      "We took the flow to be steady, and the influence of the wind to be small.",
      "The effect was different at the pools, where the tide came in more slowly.",
    ],
    100,
  );
  /**
   * A paper that closes its argument with an acknowledgements part and then prints a conflict-of-interest part
   * whose heading has the fl ligature in it. Every end-matter heading opens its own section (P12-62) and is read
   * by what it names, so the second one is a part only if its heading reads as what it is.
   */
  const pages = (methods: Run[], first = "Tidal"): Run[][] => [
    [
      [`${first} ${FL}ow at Invented Shorelines`, 72, 80, 18],
      [DOI, 72, 110, 9],
      ["Abstract", 72, 140, 14],
      ...prose(
        [
          `We study how the ${FL}ow of water shapes an invented shoreline across ten visits.`,
          `The ${FI}rst survey was di${FF}erent from the later ones in a way the notes explain.`,
        ],
        160,
      ),
      ["1 Introduction", 72, 210, 11],
      ...prose(
        [
          `Every ${FI}gure in this paper shows the in${FL}uence of the tide on the beach.`,
          `A tide has an e${FF}ect on the sand, and the e${FF}ect is easy to see at low water.`,
        ],
        230,
      ),
    ],
    [
      ["2 Methods", 72, 80, 11],
      ...methods,
      ["3 Results", 72, 200, 11],
      ...prose(["The pools filled more slowly than the marsh did at every visit."], 220),
      ["Acknowledgements", 72, 270, 14, true],
      ...prose(["We thank the invented harbour office for the loan of its boats."], 290),
      [`Con${FL}ict of Interest`, 72, 340, 14, true],
      ...prose(["The authors declare that they have no competing interests in this work."], 360),
    ],
  ];
  const puaIn = (text: string) => (text.match(/[\uE000-\uF8FF]/g) ?? []).length;
  const statement = (doc: { sections: { heading: string; canonical: string; text: string }[] } | undefined) =>
    doc?.sections.find((section) => /interest/i.test(section.heading));

  it("buckets a back-matter heading on its repaired words, and page 1's text holds no private-use character", async () => {
    const result = await extractPdfTextFromBytes(ligaturePdf(pages(PLAIN_METHODS)));

    expect(result.ok).toBe(true);
    expect(result.doc?.sections.map((section) => [section.heading, section.canonical])).toEqual([
      ["Abstract", "abstract"],
      ["1 Introduction", "introduction"],
      ["2 Methods", "methods"],
      ["3 Results", "results"],
      // "Acknowledgements" is the first end-matter heading: it opens its own section, as the later ones do (P12-62)
      ["Acknowledgements", "acknowledgments"],
      ["Conflict of Interest", "acknowledgments"],
    ]);
    expect(statement(result.doc)?.text).toBe("The authors declare that they have no competing interests in this work.");
    // the title and the DOI search read page 1 repaired
    expect(puaIn(result.page1Text ?? "")).toBe(0);
    expect(result.page1Text).toContain("Tidal flow at Invented Shorelines");
    expect(result.page1Text).toContain("10.1234/peer.ligature.0001");
    expect(result.page1Text).toContain("The first survey was different from the later ones");
    expect(result.doc?.title).toBe("Tidal flow at Invented Shorelines");
    expect(puaIn(JSON.stringify(result.doc))).toBe(0);
  });

  it("learns from a word the paper sets with a mapped ligature glyph, which pdf.js reads as its letters", async () => {
    // The only plain evidence for the fl code is "flow" and "influence", set with the real fl glyph (U+FB02).
    const bytes = ligaturePdf(
      pages(
        prose(
          [
            `We took the ${UFL}ow to be steady, and the in${UFL}uence of the wind to be small.`,
            "The first survey counted the stones; the figure of ten sites was kept for later.",
            "The effect was different at the pools, where the tide came in more slowly.",
          ],
          100,
        ),
      ),
    );
    const raw = (await readPages(bytes)).flatMap((page) => page.items.map((item) => item.str)).join("");
    expect(raw).toContain("We took the flow to be steady");
    expect(raw).not.toContain(UFL);

    const result = await extractPdfTextFromBytes(bytes);

    expect(result.ok).toBe(true);
    expect(statement(result.doc)?.canonical).toBe("acknowledgments");
    expect(puaIn(result.page1Text ?? "")).toBe(0);
  });

  it("still repairs a glyph that pdf.js hands over as an item of its own, once the outline has joined the line", async () => {
    // The ligature glyphs are set in a face of their own, so each is an item by itself ("Every ", "<fi>", "gure in…"):
    // alone in its item it is not inside a word and the page-level pass cannot read it. The outline joins the line,
    // and the document-level pass learns from the joined words and restores them.
    const line = (text: string, top: number): Run[] => {
      const runs: Run[] = [];
      let x = 72;
      for (const piece of text.split(/([\uE000-\uF8FF])/).filter(Boolean)) {
        runs.push([piece, x, top, 11, /[\uE000-\uF8FF]/.test(piece)]);
        // the synthetic font's advances: 0.556 em a character, 0.278 em a space
        x += ([...piece].reduce((sum, ch) => sum + (ch === " " ? 278 : 556), 0) * 11) / 1000;
      }
      return runs;
    };
    const bytes = ligaturePdf([
      [
        ["Tidal Flow at Invented Shorelines", 72, 80, 18],
        ["Abstract", 72, 140, 14],
        ...line(`We study how the ${FL}ow of water shapes an invented shoreline across ten visits.`, 160),
        ...line(`The ${FI}rst survey was di${FF}erent from the later ones in a way the notes explain.`, 174),
        ["1 Introduction", 72, 210, 11],
        ...line(`Every ${FI}gure in this paper shows the in${FL}uence of the tide on the beach.`, 230),
        ...line(`A tide has an e${FF}ect on the sand, and the e${FF}ect is easy to see at low water.`, 244),
      ],
      [["2 Methods", 72, 80, 11], ...PLAIN_METHODS],
    ]);
    const items = (await readPages(bytes)).flatMap((page) => page.items.map((item) => item.str));
    expect(items).toContain(FI);
    expect(items).toContain(FL);

    const result = await extractPdfTextFromBytes(bytes);

    expect(result.ok).toBe(true);
    const text = result.doc?.sections.map((section) => section.text).join("\n") ?? "";
    expect(text).toContain("We study how the flow of water shapes an invented shoreline across ten visits.");
    expect(text).toContain("The first survey was different from the later ones in a way the notes explain.");
    expect(text).toContain("Every figure in this paper shows the influence of the tide on the beach.");
    expect(text).toContain("A tide has an effect on the sand, and the effect is easy to see at low water.");
    expect(puaIn(JSON.stringify(result.doc))).toBe(0);
  });

  it("reads a paper whose ligated words are never printed plainly: the list settles fl and ft (§1h.444)", async () => {
    // The font ligates every fl and ft word of the paper, so its own words cannot say what the codes are. The fl code
    // is U+E104 and the ft code U+E09D; the words are influence, conflicts, fluctuations, reflected, after, software,
    // shifting, lifted: all common, none printed plainly.
    const bytes = ligaturePdf([
      [
        ["Notes on Tides at Invented Shorelines", 72, 80, 18],
        ["Abstract", 72, 140, 14],
        ...prose([`The in${FL}uence of the tide on the beach was measured.`], 160),
        ["1 Introduction", 72, 210, 11],
        ...prose(
          [
            `The con${FL}icts at the pools led to ${FL}uctuations.`,
            `The re${FL}ected light was recorded a${FF}er dusk.`,
            `The so${FF}ware, shi${FF}ing the li${FF}ed samples, ran.`,
          ],
          230,
        ),
      ],
      [["2 Methods", 72, 80, 11], ...prose(["We counted the stones at ten sites on every visit to the shore."], 100)],
    ]);
    const raw = (await readPages(bytes)).flatMap((page) => page.items.map((item) => item.str)).join("");
    expect(puaIn(raw)).toBe(8);

    const result = await extractPdfTextFromBytes(bytes);

    expect(result.ok).toBe(true);
    const text = result.doc?.sections.map((section) => section.text).join("\n") ?? "";
    expect(text).toContain("The influence of the tide on the beach was measured.");
    expect(text).toContain("The conflicts at the pools led to fluctuations.");
    expect(text).toContain("The reflected light was recorded after dusk.");
    expect(text).toContain("The software, shifting the lifted samples, ran.");
    expect(puaIn(JSON.stringify(result.doc))).toBe(0);
    expect(puaIn(result.page1Text ?? "")).toBe(0);
    expect(result.page1Text).toContain("The influence of the tide on the beach was measured.");
  });

  it("leaves a code that has one confirming word where it is: its heading is not a part, page 1 keeps the code", async () => {
    // "flow" is the only word with the fl code that the paper (or the list) vouches for, and "conflict", in the heading,
    // is the only one with its own code: one confirming word each.
    const FX = "\uE105";
    const only: Run[] = prose(["The first survey counted the stones; the figure of ten sites was kept for later."], 100);
    const bytes = ligaturePdf([
      [
        [`Tidal ${FL}ow at Invented Shorelines`, 72, 80, 18],
        ["Abstract", 72, 140, 14],
        ...prose([`We study how the flow of water shapes an invented shoreline across ten visits.`], 160),
        ["1 Introduction", 72, 210, 11],
        ...prose([`Every ${FL}ict was settled without a word, and the ${FL}ow carried on regardless.`], 230),
      ],
      ...pages(only)
        .slice(1)
        .map((runs) => runs.map(([text, ...rest]): Run => [text.split(FL).join(FX), ...rest])),
    ]);
    const result = await extractPdfTextFromBytes(bytes);

    expect(result.ok).toBe(true);
    expect(statement(result.doc)).toBeUndefined();
    expect(puaIn(result.page1Text ?? "")).toBeGreaterThan(0);
    expect(result.page1Text).toContain(`Tidal ${FL}ow at Invented Shorelines`);
  });
});

// ── Rule 3: pure, deterministic, no dependency, linear ───────────────────────────────────────────────────────

/** Deep-freezes a value, so that a function that writes to its input throws (modules are strict). */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freeze(inner);
  }
  return value;
}

describe("ligatures — rule 3: pure, deterministic, no dependency (P12-67)", () => {
  const source = readFileSync(fileURLToPath(new URL("./ligatures.ts", import.meta.url)), "utf8");
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");

  it("imports nothing and reaches for nothing outside its arguments", () => {
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/^\s*export\s+.*\bfrom\b/m);
    // no clock, no random, no environment, no network, no disk, no global state to write to
    for (const forbidden of [/\bDate\b/, /Math\.random/, /\bprocess\b/, /\bfetch\b/, /\bconsole\b/, /\bglobalThis\b/, /\bwindow\b/, /Intl\./]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("does not change what it is given: frozen inputs go through", () => {
    const doc = freeze(invented());
    const texts = freeze(PAPER.slice());
    const learned = new Map([[FI, "fi"]]);
    for (const method of ["set", "delete", "clear"]) {
      Object.defineProperty(learned, method, {
        value: () => {
          throw new Error(`the learned map was written to (${method})`);
        },
      });
    }
    expect(() => learnLigatures(texts)).not.toThrow();
    expect(() => applyLigatures(`${FI}gure`, learned)).not.toThrow();
    expect(() => restoreLigatures(doc)).not.toThrow();
    expect([...learned]).toEqual([[FI, "fi"]]);
    expect(doc.sections[0]?.text).toContain(FI);
  });

  it("gives the same answer every time, and whatever the order of the texts", () => {
    const first = [...learnLigatures(PAPER)].sort();
    expect(first).toHaveLength(3);
    for (let round = 0; round < 3; round++) expect([...learnLigatures(PAPER)].sort()).toEqual(first);
    // every order of the three texts
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) expect([...learnLigatures(order.map((i) => PAPER[i] as string))].sort()).toEqual(first);
    // and the document: the same JSON twice, and restoring what is restored changes nothing
    const once = restoreLigatures(invented());
    expect(JSON.stringify(restoreLigatures(invented()))).toBe(JSON.stringify(once));
    expect(restoreLigatures(once)).toBe(once);
  });
});

/** The time `fn` takes, in milliseconds. */
function timed<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

describe("ligatures — rule 3: linear in the size of the text (P12-67)", () => {
  // A quadratic reading of a million characters is 10^12 steps: minutes to hours. A linear one is a fraction of a
  // second, so a budget that a loaded machine does not reach separates them without a flaky margin.
  const BUDGET_MS = 15_000;
  const SIZE = 1_000_000;

  it("reads a million characters of prose with a few thousand broken words", { timeout: 60_000 }, () => {
    const sentence = `The ${FI}rst ${FI}gure and the ${FL}ow, the in${FL}uence; di${FF}erent e${FF}ect. Plain first figure flow influence different effect. `;
    const reps = Math.ceil(SIZE / sentence.length);
    const text = sentence.repeat(reps);
    const run = timed(() => {
      const learned = learnLigatures([text]);
      return { learned, out: applyLigatures(text, learned) };
    });
    expect(run.ms).toBeLessThan(BUDGET_MS);
    expect(run.value.learned.size).toBe(3);
    // six codes a sentence, each now two letters
    expect(run.value.out).toHaveLength(text.length + 6 * reps);
    expect(run.value.out).not.toMatch(/[\uE000-\uF8FF]/);
  });

  it("reads a hundred thousand different broken words, each confirmed by a plain one", { timeout: 60_000 }, () => {
    // letters only: a digit ends a word
    const letters = (n: number) => [...n.toString(26)].map((digit) => String.fromCharCode(97 + parseInt(digit, 26))).join("");
    const broken: string[] = [];
    const plain: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      broken.push(`${FI}${letters(i)}`);
      plain.push(`fi${letters(i)}`);
    }
    const texts = [broken.join(" "), plain.join(" ")];
    const run = timed(() => {
      const learned = learnLigatures(texts);
      return { learned, out: applyLigatures(texts[0] as string, learned) };
    });
    expect(run.ms).toBeLessThan(BUDGET_MS);
    expect(run.value.learned.get(FI)).toBe("fi");
    expect(run.value.out).toBe(plain.join(" "));
  });

  it("asks the list about a hundred thousand different broken words that the paper cannot confirm", { timeout: 60_000 }, () => {
    // §1h.444: no plain word confirms any of them, so every word is tried against the list, with each ending
    const letters = (n: number) => [...n.toString(26)].map((digit) => String.fromCharCode(97 + parseInt(digit, 26))).join("");
    const broken = Array.from({ length: 100_000 }, (_, i) => `${FI}${letters(i)}q`).join(" ");
    const run = timed(() => learnLigatures([broken, "Nothing here is printed plainly."]));
    expect(run.ms).toBeLessThan(BUDGET_MS);
    expect(run.value.size).toBe(0);
  });

  it("reads one word of a million characters, with one code in it, and with every code of the area in it", { timeout: 60_000 }, () => {
    const one = "a".concat(FI.repeat(1)).repeat(SIZE / 2);
    const learnedOne = timed(() => learnLigatures([one, "afi"]));
    expect(learnedOne.ms).toBeLessThan(BUDGET_MS);
    expect(learnedOne.value.size).toBe(0);
    const appliedOne = timed(() => applyLigatures(one, new Map([[FI, "fi"]])));
    expect(appliedOne.ms).toBeLessThan(BUDGET_MS);
    expect(appliedOne.value).toBe("afi".repeat(SIZE / 2));

    // all 6,400 codes of the area, over and over, in a single word
    const every: string[] = [];
    for (let c = 0xe000; c <= 0xf8ff; c++) every.push(`x${String.fromCharCode(c)}`);
    const all = every.join("").repeat(Math.ceil(SIZE / every.join("").length));
    const allLearned = new Map(every.map((pair) => [pair.slice(1), "fl"] as [string, string]));
    const learnedAll = timed(() => learnLigatures([all, "xfl"]));
    expect(learnedAll.ms).toBeLessThan(BUDGET_MS);
    expect(learnedAll.value.size).toBe(0);
    const appliedAll = timed(() => applyLigatures(all, allLearned));
    expect(appliedAll.ms).toBeLessThan(BUDGET_MS);
    expect(appliedAll.value).not.toMatch(/[\uE000-\uF8FF]/);
  });

  it("restores a document of two thousand sections without a pause", { timeout: 60_000 }, () => {
    const sections = Array.from({ length: 2000 }, (_, i) => ({
      heading: `Section ${i}`,
      text: `The ${FI}rst ${FI}gure shows the ${FL}ow and the in${FL}uence, di${FF}erent, e${FF}ect: first figure flow influence different effect, again and again. `.repeat(8),
    }));
    const doc = { title: "T", sections, figureCaptions: [] };
    const run = timed(() => restoreLigatures(doc));
    expect(run.ms).toBeLessThan(BUDGET_MS);
    expect(JSON.stringify(run.value)).not.toMatch(/[\uE000-\uF8FF]/);
  });
});
