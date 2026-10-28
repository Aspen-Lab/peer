// The figure engine: MuPDF's own WASM build (`mupdf` on npm), run in this
// process on a PDF's bytes. It replaces `scripts/extract_pdf_figures.py`
// (PyMuPDF), which production never had a Python to run, and it is the same
// MuPDF C library underneath — a line-for-line port of that helper's rules, so
// the same paper gives the same figures: the same regions, the same captions,
// boxes within a pixel or two. P9-25 (B) measured it on the owner's paper (12
// regions, 12 of 12 captions identical to the helper's); P9-28 (C) built it.
//
// What a figure is here (P12-28 updates caption pairing; size floors stay):
//   * an embedded raster at least 120 x 120 pt and 20,000 pt^2 is a figure,
//     with a caption if one sits within 220 pt below it or 110 pt above;
//   * a cluster of vector drawing (axes, bars, curves, within 3 pt of each
//     other) of that size is a figure only with an explicit "Figure N" caption;
//   * two regions that mostly overlap are one; a raster the page printed
//     stretched is rendered back to its own shape;
//   * a "Figure N" caption below its figure takes in the pieces in its band
//     (P12-47): sub-floor rasters and clusters of 3,000 pt^2 and more, and
//     above-floor ones with no caption of their own. The floors stay, and
//     nothing below one is a figure of its own; a caption with no region at
//     all needs three such pieces whose union passes them;
//   * the short figure-text lines within 6 pt of such a region (an axis title,
//     a panel letter) join it too; the last line of a body paragraph does not;
//   * a caption is its typed line and the lines that continue it, and it ends
//     at the first line set apart by more than 1.4 of its own line pitch;
//   * a figure is the region plus 10 pt (less, where its caption starts inside
//     that padding: the clip then stops half a point short of the caption),
//     rendered at 2.8x (about 200 DPI), stepped down by 0.2 to stay at or
//     under 4.5 megapixels.
//
// The timeout design (chosen, measured, and why). The helper was killed at 25
// s by `execFile`. In-process there is no kill switch for a call already inside
// WASM, so the bounds are the ones that make a call short: the caps below (18
// MB, 24 pages, 12 figures, 4.5 Mpx), a MuPDF page being a few tens of ms to
// about a second of work, a drawing-count ceiling per page (the one input whose
// clustering grows with the square of its size), and a budget of 25 s counted
// from the call that is checked between pages and before each render — what
// has been found by then is returned, with a reason. Between pages the engine
// hands the event loop back, so a request that arrives mid-extraction is
// served, and the two-at-once limit below is a real limit. The alternative, a
// `worker_thread` with `terminate()`, kills a hang outright but costs a second
// WASM instance per call (P9-25 measured +0.5 to 0.7 s a call, and 1.3 to 1.6 s
// against 0.8 s warm for a page), needs the worker named by a computed path and
// traced by hand so a Turbopack build still ships it, and puts a file outside
// the engine's own into every deployed function. P9-28 measured both on the
// owner's paper (the checkpoint has the numbers) and chose in-process. What it
// cannot do: stop one page that hangs inside MuPDF before the function's own
// `maxDuration` does.
//
// Memory: a WASM heap grows and does not shrink inside a warm instance, and one
// extraction peaks at 150 to 280 MB (the whole 14.5 MB paper: 266 to 279 MB).
// Every MuPDF object made here is destroyed explicitly when its work is done
// (the finalizers would get to them eventually; "eventually" is the problem on
// a warm function), and at most `MAX_CONCURRENT_EXTRACTIONS` run at once in one
// instance.
//
// Licence: `mupdf` is AGPL-3.0-or-later (Artifex dual licence, the same terms
// as PyMuPDF). It is loaded here, lazily, and nowhere else.

import type { Device, Document, Image, Matrix, Page, Path, Rect, StrokeState } from "mupdf";

type Mupdf = typeof import("mupdf");

export interface PdfEngineOptions {
  /** Read at most this many pages from the start of the document. */
  maxPages: number;
  /** Return at most this many figures. */
  maxFigures: number;
  /** Read only this page (1-based; it must also be within `maxPages`). */
  onlyPage?: number;
  /** Return only the region(s) whose caption opens with this figure number:
   *  "Figure 3", "Fig. 3", "3" and "3a" all name figure 3 / 3a. */
  label?: string;
  /** P10-34: find and size the regions, draw none. Each figure comes back with its `width` and `height` (the
   *  pixels the render would have) and an empty `png`; the regions, the captions, the clip, the scale and the
   *  stretch are the render's own, so the size is the picture's. */
  measureOnly?: boolean;
}

export interface PdfEngineFigure {
  /** The figure's index in this answer, from 0; for a whole-document call,
   *  its place in document order (the helper's own numbering). */
  ordinal: number;
  /** 1-based page number. */
  page: number;
  /** The caption block's text (merged lines, at most 500 characters), or the
   *  empty string when no text sits near the region. */
  caption: string;
  /** "image" (an embedded raster) or "drawing" (clustered vector paths). */
  kind: string;
  /** The rendered region as PNG bytes (empty when the call only measured). */
  png: Uint8Array;
  /** P10-34: the picture's size in pixels — the PNG's own width and height, or, when only measured, what they
   *  would be. */
  width: number;
  height: number;
  /** The detected region on its page, [x0, y0, x1, y1] in points from the
   *  page's top-left, before the 10 pt padding the render adds. */
  box?: [number, number, number, number];
}

export interface PdfEngineResult {
  figures: PdfEngineFigure[];
  /** Why there is nothing (or, after a budget stop, not everything). Null when
   *  the document was read in full and figures were found. */
  reason: string | null;
}

/** The byte ceiling for a PDF the engine will open. */
export const MAX_PDF_BYTES = 18_000_000;
/** P12-54 (R13b): the ceiling for a one-page call (`onlyPage` set: the margin's figure image and the sizing), which
 *  reads one page and not the whole document. The upload limit (25 MiB, 26,214,400) plus a margin, so a PDF the
 *  upload route accepted can be read page by page; the whole-document call keeps `MAX_PDF_BYTES`. */
export const MAX_ONE_PAGE_PDF_BYTES = 27_000_000;
/** Extractions allowed to run at once in one instance; the rest wait. */
export const MAX_CONCURRENT_EXTRACTIONS = 2;
/** Time from the call, waiting for a slot included, after which no further page
 *  or figure is started. The helper's own 25 s. */
export const EXTRACTION_BUDGET_MS = 25_000;
/** Distinct vector-path boxes on one page past which the page's vector analysis
 *  is skipped: clustering grows with the square of the count (12,000 is
 *  well under a second). Its rasters are still found. */
const MAX_DRAWING_RECTS = 12_000;

