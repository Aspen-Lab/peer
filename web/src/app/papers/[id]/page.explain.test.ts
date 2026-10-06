import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-02 (ruling §1h.2; brief item 5): the page's wiring of "Explain this?".
// `Reader` cannot be mounted in this Node-only suite, so — as the upload-skip
// and Terms-to-know wiring tests do — this reads the page's source and holds
// each join to its shape: the body reports the reader's selection, the popover
// is mounted once for the paper (outside the zoomed page container, so its
// pixel positions are the window's), a reader may ask when they have a model
// from anywhere (not only when deep reports are on), the request is the
// component's `requestExplanation` with the reader's own key through
// `explainLlmOverride`, and a kept answer is remembered — without ever failing
// the answer. The checker is also run on mutated copies of the source, so the
// test proves it would notice what it guards: green on the page, red on each.

/** What is wrong with the explain wiring of a page `source`; empty when it is right. */
function explainProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];
  const has = (needle: string, why: string) => {
    if (!text.includes(needle)) problems.push(why);
  };

  has("<PaperBody reading={reading} route={route} termMark={termMark} onSelect={selectExplain} />", "the body no longer reports the reader's selection to the page");
  has("const [explainTarget, setExplainTarget] = useState<ExplainSelection | null>(null);", "the page no longer holds the selection as state");
  has("sameSelection(current, next) ? current : next", "a repeated selection no longer bails out of a re-render");

  // Mounted exactly once, for this paper, with the page's own terms and body.
  if (text.split("<ExplainBox").length - 1 !== 1) problems.push("the popover is not mounted exactly once");
  const popover = /<ExplainBox [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!popover.includes("key={paper.id}")) problems.push("the popover is no longer keyed by the paper (a card must not follow the reader to the next one)");
  if (!popover.includes("target={explainTarget}")) problems.push("the popover is no longer handed the selection");
  if (!popover.includes("terms={terms}")) problems.push("the popover is no longer handed the page's terms");
  if (!popover.includes("canAsk={providerConfigured}")) problems.push("a reader may ask only when `providerConfigured` says there is a model, not by any other test");
  if (/deepReportEnabled/.test(popover)) problems.push("asking one explanation is gated on deep reports being on");
  if (!popover.includes("onAsk={askExplain}")) problems.push("the popover is no longer handed `askExplain`");
  if (!popover.includes("cached={explainCached}")) problems.push("the popover is no longer handed the answer already kept");
  if (!popover.includes("reading={reading}")) problems.push("the popover is no longer handed the reading");

  // Outside the zoomed container, inside the section links the quotes read.
  const closed = text.lastIndexOf("</PageContainer>");
  const mounted = text.indexOf("<ExplainBox");
  if (closed < 0 || mounted < closed) problems.push("the popover is mounted inside the page container, whose zoom would move it");
  const links = text.lastIndexOf("<SectionLinks", mounted);
  if (links < closed) problems.push("the popover's quotes have no SectionLinks around them");

  // The request: the component's own, with the reader's own key and the section's id.
  const ask = /const askExplain = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!ask) problems.push("`askExplain` moved or is no longer a useCallback");
  else {
    if (!/requestExplanation\(\{ paper, selection, sectionId, llmOverride: explainLlmOverride\(profile\) \}\)/.test(ask)) problems.push("the request is no longer `requestExplanation` with the reader's own key");
    if (!ask.includes("reading?.body?.[selection.sectionIndex]?.id")) problems.push("the section's id no longer comes from the body the reader selected in");
    if (!/try \{ rememberExplanation\(paper\.id, \{ passage: selection\.passage, sectionId, paragraphIndex: selection\.paragraphIndex, answer: result \}\); \} catch/.test(ask)) problems.push("a kept answer is no longer remembered under a guard that never fails the answer");
    if (/useExplainThreadsStore\.getState\(\)/.test(ask)) problems.push("the request reaches into the store instead of the page's own selector");
  }

  // What is already kept comes from the store, for this paper and passage.
  has("explanationFor(", "the kept answer is no longer found with `explanationFor`");
  has("useExplainThreadsStore((s) => s.byPaper[paper.id])", "the kept answers are no longer this paper's");

  // P3-02b (ruling §1h.3): the thread. The box is handed the way to reply, the
  // thread kept for the passage, the way to drop a full one, the text column's
  // measure and the ref the `e` key opens it through.
  if (!popover.includes("onReply={replyExplain}")) problems.push("the box is no longer handed `replyExplain` (a reader cannot send a follow-up)");
  if (!popover.includes("cachedTurns={explainKeptThread?.turns}")) problems.push("the box is no longer handed the thread kept for the passage");
  if (!popover.includes("onResetThread={resetExplain}")) problems.push("the box can no longer drop a full thread when the passage is opened again");
  if (!popover.includes("column={measureBodyColumn}")) problems.push("the box is no longer handed the text column's measure");
  if (!popover.includes("openRef={explainOpen}")) problems.push("the box is no longer handed the ref `e` opens it through");

  // The reply: the component's own request with the reader's own key; the pair joins the store
  // only once the reply has arrived, under a guard that never fails the reply.
  const reply = /const replyExplain = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!reply) problems.push("`replyExplain` moved or is no longer a useCallback");
  else {
    if (!/requestReply\(\{ paper, selection, sectionId, thread, message, llmOverride: explainLlmOverride\(profile\) \}\)/.test(reply)) problems.push("the reply is no longer `requestReply` with the thread, the message and the reader's own key");
    if (!reply.includes("reading?.body?.[selection.sectionIndex]?.id")) problems.push("the reply's section id no longer comes from the body the reader selected in");
    if (!/if \(typeof result !== "string"\) \{ try \{ addExplainTurns\(paper\.id, passageHash\(selection\.passage\), \[\{ role: "reader", text: message \}, result\]\); \} catch/.test(reply)) problems.push("a reply joins the thread only once it has arrived, under a guard that never fails the reply");
    if (/useExplainThreadsStore\.getState\(\)/.test(reply)) problems.push("the reply reaches into the store instead of the page's own selector");
  }
  if (!/const resetExplain = useCallback\(.*?resetExplainThread\(paper\.id, passageHash\(selection\.passage\)\)/.test(text)) problems.push("a full thread is no longer dropped through `resetThread` for this paper and passage");

  // `e` opens the box: registered with the keyboard layer, with the body, and calling the box's own `open`.
  if (!/const openExplain = useCallback\(\(\) => explainOpen\.current\?\.\(\), \[\]\);/.test(text)) problems.push("`openExplain` no longer calls the box's own open through the ref");
  const actions = /const actions: ReaderActions = \{.*?\};/.exec(text)?.[0] ?? "";
  if (!actions) problems.push("the `actions` block moved");
  else if (!/\.\.\.\(hasBody \? \{[^}]*\bexplain: openExplain\b[^}]*\} : \{\}\)/.test(actions)) problems.push("`explain` is no longer registered with the keyboard layer (e does nothing)");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
