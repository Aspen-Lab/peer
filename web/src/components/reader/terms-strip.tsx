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
// No DOM in this project's Vitest: what the strip shows is tested by rendering
// it, what a click does through `termButtonState`, and Escape through the hook.

import { useCallback, useEffect, useMemo } from "react";
import { Band } from "@/components/ui/band";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { firstOccurrence, type TermOccurrence } from "@/lib/papers/terms";
import { PEERS_READING, TERMS } from "./copy";
import { EvidenceQuote } from "./evidence-quote";
import { paragraphAnchor } from "./paper-body";

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
}: {
  terms: readonly PaperTerm[];
  /** The body the terms are looked up in, and the map their sections are named by. */
  reading: Pick<PaperReading, "body" | "map">;
  /** The term whose first use is highlighted in the body, if any. */
  marked: string | null;
  onMark: (term: string | null) => void;
}) {
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
            <li key={term.term}>
              {hit ? (
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={TERMS.find(term.term)}
                  onClick={() => {
                    const { next, scroll } = termButtonState(marked, term.term);
                    onMark(next);
                    if (scroll) scrollToOccurrence(hit);
                  }}
                  className="font-reading text-body font-medium text-heading underline decoration-border-strong decoration-1 underline-offset-4 transition-colors hover:decoration-heading aria-pressed:bg-[color:var(--color-term-mark)]"
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
    </Band>
  );
}
