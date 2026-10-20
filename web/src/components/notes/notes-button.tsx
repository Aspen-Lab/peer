"use client";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not
// a band at the top of the column. Two renderings of one button, the page mounts both:
//
//   `edge` — a small tab fixed at the viewport's right edge, from `md` up. It is in the window's
//   pixels (mounted outside the zoomed page container, beside the "Explain this?" box), at least
//   27rem from the top whatever the window's height, clear of the upper right 400px. P11-14 (B P11-01 §3.1): while a card
//   stands in the margin — the explain card, a sticky, the notes window — the tab stands at the margin's left edge (the
//   margin's rect, `useMarginRect()`), beside the cards instead of under them; with no card it is on the window's edge.
//   P11-34 (BACKLOG-102): beside a card the tab is narrow — `EDGE_TAB_BESIDE_PX` — because the room it has there is the shell's
//   gutter, the divider and the centre's side padding (24 px; more only where the 38 em cap leaves blank), and a 25 px tab filled
//   it and touched the line ends. It stands at least 8 px clear of the text, from its frame's outer edge, at every window; the
//   text does not move. See `EDGE_TAB_BESIDE_PX`.
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

/**
 * P11-34 (BACKLOG-102; round 2, Theme A readers r1–r3): the edge tab's width while it stands beside a card, in the window's px.
 *
 * The tab ends at the margin's left edge, where the cards begin, so it never goes over one. Between that edge and the text's right edge lies the
 * shell's gutter: the centre's side padding (12) and the divider (12), 24 px at 1x and never less (Fit's zoom only enlarges it; where the text's
 * 38 em cap leaves blank it is more: 57 px at 1440 x 900, 277 at 1920 x 1080). The 25.1 px tab filled it: at 1024, 1093 and 1280 it overlapped the
 * line ends by 1.1 px. The tab keeps 8 px clear of the text counted from the outer edge of its 1 px frame (`shadow-card`), so its face is
 * 24 − 8 − 1 = 15 px wide: its left border, then the label's own line (the `eyebrow` face, 11.5 px, set solid here) with about a pixel either side.
 * The text column is not touched. A tab with no card stands on the window's edge, as wide as it was.
 *
 * Why not the other means (measured at 1024 x 768, Chromium): riding inside the card's left edge covers the card's own controls — a sticky's and a
 * figure's header button begins 1 px in, the figure's picture 6.6 px — and 24 px across needs 8 px of it; the gutter cannot be widened (the text
 * column and `.reader-centre` are not this file's, and the owner's "the text only re-wraps" holds); a tab that dodged the cards would move as the
 * explain card follows its selection down the page. The face is narrow; the hit area is not: see `EDGE_TAB_HIT_PX`.
 */
export const EDGE_TAB_BESIDE_PX = 15;

/**
 * The hit area of the edge tab beside a card, across: the face and a transparent strip on the text's side (`before:`), 9 px, which ends at the
 * text's right edge in the narrowest gutter, never past it. The strip lies over the centre's blank side padding: no word and no control is under it.
 * The card's side cannot have one: the card stands over it. (The face stands over the divider's hit area, as the tab always has.)
 */
export const EDGE_TAB_HIT_PX = 24;

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
  // Beside a card with a margin registered: the tab stands in the shell's gutter, at the margin's left edge (P11-34).
  const squeezed = beside && marginLeft !== undefined;
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
      style={squeezed ? { left: marginLeft, transform: "translateX(-100%)", width: EDGE_TAB_BESIDE_PX, lineHeight: 1 } : undefined}
      className={cn(
        // Fixed to the right edge — beside the cards instead of under them while one stands in the margin (at the margin's left edge,
        // from its rect; else the card's 360 px) — vertically from 27rem down (or the window's middle, if lower), clear of the upper
        // right 400px. The label runs down the tab (vertical writing mode), so it is as narrow as a line of type: in that mode `px`
        // pads the tab's top and bottom (the inline axis) and `py` its two sides, and the tab must not reach into the page's own
        // side margin (24px). Beside a card, at the margin's left edge, it is narrower still (`EDGE_TAB_BESIDE_PX`, set on its style),
        // with no side padding, and a transparent strip on the text's side gives it back its 24 px hit area (`EDGE_TAB_HIT_PX`).
        beside ? (marginLeft === undefined ? "right-[min(360px,100vw)]" : "") : "right-0",
        "fixed top-[max(27rem,50vh)] z-40 hidden md:flex items-center border border-r-0 border-border-strong bg-surface px-3 shadow-card",
        squeezed ? "py-0 before:absolute before:top-0 before:-left-[10px] before:h-full before:w-[9px]" : "py-1",
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
