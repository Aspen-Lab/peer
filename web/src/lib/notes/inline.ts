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
//   [@key] / [@a; @b]   a citation (Pandoc)
//   [[Title]]           a link to another note (Obsidian)

export type Inline =
  | { kind: "text" | "strong" | "em" | "code"; text: string; from: number; inner: number; to: number }
  | { kind: "link"; text: string; href: string; from: number; inner: number; to: number }
  | { kind: "url"; text: string; href: string; from: number; inner: number; to: number }
  | { kind: "cite"; keys: string[]; from: number; to: number }
  | { kind: "wiki"; target: string; from: number; to: number };

const CODE = /`([^`\n]+)`/y;
const STRONG = /\*\*(?=\S)([^*\n]*?\S)\*\*/y;
const EM_STAR = /\*(?=[^\s*])([^*\n]*?[^\s*])\*/y;
const EM_UNDER = /(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/uy;
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
  if (c === "_" && (m = at(EM_UNDER, src, i))) {
    return { kind: "em", text: m[1], from: i, inner: i + 1, to: i + m[0].length };
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

/** Every key a block's text cites, in order, repeats included. */
export function citedIn(src: string): string[] {
  return parseInline(src).flatMap((t) => (t.kind === "cite" ? t.keys : []));
}

/** The block's words without their markup — for an excerpt or a search. A
 *  citation reads as the resolver says, or as its key. */
export function plainInline(src: string, cite: (key: string) => string = (k) => k): string {
  return parseInline(src)
    .map((t) =>
      t.kind === "cite"
        ? `(${t.keys.map(cite).join("; ")})`
        : t.kind === "wiki"
          ? t.target
          : t.text,
    )
    .join("");
}
