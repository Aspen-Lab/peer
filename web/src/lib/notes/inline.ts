// Inline Markdown in a note block, as tokens that remember where they came
// from in the source.
//
// A block is edited as its source and read rendered (the Logseq model: the
// block under the caret shows its Markdown, the rest show the result). The
// source positions are what let a click on rendered text land the caret on
// the same character in the source — without them every click would jump to
// the end of the block.
//
// The dialect is deliberately small — what a draft needs and nothing a
// renderer elsewhere would read differently:
//   **strong**  *em* / _em_  `code`  [text](https://…)  bare https:// links
//   __underline__  ==highlight==   (P10-09b, review 7.6: the notes window's toolbar writes these;
//                       they nest — `**__both__**` — and every export reads them)
//   [@key] / [@a; @b]   a citation (Pandoc)
//   [[Title]]           a link to another note (Obsidian)

export type Inline =
  | { kind: "text" | "strong" | "em" | "underline" | "mark" | "code"; text: string; from: number; inner: number; to: number }
  | { kind: "link"; text: string; href: string; from: number; inner: number; to: number }
  | { kind: "url"; text: string; href: string; from: number; inner: number; to: number }
  | { kind: "cite"; keys: string[]; from: number; to: number }
  | { kind: "wiki"; target: string; from: number; to: number };

const CODE = /`([^`\n]+)`/y;
const STRONG = /\*\*(?=\S)([^*\n]*?\S)\*\*/y;
const EM_STAR = /\*(?=[^\s*])([^*\n]*?[^\s*])\*/y;
const EM_UNDER = /(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/uy;
const UNDERLINE = /(?<![\p{L}\p{N}_])__(?=[^\s_])([^_\n]*?[^\s_])__(?![\p{L}\p{N}_])/uy;
const MARK = /==(?=[^\s=])([^=\n]*?[^\s=])==/y;
const CITE = /\[@([^\]\n]+)\]/y;
const WIKI = /\[\[([^\]\n]+)\]\]/y;
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y;
const BARE_URL = /(?<![\p{L}\p{N}])https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/uy;

/** Keys inside `[@a; @b]` — each must look like a key, or the bracket is text. */
function citeKeys(body: string): string[] | null {
  const keys = body.split(/\s*;\s*/).map((k) => k.trim());
  if (keys.some((k) => !/^@[\w:.-]+$/.test(k))) return null;
  return keys.map((k) => k.slice(1));
}

function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

function tokenAt(src: string, i: number): Inline | null {
  const c = src[i];
  let m: RegExpExecArray | null;
  if (c === "`" && (m = at(CODE, src, i))) {
    return { kind: "code", text: m[1], from: i, inner: i + 1, to: i + m[0].length };
  }
  if (c === "*") {
    if ((m = at(STRONG, src, i))) {
      return { kind: "strong", text: m[1], from: i, inner: i + 2, to: i + m[0].length };
    }
    if ((m = at(EM_STAR, src, i))) {
      return { kind: "em", text: m[1], from: i, inner: i + 1, to: i + m[0].length };
    }
  }
  if (c === "_") {
    if ((m = at(UNDERLINE, src, i))) {
      return { kind: "underline", text: m[1], from: i, inner: i + 2, to: i + m[0].length };
    }
    if ((m = at(EM_UNDER, src, i))) {
      return { kind: "em", text: m[1], from: i, inner: i + 1, to: i + m[0].length };
    }
  }
  if (c === "=" && (m = at(MARK, src, i))) {
    return { kind: "mark", text: m[1], from: i, inner: i + 2, to: i + m[0].length };
  }
  if (c === "[") {
    if ((m = at(CITE, src, i))) {
      const keys = citeKeys(`@${m[1]}`);
      if (keys) return { kind: "cite", keys, from: i, to: i + m[0].length };
    }
    if ((m = at(WIKI, src, i))) {
      return { kind: "wiki", target: m[1].trim(), from: i, to: i + m[0].length };
    }
    if ((m = at(LINK, src, i))) {
      return { kind: "link", text: m[1], href: m[2], from: i, inner: i + 1, to: i + m[0].length };
    }
  }
  if (c === "h" && (m = at(BARE_URL, src, i))) {
    return { kind: "url", text: m[0], href: m[0], from: i, inner: i, to: i + m[0].length };
  }
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const token = tokenAt(src, i);
    if (!token) {
      i++;
      continue;
    }
    if (i > start) out.push({ kind: "text", text: src.slice(start, i), from: start, inner: start, to: i });
    out.push(token);
    i = token.to;
    start = i;
  }
  if (start < src.length) {
    out.push({ kind: "text", text: src.slice(start), from: start, inner: start, to: src.length });
  }
  return out;
}

