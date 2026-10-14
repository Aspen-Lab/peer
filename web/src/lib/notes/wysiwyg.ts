// P10-16 (B16, the owner's ruling §1h.90 (a)): a note is what-you-see-is-what-you-get. A reader sees the words of a
// block as the read view draws them — bold, italic, underline, highlight, code, a citation as "(Rose et al., 2024)" —
// and edits them there, never a `**`, `__`, `==` or backtick. The STORED format is unchanged (those marks are the
// storage and the `.md` export; that is what Markdown is). This file is the two directions between the two:
//
//   source ──treeOf──▶ tree ──mountInline──▶ DOM            the block's source drawn as the formatted text
//   DOM ──readTree──▶ tree ──serializeTree──▶ source        the edited DOM written back, losslessly
//
// and the coordinates that go with them. A block has three: the SOURCE offset (what the store and `markEdit` speak),
// the PLAIN offset (the visible characters; a citation or link counts as its label) and a DOM position. The reader's
// selection is a DOM position; it is mapped to a plain offset, which does not change when marks are added or taken
// off — so a mark can be laid over the words that are selected and the same words stay selected (BACKLOG-79).
//
// No DOM global is used except through the arguments, so the logic runs under the test runner (which has no DOM)
// against a small stand-in (`test-support/fake-dom.ts`); the browser's `Selection` is touched only in the two
// functions at the end.
//
// The dialect (inline.ts) has no escape: a delimiter typed or pasted as characters is read as a mark on the next
// render, as stored text is. And a mark is only written where the dialect can read it back — `serializeTree` checks
// that every mark it writes survives a parse, and drops (never shows) the ones that would not.

import { MARKERS, isWrapping, markEdit, parseInline, type MarkName } from "./inline";

export type Label = (key: string) => string;
const identity: Label = (key) => key;

// ── The tree ──────────────────────────────────────────────────────────────

export interface WText {
  kind: "text";
  text: string;
  /** Where this text sits in the block's source: `[from, to)`. */
  from: number;
  to: number;
}
export interface WMark {
  kind: "mark";
  mark: MarkName;
  kids: WNode[];
  /** Italic is written `*x*` or `_x_`; the one it was read with is kept (`_x_` is how it sits inside bold). */
  delim?: "*" | "_";
  /** The mark with its markers `[from, to)`; its content `[inner, close)`. */
  from: number;
  inner: number;
  close: number;
  to: number;
}
export interface WChip {
  kind: "chip";
  chip: "cite" | "wiki" | "link" | "url";
  /** What the chip is in the source — `[@key]`, `[[Title]]`, `[text](url)` — kept whole, never edited inside. */
  src: string;
  /** What the reader sees. */
  label: string;
  from: number;
  to: number;
}
export type WNode = WText | WMark | WChip;

/** A block's source as a tree; every text node knows its place in the source. */
export function treeOf(src: string, label: Label = identity, base = 0): WNode[] {
  const out: WNode[] = [];
  for (const t of parseInline(src)) {
    const from = base + t.from;
    const to = base + t.to;
    if (t.kind === "text") out.push({ kind: "text", text: t.text, from, to });
    else if (isWrapping(t)) {
      const inner = base + t.inner;
      out.push({
        kind: "mark",
        mark: t.kind,
        kids: treeOf(t.text, label, inner),
        delim: t.kind === "em" ? (src[t.from] === "_" ? "_" : "*") : undefined,
        from,
        inner,
        close: inner + t.text.length,
        to,
      });
    } else if (t.kind === "code") {
      const inner = base + t.inner;
      out.push({
        kind: "mark",
        mark: "code",
        kids: [{ kind: "text", text: t.text, from: inner, to: inner + t.text.length }],
        from,
        inner,
        close: inner + t.text.length,
        to,
      });
    } else if (t.kind === "cite") {
      out.push({ kind: "chip", chip: "cite", src: src.slice(t.from, t.to), label: `(${t.keys.map(label).join("; ")})`, from, to });
    } else if (t.kind === "wiki") {
      out.push({ kind: "chip", chip: "wiki", src: src.slice(t.from, t.to), label: t.target, from, to });
    } else if (t.kind === "link" || t.kind === "url") {
      out.push({ kind: "chip", chip: t.kind, src: src.slice(t.from, t.to), label: t.text, from, to });
    }
  }
  return out;
}

/** The visible characters of a tree. */
export function plainOfTree(nodes: readonly WNode[]): string {
  return nodes.map((n) => (n.kind === "text" ? n.text : n.kind === "chip" ? n.label : plainOfTree(n.kids))).join("");
}

/** The visible characters of a block's source — what `plainInline` says, with a citation as the label gives it. */
export function plainOfSource(src: string, label: Label = identity): string {
  return plainOfTree(treeOf(src, label));
}

interface Leaf {
  node: WText | WChip;
  /** The marks around this leaf, outermost first. */
  marks: MarkName[];
  /** The same marks as nodes, to tell two leaves in one mark from two in marks of the same kind. */
  chain: WMark[];
  /** Plain offsets `[p, q)` this leaf covers. */
  p: number;
  q: number;
}
function leavesOf(nodes: readonly WNode[], chain: WMark[] = [], out: Leaf[] = []): Leaf[] {
  for (const n of nodes) {
    if (n.kind === "mark") leavesOf(n.kids, [...chain, n], out);
    else {
      const p = out.length > 0 ? out[out.length - 1].q : 0;
      const len = n.kind === "text" ? n.text.length : n.label.length;
      if (len > 0) out.push({ node: n, marks: chain.map((m) => m.mark), chain, p, q: p + len });
    }
  }
  return out;
}

