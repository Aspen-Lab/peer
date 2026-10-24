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

// ── The page's own blocks (P11-28) ────────────────────────────────────────
//
// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c), which amends D8 of §1h.112): a Summary block and the answers are blocks a highlight is
// anchored to as a paragraph is — Highlight is offered on them, with and without a key. They are not paragraphs of the paper. The page draws their words from many
// components (the report's blocks, the claim lists, the answers), so a block's words are not data this module can be handed: they are what the block's element
// holds, read the way a browser reads a selection — the text nodes, white space collapsed to one space, a line of its own for each block-level element — and a
// highlight's range is a range of those words. The ids are the ones the selection reports for a block (`SUMMARY_ID` in `paper-words.tsx`, `ANSWERS_BLOCK_ID`).
//
// Nothing here is stored, sent or per-user: pure functions over a tree of nodes, written against the few members they read (so a test can stand in for them).

/** The ids of the Summary's blocks begin with this (`paper-words.tsx`'s `SUMMARY_ID`). They stand only under the "Summary" tab. */
export const SUMMARY_ID_PREFIX = "summary-";
/** The answers under the question: one block, `for-your-questions.tsx`'s section. It stands under both tabs (the common slot). */
export const ANSWERS_BLOCK_ID = "answers-block";

/**
 * Whether `id` names a block of the page that is not a paragraph of the paper: a Summary block (`summary-…`) or the answers' block. The bare kind a selection is
 * reported under when its block has no id of its own ("summary", "answer") is none of them — there is no element to read the words of.
 */
export function isPageBlockId(id: unknown): id is string {
  return typeof id === "string" && (id === ANSWERS_BLOCK_ID || (id.startsWith(SUMMARY_ID_PREFIX) && id.length > SUMMARY_ID_PREFIX.length));
}

/** The members of a DOM node the text model reads; a DOM node is one, and so is a test's stand-in. */
export interface BlockNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: ArrayLike<BlockNode>;
}

/** A text node, as far as the model reads it. */
export type BlockTextNode = BlockNode & { data: string };

/**
 * What the model needs to know of the page that a bare tree cannot say. Each is optional: the defaults are the tag's (an inline element is one of the
 * phrasing tags, an element is hidden when it carries `hidden`, nothing is a formula), the browser's own answer is the computed style (`block-marks.ts`).
 */
export interface BlockTextEnv {
  /** The element starts and ends a line of its own (a selection reads a line break there). */
  isBlock?: (element: BlockNode) => boolean;
  /** The element draws nothing: its words are not on the page, so not the block's. */
  isHidden?: (element: BlockNode) => boolean;
  /** The element is a drawn formula: a selection never holds one, and its text is not prose, so it stands as one mark no words match. */
  isFormula?: (element: BlockNode) => boolean;
  /**
   * The words a text node draws, where the page draws them other than the markup holds them — a style that sets them in capitals (the Summary's small labels do), which a
   * browser's selection reads as capitals. Used only when it has as many characters as the node's data, so a character's place in the node stays true.
   */
  textOf?: (node: BlockTextNode) => string;
}

/** One text node's share of the block's words. */
export interface BlockRun {
  node: BlockTextNode;
  /** Where the node's first character stands in the words, and just after its last. */
  from: number;
  to: number;
  /** For each character of the node (by its raw index): where it stands in the words, or −1 when it was white space that collapsed into the one before it. */
  emit: number[];
}

/** A block's words, and the text nodes they came from, in order. */
export interface BlockText {
  text: string;
  runs: BlockRun[];
}

/** What is never a block's words: what a browser draws nothing for, and what a selection reader leaves out (a superscript is a tag's, `wordsWithoutTags`). */
const NOT_WORDS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SUP"]);
/** The phrasing elements: they run on in their line. Every other element is a line of its own, the way a browser's own text reading counts it. */
const INLINE = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "BUTTON", "CITE", "CODE", "DATA", "DEL", "DFN", "EM", "I", "IMG", "INPUT", "INS", "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SELECT", "SMALL", "SPAN", "STRONG", "SUB", "TEXTAREA", "TIME", "U", "VAR", "WBR",
]);

const defaultIsBlock = (element: BlockNode) => !INLINE.has(element.nodeName.toUpperCase());
const defaultIsHidden = (element: BlockNode) => (element as { getAttribute?: (name: string) => string | null }).getAttribute?.("hidden") != null;

/**
 * The words of a block: its text nodes in order, each run of white space one space, one space where a block-level element begins or ends (never at the block's start or
 * end, never doubled), and nothing for what is not words (`NOT_WORDS`, hidden elements); a formula is one `\u0000`, which no word matches. Reads the tree and changes nothing.
 * `runs` says where each text node's characters stand, so a range of the words can be put back into the nodes (`rawSpanOf`) and a point of the page taken into the words
 * (`boundaryOf`). The same function reads the block when a highlight is made and when its mark is drawn, so the one range fits both.
 */
