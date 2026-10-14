import { describe, expect, it } from "vitest";
import { gistRoute, gradeScores, METHOD_BOOST, relevanceScores, routeByQuestions, type ReadingMap, type ReadingRole } from "./reading-map";

// P10-06 (ruling §1h.78; the owner's review 3.2 and 3.4): the route grades relevance. A question
// no longer marks every section that mentions it the same green: each section gets a score from the
// question's terms (a term in few sections counts for much, one in all of them for little; a long
// section does not win by length alone), the tint is one of three tiers ordered by that score, and
// the strongest tier is worn by at most three rows. Pure, on invented sections with known counts.

describe("relevanceScores — Σ idf(term) × ln(1 + count) ÷ ln(2 + words / 200)", () => {
  it("scores a term by its rarity: idf = ln((N + 1) / (df + 1)) + 0.1", () => {
    // N = 2 sections, one term, in one of them (df = 1): idf = ln(3 / 2) + 0.1.
    // 400 words: ln(2 + 2) = ln 4; count 3: ln(1 + 3) = ln 4 — the two cancel.
    const [a, b] = relevanceScores([
      { counts: [3], words: 400 },
      { counts: [0], words: 400 },
    ]);
    expect(a).toBeCloseTo(Math.log(3 / 2) + 0.1, 10);
    expect(b).toBe(0);
  });

  it("scores a term in every section little: df = N gives idf = 0.1", () => {
    // N = 3, df = 3: idf = ln(4 / 4) + 0.1. 200 words: ln(3). count 1: ln 2.
    const scores = relevanceScores([
      { counts: [1], words: 200 },
      { counts: [1], words: 200 },
      { counts: [1], words: 200 },
    ]);
    for (const score of scores) expect(score).toBeCloseTo((0.1 * Math.log(2)) / Math.log(3), 10);
  });

  it("sums the terms, each with its own idf and its own count", () => {
    // N = 4. Term 0 in sections 0 and 1 (df 2), term 1 in section 0 only (df 1). 0 words: ln 2.
    const scores = relevanceScores([
      { counts: [2, 5], words: 0 },
      { counts: [1, 0], words: 0 },
      { counts: [0, 0], words: 0 },
      { counts: [0, 0], words: 0 },
    ]);
    const idf0 = Math.log(5 / 3) + 0.1;
    const idf1 = Math.log(5 / 2) + 0.1;
    expect(scores[0]).toBeCloseTo((idf0 * Math.log(3) + idf1 * Math.log(6)) / Math.log(2), 10);
    expect(scores[1]).toBeCloseTo((idf0 * Math.log(2)) / Math.log(2), 10);
    expect(scores[2]).toBe(0);
  });

  it("lets a rare term outweigh a common one at the same count and length", () => {
    // Term 0 in all four sections, term 1 in one: one mention of each, in different sections.
    const scores = relevanceScores([
      { counts: [1, 0], words: 300 },
      { counts: [1, 1], words: 300 },
      { counts: [1, 0], words: 300 },
      { counts: [1, 0], words: 300 },
    ]);
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[0]).toBe(scores[2]);
  });

  it("does not let a long section win by length alone: the same counts score less in more words", () => {
    const [short, long] = relevanceScores([
      { counts: [2], words: 200 },
      { counts: [2], words: 2000 },
      { counts: [0], words: 200 },
    ]);
    expect(short).toBeGreaterThan(long);
  });

  it("is zero for a section with no mention, and empty for no sections", () => {
    expect(relevanceScores([])).toEqual([]);
    expect(relevanceScores([{ counts: [0, 0], words: 50 }])).toEqual([0]);
  });
});

