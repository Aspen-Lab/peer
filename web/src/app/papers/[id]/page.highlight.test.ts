import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-17b (owner item 8; B P11-04 §5–§6; B P11-03 §4 C-2; C P11-14's defect (c); rulings §1h.112, §1h.113, §1h.117): the page's wiring of Highlight,
// of the colour strip in the margin, and of the blue square for a Summary or an answer note. `Reader` cannot be mounted in this Node-only suite, so —
// like `page.figure.test.ts` and `page.sticky.test.ts` — this reads the source and holds each join to its shape, and runs the checker on mutated copies
// so it proves it would notice what it guards.
//
//   rule 1  the page's `useHighlight` is the toolbar's `onHighlight` (offered for the paper's body only, never gated by `canExplain`: no key is needed),
//           and the `h` key's and the phone's Highlight cell's action;
//   rule 2  `HighlightStripHost` once, keyed by the paper, outside the zoom container and the section links, beside the figure host; a click on a
//           mark raises the strip at the mark's first line;
//   rule 3  every block of the Summary stands under a stable, unique id the selection reports (`SummaryBlock`), and the page tells the notes' blue
//           square how to bring the Summary tab back (`useSummaryHost`).

const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

const squash = (text: string) => text.replace(/\s+/g, " ");
const count = (text: string, part: string) => text.split(part).length - 1;
const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  if (start < 0) return "";
  const end = text.indexOf(to, start + from.length);
  return end < 0 ? "" : text.slice(start, end);
};

/** The Summary's report blocks the page wraps, by the key of their id in `SUMMARY_ID`. */
const WRAPPED = ["newHere", "proposal", "method", "results", "forYou", "glance", "related", "caveats", "nextStep", "record", "library"] as const;

// ── Rule 1 ─────────────────────────────────────────────────────────────────

const USE_HIGHLIGHT =
  "const highlight = useHighlight({ paper, questions: settledQuestions(asked), forYourQuestions: report?.forYourQuestions, body: reading?.body });";
const KEYS = "...(hasBody ? selectionActions(() => explainTarget, { note: takeNote, highlight }) : {}),";

function rule1Problems(source: string): string[] {
  const p = squash(source);
  const problems: string[] = [];
  if (!p.includes('import { canHighlight, useHighlight } from "@/components/notes/highlight";')) problems.push("the page does not import canHighlight and useHighlight from the notes' highlight module");
  if (!p.includes(USE_HIGHLIGHT)) problems.push("the page has no highlight action built from the paper, the questions, the answers and the body");
  if (count(p, "useHighlight(") !== 1) problems.push("the page does not call useHighlight exactly once");
  // Beside `takeNote`: the same shape, the same inputs.
  if (p.indexOf(USE_HIGHLIGHT) < p.indexOf("const takeNote = useTakeNote(")) problems.push("the highlight action does not stand after the take-note action it is built beside");
  const bar = between(p, "<SelectionToolbar", "/>") + "/>";
  if (count(p, "<SelectionToolbar") !== 1) problems.push("the selection buttons are not mounted exactly once");
  if (!bar.includes("onHighlight={highlight}")) problems.push("the toolbar is not handed the highlight action");
  if (!bar.includes("canHighlight={canHighlight(explainTarget)}")) problems.push("the toolbar is not told whether the selection can be highlighted (`canHighlight`'s gate: the paper's body, a Summary block, an answer)");
  // Tier 0: Highlight is not a model's act. It is never gated by the explain check.
  const gate = between(bar, "canHighlight={", "}");
  if (/canExplain|canAsk|explainCanAsk|selectionCanExplain|profile|key/i.test(gate)) problems.push("Highlight is gated by the page's ability to explain: it needs no key");
  // Explain and take-notes stay as they were.
  if (!bar.includes("canExplain={selectionCanExplain({ canAsk: explainCanAsk, terms, passage: explainTarget?.unavailableReason ? null : explainTarget?.passage ?? null })}")) problems.push("the toolbar's explain gate moved");
  if (!bar.includes("onTakeNote={takeNote}")) problems.push("the toolbar's take-note action moved");
  // `h` and the phone's Highlight cell call the registered action.
  if (!p.includes(KEYS)) problems.push("the h key (and the phone's Highlight cell) is not registered with the page's highlight action");
  return problems;
}

