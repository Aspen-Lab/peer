"use client";

// The decision: open · save · skip · copy, one key or one tap away, and under
// them one plain sentence saying what Peer has and has not read. P7-14 (R2):
// the commands come first — the owner asked for them directly under the title —
// and the page puts the whole block right after the title in both layouts, so
// nothing above it moves when the sections or a model land, and a thumb reaches
// it on a phone. The sentence is `describeAvailability`'s, never typed here.
//
// The block only orders its parts: the commands (with the upload row) are
// `ReaderCommands`, the reading controls are `ReadingControls`, and this file
// keeps the sentence, the private-PDF line it is handed, the DOI (a link to
// the journal's page, P7-12) and the progress bar — in that order.

import Link from "next/link";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import type { Ref, ReactNode } from "react";
import { IconLink } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { useSpread } from "./reader-layout";
import { ReaderCommands } from "./reader-commands";
import { ReadingControls } from "./reading-controls";
import { BUTTON, progressSuffix } from "./copy";

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

/**
 * P7-12 (R6): what a DOI looks like — `10.`, a registrant code of four to nine digits, a slash,
 * and a suffix with no whitespace. An upload's DOI is read from page 1's text by a regex that
 * stops only at whitespace or a quote, so the string may be over-captured; the link is drawn
 * only for one that has this shape, and nothing is drawn for the rest.
 */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;

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
  notesAction,
  uploadAction,
  uploadStatus,
}: {
  ref?: Ref<HTMLDivElement>;
  sentences: string[];
  /** While the model works: the stream's stage under the sentence. */
  stage: { label: string; pct: number | null } | null;
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
  /** "Not interested, then next". P1-08 (§1f.19): absent on an uploaded
   *  PDF's page, which then has no Skip button. */
  onSkip?: () => void;
  onCopy: () => void;
  onOpen: () => void;
  /** P7-14 (R9): the notes row in the command stack, which only a phone shows. */
  notesAction?: ReactNode;
  uploadAction?: ReactNode;
  uploadStatus?: ReactNode;
}) {
  // On the spread the block is a panel under the title: the sentence is a
  // note there, set at the panel's size with a rule beside it. Below it the
  // sentence is prose in the reading column. Either way it follows the
  // commands (P7-14, R2), at the same distance.
  const spread = useSpread();

  return (
    <div ref={ref}>
      <ReaderCommands
        onRead={onRead}
        readLabel={readLabel}
        source={source}
        isSaved={isSaved}
        onSave={onSave}
        onSkip={onSkip}
        onCopy={onCopy}
        onOpen={onOpen}
        notesAction={notesAction}
        uploadAction={uploadAction}
      />

      <p
        className={
          spread
            ? "mt-6 border-l border-border-strong pl-3 font-reading text-body leading-[1.55] text-text-muted"
            : "reading-prose mt-6 text-text-muted measure-lede"
        }
      >
        {sentences.join(" ")}
        {stage && <span className="text-text-faint">{progressSuffix()}</span>}
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
      {uploadStatus}

      <ReadingControls />

      {doi && DOI_SHAPE.test(doi) && (
        // P7-12 (R6): the journal's own page, not a copy button. `doi.org` resolves
        // the DOI with no model and no request from Peer.
        <a
          href={`https://doi.org/${doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            // `xl:wrap-anywhere`: a 60-char DOI is ≈450px of 12.5px mono and
            // would overflow the spread's 320–360px panel; a phone has the full
            // column and the DOI holds one line there as today. `w-fit
            // max-w-full`: the link is as wide as its text, so the empty
            // space beside a short DOI is not part of the target.
            "flex w-fit max-w-full font-mono text-meta text-text-muted mt-3 hover:text-heading transition-colors xl:wrap-anywhere",
            TOUCH_LINE,
          )}
        >
          <IconLink size={12} className="shrink-0 translate-y-[2px] mr-1.5" />
          doi:{doi}
        </a>
      )}

      {stage && (
        // S19: the last thing in the panel while generating — moved off
        // the sentence, widened, and labelled, so it reads as the whole
        // panel's own progress rather than a thin accent under one line.
        // P10-41: the label says what the page is waiting on (the stage it is
        // given), not a fixed "loading report..."; it is drawn only while a
        // stage stands, which the hook ends with the request.
        // P10-45: the bar is drawn once a stage has said how far along it is (`pct`); a request that has
        // just started (the first one, or a queued one behind an earlier one that ended) shows its
        // words alone, so the bar never returns to 0.
        <>
          {stage.pct !== null && (
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
          )}
          <p aria-live="polite" className={cn("font-mono text-meta text-text-muted", stage.pct === null ? "mt-3" : "mt-1.5")}>
            {stage.label}…
          </p>
        </>
      )}
    </div>
  );
}