describe("gradeScores — strong ≥ 0.6 × max and in the top three, medium ≥ 0.4 × max, faint for any hit", () => {
  it("grades by the share of the best score", () => {
    expect(gradeScores([10, 7, 6, 5, 4, 3.9, 0])).toEqual(["strong", "strong", "strong", "medium", "medium", "faint", "none"]);
  });

  it("gives the strongest tier to three rows at most, the earlier rows first on a tie", () => {
    expect(gradeScores([5, 5, 5, 5])).toEqual(["strong", "strong", "strong", "medium"]);
    expect(gradeScores([5, 5, 5, 5, 5, 5]).filter((tier) => tier === "strong")).toHaveLength(3);
    // The top three by score, wherever they stand in the paper.
    expect(gradeScores([1, 9, 2, 8, 3.5, 7, 4])).toEqual(["faint", "strong", "faint", "strong", "faint", "strong", "medium"]);
  });

  it("never grades a row without a mention above none, and a paper with no mention at all is all none", () => {
    expect(gradeScores([0, 0, 0])).toEqual(["none", "none", "none"]);
    expect(gradeScores([])).toEqual([]);
  });

  it("makes the only section strong, if it is mentioned at all", () => {
    expect(gradeScores([0.2])).toEqual(["strong"]);
    expect(gradeScores([0])).toEqual(["none"]);
  });
});

// ── A paper of invented sections with known counts ──────────────────────

const FILLER = "Cells were cycled at a fixed current and the rest was logged each hour.";
/** A paragraph of `words` words holding `quillwort` ×q and `lattice` ×l, the rest filler. */
function para(q: number, l: number, words = 60): string {
  const mentions = [...Array<string>(q).fill("quillwort"), ...Array<string>(l).fill("lattice")];
  const out = mentions.map((term) => `The ${term} changed.`);
  const filler = FILLER.split(" ");
  let i = 0;
  while (out.join(" ").split(/\s+/).length < words) out.push(filler[i++ % filler.length]);
  return out.join(" ");
}

interface Spec {
  id: string;
  paragraphs: string[];
  role?: ReadingRole;
  level?: 1 | 2 | 3;
  parentId?: string;
}
function paperOf(specs: Spec[]) {
  const map = {
    sections: specs.map((spec) => ({
      id: spec.id,
      heading: spec.id,
      canonical: "body",
      role: spec.role ?? "body",
      words: spec.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
      minutes: 1,
      paragraphs: spec.paragraphs.map((_, index) => ({ index, opening: null })),
      ...(spec.level ? { level: spec.level } : {}),
      ...(spec.parentId ? { parentId: spec.parentId } : {}),
    })),
    totalMinutes: 1,
  } as unknown as ReadingMap;
  return { map, body: specs.map((spec) => ({ paragraphs: spec.paragraphs })) };
}
const tiersOf = (specs: Spec[], question: string) => {
  const { map, body } = paperOf(specs);
  const sections = routeByQuestions(map, body, [question]).byQuestion[0].sections;
  return Object.fromEntries(Object.entries(sections).map(([id, section]) => [id, section.tier as string]));
};
const count = (tiers: Record<string, string>, tier: string) => Object.values(tiers).filter((t) => t === tier).length;

