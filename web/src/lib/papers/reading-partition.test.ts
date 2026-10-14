import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { MAP } from "@/components/reader/copy";
import type { FullTextResult } from "./full-text";
import type { ExtractedDocument } from "./html-text";
import { buildReading } from "./reading";
import { GIST_QUESTION, gistRoute, readableSections, routeByQuestions, type RouteResult } from "./reading-map";
import {
  PARTITION_ROLES,
  PART_ROLE,
  TRUNK,
  partOf,
  partitionedMap,
  restorePartition,
  sanitizePartition,
  unheadedTrunk,
  withPartitionMarks,
  type GuidePartition,
} from "./reading-partition";

// P10-07a (B P10-05 §1.3 and §2.4; review 3.3, second half; rubric A15): the rule that says
// a paper has no headings of its own, and the sanitizer that makes the model's partition of
// such a paper a structure the page may draw. Both are pure. Every text below is invented
// ("a survey of shore ecology"): no sentence of any paper, no owner's PDF.

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];

/** One invented paragraph: three sentences and one number, about one of six shore topics. */
function invented(k: number): string {
  const topic = TOPICS[k % TOPICS.length];
  return `Invented paragraph ${k} about ${topic}. The survey counted ${10 + k} sites near the ${topic}. Nothing here is quoted from a paper.`;
}

const words = (paragraph: string) => paragraph.split(/\s+/).length;
const wordsOf = (paragraphs: readonly string[]) => paragraphs.reduce((sum, p) => sum + words(p), 0);

/** B's fixture: one `body` section of 30 paragraphs and a Methods section of 4. */
function fixture() {
  return [
    { id: "s0", canonical: "body", paragraphs: Array.from({ length: 30 }, (_, k) => invented(k)) },
    { id: "s1", canonical: "methods", paragraphs: Array.from({ length: 4 }, (_, k) => invented(100 + k)) },
  ];
}

/** `n` paragraphs of exactly `w` words each. */
const block = (n: number, w: number): string[] => Array.from({ length: n }, () => Array(w).fill("word").join(" "));

