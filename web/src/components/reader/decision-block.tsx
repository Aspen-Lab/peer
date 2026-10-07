"use client";

// The decision: one plain sentence saying what Peer has and has not read,
// then open · save · skip · copy, one key or one tap away. It sits directly
// after the paper's own words and before Peer's additions, so nothing above
// it moves when the sections or a model land, and a thumb reaches it on a
// phone. The sentence is `describeAvailability`'s, never typed here.
//
// The block only orders its parts: the commands are `ReaderCommands`, the
// reading controls are `ReadingControls`, and this file keeps the sentence,
// the DOI and the progress bar.

import Link from "next/link";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import type { Ref, ReactNode } from "react";
import { IconLink } from "@/components/icons";
import { cn } from "@/lib/cn";
import { SECTION_GAP } from "@/components/ui/band";
import type { PaperReading } from "@/lib/papers/reading";
import { useSpread } from "./reader-layout";
import { ReaderCommands } from "./reader-commands";
import { ReadingControls } from "./reading-controls";
import { BUTTON, DOI, PROGRESS_LABEL, progressSuffix } from "./copy";

/**
 * Touch room for a line of text that is a control, without moving the type:
 * the box grows to 44px with the text centred, and the margins give back
 * exactly what the box took (13px above, 13px below an 18px line) so the
 * line sits where it did.
 */
const TOUCH_LINE =
  "[@media(hover:none)]:min-h-11 [@media(hover:none)]:items-center [@media(hover:none)]:-mt-px [@media(hover:none)]:-mb-[13px]";
/** An inline link: vertical padding widens the hit area and leaves the line box alone. */
const TOUCH_INLINE = "[@media(hover:none)]:py-3.5";

export function DecisionBlock({
  ref,
  sentences,
  stage,
  onRead,
  readLabel,
  source,
  doi,
  isSaved,
  showAddKey,
  onSave,
  onSkip,
  onCopy,
  onOpen,
  onCopyDoi,
  uploadAction,
  uploadStatus,
}: {
  ref?: Ref<HTMLDivElement>;
  sentences: string[];
  /** While the model works: the stream's stage under the sentence. */
  stage: { label: string; pct: number } | null;
  /** The paper's own text, where Peer holds it: the command that keeps the
   *  reader here rather than sending them to a PDF viewer. */
  onRead?: () => void;
  readLabel?: string;
  source: PaperReading["source"];
  doi?: string;
  isSaved: boolean;
  /** No provider configured and the sentence names a key. */
  showAddKey: boolean;
  onSave: () => void;
  onSkip: () => void;
  onCopy: () => void;
  onOpen: () => void;
  onCopyDoi: () => void;
  uploadAction?: ReactNode;
  uploadStatus?: ReactNode;
}) {
  // On the spread the block is a panel under the title, not a pause under
  // the abstract: the sentence is a note there, set at the panel's size
  // with a rule beside it, and it sits close under the byline.
  const spread = useSpread();

  return (
    <div ref={ref}>
      <p
        className={
          spread
            ? "mt-6 border-l border-border-strong pl-3 font-reading text-body leading-[1.55] text-text-muted"
            : cn("reading-prose text-text-muted measure-lede", SECTION_GAP)
        }
      >
        {sentences.join(" ")}
        {stage && <span className="text-text-faint">{progressSuffix(stage.label)}</span>}
        {showAddKey && (
          <>
            {" "}
            <Link
              href={ADD_KEY_HREF}
              className={cn(
                "text-text-faint underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors ",
                TOUCH_INLINE,
              )}
            >
              {BUTTON.addKey}
            </Link>
          </>
        )}
      </p>

      <ReaderCommands
        onRead={onRead}
        readLabel={readLabel}
        source={source}
        isSaved={isSaved}
        onSave={onSave}
        onSkip={onSkip}
        onCopy={onCopy}
        onOpen={onOpen}
        uploadAction={uploadAction}
      />
      {uploadStatus}

      <ReadingControls />

      {doi && (
        <button
          type="button"
          onClick={onCopyDoi}
          aria-label={DOI.copy(doi)}
          className={cn(
            // `xl:wrap-anywhere`: a 60-char DOI is ≈450px of 12.5px mono and
            // would overflow the spread's 320–360px panel; a phone has the full
            // column and the DOI holds one line there as today. `text-left`:
            // a button centres its text by default, so a wrapped DOI's
            // second line would sit centred under a left-aligned first.
            "flex text-left font-mono text-meta text-text-muted mt-3 hover:text-heading transition-colors xl:wrap-anywhere",
            TOUCH_LINE,
          )}
        >
          <IconLink size={12} className="shrink-0 translate-y-[2px] mr-1.5" />
          doi:{doi}
        </button>
      )}

      {stage && (
        // S19: the last thing in the panel while generating — moved off
        // the sentence, widened, and labelled, so it reads as the whole
        // panel's own progress rather than a thin accent under one line.
        <>
          <div
            role="progressbar"
            aria-valuenow={Math.round(stage.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={stage.label}
            className="h-[6px] mt-3 overflow-hidden rounded-full bg-bg-secondary"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-snap motion-reduce:transition-none"
              style={{ width: `${Math.max(0, Math.min(100, stage.pct))}%` }}
            />
          </div>
          <p aria-live="polite" className="font-mono text-meta text-text-muted mt-1.5">
            {PROGRESS_LABEL}
          </p>
        </>
      )}
    </div>
  );
}
