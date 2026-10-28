"use client";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not
// a band at the top of the column. Two renderings of one button, the page mounts both:
//
//   `edge` — a small tab fixed at the viewport's right edge, at every width. It is in the window's
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
//   P12-77 (ruling §1h.455, item 2): under md there is no margin at the right — the cards stand in a band across the foot of the window — so
//   there the tab stays on the window's right edge whatever a card does, and ends 8 px above the band's top while one stands (`EDGE_TAB_BAND`).
//   P12-79 (E3; A P12-78 §6): the band is not a phone's alone. The page registers it at every width narrower than the panes need
//   (`railMinimumWidth(scale)`: 852 px at step 1.00, 900 at 1.10, 1,138 at 1.60), so a standing card is in the bottom band from 768 up to that
//   width and at the larger reading steps beyond it, and the tab was still placed "beside" it, at the band's left edge, x -7 to 8 (8 px of its
//   label showing). So the rule is the band's, not the width's: while a card stands in a registered bottom band, at any width, the tab keeps the
//   right edge and ends 8 px above the band's top. Beside a card in a side margin (the rail) it is placed as it was.
//
//   P12-89 (E5; A P12-88 §7): beside a card the tab no longer stands over the margin's pane divider. The divider's 12 px hit strip ends at the margin's
//   left edge (`DIVIDER_PX`, `pane-layout.ts`), and the tab, which stood at that edge with its face over the strip (`translateX(-100%)`), hid 146 px of it
//   and took the pointer there: `default`, and a drag at the tab's height did nothing. It now stands just inside the margin, to the right of the strip
//   (`EDGE_TAB_DIVIDER_CLEAR_PX`: its frame 2 px clear), above the cards (`z-[69]`) and, where the place it would take is a card's header, below that
//   header (`clearOfHeaders`): the header rows are read from the page, as the selection's actions read them (`openCards`).
//
//   `row` — on a phone, a full-width row in the command stack (`DecisionBlock`'s `notesAction`), set like the other commands.
//   P12-77 (rule 3, E2; reader A-r1 in A P12-71's pack): the row stays, but on a phone it stands near the top of the page, so the reader
//   scrolled up to press it and the notes page's "Back to paper" brought them back near the top (scrollY 8385 -> 85 and 6907 -> 92 at
//   390 x 844); at 1440 and 853 the fixed tab keeps the place exactly. So the tab is offered on a phone too, clamped above the thumb bar
//   (`EDGE_TAB_LENGTH_PX`), and a press there goes to the notes page as the row does — recording where the reader IS (`rememberPlace`,
//   in `usePaperNotes`) — instead of opening the window, which has no margin to stand in on a phone (`opensWindow`).
//
// What it does is the band's old `open()` (`paper-notes.tsx`): the paper's own notes, made the
// first time with the paper's title and your sticky notes (P10-09e: nothing else is placed in it).
//
// P10-09b (the owner's review 7.2): on the reading page the edge tab opens those notes as a floating window at
// the right (`notes-window.tsx`) instead of navigating, and while the window stands the tab stands beside it
// (360 px in), a second press closing it. The phone's row, and (P12-77) its edge tab, navigate to the notes page.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { buttonVariants } from "@/components/ui/button";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { legendHeightPx } from "@/components/reader/explain-dock";
import type { ViewRect } from "@/components/reader/paper-body";
import { openCards } from "@/components/reader/selection-toolbar";
import { readPageZoom, useMarginRect, useMarginStore } from "@/lib/reader/margin";
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
 *
 * P12-89 (E5): the tab no longer stands in that gutter — it stands inside the margin, just right of the divider (`EDGE_TAB_DIVIDER_CLEAR_PX`) — so the
 * gutter no longer sets the width. The face stays 15 px: it is the narrowest that holds the label's solid line (11.5 px) and its border, and every px
 * more is a px of the card it stands over (a card's text begins 13 px in: its border and 12 px of padding).
 */
export const EDGE_TAB_BESIDE_PX = 15;

/**
 * The hit area of the edge tab beside a card, across: the face and a transparent strip beside it (`before:`), 9 px. P12-89 (E5): the strip is on the
 * CARD's side now. On the text's side (P11-34) it ended at the text's edge, but it lay over the divider's 12 px hit strip, and the tab, strip included, took
 * the pointer there. The card stands under the tab (`z-[69]`), so the strip lies over the card's left padding and the first letters of its lines, in the
 * tab's own rows only (a card's header rows are never under it: `clearOfHeaders`).
 */
export const EDGE_TAB_HIT_PX = 24;

/**
 * P12-89 (E5; A P12-88 §7): beside a card the tab stands this far right of the margin's left edge, which is the right edge of the margin pane divider's
 * 12 px hit strip (`DIVIDER_PX`, `pane-layout.ts`; `pane-divider.tsx`: the strip is the grid track between the centre and the margin). 3 px, so that the
 * tab's frame (`shadow-card`, 1 px outside its box) stands 2 px clear of the strip and its box 3 px: the tab's rect never meets the strip, at any Fit zoom
 * (the margin's left edge is in the window's pixels, and the strip ends at it).
 */
export const EDGE_TAB_DIVIDER_CLEAR_PX = 3;

/** P12-89 (E5): the air kept between the tab and a card's header row when the tab stands below (or above) it, in px. */
export const EDGE_TAB_HEADER_CLEAR_PX = 4;

/**
 * P12-89 (E5): the tab's stacking beside a card. The cards of the margin stand from `STACK_Z_BASE` (60) to `STACK_Z_MAX` (69; `windows.ts`), and the tab,
 * which stood beside them at `z-40`, now stands over their left edge, so it is over them: 69, the top of the stack, under the selection's actions (`z-[70]`)
 * and the figure lightbox (`z-[80]`). With no card (`z-40`) it is as it was.
 */
const EDGE_TAB_OVER_CARDS = "z-[69]";

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
 * P12-77 (ruling §1h.455, item 3): on a phone the tab covers no text. The one-column page has a side padding of `px-5` (20 px) under 640 px and
 * `sm:px-6` (24 px) from it (`reader-shell.tsx`, `data-reader-one-column`), and the tab stands on the window's right edge: the 25.1 px tab of
 * the wide screen reached 5.1 px into the text at 390 x 844 (1.1 px at 640 and over). Under `md` it is as thick as that gutter — 20 px under
 * 640, 24 px from it (`max-sm`, `sm:max-md`) — with no side padding and no outer ring (`shadow-card` paints 1 px outside the box), so its
 * border box is all of it and ends where the text column does. The label's line (16.1 px) is held by the 19 px left of the border.
 * From `md` the tab is as it was.
 */
export const EDGE_TAB_PHONE_THICKNESS_PX = { narrow: 20, wide: 24 } as const;
const EDGE_TAB_PHONE = "max-sm:w-[20px] sm:max-md:w-[24px] max-md:py-0 max-md:shadow-none";

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
  take: "h-[66px] top-[max(var(--tab-floor),min(max(27rem,50vh),calc(100vh-var(--tab-foot)-8px-66px),calc(var(--tab-band)-8px-66px)))]",
  open: "h-[146px] top-[max(var(--tab-floor),min(max(27rem,50vh),calc(100vh-var(--tab-foot)-8px-146px),calc(var(--tab-band)-8px-146px)))]",
} as const;

