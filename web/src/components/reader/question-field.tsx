"use client";

// "What you want to learn about this paper:" — the one question a reader brings to a paper
// (P1-03, ruling §1f.10; blueprint §3.1 ① 问; round P10, ruling §1h.78, the owner's review 2.2–2.7).
//
// Asked per paper, and it may be left empty: the page below is the page it was. P10: ONE question,
// in ONE bar — a search bar, not a strip of tags. A bordered, raised field the full width of the
// column, one row at rest, with the Submit control inside its right end; Enter submits. P7-13
// (R11a): the bar is a textarea that grows with its text and takes 500 characters
// (`MAX_QUESTION_CHARS`), so a long question is read whole; a pasted line break is folded to a space.
//
// The suggestions are a dropdown, open under the bar only while the field has focus, there is a typed
// character in it (P10-21, X-A6: the list "appears when typing"; an empty focused bar lists nothing) and the
// question is not settled — the text differs from the last submitted question, or nothing was
// submitted — and closed after Submit, on blur and on Escape. They are the reader's own
// (P1-09, §1a.7, §1f.20): questions from earlier papers, the profile asked as questions
// (`lib/reader/question-examples.ts`), the standing questions (P5-01), and, last and set apart,
// "Just get the gist", a reading mode of its own. Picking one fills the bar and never submits.
// P10-11 (BACKLOG-72): with text in the bar the list follows it — only the suggestions that contain a typed word
// (two letters or more, case-folded), the gist always last, alone when nothing matches; one letter is no word yet,
// so the first character lists every suggestion.
//
// The question is kept in this browser (`store/reading-questions.ts`); the route that reads it
// (`lib/papers/reading-map.ts`) runs on this page, and the settled one travels with the one
// deep-report request that answers it (P2-03, §1g.11). The field keeps its text in local state
// and writes it through; it reads the store once, when it mounts (the page mounts it per paper,
// after the stores have loaded). A reader who stored several questions before round P10 sees the
// first; the rest stay in storage until the reader first changes the bar, when the stored list
// becomes the one question.
//
// P7-13 (R11c): the reader says when the question is done — the Submit control or Enter. Leaving
// the box, a wait and leaving the page settle nothing. A submit with the text already submitted
// does nothing.
//
// This project's tests have no DOM: what the field shows is tested by rendering it, and what its
// handlers do through the pure functions below and the scripted hook runtime.

import { useEffect, useRef, useState } from "react";
import {
  MAX_QUESTION_CHARS,
  cleanQuestions,
  settledQuestions,
  useReadingQuestionsStore,
  type PaperQuestions,
} from "@/store/reading-questions";
import { useProfileStore } from "@/store/profile";
import { questionTerms } from "@/lib/preferences/question-terms";
import { ASK, ROUTE, STANDING } from "./copy";

/** Past this many characters the bar shows its count (P7-13: 400 of the 500). */
const COUNTER_FROM = 400;

/**
 * P7-13 (R11a): a pasted line break becomes a space. The bar holds one question; an `<input>`
 * stripped a newline on its own, a textarea keeps it.
 */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ");
}

/**
 * P7-13 (R11a): the bar's height follows its content, as the explain box's input does
 * (`explain-box.tsx`). Reset to `auto` first so it can shrink, then take `scrollHeight` plus the
 * border the box adds around it. A box that is not laid out (hidden, `scrollHeight` 0) keeps the
 * height it had.
 */
export function fitHeight(el: HTMLTextAreaElement | null | undefined): void {
  if (!el?.style) return;
  // An empty bar is one row, whatever its placeholder: a placeholder that wraps on a narrow screen must not grow it.
  if (el.value === "") {
    el.style.height = "";
    return;
  }
  const before = el.style.height;
  el.style.height = "auto";
  const content = el.scrollHeight;
  if (!content) {
    el.style.height = before;
    return;
  }
  el.style.height = `${content + (el.offsetHeight - el.clientHeight)}px`;
}

/** An example in the dropdown: picking it puts `text` in the bar. */
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

/** Typing any question turns the gist off. */
export function nextGist(gist: boolean, lines: readonly string[]): boolean {
  return gist && !lines.some((line) => line.trim().length > 0);
}

/** The groups, in the page's order (the reader's earlier questions, then the profile's); an empty
 *  group is left out. P1-09 (§1a.7): every example is the reader's own — there are no generic
 *  ones — and the gist is not among them (it is a reading mode, the dropdown's last item). */