describe("rule 1 — Highlight on the page", () => {
  it("is right on the source", () => {
    expect(rule1Problems(page)).toEqual([]);
  });

  it("notices each join taken out", () => {
    const cases: [string, () => string[]][] = [
      ["no import", () => rule1Problems(page.replace('import { canHighlight, useHighlight } from "@/components/notes/highlight";', ""))],
      ["no action", () => rule1Problems(page.replace(USE_HIGHLIGHT, ""))],
      ["no body", () => rule1Problems(page.replace(USE_HIGHLIGHT, USE_HIGHLIGHT.replace(", body: reading?.body", "")))],
      ["not handed to the toolbar", () => rule1Problems(page.replace(" onHighlight={highlight}", ""))],
      ["not told whether", () => rule1Problems(page.replace(" canHighlight={canHighlight(explainTarget)}", ""))],
      ["gated by the key", () => rule1Problems(page.replace("canHighlight={canHighlight(explainTarget)}", "canHighlight={explainCanAsk && canHighlight(explainTarget)}"))],
      ["gated by explain", () => rule1Problems(page.replace("canHighlight={canHighlight(explainTarget)}", "canHighlight={selectionCanExplain({ canAsk: explainCanAsk, terms, passage: null }) && canHighlight(explainTarget)}"))],
      ["no key h", () => rule1Problems(page.replace(KEYS, "...(hasBody ? selectionActions(() => explainTarget, { note: takeNote }) : {}),"))],
    ];
    for (const [name, run] of cases) expect(run().length, name).toBeGreaterThan(0);
  });
});

// ── Rule 2 ─────────────────────────────────────────────────────────────────

const STRIP_HOST = "<HighlightStripHost key={`highlight-strip:${paper.id}`} paperId={paper.id} />";
const FIGURE_HOST = "<FigureHost key={`figure:${paper.id}`} />";
const CLICK = "onHighlightClick={(id, rect) => useHighlightStrip.getState().show(id, rect.top)}";

function rule2Problems(source: string): string[] {
  const p = squash(source);
  const problems: string[] = [];
  if (count(p, "<HighlightStripHost") !== 1) problems.push(`the strip's host is mounted ${count(p, "<HighlightStripHost")} times, not once`);
  if (!p.includes(STRIP_HOST)) problems.push("the strip's host is not keyed by the paper (as highlight-strip:<paper id>) and handed the paper's id");
  if (p.includes("<HighlightStripHost key={paper.id}") || p.includes(`<HighlightStripHost key={\`figure:`)) problems.push("the strip's host has a sibling's key: two children with one key");
  if (!p.includes('import { HighlightStripHost } from "@/components/notes/highlight-strip-host";')) problems.push("the page does not import the strip's host");
  // Beside the figure host (after it: the figure host's own pin wants it right after the sticky notes).
  const figure = p.indexOf(FIGURE_HOST);
  const host = p.indexOf("<HighlightStripHost");
  if (figure < 0 || host < figure || host - figure > 600) problems.push("the strip's host does not stand beside the figure host");
  // Outside the page container (the Fit zoom would scale it) and outside the section links and the explain box's boundary.
  if (host < p.indexOf("</PageContainer>")) problems.push("the strip's host is inside the page container (the zoom root)");
  if (host < p.lastIndexOf("</SectionLinks>")) problems.push("the strip's host stands inside the section links");
  // A click on a mark raises the strip at the mark's first line.
  const body = between(p, "<PaperBody ", "/>") + "/>";
  if (count(p, "<PaperBody ") !== 1) problems.push("the paper's body is not mounted exactly once");
  if (!body.includes(CLICK)) problems.push("a click on a highlight's mark does not raise the strip at the mark's first line");
  if (!p.includes('import { useHighlightStrip } from "@/components/notes/highlight-strip";')) problems.push("the page does not import the strip's store");
  return problems;
}