/** What stands at the window's foot: the thumb bar under `md` (the tab is offered on a phone too: P12-77 rule 3), the key legend from it (its height, `--tab-legend` where Fit has made it taller). */
const EDGE_TAB_FOOT = "[--tab-foot:calc(56px+env(safe-area-inset-bottom,0px))] md:[--tab-foot:var(--tab-legend,var(--legend-h))]";

/**
 * P12-77 (ruling §1h.455, item 2; widened by P12-79, E3): the foot of the tab is also the top of the card band, while a card stands in it. Where
 * the page has registered the bottom band (`bottomMarginRectOf`, `margin.ts`: under `md`, and from it up to `railMinimumWidth(scale)` and
 * at the larger reading steps beyond) there is no margin at the right: the tab stays on the window's right edge whatever the card does (it is not
 * stood "beside" a margin that is not there) and ends 8 px above the band's top (`--tab-band-top`, written on the tab while a card stands in
 * the band) as it ends above the legend. With no band written (no card, or a side margin: the rail) `--tab-band` is the window's height, which
 * clamps nothing, and the tab is placed as it was. The least `top` is the masthead's foot from `md`, where there is a masthead, and the
 * window's top under it, where there is none.
 */
const EDGE_TAB_BAND = "[--tab-band:var(--tab-band-top,100vh)] [--tab-floor:0px] md:[--tab-floor:3rem]";