const CAPTION_RE = /^\s*fig(?:ure)?\.?\s*(\d+[a-z]?)\b/i;
const OTHER_CAPTION_RE = /^\s*(?:table|scheme|chart)\.?\s*\d+[a-z]?\b/i;
const LABEL_RE = /^\s*(?:fig(?:ure)?\.?\s*)?(\d+[a-z]?)\s*$/i;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 120;
const MIN_AREA = 20_000;
const CLIP_PADDING = 10;
/** P12-47 R5a: how far short of a caption inside the padding the clip stops, in points. */
const CAPTION_CLEARANCE = 0.5;
const MAX_CAPTION_DISTANCE_BELOW = 220;
const MAX_CAPTION_DISTANCE_ABOVE = 110;
const MAX_FIGURE_TEXT_CHARS = 500;
const MAX_PIXELS = 4_500_000;
const DEFAULT_SCALE = 2.8;
const MIN_SCALE = 1.6;
const STRETCH_TOLERANCE = 1.06;
const MAX_STRETCH_CORRECTION = 4.0;
const OVERLAP_DUPLICATE = 0.85;
const CLUSTER_TOLERANCE = 3;

const NO_FIGURES_REASON =
  "Peer opened the PDF, but did not find any figure regions with a real chart, diagram, or image plus a usable caption.";

// ── The module, the slots, the clock ─────────────────────────────────────

let loading: Promise<Mupdf> | null = null;
function loadMupdf(): Promise<Mupdf> {
  loading ??= import("mupdf")
    .then((mupdf) => {
      // MuPDF prints a line to stderr for every repair and format quirk of a
      // sloppy PDF — hundreds for some papers, and the Python helper's were
      // discarded. A failure still comes back as an exception and a reason.
      mupdf.setLog(() => undefined);
      return mupdf;
    })
    .catch((error: unknown) => {
      loading = null; // a failed load is retried by the next call, not remembered
      throw error;
    });
  return loading;
}

let running = 0;
const waiting: Array<() => void> = [];

/** A slot among `MAX_CONCURRENT_EXTRACTIONS`; the returned function gives it
 *  back, or hands it straight to the longest waiter. */
async function acquireSlot(): Promise<() => void> {
  if (running < MAX_CONCURRENT_EXTRACTIONS) running += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

// ── Geometry (rects are [x0, y0, x1, y1], y down, as MuPDF's page space) ─

const width = (r: Rect) => r[2] - r[0];
const height = (r: Rect) => r[3] - r[1];
const area = (r: Rect) => Math.max(0, width(r)) * Math.max(0, height(r));
const intersect = (a: Rect, b: Rect): Rect => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];
const isEmpty = (r: Rect) => r[0] >= r[2] || r[1] >= r[3];

