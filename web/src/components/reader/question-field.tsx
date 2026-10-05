"use client";

// "Before you read" — what the reader wants from this paper (P1-03, ruling
// §1f.10; blueprint §3.1 ① 问).
//
// Asked per paper, and it may be left empty: with no question it is one
// quiet line — a label and an input — and nothing else, and the page below
// is the page it was. Up to five questions, one per line; Enter adds a line.
// The chips are suggestions, shown while the field has focus or holds a
// question, and they only ever fill a line when clicked — never by
// themselves.
//
// The questions are kept in this browser (`store/reading-questions.ts`) and
// go nowhere: the route that reads them (`lib/papers/reading-map.ts`) runs
// on this page. The field keeps its lines in local state and writes them
// through; it reads the store once, when it mounts (the page mounts it per
// paper, after the stores have loaded).
//
// This project's tests have no DOM: what the field shows is tested by
// rendering it, and what its handlers do through the pure functions below.

import { useEffect, useRef, useState } from "react";
import {
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  useReadingQuestionsStore,
  type PaperQuestions,
} from "@/store/reading-questions";
import { ASK, ROUTE } from "./copy";

/** Past this many characters a line shows its count. */
const COUNTER_FROM = 160;

export type ChipKind = "fill" | "prefix" | "gist";

export interface Chip {
  label: string;
  kind: ChipKind;
  /** What a click puts on the next empty line (none for the gist). */
  text: string;
}

export interface ChipGroup {
  label: string;
  chips: Chip[];
}

/** While the field has focus, holds a question, or the gist is chosen. */
export function showChips({ focused, lines, gist }: { focused: boolean; lines: readonly string[]; gist: boolean }): boolean {
  return focused || gist || lines.some((line) => line.trim().length > 0);
}

/** Typing any question turns the gist off. */
export function nextGist(gist: boolean, lines: readonly string[]): boolean {
  return gist && !lines.some((line) => line.trim().length > 0);
}

/** Enter on line `index`: a new line after it when it holds something and
 *  there is room; an empty line that already exists is used instead. */
export function addLineAfter(lines: readonly string[], index: number): { lines: string[]; focus: number } {
  const copy = [...lines];
  const empty = copy.findIndex((line, i) => i !== index && line.trim() === "");
  if (empty >= 0) return { lines: copy, focus: empty };
  if (!copy[index]?.trim() || copy.length >= MAX_QUESTIONS) return { lines: copy, focus: index };
  copy.splice(index + 1, 0, "");
  return { lines: copy, focus: index + 1 };
}

/** The last line removed leaves one empty line to type into. */
export function removeLine(lines: readonly string[], index: number): string[] {
  const rest = lines.filter((_, i) => i !== index);
  return rest.length > 0 ? rest : [""];
}

/** A chip's text on the next empty line, or a new line when there is room;
 *  `focus: -1` when all five are taken. */
export function fillNextLine(lines: readonly string[], text: string): { lines: string[]; focus: number } {
  const copy = [...lines];
  const empty = copy.findIndex((line) => line.trim() === "");
  if (empty >= 0) {
    copy[empty] = text;
    return { lines: copy, focus: empty };
  }
  if (copy.length >= MAX_QUESTIONS) return { lines: copy, focus: -1 };
  copy.push(text);
  return { lines: copy, focus: copy.length - 1 };
}

/** The chip groups, in order: the last paper's questions, the common
 *  questions, the reader's challenges; an empty group is left out. */
