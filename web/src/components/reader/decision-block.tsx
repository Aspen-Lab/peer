"use client";

// The decision: one plain sentence saying what Peer has and has not read,
// then open · save · skip · copy, one key or one tap away. It sits directly
// after the paper's own words and before Peer's additions, so nothing above
// it moves when the sections or a model land, and a thumb reaches it on a
// phone. The sentence is `describeAvailability`'s, never typed here.

import Link from "next/link";
import type { Ref } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { PaperReading } from "@/lib/papers/reading";
import { BUTTON, DOI, progressSuffix } from "./copy";

const TOUCH_TARGET = "[@media(hover:none)]:min-h-11";
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
      <p className="font-reading text-lead text-text-muted max-w-[60ch] mt-12">
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
          className="h-[2px] mt-3 max-w-[60ch] overflow-hidden rounded-full bg-bg-secondary"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-snap motion-reduce:transition-none"
            style={{ width: `${Math.max(0, Math.min(100, stage.pct))}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-5">
        {source && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className={cn(buttonVariants({ tone: "primary", size: "lg" }), TOUCH_TARGET)}
          >
            {source.label}
            <Kbd pointerOnly className="ml-1">
              o
            </Kbd>
          </a>
        )}
        <button
          type="button"
          onClick={onSave}
          aria-pressed={isSaved}
          className={cn(
            buttonVariants({ tone: isSaved ? "accentSoft" : "soft", size: "lg" }),
            TOUCH_TARGET,
          )}
        >
          {isSaved ? BUTTON.saved : BUTTON.save}
          <Kbd pointerOnly className="ml-1">
            s
          </Kbd>
        </button>
        <button
          type="button"
          onClick={onSkip}
          className={cn(buttonVariants({ tone: "soft", size: "lg" }), TOUCH_TARGET)}
        >
          {BUTTON.skip}
          <Kbd pointerOnly className="ml-1">
            x
          </Kbd>
        </button>
        <button
          type="button"
          onClick={onCopy}
          className={cn(buttonVariants({ tone: "ghost", size: "lg" }), TOUCH_TARGET)}
        >
          {BUTTON.copy}
          <Kbd pointerOnly className="ml-1">
            c
          </Kbd>
        </button>
      </div>

      {doi && (
        <button
          type="button"
          onClick={onCopyDoi}
          aria-label={DOI.copy(doi)}
          className={cn(
            "flex font-mono text-meta text-text-muted mt-3 hover:text-heading transition-colors duration-150 ease-snap",
            TOUCH_LINE,
          )}
        >
          doi:{doi}
        </button>
      )}
    </div>
  );
}