function overlapRatio(a: Rect, b: Rect): number {
  const common = area(intersect(a, b));
  if (common <= 0) return 0;
  const smaller = Math.min(area(a), area(b));
  return smaller <= 0 ? 0 : common / smaller;
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

// ── A page's text blocks and image blocks ────────────────────────────────

interface TextBlock {
  rect: Rect;
  text: string;
  blockId: number;
}

interface ImageBlock {
  bbox: Rect;
  transform: Matrix;
  width: number;
  height: number;
  xres: number;
  yres: number;
}

function readPageStructure(page: Page): { texts: TextBlock[]; images: ImageBlock[] } {
  const texts: TextBlock[] = [];
  const images: ImageBlock[] = [];
  const structured = page.toStructuredText("preserve-ligatures,preserve-whitespace,clip,preserve-images");
  try {
    let blockId = 0;
    let lineRect: Rect = [0, 0, 0, 0];
    let line: string[] = [];
    structured.walk({
      beginTextBlock() { blockId++; },
      beginLine(rect) { lineRect = rect; line = []; },
      onChar(character, _origin, font) {
        line.push(character);
        font.destroy(); // MuPDF.js wraps a font for every character it walks
      },
      endLine() {
        const text = normalizeText(line.join(""));
        if (text) texts.push({ rect: lineRect, text, blockId });
      },
      onImageBlock(rect, transform, image: Image) {
        try {
          images.push({
            bbox: rect,
            transform,
            width: image.getWidth(),
            height: image.getHeight(),
            xres: image.getXResolution(),
            yres: image.getYResolution(),
          });
        } finally {
          image.destroy();
        }
      },
    });
  } finally {
    structured.destroy();
  }
  const lines = joinLabelOnlyLines(texts);
  lines.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  return { texts: lines, images };
}

// P12-45: a paper may set the figure label ("Fig. 1") as its own text line, a
// few points left of the caption text, outside the picture's width. The label
// then has no horizontal relation to the picture, so it is never a typed
// caption, and the caption beside it carries no label. Such a line is joined
// with the line of its own block on its row. Only a label-only line joins:
// two column captions on one baseline in one block must stay two lines.
const LABEL_ONLY_RE = /^\s*fig(?:ure)?\.?\s*\d+[a-z]?\s*[.:|]?\s*$/i;
/** How far right of the label's end the caption text may start, in points. */
const LABEL_ROW_REACH = 12;
/** Label-only lines examined on one page; the ones past it are left as they were. */
const MAX_LABEL_ONLY_LINES = 200;

/** `lines` with each label-only line merged into the line of the same block on
 *  its row that starts within `LABEL_ROW_REACH` pt to its right: one line, the
 *  union rectangle, the text "label body", in the body line's place. */
export function joinLabelOnlyLines(lines: TextBlock[]): TextBlock[] {
  const byBlock = new Map<number, number[]>();
  for (const [index, line] of lines.entries()) {
    const members = byBlock.get(line.blockId);
    if (members) members.push(index);
    else byBlock.set(line.blockId, [index]);
  }
  const joined = new Map<number, TextBlock>();
  const dropped = new Set<number>();
  let examined = 0;
  for (const [index, label] of lines.entries()) {
    if (!LABEL_ONLY_RE.test(label.text)) continue;
    if (++examined > MAX_LABEL_ONLY_LINES) break;
    let nearest = -1;
    let nearestGap = Infinity;
    for (const other of byBlock.get(label.blockId) ?? []) {
      const body = lines[other];
      if (other === index || joined.has(other)) continue;
      if (LABEL_ONLY_RE.test(body.text) || CAPTION_RE.test(body.text) || OTHER_CAPTION_RE.test(body.text)) continue;
      const gap = body.rect[0] - label.rect[2];
      if (gap < -1 || gap > LABEL_ROW_REACH || gap >= nearestGap) continue;
      const shared = Math.min(label.rect[3], body.rect[3]) - Math.max(label.rect[1], body.rect[1]);
      if (shared < 0.5 * Math.min(height(label.rect), height(body.rect))) continue;
      nearest = other;
      nearestGap = gap;
    }
    if (nearest < 0) continue;
    const body = lines[nearest];
    dropped.add(index);
    joined.set(nearest, {
      rect: [Math.min(label.rect[0], body.rect[0]), Math.min(label.rect[1], body.rect[1]), Math.max(label.rect[2], body.rect[2]), Math.max(label.rect[3], body.rect[3])],
      text: `${label.text} ${body.text}`,
      blockId: body.blockId,
    });
  }
  if (joined.size === 0) return lines;
  return lines.flatMap((line, index) => (dropped.has(index) ? [] : [joined.get(index) ?? line]));
}

// ── Captions ─────────────────────────────────────────────────────────────

/** An above or below caption's actual gap. Text inside the drawing is not a
 * caption; another column is not a caption, however close its y coordinate. */
function captionDistance(region: Rect, block: TextBlock): number | null {
  if (horizontalPenalty(region, block) > 0) return null;
  if (block.rect[1] >= region[3]) {
    const distance = block.rect[1] - region[3];
    return distance > MAX_CAPTION_DISTANCE_BELOW ? null : distance;
  }
  if (block.rect[3] <= region[1]) {
    const distance = region[1] - block.rect[3];
    return distance > MAX_CAPTION_DISTANCE_ABOVE ? null : distance;
  }
  return null;
}

function horizontalPenalty(region: Rect, block: TextBlock): number {
  const overlap = Math.max(0, Math.min(region[2], block.rect[2]) - Math.max(region[0], block.rect[0]));
  const minWidth = Math.max(1, Math.min(width(region), width(block.rect)));
  return overlap / minWidth >= 0.2 ? 0 : 40;
}

/** P12-47 R8a: a caption ends at the first line that starts more than this many times the caption's own median
 *  line pitch below the line above it (the body paragraph that follows a caption is set apart by more than a line). */
const CAPTION_PITCH_JUMP = 1.4;

const medianOf = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The caption block and the lines that continue it (each within 28 pt of the
 *  last and horizontally overlapping it), up to 500 characters, ending at a
 *  pitch jump (R8a): the pitch is top to top, and a caption of one line so far
 *  has none of its own, so its second line is joined as before. */
export function mergeCaptionLines(blocks: TextBlock[], start: number): string {
  const parts = [blocks[start].text];
  const originalBlock = blocks[start].blockId;
  let anchor = blocks[start];
  const pitches: number[] = [];
  for (const next of blocks.slice(start + 1)) {
    // Original block lines were joined before spatial checks. A distant other
    // block must not prevent a later line from that same original block.
    if (next.blockId !== originalBlock && next.rect[1] - anchor.rect[3] > 28) continue;
    if (horizontalPenalty(anchor.rect, next) > 0) continue;
    // Lines in one original block may have overlapping glyph rectangles even
    // when their starts are distinct and later. Same-baseline lines stay apart.
    if (next.blockId === originalBlock ? next.rect[1] <= anchor.rect[1] : next.rect[1] < anchor.rect[3]) continue;
    if (CAPTION_RE.test(next.text) || OTHER_CAPTION_RE.test(next.text)) break;
    const pitch = next.rect[1] - anchor.rect[1];
    if (pitches.length > 0 && pitch > CAPTION_PITCH_JUMP * medianOf(pitches)) break;
    pitches.push(pitch);
    parts.push(next.text);
    anchor = next;
    if (parts.join(" ").length >= MAX_FIGURE_TEXT_CHARS) break;
  }
  return normalizeText(parts.join(" ")).slice(0, MAX_FIGURE_TEXT_CHARS);
}

interface CaptionMatch {
  caption: string | null;
  explicit: boolean;
  excluded: boolean;
  distance: number;
  /** The caption line's place in the page's text list; -1 when no line was paired. */
  index: number;
}

function bestCaptionForRegion(region: Rect, blocks: TextBlock[]): CaptionMatch {
  let bestTyped: { score: number; index: number } | null = null;
  let ambiguous = false;
  let bestGeneric: { score: number; index: number } | null = null;
  for (const [index, block] of blocks.entries()) {
    const distance = captionDistance(region, block);
    if (distance === null) continue;
    const score = distance;
    if (CAPTION_RE.test(block.text) || OTHER_CAPTION_RE.test(block.text)) {
      if (bestTyped === null || score < bestTyped.score) {
        bestTyped = { score, index };
        ambiguous = false;
      } else if (score === bestTyped.score) ambiguous = true;
    } else if (bestGeneric === null || score < bestGeneric.score) {
      bestGeneric = { score, index };
    }
  }
  if (bestTyped) {
    const explicit = CAPTION_RE.test(blocks[bestTyped.index].text);
    return { caption: mergeCaptionLines(blocks, bestTyped.index), explicit, excluded: ambiguous || !explicit, distance: bestTyped.score, index: bestTyped.index };
  }
  if (bestGeneric) return { caption: blocks[bestGeneric.index].text.slice(0, MAX_FIGURE_TEXT_CHARS), explicit: false, excluded: false, distance: bestGeneric.score, index: bestGeneric.index };
  return { caption: null, explicit: false, excluded: false, distance: Infinity, index: -1 };
}

// ── Stretched rasters ────────────────────────────────────────────────────

interface PlacedImage {
  rect: Rect;
  pixels: number;
  /** Printed width-to-height over the image's own; 1 = drawn as it is. */
  stretch: number;
}

/** An image's printed box, pixel count and how far the page stretched it; null
 *  for a rotated or sheared placement, whose box says nothing about proportion. */
function placedImage(image: ImageBlock): PlacedImage | null {
  const rect = image.bbox;
  if (isEmpty(rect) || height(rect) <= 0 || image.width <= 0 || image.height <= 0) return null;
  const [a, b, c, d] = image.transform;
  const scale = Math.max(Math.abs(a), Math.abs(d), 1e-9);
  if (Math.abs(b) > scale * 1e-3 || Math.abs(c) > scale * 1e-3 || Math.abs(a) < 1e-9 || Math.abs(d) < 1e-9) return null;
  const { xres, yres } = image;
  const ownRatio = xres > 0 && yres > 0 ? image.width / xres / (image.height / yres) : image.width / image.height;
  return { rect, pixels: image.width * image.height, stretch: width(rect) / height(rect) / ownRatio };
}

/** How far to un-stretch a region: the stretch of the raster that IS the figure
 *  (most pixels among those filling most of it); 1 when it is within 6 % of
 *  right, or off by more than 4x (a strip or a tiled background, not a figure). */
function regionStretch(region: Rect, images: PlacedImage[]): number {
  const regionArea = area(region);
  if (regionArea <= 0) return 1;
  let best: PlacedImage | null = null;
  for (const image of images) {
    if (area(intersect(image.rect, region)) / regionArea < 0.6) continue;
    if (best === null || image.pixels > best.pixels) best = image;
  }
  if (best === null) return 1;
  const stretch = best.stretch;
  if (1 / STRETCH_TOLERANCE <= stretch && stretch <= STRETCH_TOLERANCE) return 1;
  if (!(1 / MAX_STRETCH_CORRECTION <= stretch && stretch <= MAX_STRETCH_CORRECTION)) return 1;
  return stretch;
}

// ── Vector drawings: page.get_drawings() rects and page.cluster_drawings() ─

/** The box of a path the way PyMuPDF's line-art device takes it: every point of
 *  the walked path through the matrix — a curve's control points included, a
 *  stroke's width not — and null for a path with no line or curve in it. (MuPDF's
 *  own `getBounds` widens a stroke by up to its miter limit, which made a
 *  crop up to 10 pt roomier than the helper's.) */
function pathBox(path: Path, ctm: Matrix, allMoves = false): Rect | null {
  const [a, b, c, d, e, f] = ctm;
  let box: Rect | null = null;
  let drawn = false;
  const include = (x: number, y: number) => {
    const px = a * x + c * y + e;
    const py = b * x + d * y + f;
    if (box === null) box = [px, py, px, py];
    else {
      box[0] = Math.min(box[0], px);
      box[1] = Math.min(box[1], py);
      box[2] = Math.max(box[2], px);
      box[3] = Math.max(box[3], py);
    }
  };
  let moved = false;
  let pendingMove: [number, number] | null = null;
  const beginDrawnSubpath = () => {
    if (pendingMove) include(pendingMove[0], pendingMove[1]);
    pendingMove = null;
  };
  path.walk({
    moveTo(x, y) {
      if (allMoves) pendingMove = [x, y];
      else if (!moved) include(x, y); // strokes retain legacy bounds
      moved = true;
    },
    lineTo(x, y) {
      beginDrawnSubpath();
      include(x, y);
      drawn = true;
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      beginDrawnSubpath();
      include(x1, y1);
      include(x2, y2);
      include(x3, y3);
      drawn = true;
    },
  });
  return drawn ? box : null;
}

/** Every filled and stroked path of the page, as boxes; `overflow` when the page
 *  holds more than a plausible figure's worth and the rest was not collected. */
function collectDrawingBoxes(mupdf: Mupdf, page: Page): { boxes: Rect[]; overflow: boolean } {
  const boxes: Rect[] = [];
  // null represents an unsupported clip, never a guessed smaller rectangle.
  const clips: Array<Rect | null> = [];
  const MAX_CLIP_DEPTH = 128;
  let excessDepth = 0;
  let specialDepth = 0;
  let uncertain = false;
  let badStack = false;
  let overflow = false;
  let pathWalks = 0;
  const push = (box: Rect | null) => {
    if (excessDepth || clips.length >= MAX_CLIP_DEPTH) { excessDepth++; uncertain = true; return; }
    if (box && (!box.every(Number.isFinite) || box[0] > box[2] || box[1] > box[3])) box = null;
    if (!box) uncertain = true;
    clips.push(box);
  };
  const keep = (path: Path, ctm: Matrix, fill: boolean) => {
    if (pathWalks >= MAX_DRAWING_RECTS * 5) { overflow = true; return; }
    pathWalks++;
    let box = pathBox(path, ctm, fill);
    if (!box) return;
    // Unknown nesting and pattern/mask painting keep original support, which
    // is conservative; strokes always keep the pre-existing centerline box.
    if (fill && !excessDepth && !specialDepth && !badStack) {
      for (const clip of clips) {
        if (!clip) continue;
        box = [Math.max(box[0], clip[0]), Math.max(box[1], clip[1]), Math.min(box[2], clip[2]), Math.min(box[3], clip[3])];
        if (box[0] > box[2] || box[1] > box[3]) return;
      }
    }
    boxes.push(box);
  };
  const device: Device = new mupdf.Device({
    fillPath(path, _evenOdd, ctm, colorspace) {
      try { keep(path, ctm, true); } finally { path.destroy(); colorspace.destroy(); }
    },
    strokePath(path, stroke, ctm, colorspace) {
      try { keep(path, ctm, false); } finally { path.destroy(); stroke.destroy(); colorspace.destroy(); }
    },
    clipPath(path, _evenOdd, ctm) {
      try {
        let box: Rect | null = null;
        try { box = path.getBounds(null as unknown as StrokeState, ctm); } catch { uncertain = true; }
        push(box);
      } finally { path.destroy(); }
    },
    clipStrokePath(path, stroke) { path.destroy(); stroke.destroy(); push(null); },
    clipText(text) { text.destroy(); push(null); },
    clipStrokeText(text, stroke) { text.destroy(); stroke.destroy(); push(null); },
    clipImageMask(image) { image.destroy(); push(null); },
    popClip() {
      if (excessDepth) excessDepth--;
      else if (clips.length) clips.pop();
      else { uncertain = true; badStack = true; }
    },
    beginMask(_area, _luminosity, colorspace) { colorspace.destroy(); specialDepth++; uncertain = true; },
    endMask() { if (specialDepth) specialDepth--; else { uncertain = true; badStack = true; } push(null); },
    beginTile() { specialDepth++; uncertain = true; return 0; },
    endTile() { if (specialDepth) specialDepth--; else { uncertain = true; badStack = true; } },
  });
  try { page.run(device, mupdf.Matrix.identity); device.close(); } finally { device.destroy(); }
  if (uncertain) console.warn("[figures/pdf-engine] unsupported or excessive clipping retained conservative fill bounds");
  return { boxes, overflow };
}

/** PyMuPDF's `cluster_drawings`: boxes within 3 pt of a growing union join it,
 *  until none is left; the unions wider and taller than 3 pt are the figures.
 *  (The helper's re-sort-and-dedupe after every cluster is done once, up front:
 *  a duplicate of a joined box is joined with it, so the result is the same.) */
function clusterDrawings(boxes: Rect[], pageRect: Rect): Rect[] | null {
  const tolerance = CLUSTER_TOLERANCE;
  const bySortKey = (a: Rect, b: Rect) => a[3] - b[3] || a[0] - b[0];
  const distinct = (list: Rect[]) => {
    const seen = new Map<string, Rect>();
    for (const r of list) seen.set(r.map((v) => v.toFixed(3)).join(","), r);
    return [...seen.values()].sort(bySortKey);
  };
  const neighbors = (a: Rect, b: Rect) =>
    !(a[2] < b[0] - tolerance || a[0] > b[2] + tolerance || a[3] < b[1] - tolerance || a[1] > b[3] + tolerance);

  const remaining = distinct(
    boxes
      .map((r): Rect => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])])
      .filter((r) => r[0] >= pageRect[0] && r[2] <= pageRect[2] && r[1] >= pageRect[1] && r[3] <= pageRect[3]),
  );
  if (remaining.length > MAX_DRAWING_RECTS) return null;

  const clusters: Rect[] = [];
  while (remaining.length) {
    const union: Rect = [...remaining[0]];
    let repeat = true;
    while (repeat) {
      repeat = false;
      for (let i = remaining.length - 1; i > 0; i--) {
        if (neighbors(remaining[i], union)) {
          union[0] = Math.min(union[0], remaining[i][0]);
          union[1] = Math.min(union[1], remaining[i][1]);
          union[2] = Math.max(union[2], remaining[i][2]);
          union[3] = Math.max(union[3], remaining[i][3]);
          remaining.splice(i, 1);
          repeat = true;
        }
      }
    }
    clusters.push(union);
    remaining.shift();
  }
  return distinct(clusters).filter((r) => width(r) > tolerance && height(r) > tolerance);
}

