"use client";

// The plate — the one visual element a paper carries on every surface. The
// feed card renders it at the top edge; the reading page renders the same
// component above the title, so the object the reader swipes on `/papers/[id]`
// is the object they saw in the briefing.

import { useState } from "react";
import type { Paper } from "@/types";
import { sourceLabel } from "@/lib/papers/plate-terms";
import { useResolvedFigure } from "@/components/paper-figure";

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
  const caption = bound ? (bound.caption ?? null) : resolved.caption;
  // `hideFigure` is the resolver's verdict on its own candidate; a bound figure
  // was chosen by the report, so the verdict does not apply to it.
  const showFigure =
    Boolean(src) && (bound ? true : !resolved.hideFigure) && failedSrc !== src;

  const year = paper.publishedDate?.slice(0, 4);
  const fallbackVenue = shortVenue(paper.venue) ?? sourceLabel(paper.id);

  // Plain concatenation, not `cn`: the card passes no class, and its markup
  // must stay byte-for-byte what it was.
  const base = "tile-cover overflow-hidden aspect-[16/9] @container";

  return (
    <div className={className ? `${base} ${className}` : base}>
      {showFigure ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
            className="h-full w-full object-contain opacity-0 transition-opacity duration-[320ms] ease-snap"
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col justify-center px-[7%] py-3">
          {terms.length > 0 ? (
            <>
              <div className="flex gap-[5%]">
                <div className="flex flex-col gap-[0.28em] pt-[0.34em] font-mono text-micro tabular-nums tracking-[0.1em] text-[var(--plate-ink-faint)]">
                  {terms.map((term, index) => (
                    <span key={term} className="leading-[1.5]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <div className="min-w-0 flex flex-col gap-[0.1em]">
                  {terms.map((term, index) => (
                    <span
                      key={term}
                      className={`font-display leading-[1.06] tracking-[-0.02em] truncate ${PLATE_TERM_CLASS[index]}`}
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
              <span
                aria-hidden
                className="mt-[0.7em] ml-[calc(5%+2.1em)] h-px w-[34%] bg-[var(--plate-ink-faint)]"
              />
            </>
          ) : (
            // Nothing usable to set. The venue is always available — every id
            // carries a "<source>:" prefix — so the plate is never empty.
            <div className="flex flex-col gap-[0.15em]">
              <span className="font-display italic leading-[1.06] tracking-[-0.02em] truncate text-[clamp(21px,7.6cqw,30px)] text-[var(--plate-ink)]">
                {fallbackVenue}
              </span>
              {year && (
                <span className="font-mono tabular-nums tracking-[0.2em] text-[clamp(14px,4.6cqw,18px)] text-[var(--plate-ink-faint)]">
                  {year}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
