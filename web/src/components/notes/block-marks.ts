"use client";

// P11-28 (owner item 8: "在选中一段文字以后…再加一个按钮，叫做highlight"; round 1 Theme B readers r1, r2; ruling §1h.123 (c), which amends D8 of §1h.112): the marks of a
// highlight on a Summary block or on an answer.
//
// A highlight on the paper's body is drawn by the body's own paragraphs (`NotedText`, `paper-body.tsx`). A Summary block and the answers are drawn by many components —
// the lead claim, the abstract, the report's blocks (the proposal, the method, the results, …), the claim lists, the answers — that a highlight cannot reach into, and each
// of them keeps its words in its own markup. So the marks are drawn from outside, by a painter every block mounts (`BlockMarks`, which renders nothing), over the words the
// block's element holds:
//
//   1. the block's words are read as a browser reads a selection (`readBlockText`, `lib/notes/anchor-blocks.ts`) — the same reading that gave the highlight its range
//      when it was made, so the range fits;
//   2. each highlight of the paper's note for this block (`spotsForBlock`) finds its words in them: where it stored them while the block still holds them there, else
//      by its quote (`findInBlock`, as a re-read paragraph's note does), else nowhere — a block that does not hold a highlight's words draws no mark, and never marks
//      other words in their place. A highlight whose block is not on the page (an answer after a reload, a Summary before its report is drawn) is whole in the note;
//   3. the words are wrapped in `<mark data-highlight="<id>">`, the element the paper's body draws — its fill the highlight's colour, its words black or white
//      by the higher contrast (`highlightPaint`, ≥ 4.5 : 1 for every preset) — so the colour strip's host, the square's flash and a click on a mark find it as they find
//      the body's. A highlight inside another is a mark inside a mark in the deeper shade, as in the body.
//
// React owns the block's text nodes. The painter never moves one: a text node is split (`splitText`), and only the new pieces go into a mark, so React's node stays
// where React put it; before every paint the words are put back as they were (`unpaintBlock`), and a re-render that writes new words into a node or takes it away is
// met by a block already whole (the painter watches the block, and repaints from the words as they are). It is drawn when the note changes — in the same turn, so the
// strip raised right after a highlight finds its mark — when the block changes, and when the paper's host says which paper is on show (`useBlockPaper`).
//
// Nothing here is stored or sent: the marks are drawn from the paper's note in this browser. A browser's own selection, find and print see the words as they were.

import { useLayoutEffect } from "react";
import {
  readBlockText,
  rawSpanOf,
  type BlockNode,
  type BlockRun,
  type BlockTextEnv,
  type BlockTextNode,
} from "@/lib/notes/anchor-blocks";
import { anchorMap } from "@/lib/notes/blocks";
import { highlightPaint } from "@/lib/notes/highlight-colours";
import type { HighlightColourId, Note } from "@/lib/notes/types";
import { findInBlock, readingNoteFor, repairAnchors, useNotesStore, type AnchorFix } from "@/store/notes";
import { useHighlightStrip } from "./highlight-strip";
import { highlightMarks, useBlockPaper } from "./note-tags";

/** The attribute that marks an element as one the painter made (and so one it takes away); the body's marks do not carry it. */
export const BLOCK_MARK_ATTRIBUTE = "data-block-mark";

/** One highlight of the paper's note, as far as its block's painter needs it. */
export interface MarkSpot {
  /** The highlight's block id in the note. */
  id: string;
  /** The page block it is anchored to (`summary-…`, `answers-block`). */
  paragraphId: string;
  colour: HighlightColourId;
  /** Its place among the note's blocks: of two highlights over the same words the earlier is the outer mark. */
  order: number;
  start: number;
  end: number;
  quote: string;
}

/**
 * The highlights the paper's note keeps for one block, in the order they were made: the paper's own note (`readingNoteFor`), the highlights anchored to `blockId`
 * (`anchorMap`, which reads stored data with care: a malformed one has no spot, an unknown colour reads as yellow), and no sticky.
 */
export function spotsForBlock(notes: Record<string, Note>, paperId: string, blockId: string): MarkSpot[] {
  const spots = anchorMap(readingNoteFor(notes, paperId), paperId)[blockId] ?? [];
  const out: MarkSpot[] = [];
  for (const spot of spots) {
    if (spot.colour === undefined || spot.start === undefined || spot.end === undefined || spot.quote === undefined) continue;
    out.push({ id: spot.id, paragraphId: blockId, colour: spot.colour, order: spot.order ?? 0, start: spot.start, end: spot.end, quote: spot.quote });
  }
  return out;
}