export function readBlockText(root: BlockNode, env: BlockTextEnv = {}): BlockText {
  const isBlock = env.isBlock ?? defaultIsBlock;
  const isHidden = env.isHidden ?? defaultIsHidden;
  const isFormula = env.isFormula ?? (() => false);
  const chars: string[] = [];
  const runs: BlockRun[] = [];
  /** A block-level element has begun or ended since the last word: one space stands before the next. */
  let gap = false;
  const last = () => chars[chars.length - 1];
  const settleGap = () => {
    if (gap && chars.length > 0 && last() !== " ") chars.push(" ");
    gap = false;
  };

  const readText = (node: BlockTextNode) => {
    const raw = typeof node.data === "string" ? node.data : "";
    const drawn = env.textOf?.(node);
    const data = typeof drawn === "string" && drawn.length === raw.length ? drawn : raw;
    const emit: number[] = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (/\s/.test(data[i])) {
        if (chars.length === 0 || last() === " ") {
          emit[i] = -1;
          continue;
        }
        gap = false;
        emit[i] = chars.length;
        chars.push(" ");
      } else {
        settleGap();
        emit[i] = chars.length;
        chars.push(data[i]);
      }
    }
    const kept = emit.filter((at) => at >= 0);
    if (kept.length > 0) runs.push({ node, from: kept[0], to: kept[kept.length - 1] + 1, emit });
  };

  const walk = (node: BlockNode) => {
    if (node.nodeType === 3) {
      readText(node as BlockTextNode);
      return;
    }
    if (node.nodeType !== 1) return;
    if (NOT_WORDS.has(node.nodeName.toUpperCase()) || isHidden(node)) return;
    // A line break is a line of its own for a selection, though it holds no words.
    if (node.nodeName.toUpperCase() === "BR") {
      gap = true;
      return;
    }
    const block = isBlock(node);
    if (isFormula(node)) {
      if (block) gap = true;
      settleGap();
      chars.push("\u0000");
      if (block) gap = true;
      return;
    }
    if (block) gap = true;
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    if (block) gap = true;
  };
  for (let i = 0; i < root.childNodes.length; i++) walk(root.childNodes[i]);
  return { text: chars.join(""), runs };
}

/**
 * Where a boundary between two characters of a text node stands in the block's words: the place of the first character at or after it that the words kept, or
 * just after the node's last one. `raw` is an offset into the node's data (what a range's `startOffset` is).
 */
export function boundaryOf(run: BlockRun, raw: number): number {
  for (let i = Math.max(0, raw); i < run.emit.length; i++) if (run.emit[i] >= 0) return run.emit[i];
  return run.to;
}

/**
 * The part of the words `[start, end)` that lies in this text node, as offsets into its data — from the first character the range holds to just after the last — or null
 * when the range holds none of its characters. A range that starts before the node or ends after it takes the node from its start or to its end.
 */
export function rawSpanOf(run: BlockRun, start: number, end: number): { start: number; end: number } | null {
  let first = -1;
  let after = -1;
  for (let i = 0; i < run.emit.length; i++) {
    const at = run.emit[i];
    if (at < start || at >= end) continue;
    if (first < 0) first = i;
    after = i + 1;
  }
  return first >= 0 && after > first ? { start: first, end: after } : null;
}

/** The members of a live `Range` the hint reads. */
export interface RangeStart {
  startContainer: unknown;
  startOffset: number;
  comparePoint(node: never, offset: number): number;
}

/**
 * Where in the block's words the reader's selection began (`range` is the selection's range; `block` is `readBlockText` of the block it is in) — the hint that tells the
 * occurrence the reader selected from an earlier one of the same words, as a paragraph's `offset` does (`locatePassage`). Undefined when the range cannot tell (a
 * point it cannot compare, no range): the hint is only a hint, and the first occurrence stands without it.
 */
export function selectionStartIn(block: BlockText, range: RangeStart | null | undefined): number | undefined {
  if (!range) return undefined;
  try {
    for (const run of block.runs) {
      const length = run.node.data.length;
      // The node ends before the range starts: the start is further on.
      if (range.comparePoint(run.node as never, length) < 0) continue;
      // The range starts inside this node: at its own offset there (a text node is the container of every point inside it).
      if (range.comparePoint(run.node as never, 0) < 0) return boundaryOf(run, range.startContainer === run.node ? range.startOffset : length);
      // It starts before this node, between nodes: at this node's first word.
      return boundaryOf(run, 0);
    }
    return block.text.length;
  } catch {
    return undefined;
  }
}
