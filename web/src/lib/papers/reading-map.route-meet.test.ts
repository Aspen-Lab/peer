import { describe, expect, it } from "vitest";
import { routeByQuestions, type ReadingMap } from "./reading-map";

// P10-06b (ruling §1h.81; the owner's review 3.4, rubric A11's second clause): the strongest rows are
// the ones that answer the question. "I want to learn the parameter for growing 110 LCO" lit the
// Introduction (it names each term somewhere, at length) and left the growth and experimental
// sections, which hold the parameters of growing a 110 LCO film in one paragraph, a step lighter.
// Two rules fix that, on invented papers with known words:
// - the terms meet in a paragraph: a section's score is half the best of its paragraphs' scores,
//   with a bonus for the number of distinct terms the paragraph holds, and half the score of the
//   section as a whole;
// - a term's forms match: "growing" is also "growth", "grown" and "grow", by a small, explicit
//   rule on the word's stem — and a different word that begins alike ("grain" and "grating") is not.

const FILLER = "Cells were cycled at a fixed current and the rest was logged each hour.".split(" ");

/** A paragraph of about `words` words: the `sentences` first, then filler. */
function paragraphOf(words: number, ...sentences: string[]): string {
  const out = [...sentences];
  let i = 0;
  while (out.join(" ").split(/\s+/).length < words) out.push(FILLER[i++ % FILLER.length]);
  return out.join(" ");
}

interface Spec {
  id: string;
  paragraphs: string[];
}
function paperOf(specs: Spec[]) {
  const map = {
    sections: specs.map((spec) => ({
      id: spec.id,
      heading: spec.id,
      canonical: "body",
      role: "body",
      words: spec.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
      minutes: 1,
      paragraphs: spec.paragraphs.map((_, index) => ({ index, opening: null })),
    })),
    totalMinutes: 1,
  } as unknown as ReadingMap;
  return { map, body: specs.map((spec) => ({ paragraphs: spec.paragraphs })) };
}
const routeOf = (specs: Spec[], question: string) => {
  const { map, body } = paperOf(specs);
  return routeByQuestions(map, body, [question]).byQuestion[0].sections;
};
const tiersOf = (specs: Spec[], question: string) =>
  Object.fromEntries(Object.entries(routeOf(specs, question)).map(([id, section]) => [id, section.tier as string]));
const strongOf = (tiers: Record<string, string>) => Object.keys(tiers).filter((id) => tiers[id] === "strong");

describe("routeByQuestions — the terms meet in a paragraph (P10-06b, rule 1)", () => {
  // Six sections of 200 words. `apart` says each term twice, in two paragraphs; `together` says both
  // terms twice in one — the same counts in the same length, the sums equal. The four others say one
  // term once each, so both terms are in four sections (df 4 of 6).
  const specs: Spec[] = [
    { id: "apart", paragraphs: [paragraphOf(100, "The spinel changed. The spinel held."), paragraphOf(100, "The olivine changed. The olivine held.")] },
    { id: "together", paragraphs: [paragraphOf(100, "The spinel changed. The olivine changed. The spinel held. The olivine held."), paragraphOf(100)] },
    { id: "f1", paragraphs: [paragraphOf(200, "The spinel changed.")] },
    { id: "f2", paragraphs: [paragraphOf(200, "The spinel changed.")] },
    { id: "f3", paragraphs: [paragraphOf(200, "The olivine changed.")] },
    { id: "f4", paragraphs: [paragraphOf(200, "The olivine changed.")] },
  ];
  const tiers = tiersOf(specs, "spinel olivine");

  it("lets the section that holds both terms in one paragraph outrank the one that holds them apart, at equal sums", () => {
    const sections = routeOf(specs, "spinel olivine");
    expect(sections.apart.hits).toEqual(sections.together.hits);
    expect(tiers.together).toBe("strong");
    expect(tiers.apart).not.toBe("strong");
  });

  it("names the paragraph where the terms meet as the section's top paragraph", () => {
    expect(routeOf(specs, "spinel olivine").together.topParagraphs).toEqual([0]);
  });

  it("leaves a section that says one term often beneath the one that says two together (the bonus is for distinct terms)", () => {
    const more: Spec[] = [
      { id: "often", paragraphs: [paragraphOf(100, "The spinel changed. ".repeat(4).trim()), paragraphOf(100)] },
      { id: "both", paragraphs: [paragraphOf(100, "The spinel changed. The olivine changed."), paragraphOf(100)] },
      ...specs.slice(2),
    ];
    const t = tiersOf(more, "spinel olivine");
    expect(t.both).toBe("strong");
    expect(t.often).not.toBe("strong");
  });
});

