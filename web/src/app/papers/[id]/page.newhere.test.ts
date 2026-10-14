import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P9-27 (the owner's decision, §1a.18 (b)): "What is new here" stands on the Summary tab, as a block of its
// own directly after the words that open the Summary and before "What it proposes". The page cannot be
// rendered whole in a test (`page.test.tsx` says why), so the page's wiring is read from its source, as the
// siblings do; `report-sections.newhere.test.tsx` renders the blocks themselves in this order.

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

const count = (text: string, part: string) => text.split(part).length - 1;
const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  if (start < 0) return "";
  const end = text.indexOf(to, start + from.length);
  return end < 0 ? "" : text.slice(start, end);
};
/** The JSX comments out and the whitespace folded, so what is left is the blocks in the order they stand. */
const bare = (text: string) => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\s+/g, " ").trim();

function newHereProblems(code: string): string[] {
  const problems: string[] = [];
  if (count(code, "<NewHereBlock") !== 1) problems.push("the block is not on the page exactly once");
  const additions = between(code, " additions={", " next={");
  const split = additions.indexOf(") : (");
  const onDigestion = split < 0 ? "" : additions.slice(0, split);
  const onSummary = split < 0 ? "" : additions.slice(split);
  if (!onSummary.includes("<NewHereBlock")) problems.push("the block is not under Summary");
  if (onDigestion.includes("<NewHereBlock")) problems.push("the block is also under Paper digestion");

  const here = onSummary.indexOf("<NewHereBlock");
  const proposal = onSummary.indexOf("<ProposalBlock");
  if (!(here >= 0 && here < proposal)) problems.push("the block is not before \"What it proposes\"");

  // Directly after the words that open the Summary (they are the `words` slot, above the additions): the
  // first block of the Summary's own, bar the answers of a paper with no body, which stay first (P7-14, Q6).
  // Re-aimed (P10-08): the Summary's blocks stand in one explain container, `<div data-explain-source="summary" className="contents">` (was a fragment).
  const OPEN = 'data-explain-source="summary" className="contents">';
  const before = here < 0 ? "" : bare(onSummary.slice(onSummary.indexOf(OPEN) + OPEN.length, here));
  if (before !== "{!hasBody && answers} {report && (") {
    problems.push("something stands between the words that open the Summary and the block, or it is drawn with no report to read it from");
  }

  const props = here < 0 ? "" : onSummary.slice(here, onSummary.indexOf("/>", here));
  if (!props.includes("report={report}")) problems.push("the block is not fed the report");
  if (!props.includes("scramble={shouldScrambleReport}")) problems.push("the block does not scramble in with the rest of the report");
  if (!props.includes("stagger={stagger++}")) problems.push("the block is not in the blocks' reveal order");
  return problems;
}

/** The block's own call, as the page writes it (with the report guard around it). */
const CALL = /\{report && \(\s*<NewHereBlock[^>]*\/>\s*\)\}\s*/;

describe("the page's 'What is new here' block (P9-27)", () => {
  it("is wired as the owner's decision says: on the Summary, after the opening words, before 'What it proposes'", () => {
    expect(newHereProblems(source)).toEqual([]);
  });

  it("would notice the block drawn after 'What it proposes'", () => {
    const call = source.match(CALL)?.[0] ?? "";
    const wrong = source.replace(CALL, "").replace("{methods.length > 0 ? (", `${call}{methods.length > 0 ? (`);

    expect(call).not.toBe("");
    expect(wrong).not.toBe(source);
    expect(newHereProblems(wrong)).toEqual(expect.arrayContaining(["the block is not before \"What it proposes\""]));
  });

  it("would notice the block drawn with no report to read it from", () => {
    const wrong = source.replace(/\{report && \(\s*<NewHereBlock/, "{(\n              <NewHereBlock");

    expect(wrong).not.toBe(source);
    expect(newHereProblems(wrong)).toEqual(
      expect.arrayContaining([
        "something stands between the words that open the Summary and the block, or it is drawn with no report to read it from",
      ]),
    );
  });

  it("would notice something placed between the opening words and the block", () => {
    const wrong = source.replace("{report && (\n              <NewHereBlock", "<GlanceBlock paper={paper} now={now} stagger={stagger++} />\n            {report && (\n              <NewHereBlock");

    expect(wrong).not.toBe(source);
    expect(newHereProblems(wrong)).toEqual(
      expect.arrayContaining([
        "something stands between the words that open the Summary and the block, or it is drawn with no report to read it from",
      ]),
    );
  });

  it("would notice a second copy of the block", () => {
    const wrong = source.replace("<ProposalBlock", "<NewHereBlock report={report!} stagger={stagger++} />\n              <ProposalBlock");

    expect(wrong).not.toBe(source);
    expect(newHereProblems(wrong)).toEqual(expect.arrayContaining(["the block is not on the page exactly once"]));
  });

  it("would notice the block under Paper digestion too", () => {
    const wrong = source.replace("<PaperBody reading", "{report && <NewHereBlock report={report} stagger={0} />}<PaperBody reading");

    expect(wrong).not.toBe(source);
    expect(newHereProblems(wrong)).toEqual(expect.arrayContaining(["the block is also under Paper digestion"]));
  });

  it("keeps the proposal, with its figure, on the Summary", () => {
    const additions = between(source, " additions={", " next={");
    const onSummary = additions.slice(additions.indexOf(") : ("));

    expect(onSummary).toContain("<ProposalBlock");
    expect(onSummary).toContain("figure={proposalFigure}");
  });
});
