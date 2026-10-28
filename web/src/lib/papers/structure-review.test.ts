import { describe, expect, it } from "vitest";
import { FIVE_PARTS, inventedPaper, modelDouble, partsOfRoles, type InventedRow } from "@/test-support/structure-fixtures";
import {
  applyCorrections,
  buildLookPrompt,
  buildReviewPrompt,
  buildSkeleton,
  countsText,
  draftOf,
  lookParagraphs,
  lookWindow,
  paragraphFeatures,
  parseLookVerdict,
  partsOf,
  resolveLooks,
  REVIEW_CAPS,
  reviewedParts,
  reviewPromptFixedText,
  reviewStructure,
  sanitizeReview,
  secondLookTargets,
  sound,
  structureDraftOf,
  structureInputOf,
  type Answer,
  type DraftPart,
  type ReviewRole,
  type StructureInput,
} from "./structure-review";

// P12-53 (B P12-42; ruling §1h.424 (b), §1h.428): the pure core of the model's review of the rules' structure —
// the paragraph's counts, the rules' draft, the skeleton and its grammar, the prompt, the sanitizer and the
// applier, the second look. Every paper below is invented ("Invented setup paragraph 3 about tide pools"), and
// the only "model" is a test double that reads the prompt it is given (`test-support/structure-fixtures.ts`).

const FIVE = inventedPaper(FIVE_PARTS);

function part(from: number, to: number, role: ReviewRole, conf: DraftPart["conf"] = "high"): DraftPart {
  return { from, to, role, conf, tags: [] };
}

describe("paragraphFeatures — the counts the skeleton shows", () => {
  it("counts figure references, table references, citations, numbers with units, procedural verbs and signposts", () => {
    expect(paragraphFeatures("See Fig. 2, Figure 3a and Figs. S4 for the rise.")).toMatchObject({ F: 3, T: 0 });
    expect(paragraphFeatures("Table 1 lists the runs; Table S2 repeats them.")).toMatchObject({ T: 2, F: 0 });
    expect(paragraphFeatures("As noted earlier [1, 2] and in (Smith et al., 2019) and (Lee, 2020; Kim, 2021).").C).toBe(3);
    expect(paragraphFeatures("Heated at 120 °C for 2 h in 5 mL, a rise of 14 % and 3.5 GPa.").N).toBe(5);
    expect(paragraphFeatures("The plates were heated and then were then placed in water, and a probe was mounted.").V).toBe(3);
    expect(paragraphFeatures("We show that this work extends our study of tides; we find a rise.").W).toBe(4);
  });

  it("counts nothing in a paragraph that holds none, and does not take a bare number for a number with a unit", () => {
    expect(paragraphFeatures("A plain sentence about the shore with 12 gulls and no reference at all.")).toEqual({ F: 0, T: 0, C: 0, N: 0, V: 0, W: 0 });
  });

  it("prints the counts as F T C N V W, in that order, with zeros left out", () => {
    expect(countsText({ F: 2, T: 0, C: 3, N: 4, V: 0, W: 1 })).toBe("F2 C3 N4 W1");
    expect(countsText({ F: 0, T: 0, C: 0, N: 0, V: 0, W: 0 })).toBe("");
  });
});

