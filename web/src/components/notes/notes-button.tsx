"use client";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not
// a band at the top of the column. Two renderings of one button, the page mounts both:
//
//   `edge` — a small tab fixed at the viewport's right edge, from `md` up. It is in the window's
//   pixels (mounted outside the zoomed page container, beside the "Explain this?" box), at least
//   27rem from the top where the window is tall enough, clear of the upper right 400px, and never lower than the foot legend
//   allows (P12-77, E1: see `EDGE_TAB_LENGTH_PX`). P11-14 (B P11-01 §3.1): while a card
//   stands in the margin — the explain card, a sticky, the notes window — the tab stands at the margin's left edge (the
//   margin's rect, `useMarginRect()`), beside the cards instead of under them; with no card it is on the window's edge.
//   P11-34 (BACKLOG-102): beside a card the tab is narrow — `EDGE_TAB_BESIDE_PX` — because the room it has there is the shell's
//   gutter, the divider and the centre's side padding (24 px; more only where the 38 em cap leaves blank), and a 25 px tab filled
//   it and touched the line ends. It stands at least 8 px clear of the text, from its frame's outer edge, at every window; the
//   text does not move. See `EDGE_TAB_BESIDE_PX`.
//   P11-46 (round 3, Theme B walk E-1): the tab, strip included, takes only a press that began on it; a drag that began in the paper
//   passes through it and ends at the line's end (`EDGE_TAB_PASSES_DRAG`).
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
import type { CSSProperties } from "react";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { buttonVariants } from "@/components/ui/button";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { legendHeightPx } from "@/components/reader/explain-dock";
import { readPageZoom, useMarginRect } from "@/lib/reader/margin";
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

/**
 * P11-46 (round 3, Theme B walk E-1; ruling §1h.148): the edge tab never catches a drag that began in the paper. It may only be pressed.
 *
 * The strip above begins at the text's right edge, and the face is 9 px further: a drag along a line is released 1 to 9 px past its end
 * (more, with a hand that overshoots) — over the tab. The browser then ends the selection at the tab's place in the document, the end of the paper
 * (48,483 characters at 1280 x 720 in the round-3 walk, with no buttons offered, as the selection is far over the 1,200-character cap); at 1440 and
 * 1920 the gutter is wider and the tab was clear.
 *
 * While a pointer is held anywhere (`:root:active`) and the tab is not what it went down on (`&:not(:active)`) the tab takes no pointer
 * (`pointer-events: none`, which its strip, a pseudo-element of it, inherits): the release lands on the text beside it and the selection ends at the
 * line's end, as with no tab there. A pointer that goes down on the tab — its face, its label or its strip — makes the tab `:active` (a
 * pseudo-element's state is its element's), so the rule does not apply and the press is the tab's, as it was; so is the keyboard's (Space or Enter on
 * the focused tab). With no pointer held it does not apply either, the hover and the 24 px hit area as they were.
 *
 * Why CSS and not a listener on the document (a flag set on `pointerdown` outside the tab, cleared on `pointerup`): the browser clears `:active` on
 * release, on cancel, on a context menu and when the window loses the pointer, so no state of ours can stay set and leave a tab that cannot be pressed;
 * there is no effect to mount, no re-render at every press and nothing for the server render to disagree with. A browser that does not give the
 * root `:active` simply keeps the tab as it was before this (the strip catches the drag), never worse. Why not the other means: `pointer-events: none`
 * on the strip alone leaves the face, 9 to 24 px from the text, catching the drag; dropping the strip leaves a 15 px hit area, under the 24 px floor
 * (P11-34 rule 1); a card's inset (`margin-card.tsx`) is not this file's.
 */
export const EDGE_TAB_PASSES_DRAG = "[:root:active_&:not(:active)]:pointer-events-none";

/**
 * P12-77 (E1; A P12-71 §6): the edge tab's length down the window, in px, whole: one line of label and the tab's own padding, set not left to
 * the label's width. `top-[max(27rem,50vh)]` put the tab 27rem down whatever the window's height, and the foot legend (a fixed 28 px bar, the
 * foot of the window) stood under it from 1024 x 576 (the tab ended at 574 against the legend's 548, over the "H" key cap beside a card) and,
 * at 853 x 480, the label wrapped to three lines (the room left under 27rem was 48 px) and the tab ran 16.5 px below the window.
 *
 * The length is 26 px (12 px of padding at each end and its two 1 px borders) and 8 px for each character of the label — Roboto Mono at the
 * `eyebrow` face's 11.5 px with 0.06em of tracking, measured 7.72 px a character in the page (141.9 px for "Open your notes", 64.5 for "Notes"),
 * 8 so that a fallback face a little wider than the real one still fits. The label does not wrap (`whitespace-nowrap`) and the tab is as
 * long as this says, so its top can be clamped to its foot: `top` is the 27rem it always had (or the window's middle, if lower) where the window is tall
 * enough, and otherwise the highest the foot allows: the window's height less what stands at its foot (`--tab-foot`), less `EDGE_TAB_FOOT_CLEAR_PX`
 * of air, less the tab's own length. It never goes above the masthead's foot (3rem) — a window under about 230 px high has no room for the
 * tab and the legend together, and the legend wins the foot.
 *
 * What stands at the foot is set on the tab itself, as a custom property, so one `top` serves both: from `md` the key legend, 28 px
 * (`--legend-h`; inside the Fit zoom, so 28 x zoom on the window's pixels: `--tab-legend`, below); under it the phone's thumb bar, 56 px
 * and the safe area (`THUMB_BAR_PX`, `thumb-bar.tsx`). The whole class names are written out for Tailwind to find.
 */