/** The leaf a plain offset belongs to. `start`: the character at `p` begins in it (the start of a selection); `end`:
 *  the character before `p` ends in it (the end of a selection; a caret takes the format of what it follows, so the
 *  end of a bold word is inside the bold and the start of one is not). */
function leafAt(leaves: readonly Leaf[], p: number, side: "start" | "end"): Leaf | undefined {
  if (leaves.length === 0) return undefined;
  const last = leaves[leaves.length - 1];
  if (side === "start") return leaves.find((l) => p >= l.p && p < l.q) ?? last;
  return p <= 0 ? leaves[0] : leaves.find((l) => p > l.p && p <= l.q) ?? last;
}

/** The source offset of a plain offset (see `leafAt` for the sides). A citation is one unit: inside it, its nearer edge. */
export function sourceOfPlain(tree: readonly WNode[], p: number, side: "start" | "end" = "end"): number {
  const leaves = leavesOf(tree);
  const hit = leafAt(leaves, p, side);
  if (!hit) return 0;
  const off = Math.max(0, Math.min(p - hit.p, hit.q - hit.p));
  if (hit.node.kind === "chip") return off * 2 < hit.q - hit.p ? hit.node.from : hit.node.to;
  return hit.node.from + off;
}

/** The plain offset of a source offset: an offset inside a marker is the nearer edge of the text beside it. */
export function plainOfSourceOffset(tree: readonly WNode[], s: number): number {
  const leaves = leavesOf(tree);
  let prev: Leaf | undefined;
  for (const l of leaves) {
    if (s < l.node.from) {
      if (!prev) return l.p;
      return s - prev.node.to <= l.node.from - s ? prev.q : l.p;
    }
    if (s <= l.node.to) {
      if (l.node.kind === "chip") return (s - l.node.from) * 2 < l.node.to - l.node.from ? l.p : l.q;
      return l.p + (s - l.node.from);
    }
    prev = l;
  }
  return leaves.length > 0 ? leaves[leaves.length - 1].q : 0;
}

/** A tree cut to the plain range `[from, to)`: the marks around the cut stay around what is left; an empty mark goes. */
export function sliceTree(nodes: readonly WNode[], from: number, to: number): WNode[] {
  const out: WNode[] = [];
  let at = 0;
  for (const n of nodes) {
    const len = plainOfTree([n]).length;
    const lo = Math.max(from - at, 0);
    const hi = Math.min(to - at, len);
    if (hi > lo) {
      if (n.kind === "text") out.push({ ...n, text: n.text.slice(lo, hi) });
      else if (n.kind === "chip") {
        if (lo === 0 && hi === len) out.push(n);
      } else {
        const kids = sliceTree(n.kids, lo, hi);
        if (kids.length > 0) out.push({ ...n, kids });
      }
    }
    at += len;
  }
  return out;
}

// ── The tree, normalised and written ──────────────────────────────────────

const WORD = /[\p{L}\p{N}_]/u;
const WORD_RUN_START = /^[\p{L}\p{N}_]+/u;
const WORD_RUN_END = /[\p{L}\p{N}_]+$/u;

const text = (s: string): WText => ({ kind: "text", text: s, from: 0, to: 0 });
const blank = { from: 0, inner: 0, close: 0, to: 0 };

/** Everything the dialect needs of a tree before it can be written: no empty or doubled text, no empty mark, a mark
 *  of one kind never directly inside or beside another of the same kind, a mark's edge spaces outside it (`** a **`
 *  does not read as bold), no mark across a line break, underline across whole words, code as one literal run. */
function normalize(nodes: readonly WNode[]): WNode[] {
  const flat: WNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "mark") flat.push(n);
    else flat.push(...normalizeMark(n));
  }
  // joined: text beside text, a mark beside a mark of its kind (its content is settled again)
  const joined: WNode[] = [];
  const merged = new Set<WNode>();
  for (const n of flat) {
    const last = joined[joined.length - 1];
    if (n.kind === "text") {
      if (n.text === "") continue;
      if (last?.kind === "text") joined[joined.length - 1] = text(last.text + n.text);
      else joined.push(n);
    } else if (n.kind === "mark" && last?.kind === "mark" && last.mark === n.mark && n.mark !== "code") {
      const both: WMark = { ...last, kids: [...last.kids, ...n.kids] };
      merged.delete(last);
      merged.add(both);
      joined[joined.length - 1] = both;
    } else joined.push(n);
  }
  const settled = joined.flatMap((n) => (merged.has(n) && n.kind === "mark" ? normalizeMark(n) : [n]));
  return grow(settled);
}

