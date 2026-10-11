import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P7-13 (R11b, the owner's R11): the page's wiring of the reader's questions. `Reader` cannot be
// mounted in this Node-only suite, so — as the explain, terms and upload-skip wiring tests do —
// this reads the page's source and holds each join to its shape: the page takes its copy of the
// questions from `useDebouncedQuestions` (250 ms after the typing stops) and never subscribes to
// the store's `byPaper` itself (that re-rendered the whole page on every keystroke, 290-320 ms a
// key in the browser), the example tags read the same debounced map, and the Terms-to-know scan is
// keyed on the SET of sections it reads (`termScopeKey`), not on a scope object that is new on
// every route. The checker is also run on mutated copies of the source, so the test proves it would
// notice what it guards: green on the page, red on each.

/** What is wrong with the questions wiring of a page `source`; empty when it is right. */
function questionsProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  const calls = text.split("useDebouncedQuestions(").length - 1;
  if (calls !== 1) problems.push(`the page reads the debounced questions ${calls} times, not once`);
  if (!text.includes("const { asked, byPaper: askedByPaper } = useDebouncedQuestions(paper.id);")) {
    problems.push("the page no longer takes `asked` and the map from `useDebouncedQuestions(paper.id)`");
  }
  if (!/from "@\/components\/reader\/use-debounced-questions"/.test(text)) problems.push("the hook is not imported from the reader's components");

  // No subscription of its own: a selector on the store re-renders the page on every keystroke.
  if (/useReadingQuestionsStore\s*\(/.test(text)) problems.push("the page subscribes to the question store itself (it re-renders on every keystroke)");
  if (/useReadingQuestionsStore\.subscribe/.test(text)) problems.push("the page subscribes to the question store itself, outside the hook");

  // The route, the examples and the settled questions all read what the hook gave.
  if (!text.includes("readingRoute(reading, asked)")) problems.push("the route is no longer drawn from the page's `asked`");
  if (!text.includes("exampleQuestions({ profile, byPaper: askedByPaper, paperId: paper.id })")) problems.push("the example tags no longer read the debounced map");
  if (!text.includes("questions: settledQuestions(asked)")) problems.push("the deep report is no longer asked about the settled questions of `asked`");

  // The terms scan: keyed on the set of sections.
  if (!text.includes("const scopeKey = useMemo(() => termScopeKey(routeTermScope(route)), [route]);")) {
    problems.push("the term scope is no longer made from the route, as a key");
  }
  if (!/const tier0Terms = useMemo\( \(\) => \(reading \? paperDefinedTermsInReading\(reading, termScopeOfKey\(scopeKey\)\) : \[\]\), \[reading, scopeKey\], \);/.test(text)) {
    problems.push("the Terms-to-know scan is no longer keyed on the set of sections it reads");
  }
  if (/\[reading, termScope\]/.test(text)) problems.push("the Terms-to-know scan is keyed on a scope object, new on every route");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the reading page's questions (P7-13, R11b)", () => {
  it("is wired as the ruling says", () => {
    expect(questionsProblems(source)).toEqual([]);
  });

  it("would notice the page subscribing to the store again", () => {
    const wrong = source.replace("const { asked, byPaper: askedByPaper } = useDebouncedQuestions(paper.id);", "const asked = useReadingQuestionsStore((state) => state.byPaper[paper.id]);\n  const askedByPaper = useReadingQuestionsStore((state) => state.byPaper);");

    expect(wrong).not.toBe(source);
    expect(questionsProblems(wrong)).toContain("the page subscribes to the question store itself (it re-renders on every keystroke)");
  });

  it("would notice a second subscription for the example tags", () => {
    const wrong = source.replace("exampleQuestions({ profile, byPaper: askedByPaper, paperId: paper.id })", "exampleQuestions({ profile, byPaper: useReadingQuestionsStore.getState().byPaper, paperId: paper.id })");

    expect(wrong).not.toBe(source);
    expect(questionsProblems(wrong)).toContain("the example tags no longer read the debounced map");
  });

  it("would notice the scan keyed on the scope object again", () => {
    const wrong = source.replace("[reading, scopeKey],", "[reading, termScope],");

    expect(wrong).not.toBe(source);
    expect(questionsProblems(wrong)).toContain("the Terms-to-know scan is keyed on a scope object, new on every route");
  });

  it("would notice the hook no longer imported", () => {
    const wrong = source.replace('from "@/components/reader/use-debounced-questions"', 'from "@/components/reader/somewhere-else"');

    expect(wrong).not.toBe(source);
    expect(questionsProblems(wrong)).toContain("the hook is not imported from the reader's components");
  });
});