// ── Beside a card: where the tab stands, and the card headers it must not cover (P12-89, E5) ───────────────────────────────────────

/**
 * The top of the edge tab, in the window's px, as its class states it (`EDGE_TAB_PLACE`, from `md`, with no band): the 27rem it always had (or the window's
 * middle, if lower), never lower than the legend and the 8 px of air allow (`footPx`: the key legend's height at the page's zoom, `legendHeightPx`), never
 * above the masthead's foot (`floorPx`, 3rem). `remPx` is the root font size the rem lengths are in. A test holds it equal to the class, window by window.
 */
export function edgeTabTopPx({ viewportHeight, remPx = 16, length, footPx }: { viewportHeight: number; remPx?: number; length: number; footPx: number }): number {
  const middle = Math.max(27 * remPx, viewportHeight / 2);
  return Math.max(3 * remPx, Math.min(middle, viewportHeight - footPx - EDGE_TAB_FOOT_CLEAR_PX - length));
}

/**
 * P12-89 (E5): the tab's top that keeps it off the cards' header rows — or undefined when the place it has (`wanted`) already covers none.
 *
 * `bands` are the header rows of the cards that stand, in the window's px (`readHeaderBands`); `left` and `right` are the tab's own extent across. The tab covers
 * a header when it is within `gap` of it (`EDGE_TAB_HEADER_CLEAR_PX`). Where it would, it moves BELOW the header it meets (below the last of a stack of them
 * that it meets, each in turn): the smallest top under the headers' foot that is clear; failing that, ABOVE (the largest clear top over them); and where no
 * place at all is clear — more headers than the margin has room between — the place that covers the least of them. A top is held between `least` (the
 * masthead's foot) and `most` (8 px above the legend: the tab's foot rule, P12-77), so this never undoes E1.
 */
export function clearOfHeaders({
  wanted,
  length,
  left,
  right,
  bands,
  least,
  most,
  gap = EDGE_TAB_HEADER_CLEAR_PX,
}: {
  wanted: number;
  length: number;
  left: number;
  right: number;
  bands: readonly ViewRect[];
  least: number;
  most: number;
  gap?: number;
}): number | undefined {
  const rows = bands.filter((b) => b.right > left && b.left < right && b.bottom > b.top);
  const covered = (top: number) => rows.reduce((sum, b) => sum + Math.max(0, Math.min(top + length, b.bottom + gap) - Math.max(top, b.top - gap)), 0);
  if (rows.length === 0 || covered(wanted) === 0) return undefined;
  const lowest = Math.max(least, most);
  const held = (top: number) => Math.min(Math.max(top, least), lowest);
  const places = [...new Set(rows.flatMap((b) => [Math.ceil(b.bottom + gap), Math.floor(b.top - gap - length)]).map(held))];
  const clear = places.filter((top) => covered(top) === 0);
  const below = clear.filter((top) => top > wanted).sort((a, b) => a - b);
  if (below.length > 0) return below[0];
  const above = clear.filter((top) => top < wanted).sort((a, b) => b - a);
  if (above.length > 0) return above[0];
  return places.sort((a, b) => covered(a) - covered(b) || Math.abs(a - wanted) - Math.abs(b - wanted))[0];
}