// ── Drawing ───────────────────────────────────────────────────────────────

/** The members of a node the painter writes through; a DOM node is one, and so is a test's stand-in. */
interface PaintNode {
  parentNode: PaintNode | null;
  insertBefore(child: never, ref: never): unknown;
  appendChild(child: never): unknown;
  removeChild(child: never): unknown;
}
interface PaintText extends PaintNode {
  data: string;
  splitText(offset: number): PaintText;
}
/** The `<mark>` the painter makes. */
export interface MarkElement extends PaintNode {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void };
}
/** The block's element, as the painter reads and writes it. */
export type PaintRoot = BlockNode & PaintNode;

export interface PaintEnv extends BlockTextEnv {
  createMark(): MarkElement;
}

/** What `paintBlock` made of the pieces of one text node: React's node, what it held, what it held after the splits, and every node the painter added. */
interface Healing {
  original: PaintText;
  whole: string;
  rest: string;
  added: PaintNode[];
}

const drawn = new WeakMap<object, Healing[]>();

/**
 * Take a block's marks away and put its words back as they were: every node the painter added goes, and React's node gets its whole text again — unless React
 * has written other words into it since (then they are the node's, and the stale pieces only go) or has taken it away (then only the pieces go). Idempotent.
 */
export function unpaintBlock(root: PaintRoot): void {
  const healings = drawn.get(root);
  if (!healings) return;
  drawn.delete(root);
  for (const one of healings) {
    for (const node of one.added) node.parentNode?.removeChild(node as never);
    if (one.original.parentNode && one.original.data === one.rest) one.original.data = one.whole;
  }
}

function markFor(spot: MarkSpot, depth: number, env: PaintEnv): MarkElement {
  const paint = highlightPaint(spot.colour, depth);
  const mark = env.createMark();
  mark.setAttribute("data-highlight", spot.id);
  mark.setAttribute(BLOCK_MARK_ATTRIBUTE, "");
  mark.style.setProperty("background-color", paint.bg);
  mark.style.setProperty("color", paint.ink);
  return mark;
}

/** One highlight's share of a text node: the raw characters `[a, b)`. */
interface Piece {
  a: number;
  b: number;
  spot: MarkSpot;
}

/**
 * Cut one text node at every edge of its pieces and wrap each cut in the marks that cover it — outermost first, the earlier highlight outside, each inner one a deeper
 * shade. The cuts are made from the last to the first, so the offsets of the earlier ones stay true; React's node keeps the words before the first cut.
 */
function wrapNode(node: PaintText, pieces: readonly Piece[], env: PaintEnv): Healing {
  const whole = node.data;
  const edges = [...new Set(pieces.flatMap((one) => [one.a, one.b]))].sort((x, y) => x - y);
  const cuts: { a: number; b: number; cover: MarkSpot[] }[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const [a, b] = [edges[k], edges[k + 1]];
    const cover = pieces.filter((one) => one.a <= a && one.b >= b).map((one) => one.spot).sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
    if (cover.length > 0) cuts.push({ a, b, cover });
  }
  const added: PaintNode[] = [];
  for (let k = cuts.length - 1; k >= 0; k--) {
    const { a, b, cover } = cuts[k];
    const inside = node.splitText(a);
    if (b - a < inside.data.length) added.push(inside.splitText(b - a));
    let outer: MarkElement | null = null;
    let inner: MarkElement | null = null;
    for (let depth = 0; depth < cover.length; depth++) {
      const mark = markFor(cover[depth], depth, env);
      if (inner) inner.appendChild(mark as never);
      else outer = mark;
      inner = mark;
    }
    const parent = inside.parentNode;
    if (!parent || !outer || !inner) continue;
    parent.insertBefore(outer as never, inside as never);
    inner.appendChild(inside as never);
    added.push(outer);
  }
  return { original: node, whole, rest: node.data, added };
}

/**
 * Draw a block's highlights: the block is made whole first, its words are read, each highlight finds its words (`findInBlock`), and they are wrapped in marks. Returns
 * the ids of the highlights that were drawn, for those found somewhere other than where the note stored them the repair the note should be given, and the words that were
 * read (what the block said when it was drawn: the marks change none of them). With nothing to draw and nothing drawn before, the block is not read and not touched.
 */