// ── Candidate regions of a page ──────────────────────────────────────────

interface Candidate {
  rect: Rect;
  kind: "image" | "drawing";
  caption: string | null;
  explicit: boolean;
  captionDistance: number;
  stretch: number;
  /** The paired caption line's place in the page's text list; -1 when there is none. */
  captionIndex: number;
}

// ── Caption-bounded band growth: what a "Figure N" caption takes in (P12-47, R9a + R10a) ─
//
// B P12-41 M9 / M10 (and B P12-39 M2 / M4): a figure is often a composite of small plots, photographs and renders of
// which none passes the size floors (M9), or one does and the rest do not (M2), or a panel passes them but sits where
// the caption cannot see it (M10). The floors stay exactly as they are for a candidate, and nothing below a floor
// becomes a figure on its own. What grows is the region of a typed "Figure N" caption that lies below its figure.
// The caption's band runs from the nearest body-like line above it (at least 70 characters and 100 pt wide, or
// another typed caption) down to the caption, or from the page's top furniture band when there is none. The seed is
// the region the caption has; a caption with none (an orphan) seeds on the nearest piece within 220 pt. Every piece
// in the band is then taken, with no gap limit: sub-floor pieces of at least 3,000 pt2 and 30 pt on both sides (R9a),
// and above-floor pieces that carry no typed caption of their own (R10a). An orphan needs three pieces and a union
// that passes the floors. A piece is not taken if taking it would put another captioned region or a caption line
// inside the region. On a page of two or more typed captions the band is read in columns (as B measured it): a
// body-like line bounds the band only if it spans the caption's left edge, and a piece must reach the caption's
// column, which is at least half a page wide.