function normalizeMark(m: WMark): WNode[] {
  if (m.mark === "code") {
    const literal = plainOfTree(m.kids);
    if (literal === "") return [];
    if (/[`\n]/.test(literal) || literal.trim() !== literal) return [text(literal)];
    return [{ ...m, kids: [text(literal)], ...blank }];
  }
  // the same mark inside itself is the one mark
  const kids = normalize(m.kids.flatMap((k) => (k.kind === "mark" && k.mark === m.mark ? k.kids : [k])));
  if (kids.length === 0) return [];
  // a line break ends the mark: each line is marked on its own
  const lines: WNode[][] = [[]];
  for (const k of kids) {
    if (k.kind === "text" && k.text.includes("\n")) {
      k.text.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push(text(part));
      });
    } else lines[lines.length - 1].push(k);
  }
  const out: WNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(text("\n"));
    out.push(...wrapLine(m, line));
  });
  return out;
}

/** One line of a mark's content, its edge spaces hoisted out. */
function wrapLine(m: WMark, line: WNode[]): WNode[] {
  const body = line.slice();
  let lead = "";
  let trail = "";
  if (body[0]?.kind === "text") {
    lead = body[0].text.match(/^\s*/)?.[0] ?? "";
    body[0] = text(body[0].text.slice(lead.length));
  }
  const last = body[body.length - 1];
  if (last?.kind === "text") {
    trail = last.text.match(/\s*$/)?.[0] ?? "";
    body[body.length - 1] = text(last.text.slice(0, last.text.length - trail.length));
  }
  const kids = body.filter((k) => !(k.kind === "text" && k.text === ""));
  if (kids.length === 0) return lead || trail ? [text(lead + trail)] : [];
  return [...(lead ? [text(lead)] : []), { ...m, kids, ...blank }, ...(trail ? [text(trail)] : [])];
}

/** Underline is only read across whole words (`a__lp__ha` does not parse): a word-letter beside an underlined run
 *  joins it, as `markEdit` grows a selection to the whole word. Only for text beside it in the same list; where the
 *  letter is elsewhere, the serialiser leaves the underline off rather than show its delimiters. */
function grow(nodes: WNode[]): WNode[] {
  const out = nodes.slice();
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.kind !== "mark" || n.mark !== "underline") continue;
    const next = out[i + 1];
    const tail = n.kids[n.kids.length - 1];
    if (next?.kind === "text" && tail?.kind === "text") {
      const run = next.text.match(WORD_RUN_START)?.[0];
      if (run && WORD.test(tail.text.slice(-1))) {
        out[i] = { ...n, kids: [...n.kids.slice(0, -1), text(tail.text + run)] };
        out[i + 1] = text(next.text.slice(run.length));
      }
    }
    const prev = out[i - 1];
    const cur = out[i] as WMark;
    const head = cur.kids[0];
    if (prev?.kind === "text" && head?.kind === "text") {
      const run = prev.text.match(WORD_RUN_END)?.[0];
      if (run && WORD.test(head.text[0] ?? "")) {
        out[i] = { ...cur, kids: [text(run + head.text), ...cur.kids.slice(1)] };
        out[i - 1] = text(prev.text.slice(0, prev.text.length - run.length));
      }
    }
  }
  return out.filter((n) => !(n.kind === "text" && n.text === ""));
}

interface Written {
  s: string;
  nodes: WNode[];
}

function shifted(nodes: readonly WNode[], by: number): WNode[] {
  if (by === 0) return nodes.slice();
  return nodes.map((n) =>
    n.kind === "mark"
      ? { ...n, kids: shifted(n.kids, by), from: n.from + by, inner: n.inner + by, close: n.close + by, to: n.to + by }
      : { ...n, from: n.from + by, to: n.to + by },
  );
}

function containsMark(nodes: readonly WNode[], mark: MarkName): boolean {
  return nodes.some((n) => n.kind === "mark" && (n.mark === mark || containsMark(n.kids, mark)));
}

/** The source of a normalised list, with each node's place in it. `inStrong`: italic inside bold is written `_x_`
 *  (bold's content cannot hold a star). `dropped`: marks left unwritten (the repair, below). */
function write(nodes: readonly WNode[], inStrong: boolean, dropped: ReadonlySet<WMark>): Written {
  let s = "";
  const out: WNode[] = [];
  const push = (w: Written) => {
    out.push(...shifted(w.nodes, s.length));
    s += w.s;
  };
  for (const n of nodes) {
    if (n.kind === "text") push({ s: n.text, nodes: [{ ...n, from: 0, to: n.text.length }] });
    else if (n.kind === "chip") push({ s: n.src, nodes: [{ ...n, from: 0, to: n.src.length }] });
    else push(writeMark(n, inStrong, dropped));
  }
  return { s, nodes: out };
}

function writeMark(m: WMark, inStrong: boolean, dropped: ReadonlySet<WMark>): Written {
  const bare = (): Written => write(m.kids, inStrong, dropped);
  if (dropped.has(m)) return bare();
  if (m.mark === "code") {
    const literal = m.kids[0]?.kind === "text" ? m.kids[0].text : "";
    const s = `\`${literal}\``;
    return { s, nodes: [{ ...m, kids: [{ kind: "text", text: literal, from: 1, to: 1 + literal.length }], from: 0, inner: 1, close: 1 + literal.length, to: s.length }] };
  }
  const wrap = (marker: string, inner: Written, delim?: "*" | "_"): Written => {
    const s = marker + inner.s + marker;
    return {
      s,
      nodes: [{ ...m, delim, kids: shifted(inner.nodes, marker.length), from: 0, inner: marker.length, close: marker.length + inner.s.length, to: s.length }],
    };
  };
  // Each mark's content cannot hold its own delimiter character (`[^*\n]`, `[^_\n]`, `[^=\n]`): where it does, the
  // mark is not written.
  if (m.mark === "strong") {
    const inner = write(m.kids, true, dropped);
    return inner.s.includes("*") ? bare() : wrap("**", inner);
  }
  if (m.mark === "underline") {
    const inner = write(m.kids, inStrong, dropped);
    return inner.s.includes("_") ? bare() : wrap("__", inner);
  }
  if (m.mark === "mark") {
    const inner = write(m.kids, inStrong, dropped);
    return inner.s.includes("=") ? bare() : wrap("==", inner);
  }
  // italic: a star where the dialect can read it, else an underscore (inside bold, or around it)
  const starOk = !inStrong && !containsMark(m.kids, "strong");
  const choices: ("*" | "_")[] = starOk ? (m.delim === "_" ? ["_", "*"] : ["*", "_"]) : ["_"];
  const inner = write(m.kids, inStrong, dropped);
  for (const d of choices) if (!inner.s.includes(d)) return wrap(d, inner, d);
  return bare();
}

/** Run lengths of the marks over each visible character, for "does the source still say what the tree says". */
function runs(nodes: readonly WNode[], kinds: string[] = [], out: { n: number; k: string }[] = []): { n: number; k: string }[] {
  const add = (n: number, k: string) => {
    if (n === 0) return;
    const last = out[out.length - 1];
    if (last && last.k === k) last.n += n;
    else out.push({ n, k });
  };
  for (const node of nodes) {
    if (node.kind === "text") add(node.text.length, kinds.slice().sort().join("+"));
    else if (node.kind === "chip") add(1, "chip");
    else runs(node.kids, [...kinds, node.mark], out);
  }
  return out;
}

const withChipsAsOne = (nodes: readonly WNode[]): string =>
  nodes.map((n) => (n.kind === "text" ? n.text : n.kind === "chip" ? "￼" : withChipsAsOne(n.kids))).join("");

/** Whether every mark the tree carries is still carried by the same characters of `src`. Extra marks the source makes
 *  are no loss (that is a delimiter typed as text, read as a mark), and a source that reads as different words is not
 *  judged here: the editor draws the surface again from it. */
function survives(src: string, tree: readonly WNode[]): boolean {
  const parsed = treeOf(src);
  if (withChipsAsOne(parsed) !== withChipsAsOne(tree)) return true;
  const want = runs(tree);
  const got = runs(parsed);
  let i = 0;
  let j = 0;
  let a = want[0]?.n ?? 0;
  let b = got[0]?.n ?? 0;
  while (i < want.length && j < got.length) {
    const take = Math.min(a, b);
    const need = want[i].k === "" ? [] : want[i].k.split("+");
    const have = got[j].k === "" ? [] : got[j].k.split("+");
    if (!need.every((k) => have.includes(k))) return false;
    a -= take;
    b -= take;
    if (a === 0) a = want[++i]?.n ?? 0;
    if (b === 0) b = got[++j]?.n ?? 0;
  }
  return true;
}

function marksOf(nodes: readonly WNode[], out: WMark[] = []): WMark[] {
  for (const n of nodes) {
    if (n.kind === "mark") {
      out.push(n);
      marksOf(n.kids, out);
    }
  }
  return out;
}

/**
 * A tree written as the block's source. The tree is normalised first; every mark written is checked to survive a
 * parse (underline needs whole words, italic and bold cannot hold each other's stars...) and the ones that would not
 * are left unwritten, underline first — a mark is lost before a delimiter is ever shown. `tree` is the normalised
 * tree with each node's place in `src`.
 */
export function serializeTree(nodes: readonly WNode[]): { src: string; tree: WNode[] } {
  const norm = normalize(nodes);
  let w = write(norm, false, new Set());
  if (norm.some((n) => n.kind === "mark") && !survives(w.s, w.nodes)) {
    const order: MarkName[] = ["underline", "em", "strong", "mark", "code"];
    const candidates = marksOf(norm).sort((x, y) => order.indexOf(x.mark) - order.indexOf(y.mark));
    const dropped = new Set<WMark>();
    for (const c of candidates) {
      dropped.add(c);
      w = write(norm, false, dropped);
      if (survives(w.s, w.nodes)) break;
    }
  }
  return { src: w.s, tree: w.nodes };
}

/** A source written again in the canonical spelling (a doubled mark is one, a mark's edge spaces are outside it). */
export function canonical(src: string, label: Label = identity): string {
  return serializeTree(treeOf(src, label)).src;
}

// ── Drawing a tree as DOM ─────────────────────────────────────────────────

const TAG: Record<MarkName, string> = { strong: "strong", em: "em", underline: "u", mark: "mark", code: "code" };

/** The read view's look for each mark (inline-text.tsx), so the block being edited does not move a line. */
export const MARK_CLASS: Record<MarkName, string> = {
  strong: "font-semibold text-heading",
  em: "",
  underline: "underline-offset-[3px]",
  mark: "bg-accent/20 px-px text-heading",
  code: "font-mono text-[0.86em] bg-bg-secondary/70 px-1",
};
const CHIP_CLASS: Record<WChip["chip"], string> = {
  cite: "text-text-muted underline decoration-dotted decoration-border-strong decoration-1 underline-offset-[3px]",
  wiki: "text-text-muted underline decoration-dashed decoration-border-strong decoration-1 underline-offset-[3px]",
  link: "underline decoration-border-strong decoration-1 underline-offset-[3px]",
  url: "underline decoration-border-strong decoration-1 underline-offset-[3px]",
};

/** `data-chip` marks a citation, link or note link; `data-pad` the `<br>` that lets the last line be a blank one. */
export const CHIP_ATTR = "data-chip";
export const PAD_ATTR = "data-pad";

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}
function isText(n: Node): n is Text {
  return n.nodeType === 3;
}
function isChip(n: Node): boolean {
  return isElement(n) && n.getAttribute(CHIP_ATTR) !== null;
}

function build(doc: Document, nodes: readonly WNode[], parent: Node): void {
  for (const n of nodes) {
    if (n.kind === "text") parent.appendChild(doc.createTextNode(n.text));
    else if (n.kind === "chip") {
      const el = doc.createElement("span");
      el.setAttribute("contenteditable", "false");
      el.setAttribute(CHIP_ATTR, n.chip);
      el.setAttribute("data-src", n.src);
      el.className = CHIP_CLASS[n.chip];
      el.appendChild(doc.createTextNode(n.label));
      parent.appendChild(el);
    } else {
      const el = doc.createElement(TAG[n.mark]);
      if (MARK_CLASS[n.mark]) el.className = MARK_CLASS[n.mark];
      if (n.delim === "_") el.setAttribute("data-d", "_");
      build(doc, n.kids, el);
      parent.appendChild(el);
    }
  }
}

/** The block's tree drawn into `root`, replacing what it holds. */
export function mountInline(doc: Document, root: Node, tree: readonly WNode[]): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  build(doc, tree, root);
  padRoot(doc, root);
}