describe("routeByQuestions — the tier is the section's grade among the paper's sections (P10-06)", () => {
  // Twelve sections, the question's two terms mentioned in nine of them, the owner's shape: one term
  // everywhere, the other in a few.
  const specs: Spec[] = [
    { id: "intro", paragraphs: [para(2, 0, 120), para(1, 0, 120)] },
    { id: "g1", paragraphs: [para(4, 2, 90), para(5, 3, 90)] },
    { id: "g2", paragraphs: [para(1, 0, 90)] },
    { id: "g3", paragraphs: [para(1, 0, 90), para(0, 0, 90)] },
    { id: "g4", paragraphs: [para(0, 0, 90)] },
    { id: "g5", paragraphs: [para(1, 0, 90)] },
    { id: "concl", paragraphs: [para(1, 1, 90)] },
    { id: "e1", paragraphs: [para(7, 4, 90), para(3, 2, 90)] },
    { id: "e2", paragraphs: [para(0, 0, 90)] },
    { id: "e3", paragraphs: [para(1, 0, 90)] },
    { id: "e4", paragraphs: [para(1, 0, 90)] },
    { id: "e5", paragraphs: [para(0, 0, 90)] },
  ];
  const tiers = tiersOf(specs, "quillwort lattice");

  it("uses the four names: strong, medium, faint, none", () => {
    expect(new Set(Object.values(tiers))).toEqual(new Set(["strong", "medium", "faint", "none"]));
  });

  it("gives the strongest tier to the sections that say most, and no more than three", () => {
    expect(count(tiers, "strong")).toBeLessThanOrEqual(3);
    expect(tiers.e1).toBe("strong");
    expect(tiers.g1).toBe("strong");
  });

  it("leaves a passing mention in the paper's background: faint or none for at least a third of the rows", () => {
    expect(count(tiers, "none") + count(tiers, "faint")).toBeGreaterThanOrEqual(Math.ceil(specs.length / 3));
    expect(tiers.g4).toBe("none");
    expect(tiers.g2).not.toBe("strong");
  });

  it("is monotone: a section that says more is never a lighter tier than one that says less in the same length", () => {
    const rank: Record<string, number> = { none: 0, faint: 1, medium: 2, strong: 3 };
    expect(rank[tiers.e1]).toBeGreaterThanOrEqual(rank[tiers.g2]);
    expect(rank[tiers.g1]).toBeGreaterThanOrEqual(rank[tiers.g3]);
    expect(rank[tiers.g3]).toBeGreaterThanOrEqual(rank[tiers.g4]);
  });

  it("with the term in every section, still orders by what is said: one strong, the passing mentions faint", () => {
    const everywhere: Spec[] = [
      { id: "a", paragraphs: [para(1, 0, 150)] },
      { id: "b", paragraphs: [para(1, 0, 150)] },
      { id: "c", paragraphs: [para(9, 6, 150)] },
      { id: "d", paragraphs: [para(1, 0, 150)] },
      { id: "e", paragraphs: [para(1, 0, 150)] },
      { id: "f", paragraphs: [para(1, 1, 150)] },
    ];
    const everywhereTiers = tiersOf(everywhere, "quillwort lattice");
    expect(everywhereTiers.c).toBe("strong");
    expect(count(everywhereTiers, "strong")).toBeLessThanOrEqual(3);
    expect(everywhereTiers.a).toBe("faint");
    expect(everywhereTiers.d).toBe("faint");
    expect(count(everywhereTiers, "none")).toBe(0);
  });

  it("with the terms in one section only, that section is strong and the rest none", () => {
    const one: Spec[] = [
      { id: "a", paragraphs: [para(0, 0, 150)] },
      { id: "b", paragraphs: [para(3, 2, 150)] },
      { id: "c", paragraphs: [para(0, 0, 150)] },
      { id: "d", paragraphs: [para(0, 0, 150)] },
    ];
    expect(tiersOf(one, "quillwort lattice")).toEqual({ a: "none", b: "strong", c: "none", d: "none" });
  });

  it("with one section only, that section is strong", () => {
    expect(tiersOf([{ id: "only", paragraphs: [para(1, 0, 80)] }], "quillwort lattice")).toEqual({ only: "strong" });
  });
});