describe("routeByQuestions — a term's forms match (P10-06b, rule 2)", () => {
  /** How many times `term` is counted in a section whose one paragraph says `words`. */
  const counted = (term: string, words: string): number => {
    const sections = routeOf(
      [
        { id: "a", paragraphs: [`${words} The quillwort changed.`] },
        { id: "b", paragraphs: [paragraphOf(40)] },
      ],
      `${term} quillwort`,
    );
    return sections.a.hits.find((hit) => hit.term === term)?.count ?? 0;
  };

  it.each([
    ["growing", "growth"],
    ["growing", "grown"],
    ["growing", "grow"],
    ["growth", "growing"],
    ["grow", "grown"],
    ["deposition", "deposited"],
    ["deposited", "deposition"],
    ["parameters", "parameter"],
    ["parameter", "parameters"],
    ["electrodes", "electrode"],
    ["annealing", "annealed"],
    ["temperature", "temperatures"],
  ])("counts %s when the paper says %s", (term, word) => {
    expect(counted(term, `The film showed ${word} here.`)).toBe(1);
  });

  it.each([
    ["grain", "grating"],
    ["current", "curriculum"],
    ["current", "currency"],
    ["crystal", "crystallography"],
    ["growing", "grower"],
    ["lco", "lcos"],
    ["110", "1100"],
  ])("does not count %s for %s", (term, word) => {
    expect(counted(term, `The film showed ${word} here.`)).toBe(0);
  });

  it("counts a number as it stood: 110, (110) and {110}", () => {
    expect(counted("110", "The 110 face, the (110) face and the {110} face.")).toBe(3);
  });

  it("counts the forms under the reader's own term, so growing ×6 is growing, growth and grown together", () => {
    const sections = routeOf(
      [
        { id: "a", paragraphs: ["Growing began. The growth was slow. Growth, then grown films, then grown again; growing ended. The quillwort changed."] },
        { id: "b", paragraphs: [paragraphOf(40)] },
      ],
      "growing quillwort",
    );
    expect(sections.a.hits).toEqual([{ term: "growing", count: 6 }, { term: "quillwort", count: 1 }]);
  });

  it("still counts the abbreviation's long form and its plural as it did", () => {
    expect(counted("lco", "Lithium cobalt oxide and LiCoO2 and LCO.")).toBe(3);
    expect(counted("parameter", "The parameters, the parameter.")).toBe(2);
  });

  it("marks a paragraph that holds only another form of the term", () => {
    const sections = routeOf(
      [
        { id: "a", paragraphs: [paragraphOf(40), paragraphOf(40, "The film was grown slowly. The quillwort changed.")] },
        { id: "b", paragraphs: [paragraphOf(40)] },
      ],
      "growing quillwort",
    );
    expect(sections.a.paragraphs).toEqual([1]);
    expect(sections.a.evidence).toMatch(/grown slowly/);
  });
});

