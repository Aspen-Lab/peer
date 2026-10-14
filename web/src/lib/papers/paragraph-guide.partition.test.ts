import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import {
  buildParagraphGuidePrompt,
  createParagraphGuideCache,
  gistCandidates,
  gistMaxTokens,
  guideTrunk,
  GUIDE_CAPS,
  sanitizeParagraphGuide,
  tooManyParagraphs,
  type ParagraphGuide,
} from "./paragraph-guide";

// P10-07a (B P10-05 §2.3 and §2.5; review 3.3, second half; rubric A15): the paragraph guide
// asks the model for a partition of the paper only when the paper has no headings of its own
// (`guideTrunk`). A paper with headings is asked exactly what it was asked before: its prompt
// and its token allowance are pinned below, byte for byte, from the head before this change.
// Every text is invented ("a survey of shore ecology").

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const invented = (k: number) =>
  `Invented paragraph ${k} about ${TOPICS[k % TOPICS.length]}. The survey counted ${10 + k} sites near the ${TOPICS[k % TOPICS.length]}. Nothing here is quoted from a paper.`;
const paragraphs = (from: number, n: number) => Array.from({ length: n }, (_, k) => invented(from + k)).join("\n\n");

/** B's fixture: an unheaded main text (one body section, 30 paragraphs) and a Methods heading with 4. */
const unheaded: ExtractedDocument = {
  source: "pdf",
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "A Survey of Shore Ecology", canonical: "body", text: paragraphs(0, 30) },
    { id: "s1", heading: "Methods", canonical: "methods", text: paragraphs(100, 4) },
  ],
};

/** The headed document the golden prompt below was taken from on the head before this change. */
const headed: ExtractedDocument = {
  source: "pdf",
  figureCaptions: [],
  sections: [
    {
      id: "s1",
      heading: "1 Introduction",
      canonical: "introduction",
      text: "Hot turbine blades creep slowly under load and lose their shape over many hours.\n\nNickel alloys form plates inside their grains when they creep at high temperature.",
    },
    { id: "s2", heading: "2 Methods", canonical: "methods", text: "Specimens were machined from a single casting and heat treated together." },
  ],
};
const TITLE = "Rafting under creep in a nickel alloy";

// Taken from the head (b0764747), before the partition: the system prompt, the user prompt and the allowance.
const HEADED_SYSTEM = "You are Peer, a calm research assistant who sits beside a reader. For each paragraph of a paper you write one very short gist, so the reader can see what the paragraph is about before reading it. A paragraph's first sentences are its topic sentence: condense the gist from it, using the rest of the paragraph only to check it. Never quote the paper at length. Do not fabricate facts, numbers or citations. Return only valid JSON.";
const HEADED_USER = "{\"task\":\"Write one gist for every paragraph in `paragraphs`.\",\"paper\":{\"title\":\"Rafting under creep in a nickel alloy\"},\"paragraphs\":[{\"sectionId\":\"s1\",\"paragraphIndex\":0,\"topicSentence\":\"Hot turbine blades creep slowly under load and lose their shape over many hours.\",\"text\":\"Hot turbine blades creep slowly under load and lose their shape over many hours.\"},{\"sectionId\":\"s1\",\"paragraphIndex\":1,\"topicSentence\":\"Nickel alloys form plates inside their grains when they creep at high temperature.\",\"text\":\"Nickel alloys form plates inside their grains when they creep at high temperature.\"},{\"sectionId\":\"s2\",\"paragraphIndex\":0,\"topicSentence\":\"Specimens were machined from a single casting and heat treated together.\",\"text\":\"Specimens were machined from a single casting and heat treated together.\"}],\"outputSchema\":{\"gists\":[{\"sectionId\":\"copied from the paragraph\",\"paragraphIndex\":\"copied from the paragraph, a number\",\"gist\":\"at most 12 words, in plain words, saying what the paragraph is about\"}]},\"rules\":[\"Return ONLY valid JSON of the shape in `outputSchema`: one entry per paragraph, in order, `sectionId` and `paragraphIndex` copied exactly from the paragraph.\",\"Each `gist` is at most 12 words of plain English, condensed from that paragraph's `topicSentence` (its topic sentence) and checked against its `text`.\",\"Add no new facts, and no number, name or claim the paragraph does not state. Reuse the paragraph's own key words.\",\"Do not copy the topic sentence; say it shorter. No LaTeX, no links, no advice, no verdict on whether the reader should read the paragraph.\",\"Leave a paragraph out rather than guess.\"]}";
const HEADED_MAX_TOKENS = 600;

