"use client";

// Reading and the source come first; the remaining actions share a compact,
// wrapping toolbar that fits both the narrow desktop pane and a phone.

import type { ReactNode } from "react";
import { IconArrowRight, IconArrowUpRight, IconBook, IconBookmark, IconCopy } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { BUTTON } from "./copy";

export const COMMAND = "reader-action";

export function ReaderCommands({
  onRead,
  readLabel,
  source,
  isSaved,
  onSave,
  onSkip,
  onCopy,
  onOpen,
  notesAction,
  uploadAction,
}: {
  onRead?: () => void;
  readLabel?: string;
  source: PaperReading["source"];
  isSaved: boolean;
  onSave: () => void;
  /** "Not interested, then next". P1-08 (§1f.19): absent on an uploaded
   *  PDF's page, which then has no Skip button. */
  onSkip?: () => void;
  onCopy: () => void;
  onOpen: () => void;
  /** Opens the paper's notes on their own page. */
  notesAction?: ReactNode;
  uploadAction?: ReactNode;
}) {
  return (
    // One column up to a phone's width; the panel's own width on the spread.
    <div className="reader-command-stack mt-5 max-w-sm xl:max-w-none">
      {/* Where Peer has read the paper, reading it HERE is the first command
          and the source is the second. */}
      <div className="reader-open-actions">
      {onRead && (
        <button
          type="button"
          onClick={onRead}
          className={cn(COMMAND, "reader-primary-action")}
        >
          <IconBook size={16} />
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
            COMMAND,
            onRead ? "reader-source-action" : "reader-primary-action reader-primary-source",
          )}
        >
          <span className="min-w-0 truncate">{source.label}</span>
          {/* The one icon on a command: it marks a destination — this leaves
              the page — where the keys only name themselves. */}
          <IconArrowUpRight size={12} className="ml-auto shrink-0" />
        </a>
      )}
      </div>
      {/* Uploaded PDFs omit Skip; the remaining controls still flow naturally. */}
      <div className="reader-quick-actions" data-reader-quick-actions="">
        <button
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
          className={cn(COMMAND, "reader-quick-action")}
        >
          <IconBookmark size={16} filled={isSaved} />
          {isSaved ? BUTTON.saved : BUTTON.save}
        </button>
        {notesAction}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className={cn(COMMAND, "reader-quick-action")}
          >
            <IconArrowRight size={16} />
            {BUTTON.skip}
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          className={cn(COMMAND, "reader-quick-action")}
        >
          <IconCopy size={16} />
          {BUTTON.copy}
        </button>
      </div>
      {uploadAction}
    </div>
  );
}
