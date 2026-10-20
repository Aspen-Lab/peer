// P11-27 rule 2 (owner items 5 and 8; round 1's walk X-4; ruling §1h.122): the blocks of a section a note or a highlight can be anchored to.
//
// A selection in a figure's caption or in a section's heading is offered Take notes and Highlight, like a paragraph's, so each of them needs an anchor of its
// own. The anchor keeps the shape every consumer already reads — `paper-section-<k>-p<n>` (the notes store's `resolveAnchors`, the notes page's `#hash`, the
// square's `getElementById`, the saved place of the page) — and `n` counts the section's blocks:
//
//   0 .. P − 1     the section's paragraphs (P of them), as it always was;
//   P              the section's heading;
//   P + 1 + k      the caption of the section's k-th figure (the order `ReadingSection.figures` holds them in).
//
// Like a paragraph's id it is positional: a re-read of the paper that adds a paragraph moves the heading's id one on, and the note finds its words again by its
// quote (`resolveAnchors`, which searches the section's blocks as well as its paragraphs). The text of a block is what the page draws: a heading is its words;
// a caption is its label, a middle dot, and its words, and — where the picture is not drawn and the extractor knew the page — the page of the PDF.
//
// Nothing here is per-user, stored or sent: pure functions over the paper's own reading, and the one body the page has on show (`setBodyOnShow`), kept in memory
// so that the notes store can read the words of a block when its caller (the page's `useTakeNote` and `useHighlight`, which know the section's paragraphs
// only) has none to give.

export type AnchorBlockKind = "paragraph" | "heading" | "caption";

/** A figure as far as its caption is concerned (`ReadingFigure` has more). */
export interface AnchorFigure {
  label: string;
  caption?: string;
  imageUrl?: string;
  page?: number;
}

/** A section as far as its anchors are concerned (`ReadingSection` has more). The old shape — paragraphs alone — is one: it has no heading and no figures. */
export interface AnchorSection {
  readonly paragraphs: readonly string[];
  readonly heading?: string;
  readonly figures?: readonly AnchorFigure[];
}

export interface AnchorBlock {
  kind: AnchorBlockKind;
  text: string;
}

const ANCHOR_ID = /^paper-section-(\d+)-p(\d+)$/;

/** The section and the block an anchor id names (`paper-section-<k>-p<n>`), or null for any other id. */
export function parseAnchorId(id: string): { section: number; index: number } | null {
  const match = ANCHOR_ID.exec(id);
  return match ? { section: Number(match[1]), index: Number(match[2]) } : null;
}

/**
 * The words the page draws in a figure's caption: the label, " · " and the caption's words, then " · p.N of the PDF" where there is no picture to draw (no
 * `imageUrl`) and the extractor knew the page. A picture that has a source is drawn: the page is not said (a picture that fails to load shows the page after
 * these words — an unmarked tail, not part of the anchor).
 */
export function captionText(figure: AnchorFigure): string {
  const page = typeof figure.page === "number" && !figure.imageUrl ? ` · p.${figure.page} of the PDF` : "";
  return `${figure.label}${figure.caption ? ` · ${figure.caption}` : ""}${page}`;
}

const isFigure = (value: unknown): value is AnchorFigure => typeof value === "object" && value !== null && typeof (value as AnchorFigure).label === "string";
const figuresOf = (section: AnchorSection): readonly unknown[] => (Array.isArray(section.figures) ? section.figures : []);
/** Whether the section has a heading block: it has one when it says a heading, or has figures (whose ids stand after the heading's slot). */
const hasHeadingSlot = (section: AnchorSection) => section.heading !== undefined || figuresOf(section).length > 0;
const paragraphsOf = (section: AnchorSection): readonly string[] => (Array.isArray(section.paragraphs) ? section.paragraphs : []);

/** The block number of the section's heading: just after its paragraphs. */
export function headingBlock(section: AnchorSection): number {
  return paragraphsOf(section).length;
}

/** The block number of the caption of the section's `k`-th figure. */
export function captionBlock(section: AnchorSection, k: number): number {
  return paragraphsOf(section).length + 1 + k;
}

/**
 * The block `index` of a section: its kind and its words, or undefined where there is none (past the last caption, below 0, not a whole number, no section, a
 * figure that is not one). Reads only the block asked for — a paragraph's own text, and nothing of the others — so resolving an anchor that still holds costs
 * no search.
 */
export function blockAt(section: AnchorSection | undefined, index: number): AnchorBlock | undefined {
  if (!section || !Number.isInteger(index) || index < 0) return undefined;
  const paragraphs = paragraphsOf(section);
  if (index < paragraphs.length) {
    const text = paragraphs[index];
    return typeof text === "string" ? { kind: "paragraph", text } : undefined;
  }
  if (!hasHeadingSlot(section)) return undefined;
  if (index === paragraphs.length) return { kind: "heading", text: typeof section.heading === "string" ? section.heading : "" };
  const figure = figuresOf(section)[index - paragraphs.length - 1];
  return isFigure(figure) ? { kind: "caption", text: captionText(figure) } : undefined;
}

/** Every block of a section, in the order of their numbers: the paragraphs, the heading, the captions — for the search of a note's quote. */
export function anchorBlocks(section: AnchorSection | undefined): AnchorBlock[] {
  if (!section) return [];
  const blocks: AnchorBlock[] = paragraphsOf(section).map((text) => ({ kind: "paragraph", text: typeof text === "string" ? text : "" }));
  if (hasHeadingSlot(section)) blocks.push({ kind: "heading", text: typeof section.heading === "string" ? section.heading : "" });
  for (const figure of figuresOf(section)) blocks.push({ kind: "caption", text: isFigure(figure) ? captionText(figure) : "" });
  return blocks;
}

// ── The body on show ──────────────────────────────────────────────────────

let onShow: readonly AnchorSection[] | null = null;

/** The reading page's body, told by `PaperBody` while it is drawn (and null when it goes). Memory only: nothing is stored, nothing sent. */
export function setBodyOnShow(body: readonly AnchorSection[] | null): void {
  onShow = body;
}

/** The words of the block an anchor id names, in the body on show; undefined with no body, or where the body holds no such block. */
export function anchorTextOnShow(paragraphId: string): string | undefined {
  const at = parseAnchorId(paragraphId);
  return at && onShow ? blockAt(onShow[at.section], at.index)?.text : undefined;
}
