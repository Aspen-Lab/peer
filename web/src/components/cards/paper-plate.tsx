"use client";

// The plate — the one visual element a paper carries on every surface. The
// feed card renders it at the top edge; the reading page renders the same
// component above the title, so the object the reader swipes on `/papers/[id]`
// is the object they saw in the briefing.

import { useState } from "react";
import type { Paper } from "@/types";
import { useResolvedFigure, type FigureState } from "@/components/paper-figure";
import { FigureLightbox } from "@/components/reader/figure-lightbox";

/**
 * Card venue label. OpenAlex returns the repository plus its host institution —
 * "Zenodo (CERN European Organization for Nuclear Research)", "HAL (Le Centre
 * pour la Communication Scientifique Directe)". At card width the parenthetical
 * ate the whole line and truncated mid-word, pushing the published date off the
 * end. The name before the bracket is the part that identifies the venue.
 */
export function shortVenue(venue: string | null | undefined): string | null {
  const raw = venue?.trim();
  if (!raw) return null;
  const withoutHost = raw.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return withoutHost.length > 0 ? withoutHost : raw;
}

/**
 * The paper's own figure, lazily resolved per card after the feed paints.
 *
 * Peer has had a rule-based figure extractor (`lib/figures/`) and a route built
 * for exactly this — `/api/figure`'s own header reads "hit per-card after feed
 * loads" — and no card had ever called it. The feed rendered ten identical
 * blocks of text. Nothing here needs a model key, so figures appear on a
 * deployment with no credentials configured.
 *
 * Renders nothing at all until an image resolves, so a paper without figures
 * keeps the plain card rather than showing a grey placeholder.
 */
// Colours are the plate's own ink, relative to the mat — not the card's text
// colours. On dark the mat is off-white, and the card's near-white heading
// colour would vanish on it.
export const PLATE_TERM_CLASS = [
  "text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]",
  "text-[clamp(17px,5.8cqw,23px)] italic text-[var(--plate-ink-muted)]",
  "text-[clamp(14px,4.6cqw,18px)] text-[var(--plate-ink-faint)]",
];

/**
 * A figure the caller already holds — the deep report's bound
 * `whatItProposes.figureImageUrl` + `figureCaption`. It replaces whatever the
 * resolver found; the resolver still runs, because its `/api/figure` entry is
 * the one the card primed and the page shares.
 */
export interface PlateFigure {
  imageUrl: string;
  caption?: string | null;
}

/**
 * P9-49 (N6): is the lead picture's figure still on its way — the figure route has not answered
 * (`idle`), the report has bound nothing, no picture is in hand?
 *
 * The reading page asks it twice, of the same state: here, to hold the figure's own box until the
 * picture lands (or the route says there is none), and in `papers/[id]/page.tsx`, to keep the plate's
 * slot (and the card shell that frames it) in the layout while it is held. Without a key the plate used
 * to be drawn only when `POST /api/figure` returned (4-5 s on an upload), and the title and the decision
 * block moved 96 px (1440) / 120 px (390) down under a reader about to press "Read it here".
 *
 * Once the route has answered — with a picture, or with none — this is false; a picture that never comes
 * takes its held box away in one step (to the terms plate when the paper has terms, to nothing when it
 * has none).
 */
export function leadFigurePending(
  figure: Pick<FigureState, "status" | "imageUrl">,
  bound?: PlateFigure | null,
): boolean {
  return figure.status === "idle" && !figure.imageUrl && !bound?.imageUrl;
}

/** The figure's own box: the mat, 16:9, with the plate's own crop marks. A picture stands in it, and so does the held slot. */
const FIGURE_BOX =
  "tile-cover cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] overflow-hidden aspect-[16/9] @container";

/**
 * P9-49 (X3): below the spread the plate is as wide as the column (up to 712 px) and 16:9, so 337 to 400
 * px tall at 768-1024 — a screen a reader with two settled questions scrolls before the body. On the lead
 * picture it is capped at 240 px: the box keeps the column's width (`w-full`: left to itself, a browser
 * that carries the cap through the 16:9 ratio would narrow the mat and leave the caption wider than its
 * plate) and loses the height — a wide mat — and the picture stands in it `object-contain`: a landscape
 * figure is drawn at the cap's height, a tall one (a 9:16 profile) at the cap's height too and narrower,
 * centred; nothing is cropped. From the spread (`xl`) the panel is 320/360 px wide, the plate 180/202 px
 * tall, and nothing changes.
 */
