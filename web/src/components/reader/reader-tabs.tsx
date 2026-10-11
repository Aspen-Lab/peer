"use client";

// P7-14 (R10, the owner's review): the strip that switches a full-text paper between "Summary" and
// "Paper digestion". It stands under the decision block, in the panel on the spread and in the
// flow below it, and only on a paper Peer has read in full (the page passes it only then).
//
// A WAI-ARIA tablist: two buttons with `role="tab"`, `aria-selected`, one tab stop (the selected
// one; the arrow keys, Home and End move the selection and the focus, as the pattern asks), and
// every tab pointing at the one panel the layout gives the active tab's blocks (`TABPANEL_ID`). The
// selected tab has a bar under it as well as its colour. Peer's label face, as the commands above.

import type { KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { TABS } from "./copy";
import { READER_TABS, type ReaderTab } from "./use-reader-tab";

/** The id of the panel that holds the active tab's blocks (`ReaderLayout`). */
export const TABPANEL_ID = "reader-tabpanel";

export function tabId(tab: ReaderTab): string {
  return `reader-tab-${tab}`;
}

/**
 * The tab an arrow key, Home or End asks for from `current`: right and down go on, left and up go
 * back, both wrapping; Home and End go to the ends. Any other key is not the strip's: null.
 */
export function nextTab(key: string, current: ReaderTab): ReaderTab | null {
  const at = READER_TABS.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return READER_TABS[(at + 1) % READER_TABS.length];
    case "ArrowLeft":
    case "ArrowUp":
      return READER_TABS[(at - 1 + READER_TABS.length) % READER_TABS.length];
    case "Home":
      return READER_TABS[0];
    case "End":
      return READER_TABS[READER_TABS.length - 1];
    default:
      return null;
  }
}

export function ReaderTabs({ tab, onSelect }: { tab: ReaderTab; onSelect: (tab: ReaderTab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(event.key, tab);
    if (!next) return;
    // The page's own keys (j, k, t, ...) are letters; the arrows, Home and End are the strip's here.
    event.preventDefault();
    event.stopPropagation();
    onSelect(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={TABS.label}
      onKeyDown={onKeyDown}
      className="mt-8 grid grid-cols-2 gap-1 border border-border-strong p-1"
    >
      {READER_TABS.map((name) => {
        const selected = name === tab;
        return (
          <button
            key={name}
            type="button"
            role="tab"
            id={tabId(name)}
            aria-selected={selected}
            aria-controls={TABPANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(name)}
            className={cn(
              buttonVariants({ tone: selected ? "accentSoft" : "ghost", size: "md" }),
              "eyebrow w-full px-2 [@media(hover:none)]:min-h-11",
              selected && "shadow-[inset_0_-2px_0_0_currentColor]",
            )}
          >
            {TABS[name]}
          </button>
        );
      })}
    </div>
  );
}
