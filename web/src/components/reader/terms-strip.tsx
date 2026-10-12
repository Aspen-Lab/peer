"use client";

// "Terms to know" (P3-01; ruling §1h.1; blueprint §3.5 ⑤ 词): under the map,
// the words the paper defines for itself — and, once the deep report is there,
// the ones the model judged the answers need — one line each.
//
// Whose words are whose (§1f.17): a term the paper defines shows the paper's
// own sentence through `EvidenceQuote`, quoted, attributed, linked to its
// section, with its page; a term only Peer defined shows Peer's one line in the
// reading face, labelled `PEERS_READING`, never quote-styled. The term itself
// is a word of the paper's, set in the reading face.
//
// A term is also a way into the paper: clicking it scrolls to where the paper
// first uses it and marks those words in the body (`paper-body.tsx`), cleared
// by the next click on a term or by Escape. A term the body never uses is
// plain text — there is nothing to point at. No link leaves the page: the
// rabbit hole is closed by the blueprint ("明确不做：外链、二级术语、维基式长解释").
//
// P9-04 (X3), P9-21: wherever the reader panel stands in one column with the body — below the spread's
// two-column breakpoint, `xl` (`spread.ts`), the phone and the widths up to 1279 alike — the strip folds to its
// first two terms with a "show all N terms" toggle, in the map's style (`hidden xl:block` / `xl:hidden`; all the
// terms stay in the DOM, so the server and the client draw the same markup). From `xl`, where the panel stands
// beside the column, all the terms show and there is no toggle. The breakpoint is the spread's own, not a second one.
//
// No DOM in this project's Vitest: what the strip shows is tested by rendering
// it, what a click does through `termButtonState`, and Escape through the hook.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Band } from "@/components/ui/band";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { firstOccurrence, type TermOccurrence } from "@/lib/papers/terms";
import { PEERS_READING, TERMS } from "./copy";
import { EvidenceQuote } from "./evidence-quote";
import { paragraphAnchor } from "./paper-body";

/**
 * P9-52 (A P9-W3's N5): where there is no hover a term button is a 44 px target (it was 22.5 px, a line of the reading
 * face), as the reading page's other small controls are (P9-23, `min-h-11`). The 11 px of padding a side is what makes
 * the box 44 (the words stay centred in it), and `bg-clip-content` keeps the marked term's highlight to the word's own
 * line, the 22.5 px it was — the box around it is the hit area, not a taller colour. A mouse's button is as it was.
 */
const TERM_TOUCH = "[@media(hover:none)]:min-h-11 [@media(hover:none)]:py-[11px] [@media(hover:none)]:bg-clip-content";

/** P9-04 (X3), P9-21: the terms a one-column page is shown while the strip is folded — the first two. */
export const ONE_COLUMN_TERMS = 2;

/**
 * Is the term at `index` of `total` folded away below the spread (`xl`)? Only one past the first two, only
 * while the strip is folded, and only when there is a toggle to open it (more than two terms): with two or
 * fewer there is nothing to fold, and nothing hidden without a way back.
 */
export function hiddenInOneColumn(index: number, total: number, open: boolean): boolean {
  return total > ONE_COLUMN_TERMS && !open && index >= ONE_COLUMN_TERMS;
}

/** A click on `clicked` while `marked` is highlighted: the next highlight, and
 *  whether to scroll there. The marked term clicked again clears it. */
export function termButtonState(marked: string | null, clicked: string): { next: string | null; scroll: boolean } {
  return marked === clicked ? { next: null, scroll: false } : { next: clicked, scroll: true };
}

/**
 * While a term is highlighted, Escape clears it — before the page's own keys,
 * which read Escape as "back to the briefing" — and the key goes no further;
 * with nothing highlighted the listener is not there and Escape is the page's.
 */
export function useEscapeToClear(active: boolean, onClear: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClear();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, onClear]);
}

/**
 * P7-14 (R10): go to the term's first use in the body. The body is under "Paper digestion"; from
 * "Summary" the page's `reveal` brings it in first and runs the scroll once it is mounted. Without
 * a `reveal` (the strip outside the tabbed page) the body is where it was and the scroll is now.
 */
