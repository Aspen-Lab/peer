#!/usr/bin/env python
"""Extract likely figure regions from a legal PDF.

This helper adapts the PDF-first retrieval idea from DeerFlow's MIT-licensed
file conversion utilities, but focuses on figure-region extraction for Peer.
See docs/THIRD_PARTY_NOTICES.md for attribution details.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from dataclasses import dataclass

# PyMuPDF 1.24+ is imported as `pymupdf`; the `fitz` name still works but
# prints a deprecation line to STDOUT on import, which corrupted the JSON the
# Node side parses (measured 2026-09-13: every PDF figure failed with
# "Unexpected token 'w', \"warning: T\"..."). Older installs only know `fitz`.
try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

CAPTION_RE = re.compile(r"^\s*(fig(?:ure)?\.?\s*\d+[a-z]?)\b", re.IGNORECASE)
MIN_WIDTH = 120
MIN_HEIGHT = 120
MIN_AREA = 20_000
CLIP_PADDING = 10
MAX_CAPTION_DISTANCE_BELOW = 220
MAX_CAPTION_DISTANCE_ABOVE = 110
MAX_FIGURE_TEXT_CHARS = 500
# Higher pixel ceiling — keeps figure resolution high on modern screens.
MAX_PIXELS = 4_500_000
# Default render scale. PyMuPDF's base resolution is 72 DPI; scale=2.8 gives
# ~200 DPI, which is visibly sharp on retina displays without ballooning size.
DEFAULT_SCALE = 2.8
MIN_SCALE = 1.6
# A raster the page prints at other proportions than its own pixels is a
# figure the author stretched in their word processor — circles drawn as
# ovals, lettering widened. The clip reproduces the page, so it reproduced the
# stretch. Past this tolerance the render is un-stretched back to the image's
# own shape; inside it, the difference is rounding in the layout, not intent.
STRETCH_TOLERANCE = 1.06
# Outside this band the "stretch" is not a figure squeezed to fit a column —
# it is a strip, a rule or a tiled background, and correcting it would only
# distort the clip around it.
MAX_STRETCH_CORRECTION = 4.0


@dataclass
class TextBlock:
    rect: fitz.Rect
    text: str


@dataclass
class RegionCandidate:
    page_index: int
    rect: fitz.Rect
    kind: str
    caption: str | None
    explicit_caption: bool
    # Printed width-to-height over the image's own; 1.0 = drawn as it is.
    stretch: float = 1.0


@dataclass
class PlacedImage:
    rect: fitz.Rect
    pixels: int
    stretch: float


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def area(rect: fitz.Rect) -> float:
    return max(0.0, rect.width) * max(0.0, rect.height)


def overlap_ratio(a: fitz.Rect, b: fitz.Rect) -> float:
    inter = a & b
    inter_area = area(inter)
    if inter_area <= 0:
        return 0.0
    smaller = min(area(a), area(b))
    if smaller <= 0:
        return 0.0
    return inter_area / smaller


def collect_text_blocks(page: fitz.Page) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    for x0, y0, x1, y1, text, _block_no, block_type in page.get_text("blocks"):
        if block_type != 0:
            continue
        normalized = normalize_text(text)
        if not normalized:
            continue
        blocks.append(TextBlock(rect=fitz.Rect(x0, y0, x1, y1), text=normalized))
    return sorted(blocks, key=lambda block: (block.rect.y0, block.rect.x0))


def caption_distance(region: fitz.Rect, block: TextBlock) -> tuple[bool, float] | None:
    if block.rect.y0 >= region.y1:
        distance = block.rect.y0 - region.y1
        if distance > MAX_CAPTION_DISTANCE_BELOW:
            return None
        return True, distance
    if block.rect.y1 <= region.y0:
        distance = region.y0 - block.rect.y1
        if distance > MAX_CAPTION_DISTANCE_ABOVE:
            return None
        return False, distance + 30
    return True, 0.0


def horizontal_penalty(region: fitz.Rect, block: TextBlock) -> float:
    overlap = max(0.0, min(region.x1, block.rect.x1) - max(region.x0, block.rect.x0))
    min_width = max(1.0, min(region.width, block.rect.width))
    ratio = overlap / min_width
    return 0.0 if ratio >= 0.2 else 40.0


def merge_caption_lines(blocks: list[TextBlock], start_index: int) -> str:
    parts = [blocks[start_index].text]
    anchor = blocks[start_index]

    for next_block in blocks[start_index + 1 :]:
        if next_block.rect.y0 - anchor.rect.y1 > 28:
            break
        if horizontal_penalty(anchor.rect, next_block) > 0:
            break
        parts.append(next_block.text)
        anchor = next_block
        if len(" ".join(parts)) >= MAX_FIGURE_TEXT_CHARS:
            break

    return normalize_text(" ".join(parts))[:MAX_FIGURE_TEXT_CHARS]


def best_caption_for_region(region: fitz.Rect, blocks: list[TextBlock]) -> tuple[str | None, bool]:
    best_explicit: tuple[float, int] | None = None
    best_generic: tuple[float, int] | None = None

    for index, block in enumerate(blocks):
        distance_info = caption_distance(region, block)
        if distance_info is None:
            continue
        _below, distance = distance_info
        score = distance + horizontal_penalty(region, block)

        if CAPTION_RE.search(block.text):
            if best_explicit is None or score < best_explicit[0]:
                best_explicit = (score, index)
        elif best_generic is None or score < best_generic[0]:
            best_generic = (score, index)

    if best_explicit is not None:
        return merge_caption_lines(blocks, best_explicit[1]), True
    if best_generic is not None:
        return blocks[best_generic[1]].text[:MAX_FIGURE_TEXT_CHARS], False
    return None, False


def placed_image(block: dict) -> PlacedImage | None:
    """An image block's printed box, pixel count, and how far the page
    stretched it. None for a rotated or sheared placement, whose box says
    nothing about the image's proportions."""
    rect = fitz.Rect(block.get("bbox", (0, 0, 0, 0)))
    width, height = block.get("width") or 0, block.get("height") or 0
    if rect.is_empty or rect.height <= 0 or width <= 0 or height <= 0:
        return None
    a, b, c, d = (block.get("transform") or (1, 0, 0, 1, 0, 0))[:4]
    scale = max(abs(a), abs(d), 1e-9)
    if abs(b) > scale * 1e-3 or abs(c) > scale * 1e-3 or abs(a) < 1e-9 or abs(d) < 1e-9:
        return None
    # The image's own shape, in its own resolution: a scan stored at unequal
    # horizontal and vertical DPI is not square-pixelled.
    xres, yres = block.get("xres") or 0, block.get("yres") or 0
    own_ratio = (width / xres) / (height / yres) if xres > 0 and yres > 0 else width / height
    return PlacedImage(
        rect=rect,
        pixels=int(width * height),
        stretch=(rect.width / rect.height) / own_ratio,
    )


