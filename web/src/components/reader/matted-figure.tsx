"use client";

// A figure the deep report bound to a result, mounted on the same mat as the
// plate. Contained, never cropped — a scientific figure loses its axis labels
// to a crop — and shown only with an image the binding actually chose.
// S12: click it to fill the screen (FigureLightbox owns the open/close/
// keyboard/focus mechanism; this file just supplies the image and caption).

import { useState } from "react";
import { FigureLightbox } from "./figure-lightbox";

export function MattedFigure({ src, caption }: { src: string; caption?: string | null }) {
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