describe("routeByQuestions — a group row takes the best of its children (P10-06, ruling §1h.78 (d))", () => {
  const specs: Spec[] = [
    { id: "g2", paragraphs: [], level: 1 },
    // The weaker child stands first: the group takes the strongest, not the first.
    { id: "g2b", paragraphs: [para(1, 0, 120)], level: 2, parentId: "g2" },
    { id: "g2a", paragraphs: [para(6, 3, 120)], level: 2, parentId: "g2" },
    { id: "other", paragraphs: [para(1, 0, 120)], level: 1 },
    { id: "far", paragraphs: [para(0, 0, 120)], level: 1 },
  ];
  const { map, body } = paperOf(specs);
  const sections = routeByQuestions(map, body, ["quillwort lattice"]).byQuestion[0].sections;

  it("scores the group as its strongest child and lists the union of their mentions", () => {
    expect(sections.g2.tier).toBe(sections.g2a.tier);
    expect(sections.g2.hits).toEqual([{ term: "quillwort", count: 7 }, { term: "lattice", count: 3 }]);
    expect(sections.g2.paragraphs).toEqual([]);
  });

  it("scores a child on its own paragraphs", () => {
    expect(sections.g2b.tier).not.toBe(sections.g2a.tier);
    expect(sections.g2b.hits).toEqual([{ term: "quillwort", count: 1 }]);
    expect(sections.far.tier).toBe("none");
  });

  // P10-06c (rule 1), re-aimed: "counts a group among the rows" became "counts the leaf rows" — the group row
  // is tinted by its strongest child's tier, outside the cap (the describe below).
  it("counts the leaf rows, so three strong leaf rows at most still holds", () => {
    const strongLeaves = Object.entries(sections).filter(([id, section]) => id !== "g2" && section.tier === "strong");
    expect(strongLeaves.length).toBeLessThanOrEqual(3);
  });
});

describe("routeByQuestions — the paragraphs of a section graded the same way (P10-06)", () => {
  const specs: Spec[] = [
    { id: "a", paragraphs: [para(1, 0, 100), para(6, 4, 100), para(2, 0, 100), para(0, 0, 100)] },
    { id: "b", paragraphs: [para(1, 0, 100)] },
    { id: "c", paragraphs: [para(0, 0, 100)] },
  ];
  const { map, body } = paperOf(specs);
  const sections = routeByQuestions(map, body, ["quillwort lattice"]).byQuestion[0].sections;
  const top = (id: string) => sections[id].topParagraphs;

  it("names the paragraph that says most as the section's top, the others that mention a term stay in `paragraphs`", () => {
    expect(sections.a.paragraphs).toEqual([0, 1, 2]);
    expect(top("a")).toEqual([1]);
  });

  it("has no top paragraph for a section with no mention", () => {
    expect(top("c")).toBeUndefined();
  });
});

describe("gistRoute — the roles on the new tiers (P10-06)", () => {
  it("read is strong, skim is faint, the apparatus stays none", () => {
    const map = paperOf([
      { id: "r", paragraphs: ["x"], role: "evidence" },
      { id: "m", paragraphs: ["x"], role: "method" },
      { id: "a", paragraphs: ["x"], role: "apparatus" },
    ]).map;
    const sections = gistRoute(map).byQuestion[0].sections;
    expect(sections.r.tier as string).toBe("strong");
    expect(sections.m.tier as string).toBe("faint");
    expect(sections.a.tier as string).toBe("none");
  });
});

// ── P10-06c (A11; the walk's X-A3 and §7 item 2) ──────────────────────────────────────────────────────────────
// The strongest rows are the ones that answer a "parameter" question. Four rules, on invented papers.

/** The same paragraph in every section that uses it: equal sections score exactly equal. */
const SAME = para(5, 3, 120);
const leaf = (id: string, extra: Partial<Spec> = {}): Spec => ({ id, paragraphs: [SAME], ...extra });
const NONE: Spec = { id: "z1", paragraphs: [para(0, 0, 120)] };