/** The last text (not empty) or chip the surface holds, in document order. */
function lastLeaf(parent: Node): Node | null {
  for (let i = parent.childNodes.length - 1; i >= 0; i--) {
    const c = parent.childNodes[i];
    if (isText(c)) {
      if (c.data !== "") return c;
    } else if (isElement(c)) {
      if (isChip(c)) return c;
      if (c.nodeName === "BR") continue;
      const inner = lastLeaf(c);
      if (inner) return inner;
    }
  }
  return null;
}

/** A last line that is blank (the text ends in a line break, or in a citation) needs a `<br>` to be drawn and to take a caret. */
export function padRoot(doc: Document, root: Node): void {
  const old = root.lastChild;
  if (old && isElement(old) && old.getAttribute(PAD_ATTR) !== null) root.removeChild(old);
  const tail = lastLeaf(root);
  if (tail && ((isText(tail) && tail.data.endsWith("\n")) || (isElement(tail) && isChip(tail)))) {
    const br = doc.createElement("br");
    br.setAttribute(PAD_ATTR, "");
    root.appendChild(br);
  }
}

// ── Reading the DOM ───────────────────────────────────────────────────────

const MARK_OF_TAG: Record<string, MarkName> = { STRONG: "strong", B: "strong", EM: "em", I: "em", U: "underline", INS: "underline", MARK: "mark", CODE: "code" };