const RULE_PARTITION = (id: string) =>
  `\`partition\` divides the paragraphs of section \`${id}\` only, in reading order, into consecutive parts; list where each part starts; the first part starts at the section's first paragraph; a part runs until the next one starts. \`paragraphIndex\` values may skip: a part's range is by index.`;
const RULE_ROLES =
  "Roles: `introduction` is the background, motivation and the question asked; `results` is what was observed or measured; `discussion` is interpretation, comparison with other work and limits; `conclusion` is the closing summary and outlook; `experimental` is materials, samples, instruments, procedures, data processing and statistics, wherever in the section they stand.";
const RULE_LIMITS =
  "Use a role at most twice. Use only the roles the paragraphs show; leave a role out rather than invent a part. Two to five parts is usual. This is your reading of the structure: copy no sentence of the paper into it.";

interface Sent {
  task: string;
  paper: { title: string };
  paragraphs: Array<{ sectionId: string; paragraphIndex: number }>;
  outputSchema: Record<string, unknown>;
  rules: string[];
}

describe("guideTrunk — the paper the guide asks a partition of", () => {
  it("is the trunk of an unheaded paper, on the sections the body renders", () => {
    expect(guideTrunk(unheaded)).toEqual({ sectionId: "s0", sectionIndex: 0, paragraphCount: 30 });
  });

  it("counts a paragraph with no opening in the trunk's size, because a part's range is by paragraph index", () => {
    const withBare: ExtractedDocument = {
      ...unheaded,
      sections: [{ ...unheaded.sections[0], text: `Creep has long been a concern in the field. Cast alloys remain one of the oldest topics.\n\n${paragraphs(1, 29)}` }, unheaded.sections[1]],
    };

    expect(gistCandidates(withBare).filter((c) => c.sectionId === "s0")).toHaveLength(29);
    expect(guideTrunk(withBare)?.paragraphCount).toBe(30);
  });

  it("is null for a paper with headings", () => {
    expect(guideTrunk(headed)).toBeNull();
  });
});

describe("the paragraph guide's prompt — a paper with headings is asked what it always was (the regression pin)", () => {
  const candidates = gistCandidates(headed);

  it("is byte-identical to the head's prompt, with no trunk argument, a null trunk or an undefined one", () => {
    for (const extra of [{}, { trunk: null }, { trunk: undefined }]) {
      const got = buildParagraphGuidePrompt({ paper: { title: TITLE }, candidates, ...extra });

      expect(got.systemPrompt).toBe(HEADED_SYSTEM);
      expect(got.userPrompt).toBe(HEADED_USER);
    }
  });

  it("keeps the allowance the head gave, with the argument left out or false", () => {
    expect(gistMaxTokens(candidates.length)).toBe(HEADED_MAX_TOKENS);
    expect(gistMaxTokens(candidates.length, false)).toBe(HEADED_MAX_TOKENS);
    for (const n of [0, 1, 8, 30, 35, 120, 500]) expect(gistMaxTokens(n, false)).toBe(gistMaxTokens(n));
    expect(gistMaxTokens(0)).toBe(600);
    expect(gistMaxTokens(120)).toBe(5600);
  });
});

