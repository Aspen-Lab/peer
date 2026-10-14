import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P7-14 (the owner's review R2 / R5 / R9 / R10): the page's wiring of the new layout. `Reader`
// cannot be mounted in this Node-only suite, so — as the upload-skip, terms and explain wiring
// tests do — this reads the page's source and holds each join to its shape. Each section below
// belongs to one step of the item; the checker is also run on mutated copies of the source, so
// the test proves it would notice what it guards: green on the page, red on each.

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
/** The source as one line of code: comments dropped, whitespace folded. */
const text = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");

/**
 * What is wrong with the decided-read observer of a page `source`; empty when it is right.
 * Re-aimed (P10-49): the effect's list also holds `paper.id`, which the "already decided" check it hands
 * `watchForDecision` reads; the tab is still one of the things that re-arms it.
 */
function decidedProblems(source: string): string[] {
  const code = text(source);
  const problems: string[] = [];
  const start = code.indexOf("const decisionRef = useRef");
  const end = code.indexOf("useReveal(", start);
  const block = start < 0 || end < 0 ? "" : code.slice(start, end);
  if (!block) return ["the decided-read observer moved"];
  // The decision follows the title in both layouts (R2), so it is on screen at open: the observer
  // must not watch it when something later on the page exists, in one column or on the spread.
  // R10: on Paper digestion the abstract is not mounted; the end of the common blocks stands in.
  if (!block.includes('const el = (hasBody && tab === "digestion" ? commonEndRef.current : wordsEndRef.current) ?? decisionRef.current;')) {
    problems.push("the observer no longer watches the common blocks' end on Paper digestion, the abstract's footer on Summary, the decision block only without either");
  }
  if (/spread \? \(?wordsEndRef/.test(block)) problems.push("the observer still chooses the abstract's footer by the layout: in one column it would watch the decision block, which is on screen at open");
  if (!/\}, \[decide, paper\.id, spread, reading, tab, hasBody\]\);/.test(block)) problems.push("the observer is not re-armed when the tab changes (the footer it watches is on the other tab)");
  return problems;
}

describe("the page's decided-read observer (P7-14, R2 / Q1)", () => {
  it("watches the abstract's footer in both layouts, the decision block only without one", () => {
    expect(decidedProblems(source)).toEqual([]);
  });

  it("would notice the one-column page watching the decision block again", () => {
    const wrong = source.replace(
      'const el = (hasBody && tab === "digestion" ? commonEndRef.current : wordsEndRef.current) ?? decisionRef.current;',
      "const el = spread ? (wordsEndRef.current ?? decisionRef.current) : decisionRef.current;",
    );

    expect(wrong).not.toBe(source);
    expect(decidedProblems(wrong)).toContain("the observer still chooses the abstract's footer by the layout: in one column it would watch the decision block, which is on screen at open");
  });

  it("would notice the observer watching the decision block first", () => {
    const wrong = source.replace("wordsEndRef.current) ?? decisionRef.current;", "wordsEndRef.current) ?? decisionRef.current ?? wordsEndRef.current;").replace("(hasBody && tab ===", "decisionRef.current ?? (hasBody && tab ===");

    expect(wrong).not.toBe(source);
    expect(decidedProblems(wrong)).toHaveLength(1);
  });

  it("would notice the observer not re-armed by the tab", () => {
    const wrong = source.replace("[decide, paper.id, spread, reading, tab, hasBody]", "[decide, paper.id, spread, reading]");

    expect(wrong).not.toBe(source);
    expect(decidedProblems(wrong)).toEqual(["the observer is not re-armed when the tab changes (the footer it watches is on the other tab)"]);
  });
});

// ── R10: the two tabs ─────────────────────────────────────────────────────────────────────────

/** The text of `source` between `from` and the first `to` after it (both included), or "". */
function between(code: string, from: string, to: string): string {
  const start = code.indexOf(from);
  const end = start < 0 ? -1 : code.indexOf(to, start + from.length);
  return start < 0 || end < 0 ? "" : code.slice(start, end + to.length);
}
const count = (code: string, needle: string) => code.split(needle).length - 1;

