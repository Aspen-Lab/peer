"use client";

// "Before you read" — what the reader wants from this paper (P1-03, ruling
// §1f.10; blueprint §3.1 ① 问).
//
// Asked per paper, and it may be left empty: with no question it is one
// quiet line — a label and an input — and nothing else, and the page below
// is the page it was. Up to five questions, one per line; Enter adds a line.
// The chips are suggestions, shown while the field has focus or holds a
// question, and they only ever fill a line when clicked — never by
// themselves. P1-09 (§1a.7, §1f.20): they are the reader's own — questions
// from earlier papers, and the profile asked as questions — built by the
// page (`lib/reader/question-examples.ts`); "Just get the gist" sits after
// them as a reading mode of its own.
//
// The questions are kept in this browser (`store/reading-questions.ts`); the
// route that reads them (`lib/papers/reading-map.ts`) runs on this page, and
// the settled ones travel with the one deep-report request that answers
// them (P2-03, §1g.11). The field keeps its lines in local state and writes them
// through; it reads the store once, when it mounts (the page mounts it per
// paper, after the stores have loaded).
//
// This project's tests have no DOM: what the field shows is tested by
// rendering it, and what its handlers do through the pure functions below.

import { useEffect, useRef, useState } from "react";
import {
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  cleanQuestions,
  notForRecommendations,
  settledQuestions,
  useReadingQuestionsStore,
} from "@/store/reading-questions";
import { useProfileStore } from "@/store/profile";
import { questionTerms } from "@/lib/preferences/question-terms";
import { ASK, ROUTE, STANDING } from "./copy";

/** Past this many characters a line shows its count. */
const COUNTER_FROM = 160;

/** An example tag: a click puts `text` on the next empty line. */
export interface Chip {
  label: string;
  text: string;
}

export interface ChipGroup {
  label: string;
  chips: Chip[];
}