describe("unheadedTrunk — the rule (B P10-05 §1.3)", () => {
  it("holds the three numbers B measured the rule on", () => {
    expect(TRUNK).toEqual({ share: 0.5, paragraphs: 8, placedRows: 2 });
  });

  it("finds the trunk of the invented fixture: the body section, its share and its paragraphs", () => {
    const sections = fixture();
    const trunk = unheadedTrunk(sections);

    expect(trunk).toEqual({ sectionId: "s0", sectionIndex: 0, paragraphCount: 30 });
    const share = wordsOf(sections[0].paragraphs) / (wordsOf(sections[0].paragraphs) + wordsOf(sections[1].paragraphs));
    expect(share).toBeGreaterThan(0.85);
  });

  it("finds a trunk that is not the first section, with its index in the list it was given", () => {
    const [trunk, methods] = fixture();

    expect(unheadedTrunk([methods, trunk])).toEqual({ sectionId: "s0", sectionIndex: 1, paragraphCount: 30 });
  });

  it("is a paper with no heading at all: one body section is its own trunk", () => {
    expect(unheadedTrunk([{ id: "s0", canonical: "body", paragraphs: block(24, 52) }])).toEqual({ sectionId: "s0", sectionIndex: 0, paragraphCount: 24 });
  });

  it("passes the share at exactly 50 % and just over it", () => {
    const at = (other: number) => unheadedTrunk([{ id: "t", canonical: "body", paragraphs: block(8, 10) }, { id: "o", canonical: "results", paragraphs: block(1, other) }]);

    expect(at(80)).not.toBeNull(); // 80 of 160: exactly half
    expect(at(79)).not.toBeNull(); // 80 of 159
  });

  it("fails the share at 49 % and below", () => {
    const at = (other: number) => unheadedTrunk([{ id: "t", canonical: "body", paragraphs: block(8, 10) }, { id: "o", canonical: "results", paragraphs: block(1, other) }]);

    expect(at(81)).toBeNull(); // 80 of 161 is 49.7 %
    expect(at(82)).toBeNull(); // 80 of 162 is 49.4 %
    expect(at(200)).toBeNull();
  });

  it("wants eight paragraphs: seven is too few, eight is enough", () => {
    expect(unheadedTrunk([{ id: "t", canonical: "body", paragraphs: block(7, 40) }])).toBeNull();
    expect(unheadedTrunk([{ id: "t", canonical: "body", paragraphs: block(8, 40) }])).not.toBeNull();
  });

  it("allows two sections with a placed bucket beside the trunk, not three", () => {
    const trunk = { id: "t", canonical: "body", paragraphs: block(8, 40) };
    const placed = (canonical: string, id: string) => ({ id, canonical, paragraphs: block(1, 5) });

    expect(unheadedTrunk([trunk, placed("methods", "a")])).not.toBeNull();
    expect(unheadedTrunk([trunk, placed("methods", "a"), placed("results", "b")])).not.toBeNull();
    expect(unheadedTrunk([trunk, placed("methods", "a"), placed("results", "b"), placed("discussion", "c")])).toBeNull();
  });

  it("does not count the abstract, the references, the acknowledgments, the supplementary or another body row as a placed row", () => {
    const trunk = { id: "t", canonical: "body", paragraphs: block(8, 40) };
    const others = ["abstract", "references", "acknowledgments", "supplementary", "body", "body"].map((canonical, i) => ({ id: `o${i}`, canonical, paragraphs: block(1, 3) }));

    expect(unheadedTrunk([trunk, ...others, { id: "m", canonical: "methods", paragraphs: block(1, 3) }, { id: "r", canonical: "results", paragraphs: block(1, 3) }])).not.toBeNull();
  });

  it("takes the earlier of two equal body rows", () => {
    const sections = [
      { id: "first", canonical: "body", paragraphs: block(8, 10) },
      { id: "second", canonical: "body", paragraphs: block(8, 10) },
    ];

    expect(unheadedTrunk(sections)).toEqual({ sectionId: "first", sectionIndex: 0, paragraphCount: 8 });
    // …and a later row with more words beats the earlier one (when it holds half of all).
    expect(unheadedTrunk([{ id: "a", canonical: "body", paragraphs: block(8, 10) }, { id: "b", canonical: "body", paragraphs: block(9, 12) }])?.sectionId).toBe("b");
  });

  it("is null for no sections, for sections with no body row and for a body row that is half the words in two rows", () => {
    expect(unheadedTrunk([])).toBeNull();
    expect(unheadedTrunk([{ id: "m", canonical: "methods", paragraphs: block(20, 20) }])).toBeNull();
    // Six unplaced sub-headings among fifteen rows: no single one holds half.
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, canonical: "body", paragraphs: block(9, 20) }));
    expect(unheadedTrunk(many)).toBeNull();
  });

  it("reads none of the three repository documents as unheaded (they have headings)", () => {
    for (const name of ["arxiv-2609.02113.doc.json", "arxiv-2609.02697.doc.json", "zenodo-W7208807247.doc.json"]) {
      const doc = JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/papers/__fixtures__", name), "utf8")) as ExtractedDocument;
      const sections = readableSections(doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));

      expect(sections.length).toBeGreaterThan(2);
      expect(unheadedTrunk(sections), name).toBeNull();
    }
  });
});

describe("PART_ROLE — the five roles and the reading role each stands for (B §2.2)", () => {
  it("maps introduction to setup, experimental to method, results to evidence, discussion and conclusion to interpretation", () => {
    expect(PARTITION_ROLES).toEqual(["introduction", "results", "discussion", "conclusion", "experimental"]);
    expect(PART_ROLE).toEqual({ introduction: "setup", experimental: "method", results: "evidence", discussion: "interpretation", conclusion: "interpretation" });
  });
});

