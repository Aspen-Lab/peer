import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-40 (round 2, Theme B weighed (b); ruling §1h.138 (c)): the page's wiring of Escape, nearest first. `Reader` cannot be mounted in this Node-only suite, so —
// as the Explain wiring test does — this reads the page's source and holds each join to its shape; the behaviour itself (the selection first, then the front
// card, then the briefing; a field keeps its Escape; Backspace is back) is `components/reader/selection-escape.flow.test.tsx`, run on the real cards. What the page
// owes: it hands `useSelectionEscape` its selection — one stands while the page holds one (`explainTarget`), and putting it away is letting go of the document's
// selection and of the page's hold, so the buttons go with it and nothing else does — in the hooks, before its early return; and "back" stays what it was
// (`back`, registered under the one `back` action the keyboard layer calls for Escape and for Backspace), so the legend's "Esc BACK" is still true when
// nothing is left. The checker is also run on mutated copies of the source, so the test proves it would notice what it guards: green on the page, red on each.

/** The text of the balanced `{ … }` that opens at `from` in `text`, braces included; "" when it does not close. */
function braces(text: string, from: number): string {
  let depth = 0;
  for (let at = from; at < text.length; at += 1) {
    if (text[at] === "{") depth += 1;
    else if (text[at] === "}" && --depth === 0) return text.slice(from, at + 1);
  }
  return "";
}

/** What is wrong with the Escape wiring of a page `source`; empty when it is right. */
function escapeProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!/import \{[^}]*\buseSelectionEscape\b[^}]*\} from "@\/components\/reader\/front-escape";/.test(text)) problems.push("the page does not import `useSelectionEscape` from `front-escape`");
  const calls = text.split("useSelectionEscape(").length - 1;
  if (calls !== 1) problems.push(`the page calls \`useSelectionEscape\` ${calls} times, not once`);
  const at = text.indexOf("useSelectionEscape({");
  const call = at < 0 ? "" : braces(text, at + "useSelectionEscape(".length);
  if (at >= 0 && call === "") problems.push("the call to `useSelectionEscape` is not an object of the page's own closures");
  if (call !== "") {
    if (!call.includes("standing: () => explainTarget !== null")) problems.push("a selection no longer stands exactly while the page holds one (`explainTarget`)");
    const end = /end: \(\) => \{.*\}/.exec(call)?.[0] ?? "";
    if (!end) problems.push("`end` is no longer a function of the page's own");
    else {
      if (!end.includes("window.getSelection()?.removeAllRanges()")) problems.push("putting the selection away no longer lets go of the document's selection");
      if (!end.includes("selectExplain(null)")) problems.push("putting the selection away no longer lets go of the page's hold, so the buttons would stay until the selection's own change was read");
    }
    // A hook: in the hooks, before the early return (`if (!reading) return null;`), after the explain state it reads.
    if (at > text.indexOf("if (!reading) return null;")) problems.push("`useSelectionEscape` is called after the page's early return: a hook that sometimes does not run");
    if (at < text.indexOf("const [explainTarget, setExplainTarget]")) problems.push("`useSelectionEscape` is called before the selection state it reads");
  }

  // "Back" is what it was, and one action serves Escape and Backspace (`reader-keys.ts`): nothing in it asks which key it was.
  if (!text.includes('const back = () => { if (hasImmediateFeedHistoryEntry(window)) router.back(); else router.push("/"); };')) problems.push("`back` is no longer the page's back to the briefing");
  const actions = /const actions: ReaderActions = \{.*?\};/.exec(text)?.[0] ?? "";
  if (!/\bcopy, back, \}/.test(actions) && !/\bcopy, back \}/.test(actions)) problems.push("`back` is no longer registered with the keyboard layer");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's Escape wiring (P11-40)", () => {
  it("is as the ruling says", () => {
    expect(escapeProblems(source)).toEqual([]);
  });

  it("would notice the hook gone", () => {
    const gone = source.replace(/ {2}useSelectionEscape\(\{[\s\S]*?\n {2}\}\);\n/, "");
    expect(gone).not.toBe(source);
    const problems = escapeProblems(gone);
    expect(problems).toContain("the page calls `useSelectionEscape` 0 times, not once");
  });

  it("would notice a selection that no longer stands while the page holds one", () => {
    const wrong = source.replace("standing: () => explainTarget !== null", "standing: () => true");
    expect(wrong).not.toBe(source);
    expect(escapeProblems(wrong)).toEqual(["a selection no longer stands exactly while the page holds one (`explainTarget`)"]);
  });

  it("would notice the document's selection left standing, and the page's hold left on", () => {
    const left = source.replace("window.getSelection()?.removeAllRanges();", "");
    expect(left).not.toBe(source);
    expect(escapeProblems(left)).toEqual(["putting the selection away no longer lets go of the document's selection"]);
    const held = source.replace(/( {6})selectExplain\(null\);\n( {4}\},\n {2}\}\);)/, "$2");
    expect(held).not.toBe(source);
    expect(escapeProblems(held)).toEqual(["putting the selection away no longer lets go of the page's hold, so the buttons would stay until the selection's own change was read"]);
  });

  it("would notice the hook after the early return, or before the state it reads", () => {
    const hook = /( {2}\/\/ P11-40[\s\S]*?\n {2}useSelectionEscape\(\{[\s\S]*?\n {2}\}\);\n)/.exec(source)?.[1] ?? "";
    expect(hook).not.toBe("");
    const late = source.replace(hook, "").replace("  if (!reading) return null;\n", `  if (!reading) return null;\n${hook}`);
    expect(escapeProblems(late)).toEqual(["`useSelectionEscape` is called after the page's early return: a hook that sometimes does not run"]);
  });

  it("would notice `back` changed, or no longer registered", () => {
    // Only `back`'s own words are looked at here: the hook's are the other tests'.
    const ofBack = (problems: string[]) => problems.filter((problem) => problem.startsWith("`back`"));
    const changed = source.replace('else router.push("/");', 'else router.push("/papers");');
    expect(changed).not.toBe(source);
    expect(ofBack(escapeProblems(changed))).toEqual(["`back` is no longer the page's back to the briefing"]);
    const dropped = source.replace(/\n {6}copy,\n {6}back,\n/, "\n      copy,\n");
    expect(dropped).not.toBe(source);
    expect(ofBack(escapeProblems(dropped))).toEqual(["`back` is no longer registered with the keyboard layer"]);
  });
});