describe("rule 2 — the strip in the margin", () => {
  it("is right on the source", () => {
    expect(rule2Problems(page)).toEqual([]);
  });

  it("mounts the host exactly once, keyed by the paper, after the figure host", () => {
    const p = squash(page);
    expect(count(p, "<HighlightStripHost")).toBe(1);
    expect(p.indexOf(STRIP_HOST)).toBeGreaterThan(p.indexOf(FIGURE_HOST));
    expect(count(p, "<FigureHost")).toBe(1);
  });

  it("leaves the lines the sticky and figure pins match as they were", () => {
    const p = squash(page);
    expect(p).toContain("<StickyNotes key={paper.id} paper={paper} reveal={reveal} />");
    expect(p).toContain(FIGURE_HOST);
    expect(p).toMatch(/<SectionLinks headings=\{bodyHeadings\}>.*<ExplainBox .*\/>.*<\/SectionLinks>/);
  });

  it("notices each join taken out", () => {
    const cases: [string, () => string[]][] = [
      ["unmounted", () => rule2Problems(page.replace(STRIP_HOST, ""))],
      ["not keyed", () => rule2Problems(page.replace(STRIP_HOST, "<HighlightStripHost paperId={paper.id} />"))],
      ["the stickies' key", () => rule2Problems(page.replace(STRIP_HOST, "<HighlightStripHost key={paper.id} paperId={paper.id} />"))],
      ["the figure host's key", () => rule2Problems(page.replace(STRIP_HOST, "<HighlightStripHost key={`figure:${paper.id}`} paperId={paper.id} />"))],
      ["mounted twice", () => rule2Problems(page.replace(STRIP_HOST, `${STRIP_HOST} ${STRIP_HOST}`))],
      ["not imported", () => rule2Problems(page.replace('import { HighlightStripHost } from "@/components/notes/highlight-strip-host";', ""))],
      ["before the figure host", () => rule2Problems(page.replace(STRIP_HOST, "").replace(FIGURE_HOST, `${STRIP_HOST} ${FIGURE_HOST}`))],
      ["inside the page container", () => rule2Problems(page.replace(STRIP_HOST, "").replace("</PageContainer>", `${STRIP_HOST}</PageContainer>`))],
      ["inside the section links", () => rule2Problems(page.replace(STRIP_HOST, "").replace("</SectionLinks>", `${STRIP_HOST}</SectionLinks>`))],
      ["no click on a mark", () => rule2Problems(page.replace(CLICK, ""))],
      ["a click that raises it at the wrong height", () => rule2Problems(page.replace(CLICK, "onHighlightClick={(id, rect) => useHighlightStrip.getState().show(id, rect.bottom)}"))],
      ["no store import", () => rule2Problems(page.replace('import { useHighlightStrip } from "@/components/notes/highlight-strip";', ""))],
    ];
    for (const [name, run] of cases) expect(run().length, name).toBeGreaterThan(0);
  });
});

// ── Rule 3 ─────────────────────────────────────────────────────────────────

const SUMMARY_HOST = "useSummaryHost({ paperId: paper.id, onSummary: !hasBody || tab === \"summary\", showSummary: showSummaryTab });";
const SHOW_SUMMARY = 'const showSummaryTab = useCallback(() => selectTab("summary"), [selectTab]);';

/** The Summary's report blocks container: from its opening tag to the end of the additions. */
function summaryContainer(source: string): string {
  const additions = between(squash(source), " additions={", " next={");
  const at = additions.indexOf(') : ( <div data-explain-source="summary" className="contents">');
  return at < 0 ? "" : additions.slice(at);
}

