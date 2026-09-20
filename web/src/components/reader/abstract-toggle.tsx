"use client";

// 8-03/S25: the abstract, collapsed by default. A big accent button that
// says "Abstract"; click to open, click again to close. Conditional
// rendering, not a CSS-only collapse — page.tsx's decided-read observer
// (`app/papers/[id]/page.tsx`, watches `wordsEndRef`) already falls back to
// the Decision block when its target ref is null (the same path a paper
// with no abstract at all takes today), and only conditional mounting keeps
// that ref null while collapsed. A `grid-template-rows` CSS collapse would
// leave the footer's ref permanently non-null and silently freeze the
// observer on an invisible target for as long as the reader leaves this
// closed — the new default.

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
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
          buttonVariants({ tone: "primary" }),
          // 48px+ tall (one step past 8-02's 44px floor), full row width —
          // button.tsx's cva size scale is untouched this round (dirty
          // file, Ruling 22), same local-override pattern as 8-02's
          // BACK_TO_MAIN_CLASS. Hover swell uses the "big surface" scale
          // (profile page's own hover:scale-[1.04]) rather than the small
          // controls' 1.25 — this button spans the full reading column, and
          // a 25% grow on that width would clip against the surrounding
          // prose.
          "w-full justify-between h-12 px-6 text-body-lg hover:scale-[1.04]",
        )}
      >
        {ABSTRACT_LABEL}
        <IconChevronDown
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
