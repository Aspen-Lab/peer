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

/** A token of the block's source with its place, nested ones included: what the edit has to see to nest a mark. */
interface Span {
  kind: Inline["kind"];
  from: number;
  /** Where the content starts (after the opening markers) and ends (before the closing ones); a link, a citation
   *  or a code run has no content to nest into, so both are its edges. */
  inner: number;
  close: number;
  to: number;
  wraps: boolean;
  children: Span[];
}

function spansOf(src: string, base = 0): Span[] {
  const out: Span[] = [];
  for (const t of parseInline(src)) {
    if (t.kind === "text") continue;
    if (isWrapping(t)) {
      const inner = base + t.inner;
      out.push({ kind: t.kind, from: base + t.from, inner, close: inner + t.text.length, to: base + t.to, wraps: true, children: spansOf(t.text, inner) });
    } else {
      out.push({ kind: t.kind, from: base + t.from, inner: base + t.from, close: base + t.to, to: base + t.to, wraps: false, children: [] });
    }
  }
  return out;
}

function flatten(spans: Span[]): Span[] {
  return spans.flatMap((s) => [s, ...flatten(s.children)]);
}

/** What underline's regex wants outside its markers: not a letter, digit or underscore. */
const WORD = /[\p{L}\p{N}_]/u;

/** `piece` with the mark around its words and its edge spaces left outside (`** a **` would not read as bold). */
function wrapWords(piece: string, m: string): string {
  const lead = piece.length - piece.trimStart().length;
  const core = piece.trim();
  return core === "" ? piece : piece.slice(0, lead) + m + core + m + piece.slice(lead + core.length);
}

/** `src.slice(a, b)` with the markers of `spans` (all inside that range) taken off. */
function without(src: string, a: number, b: number, spans: Span[]): string {
  let out = src.slice(a, b);
  for (const s of [...spans].sort((x, y) => y.from - x.from)) {
    out = out.slice(0, s.from - a) + out.slice(s.inner - a, s.close - a) + out.slice(s.to - a);
  }
  return out;
}

/**
 * What pressing a mark's button (or key) does to the selection `[start, end)` of `src`.
 *
 * Marks nest, they never split: the selection first grows to the edges of any mark (or link, citation, code run) it
 * only partly covers, so no delimiter is left without its pair; one that is the content of a mark of another kind
 * (`__alpha__` selected inside its markers) is taken as that whole mark, so highlight over it is `==__alpha__==`;
 * a range already carrying the mark loses it (around it, or inside the markers, or a part of a longer run, which
 * keeps the rest marked); anything else is wrapped, the same mark inside it folded into the new one. A selection's
 * edge spaces stay outside the markers (`** word **` would not read as bold), and with nothing selected the pair is
 * written and the caret left between.
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
  if (mark === "code") return codeEdit(src, a, b);

  const tree = spansOf(src);
  const all = flatten(tree);
  // Grow the selection until it cuts nothing: to the edges of a token it crosses, to the whole word where underline
  // would otherwise start inside one, and out to a mark whose whole content it is (that is the mark, not its text).
  for (let moved = true; moved; ) {
    moved = false;
    for (const s of all) {
      if (a >= s.to || b <= s.from) continue;
      const inContent = s.wraps && a >= s.inner && b <= s.close;
      const covers = a <= s.from && b >= s.to;
      if (inContent && !(a === s.inner && b === s.close && s.kind !== mark)) continue;
      if (covers && !inContent) continue;
      const na = Math.min(a, s.from);
      const nb = Math.max(b, s.to);
      if (na !== a || nb !== b) {
        a = na;
        b = nb;
        moved = true;
      }
    }
    if (mark === "underline") {
      while (a > 0 && WORD.test(src[a - 1])) {
        a--;
        moved = true;
      }
      while (b < src.length && WORD.test(src[b])) {
        b++;
        moved = true;
      }
    }
  }

  const holders = all.filter((s) => s.wraps && s.inner <= a && b <= s.close);
  const own = holders.filter((s) => s.kind === mark).sort((x, y) => y.from - x.from)[0];
  const candidates: MarkEdit[] = [];
  if (own) {
    if (a === own.inner && b === own.close) {
      // The whole content of the mark: take the mark off.
      const bare = src.slice(own.inner, own.close);
      candidates.push({ from: own.from, to: own.to, text: bare, caret: own.from + bare.length });
    } else {
      // A part of a longer run: it comes out, the rest stays marked. When the part sits inside another mark within
      // this one, that mark comes out with it (it cannot be cut).
      for (const h of holders) {
        if (h.from > own.from && h.inner <= a && b <= h.close) {
          a = Math.min(a, h.from);
          b = Math.max(b, h.to);
        }
      }
      const left = wrapWords(src.slice(own.inner, a), m);
      const mid = src.slice(a, b);
      const right = wrapWords(src.slice(b, own.close), m);
      candidates.push({ from: own.from, to: own.to, text: left + mid + right, caret: own.from + left.length + mid.length });
    }
  } else {
    // The same mark inside the selection: a selection wholly under it loses it, any other has it folded into the one
    // being written (or, where folding would join a word to a marker and unmatch it, written around the parts that
    // lack it).
    const inside = all.filter((s) => s.kind === mark && s.from >= a && s.to <= b);
    const bare = without(src, a, b, inside);
    if (inside.length && carries(src, a, b, mark, tree)) {
      candidates.push({ from: a, to: b, text: bare, caret: a + bare.length });
    } else {
      // `_em_` cannot sit in underline's markers (`___x___` is not underline), so it is written with a star there.
      const text = mark === "underline" ? bare.replace(UNDER_EM, "$1*$2*") : bare;
      candidates.push({ from: a, to: b, text: `${m}${text}${m}`, caret: a + text.length + m.length * 2 });
      if (inside.length) {
        let text2 = "";
        let at = a;
        for (const s of [...inside].sort((x, y) => x.from - y.from)) {
          if (s.from < at) continue;
          text2 += wrapWords(src.slice(at, s.from), m) + src.slice(s.from, s.to);
          at = s.to;
        }
        text2 += wrapWords(src.slice(at, b), m);
        candidates.push({ from: a, to: b, text: text2, caret: a + text2.length });
      }
    }
  }
  // Never leave a delimiter that matches nothing: the first edit that parses clean, else the selection untouched.
  const before = strayCount(src);
  for (const c of candidates) if (strayCount(src.slice(0, c.from) + c.text + src.slice(c.to)) <= before) return c;
  return { from: a, to: a, text: "", caret: b };
}

/** Text runs, at any depth of nesting, that hold a delimiter of underline or highlight which matched nothing. */
function strayCount(src: string): number {
  let n = 0;
  for (const t of parseInline(src)) {
    if (t.kind === "text") n += /__|==/.test(t.text) ? 1 : 0;
    else if (isWrapping(t)) n += strayCount(t.text);
  }
  return n;
}