describe("sanitizePartition — every invariant is the sanitizer's (B §2.4)", () => {
  const trunk = { sectionId: "s0", paragraphCount: 30 };
  const ask = (partition: unknown, over: Partial<typeof trunk> = {}) => sanitizePartition({ partition }, { ...trunk, ...over });
  const part = (role: unknown, fromParagraph: unknown) => ({ role, fromParagraph });

  it("builds a four-part partition: the section's id, contiguous ranges derived from the starts, the last ending at the last paragraph", () => {
    const got = ask([part("introduction", 0), part("results", 6), part("discussion", 20), part("conclusion", 27)]);

    expect(got).toEqual({
      sectionId: "s0",
      parts: [
        { role: "introduction", fromParagraph: 0, toParagraph: 5 },
        { role: "results", fromParagraph: 6, toParagraph: 19 },
        { role: "discussion", fromParagraph: 20, toParagraph: 26 },
        { role: "conclusion", fromParagraph: 27, toParagraph: 29 },
      ],
    });
  });

  it("forces the first part to start at 0", () => {
    const got = ask([part("introduction", 3), part("results", 10)]);

    expect(got?.parts[0]).toEqual({ role: "introduction", fromParagraph: 0, toParagraph: 9 });
  });

  it("drops an entry out of range, negative, fractional, not a number or a string that is not digits", () => {
    const got = ask([part("introduction", 0), part("results", 30), part("results", -1), part("results", 4.5), part("results", "x4"), part("results", NaN), part("results", null), part("results", 5), part("conclusion", 29)]);

    expect(got?.parts.map((p) => [p.role, p.fromParagraph])).toEqual([
      ["introduction", 0],
      ["results", 5],
      ["conclusion", 29],
    ]);
  });

  it("accepts a start written as a string of digits", () => {
    const got = ask([part("introduction", "0"), part("results", "12")]);

    expect(got?.parts).toEqual([
      { role: "introduction", fromParagraph: 0, toParagraph: 11 },
      { role: "results", fromParagraph: 12, toParagraph: 29 },
    ]);
  });

  it("drops a descending start and a duplicate start: no reordering", () => {
    const got = ask([part("introduction", 0), part("results", 10), part("discussion", 4), part("conclusion", 10), part("conclusion", 20)]);

    expect(got?.parts.map((p) => [p.role, p.fromParagraph])).toEqual([
      ["introduction", 0],
      ["results", 10],
      ["conclusion", 20],
    ]);
  });

  it("merges neighbours of one role: the first start stands", () => {
    const got = ask([part("introduction", 0), part("results", 5), part("results", 9), part("discussion", 15)]);

    expect(got?.parts).toEqual([
      { role: "introduction", fromParagraph: 0, toParagraph: 4 },
      { role: "results", fromParagraph: 5, toParagraph: 14 },
      { role: "discussion", fromParagraph: 15, toParagraph: 29 },
    ]);
  });

  it("uses a role at most twice: the third use is dropped and its paragraphs fall to the part before it", () => {
    const got = ask([part("results", 0), part("experimental", 4), part("results", 8), part("experimental", 12), part("results", 16), part("conclusion", 22)]);

    expect(got?.parts.map((p) => [p.role, p.fromParagraph, p.toParagraph])).toEqual([
      ["results", 0, 3],
      ["experimental", 4, 7],
      ["results", 8, 11],
      ["experimental", 12, 21],
      ["conclusion", 22, 29],
    ]);
  });

  it("merges again after a third use is dropped, so no two neighbours share a role", () => {
    // results and discussion alternate three times: the third use of each is dropped, which can leave two neighbours of one role.
    const got = ask([part("results", 0), part("discussion", 5), part("results", 9), part("discussion", 12), part("results", 15), part("discussion", 18), part("conclusion", 25)]);
    const roles = got?.parts.map((p) => p.role) ?? [];

    for (let i = 1; i < roles.length; i += 1) expect(roles[i]).not.toBe(roles[i - 1]);
    for (const role of PARTITION_ROLES) expect(roles.filter((r) => r === role).length).toBeLessThanOrEqual(2);
  });

  it("reads method and methods as experimental, trims and lower-cases a role, and drops an unknown one", () => {
    const got = ask([part("  Introduction ", 0), part("METHODS", 5), part("method", 8), part("background", 12), part("Results", 15), part(7, 20), part({}, 22), part("conclusion", 25)]);

    expect(got?.parts.map((p) => [p.role, p.fromParagraph])).toEqual([
      ["introduction", 0],
      ["experimental", 5],
      ["results", 15],
      ["conclusion", 25],
    ]);
  });

  it("is null for fewer than two parts: one entry, one role repeated, nothing valid", () => {
    expect(ask([part("introduction", 0)])).toBeNull();
    expect(ask([part("introduction", 0), part("introduction", 9)])).toBeNull();
    expect(ask([part("nonsense", 0), part("nonsense", 9)])).toBeNull();
    expect(ask([])).toBeNull();
  });

  it("is null for an answer that is not the schema", () => {
    for (const raw of [null, undefined, 5, "text", [], {}, { partition: "nope" }, { partition: { 0: 1 } }, { gists: [] }]) {
      expect(sanitizePartition(raw, trunk)).toBeNull();
    }
  });

  it("skips an entry that is not an object, and an entry with no role or no start", () => {
    const got = ask([null, 5, "x", [], part(undefined, 3), { role: "results" }, part("introduction", 0), part("results", 10)]);

    expect(got?.parts.map((p) => p.role)).toEqual(["introduction", "results"]);
  });

  it("is null when the section has fewer than two paragraphs to divide", () => {
    expect(ask([part("introduction", 0), part("results", 1)], { paragraphCount: 1 })).toBeNull();
    expect(ask([part("introduction", 0), part("results", 1)], { paragraphCount: 2 })?.parts).toEqual([
      { role: "introduction", fromParagraph: 0, toParagraph: 0 },
      { role: "results", fromParagraph: 1, toParagraph: 1 },
    ]);
  });

  it("is harmless with __proto__ keys, in the answer, an entry or a role", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"partition":[{"__proto__":{"role":"results"},"role":"introduction","fromParagraph":0},{"role":"__proto__","fromParagraph":5},{"role":"constructor","fromParagraph":6},{"role":"results","fromParagraph":"__proto__"},{"role":"results","fromParagraph":8}]}') as unknown;
    const got = sanitizePartition(hostile, trunk);

    expect(got?.parts.map((p) => [p.role, p.fromParagraph])).toEqual([
      ["introduction", 0],
      ["results", 8],
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });

  it("adds nothing the answer did not name: no word of the paper, no field but the three", () => {
    const got = ask([{ role: "introduction", fromParagraph: 0, note: "SENTINEL", text: "SENTINEL" }, part("results", 9)]);

    expect(JSON.stringify(got)).not.toContain("SENTINEL");
    expect(Object.keys(got!.parts[0]).sort()).toEqual(["fromParagraph", "role", "toParagraph"]);
    expect(Object.keys(got!).sort()).toEqual(["parts", "sectionId"]);
  });

  describe("the invariants hold for any input (a property over seeded random answers)", () => {
    function rng(seed: number) {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const ROLES: unknown[] = [...PARTITION_ROLES, "method", "methods", " Results ", "RESULTS", "background", "", "__proto__", 3, null, undefined, {}, []];

    it("returns null or a partition that is contiguous, whole, in range, merged and at most twice per role", () => {
      const random = rng(20261014);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      let built = 0;
      for (let round = 0; round < 3000; round += 1) {
        const count = Math.floor(random() * 45);
        const entries = Array.from({ length: Math.floor(random() * 14) }, () => {
          const kind = random();
          const from: unknown =
            kind < 0.55 ? Math.floor(random() * (count + 4)) - 2 : kind < 0.7 ? String(Math.floor(random() * count)) : kind < 0.8 ? random() * count : pick([NaN, Infinity, -0, null, undefined, "", "1e3", "x", {}, []]);
          return random() < 0.05 ? pick([null, 3, "x"]) : { role: pick(ROLES), fromParagraph: from };
        });
        const got = sanitizePartition({ partition: entries }, { sectionId: "sx", paragraphCount: count });
        if (got === null) continue;
        built += 1;
        const { parts } = got;
        expect(got.sectionId).toBe("sx");
        expect(parts.length).toBeGreaterThanOrEqual(2);
        expect(parts[0].fromParagraph).toBe(0);
        expect(parts[parts.length - 1].toParagraph).toBe(count - 1);
        parts.forEach((p, i) => {
          expect(Number.isInteger(p.fromParagraph) && Number.isInteger(p.toParagraph)).toBe(true);
          expect(p.fromParagraph).toBeGreaterThanOrEqual(0);
          expect(p.toParagraph).toBeLessThan(count);
          expect(p.toParagraph).toBeGreaterThanOrEqual(p.fromParagraph);
          expect(PARTITION_ROLES).toContain(p.role);
          if (i > 0) {
            expect(p.fromParagraph).toBe(parts[i - 1].toParagraph + 1);
            expect(p.role).not.toBe(parts[i - 1].role);
          }
        });
        for (const role of PARTITION_ROLES) expect(parts.filter((p) => p.role === role).length).toBeLessThanOrEqual(2);
        // Sanitizing what was built, as the browser does, leaves it as it was.
        expect(restorePartition(JSON.parse(JSON.stringify(got)))).toEqual(got);
      }
      // The property is not vacuous: a good share of the random answers do yield a partition.
      expect(built).toBeGreaterThan(300);
    });
  });
});

describe("restorePartition — what the browser reads back from its store (B §2.6)", () => {
  const good: GuidePartition = {
    sectionId: "s0",
    parts: [
      { role: "introduction", fromParagraph: 0, toParagraph: 9 },
      { role: "results", fromParagraph: 10, toParagraph: 19 },
    ],
  };

  it("returns a good partition as it was kept", () => {
    expect(restorePartition(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("re-sanitizes a corrupt one: overlapping, out-of-order and unknown parts are repaired or dropped", () => {
    const corrupt = {
      sectionId: "s0",
      parts: [
        { role: "results", fromParagraph: 12, toParagraph: 3 },
        { role: "introduction", fromParagraph: 0, toParagraph: 99 },
        { role: "banana", fromParagraph: 5, toParagraph: 6 },
        { role: "discussion", fromParagraph: 15, toParagraph: 19 },
      ],
    };

    expect(restorePartition(corrupt)).toEqual({
      sectionId: "s0",
      parts: [
        { role: "results", fromParagraph: 0, toParagraph: 14 },
        { role: "discussion", fromParagraph: 15, toParagraph: 19 },
      ],
    });
  });

  it("is null for anything that is not a partition", () => {
    for (const raw of [null, undefined, 5, "x", [], {}, { sectionId: "s0" }, { sectionId: 4, parts: good.parts }, { sectionId: "", parts: good.parts }, { sectionId: "__proto__", parts: good.parts }, { sectionId: "s0", parts: "no" }, { sectionId: "s0", parts: [] }, { sectionId: "s0", parts: [{ role: "results", fromParagraph: 0 }] }]) {
      expect(restorePartition(raw)).toBeNull();
    }
  });
});

// ── P10-07b (B P10-05 §3.1, §4; review 3.3, second half; rubric A15) ──────────────────────────
//
// The overlay: the model's partition of an unheaded paper laid over the map in place of the trunk's
// row, and the route fold that gives a group row its mark from the paragraphs inside it. Both pure.
// The paper below is invented ("a survey of shore ecology"); no sentence of any paper.

const PAPER: Paper = {
  id: "upload:00000000000000bb", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

/** An unheaded paper: a 30-paragraph `body` trunk (the title is its heading) and a Methods section of 4. */
function unheadedReading(over: Record<number, string> = {}) {
  const doc: ExtractedDocument = {
    source: "pdf",
    pageCount: 6,
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "A survey of shore ecology", canonical: "body", page: 1, text: Array.from({ length: 30 }, (_, k) => over[k] ?? invented(k)).join("\n\n") },
      { id: "s1", heading: "Methods", canonical: "methods", page: 4, text: Array.from({ length: 4 }, (_, k) => invented(100 + k)).join("\n\n") },
    ],
  };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/shore.pdf", kind: "pdf", label: "doi", rank: 1 } };
  return buildReading(PAPER, fullText, new Date("2026-10-05T00:00:00.000Z"));
}

const FOUR: GuidePartition = {
  sectionId: "s0",
  parts: [
    { role: "introduction", fromParagraph: 0, toParagraph: 5 },
    { role: "results", fromParagraph: 6, toParagraph: 19 },
    { role: "discussion", fromParagraph: 20, toParagraph: 26 },
    { role: "conclusion", fromParagraph: 27, toParagraph: 29 },
  ],
};
const TWO: GuidePartition = {
  sectionId: "s0",
  parts: [
    { role: "introduction", fromParagraph: 0, toParagraph: 14 },
    { role: "results", fromParagraph: 15, toParagraph: 29 },
  ],
};

describe("partitionedMap — the trunk's row replaced in place by one row per part (B §3.1)", () => {
  const reading = unheadedReading();
  const map = reading.map!;
  const before = JSON.stringify(map);

  it("is the invented paper: an unheaded trunk of 30 paragraphs, then Methods", () => {
    expect(map.sections.map((row) => row.id)).toEqual(["s0", "s1"]);
    expect(unheadedTrunk(reading.body)).toMatchObject({ sectionId: "s0", sectionIndex: 0, paragraphCount: 30 });
  });

  it("returns the same map object for no partition", () => {
    expect(partitionedMap(map, reading.body, null)).toBe(map);
    expect(partitionedMap(map, reading.body, undefined)).toBe(map);
  });

  it("returns the same map object for a partition whose section is not in the map", () => {
    expect(partitionedMap(map, reading.body, { ...FOUR, sectionId: "s9" })).toBe(map);
  });

  it("returns the same map object for a partition that does not cover the section (a stale one), or one the body does not bear out", () => {
    expect(partitionedMap(map, reading.body, { sectionId: "s0", parts: FOUR.parts.slice(0, 3) })).toBe(map);
    expect(partitionedMap(map, reading.body, { sectionId: "s0", parts: [FOUR.parts[0]] })).toBe(map);
    // The trunk is a short section the rule does not read as unheaded: the model is never asked, so a stored answer is not drawn.
    expect(partitionedMap(map, reading.body, { sectionId: "s1", parts: [{ role: "experimental", fromParagraph: 0, toParagraph: 1 }, { role: "results", fromParagraph: 2, toParagraph: 3 }] })).toBe(map);
    // No body to count the words from.
    expect(partitionedMap(map, undefined, FOUR)).toBe(map);
    expect(partitionedMap(map, [], FOUR)).toBe(map);
  });

  it("replaces the trunk by one row per part, in the same place, the rows after it in their order", () => {
    const got = partitionedMap(map, reading.body, FOUR);

    expect(got.sections.map((row) => row.id)).toEqual(["s0~0", "s0~1", "s0~2", "s0~3", "s1"]);
    expect(got.sections.map((row) => row.heading)).toEqual([MAP.parts.labels.introduction, MAP.parts.labels.results, MAP.parts.labels.discussion, MAP.parts.labels.conclusion, "Methods"]);
    expect(got.sections.map((row) => row.canonical)).toEqual(["introduction", "results", "discussion", "conclusion", "methods"]);
    expect(got.sections.map((row) => row.role)).toEqual(["setup", "evidence", "interpretation", "interpretation", "method"]);
    // The paper's own row after the trunk is the very object it was.
    expect(got.sections[4]).toBe(map.sections[1]);
  });

  it("gives each group the level 1, no parent, no page and a part record", () => {
    const got = partitionedMap(map, reading.body, FOUR);

    got.sections.slice(0, 4).forEach((row, n) => {
      expect(row.level).toBe(1);
      expect(row).not.toHaveProperty("parentId");
      expect(row).not.toHaveProperty("page");
      expect(partOf(row)).toEqual({ sectionId: "s0", sectionIndex: 0, role: FOUR.parts[n].role, from: FOUR.parts[n].fromParagraph, to: FOUR.parts[n].toParagraph });
    });
    expect(partOf(got.sections[4])).toBeUndefined();
  });

  it("keeps the trunk's lines for the range, with their real indices and openings", () => {
    const got = partitionedMap(map, reading.body, FOUR);

    FOUR.parts.forEach((part, n) => {
      expect(got.sections[n].paragraphs).toEqual(map.sections[0].paragraphs.slice(part.fromParagraph, part.toParagraph + 1));
    });
    expect(got.sections[1].paragraphs[0].index).toBe(6);
    expect(got.sections[1].paragraphs[0].opening).toBe(map.sections[0].paragraphs[6].opening);
    expect(got.sections[3].paragraphs.map((line) => line.index)).toEqual([27, 28, 29]);
  });

  it("recomputes each group's words and minutes from its paragraphs; the groups add up to the trunk", () => {
    const got = partitionedMap(map, reading.body, FOUR);

    FOUR.parts.forEach((part, n) => {
      const text = reading.body[0].paragraphs.slice(part.fromParagraph, part.toParagraph + 1);
      expect(got.sections[n].words).toBe(wordsOf(text));
      expect(got.sections[n].minutes).toBe(Math.max(1, Math.ceil(wordsOf(text) / 180)));
    });
    expect(got.sections.slice(0, 4).reduce((sum, row) => sum + row.words, 0)).toBe(map.sections[0].words);
  });

  it("leaves the totals unchanged: the words over all the rows, and the map's minutes", () => {
    const got = partitionedMap(map, reading.body, FOUR);

    expect(got.sections.reduce((sum, row) => sum + row.words, 0)).toBe(map.sections.reduce((sum, row) => sum + row.words, 0));
    expect(got.totalMinutes).toBe(map.totalMinutes);
  });

  it("changes nothing it is given, and is the same answer twice", () => {
    const got = partitionedMap(map, reading.body, TWO);

    expect(JSON.stringify(map)).toBe(before);
    expect(got.sections.map((row) => row.id)).toEqual(["s0~0", "s0~1", "s1"]);
    expect(partitionedMap(map, reading.body, TWO)).toEqual(got);
  });

  it("is a headed paper's map as it was, whatever a store holds: the partition of a section the rule does not read as unheaded is not drawn", () => {
    const doc = JSON.parse(readFileSync(resolve(process.cwd(), "src/lib/papers/__fixtures__/arxiv-2609.02113.doc.json"), "utf8")) as ExtractedDocument;
    const headed = buildReading(PAPER, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/h.pdf", kind: "pdf", label: "doi", rank: 1 } }, new Date("2026-10-05T00:00:00.000Z"));
    const rows = headed.map!.sections;
    const longest = rows.reduce((best, row) => (row.paragraphs.length > best.paragraphs.length ? row : best));
    const last = longest.paragraphs.length - 1;
    const stale: GuidePartition = { sectionId: longest.id, parts: [{ role: "introduction", fromParagraph: 0, toParagraph: 1 }, { role: "results", fromParagraph: 2, toParagraph: last }] };

    expect(last).toBeGreaterThan(2);
    expect(partitionedMap(headed.map!, headed.body, stale)).toBe(headed.map);
    expect(partitionedMap(headed.map!, headed.body, undefined)).toBe(headed.map);
  });
});

describe("withPartitionMarks — a group's mark from the paragraphs inside it (B §4)", () => {
  // Paragraph 3 says one of the question's terms; paragraph 12 says both, twice. The question: "quillwort lattice".
  const QUESTION = "How does the quillwort lattice crack?";
  const reading = unheadedReading({
    3: "Invented paragraph 3 about the quillwort. A single note names it once and moves on.",
    12: "The quillwort lattice shows cracks. The quillwort lattice was measured twice on the sand ripples.",
  });
  const map = reading.map!;
  const route = routeByQuestions(map, reading.body, [QUESTION]);
  const folded = withPartitionMarks(route, map, reading.body, FOUR)!;
  const ids = (entry: RouteResult["byQuestion"][number]) => Object.keys(entry.sections);

  it("has Tier 0's own route to fold: the trunk is strong, its paragraph 12 the top one", () => {
    const trunk = route.byQuestion[0].sections.s0;

    expect(trunk.tier).toBe("strong");
    expect(trunk.paragraphs).toEqual([3, 12]);
    expect(trunk.topParagraphs).toEqual([12]);
  });

  it("leaves the real trunk's mark as it was (the body reads it) and adds the group keys beside the real ids", () => {
    expect(folded.byQuestion[0].sections.s0).toBe(route.byQuestion[0].sections.s0);
    expect(folded.byQuestion[0].sections.s1).toBe(route.byQuestion[0].sections.s1);
    expect(ids(folded.byQuestion[0])).toEqual(["s0", "s1", "s0~0", "s0~1", "s0~2", "s0~3"]);
  });

  it("marks the group that holds the top paragraph with the trunk's tier, a group that only mentions faint, and the others none", () => {
    const sections = folded.byQuestion[0].sections;

    expect(sections["s0~1"].tier).toBe("strong");
    expect(sections["s0~1"].paragraphs).toEqual([12]);
    expect(sections["s0~1"].topParagraphs).toEqual([12]);
    expect(sections["s0~0"].tier).toBe("faint");
    expect(sections["s0~0"].paragraphs).toEqual([3]);
    expect(sections["s0~0"].topParagraphs).toEqual([]);
    expect(sections["s0~2"].tier).toBe("none");
    expect(sections["s0~3"].tier).toBe("none");
    expect(sections["s0~3"].paragraphs).toEqual([]);
  });

  it("counts the question's terms over the group's own paragraphs, and the evidence is one of their sentences, verbatim", () => {
    const sections = folded.byQuestion[0].sections;

    expect(sections["s0~1"].hits).toEqual([{ term: "quillwort", count: 2 }, { term: "lattice", count: 2 }]);
    expect(sections["s0~0"].hits).toEqual([{ term: "quillwort", count: 1 }]);
    expect(sections["s0~2"].hits).toEqual([]);
    const evidence = sections["s0~1"].evidence!;
    expect(reading.body[0].paragraphs.slice(6, 20).some((paragraph) => paragraph.includes(evidence))).toBe(true);
    const introEvidence = sections["s0~0"].evidence!;
    expect(reading.body[0].paragraphs.slice(0, 6).some((paragraph) => paragraph.includes(introEvidence))).toBe(true);
    expect(sections["s0~2"]).not.toHaveProperty("evidence");
  });

  it("returns the same route object for no route, no partition, a partition that does not apply and a route with nothing to fold", () => {
    expect(withPartitionMarks(undefined, map, reading.body, FOUR)).toBeUndefined();
    expect(withPartitionMarks(route, map, reading.body, null)).toBe(route);
    expect(withPartitionMarks(route, map, reading.body, undefined)).toBe(route);
    expect(withPartitionMarks(route, map, reading.body, { ...FOUR, sectionId: "s9" })).toBe(route);
  });

  it("leaves a vague question as it was, and changes nothing it is given", () => {
    const mixed = routeByQuestions(map, reading.body, ["What is it?", QUESTION]);
    const frozen = JSON.stringify(mixed);
    const got = withPartitionMarks(mixed, map, reading.body, FOUR)!;

    expect(JSON.stringify(mixed)).toBe(frozen);
    expect(got.byQuestion[0]).toBe(mixed.byQuestion[0]);
    expect(got.byQuestion[1].sections["s0~1"].tier).toBe("strong");
    expect(got.vague).toBe(mixed.vague);
  });

  it("allows strong on at most max(1, floor(N / 2)) groups, the earlier first (the top paragraphs of one section can only tie); the rest are medium", () => {
    // One identical paragraph in each of the four groups: a tie that makes all four hold a top paragraph.
    const same = "The quillwort lattice shows cracks. The quillwort lattice was measured on the sand ripples.";
    const tied = unheadedReading({ 2: same, 10: same, 22: same, 28: same });
    const tiedRoute = routeByQuestions(tied.map!, tied.body, [QUESTION]);
    expect(tiedRoute.byQuestion[0].sections.s0.topParagraphs).toEqual([2, 10, 22, 28]);

    const four = withPartitionMarks(tiedRoute, tied.map!, tied.body, FOUR)!.byQuestion[0].sections;
    expect(["s0~0", "s0~1", "s0~2", "s0~3"].map((id) => four[id].tier)).toEqual(["strong", "strong", "medium", "medium"]);

    const two = withPartitionMarks(tiedRoute, tied.map!, tied.body, { sectionId: "s0", parts: [{ role: "introduction", fromParagraph: 0, toParagraph: 14 }, { role: "results", fromParagraph: 15, toParagraph: 29 }] })!.byQuestion[0].sections;
    expect(["s0~0", "s0~1"].map((id) => two[id].tier)).toEqual(["strong", "medium"]);
    // The trunk's own mark is not the cap's business.
    expect(four.s0.tier).toBe("strong");
  });

  it("takes the gist question's tier from each group's role, with no counts", () => {
    const gist = gistRoute(map);
    const got = withPartitionMarks(gist, map, reading.body, FOUR)!.byQuestion[0];

    expect(got.question).toBe(GIST_QUESTION);
    expect(got.sections["s0~0"]).toEqual({ tier: "faint", hits: [], paragraphs: [] });
    expect(got.sections["s0~1"].tier).toBe("strong");
    expect(got.sections["s0~2"].tier).toBe("strong");
    expect(got.sections["s0~3"].tier).toBe("strong");
    expect(got.sections.s0).toBe(gist.byQuestion[0].sections.s0);
  });

  it("reads the trunk's mark across a model's overlay as the body does: a background trunk gives every group with a mentioning paragraph the background tint", () => {
    const display = {
      byQuestion: [
        {
          question: QUESTION,
          vague: false,
          sections: { ...route.byQuestion[0].sections, s0: { ...route.byQuestion[0].sections.s0, tier: "background" as const } },
        },
      ],
      vague: false,
    };
    const got = withPartitionMarks(display, map, reading.body, FOUR)!.byQuestion[0].sections;

    expect(got["s0~0"].tier).toBe("background");
    expect(got["s0~1"].tier).toBe("background");
    expect(got["s0~2"].tier).toBe("none");
  });

  it("gives no group a mark when the trunk has none for the question", () => {
    const silent = routeByQuestions(map, reading.body, ["Does cobalt oxide crumble?"]);
    const got = withPartitionMarks(silent, map, reading.body, FOUR)!.byQuestion[0].sections;

    expect(["s0~0", "s0~1", "s0~2", "s0~3"].map((id) => got[id].tier)).toEqual(["none", "none", "none", "none"]);
  });
});