/** The page's top furniture band, in points: a piece above it is a running head, not a part of the figure. */
const BAND_FURNITURE = 46;
/** A body-like line: at least this many characters and this wide, in points. */
const BODY_LINE_CHARS = 70;
const BODY_LINE_WIDTH = 100;
/** The least a sub-floor piece may be: area in pt2 and the shorter side in points (a 44 x 44 pt mark is neither). */
const PIECE_MIN_AREA = 3_000;
const PIECE_MIN_SIDE = 30;
/** Pieces an orphan caption needs, and how far its columns reach past the caption's own extent. */
const ORPHAN_MIN_PIECES = 3;
const COLUMN_MARGIN = 15;
const COLUMN_MIN_SHARE = 0.5;
/** A raster wider than this share of the page is its background, not a piece. */
const BACKGROUND_SHARE = 0.9;

const isTypedCaption = (text: string) => CAPTION_RE.test(text) || OTHER_CAPTION_RE.test(text);
const failsFloors = (r: Rect) => width(r) < MIN_WIDTH || height(r) < MIN_HEIGHT || area(r) < MIN_AREA;
const unionOf = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const gapBetween = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0 - b1, b0 - a1, 0);
/** How much of `barrier` the rectangle `after` covers beyond what `before` already did. */
const coverageGain = (before: Rect, after: Rect, barrier: Rect) => area(intersect(after, barrier)) - area(intersect(before, barrier));
const isSubPiece = (r: Rect) => failsFloors(r) && area(r) >= PIECE_MIN_AREA && Math.min(width(r), height(r)) >= PIECE_MIN_SIDE;

/** The rasters and vector clusters of a page: what a figure is made of. */
function collectPieces(images: ImageBlock[], clusters: Rect[] | null, pageRect: Rect): Rect[] {
  const pieces: Rect[] = [];
  for (const image of images) {
    if (!isEmpty(image.bbox) && width(image.bbox) <= BACKGROUND_SHARE * width(pageRect)) pieces.push(image.bbox);
  }
  for (const cluster of clusters ?? []) pieces.push(cluster);
  return pieces;
}

/** Does a typed caption, a figure's or a table's, already claim this piece as its own? */
function carriesTypedCaption(piece: Rect, texts: TextBlock[]): boolean {
  const match = bestCaptionForRegion(piece, texts);
  return match.explicit || match.excluded;
}

/** Grows each "Figure N" caption's region by the pieces in its band, and starts a region for an orphan caption;
 *  true when the candidates changed. */
