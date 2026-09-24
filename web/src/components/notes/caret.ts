// Where the caret is inside a textarea, measured.
//
// A textarea will not say which visual line its caret is on — only the
// character offset — and a paragraph that wraps has several lines to one
// offset range. So the text up to the caret is copied into an invisible
// mirror with the textarea's own box and type, and the position of a marker
// at its end is read back. Two things need it: ↑/↓ leaving a block only from
// its first or last line (the way Notion moves between blocks), and the "/"
// and "@" menus opening under the caret rather than under the block.

const MIRRORED = [
  "box-sizing",
  "width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "line-height",
  "font-family",
  "font-feature-settings",
  "text-align",
  "text-transform",
  "text-indent",
  "letter-spacing",
  "word-spacing",
  "tab-size",
  "word-break",
  "overflow-wrap",
];

export interface CaretCoords {
  /** From the textarea's top-left border edge, in px. */
  top: number;
  left: number;
  lineHeight: number;
}

export function caretCoords(el: HTMLTextAreaElement, pos: number): CaretCoords {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of MIRRORED) mirror.style.setProperty(prop, style.getPropertyValue(prop));
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  // The rest of the text, so the word under the caret wraps where it does in
  // the textarea; a dot when there is none, so the marker has a box.
  marker.textContent = el.value.slice(pos) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  const coords = { top: marker.offsetTop, left: marker.offsetLeft, lineHeight };
  document.body.removeChild(mirror);
  return coords;
}

/** Whether the caret sits on the textarea's first and/or last visual line. */
export function caretLine(el: HTMLTextAreaElement): { first: boolean; last: boolean } {
  const pos = el.selectionStart;
  const here = caretCoords(el, pos).top;
  const top = caretCoords(el, 0).top;
  const bottom = caretCoords(el, el.value.length).top;
  return { first: here <= top + 1, last: here >= bottom - 1 };
}

/**
 * The caret offset under a point in a block's RENDERED text. Each rendered
 * run carries `data-inner`, the source offset its visible text starts at, so
 * a click on "claim" in **claim** lands after the two asterisks it hides.
 * A click that lands on no text goes to the end.
 */
export function offsetFromPoint(container: HTMLElement, x: number, y: number, length: number): number {
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const doc = document as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || !container.contains(node)) return length;
  const host = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>(
    "[data-inner]",
  );
  if (!host || !container.contains(host)) return length;
  const inner = Number(host.dataset.inner);
  // A citation or a note link is one unit: a click anywhere on it puts the
  // caret after it, never inside its key.
  if (node.nodeType !== Node.TEXT_NODE || host.dataset.atomic !== undefined) return Math.min(length, inner);
  return Math.min(length, inner + offset);
}
