"use client";

// "Before you read" — what the reader wants from this paper (P1-03, ruling
// §1f.10; blueprint §3.1 ① 问).
//
// Asked per paper, and it may be left empty: with no question it is one
// quiet line — a label and a box — and nothing else, and the page below
// is the page it was. Up to five questions, one per line; Enter adds a line.
// P7-13 (R11a): a line is a textarea that grows with its text, and takes 500
// characters (`MAX_QUESTION_CHARS`), so a long question is read whole.
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
// P7-13 (R11c, the owner's order): the reader says when the questions are done.
// A Submit button settles them at once, as Enter on an empty last line, a × and a
// tick do; leaving the box, a wait after leaving it and leaving the page settle
// nothing any more.
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
  type PaperQuestions,
} from "@/store/reading-questions";
import { useProfileStore } from "@/store/profile";
import { questionTerms } from "@/lib/preferences/question-terms";
import { ASK, ROUTE, STANDING } from "./copy";

/** Past this many characters a line shows its count (P7-13: 400 of the 500). */
const COUNTER_FROM = 400;

/**
 * P7-13 (R11a): a pasted line break becomes a space. A line of the box is one
 * question; an `<input>` stripped a newline on its own, a textarea keeps it.
 */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ");
}

/**
 * P7-13 (R11a): the line's height follows its content, as the explain box's
 * input does (`explain-box.tsx`). Reset to `auto` first so it can shrink, then
 * take `scrollHeight` plus the border the box adds around it. A box that is not
 * laid out (hidden, `scrollHeight` 0) keeps the height it had.
 */
export function fitHeight(el: HTMLTextAreaElement | null | undefined): void {
  if (!el?.style) return;
  const before = el.style.height;
  el.style.height = "auto";
  const content = el.scrollHeight;
  if (!content) {
    el.style.height = before;
    return;
  }
  el.style.height = `${content + (el.offsetHeight - el.clientHeight)}px`;
}

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
 * P5-04 (N5): a question appears under one group only. A standing question
 * pressed on one paper is stored as that paper's question, so on the next paper
 * it was also an example under "From your earlier questions"; the example groups
 * leave out a text that is one of the standing questions (trimmed, case-folded,
 * spaces folded), and a group left with nothing goes. The standing list is read
 * as the standing group reads it (text only, cleaned, at most five). With none
 * the groups come back as they were.
 */