/** What is wrong with the tab wiring of a page `source`; empty when it is right. */
function tabProblems(source: string): string[] {
  const code = text(source);
  const problems: string[] = [];
  const has = (needle: string, why: string) => {
    if (!code.includes(needle)) problems.push(why);
  };

  // The state is the hook's: one call, a body to have tabs, the explain card cleared by every change.
  has('from "@/components/reader/use-reader-tab"', "the tab hook is not imported");
  has("const { tab, select: selectTab, reveal } = useReaderTab({ hasBody, onChange: clearExplain, atStart: startOfTab });", "the page no longer takes its tab from `useReaderTab`, with a body, the explain card cleared and a start of the tab");
  if (count(code, "useReaderTab(") !== 1) problems.push("the page does not call `useReaderTab` exactly once");
  has("const clearExplain = useCallback(() => selectExplain(null), [selectExplain]);", "a tab change no longer clears the open \"Explain this?\" card");
  has('const digestion = hasBody && tab === "digestion";', "`digestion` is no longer \"a body, and its tab\"");

  // The strip: only with a body, under the decision block (the layout places it).
  has("tabs={hasBody ? <ReaderTabs tab={tab} onSelect={selectTab} /> : undefined}", "the strip is not drawn exactly when there is a body, from the hook's tab and pick");
  has("tab={hasBody ? tab : undefined}", "the layout is not told the tab on show");

  // Q6: ONE field and ONE set of answers, in the common slot, which does not read the tab.
  const common = between(code, "common={", " words={");
  if (!common) problems.push("the `common` slot moved");
  else {
    if (count(common, "<QuestionField") !== 1) problems.push("\"Before you read\" is not in the common slot exactly once");
    if (!common.includes("<QuestionField key={paper.id} paperId={paper.id}")) problems.push("the question field is no longer keyed by the paper alone (a tab would remount it)");
    if (count(code, "<QuestionField") !== 1) problems.push("the question field is mounted more than once on the page");
    if (!common.includes("{answers}")) problems.push("the answers are not in the common slot");
    if (!common.includes("ref={commonEndRef}")) problems.push("the common slot has no end for the decided-read observer");
    if (/\btab\b|digestion|summary/i.test(common.replace(/summary-?[a-z]*/gi, "").replace(/Summary/g, ""))) problems.push("the common slot depends on the tab: a switch would remount the field or clear what was typed");
    if (!common.startsWith("common={hasBody ?")) problems.push("the common slot is not drawn exactly when there is a body");
  }
  if (count(code, "<ForYourQuestions") !== 1) problems.push("the answers are not built exactly once");
  has("const answers = report?.forYourQuestions ? <ForYourQuestions report={report} map={reading.map} /> : null;", "the answers block is not built from the report's forYourQuestions");
  if (!code.includes("{!hasBody && answers}")) problems.push("a paper with no body no longer shows its answers first in the additions, as before");

  // P10-02 (ruling §1h.78): "Terms to know" is deleted; the layout has no `terms` slot and the page hands it none.
  if (/terms=\{ hasBody/.test(code) || code.includes("<TermsStrip")) problems.push("a `terms` slot or the Terms to know strip is back on the page");

  // The tab's own blocks: the abstract under Summary only; the map and the body under Digestion only.
  const words = between(code, " words={", " additions={");
  // Re-aimed (P10-08): the abstract's words stand in the Summary's explain container (`data-explain-source="summary"`).
  if (!/^ words=\{digestion \? null : \( <div data-explain-source="summary" className="contents"> <PaperWords/.test(words)) problems.push("the abstract is shown on Paper digestion, or the words slot moved");
  const additions = between(code, " additions={", " next={");
  const split = additions.indexOf(") : (");
  const onDigestion = split < 0 ? "" : additions.slice(0, split);
  const onSummary = split < 0 ? "" : additions.slice(split);
  if (!additions.startsWith(" additions={digestion ? (")) problems.push("the additions are not chosen by the tab");
  // P10-04, RE-AIMED (review 3.1): the map left the additions for the layout's own `map` slot, directly under
  // the strip and under BOTH tabs; the body alone is Paper digestion's.
  for (const block of ["<PaperBody"]) {
    if (!onDigestion.includes(block)) problems.push(`${block} is not under Paper digestion`);
    if (onSummary.includes(block)) problems.push(`${block} is also under Summary`);
  }
  // P10-07b, RE-AIMED: the map the slot draws is the partition's overlay of the reading's map (`shownMap`, defined exactly when the reading has a map).
  // (P10-02 deleted the `terms` slot that used to follow the map prop; the map line ends on its own `: undefined}`.)
  const mapSlot = between(code, " map={hasBody", " : undefined}");
  if (!mapSlot.startsWith(" map={hasBody && shownMap ? <ReadingMapView")) problems.push("the map is not drawn in the layout's `map` slot exactly when there is a body and a map");
  if (count(code, "<ReadingMapView") !== 1) problems.push("the map is not mounted exactly once");
  if (/\btab\b|digestion/.test(mapSlot)) problems.push("the map slot depends on the tab: it is shown under both");
  if (!mapSlot.includes("reveal={reveal}")) problems.push("a row of the map cannot bring the body in from Summary");
  if (onSummary.includes("<ReadingMapView") || onDigestion.includes("<ReadingMapView")) problems.push("<ReadingMapView is among a tab's blocks again");
  // P9-27: "What is new here" is a block of the Summary now, ahead of "What it proposes".
  for (const block of ["<NewHereBlock", "<ProposalBlock", "<ClaimList", "<GlanceBlock", "<RelatedBlock", "<RecordBlock", "<InYourLibrary"]) {
    if (!onSummary.includes(block)) problems.push(`${block} is not under Summary`);
    if (onDigestion.includes(block)) problems.push(`${block} is also under Paper digestion`);
  }
  // R9: the notes are a button (the right-edge tab, and a row in the command stack on a phone), not a
  // block of either tab: they are there under both.
  if (onSummary.includes("<PaperNotes") || onDigestion.includes("<PaperNotes")) problems.push("the notes are a band in a tab again: they are a button, under both tabs");

  // The jumps into the body.
  has("const readHere = useCallback(() => reveal(scrollToBody), [reveal, scrollToBody]);", "\"Read it here\" / t no longer brings the body in from Summary first");
  has("<SectionLinks headings={bodyHeadings} reveal={reveal}>", "the § links cannot bring the body in from Summary");

  // The reveal of newly mounted blocks follows the tab.
  has("useReveal([reading, report, spread, tab]);", "the blocks a tab mounts are not armed for their approach");
  return problems;
}

describe("the page's two tabs (P7-14, R10)", () => {
  it("is wired as the owner's answers say", () => {
    expect(tabProblems(source)).toEqual([]);
  });

  it("would notice the question field mounted a second time (one per tab)", () => {
    const wrong = source.replace("{answers}", "{answers}{tab === \"summary\" && <QuestionField key={paper.id} paperId={paper.id} examples={examples} standing={profile.standingQuestions} vague={false} />}");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(expect.arrayContaining(["the question field is mounted more than once on the page"]));
  });

  it("would notice the common slot reading the tab", () => {
    const wrong = source.replace("{answers}", "{tab === \"digestion\" && answers}");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(expect.arrayContaining(["the common slot depends on the tab: a switch would remount the field or clear what was typed"]));
  });

  it("would notice the question field keyed by the tab", () => {
    const wrong = source.replace("<QuestionField key={paper.id}", "<QuestionField key={`${paper.id}:${tab}`}");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(expect.arrayContaining(["the question field is no longer keyed by the paper alone (a tab would remount it)"]));
  });

  it("would notice the map or the body moved under Summary", () => {
    const wrong = source.replace("<InYourLibrary paper={paper} />", "<PaperBody reading={reading} />\n<InYourLibrary paper={paper} />");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(expect.arrayContaining(["<PaperBody is also under Summary"]));
  });

  it("would notice the notes band put back among a tab's blocks (R9: it is a button now)", () => {
    const wrong = source.replace("<InYourLibrary paper={paper} />", "<PaperNotes paper={paper} />\n<InYourLibrary paper={paper} />");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(["the notes are a band in a tab again: they are a button, under both tabs"]);
  });

  it("would notice the abstract shown on Paper digestion", () => {
    const wrong = source.replace("words={digestion ? null : (", "words={(");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(expect.arrayContaining(["the abstract is shown on Paper digestion, or the words slot moved"]));
  });

  it("would notice the default tab or the tab strip's condition changed", () => {
    const noBody = source.replace("tabs={hasBody ? <ReaderTabs", "tabs={<ReaderTabs");

    expect(noBody).not.toBe(source);
    expect(tabProblems(noBody)).toEqual(["the strip is not drawn exactly when there is a body, from the hook's tab and pick"]);
  });

  it("would notice 'Read it here' no longer bringing the body in", () => {
    const wrong = source.replace("useCallback(() => reveal(scrollToBody), [reveal, scrollToBody])", "useCallback(() => scrollToBody(), [scrollToBody])");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(["\"Read it here\" / t no longer brings the body in from Summary first"]);
  });

  it("would notice the § links unable to switch tab", () => {
    expect(tabProblems(source.replace("<SectionLinks headings={bodyHeadings} reveal={reveal}>", "<SectionLinks headings={bodyHeadings}>"))).toEqual(["the § links cannot bring the body in from Summary"]);
  });

  it("would notice a tab change no longer clearing the explain card", () => {
    const wrong = source.replace("onChange: clearExplain,", "");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toContain("the page no longer takes its tab from `useReaderTab`, with a body, the explain card cleared and a start of the tab");
  });

  it("would notice the revealed blocks no longer re-armed by the tab", () => {
    const wrong = source.replace("useReveal([reading, report, spread, tab]);", "useReveal([reading, report, spread]);");

    expect(wrong).not.toBe(source);
    expect(tabProblems(wrong)).toEqual(["the blocks a tab mounts are not armed for their approach"]);
  });
});
