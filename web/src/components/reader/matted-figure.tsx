"use client";

// A figure the deep report bound to a result, mounted on the same mat as the
// plate. Contained, never cropped — a scientific figure loses its axis labels
// to a crop — and shown only with an image the binding actually chose.
// S12: click it to fill the screen (FigureLightbox owns the open/close/
// keyboard/focus mechanism; this file just supplies the image and caption).

import { useState } from "react";
import { FigureLightbox } from "./figure-lightbox";

// ── The caption under a figure in a section (P9-59, N10) ─────────────────────────────────────────────
//
// Whole, or cut where a sentence ends, or visibly cut — never a slice that stops inside a clause. The figure
// engine hands the binder a caption it has already sliced (`MAX_FIGURE_TEXT_CHARS`, a hard `.slice(0, 500)`), so
// a long caption arrived as exactly 500 characters stopped wherever the 500th fell: on the keyed Summary's
// Figure 4, on a bare article, with no stop and no mark. The lead plate's caption is protected by `leadCaption`
// (paper-plate.tsx); this is that rule with a room fit for a figure under a section.

/**
 * The room under a figure in a section, in characters: the figure engine's own cap. The view cannot ask the
 * engine for more (raising `MAX_FIGURE_TEXT_CHARS` needs a figure-request `v` bump, BACKLOG-60, and `isSameFigure`
 * compares captions exactly), so it takes the cap as its room: a caption that reaches it may be the engine's
 * slice, and one below it never was. It is also a fair room for a figure under a paragraph of the report — a
 * short paragraph of its own, against the lead's 140 for the one line beside a title.
 */
export const FIGURE_CAPTION_CHARS = 500;

const squeeze = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

// The sentence rules are `leadCaption`'s, word for word: that function's room (140) is not a parameter and the
// file is not this view's to change, so the three pieces below are copied, and `matted-figure.caption.test.tsx`
// holds the two to one rule on the cases that tell them apart (a label, an abbreviation, an initial).

/** Words that end in a stop without ending a sentence. */
const ABBREVIATION = /^(?:fig|figs|eq|eqs|ref|refs|sec|secs|tab|no|nos|vs|cf|al|approx|ca|dr|mr|mrs|ms|prof|st|vol|pp|resp|e\.g|i\.e)$/i;
/** The word in front of a figure's number: "Figure 4", "Fig. 2", "Table 1". */
const LABEL_WORD = /^(?:fig|figs|figure|figures|table|tab|panel|plate|scheme|eq|eqs|equation|sec|section|ref)$/i;

/** Where the sentences of `text` end: the index just after each real stop (and the quotes or brackets closing on it). */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  const stop = /[.!?]["'”’)\]]*(?=\s+[A-Z0-9"“'‘(\[])/g;
  for (let hit = stop.exec(text); hit; hit = stop.exec(text)) {
    const words = text.slice(0, hit.index).split(" ");
    const word = words[words.length - 1] ?? "";
    const before = (words[words.length - 2] ?? "").replace(/[.:]+$/, "");
    if (ABBREVIATION.test(word)) continue; // "Fig.", "et al.", "e.g.", "vs."
    if (/^[A-Z]$/.test(word)) continue; // an initial: "J. R. Okafor"
    if (/^\d+[a-z]?$/.test(word) && LABEL_WORD.test(before)) continue; // the label: "Figure 4."
    ends.push(hit.index + hit[0].length);
  }
  return ends;
}

/** Does the text end on a real stop, or on the mark of a cut already made? (A stop on "Fig." or "Figure 4." is not one.) */
const endsOnStop = (text: string): boolean => text.endsWith("…") || sentenceEnds(`${text} A`).includes(text.length);

/**
 * The caption a figure in a section prints, in its picture's alt and in its lightbox, or null for none.
 *
 *  - A caption with nothing in it is none.
 *  - A caption that fits the room (`FIGURE_CAPTION_CHARS`) and ends on a stop is printed as it is, white space made
 *    single. So is one that fits and ends on no stop but is shorter than the engine's cut: it was never sliced, it
 *    ends where its author ended it ("Figure 2: Overview of the sampling design").
 *  - A caption the engine may have sliced (as long as its cut, ending on no stop) or one longer than the room is
 *    cut where a sentence ends — the longest run of whole sentences that fits — and not otherwise marked: the stop
 *    is the end. A leading "Figure 4." is a label, not a sentence.
 *  - If there is no such sentence it is cut at a word, with one "…" and no stop or comma in front of it.
 */
export function figureCaption(caption: string | null | undefined): string | null {
  const text = squeeze(caption);
  if (!text) return null;
  const mayBeSliced = (caption ?? "").length >= FIGURE_CAPTION_CHARS;
  if (text.length <= FIGURE_CAPTION_CHARS && (!mayBeSliced || endsOnStop(text))) return text;
  let whole = 0;
  for (const end of sentenceEnds(text)) {
    if (end > FIGURE_CAPTION_CHARS) break;
    whole = end;
  }
  if (whole > 0) return text.slice(0, whole);
  // One place of the room is the mark's. The character after the kept ones decides whether they end on a word's
  // end or inside a word (a text shorter than that ends on one: the engine's slice may end on the space after it).
  const room = FIGURE_CAPTION_CHARS - 1;
  const head = text.slice(0, room);
  const at = text.length <= room || /\s/.test(text[room] ?? "") ? head.length : head.lastIndexOf(" ");
  const cut = at > FIGURE_CAPTION_CHARS / 2 ? head.slice(0, at) : head;
  return `${cut.replace(/[\s,;:.!?\-–—(\[]+$/, "")}…`;
}

export function MattedFigure({ src, caption: handed }: { src: string; caption?: string | null }) {
  // P9-59 (N10): one line for the caption under the picture, the picture's alt and the lightbox.
  const caption = figureCaption(handed);
  // P9-57: the picture is an owner-only route (`…/figure-image?page=N&fig=K`) that answers 404 when the
  // owner's cookie is gone or the route fails. Keyed on the URL, as the lead plate's failure is, so a new
  // picture for the same place is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    // The Reading's own figure (paper-body.tsx) stands the same way: the picture and its mat go, the caption
    // stays once — no alt to repeat it, no broken-image glyph — so the reader knows what they are not seeing.
    // With no caption there is nothing to say: no figure, and no margin.
    return caption ? (
      <figure className="mt-4">
        <figcaption className="font-reading text-body-sm text-text-muted">{caption}</figcaption>
      </figure>
    ) : null;
  }
  return (
    <figure className="cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] bg-[var(--plate-mat)] p-4 mt-4">
      <FigureLightbox
        src={src}
        alt={caption ?? ""}
        caption={caption}
        onError={() => setFailedSrc(src)}
        className="mx-auto max-h-[260px] sm:max-h-[360px] object-contain"
      />
      {caption && (
        <figcaption className="font-reading text-body-sm text-text-muted mt-3">{caption}</figcaption>
      )}
    </figure>
  );
}
