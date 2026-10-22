import { afterEach, describe, expect, it, vi } from "vitest";

// P7-14 (R10, the owner's review; Q5): a paper Peer has read in full has two tabs, "Summary" and
// "Paper digestion", and it opens on the second. `useReaderTab` is the page's one place for which
// is showing. Beyond choosing, it does the two jobs the page cannot do with a plain state:
//   - `reveal(run)`: a jump into the paper's own text — "Read it here", a "§Heading" link, a sticky
//     note's blue square — has to find the body on the page. From Summary the
//     body is not mounted, so the tab is switched first and `run` happens once the blocks are in;
//   - `atStart`: a tab the reader picks starts at its start, not wherever the other tab was
//     scrolled to (told after the new blocks are on the page, once per pick).
// `onChange` is told on every real change — the page clears an open "Explain this?" card with it,
// whose selection lives in a body that has just gone.
//
// The hook runs on the minimal hook runtime, which re-renders only while a mount is alive, so a
// scripted page keeps the mount going and runs one step per round (the pattern of
// `use-debounced-questions.test.ts`). A step receives the hook's value as of the last render.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { DEFAULT_READER_TAB, READER_TABS, summaryBlockFromHash, useReaderTab, type ReaderTab } from "./use-reader-tab";

type Value = ReturnType<typeof useReaderTab>;

interface Run {
  /** The tab on show at each render, in order (consecutive repeats dropped). */
  tabs: ReaderTab[];
  /** The tab on show at the latest render — what a job that runs "now" would find on the page. */
  shown: ReaderTab | null;
  changes: ReaderTab[];
  starts: ReaderTab[];
}
type Step = (value: Value, run: Run) => void;

async function page(hasBody: boolean, script: Step[]): Promise<Run> {
  const run: Run = { tabs: [], shown: null, changes: [], starts: [] };
  const queued = [...script];
  let latest!: Value;
  const mounted = await hookRuntime.mount(
    () => {
      const value = useReaderTab({
        hasBody,
        onChange: (tab) => run.changes.push(tab),
        atStart: () => run.starts.push(latest.tab),
      });
      latest = value;
      run.shown = value.tab;
      if (run.tabs[run.tabs.length - 1] !== value.tab) run.tabs.push(value.tab);
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const step = queued.shift();
        if (!step) return;
        step(latest, run);
        setTick((n) => n + 1);
      }, [tick]);
      return value;
    },
    { maxRounds: 60 },
  );
  mounted.unmount();
  return run;
}

describe("the tabs a paper opens on (Q5)", () => {
  it("names the two tabs, Summary first, and opens on Paper digestion", () => {
    expect(READER_TABS).toEqual(["summary", "digestion"]);
    expect(DEFAULT_READER_TAB).toBe("digestion");
  });

  it("a paper with a body opens on Paper digestion, and nothing has changed", async () => {
    const run = await page(true, []);

    expect(run.tabs).toEqual(["digestion"]);
    expect(run.changes).toEqual([]);
    expect(run.starts).toEqual([]);
  });

  it("a paper with no body has no tabs: it shows the summary, and picking does nothing", async () => {
    const run = await page(false, [(v) => v.select("digestion"), (v) => v.select("summary")]);

    expect(run.tabs).toEqual(["summary"]);
    expect(run.changes).toEqual([]);
    expect(run.starts).toEqual([]);
  });
});

describe("picking a tab", () => {
  it("switches, tells onChange once, and starts the new tab at its start after the render", async () => {
    const run = await page(true, [(v) => v.select("summary")]);

    expect(run.tabs).toEqual(["digestion", "summary"]);
    expect(run.changes).toEqual(["summary"]);
    // `atStart` ran in the render in which Summary was on show — not before it.
    expect(run.starts).toEqual(["summary"]);
  });

  it("picking the tab already showing is not a change", async () => {
    const run = await page(true, [(v) => v.select("digestion")]);

    expect(run.tabs).toEqual(["digestion"]);
    expect(run.changes).toEqual([]);
    expect(run.starts).toEqual([]);
  });

  it("there and back again: two changes, two starts, each after its own render", async () => {
    const run = await page(true, [(v) => v.select("summary"), (v) => v.select("digestion")]);

    expect(run.tabs).toEqual(["digestion", "summary", "digestion"]);
    expect(run.changes).toEqual(["summary", "digestion"]);
    expect(run.starts).toEqual(["summary", "digestion"]);
  });
});

