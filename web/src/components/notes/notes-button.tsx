"use client";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not
// a band at the top of the column. Two renderings of one button, the page mounts both:
//
//   `edge` — a small tab fixed at the viewport's right edge, from `md` up. It is in the window's
//   pixels (mounted outside the zoomed page container, beside the "Explain this?" box), at least
//   27rem from the top whatever the window's height, clear of the upper right 400px. P7-15: the
//   AI discussion is a dock down the window's right edge (`explain-dock.ts`), and while it is open
//   the tab stands against the dock's left edge (`--explain-dock-width`, set on the document's
//   root), not under it; with no dock open that offset is 0 and the tab is on the window's edge.
//
//   `row` — on a phone, where there is no edge to put a tab on, a full-width row in the command
//   stack (`DecisionBlock`'s `notesAction`), set like the other commands.
//
// What it does is the band's old `open()` (`paper-notes.tsx`): the paper's own notes, made the
// first time from its card, the opening of its abstract and the settled questions.

import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { buttonVariants } from "@/components/ui/button";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { usePaperNotes } from "./paper-notes";

/** "Notes" until the paper has a note of its own; then it says what a press does. */
export const NOTES_LABEL = { take: "Notes", open: "Open your notes" } as const;

export function notesLabel(has: boolean): string {
  return has ? NOTES_LABEL.open : NOTES_LABEL.take;
}

const TAKE_TITLE = "Take notes on this paper: its card, the opening of its abstract, four questions to answer.";

export function NotesButtonView({
  variant,
  has,
  onOpen,
}: {
  variant: "edge" | "row";
  /** The paper already has a note of its own. */
  has: boolean;
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
      title={has ? undefined : TAKE_TITLE}
      className={cn(
        // Fixed to the right edge — beside the AI dock instead of under it while that is open (`right` is
        // the dock's width, set on the document's root by `explain-dock.ts`, else 0) — vertically from
        // 27rem down (or the window's middle, if lower), clear of the upper right 400px. The label runs down the tab (vertical writing mode), so it is as
        // narrow as a line of type: in that mode `px` pads the tab's top and bottom (the inline axis)
        // and `py` its two sides, and the tab must not reach into the page's own side margin (24px).
        "fixed right-[var(--explain-dock-width,0px)] top-[max(27rem,50vh)] z-40 hidden md:flex items-center border border-r-0 border-border-strong bg-surface px-3 py-1 shadow-card",
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
  const { ready, own, open } = usePaperNotes({ paper, questions, forYourQuestions });
  if (!ready) return null;
  return <NotesButtonView variant={variant} has={own !== undefined} onOpen={open} />;
}
