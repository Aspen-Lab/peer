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
  // P9-10 (cluster D): the entity names the symbol, so the symbol is what
  // the reader gets. The ASCII alphabet ("x", "+/-", "<=", ">=", " degrees")
  // is the evidence matcher's, not the display text's (evidence.ts folds it).
  // `micro` is U+00B5; the Greek small letter mu (U+03BC) is the one the
  // cleaner emits for it everywhere.
  times: "×",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  micro: "μ",
  deg: "°",
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

// P9-10 (cluster G's gate): the cleaner used to run `.normalize("NFKC")`,
// which flattens every Unicode super- and subscript (`cm²` -> `cm2`,
// `Co(OH)₆⁴⁻` -> `Co(OH)64-`, `H₂O` -> `H2O`) and turns `½` into `1⁄2`, whose
// slash the fraction-slash fold below then deletes (`12`). The PDF line
// builder now writes exponents as Unicode, so the cleaner normalizes with NFC
// (canonical composition only: `e` + U+0301 -> `é`, the Angstrom and Ohm
// signs -> `Å` and `Ω`) and names, in the three constants below, the
// compatibility folds it still wants.
//
// Ligatures: letters, as a reader would type them (U+FB05 is the long-s t
// ligature; the long s is the letter `s`).
const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
};
// No-break, en/em/thin/hair/figure and the other fixed-width spaces, the
// narrow no-break space, the medium mathematical space and the ideographic
// space: one ordinary space (the `[ \t]+` collapse at the end of
// `cleanDisplayText` then merges a run of them; U+200B stays out: it is not a
// space but a zero-width mark, and the evidence matcher folds it itself).
const SPACE_LIKE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
// Full-width ASCII forms (U+FF01-U+FF5E: `Ａ`, `１`, `（`, `，`): their ASCII twins.
const FULLWIDTH_ASCII = /[\uFF01-\uFF5E]/g;

// The dashes and the minus sign: U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN,
// U+2012 FIGURE DASH, U+2013 EN DASH, U+2014 EM DASH, U+2015 HORIZONTAL BAR,
// U+2212 MINUS SIGN.
const DASHES = /[‐‑‒–—―−]/g;
// P9-16: what `cleanPaperText` does with them instead of folding all to "-".
// The author's minus sign (U+2212), en dash (U+2013) and em dash (U+2014) stay
// as set ("[12 −20 8 1]", "20−30 mV", "1990–2000"): folding them made a
// vector's minus look like a hyphen and lost the sign of every number of the
// owner's paper. Only the hyphen glyphs (U+2010, U+2011) fold to "-"; the two
// look-alikes of a dash fold to their honest relative (U+2012 FIGURE DASH to
// the en dash, U+2015 HORIZONTAL BAR to the em dash). A character not listed
// here (U+2013, U+2014, U+2212) is left as it is.
const PAPER_DASHES: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "\u2013",
  "\u2015": "\u2014",
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
  // P9-10: the last step below, stripping every `{` and `}`, is LaTeX's
  // grouping. It runs only when the text carries a LaTeX command (a
  // backslash); a paper's plane families `{003}` and `{110} ≫ {101}` are
  // text and keep their braces.
  const isLatex = text.includes("\\");
  const out = text
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
    .replace(/\\times\b/g, "×")
    .replace(/\\pm\b/g, "±")
    .replace(/\\cdot\b/g, ".");
  return isLatex ? out.replace(/[{}]/g, "") : out;
}

function toPlainSubscript(text: string): string {
  return text.split("").map((c) => SUBSCRIPT_MAP[c] ?? c).join("");
}

