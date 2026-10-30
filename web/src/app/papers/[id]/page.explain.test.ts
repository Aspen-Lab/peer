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

  // P4-01 (§1h.12 (h)): the line also carries `plain={plainForBody}` ("Say it plainly"), before the
  // selection. P10-02: the term's mark is gone from it with the strip that set it — the line as it now reads.
  has("<PaperBody reading={reading} route={route} title={paper?.title} keywords={paper?.summaryExperimentKeywords} plain={plainForBody} onSelect={selectExplain} noteAnchors={noteAnchors} onHighlightClick={(id, rect) => useHighlightStrip.getState().show(id, rect.top)} />", "the body no longer reports the reader's selection to the page");
  has("const [explainTarget, setExplainTarget] = useState<ExplainSelection | null>(null);", "the page no longer holds the selection as state");
  has("sameSelection(current, next) ? current : next", "a repeated selection no longer bails out of a re-render");

  // Mounted exactly once, for this paper, with the page's own terms and body.
  if (text.split("<ExplainBox").length - 1 !== 1) problems.push("the popover is not mounted exactly once");
  const popover = /<ExplainBox [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!popover.includes("key={paper.id}")) problems.push("the popover is no longer keyed by the paper (a card must not follow the reader to the next one)");
  if (!popover.includes("target={explainTarget}")) problems.push("the popover is no longer handed the selection");
  if (!popover.includes("terms={terms}")) problems.push("the popover is no longer handed the page's terms");
  // P8-06 (re-aimed: was `canAsk={providerConfigured}`): the always-on window asks `explainWindowAvailable`, which is
  // `aiAvailability`'s answer plus the reader's own local key while the sign-in check has not answered — so the window is in
  // the first paint — and nothing else; the model predicate `providerConfigured` is not touched.
  if (!popover.includes("canAsk={explainCanAsk}")) problems.push("a reader may ask only when `explainWindowAvailable` says there is a model (the model predicate, or a local key before the sign-in check answers), not by any other test");
  if (!text.includes("const explainCanAsk = explainWindowAvailable(profile, authOutcome);")) problems.push("`explainCanAsk` is no longer `explainWindowAvailable(profile, authOutcome)`: a reader's own key waits for the sign-in check again");
  if (!text.includes('const aiMode = aiAvailability(profile, authOutcome); const providerConfigured = aiMode !== "none";')) problems.push("the model predicate `providerConfigured` is no longer `aiAvailability`'s answer");
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

  // P10-08 (review 8.4): the Summary's blocks and the answers are explain targets too. The page marks their containers, listens for the
  // selection itself while the Summary is showing (Paper digestion's body has its own `onSelect`), and sends no section of the body for them.
  if (text.split('<div data-explain-source="summary" className="contents">').length - 1 !== 2) problems.push("the Summary's words and blocks are not each in a container marked `data-explain-source=\"summary\"`");
  if (text.split('<div data-explain-source="answer" className="contents">{answers}</div>').length - 1 !== 1) problems.push("the answers are not in a container marked `data-explain-source=\"answer\"`");
  has('useSelectionListener(hasBody && tab !== "digestion" ? selectExplain : undefined);', "the page no longer listens for a selection in the Summary or an answer while the Summary is showing");
  has("?? (fromPaperBody(selection) ? undefined : \"\")", "a selection of the Summary or an answer is no longer sent without a section of the body");

  // What is already kept comes from the store, for this paper and passage.
  has("explanationFor(", "the kept answer is no longer found with `explanationFor`");
  has("useExplainThreadsStore((s) => s.byPaper[paper.id])", "the kept answers are no longer this paper's");

  // P3-02b (ruling §1h.3): the thread. The box is handed the way to reply, the
  // thread kept for the passage, the way to drop a full one and the ref the `e` key
  // opens it through. (P7-15: no longer the text column's measure — the box is a dock
  // at the window's edge, and the page makes room for it.)
  if (!popover.includes("onReply={replyExplain}")) problems.push("the box is no longer handed `replyExplain` (a reader cannot send a follow-up)");
  if (!popover.includes("cachedTurns={explainKeptThread?.turns}")) problems.push("the box is no longer handed the thread kept for the passage");
  if (!popover.includes("onResetThread={resetExplain}")) problems.push("the box can no longer drop a full thread when the passage is opened again");
  if (popover.includes("column=")) problems.push("the box is handed a text-column measure that the dock does not use");
  if (!popover.includes("openRef={explainOpen}")) problems.push("the box is no longer handed the ref `e` opens it through");

  // The reply: the component's own request with the reader's own key; the pair joins the store
  // only once the reply has arrived, under a guard that never fails the reply.
  const reply = /const replyExplain = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!reply) problems.push("`replyExplain` moved or is no longer a useCallback");
  else {
    // Re-aimed (P10-08, review 8.6): the web-search choice is gone — the reply request carries the thread, the message and the reader's own key, and no `search`.
    if (!/requestReply\(\{ paper, selection, sectionId, thread, message, llmOverride: explainLlmOverride\(profile\) \}\)/.test(reply)) problems.push("the reply is no longer `requestReply` with the thread, the message and the reader's own key");
    if (!/async \(selection: SelectionTarget, thread: readonly ExplainTurn\[\], message: string\): Promise<ReplyResult>/.test(reply)) problems.push("`replyExplain` no longer takes the target, the thread and the message alone");
    if (/\bsearch\b/.test(reply.replace(/\(P10-08[^)]*\)/g, ""))) problems.push("the reply request mentions a web search again");
    if (!reply.includes("reading?.body?.[selection.sectionIndex]?.id")) problems.push("the reply's section id no longer comes from the body the reader selected in");
    // The pair that joins the thread is `replyPair`'s.
    if (!/if \(typeof result !== "string"\) \{ try \{ addExplainTurns\(paper\.id, passageHash\(selection\.passage\), replyPair\(message, result\)\); \} catch/.test(reply)) problems.push("a reply joins the thread only once it has arrived, under a guard that never fails the reply");
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
    expect(explainProblems(source.replace(" onSelect={selectExplain} noteAnchors={noteAnchors}", " noteAnchors={noteAnchors}"))).toEqual([
      "the body no longer reports the reader's selection to the page",
    ]);
  });

  it("would notice a reader allowed to ask by another test than the explain window's own", () => {
    const wrong = source.replace("canAsk={explainCanAsk}", "canAsk={Boolean(profile.deepReportEnabled)}");

    // The deep-report switch is the other test this guards against, so it trips both lines.
    expect(explainProblems(wrong)).toEqual([
      "a reader may ask only when `explainWindowAvailable` says there is a model (the model predicate, or a local key before the sign-in check answers), not by any other test",
      "asking one explanation is gated on deep reports being on",
    ]);
  });

  it("would notice the window waiting for the sign-in check again (P8-06: a reader's own key is in the first paint)", () => {
    // Back on `providerConfigured`, a local key is `none` until the check answers: the window and its 376 px come late.
    const late = source.replace("canAsk={explainCanAsk}", "canAsk={providerConfigured}");
    const widened = source.replace("const explainCanAsk = explainWindowAvailable(profile, authOutcome);", "const explainCanAsk = providerConfigured;");

    expect(explainProblems(late)).toEqual([
      "a reader may ask only when `explainWindowAvailable` says there is a model (the model predicate, or a local key before the sign-in check answers), not by any other test",
    ]);
    expect(explainProblems(widened)).toEqual([
      "`explainCanAsk` is no longer `explainWindowAvailable(profile, authOutcome)`: a reader's own key waits for the sign-in check again",
    ]);
  });

  it("would notice the model predicate itself being widened for the window's sake", () => {
    const wrong = source.replace('const providerConfigured = aiMode !== "none";', 'const providerConfigured = aiMode !== "none" || hasUserLlmOverride(profile);');

    expect(explainProblems(wrong)).toEqual(["the model predicate `providerConfigured` is no longer `aiAvailability`'s answer"]);
  });

  it("would notice the popover mounted inside the page container", () => {
    // P11-14 (re-aimed, §1c; rule 5): the box stands in its error boundary, between the section links and the box (and a comment on it).
    const line = /\s*<SectionLinks headings=\{bodyHeadings\}>\s*(?:\{\/\*[^]*?\*\/\}\s*)?<ExplainBoundary [^>]*>\s*<ExplainBox [^>]*\/>\s*<\/ExplainBoundary>\s*<\/SectionLinks>/.exec(source)![0];
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

  it("would notice the full-thread drop and the ref gone, and a text-column measure handed back to the box", () => {
    expect(explainProblems(source.replace(" onResetThread={resetExplain}", ""))).toEqual([
      "the box can no longer drop a full thread when the passage is opened again",
    ]);
    expect(explainProblems(source.replace(" openRef={explainOpen}", " column={measureColumn} openRef={explainOpen}"))).toEqual([
      "the box is handed a text-column measure that the dock does not use",
    ]);
    expect(explainProblems(source.replace(" openRef={explainOpen}", ""))).toEqual([
      "the box is no longer handed the ref `e` opens it through",
    ]);
  });

  it("would notice the Summary or an answer no longer being an explain target (P10-08)", () => {
    expect(explainProblems(source.replace('<div data-explain-source="answer" className="contents">{answers}</div>', "{answers}"))).toEqual([
      "the answers are not in a container marked `data-explain-source=\"answer\"`",
    ]);
    expect(explainProblems(source.replace('<div data-explain-source="summary" className="contents">', '<div className="contents">'))).toEqual([
      "the Summary's words and blocks are not each in a container marked `data-explain-source=\"summary\"`",
    ]);
    expect(explainProblems(source.replace('useSelectionListener(hasBody && tab !== "digestion" ? selectExplain : undefined);', ""))).toEqual([
      "the page no longer listens for a selection in the Summary or an answer while the Summary is showing",
    ]);
    expect(explainProblems(source.split(' ?? (fromPaperBody(selection) ? undefined : "")').join(""))).toEqual([
      "a selection of the Summary or an answer is no longer sent without a section of the body",
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

  // Re-aimed (P10-08, review 8.6; was P3-02c's "the toggle's choice travels page-ward as the fourth argument"): there is no choice to carry.
  it("would notice a web search coming back into the reply: a fourth argument, or a `search` in the request", () => {
    const noRequest = source.replace("sectionId, thread, message,", "sectionId, search, thread, message,");
    expect(noRequest).not.toBe(source);
    expect(explainProblems(noRequest)).toContain("the reply is no longer `requestReply` with the thread, the message and the reader's own key");
    expect(explainProblems(noRequest)).toContain("the reply request mentions a web search again");

    const withArgument = source.replace(", message: string): Promise<ReplyResult>", ", message: string, search?: boolean): Promise<ReplyResult>");
    expect(withArgument).not.toBe(source);
    expect(explainProblems(withArgument)).toContain("`replyExplain` no longer takes the target, the thread and the message alone");
  });

  it("would notice the kept pair no longer being the one the box shows", () => {
    const wrong = source.replace("replyPair(message, result)", "[{ role: \"reader\", text: message }, result]");

    expect(wrong).not.toBe(source);
    expect(explainProblems(wrong)).toContain("a reply joins the thread only once it has arrived, under a guard that never fails the reply");
  });

  it("imports `replyPair` and `requestReply` from the thread module, as the box does", () => {
    // P3-07 (§1h.9 (2)): the import also names `moreReply`, the turn "Say more" adds (Peer's alone).
    expect(source).toMatch(/import \{ moreReply, replyPair, requestReply, type ReplyResult \} from "@\/components\/reader\/explain-thread";/);
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

// P3-07 (ruling §1h.9 (2); user decision §1a.14): "Say more". The box is handed a
// way to re-send the reader's last message in the long form; it is its own
// callback beside `replyExplain`, so the typed send is untouched: the request is
// `requestReply` with `detail: true` and never a search, the reply joins the
// thread as Peer's turn alone (`moreReply`) once it has arrived, under the guard
// that never fails the reply. The checker runs on mutated copies too.

function sayMoreProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];
  const popover = /<ExplainBox [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!popover.includes("onSayMore={moreExplain}")) problems.push("the box is no longer handed `moreExplain` (a reader cannot say more)");

  const more = /const moreExplain = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!more) problems.push("`moreExplain` moved or is no longer a useCallback");
  else {
    if (!/requestReply\(\{ paper, selection, sectionId, thread, message, detail: true, llmOverride: explainLlmOverride\(profile\) \}\)/.test(more)) problems.push("the request is no longer `requestReply` in the long form, with the reader's own key");
    if (/\bsearch\b/.test(more)) problems.push("Say more asks to search the web");
    if (!/async \(selection: SelectionTarget, thread: readonly ExplainTurn\[\], message: string\): Promise<ReplyResult>/.test(more)) problems.push("`moreExplain` no longer takes the target, the thread before the message and the message");
    if (!more.includes("reading?.body?.[selection.sectionIndex]?.id")) problems.push("the section's id no longer comes from the body the reader selected in");
    if (!/if \(typeof result !== "string"\) \{ try \{ addExplainTurns\(paper\.id, passageHash\(selection\.passage\), moreReply\(result\)\); \} catch/.test(more)) problems.push("a long reply joins the thread as Peer's turn alone, only once it has arrived, under a guard that never fails the reply");
    if (/useExplainThreadsStore\.getState\(\)/.test(more)) problems.push("Say more reaches into the store instead of the page's own selector");
  }
  return problems;
}

describe("the page's Say more wiring (P3-07)", () => {
  it("is as the ruling says", () => {
    expect(sayMoreProblems(source)).toEqual([]);
  });

  it("would notice the box no longer handed the way to say more", () => {
    const wrong = source.replace(" onSayMore={moreExplain}", "");

    expect(wrong).not.toBe(source);
    expect(sayMoreProblems(wrong)).toEqual(["the box is no longer handed `moreExplain` (a reader cannot say more)"]);
  });

  it("would notice the long form dropped from the request", () => {
    const wrong = source.replace("message, detail: true, llmOverride", "message, llmOverride");

    expect(wrong).not.toBe(source);
    expect(sayMoreProblems(wrong)).toContain("the request is no longer `requestReply` in the long form, with the reader's own key");
  });

  it("would notice Say more asking to search the web", () => {
    const wrong = source.replace("thread, message, detail: true, llmOverride", "thread, message, search: true, detail: true, llmOverride");

    expect(wrong).not.toBe(source);
    expect(sayMoreProblems(wrong)).toContain("Say more asks to search the web");
  });

  it("would notice the reply kept as a pair, which would add a second copy of the reader's message", () => {
    const wrong = source.replace("moreReply(result)", "replyPair(message, false, result)");

    expect(wrong).not.toBe(source);
    expect(sayMoreProblems(wrong)).toContain("a long reply joins the thread as Peer's turn alone, only once it has arrived, under a guard that never fails the reply");
  });

  it("would notice the reply kept before it arrived", () => {
    const wrong = source.replace(/(const moreExplain = useCallback\([\s\S]*?)if \(typeof result !== "string"\) \{(\s*)try \{/, "$1{$2try {");

    expect(wrong).not.toBe(source);
    expect(sayMoreProblems(wrong)).toContain("a long reply joins the thread as Peer's turn alone, only once it has arrived, under a guard that never fails the reply");
  });

  it("would notice the typed send changed with it: `replyExplain` is exactly what it was", () => {
    expect(explainProblems(source)).toEqual([]);
    expect(source).toContain("onReply={replyExplain}");
  });
});
