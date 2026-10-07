"use client";

// 8-03/S25: the abstract, collapsed by default. A full-width row that says
// "Abstract"; click to open, click again to close. It was a filled accent
// bar, and it out-shouted the claim above it — the page's one accent belongs
// to the claim's band — so it is drawn as a framed row in the band grammar:
// the mark, the mono label, the chevron. Conditional
// rendering, not a CSS-only collapse — page.tsx's decided-read observer
// (`app/papers/[id]/page.tsx`, watches `wordsEndRef`) already falls back to
// the Decision block when its target ref is null (the same path a paper
// with no abstract at all takes today), and only conditional mounting keeps
// that ref null while collapsed. A `grid-template-rows` CSS collapse would
// leave the footer's ref permanently non-null and silently freeze the
// observer on an invisible target for as long as the reader leaves this
// closed — the new default.

import { useState } from "react";
import { cn } from "@/lib/cn";
import { IconChevronDown } from "@/components/icons";
import { ABSTRACT_LABEL } from "./copy";

const ABSTRACT_PANEL_ID = "abstract-panel";

export function AbstractToggle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={ABSTRACT_PANEL_ID}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-4 h-12 px-4",
          "border border-border-strong text-text-muted",
          "transition-[color,background-color,border-color] duration-150 ease-snap",
          "hover:text-heading hover:border-text-faint hover:bg-surface-hover",
          open && "text-heading",
        )}
      >
        <span className="eyebrow inline-flex items-center gap-2">
          <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
          {ABSTRACT_LABEL}
        </span>
        <IconChevronDown
          size={14}
          className={cn("transition-transform duration-150 ease-snap", open && "rotate-180")}
        />
      </button>
      {open && (
        <div id={ABSTRACT_PANEL_ID} className="animate-fade-in-up">
          {children}
        </div>
      )}
    </section>
  );
}
