"use client";

// The rail: where the reader is in the briefing and the way back. Keycaps
// only where there is a keyboard.

import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { Kbd } from "@/components/ui/kbd";
import { NONE } from "@/lib/navigation/card-focus";
import type { PaperNav } from "@/lib/reader/paper-nav";
import { RAIL } from "./copy";

export function Rail({ nav, onBack }: { nav: PaperNav; onBack: () => void }) {
  return (
    <nav
      aria-label="Briefing position"
      className="font-sans text-meta text-text-faint flex items-center gap-3"
    >
      <BackToFeedLink
        onBack={onBack}
        className="hover:text-heading transition-colors duration-150 ease-snap [@media(hover:none)]:inline-flex [@media(hover:none)]:min-h-11 [@media(hover:none)]:items-center"
      >
        {RAIL.back}
      </BackToFeedLink>
      {nav.index !== NONE && (
        <span className="tabular-nums">{RAIL.position(nav.index, nav.total)}</span>
      )}
      <span className="ml-auto flex items-center gap-1.5" aria-hidden>
        <Kbd pointerOnly>k</Kbd>
        <Kbd pointerOnly>j</Kbd>
        <Kbd pointerOnly>?</Kbd>
      </span>
    </nav>
  );
}