export const EDGE_TAB_LENGTH_PX = { take: 66, open: 146 } as const;

/** The air kept between the tab's foot and whatever stands under it (the legend's top, the thumb bar's top), in px. */
export const EDGE_TAB_FOOT_CLEAR_PX = 8;

const EDGE_TAB_PLACE = {
  take: "h-[66px] top-[max(3rem,min(max(27rem,50vh),calc(100vh-var(--tab-foot)-8px-66px)))]",
  open: "h-[146px] top-[max(3rem,min(max(27rem,50vh),calc(100vh-var(--tab-foot)-8px-146px)))]",
} as const;

/** What stands at the window's foot: the thumb bar under `md`, the key legend from it (its height, `--tab-legend` where Fit has made it taller). */
const EDGE_TAB_FOOT = "[--tab-foot:calc(56px+env(safe-area-inset-bottom,0px))] md:[--tab-foot:var(--tab-legend,var(--legend-h))]";

export function NotesButtonView({
  variant,
  has,
  shown = false,
  beside = false,
  marginLeft,
  zoom = 1,
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
  /** The page's Fit zoom, where it is not 1: the foot legend is that much taller in the window's pixels, and the tab keeps clear of it. */
  zoom?: number;
  onOpen: () => void;
}) {
  const label = notesLabel(has);
  // Beside a card with a margin registered: the tab stands in the shell's gutter, at the margin's left edge (P11-34).
  const squeezed = beside && marginLeft !== undefined;
  // P12-77: Fit's zoom makes the legend taller in the window's pixels (it is inside the zoomed page); the tab, outside it, is told how much.
  const taller = zoom !== 1 && Number.isFinite(zoom) && zoom > 0;
  const style: CSSProperties | undefined =
    squeezed || taller
      ? {
          ...(squeezed ? { left: marginLeft, transform: "translateX(-100%)", width: EDGE_TAB_BESIDE_PX, lineHeight: 1 } : {}),
          ...(taller ? ({ "--tab-legend": `${legendHeightPx(zoom)}px` } as CSSProperties) : {}),
        }
      : undefined;
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
      style={style}
      className={cn(
        // Fixed to the right edge — beside the cards instead of under them while one stands in the margin (at the margin's left edge,
        // from its rect; else the card's 360 px) — vertically from 27rem down (or the window's middle, if lower), clear of the upper
        // right 400px and, P12-77, clear of the foot legend whatever the window's height (`EDGE_TAB_LENGTH_PX`). The label runs down
        // the tab (vertical writing mode), so it is as narrow as a line of type: in that mode `px` pads the tab's top and bottom (the
        // inline axis) and `py` its two sides, and the tab must not reach into the page's own side margin (24px). Beside a card, at the margin's left edge, it is narrower still (`EDGE_TAB_BESIDE_PX`, set on its style),
        // with no side padding, and a transparent strip on the text's side gives it back its 24 px hit area (`EDGE_TAB_HIT_PX`).
        beside ? (marginLeft === undefined ? "right-[min(360px,100vw)]" : "") : "right-0",
        "fixed z-40 hidden md:flex items-center justify-center whitespace-nowrap border border-r-0 border-border-strong bg-surface px-3 shadow-card",
        EDGE_TAB_PLACE[has ? "open" : "take"],
        EDGE_TAB_FOOT,
        squeezed ? "py-0 before:absolute before:top-0 before:-left-[10px] before:h-full before:w-[9px]" : "py-1",
        // P11-46: a press that began outside the tab passes through it — the tab, strip included, only takes a press that began on it.
        EDGE_TAB_PASSES_DRAG,
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
  // P12-77: Fit's zoom, read where the tab is drawn (it mounts after the notes store has hydrated, never in the server render). It changes the
  // margin's rect, which this component reads, so the next render has the new one; below 1024 px Fit does nothing and the zoom is 1.
  return (
    <>
      <NotesButtonView
        variant={variant}
        has={own !== undefined}
        shown={variant === "edge" && shown}
        beside={variant === "edge" && (standing || shown)}
        marginLeft={rect?.left}
        zoom={readPageZoom()}
        onOpen={variant === "edge" && shown ? () => setShown(false) : open}
      />
      {variant === "edge" && shown && <NotesWindow paper={paper} onClose={() => setShown(false)} />}
    </>
  );
}
