// A figure the deep report bound to a result, mounted on the same mat as the
// plate. Contained, never cropped — a scientific figure loses its axis labels
// to a crop — and shown only with an image the binding actually chose.
// S12: click it to fill the screen (FigureLightbox owns the open/close/
// keyboard/focus mechanism; this file just supplies the image and caption).

import { FigureLightbox } from "./figure-lightbox";

export function MattedFigure({ src, caption }: { src: string; caption?: string | null }) {
  return (
    <figure className="cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] bg-[var(--plate-mat)] p-4 mt-4">
      <FigureLightbox
        src={src}
        alt={caption ?? ""}
        caption={caption}
        className="mx-auto max-h-[260px] sm:max-h-[360px] object-contain"
      />
      {caption && (
        <figcaption className="font-reading text-body-sm text-text-muted mt-3">{caption}</figcaption>
      )}
    </figure>
  );
}
