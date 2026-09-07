// A figure the deep report bound to a result, mounted on the same mat as the
// plate. Contained, never cropped — a scientific figure loses its axis labels
// to a crop — and shown only with an image the binding actually chose.

export function MattedFigure({ src, caption }: { src: string; caption?: string | null }) {
  return (
    <figure className="rounded-2xl bg-[var(--plate-mat)] p-4 mt-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={caption ?? ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="mx-auto max-h-[260px] sm:max-h-[360px] object-contain"
      />
      {caption && (
        <figcaption className="font-sans text-meta text-text-muted mt-3">{caption}</figcaption>
      )}
    </figure>
  );
}