/** P1-09 (§1f.20): the example groups the page builds (`exampleQuestions`). */
export interface ExampleGroupProp {
  label: string;
  items: readonly string[];
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

/** The chip groups, in the page's order (the reader's earlier questions,
 *  then the profile's); an empty group is left out. P1-09 (§1a.7): every
 *  example is the reader's own — there are no generic chips — and the gist
 *  is not among them (it is a reading mode, a control of its own). */
export function chipGroups(examples: readonly ExampleGroupProp[]): ChipGroup[] {
  return examples
    .filter((group) => group.items.length > 0)
    .map((group) => ({ label: group.label, chips: group.items.map((text) => ({ label: text, text })) }));
}

/**
 * P5-01 (blueprint P5): the reader's standing questions as one more chip group,
 * or null when there is none to offer. A chip puts its text on a line when
 * pressed — the example tags' own action — and nothing else ever does. A
 * question that is already a line of the box is not offered again. The list is
 * read defensively (it comes from a stored profile): text only, at most five.
 */
export function standingGroup(standing: readonly string[] | undefined, lines: readonly string[]): ChipGroup | null {
  const taken = new Set(lines.map((line) => line.trim().toLocaleLowerCase()));
  const chips = cleanQuestions((standing ?? []).filter((q): q is string => typeof q === "string"))
    .filter((q) => !taken.has(q.toLocaleLowerCase()))
    .map((text) => ({ label: text, text }));
  return chips.length > 0 ? { label: STANDING.chipGroup, chips } : null;
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
 * P2-08b (§1g.18): the deep report is asked about the questions only when the
 * box has settled as a whole — focus left it (every line and control in it
 * counts as inside), or Enter was pressed on the line that ends it — and the
 * reader then stayed idle for `BOX_IDLE_MS`. A line finished by Enter, by
 * leaving it or by removing one settles nothing, nor does a keystroke, the
 * gist or a chip: five questions typed with Enter between them are one deep
 * report, not five. (P2-03's per-line settle gave the free Tier 0 route the
 * same moment; that route reads `items` live and never needed it.)
 */
export const BOX_IDLE_MS = 1500;

/** `next` is the element that receives focus (null when none does). */
export function leftTheBox(box: Node, next: EventTarget | null): boolean {
  return !box.contains(next as Node | null);
}

/**
 * Enter on line `index` is the "done" gesture when there is nothing more to
 * add after it: the empty line at the end, or (§1g.21 (5)) the last line of a
 * full box, which has no room for another line. Anywhere else Enter moves on.
 */
export function enterEndsTheBox(lines: readonly string[], index: number): boolean {
  if (index !== lines.length - 1) return false;
  if (lines[index].trim() === "") return true;
  return lines.length >= MAX_QUESTIONS && lines.every((line) => line.trim() !== "");
}

/**
 * P5-02 (blueprint P5): tell the preference ledger what the paper's settled
 * questions hold — their specific terms, less those of any question marked "Not
 * for recommendations". Replaces the paper's earlier terms; a call that changes
 * nothing changes nothing. Runs when the questions settle and when a mark moves,
 * never on a keystroke.
 */
export function syncQuestionTerms(paperId: string): void {
  const entry = useReadingQuestionsStore.getState().byPaper[paperId];
  useProfileStore.getState().recordQuestionTerms(paperId, questionTerms(settledQuestions(entry), notForRecommendations(entry)));
}

/** Settle the paper's questions (P2-03), then let the ledger hear of them. */
export function settleQuestions(paperId: string): void {
  useReadingQuestionsStore.getState().settle(paperId);
  syncQuestionTerms(paperId);
}

const sameQuestion = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** The page's `q`: the first empty question line, else the last one. */
export function focusFirstEmptyQuestion(): void {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-ask-line]"));
  const target = inputs.find((input) => input.value.trim() === "") ?? inputs[inputs.length - 1];
  target?.focus();
}

export function QuestionField({
  paperId,
  examples,
  standing,
  vague = false,
  idleMs = BOX_IDLE_MS,
}: {
  /** P2-08b (§1g.18): how long the reader stays idle, after the box settles,
   *  before the questions settle. Tests pass a few milliseconds; the page nothing. */
  idleMs?: number;
  paperId: string;
  /** P1-09 (§1f.20): the example tags, from the reader's earlier questions
   *  and profile only. */
  examples: readonly ExampleGroupProp[];
  /** P5-01: the reader's standing questions (the profile's); one more chip
   *  group, never filled in. */
  standing?: readonly string[];
  /** P1-05 (§1f.6, §1f.13): every question is too vague to route — the page
   *  tints nothing and the field says what would help. */
  vague?: boolean;
}) {
  // Read once, at mount: the page mounts this per paper, after the stores
  // have loaded.
  const [initial] = useState(() => {
    const own = useReadingQuestionsStore.getState().byPaper[paperId];
    return {
      lines: own && own.items.length > 0 ? [...own.items] : [""],
      gist: own?.gist ?? false,
      marked: own?.notForRecs ? [...own.notForRecs] : [],
    };
  });
  const [lines, setLines] = useState<string[]>(initial.lines);
  const [gist, setGist] = useState(initial.gist);
  // P5-02: the questions (their text) marked "Not for recommendations".
  const [marked, setMarked] = useState<string[]>(initial.marked);
  const isMarked = (line: string) => marked.some((m) => sameQuestion(m, line));
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

  // P2-08b (§1g.18): the questions settle — what a deep report is asked about —
  // when the box has settled as a whole and the reader has then been idle for
  // `idleMs`; coming back into the box, or anything done in it, ends the wait.
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // P2-10 (§1g.21 (6)): the wait's `pagehide` listener, there only while the wait
  // is pending.
  const pageHide = useRef<(() => void) | null>(null);
  const stopIdle = () => {
    if (pageHide.current !== null) {
      window.removeEventListener("pagehide", pageHide.current);
      pageHide.current = null;
    }
    if (idle.current === null) return;
    clearTimeout(idle.current);
    idle.current = null;
  };
  const settleBoxSoon = () => {
    stopIdle();
    // One settle for the three ways the wait can end: the timer, and — a reload
    // or a closed tab, where React's cleanup below never runs — `pagehide`.
    // Whichever comes first ends the other. Nothing is sent from here: the
    // settled questions travel with the next open, as after in-app navigation.
    const settleNow = () => {
      stopIdle();
      settleQuestions(paperId);
    };
    pageHide.current = settleNow;
    window.addEventListener("pagehide", settleNow);
    idle.current = setTimeout(settleNow, idleMs);
  };
  // §1g.21 (5): leaving the page mid-wait settles at once — the questions were
  // finished; the reader just did not stay to see the answer.
  useEffect(
    () => () => {
      if (idle.current === null) return;
      stopIdle();
      settleQuestions(paperId);
    },
    [paperId],
  );

  const commit = (next: string[], nextGistValue: boolean, nextMarked: string[] = marked) => {
    stopIdle();
    setLines(next);
    setGist(nextGistValue);
    setMarked(nextMarked);
    useReadingQuestionsStore.getState().set(paperId, next, nextGistValue, undefined, nextMarked);
  };
  // P5-02: ticking or unticking a question is a finished gesture of its own: the
  // ledger hears of it at once (a tick takes the question's terms out; an untick
  // lets them in when the questions next settle).
  // P5-04 (S5): a tick settles the box as it stands before the ledger hears of it
  // — the settled questions and the marks as they are now. Without that the sync
  // read the marks as at the last settle, an edit had moved the live mark to the
  // new text, and the old text of an edited, ticked question came back into the
  // ledger at the next tick of another box. The untick keeps its P5-02 rule (its
  // words come in at the next settle), and the two-list rule for an edit with no
  // tick is unchanged.
  const onMark = (index: number, on: boolean) => {
    const rest = marked.filter((m) => !sameQuestion(m, lines[index]));
    commit(lines, gist, on ? [...rest, lines[index].trim()] : rest);
    if (on) settleQuestions(paperId);
    else syncQuestionTerms(paperId);
  };

  // The gist is a reading mode: it changes no line and settles nothing.
  const onGist = () => commit(lines, !gist);
  // An example fills the next empty line and focuses it; like typing, it
  // settles nothing until the box settles as a whole.
  const onChip = (chip: Chip) => {
    const filled = fillNextLine(lines, chip.text);
    if (filled.focus < 0) return;
    pendingFocus.current = { index: filled.focus, caretAtEnd: true };
    commit(filled.lines, nextGist(gist, filled.lines));
  };

  const standingChips = standingGroup(standing, lines);
  const groups = [...(standingChips ? [standingChips] : []), ...chipGroups(examples)];
  const chipsShown = showChips({ focused, lines, gist });
  const full = lines.length >= MAX_QUESTIONS && lines.every((line) => line.trim() !== "");

  return (
    <section
      aria-label={ASK.heading}
      className="mt-6"
      onFocus={() => {
        stopIdle();
        setFocused(true);
      }}
      onBlur={(event) => {
        // Focus moving to another line, chip or button of the box is not leaving it.
        if (!leftTheBox(event.currentTarget, event.relatedTarget)) return;
        setFocused(false);
        settleBoxSoon();
      }}
    >
      <label className="eyebrow inline-flex items-center gap-2 text-text-faint" htmlFor={`ask-${paperId}-0`}>
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {ASK.heading}
      </label>
      <ol className="mt-2 space-y-1">
        {lines.map((line, index) => (
          <li key={index} className={line.trim() !== "" ? "flex flex-wrap items-baseline gap-2" : "flex items-baseline gap-2"}>
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
              onBlur={() => trackLine({ type: "blur", index })}
              onChange={(event) => {
                const next = [...lines];
                next[index] = event.target.value;
                trackLine({ type: "change", index });
                // A ticked line stays ticked as the reader edits it.
                const carried = isMarked(lines[index])
                  ? [...marked.filter((m) => !sameQuestion(m, lines[index])), event.target.value.trim()]
                  : marked;
                commit(next, nextGist(gist, next), carried);
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
                if (enterEndsTheBox(lines, index)) settleBoxSoon();
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
                  // P5-04 (S3): deleting a question is a finished gesture, like a tick. The
                  // focused button goes with the line, so no blur reaches the box and the wait
                  // that `commit` stopped would never start again: the question's words stayed in
                  // the ledger until the box was next left. Settle and sync now, so they go at once.
                  settleQuestions(paperId);
                }}
                className="annotation shrink-0 text-text-faint transition-colors hover:text-heading"
              >
                ×
              </button>
            )}
            {line.trim() !== "" && (
              <label className="annotation inline-flex basis-full items-center gap-2 text-text-faint">
                <input
                  type="checkbox"
                  checked={isMarked(line)}
                  aria-label={ASK.notForRecsFor(index + 1)}
                  onChange={(event) => onMark(index, event.target.checked)}
                />
                {ASK.notForRecs}
              </label>
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
                {group.chips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => onChip(chip)}
                    disabled={full}
                    className="annotation rounded-full border border-border px-3 py-1 text-text-muted transition-colors hover:text-heading disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGist}
              aria-pressed={gist}
              className={`annotation rounded-full border px-3 py-1 transition-colors ${
                gist ? "border-heading text-heading" : "border-border text-text-muted hover:text-heading"
              }`}
            >
              {ASK.chips.gist}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