/** A `<br>` is a line break unless it is a pad, or the placeholder a browser leaves as the root's last child. */
function ignoredBr(n: Node, root: Node): boolean {
  return isElement(n) && n.nodeName === "BR" && (n.getAttribute(PAD_ATTR) !== null || (n.parentNode === root && root.lastChild === n));
}

/** The DOM of an editing surface as a tree: the marks it carries, the text between, a chip as the source it carries.
 *  An element the dialect has no name for (a browser's `<span style>`, a pasted `<div>`) is only its text. */
export function readTree(root: Node): WNode[] {
  const read = (parent: Node): WNode[] => {
    const out: WNode[] = [];
    for (let i = 0; i < parent.childNodes.length; i++) {
      const n = parent.childNodes[i];
      if (isText(n)) out.push(text(n.data));
      else if (isElement(n)) {
        if (isChip(n)) {
          const src = n.getAttribute("data-src") ?? "";
          out.push({ kind: "chip", chip: (n.getAttribute(CHIP_ATTR) as WChip["chip"]) || "link", src, label: n.textContent ?? "", from: 0, to: src.length });
        } else if (n.nodeName === "BR") {
          if (!ignoredBr(n, root)) out.push(text("\n"));
        } else {
          const mark = MARK_OF_TAG[n.nodeName];
          if (mark) out.push({ kind: "mark", mark, kids: read(n), delim: n.getAttribute("data-d") === "_" ? "_" : undefined, ...blank });
          else out.push(...read(n));
        }
      }
    }
    return out;
  };
  return read(root);
}

/** The edited DOM written back as the block's source — the inverse of `mountInline`. */
export function serializeInline(root: Node): string {
  return serializeTree(readTree(root)).src;
}

/** What the surface holds now: its source, the normalised tree with each text's place in it, and the visible text. */
export function snapshot(root: Node): { src: string; tree: WNode[]; plain: string } {
  const { src, tree } = serializeTree(readTree(root));
  return { src, tree, plain: plainOfTree(tree) };
}