const UNDER_EM = /(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_\n*]*?[^\s_])_(?![\p{L}\p{N}_])/gu;

/** Does every word of `[a, b)` already sit under `mark`? Walks the tokens the range holds, into the other marks. */
function carries(src: string, a: number, b: number, mark: MarkName, tree: Span[]): boolean {
  const level = (spans: Span[], from: number, to: number): boolean => {
    let at = from;
    for (const s of spans) {
      if (s.to <= from || s.from >= to) continue;
      if (src.slice(at, s.from).trim() !== "") return false;
      if (s.kind !== mark) {
        if (!s.wraps || !level(s.children, s.inner, s.close)) return false;
      }
      at = s.to;
    }
    return src.slice(at, to).trim() === "";
  };
  // the range sits among the children of the innermost token that holds it, or among the roots
  let spans = tree;
  for (let deeper = true; deeper; ) {
    deeper = false;
    for (const s of spans) {
      if (s.wraps && s.inner <= a && b <= s.close) {
        spans = s.children;
        deeper = true;
        break;
      }
    }
  }
  return level(spans, a, b);
}

/** Code is not nested into (its text is literal): wrap the selection, or take the backticks off, as before. */
function codeEdit(src: string, a: number, b: number): MarkEdit {
  const m = MARKERS.code;
  const inner = src.slice(a, b);
  if (src.slice(a - m.length, a) === m && src.slice(b, b + m.length) === m) {
    return { from: a - m.length, to: b + m.length, text: inner, caret: a - m.length + inner.length };
  }
  if (inner.length > 2 * m.length && inner.startsWith(m) && inner.endsWith(m)) {
    const bare = inner.slice(m.length, inner.length - m.length);
    return { from: a, to: b, text: bare, caret: a + bare.length };
  }
  return { from: a, to: b, text: `${m}${inner}${m}`, caret: a + inner.length + m.length * 2 };
}

/** Italic's single star is the edge of bold's double: a star beyond the markers means they are part of a longer run. */
function beyond(src: string, from: number, to: number, m: string): boolean {
  return m === "*" && (src[from - 1] === "*" || src[to] === "*" || src[from + 1] === "*" || src[to - 2] === "*");
}
