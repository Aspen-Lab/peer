"use client";

import { useRef, type Ref, type SyntheticEvent } from "react";
import { cn } from "@/lib/cn";
import { openFigure, useFigureOpen } from "@/lib/reader/figure-viewer";
import { keepPicture } from "./figure-card";

function setImageRef(ref: Ref<HTMLImageElement> | undefined, node: HTMLImageElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/** Summary, inline and lead images use the same viewer as body figures. An
 * image-only reference is honest: no binding or quotation is manufactured. */
export function MarginFigure({ src, alt, caption, className, wrapperClassName, imgRef, onLoad, onError }: {
  src: string;
  alt: string;
  caption?: string | null;
  className?: string;
  wrapperClassName?: string;
  imgRef?: Ref<HTMLImageElement>;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: () => void;
}) {
  const image = useRef<HTMLImageElement | null>(null);
  const key = `image:${src}`;
  const expanded = useFigureOpen(key);
  return <button type="button" aria-label="Enlarge figure" aria-expanded={expanded} className={cn("cursor-zoom-in block", wrapperClassName)} onClick={() => {
    const img = image.current;
    const loaded = img !== null && img.naturalWidth > 0 && img.naturalHeight > 0;
    if (img && loaded) keepPicture(src, img);
    const box = img?.getBoundingClientRect();
    openFigure({ key, src, label: "Figure", caption: caption ?? "", natural: loaded ? { width: img.naturalWidth, height: img.naturalHeight } : null, origin: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null });
  }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={(node) => { image.current = node; setImageRef(imgRef, node); }} src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={onLoad} onError={onError} className={className} />
  </button>;
}