describe("routeByQuestions — a group row never takes a strong slot (P10-06c, rule 1)", () => {
  // Five leaves of the same score; two of them under group rows. The cap counts the leaf rows: the first three are
  // strong, the fourth is medium (its score is as high as theirs, the cap holds it) — and a group row wears its
  // strongest child's tier, outside the cap, so "2." is strong with 2.1 and "4." is medium with 4.1.
  const specs: Spec[] = [
    { id: "g2", paragraphs: [], level: 1 },
    leaf("g2a", { level: 2, parentId: "g2" }),
    leaf("b", { level: 1 }),
    leaf("c", { level: 1 }),
    { id: "g4", paragraphs: [], level: 1 },
    leaf("g4a", { level: 2, parentId: "g4" }),
    { ...NONE, level: 1 },
  ];
  const tiers = tiersOf(specs, "quillwort lattice");

  it("counts the cap over the leaf rows: three strong leaves, the group row not among them", () => {
    expect([tiers.g2a, tiers.b, tiers.c]).toEqual(["strong", "strong", "strong"]);
    expect(tiers.g4a).toBe("medium");
  });

  it("tints a group row by its strongest child's tier, outside the cap: strong with a strong child, medium with a medium one", () => {
    expect(tiers.g2).toBe("strong");
    expect(tiers.g4).toBe("medium");
    // Four strong rows in all, three of them leaves.
    expect(count(tiers, "strong")).toBe(4);
  });

  it("gives a nested group row the tier of the strongest row under it, and none to a group row without a mention", () => {
    const nested: Spec[] = [
      { id: "top", paragraphs: [], level: 1 },
      { id: "mid", paragraphs: [], level: 2, parentId: "top" },
      leaf("deep", { level: 3, parentId: "mid" }),
      { id: "idle", paragraphs: [], level: 1 },
      { ...NONE, level: 2, parentId: "idle" },
      leaf("other", { level: 1 }),
    ];
    const got = tiersOf(nested, "quillwort lattice");
    expect(got.deep).toBe("strong");
    expect(got.mid).toBe("strong");
    expect(got.top).toBe("strong");
    expect(got.idle).toBe("none");
  });

  it("keeps a group row's hits, evidence and empty paragraphs as before", () => {
    const { map, body } = paperOf(specs);
    const sections = routeByQuestions(map, body, ["quillwort lattice"]).byQuestion[0].sections;
    expect(sections.g2.paragraphs).toEqual([]);
    expect(sections.g2.hits).toEqual([{ term: "quillwort", count: 5 }, { term: "lattice", count: 3 }]);
    expect(sections.g2.evidence).toBe(sections.g2a.evidence);
  });
});

describe("relevanceScores — a term in nearly every section weighs little (P10-06c, rule 3)", () => {
  // Ten sections of 0 words (ln 2 in the divisor, which cancels with ln(1 + 1)): a section that says one term once
  // scores that term's idf. Term 0 in the first `df0` sections, term 1 in the first two.
  const sectionsOf = (df0: number, n = 10) =>
    Array.from({ length: n }, (_, i) => ({ counts: [i < df0 ? 1 : 0, i < 2 ? 1 : 0], words: 0 }));

  it("gives a term found in 9 of 10 sections the floor, 0.1, alone — and a term found in 2 of 10 its rarity", () => {
    const scores = relevanceScores(sectionsOf(9));
    // Section 5: term 0 only. Section 0: both terms.
    expect(scores[5]).toBeCloseTo(0.1, 10);
    expect(scores[0]).toBeCloseTo(0.1 + Math.log(11 / 3) + 0.1, 10);
    expect(scores[0]).toBeGreaterThan(scores[5] * 10);
  });

  it("draws the line at 80 %: 8 of 10 is the floor, 7 of 10 is not", () => {
    expect(relevanceScores(sectionsOf(8))[5]).toBeCloseTo(0.1, 10);
    expect(relevanceScores(sectionsOf(7))[5]).toBeCloseTo(Math.log(11 / 8) + 0.1, 10);
    // 4 of 5 is 80 %.
    expect(relevanceScores(sectionsOf(4, 5))[3]).toBeCloseTo(0.1, 10);
    expect(relevanceScores(sectionsOf(3, 5))[2]).toBeCloseTo(Math.log(6 / 4) + 0.1, 10);
  });

  it("lets one mention of a term in 2 of 10 sections outweigh ten mentions of a term in 9 of 10", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ counts: [i === 5 ? 10 : i < 9 ? 1 : 0, i === 0 ? 1 : i === 1 ? 1 : 0], words: 0 }));
    const scores = relevanceScores(rows);
    // Section 5: term 0 ×10 (floor); section 0: term 0 ×1 and term 1 ×1 (rare).
    expect(scores[0]).toBeGreaterThan(scores[5]);
  });

  it("changes nothing for a term below the line: the rarity formula stands", () => {
    const [a, b] = relevanceScores([
      { counts: [3], words: 400 },
      { counts: [0], words: 400 },
    ]);
    expect(a).toBeCloseTo(Math.log(3 / 2) + 0.1, 10);
    expect(b).toBe(0);
  });
});