export function chipGroups(examples: readonly ExampleGroupProp[]): ChipGroup[] {
  return examples
    .filter((group) => group.items.length > 0)
    .map((group) => ({ label: group.label, chips: group.items.map((text) => ({ label: text, text })) }));
}

/**
 * P5-01 (blueprint P5): the reader's standing questions as one more group, or null when there is
 * none to offer. Picking one puts its text in the bar — the examples' own action — and nothing
 * else ever does. A question that is already the bar's text is not offered again. The list is read
 * defensively (it comes from a stored profile): text only, at most five.
 */
export function standingGroup(standing: readonly string[] | undefined, lines: readonly string[]): ChipGroup | null {
  const taken = new Set(lines.map((line) => line.trim().toLocaleLowerCase()));
  const chips = cleanQuestions((standing ?? []).filter((q): q is string => typeof q === "string"))
    .filter((q) => !taken.has(q.toLocaleLowerCase()))
    .map((text) => ({ label: text, text }));
  return chips.length > 0 ? { label: STANDING.chipGroup, chips } : null;
}

/**
 * P5-04 (N5): a question appears under one group only. A standing question picked on one paper is
 * stored as that paper's question, so on the next paper it was also an example under "From your
 * earlier questions"; the example groups leave out a text that is one of the standing questions
 * (trimmed, case-folded, spaces folded), and a group left with nothing goes. The standing list is
 * read as the standing group reads it (text only, cleaned, at most five). With none the groups
 * come back as they were.
 */
export function withoutStandingRepeats(groups: readonly ChipGroup[], standing: readonly string[] | undefined): ChipGroup[] {
  const key = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const taken = new Set(cleanQuestions((standing ?? []).filter((q): q is string => typeof q === "string")).map(key));
  if (taken.size === 0) return [...groups];
  return groups
    .map((group) => (group.label === STANDING.chipGroup ? group : { ...group, chips: group.chips.filter((chip) => !taken.has(key(chip.text))) }))
    .filter((group) => group.chips.length > 0);
}

/** P10-11 (BACKLOG-72): the words of the bar's text that can match a suggestion — letters and digits, two or more. */
export function typedWords(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 2);
}

/**
 * P10-11 (X-A5, BACKLOG-72): the dropdown follows the typed text. With a typed word in the bar, a suggestion stays
 * only if it contains one of them (case-folded, any of the words); a group left with nothing goes. With an empty
 * bar — or text with no word of two letters yet — nothing is filtered (P10-21: the dropdown itself opens only once a
 * character is typed — the owner's "输入问题的时候自动弹出", `dropdownOpen`). "Just get the gist" is not a group; it is added after, always last.
 */
export function filterGroups(groups: readonly ChipGroup[], text: string): ChipGroup[] {
  const words = typedWords(text);
  if (words.length === 0) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      chips: group.chips.filter((chip) => {
        const own = chip.text.toLocaleLowerCase();
        return words.some((word) => own.includes(word));
      }),
    }))
    .filter((group) => group.chips.length > 0);
}

/** One item of the dropdown, in listing order: an example, or the gist (always last). */
export interface Suggestion {
  kind: "example" | "gist";
  text: string;
}

/** The dropdown's items as one list, the groups in order and "Just get the gist" last. */
export function suggestionItems(groups: readonly ChipGroup[]): Suggestion[] {
  return [
    ...groups.flatMap((group) => group.chips.map((chip): Suggestion => ({ kind: "example", text: chip.text }))),
    { kind: "gist", text: ASK.chips.gist },
  ];
}

/**
 * P1-07 (§1f.18 a): the bar while it is still being written — `0` from a focus or a change until
 * Enter or a blur — or null when it is settled. The index is the bar's (always 0) and is kept so
 * the vague hint's rule reads as it did.
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
 * The vague hint is for a settled question only: never for the text being typed — half a word is
 * not a vague question — and only when the bar holds a question. `vague` is the page's route
 * verdict (the stored question too vague to point anywhere); the store still takes every
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

/** `next` is the element that receives focus (null when none does). The box is "focused" while
 *  focus is anywhere inside it; leaving it closes the dropdown. */
export function leftTheBox(box: Node, next: EventTarget | null): boolean {
  return !box.contains(next as Node | null);
}

/**
 * P10 (review 2.7): whether the dropdown is open. It opens under the bar while the field has
 * focus, a character has been typed (P10-21, X-A6: an empty or white-space bar lists nothing) and the
 * question is not settled — the text differs from the last submitted question — and is closed
 * otherwise: after Submit, on blur, after Escape, and with nothing to show.
 */