export function withoutStandingRepeats(groups: readonly ChipGroup[], standing: readonly string[] | undefined): ChipGroup[] {
  const key = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const taken = new Set(cleanQuestions((standing ?? []).filter((q): q is string => typeof q === "string")).map(key));
  if (taken.size === 0) return [...groups];
  return groups
    .map((group) => (group.label === STANDING.chipGroup ? group : { ...group, chips: group.chips.filter((chip) => !taken.has(key(chip.text))) }))
    .filter((group) => group.chips.length > 0);
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
 * P2-08b (§1g.18) timed the deep report's questions to the box as a whole; P7-13 (R11c, the
 * owner's order) puts the reader in charge of it. A set is settled — and so asked about, on
 * the reader's own key — only by what they do on purpose: the Submit button, Enter on the
 * line that ends the box (below), a × or a tick. A line finished by Enter, by leaving it or by
 * removing one settles nothing by itself, nor does a keystroke, the gist or a chip, nor does
 * leaving the box (P2-08b's 1.5 s wait, `BOX_IDLE_MS`, is gone) or the page (P2-10's `pagehide`
 * settle is gone): five questions typed with Enter between them are one deep report, and it
 * goes out when the reader presses Submit.
 */

/** `next` is the element that receives focus (null when none does). The box is
 *  "focused" while focus is anywhere inside it; leaving it hides the chips. */
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

/** P7-13 (R11c): what the field last settled — the questions, and which of them were
 *  marked "Not for recommendations" when they were. */
export interface SettledSet {
  questions: readonly string[];
  marks: readonly string[];
}

/** The settled set of a stored entry; none for a paper that has no entry. */
export function settledSetOf(entry: PaperQuestions | undefined): SettledSet {
  return { questions: settledQuestions(entry), marks: entry?.settledNotForRecs ?? [] };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((q, i) => q === b[i]);

/**
 * P7-13 (R11c): whether Submit has anything to send — the box as it stands (the cleaned
 * lines, and which of them are marked) is not the settled set. Spaces and case at the edges
 * of a line change nothing; a mark moved does, because the ledger waits for it. A box cleared
 * of everything that was settled has something to send too: the ledger still holds those words.
 */
export function hasNewQuestions(lines: readonly string[], marked: readonly string[], settled: SettledSet): boolean {
  const questions = cleanQuestions(lines);
  const marks = questions.filter((question) => marked.some((m) => sameQuestion(m, question)));
  return !sameList(questions, settled.questions) || !sameList(marks, settled.marks);
}

/** The page's `q`: the first empty question line, else the last one. */
export function focusFirstEmptyQuestion(): void {
  // By the mark, not the tag: a line is a textarea since P7-13.
  const inputs = Array.from(document.querySelectorAll<HTMLTextAreaElement>("[data-ask-line]"));
  const target = inputs.find((input) => input.value.trim() === "") ?? inputs[inputs.length - 1];
  target?.focus();
}

export function QuestionField({
  paperId,
  examples,
  standing,
  vague = false,
}: {
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
      settled: settledSetOf(own),
    };
  });
  const [lines, setLines] = useState<string[]>(initial.lines);
  const [gist, setGist] = useState(initial.gist);
  // P5-02: the questions (their text) marked "Not for recommendations".
  const [marked, setMarked] = useState<string[]>(initial.marked);
  // P7-13 (R11c): what was last settled, to tell whether Submit has anything to send. It
  // follows the settles this field makes; nothing else settles a paper's questions.
  const [settled, setSettled] = useState<SettledSet>(initial.settled);
  const unsent = hasNewQuestions(lines, marked, settled);
  const isMarked = (line: string) => marked.some((m) => sameQuestion(m, line));
  const [focused, setFocused] = useState(false);
  // P1-07 (§1f.18 a): the line being written, which the vague hint waits for.
  const [unsettled, setUnsettled] = useState<number | null>(null);
  const trackLine = (event: SettleEvent) => setUnsettled((current) => settleLine(current, event));
  const inputs = useRef<Array<HTMLTextAreaElement | null>>([]);
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

  // P7-13 (R11a): every line grows or shrinks to its text — after each change of
  // the lines, and when the window is resized (the lines wrap differently).
  useEffect(() => {
    inputs.current.forEach(fitHeight);
  }, [lines]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refit = () => inputs.current.forEach(fitHeight);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  // P7-13 (R11c): the reader says the questions are done — Submit, Enter on the line that
  // ends the box, a × or a tick. The questions settle on the spot (the deep report is asked
  // about them), the ledger hears of them, and the button knows what was sent.
  const submit = () => {
    settleQuestions(paperId);
    setSettled(settledSetOf(useReadingQuestionsStore.getState().byPaper[paperId]));
  };

  const commit = (next: string[], nextGistValue: boolean, nextMarked: string[] = marked) => {
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
    if (on) submit();
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
  // P5-04 (N5): a question under one group only.
  const shownGroups = withoutStandingRepeats(groups, standing);
  const chipsShown = showChips({ focused, lines, gist });
  const full = lines.length >= MAX_QUESTIONS && lines.every((line) => line.trim() !== "");

  return (
    <section
      aria-label={ASK.heading}
      className="mt-6"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Focus moving to another line, chip or button of the box is not leaving it.
        // Leaving it settles nothing (P7-13): the reader presses Submit.
        if (!leftTheBox(event.currentTarget, event.relatedTarget)) return;
        setFocused(false);
      }}
    >
      <label className="eyebrow inline-flex items-center gap-2 text-text-faint" htmlFor={`ask-${paperId}-0`}>
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {ASK.heading}
      </label>
      <ol className="mt-2 space-y-1">
        {lines.map((line, index) => (
          <li key={index} className={line.trim() !== "" ? "flex flex-wrap items-baseline gap-2" : "flex items-baseline gap-2"}>
            <textarea
              id={`ask-${paperId}-${index}`}
              ref={(el) => {
                inputs.current[index] = el;
              }}
              data-ask-line=""
              rows={1}
              value={line}
              maxLength={MAX_QUESTION_CHARS}
              placeholder={index === 0 ? ASK.placeholder : undefined}
              aria-label={index === 0 ? undefined : ASK.line(index + 1)}
              onFocus={() => trackLine({ type: "focus", index })}
              onBlur={() => trackLine({ type: "blur", index })}
              onChange={(event) => {
                const text = oneLine(event.target.value);
                const next = [...lines];
                next[index] = text;
                trackLine({ type: "change", index });
                // A ticked line stays ticked as the reader edits it.
                const carried = isMarked(lines[index])
                  ? [...marked.filter((m) => !sameQuestion(m, lines[index])), text.trim()]
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
                if (enterEndsTheBox(lines, index)) submit();
              }}
              className="min-w-0 flex-1 resize-none overflow-hidden border-b border-border bg-transparent py-1 font-reading text-body-sm text-text placeholder:text-text-faint focus:border-heading focus:outline-none"
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
                  // focused button goes with the line, so no blur reaches the box: the question's
                  // words would stay in the ledger. Settle and sync now, so they go at once.
                  submit();
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
      {/* P7-13 (R11c): below the lines, right-aligned (full width on a phone), in the label face.
          Not in the quiet box (no question, nothing focused) — unless a cleared box still has
          something to send. Shown with no key too: it settles the ledger. */}
      {(chipsShown || unsent) && (
        <div className="mt-2 flex sm:justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={!unsent}
            className="annotation w-full rounded-full border border-border-strong px-3 py-1 text-heading transition-colors hover:bg-surface-hover disabled:opacity-50 sm:w-auto"
          >
            {ASK.submit}
          </button>
        </div>
      )}
      {vagueHintShown({ vague, lines, unsettled }) && (
        <p role="status" className="annotation mt-2 text-text-muted">
          {ROUTE.vague}
        </p>
      )}
      {chipsShown && (
        <div className="mt-3 space-y-2">
          <p className="annotation text-text-faint">{ASK.hint}</p>
          {shownGroups.map((group) => (
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