describe("routeByQuestions — the strongest rows answer the question (P10-06b, rule 3; the owner's A11)", () => {
  // A paper shaped like the one the owner read: a long Introduction that names each term somewhere,
  // two growth sections whose paragraph holds the parameters of growing a 110 film of LCO, a
  // conclusion, and sections that mention the 110 face and the material in passing.
  const QUESTION = "I want to learn the parameter for growing 110 LCO";
  const TOGETHER = "The growth parameters for the (110) LCO film were a bath at 60 C and a current of 2 mA.";
  const specs: Spec[] = [
    {
      id: "intro",
      paragraphs: [
        paragraphOf(100, "These parameters matter."),
        paragraphOf(100, "These parameters matter. Further parameters follow."),
        paragraphOf(100, "Growing films is hard. Growing them thick is harder."),
        paragraphOf(100, "The 110 face is flat. The 110 plane is dense."),
        paragraphOf(100, "LCO is a cathode. LCO is layered. LCO is dense."),
        paragraphOf(100, "LCO is used in cells. LCO is sold. LCO is old."),
        paragraphOf(100),
        paragraphOf(100),
        paragraphOf(100),
        paragraphOf(100),
      ],
    },
    {
      id: "growth",
      paragraphs: [
        paragraphOf(100, "Growth was slow. Growth was steady. The 110 face grew."),
        paragraphOf(100, TOGETHER, "Growth followed."),
        paragraphOf(100, "Growth of the 110 face needed a rest. Growth of LCO needed heat."),
        paragraphOf(100, "The grown film had a 110 texture. The 110 texture held."),
        paragraphOf(100, "Growth ended."),
        paragraphOf(100),
      ],
    },
    {
      id: "twins",
      paragraphs: [paragraphOf(100, "Twinned growth of LCO was seen. The 110 face twinned."), paragraphOf(100, "The 110 face is flat."), paragraphOf(100), paragraphOf(100), paragraphOf(100)],
    },
    {
      id: "tectonics",
      paragraphs: [paragraphOf(100, "The 110 face is flat. The 110 plane is dense. The 110 grain is large."), paragraphOf(100), paragraphOf(100), paragraphOf(100), paragraphOf(100)],
    },
    {
      id: "guided",
      paragraphs: [paragraphOf(100, "The 110 face is flat. LCO is layered. LCO is dense. LCO is old."), paragraphOf(100, "The 110 plane is dense."), paragraphOf(100), paragraphOf(100), paragraphOf(100)],
    },
    { id: "concl", paragraphs: [paragraphOf(100, "The 110 face is flat. LCO is layered."), paragraphOf(100), paragraphOf(100)] },
    {
      id: "experimental",
      paragraphs: [
        paragraphOf(100, "The film was grown at 60 C. The bath held the growth parameters and a LCO precursor."),
        paragraphOf(100, "The 110 face was the target."),
        paragraphOf(100),
        paragraphOf(100),
      ],
    },
    { id: "ebsd", paragraphs: [paragraphOf(100, "Samples were polished."), paragraphOf(100), paragraphOf(100), paragraphOf(100)] },
    { id: "raman", paragraphs: [paragraphOf(100, "LCO was probed. LCO was clean."), paragraphOf(100), paragraphOf(100)] },
    { id: "xrd", paragraphs: [paragraphOf(100, "The 110 peak was weak."), paragraphOf(100), paragraphOf(100), paragraphOf(100)] },
  ];
  const tiers = tiersOf(specs, QUESTION);

  it("lights the growth sections, and not the Introduction alone", () => {
    const strong = strongOf(tiers);
    expect(strong).toContain("growth");
    expect(strong).not.toEqual(["intro"]);
  });

  it("keeps at most three strong rows, and at least a third of the rows faint or none", () => {
    expect(strongOf(tiers).length).toBeLessThanOrEqual(3);
    const faintOrNone = Object.values(tiers).filter((tier) => tier === "faint" || tier === "none").length;
    expect(faintOrNone).toBeGreaterThanOrEqual(Math.ceil(specs.length / 3));
  });

  it("names the paragraph that holds the parameters, the growing and the 110 LCO together as the growth section's top", () => {
    expect(routeOf(specs, QUESTION).growth.topParagraphs).toEqual([1]);
  });
});