/** The marks that wrap other inline text: their `text` is parsed again. */
export function isWrapping(t: Inline): t is Inline & { kind: "strong" | "em" | "underline" | "mark"; text: string } {
  return t.kind === "strong" || t.kind === "em" || t.kind === "underline" || t.kind === "mark";
}

/** Every key a block's text cites, in order, repeats included. */
export function citedIn(src: string): string[] {
  return parseInline(src).flatMap((t) => (t.kind === "cite" ? t.keys : isWrapping(t) ? citedIn(t.text) : []));
}

/** The block's words without their markup — for an excerpt or a search. A
 *  citation reads as the resolver says, or as its key. The marks (bold, italic,
 *  underline, highlight) are dropped, nested ones too. */
export function plainInline(src: string, cite: (key: string) => string = (k) => k): string {
  return parseInline(src)
    .map((t) =>
      t.kind === "cite"
        ? `(${t.keys.map(cite).join("; ")})`
        : t.kind === "wiki"
          ? t.target
          : isWrapping(t)
            ? plainInline(t.text, cite)
            : t.text,
    )
    .join("");
}

// ── The toolbar's edits ───────────────────────────────────────────────────

export type MarkName = "strong" | "em" | "underline" | "mark" | "code";

/** The markers each mark is written with; the same on both sides. */
export const MARKERS: Record<MarkName, string> = { strong: "**", em: "*", underline: "__", mark: "==", code: "`" };

/** An edit of a block's source: replace `[from, to)` with `text`, then the caret at `caret`. */
export interface MarkEdit {
  from: number;
  to: number;
  text: string;
  caret: number;
}

/**
 * What pressing a mark's button (or key) does to the selection `[start, end)` of `src`: wrap it in the mark's
 * markers, or — when it is already wrapped, with the markers just outside or inside the selection — take them off.
 * A selection's edge spaces stay outside the markers (`** word **` would not read as bold), and with nothing
 * selected the pair is written and the caret left between.
 */
export function markEdit(src: string, start: number, end: number, mark: MarkName): MarkEdit {
  const m = MARKERS[mark];
  let a = Math.min(start, end);
  let b = Math.max(start, end);
  while (a < b && /\s/.test(src[a])) a++;
  while (b > a && /\s/.test(src[b - 1])) b--;
  if (a === b) {
    // Nothing selected, or only spaces: the pair goes at the selection's end, empty — or, with the caret
    // already between its own markers, comes out again.
    const at = Math.max(start, end);
    const between = start === end && src.slice(at - m.length, at) === m && src.slice(at, at + m.length) === m;
    if (between && !beyond(src, at - m.length, at + m.length, m)) {
      return { from: at - m.length, to: at + m.length, text: "", caret: at - m.length };
    }
    return { from: at, to: at, text: m + m, caret: at + m.length };
  }
  const inner = src.slice(a, b);
  if (src.slice(a - m.length, a) === m && src.slice(b, b + m.length) === m && !beyond(src, a - m.length, b + m.length, m)) {
    return { from: a - m.length, to: b + m.length, text: inner, caret: a - m.length + inner.length };
  }
  if (inner.length > 2 * m.length && inner.startsWith(m) && inner.endsWith(m) && !beyond(src, a, b, m)) {
    const bare = inner.slice(m.length, inner.length - m.length);
    return { from: a, to: b, text: bare, caret: a + bare.length };
  }
  return { from: a, to: b, text: `${m}${inner}${m}`, caret: a + inner.length + m.length * 2 };
}

/** Italic's single star is the edge of bold's double: a star beyond the markers means they are part of a longer run. */
function beyond(src: string, from: number, to: number, m: string): boolean {
  return m === "*" && (src[from - 1] === "*" || src[to] === "*" || src[from + 1] === "*" || src[to - 2] === "*");
}