function growFromCaptions(candidates: Candidate[], texts: TextBlock[], pieces: Rect[], pageRect: Rect): boolean {
  if (!pieces.length) return false;
  const typedLines = texts.filter((line) => isTypedCaption(line.text));
  const inColumns = typedLines.length >= 2;
  let changed = false;
  for (const [index, caption] of texts.entries()) {
    if (!CAPTION_RE.test(caption.text)) continue;
    const seed = candidates.find((candidate) => candidate.explicit && candidate.captionIndex === index) ?? null;
    if (seed && seed.rect[3] > caption.rect[1] + 5) continue; // its caption is above it: the band is for a caption below
    if (!seed && candidates.some((candidate) => captionKey(candidate.caption) === captionKey(caption.text))) continue;

    let bandTop = BAND_FURNITURE;
    for (const line of texts) {
      if (line === caption || line.rect[3] > caption.rect[1] + 0.5) continue;
      const bodyLike = (line.text.length >= BODY_LINE_CHARS && width(line.rect) >= BODY_LINE_WIDTH) || isTypedCaption(line.text);
      if (!bodyLike || (inColumns && horizontalPenalty([caption.rect[0], 0, caption.rect[0] + 1, 1], line) > 0)) continue;
      bandTop = Math.max(bandTop, line.rect[3]);
    }
    const columnLeft = inColumns ? caption.rect[0] - COLUMN_MARGIN : -Infinity;
    const columnRight = inColumns ? Math.max(caption.rect[2], caption.rect[0] + COLUMN_MIN_SHARE * width(pageRect)) + COLUMN_MARGIN : Infinity;
    const pool = pieces.filter(
      (piece) =>
        piece[1] >= bandTop - 1 &&
        piece[3] <= caption.rect[1] + 2 &&
        piece[2] > columnLeft &&
        piece[0] < columnRight &&
        (isSubPiece(piece) || (!failsFloors(piece) && !carriesTypedCaption(piece, texts))) &&
        candidates.every((other) => other === seed || !other.explicit || area(intersect(piece, other.rect)) <= 0.01),
    );
    const blocked = (before: Rect, after: Rect) =>
      candidates.some((other) => other !== seed && other.explicit && coverageGain(before, after, other.rect) > 0.01) ||
      typedLines.some((line) => line !== caption && coverageGain(before, after, line.rect) > 0.01);

    let region: Rect;
    let taken = 0;
    let seedPiece = -1;
    if (seed) region = seed.rect;
    else {
      let nearestGap = Infinity;
      pool.forEach((piece, i) => {
        const gap = caption.rect[1] - piece[3];
        if (gap < nearestGap) [seedPiece, nearestGap] = [i, gap];
      });
      if (seedPiece < 0 || nearestGap > MAX_CAPTION_DISTANCE_BELOW) continue;
      region = pool[seedPiece];
      taken = 1;
    }
    for (const [i, piece] of pool.entries()) {
      if (i === seedPiece) continue;
      const grown = unionOf(region, piece);
      if (blocked(region, grown)) continue;
      region = grown;
      taken++;
    }

    if (seed) {
      if (!region.some((value, side) => value !== seed.rect[side])) continue;
      seed.rect = region;
    } else {
      if (taken < ORPHAN_MIN_PIECES || failsFloors(region)) continue;
      const match = bestCaptionForRegion(region, texts);
      if (!match.explicit || match.excluded || match.index !== index) continue;
      candidates.push({ rect: region, kind: "drawing", caption: match.caption, explicit: true, captionDistance: match.distance, stretch: 1, captionIndex: index });
    }
    changed = true;
    // What the region took in is no figure of its own (an uncaptioned raster that was a piece of it).
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (!candidates[i].explicit && overlapRatio(candidates[i].rect, region) >= OVERLAP_DUPLICATE) candidates.splice(i, 1);
    }
  }
  return changed;
}

// ── Figure text: the short lines a captioned region takes in (P12-47, R3a) ─
//
// B P12-39 M3: a drawing's region is its path boxes, so an axis title just past the last axis line, or a panel
// letter, falls outside the crop. A short line of text within 6 pt of an accepted, captioned region joins it, and
// then whatever is within 6 pt of the grown region, until none is left. A line is figure text and not body text
// when it is at most 60 characters, is not a typed caption or a line of the caption's own block, sits on the
// figure's side of the caption (above it, for a caption below), lies inside the region's width widened by 6 pt,
// and does not share its block with a line over 60 characters (the short last line of a paragraph is body).

/** How near a line must be to the region, in points, on each axis; also how far past its sides it may reach. */
const FIGURE_TEXT_REACH = 6;
/** The longest line, in characters, that is figure text; a block holding a longer line is body text. */
const FIGURE_TEXT_CHARS = 60;

/** Grows each accepted, captioned region by the figure-text lines around it; true when any region changed. */
function absorbFigureText(candidates: Candidate[], texts: TextBlock[]): boolean {
  const bodyBlocks = new Set(texts.filter((line) => line.text.length > FIGURE_TEXT_CHARS).map((line) => line.blockId));
  let changed = false;
  for (const host of candidates) {
    if (!host.explicit || host.captionIndex < 0) continue;
    const caption = texts[host.captionIndex];
    const captionIsBelow = caption.rect[1] + caption.rect[3] > host.rect[1] + host.rect[3];
    const onFigureSide = (line: TextBlock) => (captionIsBelow ? line.rect[1] < caption.rect[1] - 1 : line.rect[3] > caption.rect[3] + 1);
    let grew = true;
    while (grew) {
      grew = false;
      for (const line of texts) {
        if (line.text.length > FIGURE_TEXT_CHARS || bodyBlocks.has(line.blockId) || isTypedCaption(line.text)) continue;
        if (line.blockId === caption.blockId || !onFigureSide(line)) continue;
        const near =
          gapBetween(host.rect[0], host.rect[2], line.rect[0], line.rect[2]) <= FIGURE_TEXT_REACH &&
          gapBetween(host.rect[1], host.rect[3], line.rect[1], line.rect[3]) <= FIGURE_TEXT_REACH;
        const withinWidth = line.rect[0] >= host.rect[0] - FIGURE_TEXT_REACH && line.rect[2] <= host.rect[2] + FIGURE_TEXT_REACH;
        const inside = line.rect[0] >= host.rect[0] && line.rect[2] <= host.rect[2] && line.rect[1] >= host.rect[1] && line.rect[3] <= host.rect[3];
        if (!near || !withinWidth || inside) continue;
        host.rect = unionOf(host.rect, line.rect);
        grew = changed = true;
      }
    }
  }
  return changed;
}