export function paintBlock(root: PaintRoot, spots: readonly MarkSpot[], env: PaintEnv = domPaintEnv()): { drawn: string[]; fixes: AnchorFix[]; text: string | null } {
  unpaintBlock(root);
  if (spots.length === 0) return { drawn: [], fixes: [], text: null };
  const block = readBlockText(root, env);
  const placed: { spot: MarkSpot; start: number; end: number }[] = [];
  for (const spot of spots) {
    const at = findInBlock(block.text, spot);
    if (at) placed.push({ spot, ...at });
  }
  const pieces = new Map<BlockRun, Piece[]>();
  const done = new Set<string>();
  for (const one of placed) {
    for (const run of block.runs) {
      if (run.to <= one.start || run.from >= one.end) continue;
      const span = rawSpanOf(run, one.start, one.end);
      if (!span) continue;
      const list = pieces.get(run) ?? [];
      list.push({ a: span.start, b: span.end, spot: one.spot });
      pieces.set(run, list);
      done.add(one.spot.id);
    }
  }
  const healings: Healing[] = [];
  for (const [run, list] of pieces) healings.push(wrapNode(run.node as BlockTextNode as unknown as PaintText, list, env));
  if (healings.length > 0) drawn.set(root, healings);
  const fixes: AnchorFix[] = [];
  for (const { spot, start, end } of placed) {
    if (!done.has(spot.id) || (start === spot.start && end === spot.end)) continue;
    fixes.push({ id: spot.id, was: { paragraphId: spot.paragraphId, start: spot.start, end: spot.end }, paragraphId: spot.paragraphId, start, end });
  }
  return { drawn: placed.filter((one) => done.has(one.spot.id)).map((one) => one.spot.id), fixes, text: block.text };
}

// ── Following the note and the block ──────────────────────────────────────

/** What watches a block change: tells `told` after its content changes; `forget` drops the changes the painter itself made. */
export interface BlockWatch {
  stop(): void;
  forget(): void;
}

export interface WatchEnv extends PaintEnv {
  observe(root: PaintRoot, told: () => void): BlockWatch;
}

const signatureOf = (spots: readonly MarkSpot[]) => spots.map((s) => `${s.id}|${s.colour}|${s.start}|${s.end}|${s.quote}`).join("\n");

/**
 * Keep a block's marks true to the paper's note and to the block: draw now; draw again, in the same turn, whenever the note's highlights for this block change (a
 * highlight made, its colour changed from the strip or the notes window, removed — not for a word typed elsewhere in the note); and draw again from the words as they
 * are whenever the block changes under it (the report is drawn, a panel is opened, React writes new words). A highlight found elsewhere than where the note stored it
 * is repaired in the note, so the next load needs no search. Returns how to stop: the marks are taken away and nothing is followed.
 */
export function watchBlock(root: PaintRoot, input: { paperId: string; blockId: string }, env: WatchEnv): () => void {
  let spots: MarkSpot[] = [];
  let signature = "";
  /** The words the block said when it was last drawn; null while nothing is drawn. */
  let said: string | null = null;
  /** The block's watch: held only while the block has a highlight to draw — a block with none costs the page nothing. */
  let watching: BlockWatch | null = null;
  const paint = () => {
    const out = paintBlock(root, spots, env);
    said = out.text;
    // What the painter just changed in the block is no news to it.
    watching?.forget();
    if (out.fixes.length > 0) queueMicrotask(() => repairAnchors(out.fixes));
  };
  // The block changed under the painter. A change that leaves its words as they were — a class on a mark (the flash the square makes), a style — draws nothing again: it
  // would take away the very marks it was about.
  const changed = () => {
    if (said === null || readBlockText(root, env).text !== said) paint();
  };
  const read = (force: boolean) => {
    const next = spotsForBlock(useNotesStore.getState().notes, input.paperId, input.blockId);
    const now = signatureOf(next);
    if (!force && now === signature) return;
    signature = now;
    spots = next;
    if (spots.length > 0 && !watching) watching = env.observe(root, changed);
    paint();
    if (spots.length === 0 && watching) {
      watching.stop();
      watching = null;
    }
  };
  const stopStore = useNotesStore.subscribe(() => read(false));
  read(true);
  return () => {
    stopStore();
    watching?.stop();
    watching = null;
    unpaintBlock(root);
  };
}

