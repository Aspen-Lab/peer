import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P7-14 (the owner's review R2 / R5 / R9 / R10): the page's wiring of the new layout. `Reader`
// cannot be mounted in this Node-only suite, so — as the upload-skip, terms and explain wiring
// tests do — this reads the page's source and holds each join to its shape. Each section below
// belongs to one step of the item; the checker is also run on mutated copies of the source, so
// the test proves it would notice what it guards: green on the page, red on each.

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
const text = (s: string) => s.replace(/\s+/g, " ");

/** What is wrong with the decided-read observer of a page `source`; empty when it is right. */
function decidedProblems(source: string): string[] {
  const code = text(source);
  const problems: string[] = [];
  const start = code.indexOf("const decisionRef = useRef");
  const end = code.indexOf("useReveal(", start);
  const block = start < 0 || end < 0 ? "" : code.slice(start, end);
  if (!block) return ["the decided-read observer moved"];
  // The decision follows the title in both layouts (R2), so it is on screen at open: the observer
  // must not watch it when the abstract's footer exists, in one column or on the spread.
  if (!block.includes("wordsEndRef.current ?? decisionRef.current")) problems.push("the observer no longer watches the abstract's footer before the decision block");
  if (/spread \? \(?wordsEndRef/.test(block)) problems.push("the observer still chooses the abstract's footer by the layout: in one column it would watch the decision block, which is on screen at open");
  return problems;
}

describe("the page's decided-read observer (P7-14, R2 / Q1)", () => {
  it("watches the abstract's footer in both layouts, the decision block only without one", () => {
    expect(decidedProblems(source)).toEqual([]);
  });

  it("would notice the one-column page watching the decision block again", () => {
    const wrong = source.replace("const el = wordsEndRef.current ?? decisionRef.current;", "const el = spread ? (wordsEndRef.current ?? decisionRef.current) : decisionRef.current;");

    expect(wrong).not.toBe(source);
    expect(decidedProblems(wrong)).toContain("the observer still chooses the abstract's footer by the layout: in one column it would watch the decision block, which is on screen at open");
  });

  it("would notice the observer watching the decision block first", () => {
    const wrong = source.replace("wordsEndRef.current ?? decisionRef.current", "decisionRef.current ?? wordsEndRef.current");

    expect(wrong).not.toBe(source);
    expect(decidedProblems(wrong)).toContain("the observer no longer watches the abstract's footer before the decision block");
  });
});