function candidateRegions(mupdf: Mupdf, page: Page, pageRect: Rect, texts: TextBlock[], images: ImageBlock[]): { candidates: Candidate[]; drawingLimit: boolean } {
  const candidates: Candidate[] = [];
  const placed = images.map(placedImage).filter((image): image is PlacedImage => image !== null);

  for (const image of images) {
    const rect = image.bbox;
    if (width(rect) < MIN_WIDTH || height(rect) < MIN_HEIGHT || area(rect) < MIN_AREA) continue;
    const { caption, explicit, excluded, distance, index } = bestCaptionForRegion(rect, texts);
    if (excluded) continue;
    candidates.push({ rect, kind: "image", caption, explicit, captionDistance: distance, stretch: 1, captionIndex: index });
  }

  const { boxes, overflow } = collectDrawingBoxes(mupdf, page);
  const clusters = overflow ? null : clusterDrawings(boxes, pageRect);
  for (const rect of clusters ?? []) {
    if (width(rect) < MIN_WIDTH || height(rect) < MIN_HEIGHT || area(rect) < MIN_AREA) continue;
    const { caption, explicit, excluded, distance, index } = bestCaptionForRegion(rect, texts);
    if (!explicit || excluded) continue;
    candidates.push({ rect, kind: "drawing", caption, explicit: true, captionDistance: distance, stretch: 1, captionIndex: index });
  }

  const byPlace = (a: Candidate, b: Candidate) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0] || Number(!a.explicit) - Number(!b.explicit);
  candidates.sort(byPlace);

  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    let keep = true;
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];
      if (overlapRatio(candidate.rect, existing.rect) < OVERLAP_DUPLICATE) continue;
      if (candidate.explicit && !existing.explicit) {
        kept.splice(i, 1);
        break;
      }
      if (area(candidate.rect) > area(existing.rect) * 1.15) {
        kept.splice(i, 1);
        break;
      }
      keep = false;
      break;
    }
    if (keep) kept.push(candidate);
  }
  // A caption naming one figure cannot justify every earlier drawing on the
  // page. Resolve competing regions after overlap dedupe, so the raster and
  // vector views of one picture do not masquerade as two disjoint choices.
  const defensible = kept.filter((candidate) => {
    const key = captionKey(candidate.caption);
    if (key === null) return true;
    const competitors = kept.filter((other) => captionKey(other.caption) === key);
    const nearest = Math.min(...competitors.map((other) => other.captionDistance));
    return candidate.captionDistance === nearest && competitors.filter((other) => other.captionDistance === nearest).length === 1;
  });
  // P12-47 R9a + R10a, then R3a: with the regions settled, each "Figure N" caption below its figure takes in the
  // pieces of its band (an orphan caption starts a region of its own), and then the short figure-text lines around
  // what the region has become.
  const withBands = growFromCaptions(defensible, texts, collectPieces(images, clusters, pageRect), pageRect);
  if (absorbFigureText(defensible, texts) || withBands) defensible.sort(byPlace);
  for (const candidate of defensible) candidate.stretch = regionStretch(candidate.rect, placed);
  return { candidates: defensible, drawingLimit: overflow || clusters === null };
}

// ── Rendering a region ───────────────────────────────────────────────────

/** MuPDF's `fz_round_rect` — outward, with a 0.001 slack — which is how
 *  PyMuPDF turns a clip in points into a pixmap's pixels. */
const roundOut = (r: Rect): Rect => [
  Math.floor(r[0] + 0.001),
  Math.floor(r[1] + 0.001),
  Math.ceil(r[2] - 0.001),
  Math.ceil(r[3] - 0.001),
];

function renderRegion(
  mupdf: Mupdf,
  page: Page,
  pageRect: Rect,
  rect: Rect,
  stretch: number,
  measureOnly = false,
  captionRect: Rect | null = null,
): { png: Uint8Array; width: number; height: number } | null {
  const clip: Rect = [
    Math.max(pageRect[0], rect[0] - CLIP_PADDING),
    Math.max(pageRect[1], rect[1] - CLIP_PADDING),
    Math.min(pageRect[2], rect[2] + CLIP_PADDING),
    Math.min(pageRect[3], rect[3] + CLIP_PADDING),
  ];
  // P12-47 R5a (B P12-39 M5): the padding is for breathing room, not for the caption. When the caption's first line
  // starts inside it, the clip ends 0.5 pt short of the line (and never inside the region); otherwise the 10 pt stay.
  if (captionRect) {
    if (captionRect[1] + captionRect[3] > rect[1] + rect[3]) {
      if (captionRect[1] < clip[3]) clip[3] = Math.max(rect[3], captionRect[1] - CAPTION_CLEARANCE);
    } else if (captionRect[3] > clip[1]) {
      clip[1] = Math.min(rect[1], captionRect[3] + CAPTION_CLEARANCE);
    }
  }
  if (isEmpty(clip) || width(clip) <= 1 || height(clip) <= 1) return null;

  // Un-stretching lengthens the squeezed side rather than shortening the
  // stretched one, so no printed detail is thrown away.
  const [gainX, gainY] = stretch >= 1 ? [1, stretch] : [1 / stretch, 1];
  const pixelsAt = (scale: number) => width(clip) * height(clip) * gainX * gainY * scale ** 2;

  // From the high-DPI default, down in 0.2 steps to the helper's floor of 1.6x.
  let scale = DEFAULT_SCALE;
  while (pixelsAt(scale) > MAX_PIXELS && scale > MIN_SCALE) scale -= 0.2;
  scale = Math.max(MIN_SCALE, scale);
  // Past that floor the helper rendered whatever size the region came to; the
  // ceiling holds here, so a region that large is rendered smaller than 1.6x.
  if (pixelsAt(scale) > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (width(clip) * height(clip) * gainX * gainY)) * 0.995;

  let bbox: Rect;
  for (let attempt = 0; ; attempt++) {
    const device: Rect = [clip[0] * scale * gainX, clip[1] * scale * gainY, clip[2] * scale * gainX, clip[3] * scale * gainY];
    bbox = roundOut(device);
    if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) <= MAX_PIXELS || attempt >= 20) break;
    scale *= 0.99; // rounding outward pushed a capped render a few pixels over
  }
  if (bbox[2] - bbox[0] < 1 || bbox[3] - bbox[1] < 1 || (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > MAX_PIXELS) return null;

  // P10-34: the size the pixmap below would have (it is made with this `bbox`), without drawing it.
  if (measureOnly) return { png: new Uint8Array(0), width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] };

  const matrix: Matrix = [scale * gainX, 0, 0, scale * gainY, 0, 0];
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false);
  try {
    pixmap.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    try {
      page.run(device, matrix);
      device.close();
    } finally {
      device.destroy();
    }
    const png = pixmap.asPNG();
    return png.byteLength ? { png, width: pixmap.getWidth(), height: pixmap.getHeight() } : null;
  } finally {
    pixmap.destroy();
  }
}

// ── The call ─────────────────────────────────────────────────────────────

/** A label's figure number: "Figure 3", "Fig. 3", "3" and "3A" -> "3" / "3a". */
function labelKey(label: string): string | null {
  const match = LABEL_RE.exec(label);
  return match ? match[1].toLowerCase() : null;
}

const captionKey = (caption: string | null): string | null => {
  const match = caption ? CAPTION_RE.exec(caption) : null;
  return match ? match[1].toLowerCase() : null;
};

const roundTo = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Finds the figures of a PDF and renders each one as a PNG.
 *
 * Never throws for a bad document: bytes that are not a PDF, an encrypted one,
 * one over the byte ceiling, or one with nothing to find come back as no
 * figures and a `reason`. It rejects only when the engine itself cannot load.
 */
