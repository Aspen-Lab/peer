#!/usr/bin/env python
"""Extract structured text from a legal PDF.

Returns sectioned body text (Introduction / Methods / Results / Discussion / ...)
plus a flat list of figure captions. The Peer deep-report pipeline uses this
output to feed a two-pass LLM workflow (classify -> extract) without needing to
download the PDF more than once.

Section detection strategy:
  1. PDF TOC, if present and looks academic.
  2. Heading regex over text blocks (common academic section names).
  3. Single-section fallback ("Body") when neither yields useful structure.

Figure caption detection reuses the same heuristic as `extract_pdf_figures.py`:
text blocks starting with "Figure N" / "Fig. N".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass

# See extract_pdf_figures.py: `import fitz` prints a deprecation line to
# stdout on PyMuPDF 1.24+, which is where this script's JSON goes.
try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

# Known academic section headings, ordered so a later "Discussion" doesn't
# accidentally match earlier in "Results and Discussion".
SECTION_HEADINGS = [
    "Abstract",
    "Introduction",
    "Limitations",
    "Threats to Validity",
    "Evaluation",
    "Experiments",
    "Experimental Setup",
    "Future Work",
    "Background",
    "Related Work",
    "Materials and Methods",
    "Materials & Methods",
    "Experimental Section",
    "Experimental Methods",
    "Methods",
    "Methodology",
    "Approach",
    "Model",
    "Theory",
    "Results and Discussion",
    "Results",
    "Discussion",
    "Conclusion",
    "Conclusions",
    "Summary",
    "Acknowledgments",
    "Acknowledgements",
    "References",
    "Supplementary",
    "Supplementary Information",
    "Supporting Information",
]

# Build one regex that matches any heading at line start, with optional
# leading numbering ("1.", "2.1", "II.") and optional trailing colon.
_HEADING_VARIANTS = "|".join(re.escape(h) for h in SECTION_HEADINGS)
HEADING_RE = re.compile(
    rf"^\s*(?:(?:\d+(?:\.\d+)*\.?)|(?:[IVX]+\.))?\s*({_HEADING_VARIANTS})\s*[:.]?\s*$",
    re.IGNORECASE,
)

FIGURE_CAPTION_RE = re.compile(
    r"^\s*(fig(?:ure)?\.?)\s*(\d+[a-z]?)\b\.?\s*(.*)$",
    re.IGNORECASE,
)

# Stop body extraction once we hit one of these (References list bloats tokens
# and adds no value to the report).
TERMINAL_HEADINGS = {"references", "acknowledgments", "acknowledgements"}

MAX_SECTION_CHARS = 18_000  # cap per-section so a single bloated section can't
# eat the whole token budget downstream.
MAX_TOTAL_CHARS = 90_000


@dataclass
class HeadingHit:
    page: int
    block_index: int
    line_index: int
    heading: str
    canonical: str  # lowercase, used for grouping


def canonicalize(heading: str) -> str:
    """Map similar headings to a canonical bucket name.

    Example: "Materials and Methods", "Methods", "Methodology" -> "methods".
    """
    lower = heading.lower().strip()
    # Mirrors canonicalizeHeading in web/src/lib/papers/html-text.ts: the
    # limitations bucket is the section a reader most wants quoted, and
    # "Evaluation"/"Experiments" hold results, not method.
    if any(key in lower for key in ("limitation", "caveat", "threats to validity")):
        return "limitations"
    if lower.startswith(("evaluation", "experiments")) and "setup" not in lower:
        return "results"
    if any(key in lower for key in ("materials and method", "experimental", "methodolog")):
        return "methods"
    if "method" in lower:
        return "methods"
    if "result" in lower and "discussion" in lower:
        return "results"
    if "result" in lower:
        return "results"
    if "discussion" in lower:
        return "discussion"
    if "introduction" in lower or "background" in lower:
        return "introduction"
    if "related work" in lower:
        return "related_work"
    if "abstract" in lower:
        return "abstract"
    if "conclusion" in lower or "summary" in lower:
        return "conclusion"
    if "reference" in lower:
        return "references"
    if "acknowledg" in lower:
        return "acknowledgments"
    if "supplement" in lower or "supporting" in lower:
        return "supplementary"
    return lower or "body"


def extract_page_lines(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    """Return (bbox, text) for each line in reading order."""
    lines: list[tuple[fitz.Rect, str]] = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text_parts = [span.get("text", "") for span in spans]
            text = "".join(text_parts).strip()
            if not text:
                continue
            bbox = fitz.Rect(line.get("bbox", (0, 0, 0, 0)))
            lines.append((bbox, text))
    lines.sort(key=lambda entry: (round(entry[0].y0, 1), entry[0].x0))
    return lines


def find_heading_hits(pages_lines: list[list[tuple[fitz.Rect, str]]]) -> list[HeadingHit]:
    hits: list[HeadingHit] = []
    for page_index, lines in enumerate(pages_lines):
        for line_index, (_rect, text) in enumerate(lines):
            match = HEADING_RE.match(text)
            if not match:
                continue
            heading = match.group(1)
            hits.append(
                HeadingHit(
                    page=page_index + 1,
                    block_index=0,
                    line_index=line_index,
                    heading=heading,
                    canonical=canonicalize(heading),
                )
            )
    return hits


def segment_into_sections(
    pages_lines: list[list[tuple[fitz.Rect, str]]],
    hits: list[HeadingHit],
) -> list[dict]:
    """Group every non-heading line into the section it falls under.

    If no heading hits exist, returns a single "body" section with all text.
    Stops emitting body content once we cross into References / Acknowledgments.
    """
    flat: list[tuple[int, int, str]] = []
    for page_index, lines in enumerate(pages_lines):
        for line_index, (_rect, text) in enumerate(lines):
            flat.append((page_index + 1, line_index, text))

    if not hits:
        body_text = " ".join(entry[2] for entry in flat)
        return [
            {
                "heading": "Body",
                "canonical": "body",
                "page": flat[0][0] if flat else 1,
                "text": body_text[:MAX_SECTION_CHARS],
            }
        ]

    # Map (page, line) -> heading hit position
    boundaries = [(hit.page, hit.line_index, hit) for hit in hits]
    boundaries.sort(key=lambda entry: (entry[0], entry[1]))

    sections: dict[str, dict] = {}
    cursor_hit: HeadingHit | None = None

    for page, line_index, text in flat:
        # Advance cursor whenever we pass a boundary at or before this position.
        while boundaries and (
            boundaries[0][0] < page
            or (boundaries[0][0] == page and boundaries[0][1] <= line_index)
        ):
            cursor_hit = boundaries.pop(0)[2]
            sections.setdefault(
                cursor_hit.canonical,
                {
                    "heading": cursor_hit.heading,
                    "canonical": cursor_hit.canonical,
                    "page": cursor_hit.page,
                    "text": "",
                },
            )

        if cursor_hit is None:
            continue  # text before the first heading (title page) — drop

        if cursor_hit.canonical in TERMINAL_HEADINGS:
            continue  # don't accumulate references / ack into payload

        # Skip the heading line itself.
        if HEADING_RE.match(text):
            continue

        bucket = sections[cursor_hit.canonical]
        if len(bucket["text"]) < MAX_SECTION_CHARS:
            bucket["text"] = (bucket["text"] + " " + text).strip()

    ordered = sorted(sections.values(), key=lambda section: section["page"])
    return ordered


def extract_figure_captions(pages_lines: list[list[tuple[fitz.Rect, str]]]) -> list[dict]:
    captions: list[dict] = []
    ordinal = 0
    for page_index, lines in enumerate(pages_lines):
        i = 0
        while i < len(lines):
            _bbox, text = lines[i]
            match = FIGURE_CAPTION_RE.match(text)
            if not match:
                i += 1
                continue
            label = f"Figure {match.group(2).upper()}"
            tail = match.group(3) or ""
            # Greedy-merge the next few lines as continuation.
            j = i + 1
            while j < len(lines) and j - i < 5:
                _next_bbox, next_text = lines[j]
                if HEADING_RE.match(next_text) or FIGURE_CAPTION_RE.match(next_text):
                    break
                if len(tail) > 500:
                    break
                tail = (tail + " " + next_text).strip()
                j += 1
            captions.append(
                {
                    "ordinal": ordinal,
                    "label": label,
                    "caption": tail.strip()[:500],
                    "page": page_index + 1,
                }
            )
            ordinal += 1
            i = j
    return captions


# 2-06 (Ruling 9, A2-01): an arXiv margin stamp, a bare DOI, or a bare URL on
# page 1 — excluded from the title candidate pool *before* the max-font-size
# search below runs, never filtered out of the result afterward (a stamp
# rendered larger than the real title, as arXiv's own margin stamp is,
# would otherwise already have won the size comparison by the time any
# after-the-fact filter saw it).
TITLE_STAMP_RE = re.compile(r"^(?:arXiv:\d{4}\.\d{4,5}|10\.\d{4,9}/|https?://)", re.IGNORECASE)
# A short line that is only digits, slashes, dots, colons, and spaces — a
# bare date stamp ("03/2026", "2026.09.15"), not title prose.
DATE_STAMP_RE = re.compile(r"^[\d/.\-: ]{1,20}$")


def _looks_like_title_stamp(text: str) -> bool:
    return bool(TITLE_STAMP_RE.match(text) or DATE_STAMP_RE.match(text))


def _first_page_lines_with_size(page: fitz.Page) -> list[tuple[fitz.Rect, str, float]]:
    """Page-1 lines, sorted top-to-bottom the same way `extract_page_lines`
    already does, each carrying its largest span size. Kept as its own
    function rather than widening `extract_page_lines`'s shared (bbox, text)
    shape, which `find_heading_hits`/`segment_into_sections`/
    `extract_figure_captions` all destructure directly — the title heuristic
    below is the only caller that needs a size alongside the text."""
    lines: list[tuple[fitz.Rect, str, float]] = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(span.get("text", "") for span in spans).strip()
            if not text:
                continue
            size = max((float(span.get("size", 0)) for span in spans), default=0.0)
            bbox = fitz.Rect(line.get("bbox", (0, 0, 0, 0)))
            lines.append((bbox, text, size))
    # Identical sort key to extract_page_lines — real top-to-bottom reading
    # order is what makes "consecutive lines" a well-defined idea at all.
    lines.sort(key=lambda entry: (round(entry[0].y0, 1), entry[0].x0))
    return lines


def extract_title(doc: fitz.Document) -> str | None:
    meta_title = (doc.metadata or {}).get("title")
    if meta_title and len(meta_title) >= 6:
        return meta_title.strip()
    if len(doc) == 0:
        return None
    lines = _first_page_lines_with_size(doc[0])
    # Filter stamps/short fragments out of the candidate pool *before*
    # finding the largest size, not after (see TITLE_STAMP_RE's comment).
    candidates = [
        (text, size)
        for _bbox, text, size in lines
        if len(text) >= 12 and size >= 12 and not _looks_like_title_stamp(text)
    ]
    if not candidates:
        return None
    max_size = max(size for _text, size in candidates)
    # Join every consecutive run of lines at the max size — a wrapped title
    # spans several lines at the same size; the run stops at the first line
    # of a different size (the author/affiliation line that follows a title
    # is reliably smaller).
    joined: list[str] = []
    for text, size in candidates:
        if abs(size - max_size) < 0.01:
            joined.append(text)
        elif joined:
            break
    return " ".join(joined) if joined else None


def extract_text(pdf_path: str, max_pages: int) -> dict:
    doc = fitz.open(pdf_path)
    try:
        # Read at most max_pages, but report the document's real length:
        # the reading page says "a 50-page PDF", and a cap disguised as a
        # count would call every long paper a 40-page one.
        total_pages = len(doc)
        page_count = min(total_pages, max_pages)
        pages_lines = [extract_page_lines(doc[i]) for i in range(page_count)]
        hits = find_heading_hits(pages_lines)
        sections = segment_into_sections(pages_lines, hits)
        captions = extract_figure_captions(pages_lines)

        # Enforce global cap so the JSON payload doesn't balloon.
        running = 0
        trimmed = []
        for section in sections:
            text = section["text"]
            remaining = MAX_TOTAL_CHARS - running
            if remaining <= 0:
                break
            if len(text) > remaining:
                text = text[:remaining]
            section["text"] = text
            running += len(text)
            trimmed.append(section)

        # 2-06 (Ruling 9, A2-01), step (b): the upload route's small-tier-
        # model title fallback needs page 1's own text when step (a)
        # (extract_title, above) doesn't produce a usable title — segmented
        # `sections` never carries it (segment_into_sections deliberately
        # drops everything before the first recognized heading, which is
        # exactly the title-page area). Already have `pages_lines[0]` in
        # memory from the pass above; joining it is free. Capped generously
        # (well under MAX_TOTAL_CHARS) since this is model-prompt input, not
        # a displayed section — the caller slices further if it wants less.
        page1_text = " ".join(text for _bbox, text in pages_lines[0])[:4000] if pages_lines else ""

        return {
            "title": extract_title(doc),
            "sections": trimmed,
            "figureCaptions": captions,
            "pageCount": total_pages,
            "pagesRead": page_count,
            "page1Text": page1_text,
            "reason": None if trimmed else "PDF text extractor produced no sections.",
        }
    finally:
        doc.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    # 100, up from 40 (S3, 2026-09-15): the Node caller (pdf-text.ts) always
    # passes --max-pages explicitly, so this default only matters for someone
    # invoking the script directly; kept in sync with MAX_PDF_PAGES there.
    parser.add_argument("--max-pages", type=int, default=100)
    args = parser.parse_args()

    try:
        result = extract_text(args.input, args.max_pages)
    except Exception as exc:
        result = {
            "title": None,
            "sections": [],
            "figureCaptions": [],
            "pageCount": 0,
            "reason": f"PDF text extraction failed: {exc}",
        }

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