describe("revealing the paper's own text (R10: t, the § links, the terms)", () => {
  it("on Paper digestion the body is on the page, so the jump happens at once and nothing changes", async () => {
    const seen: string[] = [];
    const run = await page(true, [
      (v, now) => {
        v.reveal(() => seen.push(`ran on ${now.shown}`));
        seen.push("after the call");
      },
    ]);

    expect(seen).toEqual(["ran on digestion", "after the call"]);
    expect(run.tabs).toEqual(["digestion"]);
    expect(run.changes).toEqual([]);
  });

  it("from Summary it switches first and jumps only once the body is mounted, exactly once", async () => {
    const seen: string[] = [];
    const run = await page(true, [
      (v) => v.select("summary"),
      (v, now) => {
        v.reveal(() => seen.push(`ran on ${now.shown}`));
        seen.push("after the call");
      },
      () => {},
      () => {},
    ]);

    // Not inside the call: the jump waited for the render that put Paper digestion on show.
    expect(seen).toEqual(["after the call", "ran on digestion"]);
    expect(run.tabs).toEqual(["digestion", "summary", "digestion"]);
    // A switch the page makes for the reader tells onChange like any other (it clears the explain card)…
    expect(run.changes).toEqual(["summary", "digestion"]);
    // …but it is not a pick: the tab does not scroll to its start over the jump that follows.
    expect(run.starts).toEqual(["summary"]);
  });

  it("a second jump asked while the body is up runs at once, and the first is not run again", async () => {
    const seen: string[] = [];
    await page(true, [
      (v) => v.select("summary"),
      (v) => v.reveal(() => seen.push("first")),
      (v) => v.reveal(() => seen.push("second")),
      () => {},
    ]);

    expect(seen).toEqual(["first", "second"]);
  });

  it("with no body there is nothing to switch: it runs at once", async () => {
    const seen: string[] = [];
    const run = await page(false, [(v) => v.reveal(() => seen.push("ran"))]);

    expect(seen).toEqual(["ran"]);
    expect(run.tabs).toEqual(["summary"]);
    expect(run.changes).toEqual([]);
  });
});

// P11-20 rule 1 (C P11-17b "For the manager" 1; ruling §1h.118): the notes page's blue square for a note taken on a Summary block navigates to
// `/papers/<id>#summary-proposal`. The paper opens on Paper digestion (Q5), which does not hold the block; the tab that does is the Summary. So a paper
// with a body whose address names a Summary block opens on the Summary — once, after the first commit (during a client-side navigation the address
// is changed after the render that mounts the page, so a render-time read would miss it; the arrival's own wait, `followHash`, reads it the same way).
// It is not a pick (no scroll to the tab's start: the arrival scrolls to the block), and the reader's own picks after it are theirs.
describe("summaryBlockFromHash — which addresses name a Summary block", () => {
  it("reads a Summary block's id, decoded, and nothing else", () => {
    expect(summaryBlockFromHash("#summary-proposal")).toBe("summary-proposal");
    expect(summaryBlockFromHash("#summary-new-here")).toBe("summary-new-here");
    expect(summaryBlockFromHash("#summary%2Dproposal")).toBe("summary-proposal");
    for (const hash of ["", "#", "#summary", "#summary-", "#Summary-proposal", "#summary-proposal x", "#answers-block", "#paper-section-1-p2", "#%E0%A4%A"]) {
      expect(summaryBlockFromHash(hash), hash).toBeNull();
    }
  });
});

describe("arriving with a Summary block in the address", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const addressed = (hash: string) => vi.stubGlobal("window", { location: { hash } });

  it("a paper with a body opens on the Summary, tells onChange once, and does not scroll to the tab's start", async () => {
    addressed("#summary-proposal");
    const run = await page(true, []);

    expect(run.tabs).toEqual(["digestion", "summary"]);
    expect(run.changes).toEqual(["summary"]);
    expect(run.starts).toEqual([]);
  });

  it("every other address leaves the paper on Paper digestion: the answers' block (under both tabs), a paragraph, a bare #, none", async () => {
    for (const hash of ["#answers-block", "#paper-section-0-p1", "#", ""]) {
      addressed(hash);
      const run = await page(true, []);

      expect(run.tabs, hash).toEqual(["digestion"]);
      expect(run.changes, hash).toEqual([]);
    }
  });

  it("a paper with no body is on the Summary already: nothing changes, nothing is told", async () => {
    addressed("#summary-proposal");
    const run = await page(false, []);

    expect(run.tabs).toEqual(["summary"]);
    expect(run.changes).toEqual([]);
  });

  it("is read once: the reader's pick of Paper digestion afterwards is not undone by the address, which still names the block", async () => {
    addressed("#summary-proposal");
    const run = await page(true, [() => {}, (v) => v.select("digestion"), () => {}, () => {}]);

    expect(run.tabs).toEqual(["digestion", "summary", "digestion"]);
    expect(run.changes).toEqual(["summary", "digestion"]);
    expect(run.starts).toEqual(["digestion"]);
  });

  it("a jump into the paper's own text from it still switches back first, as from any Summary", async () => {
    addressed("#summary-proposal");
    const seen: string[] = [];
    const run = await page(true, [
      () => {},
      (v, now) => v.reveal(() => seen.push(`ran on ${now.shown}`)),
      () => {},
      () => {},
    ]);

    expect(seen).toEqual(["ran on digestion"]);
    expect(run.tabs).toEqual(["digestion", "summary", "digestion"]);
  });

  it("a page with no window (a server) is left on Paper digestion", async () => {
    vi.stubGlobal("window", undefined);
    const run = await page(true, []);

    expect(run.tabs).toEqual(["digestion"]);
  });
});
