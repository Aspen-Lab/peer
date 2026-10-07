import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P4-01 (blueprint §3.6 ⑥; rulings §1h.12 (h); §3d 15): the page's wiring of "Say it plainly".
// `Reader` cannot be mounted in this Node-only suite, so — as the explain, terms and upload-skip
// wiring tests do — this reads the page's source and holds each join to its shape: the body is
// handed the control only for a reader with a model (absent otherwise: the locked-block rule),
// the request is the component's `sayPlainly` with the reader's own key through
// `explainLlmOverride` and the remembered level, the button on a paragraph that shows a rewrite
// hides it (no request) and otherwise asks once, a level asks again only where a rewrite shows,
// and `u` takes the latest rewrite back BEFORE it does anything it did before. The checker is
// also run on mutated copies of the source, so the test proves it would notice what it guards:
// green on the page, red on each.

/** What is wrong with the plain wiring of a page `source`; empty when it is right. */
function plainProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];
  const has = (needle: string, why: string) => {
    if (!text.includes(needle)) problems.push(why);
  };

  // The body is handed the view — and only a reader with a model gets one.
  has("<PaperBody reading={reading} route={route} termMark={termMark} plain={plainForBody} onSelect={selectExplain} />", "the body is no longer handed the plain view");
  const forBody = /const plainForBody = ([^;]*);/.exec(text)?.[1] ?? "";
  if (forBody !== "providerConfigured ? plainView : undefined") problems.push("the plain view is not absent for a reader with no model (the locked-block rule)");
  if (/deepReport/i.test(forBody)) problems.push("Say it plainly is gated on deep reports being on");

  // The level: the reading preferences', one of the three or the default; chosen through the store.
  has("useReadingPrefsStore((s) => s.plainLevel)", "the level is no longer the reading preferences'");
  has("useReadingPrefsStore((s) => s.setPlainLevel)", "a reader's choice of level is no longer remembered in the reading preferences");
  has("isPlainLevel(storedPlainLevel) ? storedPlainLevel : PLAIN_DEFAULT_LEVEL", "a corrupt remembered level no longer falls back to the default");

  // What shows, what waits and what failed come from this paper's slice of the browser store.
  has("usePlainRewritesStore((s) => s.byPaper[paper.id])", "the kept rewrites are no longer this paper's");
  has("usePlainRewritesStore((s) => s.showing[paper.id])", "what shows is no longer this paper's");
  has("usePlainRewritesStore((s) => s.busy[paper.id])", "what is waiting is no longer this paper's");
  has("usePlainRewritesStore((s) => s.notices[paper.id])", "what failed is no longer this paper's");

  // The click: the component's own `sayPlainly`, with the reader's own key and the level it was given.
  const toggle = /const onPlainToggle = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!toggle) problems.push("`onPlainToggle` moved or is no longer a useCallback");
  else {
    if (!/if \(plainShown\.has\(key\)\) hidePlain\(paper\.id, key\); else void sayPlainly\(\{ paper, target, level: plainLevel, llmOverride: explainLlmOverride\(profile\) \}\);/.test(toggle))
      problems.push("the button no longer hides a showing rewrite without a request, or asks once with the remembered level and the reader's own key");
    if (/useReadingPrefsStore\.getState\(\)|usePlainRewritesStore\.getState\(\)/.test(toggle)) problems.push("the button reaches into a store instead of the page's own selector");
  }
  const choose = /const onPlainLevel = useCallback\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!choose) problems.push("`onPlainLevel` moved or is no longer a useCallback");
  else {
    if (!/setPlainLevel\(level\); if \(plainShown\.has\(paragraphKey\(target\.sectionId, target\.paragraphIndex\)\)\) void sayPlainly\(\{ paper, target, level, llmOverride: explainLlmOverride\(profile\) \}\);/.test(choose))
      problems.push("a level is no longer remembered, nor asked again only where a rewrite shows, with the reader's own key");
  }
  const view = /const plainView = useMemo<PlainView>\(.*?\], ?\);/.exec(text)?.[0] ?? "";
  if (!view) problems.push("`plainView` moved or is no longer a useMemo");
  else {
    if (!view.includes("onToggle: onPlainToggle") || !view.includes("onLevel: onPlainLevel")) problems.push("the view is no longer handed the button and the level handlers");
    if (!view.includes("level: plainLevel")) problems.push("the view no longer carries the remembered level");
  }

  // `u`: the latest plain rewrite comes back first, and only then does the key do what it did.
  const undo = /const undoOrToggleRead = \(\) => \{.*?\n? ?\};/.exec(text)?.[0] ?? "";
  if (!undo) problems.push("`undoOrToggleRead` moved");
  else {
    const first = undo.indexOf("usePlainRewritesStore.getState().hideLatest(paper.id)");
    const dismiss = undo.indexOf("store.pendingDismissal");
    if (first < 0) problems.push("`u` no longer takes a plain rewrite back");
    else if (dismiss >= 0 && first > dismiss) problems.push("`u` takes a plain rewrite back only after it has done something else");
    if (!/if \(providerConfigured && usePlainRewritesStore\.getState\(\)\.hideLatest\(paper\.id\)\) return;/.test(undo)) problems.push("`u` takes back a rewrite the reader cannot see, or does not stop after taking one back");
    if (!undo.includes("if (store.pendingDismissal) store.undoDismiss();")) problems.push("`u` no longer undoes a dismiss");
    if (!undo.includes("else if (store.readItems[paper.id]) store.markUnread(paper.id);")) problems.push("`u` no longer marks a read paper unread");
    if (!undo.includes("else store.markRead(paper.id, paper);")) problems.push("`u` no longer marks an unread paper read");
  }
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's Say it plainly wiring (P4-01)", () => {
  it("is as the ruling says", () => {
    expect(plainProblems(source)).toEqual([]);
  });

  it("would notice the body no longer handed the view", () => {
    const wrong = source.replace(" plain={plainForBody}", "");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["the body is no longer handed the plain view"]);
  });

  it("would notice the view offered to a reader with no model", () => {
    const wrong = source.replace("const plainForBody = providerConfigured ? plainView : undefined;", "const plainForBody = plainView;");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["the plain view is not absent for a reader with no model (the locked-block rule)"]);
  });

  it("would notice the view gated on the deep report switch, a gate this small click does not have", () => {
    const wrong = source.replace("const plainForBody = providerConfigured ? plainView : undefined;", "const plainForBody = providerConfigured && profile.deepReportEnabled ? plainView : undefined;");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(expect.arrayContaining(["Say it plainly is gated on deep reports being on"]));
  });

  it("would notice the request dropping the reader's own key", () => {
    const wrong = source.replace(/sayPlainly\(\{ paper, target, level: plainLevel, llmOverride: explainLlmOverride\(profile\) \}\)/, "sayPlainly({ paper, target, level: plainLevel })");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["the button no longer hides a showing rewrite without a request, or asks once with the remembered level and the reader's own key"]);
  });

  it("would notice the button asking again for a rewrite that shows", () => {
    const wrong = source.replace("if (plainShown.has(key)) hidePlain(paper.id, key); else void", "void");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toContain("the button no longer hides a showing rewrite without a request, or asks once with the remembered level and the reader's own key");
  });

  it("would notice a level that no longer reaches the reading preferences, or asks even where nothing shows", () => {
    const forgotten = source.replace("setPlainLevel(level);", "");
    expect(forgotten).not.toBe(source);
    expect(plainProblems(forgotten)).toEqual(["a level is no longer remembered, nor asked again only where a rewrite shows, with the reader's own key"]);

    const always = source.replace("if (plainShown.has(paragraphKey(target.sectionId, target.paragraphIndex))) void sayPlainly", "void sayPlainly");
    expect(always).not.toBe(source);
    expect(plainProblems(always)).toEqual(["a level is no longer remembered, nor asked again only where a rewrite shows, with the reader's own key"]);
  });

  it("would notice a corrupt remembered level reaching the control", () => {
    const wrong = source.replace("isPlainLevel(storedPlainLevel) ? storedPlainLevel : PLAIN_DEFAULT_LEVEL", "storedPlainLevel");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["a corrupt remembered level no longer falls back to the default"]);
  });

  it("would notice `u` no longer taking a rewrite back, or taking it back after what it did before", () => {
    const gone = source.replace(/\n\s*if \(providerConfigured && usePlainRewritesStore\.getState\(\)\.hideLatest\(paper\.id\)\) return;/, "");
    expect(gone).not.toBe(source);
    expect(plainProblems(gone)).toEqual(["`u` no longer takes a plain rewrite back", "`u` takes back a rewrite the reader cannot see, or does not stop after taking one back"]);

    const after = source.replace(/(\n\s*)(if \(providerConfigured && usePlainRewritesStore\.getState\(\)\.hideLatest\(paper\.id\)\) return;)(\n\s*)(const store = useFeedStore\.getState\(\);)(\n\s*)(if \(store\.pendingDismissal\) store\.undoDismiss\(\);)/, "$1$4$5$6\n    $2");
    expect(after).not.toBe(source);
    expect(plainProblems(after)).toContain("`u` takes a plain rewrite back only after it has done something else");
  });

  it("would notice `u` taking back a rewrite for a reader who cannot see one", () => {
    const wrong = source.replace("if (providerConfigured && usePlainRewritesStore.getState().hideLatest(paper.id)) return;", "if (usePlainRewritesStore.getState().hideLatest(paper.id)) return;");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["`u` takes back a rewrite the reader cannot see, or does not stop after taking one back"]);
  });

  it("would notice `u` losing what it did before", () => {
    const wrong = source.replace("else if (store.readItems[paper.id]) store.markUnread(paper.id);", "");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toContain("`u` no longer marks a read paper unread");
  });

  it("would notice the kept rewrites no longer being this paper's", () => {
    const wrong = source.replace("usePlainRewritesStore((s) => s.byPaper[paper.id])", "usePlainRewritesStore((s) => s.byPaper)");

    expect(wrong).not.toBe(source);
    expect(plainProblems(wrong)).toEqual(["the kept rewrites are no longer this paper's"]);
  });
});