def region_stretch(region: fitz.Rect, images: list[PlacedImage]) -> float:
    """How far to un-stretch this region: the stretch of the raster that IS
    the figure — the one with the most pixels among those filling most of the
    region, so a drop-shadow or frame image laid under it does not decide.
    A region the raster only partly fills (vector labels, a panel beside it)
    is left as printed; un-stretching it would distort the rest."""
    best: PlacedImage | None = None
    region_area = area(region)
    if region_area <= 0:
        return 1.0
    for image in images:
        if area(image.rect & region) / region_area < 0.6:
            continue
        if best is None or image.pixels > best.pixels:
            best = image
    if best is None:
        return 1.0
    stretch = best.stretch
    if 1 / STRETCH_TOLERANCE <= stretch <= STRETCH_TOLERANCE:
        return 1.0
    if not 1 / MAX_STRETCH_CORRECTION <= stretch <= MAX_STRETCH_CORRECTION:
        return 1.0
    return stretch


def candidate_regions(page: fitz.Page, blocks: list[TextBlock]) -> list[RegionCandidate]:
    candidates: list[RegionCandidate] = []

    page_dict = page.get_text("dict")
    images = [
        image
        for image in (
            placed_image(block)
            for block in page_dict.get("blocks", [])
            if block.get("type") == 1
        )
        if image is not None
    ]
    for block in page_dict.get("blocks", []):
        if block.get("type") != 1:
            continue
        rect = fitz.Rect(block.get("bbox", (0, 0, 0, 0)))
        if rect.width < MIN_WIDTH or rect.height < MIN_HEIGHT or area(rect) < MIN_AREA:
            continue
        caption, explicit = best_caption_for_region(rect, blocks)
        candidates.append(
            RegionCandidate(
                page_index=page.number,
                rect=rect,
                kind="image",
                caption=caption,
                explicit_caption=explicit,
            )
        )

    try:
        drawing_rects = page.cluster_drawings()
    except Exception:
        drawing_rects = []

    for rect in drawing_rects:
        if rect.width < MIN_WIDTH or rect.height < MIN_HEIGHT or area(rect) < MIN_AREA:
            continue
        caption, explicit = best_caption_for_region(rect, blocks)
        if not explicit:
            continue
        candidates.append(
            RegionCandidate(
                page_index=page.number,
                rect=rect,
                kind="drawing",
                caption=caption,
                explicit_caption=True,
            )
        )

    candidates.sort(
        key=lambda candidate: (
            candidate.page_index,
            candidate.rect.y0,
            candidate.rect.x0,
            0 if candidate.explicit_caption else 1,
        )
    )

    deduped: list[RegionCandidate] = []
    for candidate in candidates:
        keep = True
        for existing in deduped:
            if candidate.page_index != existing.page_index:
                continue
            if overlap_ratio(candidate.rect, existing.rect) < 0.85:
                continue
            if candidate.explicit_caption and not existing.explicit_caption:
                deduped.remove(existing)
                break
            if area(candidate.rect) > area(existing.rect) * 1.15:
                deduped.remove(existing)
                break
            keep = False
            break
        if keep:
            deduped.append(candidate)

    for candidate in deduped:
        candidate.stretch = region_stretch(candidate.rect, images)

    return deduped