export function chipGroups({
  paperId,
  byPaper,
  previousPaperId,
  challenges,
}: {
  paperId: string;
  byPaper: Readonly<Record<string, PaperQuestions>>;
  previousPaperId: string | null;
  challenges: readonly string[];
}): ChipGroup[] {
  const groups: ChipGroup[] = [];
  const previous = previousPaperId && previousPaperId !== paperId ? byPaper[previousPaperId]?.items ?? [] : [];
  if (previous.length > 0) {
    groups.push({ label: ASK.groups.last, chips: previous.map((text) => ({ label: text, kind: "fill", text })) });
  }
  groups.push({
    label: ASK.groups.common,
    chips: [
      { label: ASK.chips.method, kind: "fill", text: ASK.chips.method },
      { label: ASK.chips.conclusions, kind: "fill", text: ASK.chips.conclusions },
      { label: ASK.chips.differ, kind: "prefix", text: ASK.differPrefix },
      { label: ASK.chips.gist, kind: "gist", text: "" },
    ],
  });
  if (challenges.length > 0) {
    groups.push({ label: ASK.groups.challenges, chips: challenges.map((text) => ({ label: text, kind: "fill", text })) });
  }
  return groups;
}

/**
 * P1-07 (§1f.18 a): the line still being written — the one with focus, until
 * Enter settles it — or null when every line is settled. A blur settles the
 * line it leaves; typing unsettles the line it is in.
 */
export type SettleEvent = { type: "focus" | "change" | "enter" | "blur"; index: number };

export function settleLine(unsettled: number | null, event: SettleEvent): number | null {
  switch (event.type) {
    case "focus":
    case "change":
      return event.index;
    case "enter":
    case "blur":
      return unsettled === event.index ? null : unsettled;
  }
}

/**
 * The vague hint is for settled questions only: never for the line being
 * typed — half a word is not a vague question — and only when some settled
 * line holds a question. `vague` is the page's route verdict (every stored
 * question too vague to point anywhere); the store still takes every
 * keystroke, so the tints follow the typing live.
 */
export function vagueHintShown({
  vague,
  lines,
  unsettled,
}: {
  vague: boolean;
  lines: readonly string[];
  unsettled: number | null;
}): boolean {
  return vague && lines.some((line, i) => i !== unsettled && line.trim().length > 0);
}

/**
 * P2-03 (§1g.11 a): which of the field's events settle the questions — the
 * set a deep report is asked about. A finished line settles: Enter, leaving
 * it, removing one. A keystroke does not (half a question is not one), nor
 * the gist (it is no question), nor a chip by itself (one that leaves the
 * caret in its line settles when the reader leaves that line).
 */
export type FieldEvent = "enter" | "blur" | "remove" | "change" | "gist" | "chip";

export function settlesQuestions(event: FieldEvent): boolean {
  return event === "enter" || event === "blur" || event === "remove";
}

/** The page's `q`: the first empty question line, else the last one. */
export function focusFirstEmptyQuestion(): void {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-ask-line]"));
  const target = inputs.find((input) => input.value.trim() === "") ?? inputs[inputs.length - 1];
  target?.focus();
}