/** The cards' header rows as the page draws them, in the window's px: the rows the selection's actions keep clear of too (`openCards`: a card's first element, the explain card's top row, the figure's zoom row). */
export function readHeaderBands(root: Pick<ParentNode, "querySelectorAll">): ViewRect[] {
  return openCards(root, true).headers.map(({ box }) => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom }));
}

const sameBands = (a: readonly ViewRect[], b: readonly ViewRect[]) =>
  a.length === b.length && a.every((x, i) => Math.abs(x.top - b[i].top) < 0.5 && Math.abs(x.bottom - b[i].bottom) < 0.5 && Math.abs(x.left - b[i].left) < 0.5 && Math.abs(x.right - b[i].right) < 0.5);

/**
 * The header rows of the standing cards, kept current while `watch` (the tab stands beside a card). They are read from the page once the cards have drawn — a
 * frame after the stack, the margin, the window or a scroll changes (the explain card follows its selection through the stack's store; a stack that scrolls
 * in its own host moves its headers by scroll) — never in render. Without a page to read (the server, a test with no DOM) there are none.
 */
const NO_BANDS: readonly ViewRect[] = [];

function useHeaderBands(watch: boolean): readonly ViewRect[] {
  const [bands, setBands] = useState<readonly ViewRect[]>(NO_BANDS);
  useEffect(() => {
    if (!watch || typeof window === "undefined" || typeof document === "undefined") return;
    let alive = true;
    let queued = false;
    const read = () => {
      if (!alive) return;
      const next = readHeaderBands(document);
      setBands((old) => (sameBands(old, next) ? old : next));
    };
    const later = () => {
      if (queued) return;
      if (typeof requestAnimationFrame !== "function") return read();
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        read();
      });
    };
    later();
    const stops = [useWindows.subscribe(later), useMarginStore.subscribe(later)];
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, { capture: true, passive: true });
    return () => {
      alive = false;
      for (const stop of stops) stop();
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later, { capture: true });
      // the rows of cards that are gone are not the next card's
      setBands(NO_BANDS);
    };
  }, [watch]);
  return watch ? bands : NO_BANDS;
}