describe("routeByQuestions — a parameter question favours the method sections (P10-06c, rule 2)", () => {
  it("names the constant: METHOD_BOOST is 1.3", () => {
    expect(METHOD_BOOST).toBe(1.3);
  });

  // Four sections of the same words and counts; the method one stands last. With the cap at three strong rows and
  // the earlier row first on a tie, the last one is medium — unless the question asks for parameters.
  const equal = (role: ReadingRole): Spec[] => [
    leaf("a", { role: "evidence" }),
    leaf("b", { role: "evidence" }),
    leaf("c", { role: "evidence" }),
    leaf("m", { role }),
    NONE,
  ];

  it("lets the method section win only when the question carries a parameter word", () => {
    const without = tiersOf(equal("method"), "quillwort lattice sorption");
    expect(without).toMatchObject({ a: "strong", b: "strong", c: "strong", m: "medium" });
    const withWord = tiersOf(equal("method"), "quillwort lattice parameters");
    expect(withWord).toMatchObject({ a: "strong", b: "strong", c: "medium", m: "strong" });
  });

  it.each(["parameter", "parameters", "condition", "conditions", "temperature", "current", "voltage", "potential", "concentration", "rate", "time", "thickness", "electrolyte"])(
    "reads %s as a parameter word",
    (word) => {
      expect(tiersOf(equal("method"), `quillwort lattice ${word}`).m).toBe("strong");
    },
  );

  it("reads a form of the word the same way: temperatures, rates, times", () => {
    for (const word of ["temperatures", "rates", "times"]) expect(tiersOf(equal("method"), `quillwort lattice ${word}`).m, word).toBe("strong");
  });

  it("boosts an apparatus section as it does a method one, and no other role", () => {
    expect(tiersOf(equal("apparatus"), "quillwort lattice parameters").m).toBe("strong");
    for (const role of ["setup", "evidence", "interpretation", "body"] as const) {
      expect(tiersOf(equal(role), "quillwort lattice parameters").m, role).toBe("medium");
    }
  });

  it("changes nothing else when no parameter word is asked: the tiers equal those of a paper with no method section", () => {
    expect(tiersOf(equal("method"), "quillwort lattice sorption")).toEqual(tiersOf(equal("body"), "quillwort lattice sorption"));
  });

  it("boosts a group row's children, so the group follows: a method group is strong with its strong child", () => {
    const specs: Spec[] = [
      leaf("a", { role: "evidence" }),
      leaf("b", { role: "evidence" }),
      leaf("c", { role: "evidence" }),
      { id: "g", paragraphs: [], role: "method", level: 1 },
      leaf("g1", { role: "method", level: 2, parentId: "g" }),
      NONE,
    ];
    const got = tiersOf(specs, "quillwort lattice parameters");
    expect(got.g1).toBe("strong");
    expect(got.g).toBe("strong");
    expect(got.c).toBe("medium");
  });
});

