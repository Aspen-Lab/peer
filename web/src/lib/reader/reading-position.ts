// P12-15: ephemeral DOM bookmarks only. No store, persistence, passage copying,
// neighbouring-block fallback, or mutation of Explain's captured provenance.
export interface TextPosition { id: string; offset: number; signature: string }

function signature(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

/** A canonical text offset within the exact existing paper block. */
export function textPosition(node: Node, offset: number, doc: Document): TextPosition | null {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  const block = typeof element?.closest === "function" ? element.closest("#paper-body [id]") : null;
  if (!block?.id || !block.contains(node) || offset < 0) return null;
  try {
    const range = doc.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, offset);
    return { id: block.id, offset: range.toString().length, signature: signature(block.textContent ?? "") };
  } catch { return null; }
}

/** Resolve only the same block and text; a missing/changed anchor is honest null. */
export function resolveTextPosition(point: TextPosition, doc: Document): { node: Text; offset: number } | null {
  const block = doc.getElementById(point.id);
  if (!block || signature(block.textContent ?? "") !== point.signature) return null;
  const walk = doc.createTreeWalker(block, 4 /* SHOW_TEXT */);
  let offset = point.offset, node: Node | null, last: Text | null = null;
  while ((node = walk.nextNode())) {
    const text = node as Text;
    if (offset < text.length) return { node: text, offset };
    offset -= text.length;
    last = text;
  }
  return last && offset === 0 ? { node: last, offset: last.length } : null;
}

export interface ReadingInteraction {
  selection: { anchor: TextPosition; focus: TextPosition } | null;
  field: { id: string; node: HTMLInputElement | HTMLTextAreaElement; start: number; end: number;
    direction: "forward" | "backward" | "none"; signature: string } | null;
}

export function readReadingInteraction(doc: Document): ReadingInteraction {
  const selected = doc.getSelection?.();
  const anchor = selected?.anchorNode && !selected.isCollapsed ? textPosition(selected.anchorNode, selected.anchorOffset, doc) : null;
  const focus = selected?.focusNode && !selected.isCollapsed ? textPosition(selected.focusNode, selected.focusOffset, doc) : null;
  const active = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const field = active?.id && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.selectionStart !== null && active.selectionEnd !== null
    ? { id: active.id, node: active, start: active.selectionStart, end: active.selectionEnd,
      direction: active.selectionDirection ?? "none", signature: signature(active.value) } : null;
  return { selection: anchor && focus ? { anchor, focus } : null, field };
}

/** Called only inside the bounded transaction, never to override newer input. */
export function restoreReadingInteraction(saved: ReadingInteraction, doc: Document): void {
  const selection = doc.getSelection?.();
  if (saved.selection && selection) {
    const anchor = resolveTextPosition(saved.selection.anchor, doc), focus = resolveTextPosition(saved.selection.focus, doc);
    if (anchor && focus && (selection.anchorNode !== anchor.node || selection.anchorOffset !== anchor.offset ||
      selection.focusNode !== focus.node || selection.focusOffset !== focus.offset)) {
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    }
  }
  const savedField = saved.field;
  if (!savedField) return;
  const current = doc.getElementById(savedField.id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!current || !/^(INPUT|TEXTAREA)$/.test(current.tagName) || signature(current.value) !== savedField.signature) return;
  // Stable portal editors are already focused: never refocus or reset their caret.
  if (doc.activeElement === current) return;
  if (doc.activeElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement) return;
  current.focus({ preventScroll: true });
  current.setSelectionRange(savedField.start, savedField.end, savedField.direction);
}