/** The root font size, in px: what the rem lengths of the tab's place are in. */
function rootFontPx(): number {
  const size = typeof document === "undefined" || typeof getComputedStyle !== "function" ? NaN : Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** The top the tab takes beside a card at `marginLeft` when its usual place would cover a card's header, else undefined (see `clearOfHeaders`). */
export function topBesideCard({ marginLeft, has, zoom, bands, viewportHeight, remPx = 16 }: { marginLeft: number; has: boolean; zoom: number; bands: readonly ViewRect[]; viewportHeight: number; remPx?: number }): number | undefined {
  const length = EDGE_TAB_LENGTH_PX[has ? "open" : "take"];
  const footPx = legendHeightPx(zoom);
  const left = marginLeft + EDGE_TAB_DIVIDER_CLEAR_PX;
  return clearOfHeaders({
    wanted: edgeTabTopPx({ viewportHeight, remPx, length, footPx }),
    length,
    left,
    right: left + EDGE_TAB_BESIDE_PX,
    bands,
    least: 3 * remPx,
    most: viewportHeight - footPx - EDGE_TAB_FOOT_CLEAR_PX - length,
  });
}

export function NotesButtonView({
  variant,
  has,
  shown = false,
  beside = false,
  marginLeft,
  zoom = 1,
  bandTop,
  clearTop,
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
  /** While a card stands in the bottom band (a phone, or any width narrower than the panes need): the band's top, in the window's pixels; the tab ends 8 px above it. */
  bandTop?: number;
  /** P12-89 (E5): beside a card, the top (window px) the tab takes when its usual place would cover a card's header row (`topBesideCard`); else absent. */
  clearTop?: number;
  onOpen: () => void;
}) {
  const label = notesLabel(has);
  // Beside a card with a margin registered: the tab stands in the shell's gutter, at the margin's left edge (P11-34).
  const squeezed = beside && marginLeft !== undefined;
  // P12-77: Fit's zoom makes the legend taller in the window's pixels (it is inside the zoomed page); the tab, outside it, is told how much.
  const taller = zoom !== 1 && Number.isFinite(zoom) && zoom > 0;
  const banded = bandTop !== undefined && Number.isFinite(bandTop);
  // P12-89: the tab's top is its class's, unless that place would cover a card's header row: then the number `NotesButton` worked out (inline, so it wins).
  const lowered = squeezed && clearTop !== undefined && Number.isFinite(clearTop);
  const style: CSSProperties | undefined =
    squeezed || taller || banded
      ? {
          // P12-89 (E5): just inside the margin, right of the divider's strip — not `translateX(-100%)` from the margin's edge, which was over the strip.
          ...(squeezed ? { left: marginLeft + EDGE_TAB_DIVIDER_CLEAR_PX, width: EDGE_TAB_BESIDE_PX, lineHeight: 1 } : {}),
          ...(lowered ? { top: clearTop } : {}),
          ...(taller ? ({ "--tab-legend": `${legendHeightPx(zoom)}px` } as CSSProperties) : {}),
          ...(banded ? ({ "--tab-band-top": `${bandTop}px` } as CSSProperties) : {}),
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
        // Fixed to the right edge — beside the cards while one stands in the margin (P12-89: just inside the margin, right of the divider's strip, over the
        // cards' left edge, from its rect; else the card's 360 px) — vertically from 27rem down (or the window's middle, if lower), clear of the upper
        // right 400px and, P12-77, clear of the foot legend whatever the window's height (`EDGE_TAB_LENGTH_PX`). The label runs down
        // the tab (vertical writing mode), so it is as narrow as a line of type: in that mode `px` pads the tab's top and bottom (the
        // inline axis) and `py` its two sides, and the tab must not reach into the page's own side margin (24px). Beside a card it is narrower still (`EDGE_TAB_BESIDE_PX`, set on its style),
        // with no side padding, and a transparent strip on the card's side gives it back its 24 px hit area (`EDGE_TAB_HIT_PX`).
        beside ? (marginLeft === undefined ? "right-[min(360px,100vw)]" : "") : "right-0",
        "fixed flex items-center justify-center whitespace-nowrap border border-r-0 border-border-strong bg-surface px-3 shadow-card",
        squeezed ? EDGE_TAB_OVER_CARDS : "z-40",
        EDGE_TAB_PLACE[has ? "open" : "take"],
        EDGE_TAB_FOOT,
        EDGE_TAB_BAND,
        EDGE_TAB_PHONE,
        squeezed ? "py-0 before:absolute before:top-0 before:-right-[9px] before:h-full before:w-[9px]" : "py-1",
        // P11-46: a press that began outside the tab passes through it — the tab, strip included, only takes a press that began on it.
        EDGE_TAB_PASSES_DRAG,
        "eyebrow text-text-muted transition-colors hover:bg-surface-hover hover:text-heading [writing-mode:vertical-rl]",
      )}
    >
      {label}
    </button>
  );
}

/** Tailwind's `md` (48rem), as a query: from it the legend, the masthead and the margin stand, and "Open your notes" opens the window. */
export const WINDOW_QUERY = "(min-width: 48rem)";

const browserMatches = (query: string): boolean =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia(query).matches;

/**
 * P12-77 (rule 3): does a press on the edge tab open the floating window here? From `md` it does, as it always did. On a phone there is no
 * margin for a window to stand in (the cards stand in a band at the foot, over the thumb bar's reach), so the press goes to the notes page
 * as the row's does, recording the place the reader is at. Asked at the press, so a window that is turned or resized answers for what it is
 * now; where there is no window to ask (the server, a test without a DOM) it is the wide screen's answer.
 */
