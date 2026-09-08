"use client";

// The decision: one plain sentence saying what Peer has and has not read,
// then open · save · skip · copy, one key or one tap away. It sits directly
// after the paper's own words and before Peer's additions, so nothing above
// it moves when the sections or a model land, and a thumb reaches it on a
// phone. The sentence is `describeAvailability`'s, never typed here.

import Link from "next/link";
import type { Ref } from "react";
import { buttonVariants } from "@/components/ui/button";
import { IconArrowUpRight, IconLink } from "@/components/icons";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { BUTTON, DOI, progressSuffix } from "./copy";

const TOUCH_TARGET = "[@media(hover:none)]:min-h-11";
/**
 * A command, not a button: the key comes first and names it, the word says
 * what the key does, and the type is the mono the rest of the machine's own
 * voice is set in. The picture each one carried said nothing the word did not
 * — a bookmark beside "Save" — and three of them were noise around a key.
 */
const COMMAND = "font-mono text-body-sm font-normal";
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
  source,
  doi,
  isSaved,
  showAddKey,
  onSave,
  onSkip,
  onCopy,
  onOpen,
  onCopyDoi,
}: {
  ref?: Ref<HTMLDivElement>;
  sentences: string[];
  /** While the model works: the stream's stage under the sentence. */
  stage: { label: string; pct: number } | null;
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
}) {
  return (
    <div ref={ref}>
      <p className="font-reading text-lead text-text-muted measure-lede mt-12">
        {sentences.join(" ")}
        {stage && <span className="text-text-faint">{progressSuffix(stage.label)}</span>}
        {showAddKey && (
          <>
            {" "}
            <Link
              href="/welcome?step=ai"
              className={cn(
                "text-text-faint underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors duration-150 ease-snap",
                TOUCH_INLINE,
              )}
            >
              {BUTTON.addKey}
            </Link>
          </>
        )}
      </p>

      {stage && (
        // Two pixels of progress under the sentence — the only chrome the
        // model gets, and only while it works.
        <div
          role="progressbar"
          aria-valuenow={Math.round(stage.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={stage.label}
          className="h-[2px] mt-3 measure-lede overflow-hidden rounded-full bg-bg-secondary"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-snap motion-reduce:transition-none"
            style={{ width: `${Math.max(0, Math.min(100, stage.pct))}%` }}
          />
        </div>
      )}

      {/* From xl the block lives in the spread's 400–503px panel: the four
          lg pills need ≈510px on one row and would wrap 3+1, so there they
          are set two-up — [Open][Save] / [Skip][Copy], natural widths — the
          arrangement a phone already gives them. `justify-items-start`
          keeps the widths natural: grid items stretch to the track by
          default, which would set Skip as wide as the primary. Inert below
          xl. */}
      <div className="flex flex-wrap gap-3 mt-5 xl:grid xl:grid-cols-[repeat(2,max-content)] xl:justify-items-start">
        {source && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className={cn(buttonVariants({ tone: "primary", size: "lg" }), COMMAND, TOUCH_TARGET)}
          >
            <Kbd pointerOnly className="mr-0.5">
              o
            </Kbd>
            {source.label}
            {/* The one icon left on a command: it marks a destination — this
                leaves the page — where the others only named their key back
                to the reader. */}
            <IconArrowUpRight size={12} />
          </a>
        )}
        <button
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
          className={cn(
            buttonVariants({ tone: isSaved ? "accentSoft" : "soft", size: "lg" }),
            COMMAND,
            TOUCH_TARGET,
          )}
        >
          <Kbd pointerOnly className="mr-0.5">
            s
          </Kbd>
          {isSaved ? BUTTON.saved : BUTTON.save}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className={cn(buttonVariants({ tone: "soft", size: "lg" }), COMMAND, TOUCH_TARGET)}
        >
          <Kbd pointerOnly className="mr-0.5">
            x
          </Kbd>
          {BUTTON.skip}
        </button>
        <button
          type="button"
          onClick={onCopy}
          className={cn(buttonVariants({ tone: "ghost", size: "lg" }), COMMAND, TOUCH_TARGET)}
        >
          <Kbd pointerOnly className="mr-0.5">
            c
          </Kbd>
          {BUTTON.copy}
        </button>
      </div>

      {doi && (
        <button
          type="button"
          onClick={onCopyDoi}
          aria-label={DOI.copy(doi)}
          className={cn(
            // `xl:wrap-anywhere`: a 60-char DOI is ≈450px of 12.5px mono and
            // would overflow the spread's 400px panel; a phone has the full
            // column and the DOI holds one line there as today. `text-left`:
            // a button centres its text by default, so a wrapped DOI's
            // second line would sit centred under a left-aligned first.
            "flex text-left font-mono text-meta text-text-muted mt-3 hover:text-heading transition-colors duration-150 ease-snap xl:wrap-anywhere",
            TOUCH_LINE,
          )}
        >
          <IconLink size={12} className="shrink-0 translate-y-[2px] mr-1.5" />
          doi:{doi}
        </button>
      )}
    </div>
  );
}