const hydrator = readFileSync(resolve(process.cwd(), "src/components/store-hydrator.tsx"), "utf8");

describe("the page's Explain this? wiring (P3-02)", () => {
  it("is as the ruling says", () => {
    expect(explainProblems(source)).toEqual([]);
  });

  it("would notice the body no longer reporting the selection", () => {
    expect(explainProblems(source.replace(" onSelect={selectExplain} />", " />"))).toEqual([
      "the body no longer reports the reader's selection to the page",
    ]);
  });

  it("would notice a reader allowed to ask by another test than providerConfigured", () => {
    const wrong = source.replace("canAsk={providerConfigured}", "canAsk={Boolean(profile.deepReportEnabled)}");

    // The deep-report switch is the other test this guards against, so it trips both lines.
    expect(explainProblems(wrong)).toEqual([
      "a reader may ask only when `providerConfigured` says there is a model, not by any other test",
      "asking one explanation is gated on deep reports being on",
    ]);
  });

  it("would notice the popover mounted inside the page container", () => {
    const line = /\s*<SectionLinks headings=\{bodyHeadings\}>\s*<ExplainBox [^>]*\/>\s*<\/SectionLinks>/.exec(source)![0];
    const moved = source.replace(line, "").replace("<ReaderToast toast={toast} />", `${line.trim()}\n<ReaderToast toast={toast} />`);

    // Moved with its section links, it is inside the container, and the links are no longer after it.
    expect(explainProblems(moved)).toEqual([
      "the popover is mounted inside the page container, whose zoom would move it",
      "the popover's quotes have no SectionLinks around them",
    ]);
  });

  it("would notice the popover no longer keyed by the paper", () => {
    expect(explainProblems(source.replace("<ExplainBox key={paper.id}", "<ExplainBox"))).toEqual([
      "the popover is no longer keyed by the paper (a card must not follow the reader to the next one)",
    ]);
  });

  it("would notice the request dropping the reader's own key", () => {
    const wrong = source.replace("llmOverride: explainLlmOverride(profile) })", "})");

    expect(explainProblems(wrong)).toContain("the request is no longer `requestExplanation` with the reader's own key");
  });

  it("would notice a kept answer remembered without the guard", () => {
    const wrong = source.replace(/try \{\s*rememberExplanation\(/, "{ rememberExplanation(").replace(/\} catch \{[^}]*\}/, "}");

    expect(explainProblems(wrong)).toContain("a kept answer is no longer remembered under a guard that never fails the answer");
  });

  it("would notice the box no longer handed a way to reply", () => {
    expect(explainProblems(source.replace(" onReply={replyExplain}", ""))).toEqual([
      "the box is no longer handed `replyExplain` (a reader cannot send a follow-up)",
    ]);
  });

  it("would notice the thread kept for the passage no longer handed to the box", () => {
    expect(explainProblems(source.replace(" cachedTurns={explainKeptThread?.turns}", ""))).toEqual([
      "the box is no longer handed the thread kept for the passage",
    ]);
  });

  it("would notice the full-thread drop and the column measure and the ref gone", () => {
    expect(explainProblems(source.replace(" onResetThread={resetExplain}", ""))).toEqual([
      "the box can no longer drop a full thread when the passage is opened again",
    ]);
    expect(explainProblems(source.replace(" column={measureBodyColumn}", ""))).toEqual([
      "the box is no longer handed the text column's measure",
    ]);
    expect(explainProblems(source.replace(" openRef={explainOpen}", ""))).toEqual([
      "the box is no longer handed the ref `e` opens it through",
    ]);
  });

  it("would notice `explain` no longer registered with the keyboard layer", () => {
    const wrong = source.replace(/, explain: openExplain /, " ");

    expect(wrong).not.toBe(source);
    expect(explainProblems(wrong)).toEqual(["`explain` is no longer registered with the keyboard layer (e does nothing)"]);
  });

  it("would notice `explain` registered for every page instead of only one with a body", () => {
    const wrong = source.replace(/\.\.\.\(hasBody \? \{ read: readHere, ask: focusFirstEmptyQuestion, explain: openExplain \} : \{\}\)/, "explain: openExplain, ...(hasBody ? { read: readHere, ask: focusFirstEmptyQuestion } : {})");

    expect(wrong).not.toBe(source);
    expect(explainProblems(wrong)).toEqual(["`explain` is no longer registered with the keyboard layer (e does nothing)"]);
  });

  it("would notice the reply dropping the reader's own key, or joining the thread before it arrived", () => {
    expect(explainProblems(source.replace("thread, message, llmOverride: explainLlmOverride(profile) })", "thread, message })"))).toContain(
      "the reply is no longer `requestReply` with the thread, the message and the reader's own key",
    );
    const early = source.replace(/if \(typeof result !== "string"\) \{(\s*)try \{(\s*)addExplainTurns\(/, "{$1try {$2addExplainTurns(");
    expect(early).not.toBe(source);
    expect(explainProblems(early)).toContain("a reply joins the thread only once it has arrived, under a guard that never fails the reply");
  });

  it("would notice the ref no longer called through `openExplain`", () => {
    const wrong = source.replace("explainOpen.current?.()", "undefined");

    expect(explainProblems(wrong)).toContain("`openExplain` no longer calls the box's own open through the ref");
  });

  it("registers the explain threads store with the hydrator, as the other stores", () => {
    expect(hydrator).toContain('import { useExplainThreadsStore } from "@/store/explain-threads";');
    expect(hydrator).toContain("useExplainThreadsStore.persist.rehydrate();");
  });
});
