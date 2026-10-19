"use client";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not
// a band at the top of the column. Two renderings of one button, the page mounts both:
//
//   `edge` — a small tab fixed at the viewport's right edge, from `md` up. It is in the window's
//   pixels (mounted outside the zoomed page container, beside the "Explain this?" box), at least
//   27rem from the top whatever the window's height, clear of the upper right 400px. P11-14 (B P11-01 §3.1): while a card
//   stands in the margin — the explain card, a sticky, the notes window — the tab stands at the margin's left edge (the
//   margin's rect, `useMarginRect()`), beside the cards instead of under them; with no card it is on the window's edge.
//
//   `row` — on a phone, where there is no edge to put a tab on, a full-width row in the command
//   stack (`DecisionBlock`'s `notesAction`), set like the other commands.
//
// What it does is the band's old `open()` (`paper-notes.tsx`): the paper's own notes, made the
// first time with the paper's title and your sticky notes (P10-09e: nothing else is placed in it).
//
// P10-09b (the owner's review 7.2): on the reading page the edge tab opens those notes as a floating window at
// the right (`notes-window.tsx`) instead of navigating, and while the window stands the tab stands beside it
// (360 px in), a second press closing it. The phone's row still navigates to the notes page (the phone is deferred).

import { useState } from "react";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { buttonVariants } from "@/components/ui/button";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { useMarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { NotesWindow } from "./notes-window";
import { usePaperNotes } from "./paper-notes";

/** "Notes" until the paper has a note of its own; then it says what a press does. */
export const NOTES_LABEL = { take: "Notes", open: "Open your notes" } as const;

export function notesLabel(has: boolean): string {
  return has ? NOTES_LABEL.open : NOTES_LABEL.take;
}

export const TAKE_TITLE = "Take notes on this paper: its title, and your sticky notes.";

export function NotesButtonView({
  variant,
  has,
  shown = false,
  beside = false,
  marginLeft,
  onOpen,
}: {
  variant: "edge" | "row";
  /** The paper already has a note of its own. */
  has: boolean;
  /** The notes window stands (the edge tab only): a press closes it. */
  shown?: boolean;
  /** A card stands in the margin (the explain card, a sticky, the notes window): the edge tab stands beside it, not under it. */
  beside?: boolean;
  /** The margin's left edge in the window's pixels, where a shell has registered one; else the cards stand at the right edge, 360 px wide. */
  marginLeft?: number;
  onOpen: () => void;
}) {
  const label = notesLabel(has);
  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          buttonVariants({ tone: "soft", size: "lg" }),
          COMMAND,
          "w-full justify-start px-3 md:hidden [@media(hover:none)]:min-h-11",
        )}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={shown}
      title={has ? undefined : TAKE_TITLE}
      style={beside && marginLeft !== undefined ? { left: marginLeft, transform: "translateX(-100%)" } : undefined}
      className={cn(
        // Fixed to the right edge — beside the cards instead of under them while one stands in the margin (at the margin's left edge,
        // from its rect; else the card's 360 px) — vertically from 27rem down (or the window's middle, if lower), clear of the upper
        // right 400px. The label runs down the tab (vertical writing mode), so it is as narrow as a line of type: in that mode `px`
        // pads the tab's top and bottom (the inline axis) and `py` its two sides, and the tab must not reach into the page's own
        // side margin (24px).
        beside ? (marginLeft === undefined ? "right-[min(360px,100vw)]" : "") : "right-0",
        "fixed top-[max(27rem,50vh)] z-40 hidden md:flex items-center border border-r-0 border-border-strong bg-surface px-3 py-1 shadow-card",
        "eyebrow text-text-muted transition-colors hover:bg-surface-hover hover:text-heading [writing-mode:vertical-rl]",
      )}
    >
      {label}
    </button>
  );
}

/** The paper's notes as a button: the right-edge tab or, for a phone, the command-stack row. */
export function NotesButton({
  variant,
  paper,
  questions,
  forYourQuestions,
}: {
  variant: "edge" | "row";
  paper: Paper;
  /** P2-05: the reader's settled questions, never the gist. */
  questions?: readonly string[];
  /** P2-05: the report's answers to them. */
  forYourQuestions?: readonly QuestionAnswers[];
}) {
  const [shown, setShown] = useState(false);
  // The edge tab opens the window; the row (a phone) navigates, as the band always did.
  const { ready, own, open } = usePaperNotes({
    paper,
    questions,
    forYourQuestions,
    openWindow: variant === "edge" ? () => setShown(true) : undefined,
  });
  const rect = useMarginRect();
  const standing = useWindows((s) => s.windows.length > 0);
  if (!ready) return null;
  return (
    <>
      <NotesButtonView
        variant={variant}
        has={own !== undefined}
        shown={variant === "edge" && shown}
        beside={variant === "edge" && (standing || shown)}
        marginLeft={rect?.left}
        onOpen={variant === "edge" && shown ? () => setShown(false) : open}
      />
      {variant === "edge" && shown && <NotesWindow paper={paper} onClose={() => setShown(false)} />}
    </>
  );
}