describe("draftOf — the rules' draft from the map's top-level rows", () => {
  it("makes one part per top-level run, the role and confidence from the heading, the tags from rule names and counts", () => {
    const draft = draftOf(FIVE.input)!;

    expect(draft.paragraphs).toBe(29);
    expect(draft.parts.map(({ from, to, role, conf }) => ({ from, to, role, conf }))).toEqual([
      { from: 0, to: 5, role: "setup", conf: "high" },
      { from: 6, to: 8, role: "method", conf: "high" },
      { from: 9, to: 17, role: "evidence", conf: "high" },
      { from: 18, to: 21, role: "method", conf: "high" },
      { from: 22, to: 25, role: "interpretation", conf: "high" },
      { from: 26, to: 28, role: "apparatus", conf: "high" },
    ]);
    expect(draft.lines[0]).toBe("0 0-5 setup high heading:introduction,rows:1,paras:6");
    expect(draft.lines[5]).toBe("5 26-28 apparatus high heading:references,rows:1,paras:3");
  });

  it("puts the sub-rows under their top-level row, and a heading that numbers its children is a part of theirs", () => {
    const paper = inventedPaper([
      { heading: "1. Introduction", canonical: "introduction", truth: [["setup", 2]] },
      { heading: "2. Methods", canonical: "methods", truth: [["method", 1]] },
      { heading: "2.1 Samples", canonical: "body", truth: [["method", 2]] },
      { heading: "2.2 Probes", canonical: "body", truth: [["method", 2]] },
      { heading: "3. EXPERIMENTAL SECTION", canonical: "methods", truth: [] },
      { heading: "3.1 Materials", canonical: "body", truth: [["method", 3]] },
      { heading: "4. Results", canonical: "results", truth: [["evidence", 2]] },
    ]);
    const draft = draftOf(paper.input)!;

    expect(draft.parts.map(({ from, to, role }) => [from, to, role])).toEqual([
      [0, 1, "setup"],
      [2, 9, "method"],
      [10, 11, "evidence"],
    ]);
    // Neighbours of one role are one part: Methods and the experimental section are one run of five rows.
    expect(draft.parts[1].tags).toEqual(["heading:methods", "rows:2", "paras:8"]);
  });

  // Re-aimed (§1h.442): C P12-48's role rules (`reading-roles.ts`) now give an unnamed row an inferred role wherever the paper has an
  // introduction to stand on, so the fixture that used to leave a row `body` (an unnamed row between an introduction and the
  // references) is apparatus by A2. What is still left `body` is a row in a paper with no introduction at all; this case keeps its
  // claim (a row nothing places takes the role before it, `medium`, tagged `inherited`, and the part gets the lowest confidence of its
  // rows) on such a paper. The inferred cases have tests of their own below.
  it("gives an unplaced heading the role before it, `medium` and tagged `inherited`, and the part the lowest confidence of its rows", () => {
    const paper = inventedPaper([
      { heading: "1 Results", canonical: "results", truth: [["evidence", 3]] },
      { heading: "Gas sensing performance", canonical: "body", truth: [["evidence", 2]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 1]] },
    ]);
    const draft = draftOf(paper.input)!;

    expect(paper.map.sections[1].role).toBe("body");
    expect(draft.parts.map(({ from, to, role, conf }) => [from, to, role, conf])).toEqual([
      [0, 4, "evidence", "medium"],
      [5, 5, "apparatus", "high"],
    ]);
    expect(draft.parts[0].tags).toEqual(["heading:results", "inherited", "rows:2", "paras:5"]);
  });

  it("reads a role the Tier-0 role rules worked out as `medium`, tagged `inferred`: the rows between the introduction and the first named later part", () => {
    const paper = inventedPaper([
      { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 2]] },
      { heading: "Snail density rises with wave exposure", canonical: "body", truth: [["evidence", 3]] },
      { heading: "Shell thickness follows crab predation", canonical: "body", truth: [["evidence", 2]] },
      { heading: "2 Methods", canonical: "methods", truth: [["method", 2]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 1]] },
    ]);
    const draft = draftOf(paper.input)!;

    expect(paper.input.sections.map((section) => section.inferred ?? false)).toEqual([false, true, true, false, false]);
    expect(draft.parts.map(({ from, to, role, conf }) => [from, to, role, conf])).toEqual([
      [0, 1, "setup", "high"],
      [2, 6, "evidence", "medium"],
      [7, 8, "method", "high"],
      [9, 9, "apparatus", "high"],
    ]);
    expect(draft.parts[1].tags).toEqual(["inferred", "rows:2", "paras:5"]);
    expect(draft.lines[1]).toBe("1 2-6 evidence medium inferred,rows:2,paras:5");
  });

  it("reads the front text A1 made the introduction, an unnamed row before the references and the rows after them as `inferred`", () => {
    const paper = inventedPaper([
      { heading: "Body", canonical: "body", truth: [["setup", 3]] },
      { heading: "1 Results", canonical: "results", truth: [["evidence", 3]] },
      { heading: "Online content", canonical: "body", truth: [["apparatus", 1]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
      { heading: "Author contributions", canonical: "body", truth: [["apparatus", 1]] },
    ]);
    const draft = draftOf(paper.input)!;

    // The map's own first row is renamed by A1, the body's bucket is the extractor's: that is how the two are told apart.
    expect(paper.map.sections[0]).toMatchObject({ heading: "Introduction", canonical: "introduction", role: "setup" });
    expect(paper.input.sections.map((section) => section.inferred ?? false)).toEqual([true, false, true, false, true]);
    expect(draft.parts.map(({ from, to, role, conf }) => [from, to, role, conf])).toEqual([
      [0, 2, "setup", "medium"],
      [3, 5, "evidence", "high"],
      [6, 9, "apparatus", "medium"],
    ]);
    expect(draft.parts[0].tags).toEqual(["inferred", "rows:1", "paras:3"]);
    expect(draft.parts[2].tags).toEqual(["inferred", "heading:references", "rows:3", "paras:4"]);
  });

  it("does not take a heading that names its role for an inferred one, and an introduction headed `Introduction` is named", () => {
    const paper = inventedPaper([
      { heading: "Introduction", canonical: "introduction", truth: [["setup", 2]] },
      { heading: "Results", canonical: "results", truth: [["evidence", 2]] },
    ]);

    expect(paper.input.sections.map((section) => section.inferred ?? false)).toEqual([false, false]);
    expect(draftOf(paper.input)!.parts.map((p) => p.conf)).toEqual(["high", "high"]);
  });

  describe("the closing split of rule set B", () => {
    const ABSTRACT = "Mussel populations decline sharply under persistent warming, according to the survey.";
    const CLOSING = "In summary, mussel populations decline sharply under persistent warming across the survey.";
    const rows: InventedRow[] = [
      { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 3]] },
      { heading: "3 Results", canonical: "results", truth: [["evidence", 5]] },
      { heading: "4 Methods", canonical: "methods", truth: [["method", 2]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
    ];
    // Results holds ordinals 3-7; the closing paragraph is the last (7).
    const paper = inventedPaper(rows, { abstract: ABSTRACT, paragraphs: { 7: CLOSING } });

    it("makes the closing its own part, `interpretation`, `low`, tagged `closing`; what is above it keeps its role and its confidence", () => {
      const draft = draftOf(paper.input)!;

      expect(paper.input.closing).toEqual({ from: 7, to: 7 });
      expect(draft.parts.map(({ from, to, role, conf }) => [from, to, role, conf])).toEqual([
        [0, 2, "setup", "high"],
        [3, 6, "evidence", "high"],
        [7, 7, "interpretation", "low"],
        [8, 9, "method", "high"],
        [10, 11, "apparatus", "high"],
      ]);
      expect(draft.lines[2]).toBe("2 7-7 interpretation low closing,rows:1,paras:1");
    });

    it("draws no look for a correction against it: the rules said they were unsure", () => {
      const draft = draftOf(paper.input)!;

      expect(secondLookTargets(draft.parts, { corrections: [{ op: "set_role", part: 2, role: "evidence" }], unsure: [] })).toEqual([]);
      expect(secondLookTargets(draft.parts, { corrections: [{ op: "set_role", part: 1, role: "method" }], unsure: [] })).toHaveLength(1);
    });

    it("is no part when the abstract is not echoed, when there is none, or when the paper names its own conclusion", () => {
      const other = inventedPaper(rows, { abstract: "Granite quarries expand slowly through seasonal erosion.", paragraphs: { 7: CLOSING } });
      const named = inventedPaper(
        [rows[0], rows[1], { heading: "5 Conclusions", canonical: "conclusion", truth: [["interpretation", 2]] }, rows[2], rows[3]],
        { abstract: ABSTRACT, paragraphs: { 7: CLOSING } },
      );

      expect(other.input.closing).toBeUndefined();
      expect(draftOf(other.input)!.parts.map((p) => p.role)).toEqual(["setup", "evidence", "method", "apparatus"]);
      expect(named.input.closing).toBeUndefined();
    });

    it("divides the run it lies in into three when more of the run follows the closing, and each piece keeps what it was", () => {
      const tail: StructureInput = { ...paper.input, closing: { from: 5, to: 6 } };
      const parts = draftOf(tail)!.parts.map(({ from, to, role, conf }) => [from, to, role, conf]);

      // Results is 3-7: before the closing (3-4) and after it (7) keep the row's role and confidence; the closing is `low`.
      expect(parts.slice(1, 4)).toEqual([[3, 4, "evidence", "high"], [5, 6, "interpretation", "low"], [7, 7, "evidence", "high"]]);
    });

    it("is the same draft whether the abstract is the record's (paragraphs joined by blank lines) or the reading's (sentences joined by a space)", () => {
      const server = structureDraftOf(paper.map, paper.body, "Mussel populations decline sharply under persistent warming,\n\naccording to the survey.");
      const browser = structureDraftOf(paper.map, paper.body, "Mussel populations decline sharply under persistent warming, according to the survey.");

      expect(server!.digest).toBe(browser!.digest);
      expect(server!.parts).toHaveLength(5);
      expect(structureDraftOf(paper.map, paper.body)!.digest).not.toBe(browser!.digest);
    });
  });

  it("reads an unplaced beginning as `setup` with `low` confidence, tagged `default`: nothing places it", () => {
    const paper = inventedPaper([
      { heading: "A Survey of Shore Ecology", canonical: "body", truth: [["setup", 3], ["evidence", 3]] },
      { heading: "Methods", canonical: "methods", truth: [["method", 2]] },
    ]);
    const draft = draftOf(paper.input)!;

    expect(draft.parts[0]).toMatchObject({ from: 0, to: 5, role: "setup", conf: "low", tags: ["default", "rows:1", "paras:6"] });
    expect(draft.parts[1]).toMatchObject({ role: "method", conf: "high" });
  });

  it("leaves a row with no paragraph out of the parts, and a paper with no paragraph has no draft", () => {
    const input: StructureInput = {
      sections: [
        { id: "a", heading: "1 Intro", canonical: "introduction", role: "setup", level: 1, first: 0, count: 2 },
        { id: "b", heading: "Methods", canonical: "methods", role: "method", level: 1, first: 2, count: 0 },
        { id: "c", heading: "References", canonical: "references", role: "apparatus", level: 1, first: 2, count: 1 },
      ],
      texts: ["x", "y", "z"],
      paragraphs: 3,
      figures: [],
    };

    expect(draftOf(input)!.parts.map(({ from, to, role }) => [from, to, role])).toEqual([
      [0, 1, "setup"],
      [2, 2, "apparatus"],
    ]);
    expect(draftOf({ ...input, texts: [], paragraphs: 0 })).toBeNull();
  });

  it("carries rule names and counts in its tags and nothing of the paper", () => {
    const draft = draftOf(FIVE.input)!;
    for (const part of draft.parts) for (const tag of part.tags) expect(tag).toMatch(/^(heading:[a-z_]+|inferred|inherited|default|closing|rows:\d+|paras:\d+)$/);
    // A canonical that is not a bucket name is never copied into a tag.
    const odd = structureInputOf(
      { sections: [{ ...FIVE.map.sections[0], canonical: "Tide Pools & Kelp" }], totalMinutes: 1 },
      // Re-aimed (§1h.442): the draft reads the extractor's bucket from the body to tell a named role from an inferred one, so the
      // body says `introduction` here and only the map row carries the odd canonical this test is about.
      [{ id: FIVE.map.sections[0].id, canonical: "introduction", paragraphs: FIVE.doc.sections[0].text.split("\n\n") }],
    )!;
    expect(draftOf(odd)!.parts[0].tags[0]).toBe("heading:named");
  });

  it("has a digest that moves with the draft and with nothing else", () => {
    const again = draftOf(inventedPaper(FIVE_PARTS).input)!;
    const otherRole = draftOf(inventedPaper(FIVE_PARTS.map((row, k) => (k === 3 ? { ...row, canonical: "results" } : row))).input)!;

    expect(again.digest).toBe(draftOf(FIVE.input)!.digest);
    expect(otherRole.digest).not.toBe(again.digest);
    expect(again.digest).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe("buildSkeleton — the grammar, and the budget", () => {
  const TINY: InventedRow[] = [
    { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 2]] },
    { heading: 'A very long heading with "quotes" that goes on well past the sixty characters a skeleton keeps', canonical: "methods", truth: [["method", 1]] },
  ];
  const tiny = inventedPaper(TINY, { figures: 1 });

  it("writes a header per section, a line per paragraph with its counts and its first sixteen words, and a line per caption", () => {
    const skeleton = buildSkeleton(tiny.input, draftOf(tiny.input)!)!;

    expect(skeleton.mode).toBe("A");
    expect(skeleton.lines).toEqual([
      '## s1 L1 p1 introduction "1 Introduction" 0-1',
      "0 C2 | Invented setup paragraph 0 about tide pools. Earlier surveys of the tide pools were reported in…",
      "1 C2 | Invented setup paragraph 1 about kelp beds. Earlier surveys of the kelp beds were reported in…",
      "## s2 L1 p1 methods \"A very long heading with 'quotes' that goes on well past th…\" 2-2",
      "2 N3 V2 | Invented method paragraph 2 about gull colonies. The samples were heated at 120 °C for 2…",
      "fig Figure 1 p2 | Invented caption 1 about the tide pools and…",
    ]);
  });

  it("cuts a heading to sixty characters and a head to sixteen words, each with one …, and leaves a short one whole", () => {
    const lines = buildSkeleton(tiny.input, draftOf(tiny.input)!)!.lines;
    const header = lines.find((line) => line.startsWith("## s2"))!;

    expect(/"(.*)"/.exec(header)![1].length).toBeLessThanOrEqual(REVIEW_CAPS.headingChars);
    expect(header).toContain("…");
    const short = inventedPaper([{ heading: "1 A", canonical: "introduction", truth: [["setup", 1]] }]);
    const input: StructureInput = { ...short.input, texts: ["Only five short words here."] };
    expect(buildSkeleton(input, draftOf(input)!)!.lines[1]).toBe("0 | Only five short words here.");
  });

  it("is a function of the paper and its draft alone", () => {
    const a = buildSkeleton(FIVE.input, draftOf(FIVE.input)!)!;
    const b = buildSkeleton(inventedPaper(FIVE_PARTS).input, draftOf(inventedPaper(FIVE_PARTS).input)!)!;

    expect(a.lines).toEqual(b.lines);
    expect(a.chars).toBe(a.lines.join("\n").length);
    expect(a.tokens).toBe(Math.ceil(a.chars / 4));
  });

  it("uses mode B above the budget — heads only where the rules are unsure and at the ends of a part — with counts everywhere", () => {
    const draft = draftOf(FIVE.input)!;
    const full = buildSkeleton(FIVE.input, draft)!;
    const smaller = buildSkeleton(FIVE.input, draft, full.chars - 1)!;

    expect(smaller.mode).toBe("B");
    expect(smaller.chars).toBeLessThan(full.chars);
    const line = (n: number) => smaller.lines.find((l) => l.startsWith(`${n} `) || l === String(n))!;
    // Part 2 runs 9-17: its first two and its last paragraph keep their heads; an interior one has counts alone.
    expect(line(9)).toContain(" | ");
    expect(line(10)).toContain(" | ");
    expect(line(17)).toContain(" | ");
    expect(line(13)).toBe("13 F1 T1 N2");
  });

  it("keeps every paragraph of a part the rules are unsure of, and the first paragraph of each section, in mode B", () => {
    const unsure = inventedPaper([
      { heading: "A Survey of Shore Ecology", canonical: "body", truth: [["setup", 8]] },
      { heading: "Methods", canonical: "methods", truth: [["method", 8]] },
    ]);
    const draft = draftOf(unsure.input)!;
    const b = buildSkeleton(unsure.input, draft, buildSkeleton(unsure.input, draft)!.chars - 1)!;

    expect(b.mode).toBe("B");
    for (let i = 0; i < 8; i += 1) expect(b.lines.find((l) => l.startsWith(`${i} `))).toContain(" | ");
    expect(b.lines.find((l) => l.startsWith("12 "))).not.toContain(" | ");
  });

  it("falls to eight-word heads without caption lines, and then to none: the draft stands", () => {
    const withFigures = inventedPaper(FIVE_PARTS, { figures: 3 });
    const draft = draftOf(withFigures.input)!;
    const b = buildSkeleton(withFigures.input, draft, 1_000_000)!;
    const modeB = buildSkeleton(withFigures.input, draft, b.chars - 1)!;
    const modeB8 = buildSkeleton(withFigures.input, draft, modeB.chars - 1)!;

    expect(b.lines.some((l) => l.startsWith("fig "))).toBe(true);
    expect(modeB8.mode).toBe("B8");
    expect(modeB8.lines.some((l) => l.startsWith("fig "))).toBe(false);
    expect(modeB8.chars).toBeLessThan(modeB.chars);
    expect(buildSkeleton(withFigures.input, draft, modeB8.chars - 1)).toBeNull();
  });

  it("is smaller than the whole text by a wide margin on a paper of 120 paragraphs", () => {
    const rows: InventedRow[] = [];
    const roles: ReviewRole[] = ["setup", "method", "evidence", "evidence", "evidence", "interpretation", "apparatus"];
    roles.forEach((role, k) => rows.push({ heading: `${k + 1} Row ${k}`, canonical: ["introduction", "methods", "results", "results", "results", "discussion", "references"][k], truth: [[role, k === 6 ? 12 : 18]] }));
    const paper = inventedPaper(rows);
    // Paragraphs of a realistic length: about 900 characters each.
    const padded: StructureInput = { ...paper.input, texts: paper.input.texts.map((t, i) => `${t} ${"Further invented detail about the shore and its counts, sentence number x. ".repeat(10).replace(/x/g, String(i))}`) };
    const draft = draftOf(padded)!;
    const skeleton = buildSkeleton(padded, draft)!;
    const prompt = buildReviewPrompt({ skeleton, draft });
    const whole = padded.texts.join("\n\n").length;
    const promptChars = prompt.systemPrompt.length + prompt.userPrompt.length;

    expect(padded.paragraphs).toBe(120);
    expect(whole).toBeGreaterThan(90_000);
    expect(skeleton.chars).toBeLessThan(whole / 5);
    // The review prompt, fixed text included, against the whole text plus the same fixed text and draft.
    expect(promptChars).toBeLessThan((whole + reviewPromptFixedText().length + draft.lines.join("\n").length) / 4);
    expect(skeleton.tokens).toBe(Math.ceil(skeleton.chars / 4));
  });
});

describe("buildReviewPrompt — the fixed text, the skeleton, the draft; no title, nothing of the reader", () => {
  const draft = draftOf(FIVE.input)!;
  const skeleton = buildSkeleton(FIVE.input, draft)!;
  const prompt = buildReviewPrompt({ skeleton, draft, pages: FIVE.doc.pageCount });
  const user = JSON.parse(prompt.userPrompt) as Record<string, unknown>;

  it("carries the skeleton and the draft as arrays of lines, the five roles, the schema and the rules", () => {
    expect(user.skeleton).toEqual(skeleton.lines);
    expect(user.draft).toEqual({ columns: "part from-to role confidence evidence", parts: draft.lines });
    expect(Object.keys(user.roles as object)).toEqual(["setup", "method", "evidence", "interpretation", "apparatus"]);
    expect(Object.keys(user.outputSchema as object)).toEqual(["corrections", "unsure"]);
    expect((user.rules as string[]).length).toBe(6);
    expect(user.paper).toEqual({ pages: FIVE.doc.pageCount });
    expect(prompt.maxTokens).toBe(600);
    expect(prompt.systemPrompt).toContain("Return only valid JSON");
  });

  it("has no title and no reader in it", () => {
    expect(Object.keys(user).sort()).toEqual(["countsKey", "draft", "outputSchema", "paper", "roles", "rules", "skeleton", "task"]);
    expect(prompt.userPrompt).not.toMatch(/\btitle\b|\bprofile\b|\bproject\b|\breader\b/i);
  });

  it("pins its fixed text by hash: an edit must bump REVIEW_PROMPT_VERSION and this golden together", () => {
    const text = reviewPromptFixedText();
    let h = 0;
    for (const ch of text) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;

    expect(text.length).toBe(2_304);
    expect(h).toBe(1_112_703_761);
  });
});

describe("sanitizeReview — the answer, correction by correction, against the draft as given", () => {
  const draft = [part(0, 5, "setup"), part(6, 10, "method"), part(11, 20, "evidence"), part(21, 25, "interpretation"), part(26, 28, "apparatus")];
  const N = 29;

  it("is not an answer when it is not an object with a `corrections` array", () => {
    for (const raw of [null, undefined, "prose", 5, [], {}, { corrections: "no" }, { corrections: {} }]) expect(sanitizeReview(raw, draft, N)).toBeNull();
  });

  it("keeps a valid correction of each kind, and unsure parts once each", () => {
    const answer = sanitizeReview(
      {
        corrections: [
          { op: "move_start", part: 2, toParagraph: 12 },
          { op: "set_role", part: 3, role: " Method " },
          { op: "split", part: 2, atParagraph: 16, role: "interpretation" },
        ],
        unsure: [4, "4", 4, 99, -1, 1.5, "x"],
      },
      draft,
      N,
    )!;

    expect(answer.rejected).toBe(0);
    expect(answer.answer.corrections).toEqual([
      { op: "move_start", part: 2, toParagraph: 12 },
      { op: "set_role", part: 3, role: "method" },
      { op: "split", part: 2, atParagraph: 16, role: "interpretation" },
    ]);
    expect(answer.answer.unsure).toEqual([4]);
  });

  it("refuses an op outside the three, a part out of range, a role outside the five, and `body`", () => {
    const answer = sanitizeReview(
      {
        corrections: [
          { op: "delete", part: 1 },
          { op: "merge", part: 1 },
          { op: "set_role", part: 99, role: "method" },
          { op: "set_role", part: -1, role: "method" },
          { op: "set_role", part: 1.5, role: "evidence" },
          { op: "set_role", part: 1, role: "banana" },
          { op: "set_role", part: 1, role: "body" },
          { op: "set_role", part: 1, role: "experimental" },
          { op: "set_role", part: 1, role: "" },
          "not an object",
          null,
        ],
      },
      draft,
      N,
    )!;

    expect(answer.answer.corrections).toEqual([]);
    expect(answer.rejected).toBe(11);
  });

  it("holds a `move_start` to the draft's own room: not part 0, not where it is, not before the previous part's first paragraph, not past its own end, once only", () => {
    const moves = [
      { part: 0, toParagraph: 2 },
      { part: 1, toParagraph: 6 },
      { part: 1, toParagraph: 0 },
      { part: 1, toParagraph: 11 },
      { part: 1, toParagraph: 99 },
      { part: 1, toParagraph: 1.5 },
      { part: 1, toParagraph: -2 },
      { part: 1, toParagraph: "8" },
      { part: 1, toParagraph: 9 },
    ];
    const answer = sanitizeReview({ corrections: moves.map((m) => ({ op: "move_start", ...m })) }, draft, N)!;

    expect(answer.answer.corrections).toEqual([{ op: "move_start", part: 1, toParagraph: 8 }]);
    expect(answer.rejected).toBe(8);
  });

  it("holds a `set_role` to a different role, once per part, and a `split` to the inside of its part, with a role, distinct, at most three", () => {
    const answer = sanitizeReview(
      {
        corrections: [
          { op: "set_role", part: 1, role: "method" },
          { op: "set_role", part: 1, role: "evidence" },
          { op: "set_role", part: 1, role: "apparatus" },
          { op: "split", part: 2, atParagraph: 11, role: "method" },
          { op: "split", part: 2, atParagraph: 21, role: "method" },
          { op: "split", part: 2, atParagraph: 14 },
          { op: "split", part: 2, atParagraph: 14, role: "interpretation" },
          { op: "split", part: 2, atParagraph: 14, role: "evidence" },
          { op: "split", part: 2, atParagraph: 15, role: "evidence" },
          { op: "split", part: 2, atParagraph: 16, role: "evidence" },
          { op: "split", part: 2, atParagraph: 17, role: "evidence" },
        ],
      },
      draft,
      N,
    )!;

    expect(answer.answer.corrections).toEqual([
      { op: "set_role", part: 1, role: "evidence" },
      { op: "split", part: 2, atParagraph: 14, role: "interpretation" },
      { op: "split", part: 2, atParagraph: 15, role: "evidence" },
      { op: "split", part: 2, atParagraph: 16, role: "evidence" },
    ]);
  });

  it("reads at most forty corrections and counts the rest as rejected, without invalidating the first forty", () => {
    const many = Array.from({ length: 50 }, (_, k) => part(k * 2, k * 2 + 1, k % 2 === 0 ? "setup" : "method"));
    const corrections = many.map((_, k) => ({ op: "set_role", part: k, role: k % 2 === 0 ? "evidence" : "apparatus" }));
    const answer = sanitizeReview({ corrections }, many, 100)!;

    expect(answer.answer.corrections).toHaveLength(40);
    expect(answer.rejected).toBe(10);
    expect(answer.read).toBe(50);
  });
});

describe("sanitizeReview — the damage guard: the role setup belongs to the paper's opening run (P12-86)", () => {
  // The measured damage (P6, one run of five): `split` at paragraph 11 with role setup, then `split` at 12 with role
  // evidence, inside the first results part, flipped that row's majority to setup.
  const draft = [part(0, 5, "setup"), part(6, 20, "evidence"), part(21, 28, "interpretation")];
  const N = 29;
  const cut = (c: unknown, d: readonly DraftPart[] = draft) => sanitizeReview({ corrections: [c] }, d, d[d.length - 1].to + 1)!;

  it("refuses a split that cuts a setup piece out of the first results part, counts it with the other refusals, and keeps the rest", () => {
    const raw = {
      corrections: [
        { op: "split", part: 1, atParagraph: 11, role: "setup" },
        { op: "split", part: 1, atParagraph: 12, role: "evidence" },
      ],
    };
    const answer = sanitizeReview(raw, draft, N)!;

    expect(answer.answer.corrections).toEqual([{ op: "split", part: 1, atParagraph: 12, role: "evidence" }]);
    expect(answer.rejected).toBe(1);
    expect(answer.read).toBe(2);

    // Whole: the structure is the draft's own, with no setup piece in the middle of the results.
    const result = reviewStructure(raw, draft, N);
    expect(result.fellBack).toBe(false);
    expect(result.parts).toEqual(partsOf(draft));
    expect(result.rejected).toBe(1);
  });

  it("refuses the role setup for a split in any part after the opening, and for a set_role of any part after the first that is not setup", () => {
    const longer = [part(0, 5, "setup"), part(6, 10, "method"), part(11, 20, "evidence"), part(21, 28, "interpretation")];
    for (const k of [1, 2, 3]) {
      expect(cut({ op: "split", part: k, atParagraph: longer[k].from + 1, role: "setup" }, longer).answer.corrections).toEqual([]);
    }
    for (const k of [2, 3]) {
      expect(cut({ op: "set_role", part: k, role: "setup" }, longer).answer.corrections).toEqual([]);
      expect(cut({ op: "set_role", part: k, role: " Setup " }, longer).rejected).toBe(1);
    }
    expect(cut({ op: "set_role", part: 2, role: "setup" }, draft).answer.corrections).toEqual([]);
    expect(cut({ op: "split", part: 2, atParagraph: 25, role: "setup" }).answer.corrections).toEqual([]);
  });

  it("still applies a correction that moves the setup part's end, sets a later part to method, or gives the first part after the opening the role setup", () => {
    expect(cut({ op: "move_start", part: 1, toParagraph: 8 }).answer.corrections).toEqual([{ op: "move_start", part: 1, toParagraph: 8 }]);
    expect(cut({ op: "set_role", part: 2, role: "method" }).answer.corrections).toEqual([{ op: "set_role", part: 2, role: "method" }]);
    expect(cut({ op: "set_role", part: 1, role: "setup" }).answer.corrections).toEqual([{ op: "set_role", part: 1, role: "setup" }]);
    expect(cut({ op: "split", part: 1, atParagraph: 12, role: "method" }).answer.corrections).toEqual([{ op: "split", part: 1, atParagraph: 12, role: "method" }]);
    // Inside the opening run itself, a split is judged as it always was.
    expect(cut({ op: "split", part: 0, atParagraph: 3, role: "method" }).answer.corrections).toEqual([{ op: "split", part: 0, atParagraph: 3, role: "method" }]);
    expect(cut({ op: "split", part: 0, atParagraph: 3, role: "setup" }).answer.corrections).toEqual([{ op: "split", part: 0, atParagraph: 3, role: "setup" }]);

    // Applied: the opening's end moves, the later part is method, the opening takes the first results part whole.
    expect(reviewStructure({ corrections: [{ op: "move_start", part: 1, toParagraph: 8 }, { op: "set_role", part: 2, role: "method" }] }, draft, N).parts).toEqual([
      { from: 0, to: 7, role: "setup" },
      { from: 8, to: 20, role: "evidence" },
      { from: 21, to: 28, role: "method" },
    ]);
    expect(reviewStructure({ corrections: [{ op: "set_role", part: 1, role: "setup" }] }, draft, N).parts).toEqual([
      { from: 0, to: 20, role: "setup" },
      { from: 21, to: 28, role: "interpretation" },
    ]);
  });

  it("finds the opening in the draft as given: a draft that does not open with setup lets only its first part become setup", () => {
    const unopened = [part(0, 10, "method"), part(11, 20, "evidence"), part(21, 28, "interpretation")];

    expect(cut({ op: "set_role", part: 0, role: "setup" }, unopened).answer.corrections).toEqual([{ op: "set_role", part: 0, role: "setup" }]);
    expect(cut({ op: "set_role", part: 1, role: "setup" }, unopened).answer.corrections).toEqual([]);
    expect(cut({ op: "split", part: 0, atParagraph: 4, role: "setup" }, unopened).answer.corrections).toEqual([]);
    // A draft that is all setup has nothing after its opening.
    const only = [part(0, 28, "setup")];
    expect(cut({ op: "split", part: 0, atParagraph: 4, role: "method" }, only).answer.corrections).toHaveLength(1);
  });

  it("holds when the same correction is asked again: the refused split does not use up a split of the part", () => {
    const answer = sanitizeReview(
      {
        corrections: [
          { op: "split", part: 1, atParagraph: 11, role: "setup" },
          { op: "split", part: 1, atParagraph: 11, role: "interpretation" },
          { op: "split", part: 1, atParagraph: 12, role: "setup" },
          { op: "split", part: 1, atParagraph: 13, role: "setup" },
          { op: "split", part: 1, atParagraph: 14, role: "setup" },
          { op: "split", part: 1, atParagraph: 15, role: "method" },
        ],
      },
      draft,
      N,
    )!;

    expect(answer.answer.corrections).toEqual([
      { op: "split", part: 1, atParagraph: 11, role: "interpretation" },
      { op: "split", part: 1, atParagraph: 15, role: "method" },
    ]);
    expect(answer.rejected).toBe(4);
  });

  it("is the guard of a kept review too: laid over its draft, the P6 corrections leave no setup piece in the results", () => {
    const five = draftOf(FIVE.input)!;
    const parts = reviewedParts(five, {
      corrections: [
        { op: "split", part: 2, atParagraph: 11, role: "setup" },
        { op: "split", part: 2, atParagraph: 12, role: "evidence" },
      ],
      unsure: [],
      draftDigest: five.digest,
    });

    expect(parts).toEqual(partsOf(five.parts));
  });
});

describe("applyCorrections / sound / reviewStructure — starts, then roles, then splits; the draft stands for anything unsound", () => {
  const draft = [part(0, 5, "setup"), part(6, 10, "method"), part(11, 20, "evidence"), part(21, 25, "interpretation"), part(26, 28, "apparatus")];
  const N = 29;
  const none: Answer = { corrections: [], unsure: [] };

  it("applies no corrections to itself: the draft comes back", () => {
    expect(applyCorrections(draft, N, none).parts).toEqual(partsOf(draft));
  });

  it("moves a start, changes a role and splits, in that order, and ends where the next begins", () => {
    const result = applyCorrections(draft, N, {
      corrections: [
        { op: "split", part: 2, atParagraph: 16, role: "interpretation" },
        { op: "set_role", part: 3, role: "apparatus" },
        { op: "move_start", part: 1, toParagraph: 8 },
      ],
      unsure: [],
    });

    // Part 1 starts at 8, part 3 is apparatus and so is part 4 (one part), and part 2 is split at 16.
    expect(result.parts).toEqual([
      { from: 0, to: 7, role: "setup" },
      { from: 8, to: 10, role: "method" },
      { from: 11, to: 15, role: "evidence" },
      { from: 16, to: 20, role: "interpretation" },
      { from: 21, to: 28, role: "apparatus" },
    ]);
    expect(sound(result.parts, N)).toBe(true);
  });

  it("merges neighbours of one role, so a spurious part is removed by giving it its neighbour's role", () => {
    const result = applyCorrections(draft, N, { corrections: [{ op: "set_role", part: 3, role: "evidence" }], unsure: [] });

    expect(result.parts).toEqual([
      { from: 0, to: 5, role: "setup" },
      { from: 6, to: 10, role: "method" },
      { from: 11, to: 25, role: "evidence" },
      { from: 26, to: 28, role: "apparatus" },
    ]);
  });

  it("drops a move that would cross a start, and a split outside its part, and never repairs them", () => {
    const result = applyCorrections(draft, N, {
      corrections: [
        { op: "move_start", part: 1, toParagraph: 9 },
        { op: "move_start", part: 2, toParagraph: 9 },
        { op: "split", part: 2, atParagraph: 11, role: "method" },
        { op: "split", part: 0, atParagraph: 9, role: "method" },
      ],
      unsure: [],
    });

    expect(result.dropped).toBe(3);
    expect(result.applied).toBe(1);
    expect(result.parts[1]).toEqual({ from: 9, to: 10, role: "method" });
  });

  it("is sound only when it starts at 0, is contiguous, ends at the last paragraph and names the five roles", () => {
    const good = partsOf(draft);
    expect(sound(good, N)).toBe(true);
    expect(sound([], N)).toBe(false);
    expect(sound(good.slice(1), N)).toBe(false);
    expect(sound(good.slice(0, 4), N)).toBe(false);
    expect(sound([good[0], { ...good[1], from: 7 }, ...good.slice(2)], N)).toBe(false);
    expect(sound([{ ...good[0], role: "body" as ReviewRole }, ...good.slice(1)], N)).toBe(false);
    expect(sound([{ from: 0, to: -1, role: "setup" }], 0)).toBe(false);
  });

  it("leaves the draft exactly for an answer that is not one, for one whose every correction was refused, and for one that throws", () => {
    const base = partsOf(draft);
    for (const raw of ["prose", null, [], {}, { corrections: [{ op: "set_role", part: 99, role: "banana" }] }]) {
      const result = reviewStructure(raw, draft, N);
      expect(result.fellBack).toBe(true);
      expect(result.parts).toEqual(base);
      expect(result.answer).toBeNull();
    }
    const trap = new Proxy({}, { get: () => { throw new Error("boom"); } });
    expect(reviewStructure(trap, draft, N)).toMatchObject({ fellBack: true, parts: base });
  });

  it("takes an empty list of corrections as an answer: the draft is right", () => {
    const result = reviewStructure({ corrections: [], unsure: [2] }, draft, N);

    expect(result.fellBack).toBe(false);
    expect(result.parts).toEqual(partsOf(draft));
    expect(result.answer).toEqual({ corrections: [], unsure: [2] });
  });

  it("applies the valid corrections of an answer that also holds refused ones", () => {
    const result = reviewStructure({ corrections: [{ op: "set_role", part: 1, role: "banana" }, { op: "set_role", part: 1, role: "evidence" }] }, draft, N);

    expect(result.fellBack).toBe(false);
    expect(result.rejected).toBe(1);
    expect(result.parts[1].role).toBe("evidence");
  });
});

describe("the double's round trip — a draft with a wrong role and a wrong start, corrected to the truth", () => {
  const draft = draftOf(FIVE.input)!;
  const roundTrip = (input: StructureInput, d = draftOf(input)!) => {
    const prompt = buildReviewPrompt({ skeleton: buildSkeleton(input, d)!, draft: d });
    const raw = modelDouble(prompt.userPrompt);
    return { raw, ...reviewStructure(JSON.parse(raw), d.parts, d.paragraphs) };
  };

  it("starts from a draft that is wrong in two places", () => {
    expect(draft.parts.map((p) => [p.from, p.role])).toEqual([[0, "setup"], [6, "method"], [9, "evidence"], [18, "method"], [22, "interpretation"], [26, "apparatus"]]);
    expect(FIVE.truthParts).toEqual([
      { from: 0, to: 5, role: "setup" },
      { from: 6, to: 10, role: "method" },
      { from: 11, to: 21, role: "evidence" },
      { from: 22, to: 25, role: "interpretation" },
      { from: 26, to: 28, role: "apparatus" },
    ]);
  });

  it("returns a move for the start and a role for the part, and applying them equals the truth", () => {
    const result = roundTrip(FIVE.input);

    expect(JSON.parse(result.raw).corrections).toEqual([
      { op: "move_start", part: 2, toParagraph: 11 },
      { op: "set_role", part: 3, role: "evidence" },
    ]);
    expect(result.fellBack).toBe(false);
    expect(result.parts).toEqual(FIVE.truthParts);
  });

  // Re-aimed (§1h.442): "Closing remarks" used to be left `body` and inherit the evidence part before it; C P12-48's rules (A2) now give an
  // unnamed row between the introduction and the first named later part the role evidence, and one directly before the references
  // apparatus. The claim is kept - a draft that fused two roles (the unnamed closing row read as the results before it) is split
  // back to the truth - on a paper where A2 still fuses them: the closing row stands before a named Methods part, not before the references.
  it("splits a draft that fused two roles", () => {
    const fused = inventedPaper([
      { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 4]] },
      { heading: "2 Results", canonical: "results", truth: [["evidence", 5]] },
      { heading: "Closing remarks", canonical: "body", truth: [["interpretation", 3]] },
      { heading: "3 Methods used", canonical: "methods", truth: [["method", 3]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
    ]);
    const result = roundTrip(fused.input);

    // The draft: one evidence part (Results and the unnamed row, 4-11), as the rules read it.
    expect(draftOf(fused.input)!.parts.map((p) => [p.from, p.to, p.role, p.conf])).toEqual([
      [0, 3, "setup", "high"],
      [4, 11, "evidence", "medium"],
      [12, 14, "method", "high"],
      [15, 16, "apparatus", "high"],
    ]);
    expect(JSON.parse(result.raw).corrections).toEqual([{ op: "split", part: 1, atParagraph: 9, role: "interpretation" }]);
    expect(result.parts).toEqual(fused.truthParts);
  });

  it("returns no correction for a draft that is right, and the draft comes back", () => {
    const right = inventedPaper([
      { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 3]] },
      { heading: "2 Methods", canonical: "methods", truth: [["method", 3]] },
      { heading: "3 Results", canonical: "results", truth: [["evidence", 3]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
    ]);
    const result = roundTrip(right.input);

    expect(JSON.parse(result.raw)).toEqual({ corrections: [], unsure: [] });
    expect(result.parts).toEqual(partsOfRoles(right.roles));
    expect(result.parts).toEqual(partsOf(draftOf(right.input)!.parts));
  });

  it("reads the prompt and nothing else: the paragraph tails are not in it", () => {
    const prompt = buildReviewPrompt({ skeleton: buildSkeleton(FIVE.input, draft)!, draft });

    expect(prompt.userPrompt).not.toContain("Nothing here is quoted from a paper");
    expect(prompt.userPrompt).toContain("Invented evidence paragraph 11");
  });
});

describe("the second look — which parts, which paragraphs, what the verdict does", () => {
  const draft = [part(0, 5, "setup", "high"), part(6, 10, "method", "medium"), part(11, 20, "evidence", "low"), part(21, 25, "interpretation", "high"), part(26, 28, "apparatus", "high")];

  it("looks at a correction against a high or medium part, then at the unsure; never at a correction against a low part", () => {
    const answer: Answer = {
      corrections: [
        { op: "set_role", part: 1, role: "evidence" },
        { op: "set_role", part: 2, role: "method" },
        { op: "move_start", part: 3, toParagraph: 23 },
        { op: "split", part: 4, atParagraph: 27, role: "setup" },
      ],
      unsure: [0, 2, 3],
    };

    expect(secondLookTargets(draft, answer)).toEqual([
      { part: 3, why: "contradicts-high" },
      { part: 4, why: "contradicts-high" },
      { part: 1, why: "contradicts-medium" },
    ]);
    expect(secondLookTargets(draft, { corrections: [], unsure: [2, 0] })).toEqual([{ part: 2, why: "unsure" }, { part: 0, why: "unsure" }].sort((a, b) => a.part - b.part));
    expect(secondLookTargets(draft, { corrections: [{ op: "set_role", part: 2, role: "method" }], unsure: [] })).toEqual([]);
  });

  it("takes at most three looks per paper", () => {
    const corrections = [0, 1, 3, 4].map((k) => ({ op: "set_role" as const, part: k, role: "apparatus" as ReviewRole }));
    const targets = secondLookTargets(draft, { corrections: corrections.filter((c) => draft[c.part].role !== c.role), unsure: [2] });

    expect(targets).toHaveLength(REVIEW_CAPS.secondLooks);
    expect(REVIEW_CAPS.secondLooks).toBe(3);
  });

  it("reads only the disputed span: three either side of a moved start, four either side of a split, the thinned part for a role", () => {
    const move = lookParagraphs(draft, { corrections: [{ op: "move_start", part: 3, toParagraph: 23 }], unsure: [] }, { part: 3, why: "contradicts-high" });
    const split = lookParagraphs(draft, { corrections: [{ op: "split", part: 1, atParagraph: 8, role: "evidence" }], unsure: [] }, { part: 1, why: "contradicts-medium" });
    const role = lookParagraphs(draft, { corrections: [{ op: "set_role", part: 3, role: "method" }], unsure: [] }, { part: 3, why: "contradicts-high" });
    const unsure = lookParagraphs(draft, { corrections: [], unsure: [3] }, { part: 3, why: "unsure" });

    // Part 3 runs 21-25, part 2 before it 11-20: the window does not leave the two parts.
    expect(move).toEqual([18, 19, 20, 21, 22, 23, 24, 25]);
    expect(split).toEqual([6, 7, 8, 9, 10]);
    // First 3, last 2 and every fourth between: 21, 22, 23, 24, 25 (5 paragraphs: all of them).
    expect(role).toEqual([21, 22, 23, 24, 25]);
    expect(unsure).toEqual(role);
    const long = lookParagraphs(draft, { corrections: [], unsure: [2] }, { part: 2, why: "unsure" });
    expect(long).toEqual([11, 12, 13, 15, 19, 20]);
  });

  it("clips each paragraph to 600 characters and the whole to 6,000, the outermost dropped first", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(900, "x"));
    const window = lookWindow(texts, Array.from({ length: 14 }, (_, i) => i + 4));

    expect(window.every((item) => item.text.length <= 600)).toBe(true);
    expect(window.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(6_000);
    expect(window).toHaveLength(10);
    // Four were dropped from the outside, front and back in turn: 4, 17, 5, 16 are gone.
    expect(window.map((item) => item.n)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("asks with the paragraphs and the two readings; it carries at most 6,600 characters of the paper and no title", () => {
    const paper = inventedPaper(FIVE_PARTS);
    const d = draftOf(paper.input)!;
    const answer: Answer = { corrections: [{ op: "move_start", part: 2, toParagraph: 11 }], unsure: [] };
    const prompt = buildLookPrompt({ draft: d, answer, target: { part: 2, why: "contradicts-high" }, texts: paper.input.texts });
    const user = JSON.parse(prompt.userPrompt) as { paragraphs: Array<{ n: number }>; readings: { draft: string; review: string }; outputSchema: object };

    expect(prompt.maxTokens).toBe(60);
    expect(prompt.userPrompt.length).toBeLessThan(REVIEW_CAPS.lookChars + 3_000);
    expect(prompt.textChars).toBeLessThanOrEqual(REVIEW_CAPS.lookChars);
    expect(user.paragraphs[0].n).toBe(6);
    expect(user.readings.draft).toBe("paragraphs 6–8 are method; paragraphs 9–13 are evidence");
    expect(user.readings.review).toBe("paragraphs 6–10 are method; paragraphs 11–13 are evidence");
    expect(Object.keys(user.outputSchema)).toEqual(["verdict", "role"]);
    expect(prompt.userPrompt).not.toMatch(/title|reader/i);
  });

  it("reads a verdict and nothing else: draft, review, review with a role; the rest is null", () => {
    expect(parseLookVerdict({ verdict: "draft" })).toEqual({ verdict: "draft" });
    expect(parseLookVerdict({ verdict: " Review " })).toEqual({ verdict: "review" });
    expect(parseLookVerdict({ verdict: "review", role: "Method" })).toEqual({ verdict: "review", role: "method" });
    expect(parseLookVerdict({ verdict: "review", role: "banana" })).toEqual({ verdict: "review" });
    for (const raw of [null, "draft", [], {}, { verdict: "maybe" }, { verdict: 1 }]) expect(parseLookVerdict(raw)).toBeNull();
  });

  it("keeps a correction on `review`, and drops a part's corrections on `draft`, on a look that failed, and on one that cannot be read", () => {
    const answer: Answer = {
      corrections: [
        { op: "set_role", part: 1, role: "evidence" },
        { op: "move_start", part: 3, toParagraph: 23 },
        { op: "split", part: 4, atParagraph: 27, role: "setup" },
        { op: "set_role", part: 2, role: "method" },
      ],
      unsure: [],
    };
    const kept = resolveLooks(draft, answer, [{ target: { part: 1, why: "contradicts-medium" }, verdict: { verdict: "review" } }]);
    const dropped = resolveLooks(draft, answer, [
      { target: { part: 1, why: "contradicts-medium" }, verdict: { verdict: "draft" } },
      { target: { part: 3, why: "contradicts-high" }, verdict: null },
      { target: { part: 4, why: "contradicts-high" }, verdict: { verdict: "review" } },
    ]);

    expect(kept.answer.corrections).toHaveLength(4);
    expect(kept.records).toEqual([{ part: 1, why: "contradicts-medium", verdict: "review" }]);
    expect(dropped.answer.corrections).toEqual([
      { op: "split", part: 4, atParagraph: 27, role: "setup" },
      // The correction against the low part was never looked at, and stands.
      { op: "set_role", part: 2, role: "method" },
    ]);
    expect(dropped.records.map((r) => r.verdict)).toEqual(["draft", "failed", "review"]);
  });

  it("leaves an unsure part as the draft, unless the look says `review` and names another role", () => {
    const target = { part: 0, why: "unsure" as const };
    const base: Answer = { corrections: [], unsure: [0] };

    expect(resolveLooks(draft, base, [{ target, verdict: { verdict: "draft" } }]).answer.corrections).toEqual([]);
    expect(resolveLooks(draft, base, [{ target, verdict: null }]).answer.corrections).toEqual([]);
    expect(resolveLooks(draft, base, [{ target, verdict: { verdict: "review" } }]).answer.corrections).toEqual([]);
    expect(resolveLooks(draft, base, [{ target, verdict: { verdict: "review", role: "setup" } }]).answer.corrections).toEqual([]);
    expect(resolveLooks(draft, base, [{ target, verdict: { verdict: "review", role: "method" } }]).answer.corrections).toEqual([{ op: "set_role", part: 0, role: "method" }]);
  });
});