const LEAD_CAP = "max-xl:max-h-[240px] max-xl:w-full";

// ── The lead picture's caption (P9-49, N8) ──────────────────────────────────────────────────────────
//
// A sentence or nothing. The head cut every caption to 140 characters with an ellipsis written after the
// cut, so a caption whose cut fell on a full stop read "…films.…", and — under the spread's two-line clamp —
// a no-key page showed the paper's page-1 graphic with the abstract's own block ("ABSTRACT: …") for a
// caption, stopped mid-sentence. The figure engine pairs a graphic with the nearest block of text when no
// "Figure N" is near it (`pdf-engine.ts`, `bestCaptionForRegion`), and on a page 1 that block is often the
// abstract. It is not the picture's caption, and the plate then has none (the feed's tile has none either;
// its title is the line under it).

/** The room under the plate, in characters: the head's `CAPTION_CHARS`. */
export const LEAD_CAPTION_CHARS = 140;

const squeeze = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Is this block the paper's abstract, not a caption? It opens with the word "Abstract" in any case
 * ("ABSTRACT: …", "Abstract. …", "abstract — …"), or it is the reading's abstract itself (`abstract`, when
 * the caller has it): its first 80 characters stand in the abstract's text.
 */
export function isAbstractBlock(caption: string | null | undefined, abstract?: string | null): boolean {
  const text = squeeze(caption);
  if (!text) return false;
  if (/^abstract\b/i.test(text)) return true;
  const own = squeeze(abstract).toLowerCase();
  const probe = text.toLowerCase().slice(0, 80);
  return own.length >= 40 && probe.length >= 40 && own.includes(probe);
}

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

/**
 * The caption the reading page sets under its lead picture: whole, or absent.
 *
 *  - An abstract block (`isAbstractBlock`) is never a caption: null.
 *  - A caption that fits the room is returned as it is, white space made single.
 *  - A longer one is cut where a sentence ends — the longest run of whole sentences that fits — and not
 *    otherwise marked: the stop is the end. A leading "Figure 4." is a label, not a sentence.
 *  - If one sentence is longer than the room it is cut at a word, with one ellipsis and no stop or comma
 *    in front of it (never "films.…").
 */
export function leadCaption(caption: string | null | undefined, abstract?: string | null): string | null {
  const text = squeeze(caption);
  if (!text || isAbstractBlock(text, abstract)) return null;
  if (text.length <= LEAD_CAPTION_CHARS) return text;
  let whole = 0;
  for (const end of sentenceEnds(text)) {
    if (end > LEAD_CAPTION_CHARS) break;
    whole = end;
  }
  if (whole > 0) return text.slice(0, whole);
  const room = text.slice(0, LEAD_CAPTION_CHARS - 1);
  // The next character decides whether the room ends on a word's end or inside a word.
  const at = /\s/.test(text[LEAD_CAPTION_CHARS - 1] ?? "") ? room.length : room.lastIndexOf(" ");
  const cut = at > LEAD_CAPTION_CHARS / 2 ? room.slice(0, at) : room;
  return `${cut.replace(/[\s,;:.!?\-–—(\[]+$/, "")}…`;
}

/**
 * The plate — the card's visual element, present on every card at the same
 * offset and the same 16:9 ratio.
 *
 * When the extractor finds the paper's own figure, the figure fills it, matted
 * rather than bled: `object-contain` on a mat, because cropping a scientific
 * figure destroys its axis labels. When it does not, the window holds the
 * paper's own terms set in the display serif — a composition, not a picture, so
 * the card gains a visual without gaining ornament, and nothing on it is
 * invented. `terms` is allocated across the whole briefing by
 * `allocatePlateTerms` so the field's two failure modes (the reader's own query
 * echoed on all ten cards; the same concept headlining half of them) cannot
 * reach the page.
 */