def clip_png_base64(page: fitz.Page, rect: fitz.Rect, stretch: float = 1.0) -> str | None:
    clip = fitz.Rect(
        max(page.rect.x0, rect.x0 - CLIP_PADDING),
        max(page.rect.y0, rect.y0 - CLIP_PADDING),
        min(page.rect.x1, rect.x1 + CLIP_PADDING),
        min(page.rect.y1, rect.y1 + CLIP_PADDING),
    )
    if clip.is_empty or clip.width <= 1 or clip.height <= 1:
        return None

    # Un-stretching lengthens the squeezed side rather than shortening the
    # stretched one, so no printed detail is thrown away: printed too wide
    # (stretch > 1) renders taller, printed too tall renders wider.
    x_gain, y_gain = (1.0, stretch) if stretch >= 1 else (1 / stretch, 1.0)

    # Start at the high-DPI default; drop only when the area would exceed the
    # safety ceiling. Most figures clear DEFAULT_SCALE comfortably.
    scale = DEFAULT_SCALE
    while (
        clip.width * clip.height * x_gain * y_gain * (scale**2) > MAX_PIXELS
        and scale > MIN_SCALE
    ):
        scale -= 0.2
    scale = max(MIN_SCALE, scale)

    pix = page.get_pixmap(
        clip=clip, matrix=fitz.Matrix(scale * x_gain, scale * y_gain), alpha=False
    )
    png_bytes = pix.tobytes("png")
    if not png_bytes:
        return None
    return base64.b64encode(png_bytes).decode("ascii")


def extract_figures(pdf_path: str, max_pages: int, max_figures: int) -> dict:
    figures: list[dict] = []
    doc = fitz.open(pdf_path)
    reason = None

    try:
        page_count = min(len(doc), max_pages)
        ordinal = 0
        for page_index in range(page_count):
            page = doc[page_index]
            blocks = collect_text_blocks(page)
            for candidate in candidate_regions(page, blocks):
                data_base64 = clip_png_base64(page, candidate.rect, candidate.stretch)
                if not data_base64:
                    continue
                figures.append(
                    {
                        "ordinal": ordinal,
                        "page": page_index + 1,
                        "caption": candidate.caption,
                        "kind": candidate.kind,
                        "mimeType": "image/png",
                        "dataBase64": data_base64,
                    }
                )
                ordinal += 1
                if len(figures) >= max_figures:
                    break
            if len(figures) >= max_figures:
                break

        if not figures:
            reason = (
                "Peer opened the PDF, but did not find any figure regions with a real chart, diagram, or image plus a usable caption."
            )

        return {"figures": figures, "reason": reason}
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--max-pages", type=int, default=24)
    parser.add_argument("--max-figures", type=int, default=12)
    # Where to write the result. A dozen rendered figures is ~10 MB of base64,
    # which overflowed the Node side's stdout buffer; and MuPDF itself prints
    # format warnings to stdout, which is not JSON. A file has neither problem.
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    try:
        result = extract_figures(args.input, args.max_pages, args.max_figures)
    except Exception as exc:
        result = {"figures": [], "reason": f"PDF figure extraction failed: {exc}"}

    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
    else:
        json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