// ── The browser ───────────────────────────────────────────────────────────

/** What a drawn formula is: `paper-body.tsx`'s `FORMULA_SELECTOR` (a selection never holds one). */
const FORMULA = ".katex, .katex-display, code";

/** `text` with the first letter of each word in capitals, as a style that capitalises draws it (a letter after a space or a hyphen starts a word; an apostrophe does not). */
function capitalised(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}'\u2019])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/**
 * The page's answers to the text model: an element is a line of its own unless its computed `display` is inline, inline-block and the like, or none or contents; it is
 * hidden when it carries `hidden` or is `display: none`; it is a formula when it is KaTeX's or a `code`; a text node's words are as its style draws them — the Summary's
 * small labels are set in capitals, and a browser's selection reads them as capitals, so the words of the block must be read so too. Without a browser's style (a server, a
 * test) the model's defaults.
 */
export function domTextEnv(): BlockTextEnv {
  if (typeof getComputedStyle !== "function") return {};
  const display = (node: BlockNode) => getComputedStyle(node as unknown as Element).display;
  return {
    isBlock: (node) => !/^(inline|contents|none|ruby)/.test(display(node)),
    isHidden: (node) => (node as unknown as Element).hasAttribute("hidden") || display(node) === "none",
    isFormula: (node) => (node as unknown as Element).matches(FORMULA),
    textOf: (node) => {
      const parent = (node as unknown as Node).parentElement;
      const transform = parent ? getComputedStyle(parent).textTransform : "none";
      if (transform === "uppercase") return node.data.toUpperCase();
      if (transform === "lowercase") return node.data.toLowerCase();
      if (transform === "capitalize") return capitalised(node.data);
      return node.data;
    },
  };
}

/** The painter's environment in the browser: marks are `<mark>` elements, a block is watched by a `MutationObserver`. */
export function domPaintEnv(): WatchEnv {
  return {
    ...domTextEnv(),
    createMark: () => document.createElement("mark") as unknown as MarkElement,
    observe: (root, told) => {
      const observer = new MutationObserver(() => told());
      observer.observe(root as unknown as Node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
      return { stop: () => observer.disconnect(), forget: () => void observer.takeRecords() };
    },
  };
}

// ── A click on a drawn highlight ──────────────────────────────────────────

interface ClickNode {
  nodeType: number;
  parentNode?: ClickNode | null;
  closest?(selector: string): ClickNode | null;
  getAttribute?(name: string): string | null;
}

/**
 * What a click in a block means to a highlight, as in the paper's body (`highlightClickOf`): the id of the highlight whose mark was clicked — the innermost of two —
 * or null. Null for a click that ends a drag (a selection that is not collapsed), for a click on a control inside the mark (a link keeps its own click) and for one
 * on no mark. `selection` is the page's, null when it has none.
 */
export function markClickOf(target: unknown, selection: { isCollapsed: boolean } | null): string | null {
  if (selection && !selection.isCollapsed) return null;
  const node = target as ClickNode | null;
  const element = node ? (node.nodeType === 1 ? node : node.parentNode) : null;
  if (!element?.closest || element.closest("button, a") !== null) return null;
  return element.closest(`mark[${BLOCK_MARK_ATTRIBUTE}]`)?.getAttribute?.("data-highlight") ?? null;
}

// ── The component a block mounts ──────────────────────────────────────────

/**
 * Mounted inside a Summary block's element, or the answers', under the id the selection reports for it: draws the marks of the paper's highlights anchored to it and
 * raises the colour strip when one is clicked. It renders nothing — the block's markup is what it was — and draws only once the page has said which paper is on show.
 */
export function BlockMarks({ id }: { id: string }): null {
  const paperId = useBlockPaper((state) => state.paperId);
  useLayoutEffect(() => {
    if (paperId === null) return;
    const root = document.getElementById(id);
    if (!root) return;
    const stop = watchBlock(root as unknown as PaintRoot, { paperId, blockId: id }, domPaintEnv());
    const onClick = (event: MouseEvent) => {
      const found = markClickOf(event.target, window.getSelection());
      if (found === null) return;
      const mark = root.querySelector(highlightMarks(found));
      const line = mark ? (mark.getClientRects()[0] ?? mark.getBoundingClientRect()) : null;
      if (line) useHighlightStrip.getState().show(found, line.top);
    };
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
      stop();
    };
  }, [id, paperId]);
  return null;
}
