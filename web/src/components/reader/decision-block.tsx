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
//
// P11-16 (B P11-01 §2.3, §3.2; ruling §1h.113 (a)): from 1024 css px the page is three panes, and the block is split between two of
// them. `part="commands"` is the commands alone — the left pane's fixed zone, under the title, where they stay in view — and
// `part="details"` is everything after them: the sentence, the private-PDF line, the DOI and the progress, in the pane's scroll zone after
// the map. The page hands the two to the layout in two slots; in one column the layout draws them one after the other, so the block reads
// as it always did, with the reading controls between the private-PDF line and the DOI. In the panes the controls stand at the top of the
// left pane (the layout draws them), so the details leave them out. With no `part` the block is whole, in that same order.

import Link from "next/link";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import type { Ref, ReactNode } from "react";
import { IconLink } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { useSpread } from "./reader-layout";
import { ReaderCommands } from "./reader-commands";
import { ReadingControls } from "./reading-controls";
import { BUTTON } from "./copy";

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

/** What the commands need. */
interface CommandsProps {
  /** The decided-read observer's element (the page's `decisionRef`): carried by the commands, whole or alone, and by nothing else. */
  ref?: Ref<HTMLDivElement>;
  /** The paper's own text, where Peer holds it: the command that keeps the
   *  reader here rather than sending them to a PDF viewer. */
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
  /** P7-14 (R9): the notes row in the command stack, which only a phone shows. */
  notesAction?: ReactNode;
  uploadAction?: ReactNode;
}

/** What the details need. */
interface DetailsProps {
  sentences: string[];
  /** While the model works: the stream's stage under the sentence. */
  stage: { label: string; pct: number | null } | null;
  doi?: string;
  /** No provider configured and the sentence names a key. */
  showAddKey: boolean;
  uploadStatus?: ReactNode;
}

export type DecisionBlockProps =
  | (CommandsProps & DetailsProps & { part?: undefined })
  | (CommandsProps & { part: "commands" })
  | (Pick<CommandsProps, "ref"> & DetailsProps & { part: "details" });

function Commands({ onRead, readLabel, source, isSaved, onSave, onSkip, onCopy, onOpen, notesAction, uploadAction }: CommandsProps) {
  return (
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
  );
}

function Details({ sentences, stage, doi, showAddKey, uploadStatus }: DetailsProps) {
  // From 1024 css px the sentence is a note in the left pane, set at the pane's size with a rule beside it, and the reading controls are
  // at the top of that pane. Below it the sentence is prose in the reading column, and the controls follow the private-PDF line. Either
  // way it follows the commands (P7-14, R2), at the same distance.
  const spread = useSpread();

  return (
    <>
      <p
        className={
          spread
            ? "mt-6 border-l border-border-strong pl-3 font-reading text-body leading-[1.55] text-text-muted"
            : "reading-prose mt-6 text-text-muted measure-lede"
        }
      >
        {sentences.join(" ")}
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

      {!spread && <ReadingControls />}

      {doi && DOI_SHAPE.test(doi) && (
        // P7-12 (R6): the journal's own page, not a copy button. `doi.org` resolves
        // the DOI with no model and no request from Peer.
        <a
          href={`https://doi.org/${doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            // `lg:wrap-anywhere` (P11-16: was `xl:`, the old spread's panel): a 60-char DOI is ≈450px of 12.5px mono and
            // would overflow the left pane's 296px; a phone has the full column and the DOI holds one line there as
            // today. `w-fit max-w-full`: the link is as wide as its text, so the empty space beside a short DOI is
            // not part of the target.
            "flex w-fit max-w-full font-mono text-meta text-text-muted mt-3 hover:text-heading transition-colors lg:wrap-anywhere",
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
    </>
  );
}

export function DecisionBlock({ ref, ...props }: DecisionBlockProps) {
  // The commands are the decided-read observer's element (`ref`): the part that stays on screen.
  if (props.part === "commands") {
    return (
      <div ref={ref}>
        <Commands {...props} />
      </div>
    );
  }
  if (props.part === "details") return <Details {...props} />;
  return (
    <div ref={ref}>
      <Commands {...props} />
      <Details {...props} />
    </div>
  );
}
