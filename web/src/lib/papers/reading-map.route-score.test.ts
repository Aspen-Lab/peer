import { describe, expect, it } from "vitest";
import { gistRoute, gradeScores, relevanceScores, routeByQuestions, type ReadingMap, type ReadingRole } from "./reading-map";

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

  it("counts a group among the rows, so three strong rows at most still holds", () => {
    const tiers = Object.values(sections).map((section) => section.tier as string);
    expect(tiers.filter((tier) => tier === "strong").length).toBeLessThanOrEqual(3);
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