describe("routeByQuestions — the strongest rows answer a parameter question (P10-06c, rule 5; the owner's A11)", () => {
  // A paper shaped like the one the owner read: a long Introduction that names each term somewhere, a results group
  // whose subsections grow the film, a conclusion, and an experimental group whose first subsection holds the
  // growth parameters. Every section says the material and its face (110, LCO), as the owner's does.
  const QUESTION = "I want to learn the parameter for growing 110 LCO";
  const FACE = "The 110 face of LCO was flat.";
  const intro: string[] = [
    para(0, 0, 100) + " Parameters matter. Further parameters follow.",
    para(0, 0, 100) + " Growing films is hard. Growing them thick is harder.",
    para(0, 0, 100) + " " + FACE + " The 110 plane is dense. LCO is layered. LCO is old.",
    para(0, 0, 100) + " LCO is used in cells. LCO is sold. The parameter is fixed.",
    para(0, 0, 100),
    para(0, 0, 100),
  ];
  const growth = (extra: string) => [para(0, 0, 100) + " " + FACE + " " + extra, para(0, 0, 100), para(0, 0, 100)];
  const specs: Spec[] = [
    { id: "intro", paragraphs: intro, role: "setup", level: 1 },
    { id: "res", paragraphs: [], role: "evidence", level: 1 },
    { id: "r1", paragraphs: growth("Growing the 110 film of LCO took time. Growth was steady. The growth parameter was the potential. Growth of the 110 face grew."), role: "evidence", level: 2, parentId: "res" },
    { id: "r2", paragraphs: growth("Growth of the 110 face grew. Growth was slow. The parameter was the current."), role: "evidence", level: 2, parentId: "res" },
    { id: "r3", paragraphs: growth("Twinned growth of LCO was seen."), role: "evidence", level: 2, parentId: "res" },
    { id: "r4", paragraphs: growth("The 110 grain was large."), role: "evidence", level: 2, parentId: "res" },
    { id: "concl", paragraphs: growth("Growth of the 110 face was steady. The parameter held."), role: "interpretation", level: 1 },
    { id: "exp", paragraphs: [], role: "method", level: 1 },
    {
      id: "e1",
      paragraphs: [
        para(0, 0, 100) + " " + FACE + " The film of 110 LCO was grown at 60 C and a current of 2 mA. The growth parameter was the bath. The potential was fixed.",
        para(0, 0, 100) + " The film was grown for an hour.",
        para(0, 0, 100),
      ],
      role: "method",
      level: 2,
      parentId: "exp",
    },
    { id: "e2", paragraphs: growth("Data were acquired."), role: "method", level: 2, parentId: "exp" },
    { id: "e3", paragraphs: growth("Samples were polished."), role: "method", level: 2, parentId: "exp" },
    { id: "e4", paragraphs: [para(0, 0, 100) + " LCO was probed. LCO was clean.", para(0, 0, 100)], role: "method", level: 2, parentId: "exp" },
  ];
  const tiers = tiersOf(specs, QUESTION);
  const leafIds = specs.filter((s) => s.paragraphs.length > 0).map((s) => s.id);

  it("lights the growth section of the results and the experimental growth section, and their group rows by them", () => {
    expect(tiers.r1).toBe("strong");
    expect(tiers.e1).toBe("strong");
    expect(tiers.res).toBe("strong");
    expect(tiers.exp).toBe("strong");
  });

  it("keeps at most three strong leaf rows, both of those among them, and a third of the leaves faint or none", () => {
    const strongLeaves = leafIds.filter((id) => tiers[id] === "strong");
    expect(strongLeaves.length).toBeLessThanOrEqual(3);
    expect(strongLeaves).toEqual(expect.arrayContaining(["r1", "e1"]));
    const faintOrNone = leafIds.filter((id) => tiers[id] === "faint" || tiers[id] === "none").length;
    expect(faintOrNone).toBeGreaterThanOrEqual(Math.ceil(leafIds.length / 3));
  });
});