export function QuestionField({
  paperId,
  challenges,
  vague = false,
}: {
  paperId: string;
  challenges: readonly string[];
  /** P1-05 (§1f.6, §1f.13): every question is too vague to route — the page
   *  tints nothing and the field says what would help. */
  vague?: boolean;
}) {
  // Read once, at mount: the page mounts this per paper, after the stores
  // have loaded. The last paper is the one asked about before this visit.
  const [initial] = useState(() => {
    const state = useReadingQuestionsStore.getState();
    const own = state.byPaper[paperId];
    return {
      lines: own && own.items.length > 0 ? [...own.items] : [""],
      gist: own?.gist ?? false,
      previousPaperId: state.lastPaperId !== paperId ? state.lastPaperId : null,
      byPaper: state.byPaper,
    };
  });
  const [lines, setLines] = useState<string[]>(initial.lines);
  const [gist, setGist] = useState(initial.gist);
  const [focused, setFocused] = useState(false);
  // P1-07 (§1f.18 a): the line being written, which the vague hint waits for.
  const [unsettled, setUnsettled] = useState<number | null>(null);
  const trackLine = (event: SettleEvent) => setUnsettled((current) => settleLine(current, event));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<{ index: number; caretAtEnd: boolean } | null>(null);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const input = inputs.current[pending.index];
    if (!input) return;
    input.focus();
    if (pending.caretAtEnd) input.setSelectionRange(input.value.length, input.value.length);
  });

  const commit = (next: string[], nextGistValue: boolean) => {
    setLines(next);
    setGist(nextGistValue);
    useReadingQuestionsStore.getState().set(paperId, next, nextGistValue);
  };
  /** After the commit, when the event finishes a line (P2-03). */
  const settleOn = (event: FieldEvent) => {
    if (settlesQuestions(event)) useReadingQuestionsStore.getState().settle(paperId);
  };

  const onChip = (chip: Chip) => {
    if (chip.kind === "gist") {
      commit(lines, !gist);
      return;
    }
    const filled = fillNextLine(lines, chip.text);
    if (filled.focus < 0) return;
    pendingFocus.current = { index: filled.focus, caretAtEnd: true };
    commit(filled.lines, nextGist(gist, filled.lines));
  };

  const groups = chipGroups({ paperId, byPaper: initial.byPaper, previousPaperId: initial.previousPaperId, challenges });
  const chipsShown = showChips({ focused, lines, gist });
  const full = lines.length >= MAX_QUESTIONS && lines.every((line) => line.trim() !== "");

  return (
    <section
      aria-label={ASK.heading}
      className="mt-6"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <label className="eyebrow inline-flex items-center gap-2 text-text-faint" htmlFor={`ask-${paperId}-0`}>
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {ASK.heading}
      </label>
      <ol className="mt-2 space-y-1">
        {lines.map((line, index) => (
          <li key={index} className="flex items-baseline gap-2">
            <input
              id={`ask-${paperId}-${index}`}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              data-ask-line=""
              type="text"
              value={line}
              maxLength={MAX_QUESTION_CHARS}
              placeholder={index === 0 ? ASK.placeholder : undefined}
              aria-label={index === 0 ? undefined : ASK.line(index + 1)}
              onFocus={() => trackLine({ type: "focus", index })}
              onBlur={() => {
                trackLine({ type: "blur", index });
                settleOn("blur");
              }}
              onChange={(event) => {
                const next = [...lines];
                next[index] = event.target.value;
                trackLine({ type: "change", index });
                commit(next, nextGist(gist, next));
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                trackLine({ type: "enter", index });
                const added = addLineAfter(lines, index);
                if (added.lines.length !== lines.length) {
                  pendingFocus.current = { index: added.focus, caretAtEnd: true };
                  commit(added.lines, gist);
                } else {
                  inputs.current[added.focus]?.focus();
                }
                settleOn("enter");
              }}
              className="min-w-0 flex-1 border-b border-border bg-transparent py-1 font-reading text-body-sm text-text placeholder:text-text-faint focus:border-heading focus:outline-none"
            />
            {line.length > COUNTER_FROM && (
              <span className="annotation shrink-0 text-text-faint">{ASK.counter(line.length)}</span>
            )}
            {(lines.length > 1 || line.trim() !== "") && (
              <button
                type="button"
                aria-label={ASK.remove(index + 1)}
                onClick={() => {
                  const next = removeLine(lines, index);
                  // The lines move up: nothing is mid-sentence any more.
                  setUnsettled(null);
                  commit(next, nextGist(gist, next));
                  settleOn("remove");
                }}
                className="annotation shrink-0 text-text-faint transition-colors hover:text-heading"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {vagueHintShown({ vague, lines, unsettled }) && (
        <p role="status" className="annotation mt-2 text-text-muted">
          {ROUTE.vague}
        </p>
      )}
      {chipsShown && (
        <div className="mt-3 space-y-2">
          <p className="annotation text-text-faint">{ASK.hint}</p>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="annotation text-text-faint">{group.label}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {group.chips.map((chip) => {
                  const selected = chip.kind === "gist" && gist;
                  return (
                    <button
                      key={`${chip.kind}:${chip.label}`}
                      type="button"
                      onClick={() => onChip(chip)}
                      disabled={chip.kind !== "gist" && full}
                      {...(chip.kind === "gist" ? { "aria-pressed": selected } : {})}
                      className={`annotation rounded-full border px-3 py-1 transition-colors disabled:opacity-50 ${
                        selected ? "border-heading text-heading" : "border-border text-text-muted hover:text-heading"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