export function opensWindow(matches: (query: string) => boolean = browserMatches): boolean {
  return matches(WINDOW_QUERY);
}

/**
 * P12-77 (ruling §1h.455, item 2): is the window under `md` — a phone? Read when the tab is drawn (the first render has the answer: the tab
 * is drawn only after the notes store has hydrated, never in the server render) and kept as the window crosses 48rem. Only the edge tab asks.
 */
function usePhone(asks: boolean): boolean {
  const [phone, setPhone] = useState(() => asks && !opensWindow());
  useEffect(() => {
    if (!asks || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia(WINDOW_QUERY);
    const sync = () => setPhone(!wide.matches);
    sync();
    wide.addEventListener?.("change", sync);
    return () => wide.removeEventListener?.("change", sync);
  }, [asks]);
  return phone;
}

/** The paper's notes as a button: the right-edge tab and, for a phone, also the command-stack row. */
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
  // The edge tab opens the window; the row navigates, as the band always did.
  const { ready, own, open: openWindow } = usePaperNotes({
    paper,
    questions,
    forYourQuestions,
    openWindow: variant === "edge" ? () => setShown(true) : undefined,
  });
  // P12-77 (rule 3): the same press that navigates, for the edge tab on a phone. Without `openWindow`, `usePaperNotes` records the place
  // the reader is at and goes to the notes page; the tab is fixed, so that is wherever they are, not where a row would have taken them.
  const { open: openPage } = usePaperNotes({ paper, questions, forYourQuestions });
  const open = () => (variant === "edge" && opensWindow() ? openWindow() : openPage());
  const rect = useMarginRect();
  const standing = useWindows((s) => s.windows.length > 0);
  // P12-77 (ruling §1h.455, item 2): on a phone the cards stand in a band across the foot (`presentation: "bottom"`, left 8), not in a margin at
  // the right, so the tab does not stand "beside" it (that put it at the band's left edge, x −7 to 8): it stays on the window's right edge and
  // ends 8 px above the band's top while a card stands.
  // P12-79 (E3): the same band is registered from 768 px up to the panes' minimum width and at the larger reading steps beyond it, so the
  // rule is the band's, not the phone's: a card (or the notes window) standing in a registered bottom band, at any width, is "no side
  // margin". Only a side margin (the rail, `presentation` unset) has the tab stand beside the card at its left edge.
  const phone = usePhone(variant === "edge");
  const active = variant === "edge" && (standing || shown);
  const banded = active && rect?.presentation === "bottom";
  const beside = active && !phone && !banded;
  // P12-89 (E5): beside a card at a registered margin the tab stands inside the margin, over the cards' left edge, so the header rows of the cards that stand are
  // read from the page, to keep the tab off them.
  const bands = useHeaderBands(beside && rect?.left !== undefined);
  if (!ready) return null;
  // P12-77: Fit's zoom, read where the tab is drawn (it mounts after the notes store has hydrated, never in the server render). It changes the
  // margin's rect, which this component reads, so the next render has the new one; below 1024 px Fit does nothing and the zoom is 1.
  const zoom = readPageZoom();
  const clearTop =
    beside && rect?.left !== undefined && typeof window !== "undefined"
      ? topBesideCard({ marginLeft: rect.left, has: own !== undefined, zoom, bands, viewportHeight: window.innerHeight, remPx: rootFontPx() })
      : undefined;
  return (
    <>
      <NotesButtonView
        variant={variant}
        has={own !== undefined}
        shown={variant === "edge" && shown}
        beside={beside}
        marginLeft={rect?.left}
        zoom={zoom}
        bandTop={banded ? rect?.top : undefined}
        clearTop={clearTop}
        onOpen={variant === "edge" && shown ? () => setShown(false) : open}
      />
      {variant === "edge" && shown && <NotesWindow paper={paper} onClose={() => setShown(false)} />}
    </>
  );
}