describe("the paragraph guide's prompt — an unheaded paper is also asked for its parts (B §2.3)", () => {
  const candidates = gistCandidates(unheaded);
  const trunk = guideTrunk(unheaded)!;
  const withTrunk = buildParagraphGuidePrompt({ paper: { title: TITLE }, candidates, trunk });
  const without = buildParagraphGuidePrompt({ paper: { title: TITLE }, candidates });
  const sent = JSON.parse(withTrunk.userPrompt) as Sent;
  const plain = JSON.parse(without.userPrompt) as Sent;

  it("leaves the system prompt as it is", () => {
    expect(withTrunk.systemPrompt).toBe(without.systemPrompt);
  });

  it("names the section to divide in the task", () => {
    expect(sent.task).toBe("Write one gist for every paragraph in `paragraphs`. Also divide the paragraphs of section `s0` into parts.");
    expect(plain.task).toBe("Write one gist for every paragraph in `paragraphs`.");
  });

  it("puts the partition in the schema, before the gists, asking only where each part starts", () => {
    expect(Object.keys(sent.outputSchema)).toEqual(["partition", "gists"]);
    expect(sent.outputSchema.partition).toEqual([
      {
        role: "one of: introduction, results, discussion, conclusion, experimental",
        fromParagraph: "the paragraphIndex of the part's first paragraph, a number",
      },
    ]);
    expect(sent.outputSchema.gists).toEqual(plain.outputSchema.gists);
    expect(JSON.stringify(sent.outputSchema)).not.toContain("toParagraph");
  });

  it("appends the three rules, verbatim, after the existing ones", () => {
    expect(sent.rules.slice(0, plain.rules.length)).toEqual(plain.rules);
    expect(sent.rules.slice(plain.rules.length)).toEqual([RULE_PARTITION("s0"), RULE_ROLES, RULE_LIMITS]);
  });

  it("sends the same paragraphs as without it: no more of the paper leaves", () => {
    expect(sent.paragraphs).toEqual(plain.paragraphs);
    expect(sent.paper).toEqual(plain.paper);
    expect(withTrunk.userPrompt.length).toBeGreaterThan(without.userPrompt.length);
  });

  it("holds nothing about the reader: the same five fields, whatever else the caller holds", () => {
    const hostile = buildParagraphGuidePrompt({
      paper: { title: TITLE },
      candidates,
      trunk,
      ...({ profile: "PROFILE-SENTINEL", project: "PROJECT-SENTINEL", questions: ["QUESTION-SENTINEL"], userId: "USER-SENTINEL" } as object),
    });

    expect(Object.keys(JSON.parse(hostile.userPrompt) as object)).toEqual(["task", "paper", "paragraphs", "outputSchema", "rules"]);
    expect(hostile.userPrompt + hostile.systemPrompt).not.toContain("SENTINEL");
    expect(hostile.userPrompt).toBe(withTrunk.userPrompt);
  });

  it("asks for 300 more tokens of answer, and only when it asks", () => {
    for (const n of [0, 1, 8, 30, 34, 120]) {
      expect(gistMaxTokens(n, true)).toBe(gistMaxTokens(n) + 300);
      expect(gistMaxTokens(n, false)).toBe(gistMaxTokens(n));
    }
  });

  it("asks for no partition beyond the 120-paragraph cap: the pass is skipped, partition and all", () => {
    const long: ExtractedDocument = { ...unheaded, sections: [{ ...unheaded.sections[0], text: paragraphs(0, GUIDE_CAPS.maxParagraphs + 1) }] };

    expect(guideTrunk(long)).not.toBeNull();
    expect(tooManyParagraphs(long)).toBe(true);
    // A prompt built from more than 120 candidates still carries 120 paragraphs, the partition no more.
    const over = buildParagraphGuidePrompt({ paper: { title: TITLE }, candidates: gistCandidates(long), trunk: guideTrunk(long) });
    expect((JSON.parse(over.userPrompt) as Sent).paragraphs).toHaveLength(GUIDE_CAPS.maxParagraphs);
  });

  it("is measured on B's fixture: 34 paragraphs, the allowance 1,730 and 2,030 tokens, about 220 more tokens in", () => {
    const chars = (p: { systemPrompt: string; userPrompt: string }) => p.systemPrompt.length + p.userPrompt.length;

    expect(candidates).toHaveLength(34);
    expect(gistMaxTokens(34)).toBe(1730);
    expect(gistMaxTokens(34, true)).toBe(2030);
    // The rules and the schema line: some 900 to 1,300 characters (about 220 tokens).
    expect(chars(withTrunk) - chars(without)).toBeGreaterThan(900);
    expect(chars(withTrunk) - chars(without)).toBeLessThan(1300);
  });
});

describe("the guide and its sanitizer are otherwise as they were", () => {
  it("leaves sanitizeParagraphGuide to the gists: a partition in the answer is not a gist", () => {
    const candidates = gistCandidates(unheaded);
    const got = sanitizeParagraphGuide(
      { partition: [{ role: "introduction", fromParagraph: 0 }], gists: [{ sectionId: "s0", paragraphIndex: 0, gist: "Invented paragraph about tide pools survey." }] },
      candidates,
    );

    expect(got).toEqual({ s0: { 0: "Invented paragraph about tide pools survey." } });
  });

  it("keeps a partition with the guide in the server's memory, under the document's hash alone", () => {
    const cache = createParagraphGuideCache({ now: () => 0 });
    const guide: ParagraphGuide = {
      docHash: "h",
      gists: {},
      partition: { sectionId: "s0", parts: [{ role: "introduction", fromParagraph: 0, toParagraph: 4 }, { role: "results", fromParagraph: 5, toParagraph: 9 }] },
    };
    cache.set("h", guide);

    expect(cache.get("h")).toEqual(guide);
    expect(Object.keys(cache.get("h")!).sort()).toEqual(["docHash", "gists", "partition"]);
  });
});
