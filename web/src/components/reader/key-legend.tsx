// The legend along the foot of the reading page — every key this surface
// answers to, on one line.
//
// Peer is a keyboard product that had been telling the reader about four of
// its nine keys, one chip at a time, on the four keys that also have buttons.
// A terminal puts the whole map on the bottom row and leaves it there. It is
// a legend, not a toolbar: nothing here is clickable, so it adds no target to
// hunt and cannot compete with the page — the keys themselves are the
// interface, and this says what they are.
//
// Generated from `PAPER_KEYS`, the one table the keyboard layer and the help
// sheet already read, so it cannot describe a key the page does not have.
//
// Desktop only: a phone has no keyboard and already has the thumb bar.
//
// P1-08 (§1f.19): the page passes the keys it answers to
// (`paperKeysFor`), so an uploaded PDF's page shows no `x skip`.
//
// P11-17a (BACKLOG-98): whole at every width from 768 px. Since P11-13 added
// `n notes` and `h highlight` the line (one line, `overflow-hidden`, centred)
// clipped its outer entries below about 1,024 px. Now, in this order:
//   (a) a 12 px gap and 16 px sides (were 20 and 24);
//   (b) `Esc back` for `Esc briefing` (`reader-keys.ts`; the help sheet still
//       says "Back to the briefing");
//   (c) below the width the whole line needs, whole entries drop, from the end
//       of this list: notes, highlight, explain (the owner's three, never
//       dropped), next, prev, ask, undo, like, back, save, read, copy, skip,
//       open. `o open` goes below 912 px, `x skip` below 856, `c copy` below
//       800. The three are taught on the page itself (the commands' own `o`,
//       `x`, `c` keys), and an upload's page has neither open nor skip, so
//       below 856 px every page's legend is the upload's, which drops only
//       `c copy` below 800. A dropped key still works and is still in the help
//       sheet. The widths are the line's need under `key-legend.test.tsx`'s
//       measured model (Roboto Mono 11.5px tracked 0.06em: 7.594 px a
//       character) plus at least 8 px, to a multiple of 8.

import { PAPER_KEYS, keyCap, type PaperKey, type ReaderAction } from "@/lib/reader/reader-keys";

/** The entries that drop on a narrow window, and from what width they show. Whole class names, for Tailwind to find. */
const SHOWN_FROM: Partial<Record<ReaderAction, string>> = {
  open: "hidden min-[912px]:inline",
  skip: "hidden min-[856px]:inline",
  copy: "hidden min-[800px]:inline",
};

export function KeyLegend({ keys = PAPER_KEYS }: { keys?: readonly PaperKey[] }) {
  return (
    <div
      aria-hidden
      className="hidden md:flex fixed inset-x-0 bottom-0 z-30 h-[var(--legend-h)] items-center justify-center gap-x-3 overflow-hidden bg-surface border-t border-border px-4 eyebrow text-text-faint"
    >
      {keys.map((entry) => (
        <span key={entry.action} className={`whitespace-nowrap ${SHOWN_FROM[entry.action] ?? ""}`.trim()}>
          <span className="text-text">{keyCap(entry.keys[0])}</span>{" "}
          {entry.short}
        </span>
      ))}
    </div>
  );
}
