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

import { PAPER_KEYS, keyCap, type PaperKey } from "@/lib/reader/reader-keys";

export function KeyLegend({ keys = PAPER_KEYS }: { keys?: readonly PaperKey[] }) {
  return (
    <div
      aria-hidden
      className="hidden md:flex fixed inset-x-0 bottom-0 z-30 h-[var(--legend-h)] items-center justify-center gap-x-5 overflow-hidden glass-bar border-t border-border px-6 eyebrow text-text-faint"
    >
      {keys.map((entry) => (
        <span key={entry.action} className="whitespace-nowrap">
          <span className="text-text">{keyCap(entry.keys[0])}</span>{" "}
          {entry.short}
        </span>
      ))}
    </div>
  );
}
