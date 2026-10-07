"use client";

// P5-01 (blueprint P5): the Profile page's editor for the standing questions —
// the few questions a reader brings to most papers. Add, edit, remove; up to
// five, 200 characters each, empty lines dropped when the reader leaves the
// field. The typed words are the reader's own: reading face. Peer's words (the
// hint, the add control) are in the label face, like the question box on a
// paper. The list lives in the profile store, in this browser only.
//
// The field keeps its lines in local state (so an empty line can exist while
// the reader types) and writes the cleaned list through on every change; it
// reads the store once, when it mounts.

import { useState } from "react";
import { useProfileStore } from "@/store/profile";
import { MAX_QUESTION_CHARS, MAX_QUESTIONS, cleanQuestions } from "@/store/reading-questions";
import { ASK, STANDING } from "@/components/reader/copy";

/** Past this many characters a line shows its count (as on a paper's question box). */
const COUNTER_FROM = 160;

/** The add control: one empty line after a filled last line, within the limit. */
export function addDraft(lines: readonly string[]): string[] {
  if (lines.length >= MAX_QUESTIONS) return [...lines];
  if (lines.length > 0 && lines[lines.length - 1].trim() === "") return [...lines];
  return [...lines, ""];
}

export function removeDraft(lines: readonly string[], index: number): string[] {
  return lines.filter((_, i) => i !== index);
}

/** Leaving the field drops the empty lines. */
export function dropEmptyDrafts(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim() !== "");
}

export function StandingQuestionsField() {
  const update = useProfileStore((s) => s.updateStandingQuestions);
  const [lines, setLines] = useState<string[]>(() => cleanQuestions(useProfileStore.getState().profile.standingQuestions ?? []));

  const commit = (next: string[]) => {
    setLines(next);
    update(next);
  };

  return (
    <div
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        const kept = dropEmptyDrafts(lines);
        if (kept.length !== lines.length) setLines(kept);
      }}
    >
      <ol className="space-y-1">
        {lines.map((line, index) => (
          <li key={index} className="flex items-baseline gap-2">
            <input
              type="text"
              value={line}
              maxLength={MAX_QUESTION_CHARS}
              placeholder={STANDING.placeholder}
              aria-label={STANDING.line(index + 1)}
              onChange={(event) => {
                const next = [...lines];
                next[index] = event.target.value;
                commit(next);
              }}
              className="min-w-0 flex-1 border-b border-border bg-transparent py-1 font-reading text-body-sm text-text placeholder:text-text-faint focus:border-heading focus:outline-none"
            />
            {line.length > COUNTER_FROM && (
              <span className="annotation shrink-0 text-text-faint">{ASK.counter(line.length)}</span>
            )}
            <button
              type="button"
              aria-label={STANDING.remove(index + 1)}
              onClick={() => commit(removeDraft(lines, index))}
              className="annotation shrink-0 text-text-faint transition-colors hover:text-heading"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      {lines.length < MAX_QUESTIONS && (
        <button
          type="button"
          onClick={() => setLines(addDraft(lines))}
          className="annotation mt-2 rounded-full border border-border px-3 py-1 text-text-muted transition-colors hover:text-heading"
        >
          {STANDING.add}
        </button>
      )}
      <p className="annotation mt-2 text-text-faint">{STANDING.hint}</p>
    </div>
  );
}
