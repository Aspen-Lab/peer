const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  minus: "-",
  // Phase 3 round 6 C, ITEM 2 (Disposition 1's fired reopen threshold,
  // Rulings 123c/123g item 2). A live gemini-sourced title
  // ("MSR2022 &laquo; Molten Salt Reactor Workshop") carried this entity
  // undecoded all the way to the rendered event name — root cause: this
  // table is closed and simply lacked the key, not a missing cleaning call
  // (Phase 3 round 5 B, Deliverable 3). Maps to a plain hyphen, matching the
  // table's own ndash/mdash/minus convention above: the live witness is the
  // classic WordPress wp_title() "{page title} {sep} {site name}" separator
  // shape, not real quoted speech, so a hyphen reads correctly where an
  // actual guillemet/quote mark would insert a confusing stray character
  // mid-title. `raquo` (the right guillemet) is DELIBERATELY NOT added —
  // zero live witnesses this round, unwitnessed siblings are not added
  // blind per this campaign's standing "land what is confirmed" practice.
  laquo: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  times: "x",
  plusmn: "+/-",
  le: "<=",
  ge: ">=",
  micro: "micro",
  deg: " degrees",
};

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "+": "+",
  "-": "-",
  "=": "=",
  "(": "(",
  ")": ")",
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
  "₌": "=",
  "₍": "(",
  "₎": ")",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "+": "+",
  "-": "-",
  "=": "=",
  "(": "(",
  ")": ")",
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
  "⁼": "=",
  "⁽": "(",
  "⁾": ")",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCodePoint(parseInt(d, 10)),
    )
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (entity, name: string) =>
      HTML_ENTITIES[name] ?? entity,
    );
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<\/?(p|br|div|section|article|li|ul|ol|jats:[a-z0-9-]+)\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:sub|sup|i|em|b|strong|span|mml:[^>\s]+)\b[^>]*>/gi, "")
    .replace(/<\/?[A-Za-z][A-Za-z0-9:-]{1,}\b[^>]*>/g, " ");
}

function normalizeLatex(text: string): string {
  return text
    .replace(/\$_\{([^}]*)\}\$/g, (_, s: string) => toPlainSubscript(s))
    .replace(/\$\^\{([^}]*)\}\$/g, (_, s: string) => `(${s})`)
    .replace(/_\{([^}]*)\}/g, "$1")
    .replace(/\^\{([^}]*)\}/g, "($1)")
    .replace(/_([A-Za-z0-9+\-=()]+)/g, "$1")
    .replace(/\^([A-Za-z0-9+\-=()]+)/g, "($1)")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\(?:text|mathrm|mathbf|mathit|rm)\{([^}]*)\}/g, "$1")
    .replace(/\\alpha\b/g, "alpha")
    .replace(/\\beta\b/g, "beta")
    .replace(/\\gamma\b/g, "gamma")
    .replace(/\\delta\b/g, "delta")
    .replace(/\\mu\b/g, "micro")
    .replace(/\\sigma\b/g, "sigma")
    .replace(/\\rightarrow\b/g, "->")
    .replace(/\\leftarrow\b/g, "<-")
    .replace(/\\times\b/g, "x")
    .replace(/\\pm\b/g, "+/-")
    .replace(/\\cdot\b/g, ".")
    .replace(/[{}]/g, "");
}

function toPlainSubscript(text: string): string {
  return text.split("").map((c) => SUBSCRIPT_MAP[c] ?? c).join("");
}

function normalizeUnicodeSymbols(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    // 2-03: PyMuPDF reorders a stacked inline fraction like "L/d" into
    // letters-then-fraction-slash ("Ld" + U+2044 FRACTION SLASH) as its own
    // free-floating token when lifting text from a PDF's glyph layout — a
    // real extraction artifact, never real prose. Scoped to U+2044 only,
    // never the ASCII "/" (which is real, load-bearing text everywhere
    // this function runs — "km/h", a date, "and/or"). Matches the same
    // (display-only) removal `evidence.ts`'s FRACTION_SLASHES already does
    // for matching purposes (1-17) — this is the display-side counterpart.
    .replace(/\s*⁄\s*/g, "")
    .replace(/×/g, "x")
    .replace(/±/g, "+/-")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/µ/g, "micro")
    .replace(/°/g, " degrees")
    .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/g, (c) => SUBSCRIPT_MAP[c] ?? c)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾]/g, (c) => SUPERSCRIPT_MAP[c] ?? c);
}

function repairCommonMojibake(text: string): string {
  return text
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€�/g, '"')
    .replace(/â€“|â€”|â€"/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/â†’/g, "->")
    .replace(/â†\u0090/g, "<-")
    .replace(/Â°/g, " degrees")
    .replace(/Â±/g, "+/-")
    .replace(/Â·/g, ".")
    .replace(/Â/g, "");
}

function normalizeChemistryAndOperators(text: string): string {
  return text
    .replace(/\b([A-Z][a-z]?)\s+([a-z](?=[A-Z]))/g, "$1$2")
    .replace(/([A-Z])\s+(\d)(?=\b|[A-Z),.:;])/g, "$1$2")
    .replace(/\s*([<>]=?|=)\s*/g, " $1 ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1");
}

export function cleanDisplayText(text: string | null | undefined | number): string {
  if (text == null || text === "") return "";
  const str = typeof text === "string" ? text : String(text);
  return normalizeChemistryAndOperators(
    normalizeUnicodeSymbols(
      normalizeLatex(stripHtmlTags(decodeHtmlEntities(stripHtmlTags(repairCommonMojibake(str))))),
    ),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanDisplayTextOrUndefined(
  text: string | null | undefined | number,
): string | undefined {
  const cleaned = cleanDisplayText(text);
  return cleaned || undefined;
}