export function dropdownOpen({
  focused,
  text,
  settled,
  count,
  closed = false,
}: {
  focused: boolean;
  text: string;
  settled: readonly string[];
  count: number;
  closed?: boolean;
}): boolean {
  if (!focused || closed || count <= 0) return false;
  if (text.trim() === "") return false;
  return hasNewQuestions(text, settled);
}

/** Down and Up move the highlight through the `count` items and the bar itself (−1), and wrap. */
export function moveActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return active + 1 >= count ? -1 : active + 1;
  return active <= -1 ? count - 1 : active - 1;
}

/** Enter picks the highlighted item when the dropdown is open and one is highlighted; otherwise it
 *  submits the question. */
export function enterAction(open: boolean, active: number): "pick" | "submit" {
  return open && active >= 0 ? "pick" : "submit";
}

/**
 * P5-02 (blueprint P5): tell the preference ledger what the paper's settled question holds —
 * its specific terms. Replaces the paper's earlier terms; a call that changes nothing changes
 * nothing. Runs when the question settles, never on a keystroke.
 */
export function syncQuestionTerms(paperId: string): void {
  // P10-03 (review 2.3): the Profile's switch "Use my questions to tune recommendations" (absent = on). Off, the
  // ledger learns nothing from the questions submitted — and nothing it already learned is taken out.
  if (useProfileStore.getState().profile.questionsTuneRecommendations === false) return;
  const entry = useReadingQuestionsStore.getState().byPaper[paperId];
  useProfileStore.getState().recordQuestionTerms(paperId, questionTerms(settledQuestions(entry)));
}

/** Settle the paper's question (P2-03), then let the ledger hear of it. */
export function settleQuestions(paperId: string): void {
  useReadingQuestionsStore.getState().settle(paperId);
  syncQuestionTerms(paperId);
}

