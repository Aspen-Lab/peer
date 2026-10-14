import { describe, expect, it } from "vitest";
import { joinProse, linesOfPage, type PdfLine, type PdfTextItem } from "./pdf-outline";

// P10-37 (BACKLOG-28, P10-33's unsettled): the citation rule's misses on the owner's paper, and "et al." at a page's
// foot. Every line is invented; no sentence of any paper.

function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

/** Runs set one after another on a line, with no gap between them. */
function chain(parts: [string, Partial<PdfTextItem>?][]): PdfTextItem[] {
  let x = 100;
  return parts.map(([str, own]) => {
    const run = item(str, { x, ...own });
    x += run.width;
    return run;
  });
}
const sup: Partial<PdfTextItem> = { height: 6.7, y: 504.4 };
const sub: Partial<PdfTextItem> = { height: 6.7, y: 498 };
const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: chain(parts) }).map((l) => l.text);

describe("an exponent after a closing bracket that holds a slash or a maths symbol is kept (P10-37, BACKLOG-28)", () => {
  it("keeps the exponent after a ratio and after a sum, a difference, a product", () => {
    expect(read([["the plot of (j/jmax)"], ["2", sup], [" against time"]])).toEqual(["the plot of (j/jmax)² against time"]);
    expect(read([["the term (x+y)"], ["2", sup], [" grows"]])).toEqual(["the term (x+y)² grows"]);
    expect(read([["the term (E−Ef)"], ["2", sup], [" grows"]])).toEqual(["the term (E−Ef)² grows"]);
    expect(read([["the term (a×b)"], ["3", sup], [" grows"]])).toEqual(["the term (a×b)³ grows"]);
    expect(read([["the term (ΔT)"], ["2", sup], [" grows"]])).toEqual(["the term (ΔT)² grows"]);
  });

  it("still drops a citation after a bracket with no slash and no maths symbol, and any two-digit mark", () => {
    expect(read([["a layer of the cathode (ABC)"], ["2", sup], [" was tested"]])).toEqual(["a layer of the cathode (ABC) was tested"]);
    expect(read([["a layer of the cathode (Ni-rich)"], ["3", sup], [" was tested"]])).toEqual(["a layer of the cathode (Ni-rich) was tested"]);
    expect(read([["a layer of the cathode (see below)"], ["2", sup], [" was tested"]])).toEqual(["a layer of the cathode (see below) was tested"]);
    expect(read([["the term (x+y)"], ["12", sup], [" grows"]])).toEqual(["the term (x+y) grows"]);
  });
});

describe("a citation after a suspended hyphen of any kind is dropped (P10-37, BACKLOG-28)", () => {
  it.each([["-"], ["‐"], ["‑"], ["−"]])("after a word and %j", (hyphen) => {
    expect(read([[`a study of grain morphology${hyphen}`], ["5", sup], [" and film growth"]])).toEqual([`a study of grain morphology${hyphen} and film growth`]);
    expect(read([[`cracks that run intra${hyphen}`], ["5,6", sup], [" and intergranular"]])).toEqual([`cracks that run intra${hyphen} and intergranular`]);
  });

  it("keeps an exponent after a unit or a variable, and a negative one", () => {
    expect(read([["a diffusivity in cm"], ["2", sup], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(read([["a rate in s"], ["−1", sup], [" at room temperature"]])).toEqual(["a rate in s⁻¹ at room temperature"]);
  });
});

describe("a citation after a two-letter element symbol or a formula ending in a subscript digit is dropped (P10-37, BACKLOG-28)", () => {
  it("drops it after Li, Na, Mn", () => {
    expect(read([["the cells use Li"], ["4", sup], [" as the carrier"]])).toEqual(["the cells use Li as the carrier"]);
    expect(read([["the cells use Na"], ["7,8", sup], [" as the carrier"]])).toEqual(["the cells use Na as the carrier"]);
    expect(read([["the cells use Mn"], ["19", sup], [" as the carrier"]])).toEqual(["the cells use Mn as the carrier"]);
  });

  it("drops it after a formula that ends in a subscript digit, and after one that ends in a bracket and a subscript", () => {
    expect(read([["the host TiO"], ["2", sub], ["31", sup], [" is stable"]])).toEqual(["the host TiO₂ is stable"]);
    expect(read([["the host Ni(OH)"], ["2", sub], ["31", sup], [" is stable"]])).toEqual(["the host Ni(OH)₂ is stable"]);
    expect(read([["the host Li"], ["2", sub], ["CO"], ["3", sub], ["9", sup], [" is stable"]])).toEqual(["the host Li₂CO₃ is stable"]);
  });

  it("keeps an exponent behind a unit that is a capital and a lower-case letter only when it carries its own sign", () => {
    expect(read([["a stress of 5 MPa m"], ["1/2", sup], [" was seen"]])).toEqual(["a stress of 5 MPa m1/2 was seen"]);
    expect(read([["the ion Li"], ["+", sup], [" binds"]])).toEqual(["the ion Li⁺ binds"]);
  });
});

describe("joinProse — \"et al.\", an abbreviation or an initial at a page's foot does not end the sentence (P10-37)", () => {
  const first = (text: string): PdfLine => ({ page: 1, text, x: 100, y: 100, size: 10, font: "body" });
  const second = (text: string): PdfLine => ({ page: 2, text, x: 100, y: 700, size: 10, font: "body" });
  const paragraphs = (a: string, b: string) => joinProse([first(a), second(b)]).split("\n\n");

  it.each([
    ["as the earlier survey by Ortega et al.", "reported for the same kelp beds."],
    ["as the earlier survey by Ortega et al. (2019)", "reported for the same kelp beds."],
    ["the colonies, e.g.", "gulls and terns, were counted."],
    ["the colonies, i.e.", "those on the north shore, were counted."],
    ["the counts are drawn in Fig.", "3 for each tide."],
    ["the counts follow Eq.", "(4) for each tide."],
    ["the counts follow Ref.", "12 for each tide."],
    ["the counts were taken by J.", "ortega and the team."],
  ])("joins %j to the line that carries it on", (a, b) => {
    expect(paragraphs(a, b)).toHaveLength(1);
  });

  it("still starts a new paragraph when a real sentence ends at the foot", () => {
    expect(paragraphs("The team counted ten sites near the marsh.", "the next paragraph begins in lower case by accident.")).toHaveLength(2);
    // P10-42 (re-aimed, X-A9): "et al." is no sentence end (above), so a capital after it joins; a real end splits
    expect(paragraphs("The survey followed the earlier one by Ortega et al. in 2019.", "Then the tide came in and the count stopped.")).toHaveLength(2);
    expect(paragraphs("The team kept to the one rule of the visit, namely this.", "the next paragraph begins in lower case by accident.")).toHaveLength(2);
    // a one-letter word that is no initial, at the foot, ends the sentence as it always did
    expect(paragraphs("The team counted every site marked a.", "the next paragraph begins in lower case by accident.")).toHaveLength(2);
  });
});