function rule3Problems(source: string): string[] {
  const p = squash(source);
  const problems: string[] = [];
  if (!p.includes('import { PaperWords, SUMMARY_ID, SummaryBlock } from "@/components/reader/paper-words";')) problems.push("the page does not import the Summary's ids and block wrapper from the words' module");
  const container = summaryContainer(source);
  if (container === "") problems.push("the Summary's blocks are not in one explain container any more");
  for (const key of WRAPPED) {
    const open = `<SummaryBlock id={SUMMARY_ID.${key}}>`;
    if (count(p, open) !== 1) problems.push(`the Summary's ${key} block is not under its id exactly once`);
    else if (!container.includes(open)) problems.push(`the Summary's ${key} block is not in the Summary's container`);
  }
  // Every direct child of the container is a wrapped block (or the answers of a paper with no body, whose section has its own id): the
  // selection reports `block.id || container.id || kind`, and a block without an id would be reported as the bare word "summary".
  const rest = container
    .replace(/^\) : \( <div data-explain-source="summary" className="contents">/, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/<SummaryBlock id=\{SUMMARY_ID\.\w+\}>[\s\S]*?<\/SummaryBlock>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!rest.startsWith("{!hasBody && answers}")) problems.push("a paper with no body no longer shows its answers first in the Summary's container");
  if (rest.replace("{!hasBody && answers}", "").replace(/<\/div> \)\}$/, "").trim() !== "") problems.push("a block stands in the Summary's container under no id of its own");
  // The Summary tab is brought back for the notes' blue square, by the page's own tab.
  if (!p.includes(SHOW_SUMMARY)) problems.push("the page has no way to show the Summary tab for a note's blue square");
  if (!p.includes(SUMMARY_HOST)) problems.push("the page does not register the Summary's reveal for the notes' blue square");
  if (count(p, "useSummaryHost(") !== 1) problems.push("the page does not call useSummaryHost exactly once");
  if (!p.includes('import { useSummaryHost } from "@/components/notes/note-tags";')) problems.push("the page does not import useSummaryHost from the notes' tags module");
  if (p.indexOf(SUMMARY_HOST) < p.indexOf("const { tab, select: selectTab, reveal } = useReaderTab(")) problems.push("the Summary's reveal is registered before the page's tab exists");
  return problems;
}

describe("rule 3 — the blue square for a Summary or an answer note", () => {
  it("is right on the source", () => {
    expect(rule3Problems(page)).toEqual([]);
  });

  it("keeps the words' container and the common slot as the layout pins have them", () => {
    const p = squash(page);
    expect(p).toMatch(/ words=\{digestion \? null : \( <div data-explain-source="summary" className="contents"> <PaperWords/);
    expect(p).toContain('<div data-explain-source="answer" className="contents">{answers}</div>');
    expect(p).toContain("{!hasBody && answers}");
  });

  it("notices each join taken out", () => {
    const cases: [string, () => string[]][] = [
      ["no import", () => rule3Problems(page.replace('import { PaperWords, SUMMARY_ID, SummaryBlock } from "@/components/reader/paper-words";', 'import { PaperWords } from "@/components/reader/paper-words";'))],
      ...WRAPPED.map((key): [string, () => string[]] => [`${key} unwrapped`, () => rule3Problems(page.replace(`<SummaryBlock id={SUMMARY_ID.${key}}>`, "<>"))]),
      ["a block with no id", () => rule3Problems(page.replace("{!hasBody && answers}", "{!hasBody && answers}\n            <RecordBlock paper={paper} primaryUrl={null} />"))],
      ["no way to show the Summary", () => rule3Problems(page.replace(SHOW_SUMMARY, ""))],
      ["no registration", () => rule3Problems(page.replace(SUMMARY_HOST, ""))],
      ["registered twice", () => rule3Problems(page.replace(SUMMARY_HOST, `${SUMMARY_HOST} ${SUMMARY_HOST}`))],
      ["no hook import", () => rule3Problems(page.replace('import { useSummaryHost } from "@/components/notes/note-tags";', ""))],
    ];
    for (const [name, run] of cases) expect(run().length, name).toBeGreaterThan(0);
  });
});