function normalizeUnicodeSymbols(text: string, keepDashes: boolean): string {
  return text
    .normalize("NFC")
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c] ?? c)
    .replace(SPACE_LIKE, " ")
    .replace(FULLWIDTH_ASCII, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // NFKC also spelled the ellipsis out; the entity table (`hellip`) and the
    // mojibake repair (`â€¦`) already do, so a raw U+2026 reads the same way.
    .replace(/\u2026/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Every dash and the minus sign fold to "-" (the default, as it always was:
    // the feed's text goes on to `lib/scoring/tokenize.ts`, which keeps only "-"
    // inside a token); the paper's own path keeps the author's (P9-16, below).
    .replace(DASHES, (dash) => (keepDashes ? PAPER_DASHES[dash] ?? dash : "-"))
    // 2-03: PyMuPDF reorders a stacked inline fraction like "L/d" into
    // letters-then-fraction-slash ("Ld" + U+2044 FRACTION SLASH) as its own
    // free-floating token when lifting text from a PDF's glyph layout — a
    // real extraction artifact, never real prose. Scoped to U+2044 only,
    // never the ASCII "/" (which is real, load-bearing text everywhere
    // this function runs — "km/h", a date, "and/or"). Matches the same
    // (display-only) removal `evidence.ts`'s FRACTION_SLASHES already does
    // for matching purposes (1-17) — this is the display-side counterpart.
    .replace(/\s*⁄\s*/g, "")
    // P9-10 (cluster D): `° ± × ≤ ≥` stay. The text layer of a PDF carries
    // them as real Unicode and the reader wants them as printed; the old
    // ASCII fold ("275 degreesC", "x", "+/-", "<=") belongs to the evidence
    // matcher alone (evidence.ts `normalizeForMatch`). U+00B5 MICRO SIGN is
    // the one compatibility letter named here on purpose: it is the Greek
    // small letter mu (U+03BC) in every font the reader sees.
    .replace(/\u00B5/g, "\u03BC");
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
    .replace(/Â°/g, "°")
    .replace(/Â±/g, "±")
    .replace(/Â·/g, ".")
    .replace(/Â/g, "");
}

function normalizeChemistryAndOperators(text: string): string {
  return text
    .replace(/\b([A-Z][a-z]?)\s+([a-z](?=[A-Z]))/g, "$1$2")
    // The tail of a formula word that a PDF's script glyphs spaced out
    // ("CO 2" -> "CO2"). P9-10 (cluster H; BACKLOG-19): it joins only when the
    // capital follows a letter, so a stand-alone capital keeps its space
    // ("A 3D", "A 0.25 mm", "Figure S 1", "Type A 2.5 mm"), and never when the
    // digit opens a decimal ("WAS 0.4" is not the formula WAS0.4).
    .replace(/(?<=[A-Za-z])([A-Z])\s+(\d)(?![.,]\d)(?=\b|[A-Z),.:;])/g, "$1$2")
    .replace(/\s*([<>]=?|=)\s*/g, " $1 ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1");
}

function cleanText(text: string | null | undefined | number, keepDashes: boolean): string {
  if (text == null || text === "") return "";
  const str = typeof text === "string" ? text : String(text);
  return normalizeChemistryAndOperators(
    normalizeUnicodeSymbols(
      normalizeLatex(stripHtmlTags(decodeHtmlEntities(stripHtmlTags(repairCommonMojibake(str))))),
      keepDashes,
    ),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanDisplayText(text: string | null | undefined | number): string {
  return cleanText(text, false);
}

/**
 * `cleanDisplayText` for the text of a paper the reader is shown (the PDF's
 * sections, captions, equations and title; `papers/pdf-text.ts`): the same
 * pipeline with one step narrowed, the dash step. The author's minus sign
 * (U+2212), en dash (U+2013) and em dash (U+2014) stay as set; only the hyphen
 * glyphs fold to "-" (see `PAPER_DASHES`). It is a second function and not an
 * option of the first because `cleanDisplayText` is passed to `.map` all over
 * the sources, where a second parameter would receive the array index. The
 * evidence matcher folds every dash and minus to "-" itself
 * (`evidence.ts` `normalizeForMatch`, through the default), so a quote typed
 * with "-" still finds a body set with "−".
 */
export function cleanPaperText(text: string | null | undefined | number): string {
  return cleanText(text, true);
}

export function cleanDisplayTextOrUndefined(
  text: string | null | undefined | number,
): string | undefined {
  const cleaned = cleanDisplayText(text);
  return cleaned || undefined;
}