/** Does the source read as other words than the DOM it was written from — a delimiter typed as characters that the
 *  dialect now reads as a mark? Then the surface is drawn again from the source. */
export function readsDifferently(src: string, plain: string, label: Label = identity): boolean {
  return plainOfSource(src, label) !== plain;
}

// ── DOM positions and plain offsets ───────────────────────────────────────

function lenOf(n: Node, root: Node): number {
  if (isText(n)) return n.data.length;
  if (!isElement(n)) return 0;
  if (isChip(n)) return (n.textContent ?? "").length;
  if (n.nodeName === "BR") return ignoredBr(n, root) ? 0 : 1;
  let total = 0;
  for (let i = 0; i < n.childNodes.length; i++) total += lenOf(n.childNodes[i], root);
  return total;
}

function inside(n: Node, container: Node): boolean {
  for (let at: Node | null = container; at; at = at.parentNode) if (at === n) return true;
  return false;
}

/** The plain offset of a DOM position `(container, offset)` in `root`. A position inside a chip is the chip's edge. */
export function plainAt(root: Node, container: Node, offset: number): number {
  const before = (n: Node): number | null => {
    if (n === container) {
      if (isText(n)) return Math.min(offset, n.data.length);
      if (isElement(n) && isChip(n)) return offset > 0 ? lenOf(n, root) : 0;
      let acc = 0;
      for (let i = 0; i < Math.min(offset, n.childNodes.length); i++) acc += lenOf(n.childNodes[i], root);
      return acc;
    }
    if (isText(n)) return null;
    if (isElement(n) && isChip(n)) {
      if (!inside(n, container)) return null;
      return isText(container) && offset === 0 ? 0 : lenOf(n, root);
    }
    let acc = 0;
    for (let i = 0; i < n.childNodes.length; i++) {
      const r = before(n.childNodes[i]);
      if (r !== null) return acc + r;
      acc += lenOf(n.childNodes[i], root);
    }
    return null;
  };
  return before(root) ?? 0;
}

export interface DomPosition {
  node: Node;
  offset: number;
}

function indexIn(n: Node): number {
  const parent = n.parentNode;
  if (!parent) return 0;
  for (let i = 0; i < parent.childNodes.length; i++) if (parent.childNodes[i] === n) return i;
  return 0;
}

/** The DOM position of a plain offset (`start` / `end` as in `leafAt`: inside the text that begins / ends there). */
export function positionAt(root: Node, p: number, side: "start" | "end" = "end"): DomPosition {
  const leaves: { node: Node; p: number; q: number }[] = [];
  let at = 0;
  const walk = (n: Node) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      const len = lenOf(c, root);
      if (isText(c) || (isElement(c) && (isChip(c) || c.nodeName === "BR"))) {
        if (len > 0) leaves.push({ node: c, p: at, q: at + len });
        at += len;
      } else if (isElement(c)) walk(c);
    }
  };
  walk(root);
  if (leaves.length === 0) return { node: root, offset: 0 };
  const total = leaves[leaves.length - 1].q;
  const x = Math.max(0, Math.min(p, total));
  const last = leaves[leaves.length - 1];
  const hit =
    side === "start"
      ? leaves.find((l) => x >= l.p && x < l.q) ?? last
      : x === 0
        ? leaves[0]
        : leaves.find((l) => x > l.p && x <= l.q) ?? last;
  const off = Math.max(0, Math.min(x - hit.p, hit.q - hit.p));
  if (isText(hit.node)) return { node: hit.node, offset: off };
  const parent = hit.node.parentNode ?? root;
  const idx = indexIn(hit.node);
  return { node: parent, offset: off * 2 < hit.q - hit.p ? idx : idx + 1 };
}

// ── The browser's selection ───────────────────────────────────────────────

/** The reader's selection in `root`, as plain offsets; null when it is not inside. */
export function getPlainSelection(root: Node): { from: number; to: number } | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const a = plainAt(root, sel.anchorNode, sel.anchorOffset);
  const b = plainAt(root, sel.focusNode, sel.focusOffset);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Puts the selection over the plain range, the same words whatever marks now wrap them. */
