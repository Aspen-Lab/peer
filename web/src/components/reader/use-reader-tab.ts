"use client";

// P7-14 (R10, the owner's review): which of the reader's two tabs is showing.
//
// A paper Peer has read in full (`hasBody`) has "Summary" — what Peer wrote about the paper — and
// "Paper digestion" — Peer's reading aid for the paper's own text, the map and the body. It opens
// on Paper digestion (Q5). A paper with no body has no tabs; the page is the one it was, which is
// the summary. The inactive tab's blocks are not mounted, so the paper body's work (hundreds of
// paragraphs of KaTeX) is not paid on Summary and the report blocks' reveals start when shown.
//
// Two jobs beyond holding the choice, both of which the page could not do with a plain `useState`:
//
//   `reveal(run)` — a jump INTO the paper's own text ("Read it here", a "§Heading" link, a sticky
//   note's blue square) needs the body on the page. On Paper digestion it is, and
//   `run` happens at once. From Summary it is not mounted: the tab is switched first, and `run`
//   happens once, in the effect after the render that put the body on the page.
//
//   `atStart` — a tab the READER picks starts at its start: told, once per pick, after the new
//   tab's blocks are on the page. (A reveal is not a pick: its own jump is what scrolls.)
//
// `onChange` is told on every real change, by whichever path; the page clears a selection held for
// "Explain this?" with it, since the body that held that selection is the thing that has just gone.
//
// P11-20 (rule 1; C P11-17b "For the manager" 1): the notes page's blue square for a note taken on a Summary block navigates to
// `/papers/<id>#summary-proposal`. The paper opens on Paper digestion (Q5), which does not hold that block, so a paper with a body whose address
// names a Summary block opens on the Summary instead — once, after the first commit — and the page's arrival (`followHash`, `sticky-note.tsx`)
// scrolls to the block once it is on the page. It is not a pick (the tab does not scroll to its start), and what the reader picks after it is theirs.

import { useCallback, useEffect, useRef, useState } from "react";

export type ReaderTab = "summary" | "digestion";

/** The id a page's `#hash` names, decoded; null when the address is not valid percent-encoding. */
export function hashTarget(hash: string): string | null {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
}

/** The Summary block a page's `#hash` names (the notes page's blue square arrives with one), or null. The ids of the Summary's blocks begin with
 *  `summary-` (`SUMMARY_ID_PREFIX`, `note-tags.tsx`; a test holds the two equal). */
export function summaryBlockFromHash(hash: string): string | null {
  const id = hashTarget(hash);
  return id !== null && /^summary-[a-z][a-z-]*$/.test(id) ? id : null;
}

/** The tabs, in the order the strip shows them. */
export const READER_TABS: readonly ReaderTab[] = ["summary", "digestion"];

/** Q5: a full-text paper opens on Paper digestion. */
export const DEFAULT_READER_TAB: ReaderTab = "digestion";

export interface ReaderTabState {
  /** The tab on show. A paper with no body is always on "summary" and has no strip. */
  tab: ReaderTab;
  /** The reader's pick (a click or an arrow key). Ignored without a body, and for the tab on show. */
  select: (tab: ReaderTab) => void;
  /** Make sure the paper's own text is on the page, then run `run`. */
  reveal: (run: () => void) => void;
}

/**
 * The arrival of the notes page's blue square for a Summary block: when the address names one (`summaryBlockFromHash`), `show` is told once, the first
 * time a body is on the page (a paper with no body is on the Summary already). Read after the first commit, not during a render: in a client-side
 * navigation the address is changed after the render that mounts the page. Never again, so what the reader picks afterwards stands, though the address
 * still names the block. `show` is the page's own switch, handed in as `useRestoreReaderPlace` is handed `select` (`return-to-paper.ts`): one more render,
 * on this address only.
 */
function useArriveOnSummary({ hasBody, show }: { hasBody: boolean; show: () => void }): void {
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !hasBody) return;
    arrived.current = true;
    if (typeof window !== "undefined" && summaryBlockFromHash(window.location.hash) !== null) show();
  }, [hasBody, show]);
}

export function useReaderTab({
  hasBody,
  onChange,
  atStart,
}: {
  hasBody: boolean;
  /** Told when the tab on show changes, by a pick or by a reveal. */
  onChange?: (tab: ReaderTab) => void;
  /** Told after a pick, once the new tab's blocks are on the page. */
  atStart?: () => void;
}): ReaderTabState {
  const [chosen, setChosen] = useState<ReaderTab>(DEFAULT_READER_TAB);
  const tab: ReaderTab = hasBody ? chosen : "summary";
  const job = useRef<(() => void) | null>(null);
  const toStart = useRef(false);

  const switchTo = useCallback(
    (next: ReaderTab): boolean => {
      if (next === chosen) return false;
      setChosen(next);
      onChange?.(next);
      return true;
    },
    [chosen, onChange],
  );

  const select = useCallback(
    (next: ReaderTab) => {
      if (!hasBody) return;
      if (switchTo(next)) toStart.current = true;
    },
    [hasBody, switchTo],
  );

  const reveal = useCallback(
    (run: () => void) => {
      if (!hasBody || tab === "digestion") {
        run();
        return;
      }
      job.current = run;
      switchTo("digestion");
    },
    [hasBody, tab, switchTo],
  );

  // The address names a Summary block: the Summary is the tab that holds it.
  const showSummary = useCallback(() => {
    switchTo("summary");
  }, [switchTo]);
  useArriveOnSummary({ hasBody, show: showSummary });

  // After the render that put `tab` on the page: the jump a reveal waited for, else the start of a
  // tab the reader picked. Each is taken once, whatever makes this run again.
  useEffect(() => {
    const run = job.current;
    job.current = null;
    if (run) {
      toStart.current = false;
      run();
      return;
    }
    if (toStart.current) {
      toStart.current = false;
      atStart?.();
    }
  }, [tab, atStart]);

  return { tab, select, reveal };
}