export async function extractPdfFigures(bytes: Uint8Array, opts: PdfEngineOptions): Promise<PdfEngineResult> {
  const deadline = performance.now() + EXTRACTION_BUDGET_MS;
  const nothing = (reason: string): PdfEngineResult => ({ figures: [], reason });

  if (bytes.byteLength === 0) return nothing("The PDF is empty.");
  if (bytes.byteLength > (opts.onlyPage === undefined ? MAX_PDF_BYTES : MAX_ONE_PAGE_PDF_BYTES)) {
    return nothing("The PDF is too large for Peer to extract its figures safely.");
  }
  const wanted = opts.label === undefined ? null : labelKey(opts.label);
  if (opts.label !== undefined && wanted === null) {
    return nothing(`"${opts.label}" does not name a figure, so Peer looked for no region.`);
  }

  const mupdf = await loadMupdf();
  const release = await acquireSlot();
  try {
    if (performance.now() > deadline) {
      return nothing(`Peer stopped before reading this PDF: other figure work held it for over ${EXTRACTION_BUDGET_MS / 1000} s.`);
    }
    return await readDocument(mupdf, bytes, opts, wanted, deadline);
  } finally {
    release();
  }
}

async function readDocument(
  mupdf: Mupdf,
  bytes: Uint8Array,
  opts: PdfEngineOptions,
  wanted: string | null,
  deadline: number,
): Promise<PdfEngineResult> {
  const figures: PdfEngineFigure[] = [];
  let failure: unknown = null;
  let outOfTime = false;
  let drawingLimit = false;

  let doc: Document;
  // The Buffer is made here, not by openDocument, so that it is destroyed on a
  // failed open too (the document keeps its own reference to the bytes).
  const buffer = new mupdf.Buffer(bytes);
  try {
    doc = mupdf.Document.openDocument(buffer, "application/pdf");
  } catch (error) {
    return { figures, reason: `PDF figure extraction failed: ${errorMessage(error)}` };
  } finally {
    buffer.destroy();
  }
  try {
    if (doc.needsPassword()) {
      return { figures, reason: "The PDF is password-protected, so Peer cannot read its figures." };
    }
    const pageCount = Math.min(doc.countPages(), Math.max(0, opts.maxPages));
    const onlyPage = opts.onlyPage;
    if (onlyPage !== undefined && (onlyPage < 1 || onlyPage > pageCount)) {
      return { figures, reason: `The PDF has no page ${onlyPage} among the first ${pageCount} Peer reads.` };
    }
    const firstIndex = onlyPage === undefined ? 0 : onlyPage - 1;
    const lastIndex = onlyPage === undefined ? pageCount - 1 : onlyPage - 1;

    for (let pageIndex = firstIndex; pageIndex <= lastIndex && figures.length < opts.maxFigures; pageIndex++) {
      if (performance.now() > deadline) {
        outOfTime = true;
        break;
      }
      try {
        const found = readPage(mupdf, doc.loadPage(pageIndex), pageIndex, wanted, opts.maxFigures - figures.length, deadline, opts.measureOnly === true);
        for (const figure of found.figures) figures.push({ ...figure, ordinal: figures.length });
        if (found.outOfTime) outOfTime = true;
        if (found.drawingLimit) drawingLimit = true;
      } catch (error) {
        failure = error; // one unreadable page does not cost the pages after it
      }
      if (outOfTime) break;
      if (wanted !== null && figures.length > 0) break; // the label's page is found
      await yieldToEventLoop();
    }
  } catch (error) {
    failure = error;
  } finally {
    doc.destroy();
  }

  if (outOfTime) {
    const seconds = EXTRACTION_BUDGET_MS / 1000;
    return {
      figures,
      reason: figures.length
        ? `Peer stopped reading this PDF after ${seconds} s, with ${figures.length} figure${figures.length === 1 ? "" : "s"} found so far.`
        : `Peer stopped reading this PDF after ${seconds} s without finding a figure.`,
    };
  }
  if (drawingLimit) return { figures, reason: "Peer reached the drawing analysis limit; vector figures may be missing." };
  if (figures.length) return { figures, reason: null };
  if (failure) return { figures, reason: `PDF figure extraction failed: ${errorMessage(failure)}` };
  if (wanted !== null) {
    return { figures, reason: `Peer opened the PDF, but found no region captioned "${opts.label}"${opts.onlyPage ? ` on page ${opts.onlyPage}` : ""}.` };
  }
  return { figures, reason: NO_FIGURES_REASON };
}

/** One page: its candidate regions (the ones the label names, if any), each
 *  rendered. Destroys the page. */
function readPage(
  mupdf: Mupdf,
  page: Page,
  pageIndex: number,
  wanted: string | null,
  room: number,
  deadline: number,
  measureOnly: boolean,
): { figures: Omit<PdfEngineFigure, "ordinal">[]; outOfTime: boolean; drawingLimit: boolean } {
  const figures: Omit<PdfEngineFigure, "ordinal">[] = [];
  try {
    const bounds = page.getBounds();
    const pageRect: Rect = [bounds[0], bounds[1], bounds[2], bounds[3]];
    const { texts, images } = readPageStructure(page);
    const { candidates, drawingLimit } = candidateRegions(mupdf, page, pageRect, texts, images);
    for (const candidate of candidates) {
      if (figures.length >= room) break;
      if (wanted !== null && captionKey(candidate.caption) !== wanted) continue;
      if (performance.now() > deadline) return { figures, outOfTime: true, drawingLimit };
      let rendered: ReturnType<typeof renderRegion> = null;
      try {
        const captionRect = candidate.captionIndex >= 0 ? texts[candidate.captionIndex].rect : null;
        rendered = renderRegion(mupdf, page, pageRect, candidate.rect, candidate.stretch, measureOnly, captionRect);
      } catch (error) {
        console.warn("[figures/pdf-engine] a region would not render:", error);
      }
      if (!rendered) continue;
      figures.push({
        page: pageIndex + 1,
        caption: candidate.caption ?? "",
        kind: candidate.kind,
        png: rendered.png,
        width: rendered.width,
        height: rendered.height,
        box: [roundTo(candidate.rect[0]), roundTo(candidate.rect[1]), roundTo(candidate.rect[2]), roundTo(candidate.rect[3])],
      });
    }
    return { figures, outOfTime: false, drawingLimit };
  } finally {
    page.destroy();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * P10-34: the picture the figure route would draw for "Figure `fig`" on `page`, measured and not drawn — its
 * width and height in pixels (the PNG's own), or null where the route would find nothing. The same call the
 * route makes (one page, one label), so the size is the route's picture's; nothing is rendered, so it costs
 * the page's analysis and not the render.
 */
export async function measurePdfFigure(
  bytes: Uint8Array,
  page: number,
  fig: number,
): Promise<{ width: number; height: number } | null> {
  const { figures } = await extractPdfFigures(bytes, { maxPages: 300, maxFigures: 1, onlyPage: page, label: `Figure ${fig}`, measureOnly: true });
  const found = figures[0];
  return found && found.width > 0 && found.height > 0 ? { width: found.width, height: found.height } : null;
}