export function PaperPlate({
  paper,
  terms = [],
  figure: bound,
  imageAlt,
  className,
  lightbox = false,
  lead = false,
  abstract,
}: {
  paper: Paper;
  terms?: string[];
  figure?: PlateFigure | null;
  /**
   * The image's alt when the caller shows the caption elsewhere (the page's
   * `<figcaption>`), so it is read once. Absent, the caption is the alt.
   */
  imageAlt?: string;
  className?: string;
  /**
   * S12, Ruling 15: the reading page's own hero opts into the figure
   * lightbox; the briefing feed's tiles (`feed-tile.tsx`) do not pass this
   * and keep their existing click-to-open-paper behaviour untouched. Default
   * off so every other caller is unaffected by construction.
   */
  lightbox?: boolean;
  /**
   * P9-49 (N6): the reading page's lead picture. While its figure is still being looked for it holds the
   * figure's own box — the mat the picture will stand in — so nothing below it moves when the picture
   * lands. The briefing feed's tiles (`feed-tile.tsx`) do not pass this and are drawn exactly as before.
   */
  lead?: boolean;
  /**
   * P9-49 (N8): the reading's abstract, for the lead picture only. A block of the figure engine's that is the
   * abstract is not the picture's caption — not under it, not in its alt, not in the lightbox.
   */
  abstract?: string | null;
}) {
  // The same args as the card, so the page and the card read one cache entry.
  const resolved = useResolvedFigure({
    itemId: paper.id,
    url: paper.linkPaper ?? paper.linkArxiv,
    doi: paper.doi,
    paperTitle: paper.title,
  });
  // Keyed on the URL rather than a boolean + effect, so a new figure resolving
  // for the same card clears the failure by itself. Finding a figure URL is not
  // the same as being able to show it — biorxiv answers 401 for every one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = bound?.imageUrl ?? resolved.imageUrl;
  const rawCaption = bound ? (bound.caption ?? null) : resolved.caption;
  // P9-49 (N8): on the lead picture an abstract block is no caption (the feed's tiles are unchanged).
  const caption = lead && isAbstractBlock(rawCaption, abstract) ? null : rawCaption;
  // `hideFigure` is the resolver's verdict on its own candidate; a bound figure
  // was chosen by the report, so the verdict does not apply to it.
  const showFigure =
    Boolean(src) && (bound ? true : !resolved.hideFigure) && failedSrc !== src;

  // Nothing to show and nothing to set: no plate. A window is worth its space
  // only when something is in it, and a paper with neither a figure nor a term
  // of its own is a quieter paper — its card should be quieter too, opening on
  // its own title, rather than carrying an empty window the height of a
  // picture. (`src` and not `showFigure`: an image that was found and then
  // failed to load still keeps the window, because the callers laid out for
  // one and cannot see the failure.)
  // P9-49 (N6): the lead picture's slot is held while its figure is on the way, with terms or without.
  const pending = lead && leadFigurePending(resolved, bound);
  if (!src && terms.length === 0 && !pending) return null;

  // Plain concatenation, not `cn`: the card passes no class, and its markup
  // must stay byte-for-byte what it was.
  // 16:9 is a picture's shape, and only the picture needs it. A title block
  // sized by a photograph left two thirds of itself empty above the type; set
  // to its own proportion it reads as composed rather than as unfilled.
  // `cropmarks` on the FIGURE branch only, in the plate's own ink: a figure is
  // a reproduction, and a crop mark is what registers one. On the mat the
  // card's own marks would vanish, which is the other half of the
  // `:has(> .tile-cover[data-plate="figure"])` rule in globals.css.
  //
  // Not on the terms branch. A crop mark says "cropped from a larger original".
  // These words are Peer's own composition, allocated across the briefing by
  // `allocatePlateTerms`; nothing was cropped, and a mark that appears on both
  // branches marks neither.
  const base =
    showFigure || pending
      ? lead
        ? `${FIGURE_BOX} ${LEAD_CAP}`
        : FIGURE_BOX
      : "tile-cover grain overflow-hidden aspect-[2.4/1] @container";

  // The held slot: the box and nothing in it — no picture, no caption, no word of the paper's own
  // ("nothing on it is invented"). Class for class the box the picture stands in, so its landing adds
  // no height; the picture fades in over the same mat.
  if (pending) {
    return (
      <div
        data-plate="figure"
        data-plate-pending=""
        aria-hidden
        className={className ? `${base} ${className}` : base}
      />
    );
  }

  // A mat exists to hold a picture. With a figure the plate is a mat — light,
  // because scientific figures are drawn on white and matting is what keeps a
  // chart's axis labels from being cropped away. With no figure there is
  // nothing to mat, and the mat became the brightest object on the page
  // holding two words: a placeholder, not a composition. Set on the card's own
  // surface instead, the same words read as a title block. `data-plate` also
  // hands the ink over: on a mat the type is dark-on-light whatever the theme,
  // on the card it is the card's own ink (globals.css).
  return (
    <div
      data-plate={showFigure ? "figure" : "terms"}
      className={className ? `${base} ${className}` : base}
    >
      {showFigure ? (
        lightbox ? (
          // S12, Ruling 15: the reading page's own hero, opted in. Same
          // image classes, same cached-image/load/error handling as the
          // plain branch below, composed through FigureLightbox's
          // passthrough props rather than duplicated.
          <FigureLightbox
            src={src as string}
            alt={imageAlt ?? caption ?? ""}
            caption={caption}
            wrapperClassName="h-full w-full"
            imgRef={(node) => {
              if (node?.complete && node.naturalWidth > 0) {
                node.classList.remove("opacity-0");
              }
            }}
            onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
            onError={() => setFailedSrc(src)}
            className="h-full w-full object-contain opacity-0 transition-opacity duration-[320ms] ease-snap"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src as string}
            alt={imageAlt ?? caption ?? ""}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            // A cached image fires `load` before React attaches a handler, so
            // the ref checks `complete` too.
            ref={(node) => {
              if (node?.complete && node.naturalWidth > 0) {
                node.classList.remove("opacity-0");
              }
            }}
            onLoad={(event) => event.currentTarget.classList.remove("opacity-0")}
            onError={() => setFailedSrc(src)}
            className="h-full w-full object-contain opacity-0 transition-opacity duration-[var(--dur-base)] ease-expo"
          />
        )
      ) : (
        <div className="flex h-full w-full flex-col justify-end px-[7%] pb-[7%] pt-3">
          {terms.length > 0 ? (
            <>
              <div className="flex gap-[5%]">
                {/* Numbering says "these are several, in an order". With one
                    term there is no order to state, and "01" beside a lone
                    word is decoration wearing a structure's clothes. */}
                {terms.length > 1 && (
                  <div className="flex flex-col gap-[0.28em] pt-[0.34em] font-mono text-micro tabular-nums tracking-[0.1em] text-[var(--plate-ink-faint)]">
                    {terms.map((term, index) => (
                      <span key={term} className="leading-[1.5]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                )}
                <div className="min-w-0 flex flex-col gap-[0.1em]">
                  {terms.map((term, index) => (
                    <span
                      key={term}
                      className={`paper-line leading-[1.06] truncate ${PLATE_TERM_CLASS[index]}`}
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
              <span
                aria-hidden
                className={`mt-[0.7em] h-px w-[34%] bg-[var(--plate-ink-faint)] ${
                  terms.length > 1 ? "ml-[calc(5%+2.1em)]" : ""
                }`}
              />
            </>
          ) : (
            // Nothing to set. The old last resort was the venue and the year
            // in display italic — "Zenodo / 2026", "arXiv / 2026", "Journal of
            // Artificial Intellig…" — which is the meta row directly below the
            // plate, repeated at three times the size, and truncated when it
            // did not fit. Display type is the loudest thing on the card; it
            // must not be the only line the reader has already read, and it
            // must never break mid-word. A paper with neither a figure nor a
            // term of its own has nothing to show, and the honest composition
            // for that is the empty window with its rule — less card, not a
            // headline made out of the filing label.
            <span aria-hidden className="h-px w-[34%] bg-[var(--plate-ink-faint)]" />
          )}
        </div>
      )}
    </div>
  );
}