export function setPlainSelection(root: Node, from: number, to: number = from): void {
  const sel = window.getSelection();
  if (!sel) return;
  const a = positionAt(root, from, from === to ? "end" : "start");
  const b = from === to ? a : positionAt(root, to, "end");
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** How many visible characters the surface holds. */
export function plainLength(root: Node): number {
  return lenOf(root, root);
}

/** The box of the character at plain offset `p` (else of the one before it), or null where the surface draws nothing. */
function rectAtPlain(root: HTMLElement, p: number): DOMRect | null {
  const total = plainLength(root);
  const measure = (a: number, b: number): DOMRect | null => {
    const range = document.createRange();
    const from = positionAt(root, a, "start");
    const to = a === b ? from : positionAt(root, b, "end");
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    for (const rect of Array.from(range.getClientRects())) if (rect.height > 0) return rect;
    return null;
  };
  return (p < total ? measure(p, p + 1) : null) ?? (p > 0 ? measure(p - 1, p) : null) ?? measure(p, p);
}

/** Where a menu opens: the character at plain offset `p`, from the surface's top-left corner. */
export function caretBox(root: HTMLElement, p: number): { top: number; left: number; lineHeight: number } {
  const box = root.getBoundingClientRect();
  const rect = rectAtPlain(root, p);
  const lineHeight = parseFloat(getComputedStyle(root).lineHeight) || rect?.height || 24;
  return rect ? { top: rect.top - box.top, left: rect.left - box.left, lineHeight } : { top: 0, left: 0, lineHeight };
}

/** Whether the caret sits on the surface's first and/or last visual line. */
export function caretLines(root: HTMLElement): { first: boolean; last: boolean } {
  const sel = getPlainSelection(root);
  if (!sel) return { first: true, last: true };
  const total = plainLength(root);
  const here = rectAtPlain(root, sel.from)?.top;
  const top = rectAtPlain(root, 0)?.top;
  const bottom = rectAtPlain(root, total)?.top;
  if (here === undefined || top === undefined || bottom === undefined) return { first: true, last: true };
  return { first: here <= top + 1, last: here >= bottom - 1 };
}

// ── Editing the source by plain offsets ───────────────────────────────────

/** A block's source cut at the selection: the part before `from` and the part after `to`, each with the marks that
 *  were around the cut closed on its own side (`**al|pha**` splits into `**al**` and `**pha**`). */
export function splitSource(src: string, from: number, to: number = from, label: Label = identity): { head: string; tail: string } {
  const tree = treeOf(src, label);
  const total = plainOfTree(tree).length;
  return { head: serializeTree(sliceTree(tree, 0, from)).src, tail: serializeTree(sliceTree(tree, to, total)).src };
}

/** Two blocks' sources as one; the plain offset of the join and its source offset. */
export function joinSources(a: string, b: string, label: Label = identity): { text: string; caret: number; plain: number } {
  const first = treeOf(a, label);
  const plain = plainOfTree(first).length;
  const { src, tree } = serializeTree([...first, ...treeOf(b, label)]);
  return { text: src, caret: sourceOfPlain(tree, plain, "end"), plain };
}

/** A source with `[from, to)` (source offsets) replaced by `insert` (source), written through the tree so a mark the
 *  edit lands in stays whole (`**foo @ba**` + a citation is `**foo** [@key]`, never `**foo [@key] **`). The new
 *  source and the plain offset after what was inserted. */
export function spliceSource(src: string, from: number, to: number, insert: string, label: Label = identity): { text: string; plain: number } {
  const tree = treeOf(src, label);
  const total = plainOfTree(tree).length;
  const a = plainOfSourceOffset(tree, from);
  const b = plainOfSourceOffset(tree, to);
  const mid = treeOf(insert, label);
  return { text: serializeTree([...sliceTree(tree, 0, a), ...mid, ...sliceTree(tree, b, total)]).src, plain: a + plainOfTree(mid).length };
}

/** The marks around the character a caret at plain offset `p` follows (at 0, the first character). */
export function marksAt(src: string, p: number, label: Label = identity): MarkName[] {
  return leafAt(leavesOf(treeOf(src, label)), p, "end")?.marks ?? [];
}

/** The marks still open at plain offset `p`: those around both the character before it and the one after. Text typed
 *  there, after the reader has just closed a mark by typing its delimiter, wears these and not the one just closed. */
export function marksOpenAt(src: string, p: number, label: Label = identity): MarkName[] {
  const leaves = leavesOf(treeOf(src, label));
  const before = leaves.find((l) => l.q === p);
  const after = leaves.find((l) => l.p === p);
  if (!before || !after) return [];
  const open: MarkName[] = [];
  for (let i = 0; i < before.chain.length && before.chain[i] === after.chain[i]; i++) open.push(before.chain[i].mark);
  return open;
}

/** `typed` put in at plain offset `p` wearing the marks `want`: the cut at `p` closes the marks around it and the
 *  text is wrapped in `want` (outermost first). The new source, and the plain offset after the text. */
export function insertMarked(src: string, p: number, typed: string, want: readonly MarkName[], label: Label = identity): { text: string; plain: number } {
  const tree = treeOf(src, label);
  const total = plainOfTree(tree).length;
  let piece: WNode[] = [text(typed)];
  for (const mark of [...want].reverse()) piece = [{ kind: "mark", mark, kids: piece, ...blank }];
  const next = serializeTree([...sliceTree(tree, 0, p), ...piece, ...sliceTree(tree, p, total)]);
  return { text: next.src, plain: p + typed.length };
}

/**
 * `markEdit` over a selection given as plain offsets — the words the reader selected in the formatted text. The dialect
 * cannot read italic and bold written together with stars (`***x***` is `*`, bold `x`, `*`): that is spelled `**_x_**`
 * here. `null` when the edit would leave a delimiter unmatched or would show a delimiter as text: nothing is written.
 */
export function markSource(src: string, from: number, to: number, mark: MarkName, label: Label = identity): { text: string } | null {
  const words = plainOfSource(src, label);
  const run = (s: string, em: "*" | "_"): string | null => {
    const tree = treeOf(s, label);
    const a = sourceOfPlain(tree, from, "start");
    const b = sourceOfPlain(tree, to, "end");
    // `markEdit` writes italic with MARKERS.em; for the one call it is the underscore where stars cannot be read
    const saved = MARKERS.em;
    MARKERS.em = em;
    let edit: ReturnType<typeof markEdit>;
    try {
      edit = markEdit(s, a, b, mark);
    } finally {
      MARKERS.em = saved;
    }
    if (edit.from === edit.to && edit.text === "" && edit.caret !== edit.from) return null;
    const next = s.slice(0, edit.from) + edit.text + s.slice(edit.to);
    if (plainOfSource(next, label) === words) return next;
    const fixed = next.replace(/\*\*\*([^*\n]+)\*\*\*/, "**_$1_**");
    return plainOfSource(fixed, label) === words ? fixed : null;
  };
  const attempt = (s: string): string | null => run(s, "*") ?? (mark === "em" ? run(s, "_") : null);
  const done = attempt(src);
  if (done !== null) return { text: done };
  const respelled = respellEms(src, label);
  const retry = respelled !== src ? attempt(respelled) : null;
  if (retry !== null) return { text: retry };
  // Last: the mark around the words themselves, innermost (italic inside bold-and-underline has no spelling around them)
  const around = serializeTree(wrapRange(treeOf(src, label), from, to, mark)).src;
  return around !== src && plainOfSource(around, label) === words && survivesMark(around, mark) ? { text: around } : null;
}

/** The tree with `mark` laid directly round the plain range `[from, to)`, as deep as the range allows. */
export function wrapRange(nodes: readonly WNode[], from: number, to: number, mark: MarkName): WNode[] {
  let at = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const len = plainOfTree([n]).length;
    if (n.kind === "mark" && from >= at && to <= at + len && len > 0) {
      const out = nodes.slice();
      out[i] = { ...n, kids: wrapRange(n.kids, from - at, to - at, mark) };
      return out;
    }
    at += len;
  }
  const total = plainOfTree(nodes).length;
  return [...sliceTree(nodes, 0, from), { kind: "mark", mark, kids: sliceTree(nodes, from, to), ...blank }, ...sliceTree(nodes, to, total)];
}

