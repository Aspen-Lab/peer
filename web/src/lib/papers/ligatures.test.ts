import { describe, expect, it } from "vitest";
import { learnLigatures } from "./ligatures";

// P12-67 (§1h.439): a font that sets fi / fl / ff / ffi / ffl as glyphs with no Unicode mapping comes out of pdf.js as
// a private-use character. Every paper below is invented; the codes are the ones the symptom showed.
const FI = ""; // "gure"
const FL = ""; // "inuence"
const FF = ""; // "dierent"

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
    const A = "";
    const B = "";
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
    const A = "";
    // "figure" is printed plainly; "fish" is not, so the code has one confirming word.
    const learned = learnLigatures([`The ${A}gure and the ${A}sh.`, "The figure is clear."]);
    expect(learned.has(A)).toBe(false);
  });

  it("counts a word once however often it occurs", () => {
    const A = "";
    const learned = learnLigatures([
      `${A}gure ${A}gure ${A}gure ${A}gure ${A}gure ${A}gure`,
      "figure figure figure figure figure figure figure figure",
    ]);
    expect(learned.has(A)).toBe(false);
  });

  it("learns a code from two confirming words and no rival", () => {
    const A = "";
    const learned = learnLigatures([`The ${A}ne ${A}ve.`, "A fine day; a five."]);
    expect(learned.get(A)).toBe("fi");
  });

  it("leaves a code alone on a tie between two candidates", () => {
    const A = "";
    // fi: fine, five. fl: flat, flag. Two words each.
    const learned = learnLigatures([`${A}ne ${A}ve ${A}at ${A}ag`, "fine five flat flag"]);
    expect(learned.has(A)).toBe(false);
  });

  it("wants twice the runner-up: two to one wins, three to two does not, four to two wins", () => {
    const A = "";
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
    const A = "";
    const learned = learnLigatures([`${A}rst ${A}GURE ${A}rm`, "First FIGURE; Firm."]);
    expect(learned.get(A)).toBe("fi");
  });

  it("does not take a word that still carries a private-use code for a word the paper prints plainly", () => {
    const A = "";
    const B = "";
    // "effect" and "different" are printed, but only as broken as the other code spells them.
    const learned = learnLigatures([`e${A}ect di${A}erent`, `e${B}ect di${B}erent`]);
    expect(learned.size).toBe(0);
  });

  it("lets a word with two different codes confirm nothing", () => {
    const A = "";
    const B = "";
    // "figure" confirms A once; "first" is printed too, but the word that would stand for it still carries B.
    const learned = learnLigatures([`${A}gure ${A}rst${B}`, "figure first"]);
    expect(learned.has(A)).toBe(false);
    expect(learned.has(B)).toBe(false);
    // The same code twice in one word is one code.
    const twice = learnLigatures([`${A}x${A}gure ${A}rst ${A}gure`, "fixfigure first figure"]);
    expect(twice.get(A)).toBe("fi");
  });

  it("never learns a code that stands alone, even when the paper prints a word the candidate spells", () => {
    const BULLET = "";
    // "fi" and "fifi" are printed; the bullets are the words "" and "", with no letter in them.
    const learned = learnLigatures([`${BULLET} one ${BULLET} two ${BULLET}${BULLET} three`, "Wi-Fi: fi, fifi."]);
    expect(learned.size).toBe(0);
  });

  it("reads a word through the punctuation, digits and hyphens around it", () => {
    const A = "";
    const learned = learnLigatures([`(${A}ne) 3${A}ve; well-${A}ne, "${A}ve".`, "fine five"]);
    expect(learned.get(A)).toBe("fi");
  });

  it("pools the evidence of every text: the body's code is confirmed by the heading and the caption", () => {
    const A = "";
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
    const A = "";
    const B = "";
    const learned = learnLigatures([`${A}ne ${A}ve ${B}at ${B}ag`, "fine five flat flag"]);
    expect(learned.get(A)).toBe("fi");
    expect(learned.get(B)).toBe("fl");
  });

  it("takes the private-use area as U+E000–U+F8FF, edges included, and nothing around it", () => {
    const FIRST = "";
    const LAST = "";
    const learned = learnLigatures([`${FIRST}ne ${FIRST}ve ${LAST}at ${LAST}ag`, "fine five flat flag"]);
    expect(learned.get(FIRST)).toBe("fi");
    expect(learned.get(LAST)).toBe("fl");
    // U+F900 is a CJK compatibility ideograph: a letter, outside the area. It is a plain word, never a code.
    const outside = learnLigatures(["豈ne 豈ve 豈at", "fine five flat"]);
    expect(outside.size).toBe(0);
  });

  it("returns a new map on every call, the same answer for the same paper", () => {
    const one = learnLigatures(PAPER);
    const two = learnLigatures(PAPER);
    expect(one).not.toBe(two);
    expect([...one]).toEqual([...two]);
  });
});