/** The questions a stored entry last settled; none for a paper that has no entry. */
export function settledOf(entry: PaperQuestions | undefined): readonly string[] {
  return settledQuestions(entry);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((q, i) => q === b[i]);

/**
 * P7-13 (R11c): whether Submit has anything to send — the bar's text, cleaned, is not what was
 * last settled. Spaces at the edges change nothing. A bar cleared of everything that was settled
 * has something to send too: the ledger still holds those words.
 */
export function hasNewQuestions(text: string, settled: readonly string[]): boolean {
  return !sameList(cleanQuestions([text]), settled);
}

/** The page's `q`: focus the question bar. */
export function focusFirstEmptyQuestion(): void {
  // By the mark, not the tag: the bar is a textarea since P7-13.
  document.querySelector<HTMLTextAreaElement>("[data-ask-line]")?.focus();
}

export function QuestionField({
  paperId,
  examples,
  standing,
  vague = false,
}: {
  paperId: string;
  /** P1-09 (§1f.20): the examples, from the reader's earlier questions and profile only. */
  examples: readonly ExampleGroupProp[];
  /** P5-01: the reader's standing questions (the profile's); one more group in the dropdown,
   *  never filled in. */
  standing?: readonly string[];
  /** P1-05 (§1f.6, §1f.13): the question is too vague to route — the page tints nothing and the
   *  field says what would help. */
  vague?: boolean;
}) {
  // Read once, at mount: the page mounts this per paper, after the stores have loaded. A reader
  // with several stored questions (before round P10) sees the first.
  const [initial] = useState(() => {
    const own = useReadingQuestionsStore.getState().byPaper[paperId];
    return { text: own?.items[0] ?? "", gist: own?.gist ?? false, settled: settledOf(own) };
  });
  const [text, setText] = useState(initial.text);
  const [gist, setGist] = useState(initial.gist);
  // P7-13 (R11c): what was last settled, to tell whether Submit has anything to send. It follows
  // the submits this field makes; nothing else settles a paper's question.
  const [settled, setSettled] = useState<readonly string[]>(initial.settled);
  const unsent = hasNewQuestions(text, settled);
  const [focused, setFocused] = useState(false);
  // P1-07 (§1f.18 a): 0 while the bar is being written, which the vague hint waits for.
  const [unsettled, setUnsettled] = useState<number | null>(null);
  const trackLine = (event: SettleEvent) => setUnsettled((current) => settleLine(current, event));
  // The dropdown: the highlighted item (−1: none, the bar itself) and Escape.
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const input = useRef<HTMLTextAreaElement | null>(null);
  // P9-11 (B P9-07): a request to focus the bar belongs to the render that makes it, so it travels
  // as state, a new object for each request, and fires once.
  const [focusBar, setFocusBar] = useState<{ caretAtEnd: boolean } | null>(null);

  useEffect(() => {
    if (!focusBar) return;
    const el = input.current;
    if (!el) return;
    el.focus();
    if (focusBar.caretAtEnd) el.setSelectionRange(el.value.length, el.value.length);
  }, [focusBar]);

  // P7-13 (R11a): the bar grows or shrinks to its text — after each change of it, and when the
  // window is resized (the text wraps differently).
  useEffect(() => {
    fitHeight(input.current);
  }, [text]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refit = () => fitHeight(input.current);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  const standingChips = standingGroup(standing, [text]);
  // P5-04 (N5): a question under one group only.
  // P10-11 (BACKLOG-72): then only the suggestions that contain a typed word; the gist stays, last.
  const groups = filterGroups(withoutStandingRepeats([...(standingChips ? [standingChips] : []), ...chipGroups(examples)], standing), text);
  const items = suggestionItems(groups);
  const open = dropdownOpen({ focused, text, settled, count: items.length, closed });
  const listId = `ask-${paperId}-list`;
  const optionId = (index: number) => `ask-${paperId}-option-${index}`;

  useEffect(() => {
    if (!open || active < 0 || typeof document === "undefined") return;
    document.getElementById(`ask-${paperId}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, paperId]);

  // The reader says the question is done: the Submit control or Enter. It settles on the spot (the
  // deep report is asked about it), the ledger hears of it, and the control knows what was sent.
  // The text submitted again does nothing. The stored list becomes the one question.
  const submit = () => {
    if (!hasNewQuestions(text, settled)) return;
    useReadingQuestionsStore.getState().set(paperId, [text], gist);
    settleQuestions(paperId);
    setSettled(settledOf(useReadingQuestionsStore.getState().byPaper[paperId]));
    setActive(-1);
  };

  const commit = (nextText: string, nextGistValue: boolean) => {
    setText(nextText);
    setGist(nextGistValue);
    useReadingQuestionsStore.getState().set(paperId, [nextText], nextGistValue);
  };

  // Picking fills the bar and focuses it with the caret at the end; like typing, it submits nothing.
  // The gist is a reading mode: it changes no text and settles nothing; picking it again turns it off.
  const pick = (index: number) => {
    const item = items[index];
    if (!item) return;
    setActive(-1);
    setClosed(true);
    if (item.kind === "gist") {
      commit("", !gist);
    } else {
      commit(item.text, nextGist(gist, [item.text]));
    }
    setFocusBar({ caretAtEnd: true });
  };

  return (
    <section
      aria-label={ASK.heading}
      className="mt-6"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Focus moving to another part of the box is not leaving it.
        // Leaving it closes the dropdown and settles nothing (P7-13): the reader presses Submit.
        if (!leftTheBox(event.currentTarget, event.relatedTarget)) return;
        setFocused(false);
        setActive(-1);
        setClosed(false);
      }}
    >
      <label className="eyebrow inline-flex items-center gap-2 text-text-muted" htmlFor={`ask-${paperId}-0`}>
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {ASK.heading}
      </label>
      <div className="relative mt-2">
        {/* P10 (review 2.2, 2.6): a search bar. A 2-px border in the heading ink and the raised
            surface — the strongest edge on the page — one row of at least 48 px at rest, the
            full width of the column, the Submit control inside its right end. */}
        <div
          data-ask-bar=""
          className="flex min-h-12 items-center gap-2 rounded-3xl border-2 border-heading bg-surface py-1 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-heading/25"
        >
          <textarea
            id={`ask-${paperId}-0`}
            ref={(el) => {
              input.current = el;
            }}
            data-ask-line=""
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            aria-describedby={`ask-${paperId}-hint`}
            rows={1}
            value={text}
            maxLength={MAX_QUESTION_CHARS}
            placeholder={gist && text === "" ? ASK.chips.gist : ASK.placeholder}
            onFocus={() => trackLine({ type: "focus", index: 0 })}
            onBlur={() => trackLine({ type: "blur", index: 0 })}
            onChange={(event) => {
              const next = oneLine(event.target.value);
              trackLine({ type: "change", index: 0 });
              setClosed(false);
              setActive(-1);
              commit(next, nextGist(gist, [next]));
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!open) {
                  // Escape closed it: an arrow opens it again. A settled question has nothing to show, and
                  // there the arrows stay the caret's.
                  if (closed && dropdownOpen({ focused, text, settled, count: items.length })) {
                    event.preventDefault();
                    setClosed(false);
                  }
                  return;
                }
                event.preventDefault();
                setActive(moveActive(active, items.length, event.key));
                return;
              }
              if (event.key === "Escape") {
                // The page's own Escape blurs a field the reader is typing in (`components/keyboard.tsx`, on
                // `window`). With the dropdown open, the first Escape is the dropdown's: it closes it and stops there;
                // the next one is the page's.
                if (!open) return;
                event.preventDefault();
                event.stopPropagation?.();
                setClosed(true);
                setActive(-1);
                return;
              }
              if (event.key !== "Enter") return;
              // A composition (CJK input) ends with its own Enter; that one is not a submit.
              if ((event as { nativeEvent?: { isComposing?: boolean } }).nativeEvent?.isComposing) return;
              event.preventDefault();
              trackLine({ type: "enter", index: 0 });
              if (enterAction(open, active) === "pick") pick(active);
              else submit();
            }}
            className="min-w-0 flex-1 resize-none self-center overflow-hidden bg-transparent py-2 font-reading text-body text-text placeholder:text-text-muted focus:outline-none"
          />
          {text.length > COUNTER_FROM && (
            <span className="annotation shrink-0 text-text-faint">{ASK.counter(text.length)}</span>
          )}
          {/* P7-13 (R11c): in the label face; shown with no key too — it settles the ledger. P7-18 (F6): a
              44-px target on touch. P10: inside the bar's right end; grey and inert (§1h.77 (g)) until the
              text is a question not yet submitted. */}
          <button
            type="button"
            onClick={submit}
            disabled={!unsent}
            className="annotation shrink-0 rounded-full bg-heading px-4 py-2 text-bg transition-colors hover:bg-heading/90 disabled:cursor-default disabled:bg-bg-secondary disabled:text-text-faint disabled:hover:bg-bg-secondary [@media(hover:none)]:min-h-11"
          >
            {ASK.submit}
          </button>
        </div>
        <p id={`ask-${paperId}-hint`} className="sr-only">
          {ASK.hint}
        </p>
        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label={ASK.suggestions}
            className="absolute left-0 right-0 top-full z-30 mt-2 flex max-h-80 flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface py-1 shadow-card-hover"
          >
            {/* The examples scroll; the gist stays in view below them, set apart by a rule. */}
            {groups.length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <p aria-hidden className="annotation px-4 pb-1 pt-2 text-text-faint">
                      {group.label}
                    </p>
                    {group.chips.map((chip) => {
                      const index = items.findIndex((item) => item.kind === "example" && item.text === chip.text);
                      return (
                        <div
                          key={chip.label}
                          id={optionId(index)}
                          role="option"
                          aria-selected={active === index}
                          data-suggestion=""
                          tabIndex={-1}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => pick(index)}
                          className={`flex cursor-pointer items-center px-4 py-2 font-reading text-body-sm text-text hover:bg-surface-hover [@media(hover:none)]:min-h-11 ${active === index ? "bg-surface-hover" : ""}`}
                        >
                          {chip.label}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {/* "Just get the gist": the last item, set apart from the questions by a rule (with no question listed, it stands alone). */}
            <div
              role="group"
              aria-label={ASK.chips.gist}
              className={`shrink-0 ${groups.length > 0 ? "mt-1 border-t border-border-strong pt-1" : ""}`}
            >
              <div
                id={optionId(items.length - 1)}
                role="option"
                aria-selected={active === items.length - 1}
                aria-checked={gist}
                data-suggestion=""
                data-gist=""
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(items.length - 1)}
                className={`annotation flex cursor-pointer items-center px-4 py-2 text-text-muted hover:bg-surface-hover hover:text-heading [@media(hover:none)]:min-h-11 ${active === items.length - 1 ? "bg-surface-hover" : ""}`}
              >
                {ASK.chips.gist}
              </div>
            </div>
          </div>
        )}
      </div>
      {vagueHintShown({ vague, lines: [text], unsettled }) && (
        <p role="status" className="annotation mt-2 text-text-muted">
          {ROUTE.vague}
        </p>
      )}
    </section>
  );
}
