import type { PassageSegment } from "./types";
import { boundaryOf, readBlockText, type BlockTextEnv } from "./anchor-blocks";

export type DrawableSegment = PassageSegment & { paragraphText: string };
export type DrawableRange = { segments: DrawableSegment[]; reason?: undefined } | { segments: []; reason: string };
const CONTROL = "button,a,input,textarea,select,summary,label,[role=button],[role=tab],[role=link],[contenteditable=true],[data-explain-skip]";
const FORMULA = ".katex,.katex-display,code";

function owner(node: Text): { root: Element; paragraphId: string; source: "paper" | "summary" | "answer"; kind?: PassageSegment["kind"] } | null {
  const el = node.parentElement;
  if (!el || el.closest(CONTROL)) return null;
  if (el.closest("#paper-body")) {
    const heading = el.closest('[data-anchor-block="heading"]');
    if (heading?.id) return { root: heading, paragraphId: heading.id, source: "paper", kind: "heading" };
    const caption = el.closest("figcaption");
    if (caption?.parentElement?.id) return { root: caption, paragraphId: caption.parentElement.id, source: "paper", kind: "caption" };
    const p = el.closest("p");
    if (p?.parentElement?.id.match(/^paper-section-\d+-p\d+$/)) return { root: p, paragraphId: p.parentElement.id, source: "paper", kind: "paragraph" };
    return null;
  }
  const container = el.closest("[data-explain-source]");
  const source = container?.getAttribute("data-explain-source");
  if (!container || (source !== "summary" && source !== "answer")) return null;
  let root = el;
  while (root.parentElement && root.parentElement !== container) root = root.parentElement;
  const paragraphId = root.getAttribute("data-explain-id") || root.id || container.getAttribute("data-explain-id") || container.id;
  return paragraphId ? { root: root.id || root.getAttribute("data-explain-id") ? root : container, paragraphId, source } : null;
}

/** Reads real DOM ranges only. Every selected non-whitespace character must belong to drawable prose. */
export function drawableSegments(range: Range, env: BlockTextEnv = {}): DrawableRange {
  const no = (reason: string): DrawableRange => ({ segments: [], reason });
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return no("Select text in the current paper.");
  const doc = range.startContainer.ownerDocument;
  if (!doc || range.endContainer.ownerDocument !== doc) return no("Select text in one paper.");
  const walker = doc.createTreeWalker(range.commonAncestorContainer, 4);
  const nodes: Text[] = [];
  if (range.commonAncestorContainer.nodeType === 3) nodes.push(range.commonAncestorContainer as Text);
  else for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const groups = new Map<Element, { at: NonNullable<ReturnType<typeof owner>>; nodes: { node: Text; lo: number; hi: number }[] }>();
  try {
    for (const node of nodes) {
      if (!range.intersectsNode(node)) continue;
      const lo = range.startContainer === node ? range.startOffset : 0;
      const hi = range.endContainer === node ? range.endOffset : node.length;
      if (hi <= lo || range.comparePoint(node, hi) < 0 || range.comparePoint(node, lo) > 0) continue;
      if (node.parentElement?.closest("sup")) continue;
      if (!node.data.slice(lo, hi).trim()) continue;
      if (node.parentElement?.closest(FORMULA)) return no("Formula selections cannot be highlighted. Select the surrounding text separately.");
      if (node.parentElement?.closest("[hidden],[aria-hidden=true]")) continue;
      const at = owner(node);
      if (!at) return no("Select paper text without controls or unrelated content.");
      let group = groups.get(at.root);
      if (!group) { group = { at, nodes: [] }; groups.set(at.root, group); }
      group.nodes.push({ node, lo, hi });
    }
    const segments: DrawableSegment[] = [];
    for (const { at, nodes: selected } of groups.values()) {
      const model = readBlockText(at.root, env);
      const picked = new Map(selected.map((s) => [s.node, s]));
      let start = Infinity;
      let end = -1;
      for (const run of model.runs) {
        const selected = picked.get(run.node as Text);
        if (!selected) continue;
        start = Math.min(start, boundaryOf(run, selected.lo));
        end = Math.max(end, boundaryOf(run, selected.hi));
      }
      while (start < end && /\s/.test(model.text[start])) start++;
      while (end > start && /\s/.test(model.text[end - 1])) end--;
      if (!(end > start)) return no("This selection has no drawable words.");
      const quote = model.text.slice(start, end);
      if (quote.includes("\u0000")) return no("Formula selections cannot be highlighted. Select the surrounding text separately.");
      // Paper offsets use raw source text; page-block offsets use the existing collapsed text model.
      let paragraphText = model.text;
      if (at.source === "paper") {
        const raw = doc.createTreeWalker(at.root, 4);
        let text = "";
        let first = -1;
        let last = -1;
        for (let node = raw.nextNode(); node; node = raw.nextNode()) {
          if ((node as Text).parentElement?.closest("sup")) continue;
          const selection = picked.get(node as Text);
          if (selection) { if (first < 0) first = text.length + selection.lo; last = text.length + selection.hi; }
          text += (node as Text).data;
        }
        start = first; end = last; paragraphText = text;
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
      }
      segments.push({ paragraphId: at.paragraphId, source: at.source, ...(at.kind ? { kind: at.kind } : {}), quote, start, end, paragraphText });
    }
    return segments.length ? { segments } : no("Select text in the paper to highlight it.");
  } catch { return no("This selection changed. Select the text again."); }
}