export function findInBody(
  hit: TermOccurrence,
  reveal: ((run: () => void) => void) | undefined,
  scroll: (hit: TermOccurrence) => void = scrollToOccurrence,
): void {
  if (reveal) reveal(() => scroll(hit));
  else scroll(hit);
}

function scrollToOccurrence(hit: TermOccurrence): void {
  const target = document.getElementById(paragraphAnchor(hit.sectionIndex, hit.paragraphIndex));
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
}

export function TermsStrip({
  terms,
  reading,
  marked,
  onMark,
  reveal,
  oneColumnOpen = false,
}: {
  terms: readonly PaperTerm[];
  /** The body the terms are looked up in, and the map their sections are named by. */
  reading: Pick<PaperReading, "body" | "map">;
  /** The term whose first use is highlighted in the body, if any. */
  marked: string | null;
  onMark: (term: string | null) => void;
  /** P7-14 (R10): the page's way to put the paper's own text on screen first — the strip is
   *  shown under both tabs, the body only under "Paper digestion". */
  reveal?: (run: () => void) => void;
  /** P9-04 (X3), P9-21: whether a one-column page starts with every term shown. Folded by default; for the tests, as the map's. */
  oneColumnOpen?: boolean;
}) {
  const [shownInOneColumn, setShownInOneColumn] = useState(oneColumnOpen);
  const body = reading.body;
  const sections = useMemo(() => new Map((reading.map?.sections ?? []).map((section) => [section.id, section])), [reading.map]);
  const hits = useMemo(() => terms.map((term) => firstOccurrence(body ?? [], term.term)), [terms, body]);
  const clear = useCallback(() => onMark(null), [onMark]);
  useEscapeToClear(marked !== null, clear);

  if (terms.length === 0) return null;

  return (
    <Band label={TERMS.heading} gap="none" className="mt-8">
      <ul className="mt-3 space-y-3">
        {terms.map((term, index) => {
          const hit = hits[index];
          const pressed = marked === term.term;
          // The paper's own sentence, quoted and attributed. A verified term
          // whose heading did not travel takes it from the map by section id,
          // as the answers do.
          const section = term.sectionId ? sections.get(term.sectionId) : undefined;
          return (
            <li key={term.term} className={hiddenInOneColumn(index, terms.length, shownInOneColumn) ? "hidden xl:block" : undefined}>
              {hit ? (
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={TERMS.find(term.term)}
                  onClick={() => {
                    const { next, scroll } = termButtonState(marked, term.term);
                    onMark(next);
                    if (scroll) findInBody(hit, reveal);
                  }}
                  className={`font-reading text-body font-medium text-heading underline decoration-border-strong decoration-1 underline-offset-4 transition-colors hover:decoration-heading aria-pressed:bg-[color:var(--color-term-mark)] ${TERM_TOUCH}`}
                >
                  {term.term}
                </button>
              ) : (
                <span className="font-reading text-body font-medium text-heading">{term.term}</span>
              )}
              {term.evidence ? (
                <EvidenceQuote
                  text={term.evidence}
                  where={term.evidenceWhere ?? section?.heading ?? "abstract"}
                  page={term.page ?? section?.page}
                />
              ) : (
                <p className="font-reading text-body-sm leading-[1.55] text-text-muted pl-5 mt-2 reading-justify">
                  {term.definition}
                  <span className="annotation ml-2 text-text-faint">{PEERS_READING}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {/* Below the spread (xl) only: in one column the strip is the first two terms and this opens the rest. Where there
          is no hover (P9-52) it is a 44 px target, its 12 px of margin given up: the words sit 14 px down the box. */}
      {terms.length > ONE_COLUMN_TERMS && (
        <button
          type="button"
          aria-expanded={shownInOneColumn}
          onClick={() => setShownInOneColumn((shown) => !shown)}
          className="annotation mt-3 block text-text-faint underline-offset-2 transition-colors hover:text-heading hover:underline xl:hidden [@media(hover:none)]:mt-0 [@media(hover:none)]:min-h-11"
        >
          {shownInOneColumn ? TERMS.fewer : TERMS.showAll(terms.length)}
        </button>
      )}
    </Band>
  );
}
