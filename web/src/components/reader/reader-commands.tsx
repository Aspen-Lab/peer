"use client";

// The decision's commands, as one stack with one edge.
//
// They used to be five pills in a two-up grid of natural widths, and the
// grid's tracks were sized by their content: the moment the source link and
// the upload shared a cell, that cell was wider than the whole panel, so Save
// and Copy were pushed across the gutter and printed over the reading column.
// A stack of full-width rows cannot do that — every row is the panel's width
// by construction, whatever its label says.
//
//   [t] Read it here                    ← the first command, the accent
//   [o] Open on arXiv                ↗  ← leaves the page
//   [s] Save  ·  [x] Skip  ·  [c] Copy   ← the three verdicts, one row
//   ↑  Upload full article PDF          ← where the reader brings the text

import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { IconArrowUpRight } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { BUTTON } from "./copy";

/**
 * A command, not a button: the key comes first and names it, the word says
 * what the key does, and the type is the mono the rest of the machine's own
 * voice is set in.
 */
export const COMMAND = "eyebrow";
const TOUCH_TARGET = "[@media(hover:none)]:min-h-11";
/** A full-width row: key and word on the left edge, the way a menu reads. */
const ROW = "w-full justify-start px-3";
/** A cell of the verdict row: the three share the row equally. */
const CELL = "w-full px-2";

export function ReaderCommands({
  onRead,
  readLabel,
  source,
  isSaved,
  onSave,
  onSkip,
  onCopy,
  onOpen,
  uploadAction,
}: {
  onRead?: () => void;
  readLabel?: string;
  source: PaperReading["source"];
  isSaved: boolean;
  onSave: () => void;
  onSkip: () => void;
  onCopy: () => void;
  onOpen: () => void;
  uploadAction?: ReactNode;
}) {
  return (
    // One column up to a phone's width; the panel's own width on the spread.
    <div className="mt-5 grid max-w-sm gap-2 xl:max-w-none">
      {/* Where Peer has read the paper, reading it HERE is the first command
          and the source is the second. */}
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className={cn(buttonVariants({ tone: "primary", size: "lg" }), COMMAND, ROW, TOUCH_TARGET)}
        >
          <Kbd pointerOnly className="mr-1">
            t
          </Kbd>
          {readLabel ?? "Read it here"}
        </button>
      )}
      {source && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          className={cn(
            buttonVariants({ tone: onRead ? "soft" : "primary", size: "lg" }),
            COMMAND,
            ROW,
            TOUCH_TARGET,
          )}
        >
          <Kbd pointerOnly className="mr-1">
            o
          </Kbd>
          <span className="min-w-0 truncate">{source.label}</span>
          {/* The one icon on a command: it marks a destination — this leaves
              the page — where the keys only name themselves. */}
          <IconArrowUpRight size={12} className="ml-auto shrink-0" />
        </a>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
          className={cn(
            buttonVariants({ tone: isSaved ? "accentSoft" : "soft", size: "lg" }),
            COMMAND,
            CELL,
            TOUCH_TARGET,
          )}
        >
          <Kbd pointerOnly>s</Kbd>
          {isSaved ? BUTTON.saved : BUTTON.save}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className={cn(buttonVariants({ tone: "soft", size: "lg" }), COMMAND, CELL, TOUCH_TARGET)}
        >
          <Kbd pointerOnly>x</Kbd>
          {BUTTON.skip}
        </button>
        <button
          type="button"
          onClick={onCopy}
          className={cn(buttonVariants({ tone: "soft", size: "lg" }), COMMAND, CELL, TOUCH_TARGET)}
        >
          <Kbd pointerOnly>c</Kbd>
          {BUTTON.copy}
        </button>
      </div>
      {uploadAction}
    </div>
  );
}