/** Does `src` read with at least one `mark` in it? */
function survivesMark(src: string, mark: MarkName): boolean {
  const has = (nodes: readonly WNode[]): boolean => nodes.some((n) => n.kind === "mark" && (n.mark === mark || has(n.kids)));
  return has(treeOf(src));
}

/** Italic written with stars, respelled with underscores wherever the dialect still reads it (`*x*` → `_x_`): it can
 *  then take bold around it, or sit inside it, which stars cannot. */
function respellEms(src: string, label: Label): string {
  let out = src;
  const walk = (nodes: readonly WNode[]) => {
    for (const n of nodes) {
      if (n.kind !== "mark") continue;
      if (n.mark === "em" && n.delim !== "_") {
        const next = out.slice(0, n.from) + "_" + out.slice(n.from + 1, n.to - 1) + "_" + out.slice(n.to);
        if (plainOfSource(next, label) === plainOfSource(out, label) && survives(next, treeOf(out, label))) out = next;
      }
      walk(n.kids);
    }
  };
  walk(treeOf(src, label));
  return out;
}

// ── Undo ──────────────────────────────────────────────────────────────────

/** A block's source and the selection (plain offsets) at a moment of its editing. */
export interface HistoryState {
  text: string;
  from: number;
  to: number;
}
export interface History {
  states: HistoryState[];
  at: number;
  kind: string;
  time: number;
}

const HISTORY_LIMIT = 200;
/** Typing within this long of the last keystroke is one step to undo, as in a word processor. */
export const HISTORY_GAP_MS = 1000;

export function newHistory(state: HistoryState): History {
  return { states: [state], at: 0, kind: "", time: 0 };
}

/** The history after `state` was reached by an edit of `kind` at `now`: typing, or deleting, in a run is one step,
 *  anything else (a mark, a menu pick, a split) a step of its own; going back and editing drops what was ahead.
 *  `was` is the selection just before this edit — what undoing it gives back — set on the state it leaves. */
export function recordState(
  h: History,
  state: HistoryState,
  kind: "type" | "delete" | "edit",
  now: number,
  was?: { from: number; to: number },
  gap = HISTORY_GAP_MS,
): History {
  const kept = h.states.slice(0, h.at + 1);
  if (kept[kept.length - 1].text === state.text) {
    kept[kept.length - 1] = state;
    return { ...h, states: kept };
  }
  if (kind !== "edit" && h.kind === kind && now - h.time < gap && kept.length > 1) {
    kept[kept.length - 1] = state;
    return { states: kept, at: kept.length - 1, kind, time: now };
  }
  if (was) kept[kept.length - 1] = { ...kept[kept.length - 1], ...was };
  kept.push(state);
  const states = kept.length > HISTORY_LIMIT ? kept.slice(kept.length - HISTORY_LIMIT) : kept;
  return { states, at: states.length - 1, kind, time: now };
}

/** One step back: the state to show and the history that now stands there; null at the first state. */
export function stepBack(h: History): { history: History; state: HistoryState } | null {
  if (h.at <= 0) return null;
  const at = h.at - 1;
  return { history: { ...h, at, kind: "", time: 0 }, state: h.states[at] };
}

export function stepForward(h: History): { history: History; state: HistoryState } | null {
  if (h.at >= h.states.length - 1) return null;
  const at = h.at + 1;
  return { history: { ...h, at, kind: "", time: 0 }, state: h.states[at] };
}
