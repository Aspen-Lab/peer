// HTML full-text extractors. Maps publisher/repository HTML pages into the
// same sectioned shape the PDF extractor produces, so the deep-report
// pipeline can consume either source transparently.
//
// Host coverage (with dedicated parsers, in priority order):
//   - arxiv.org/html + ar5iv     (LaTeXML rendering)
//   - pmc.ncbi.nlm.nih.gov       (PubMed Central)
//   - biorxiv.org / medrxiv.org  (Highwire press templates)
//   - generic                    (last-resort: <article>/<main> walker)

import { cleanDisplayText } from "@/lib/text/clean";

const MAX_SECTION_CHARS = 18_000;
const MAX_TOTAL_CHARS = 90_000;

export interface ExtractedSection {
  heading: string;
  /** Canonical bucket: introduction|methods|results|discussion|conclusion|body|... */
  canonical: string;
  text: string;
}

export interface ExtractedFigureCaption {
  ordinal: number;
  label: string;
  caption: string;
}

export type ExtractedSourceKind =
  | "ar5iv"
  | "pmc"
  | "biorxiv"
  | "generic-html"
  | "pdf";

export interface ExtractedDocument {
  title?: string | null;
  sections: ExtractedSection[];
  figureCaptions: ExtractedFigureCaption[];
  source: ExtractedSourceKind;
  /** PDFs only: pages the extractor saw (capped at its page limit). */
  pageCount?: number;
  reason?: string | null;
}

// ── Utilities ─────────────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/**
 * Block elements whose end is a paragraph break. Everything else is inline
 * and closes into a space.
 */
const BLOCK_END = /<\/(?:p|div|li|ul|ol|h[1-6]|blockquote|figcaption|section|article|tr|table|pre)\s*>/gi;

/**
 * Tags out, text back — with the paragraph boundaries kept.
 *
 * Every tag used to become a space and every run of whitespace one space,
 * which turned a section into a single four-thousand-character line. That was
 * invisible while the only readers were a sentence splitter and a model; it
 * stopped being invisible when the reading page started setting the paper
 * itself, where a section with no paragraphs in it is a wall. Block closers
 * become a blank line and `<br>` a single one; the callers that want one line
 * (headings) ask for it with `oneLine`.
 */
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<sup\b[^>]*class=["'][^"']*reference[^"']*["'][\s\S]*?<\/sup>/gi, " ")
      // LaTeXML writes every formula twice — the presentation MathML and, in
      // an <annotation>, the TeX it came from — so stripping tags produced
      // "d = 3 d=3", "K K", "𝒰 \\mathcal{U}". It was in every quote, every
      // figure caption and every line of the paper's body on the reading
      // page. The rendered half is the readable one; the TeX half goes.
      .replace(/<annotation(?:-xml)?\b[^>]*>[\s\S]*?<\/annotation(?:-xml)?>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(BLOCK_END, "\n\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

/**
 * Figure and table captions, out of the running text.
 *
 * They are collected separately (`collectCaptions`) and were *also* left in
 * the section they sit in, where a sentence splitter cannot tell them from
 * prose. "Mean-of-K TM-score achieved by FK-steering on 1CLL." is a label for
 * a picture; quoted under "What they found, and how big" it is Peer claiming
 * a caption is a result. Two of the three findings on one paper were captions.
 */
function withoutCaptions(html: string): string {
  return html
    .replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/gi, " ")
    .replace(/<div\b[^>]*class=["'][^"']*ltx_caption[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, " ");
}

/** A heading is one line whatever markup it was wrapped in. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Map a heading to the bucket the readers downstream understand.
 *
 * Numbering is stripped in every shape LaTeXML, JATS and PDF text produce
 * ("4.4 Results", "IV. Method", "B.2 Ablations", "Appendix C Proofs") — the
 * old `^\d+\.?` strip left "4.4 Results" as "4 results" → "body", which is
 * how a paper's Results and Limitations sections were being dropped on the
 * floor. The limitations bucket is new: it is the one section a reader most
 * wants quoted verbatim, and no consumer could ask for it before.
 */
export function canonicalizeHeading(heading: string): string {
  const lower = heading
    .replace(/^(?:Appendix\s+)?(?:[A-Z]|[IVX]+|\d+)(?:\.\d+)*\.?\s+/, "")
    .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
    .toLowerCase()
    .trim();
  if (/limitation|caveat|threats? to validity|failure (?:case|mode)s?|weakness/.test(lower)) {
    return "limitations";
  }
  if (/material.*method|experimental (?:section|setup|design|details|procedure)|methodolog/.test(lower)) {
    return "methods";
  }
  if (/result.*discussion/.test(lower)) return "results";
  if (/^result|^finding|^evaluation|^experiment|^empirical|^performance|^ablation/.test(lower)) {
    return "results";
  }
  if (/discussion/.test(lower)) return "discussion";
  if (/evaluation|experiment|benchmark/.test(lower)) return "results";
  if (/method|approach|model|theory|framework|architecture|proposed|our solution|formulation|system design/.test(lower)) {
    return "methods";
  }
  if (/introduction|background|motivation/.test(lower)) return "introduction";
  if (/related work|prior work|literature/.test(lower)) return "related_work";
  if (/^abstract\b/.test(lower)) return "abstract";
  if (/conclusion|summary|future work/.test(lower)) return "conclusion";
  if (/\bresults?\b/.test(lower)) return "results";
  if (/reference|bibliograph/.test(lower)) return "references";
  if (/acknowledg|funding|author contribution|competing interest|conflict of interest|data availability|ethic/.test(lower)) {
    return "acknowledgments";
  }
  if (/supplement|supporting|appendix/.test(lower)) return "supplementary";
  return "body";
}

/**
 * A heading that numbers itself: "5.1", "5.1.2", "IV.2", "B.2",
 * "Appendix C.1". Null for a heading that does not — "Impact Statement",
 * and most of PMC and bioRxiv.
 */
function headingNumber(heading: string): string | null {
  const match = heading.match(/^(?:Appendix\s+)?((?:\d+|[A-Z]|[IVX]+)(?:\.\d+)*)\.?\s+\S/);
  return match ? match[1] : null;
}

/**
 * A child heading only overrules its parent when it says something
 * structural. "5.3 Limitations" under "5 Results" is limitations; "5.1 Model
 * Comparison Across Budgets" under the same parent is not methods, whatever
 * the word "model" in it suggests.
 */
const STRONG_BUCKETS = new Set([
  "limitations",
  "references",
  "acknowledgments",
  "supplementary",
  "abstract",
]);

/**
 * Numbered subsections inherit their parent's bucket.
 *
 * `canonicalizeHeading` reads one heading at a time, and a subsection's own
 * heading is the weakest evidence in the document about what it contains: a
 * paper whose results live in "5.1 Model Comparison Across Budgets", "5.2
 * O3", "5.3 FK-steering" and "5.4 DPO" had exactly one section bucketed
 * `results` — "5 Results" itself, a 315-character paragraph saying which
 * subsection discusses what — and so the reading page's "What they found"
 * block came out empty on a paper whose findings were all right there. The
 * numbering is the document telling us its own structure, and it was being
 * stripped and thrown away.
 *
 * Sections keep their own bucket where it is structural (`STRONG_BUCKETS`)
 * and where they have no numbered parent, so an unnumbered document is
 * untouched.
 */
export function withInheritedBuckets(sections: ExtractedSection[]): ExtractedSection[] {
  const byNumber = new Map<string, string>();
  return sections.map((section) => {
    const number = headingNumber(section.heading);
    if (!number) return section;
    let canonical = section.canonical;
    if (!STRONG_BUCKETS.has(canonical) && number.includes(".")) {
      // The nearest numbered ancestor: "5.4.1" asks "5.4", then "5".
      const parts = number.split(".");
      for (let cut = parts.length - 1; cut > 0; cut--) {
        const parent = byNumber.get(parts.slice(0, cut).join("."));
        if (parent && parent !== "body") {
          canonical = parent;
          break;
        }
      }
    }
    byNumber.set(number, canonical);
    return canonical === section.canonical ? section : { ...section, canonical };
  });
}

function shouldKeepSection(canonical: string): boolean {
  return canonical !== "references" && canonical !== "acknowledgments";
}

function capSection(text: string): string {
  return text.length > MAX_SECTION_CHARS ? text.slice(0, MAX_SECTION_CHARS) : text;
}

function trimToBudget(sections: ExtractedSection[]): ExtractedSection[] {
  let running = 0;
  const out: ExtractedSection[] = [];
  for (const section of sections) {
    const remaining = MAX_TOTAL_CHARS - running;
    if (remaining <= 0) break;
    const text =
      section.text.length > remaining ? section.text.slice(0, remaining) : section.text;
    out.push({ ...section, text });
    running += text.length;
  }
  return out;
}

/**
 * One caption parser for every extractor. Labels used to come out as
 * "Figure Figure1" (the capture already held the word), tables were labelled
 * as figures, and LaTeXML subfigure fragments — "(a) Original image" — were
 * emitted as captions of their own, three of every four on a typical page.
 * Fragments carry nothing without their parent; they are dropped. Tables keep
 * their own label so nothing downstream tries to bind them to an image.
 */
export function parseCaption(
  raw: string,
  ordinal: number,
): ExtractedFigureCaption | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\(?[a-z]\)\s/i.test(text)) return null;
  const match = text.match(/^(fig(?:ure)?|tab(?:le)?)\.?\s*(S?\d+[a-z]?)\b[:.]?\s*(.*)$/i);
  const kind = match && /^tab/i.test(match[1]) ? "Table" : "Figure";
  const label = match ? `${kind} ${match[2]}` : `Figure ${ordinal + 1}`;
  // LaTeXML puts the separator in the tag span AND at the start of the text
  // ("Figure 1: " + ": A clinician…"); strip any leading punctuation.
  const caption = (match ? match[3] : text).replace(/^[\s:.\-–—]+/, "").slice(0, 500);
  return { ordinal, label, caption };
}

function collectCaptions(html: string, captionRe: RegExp): ExtractedFigureCaption[] {
  const captions: ExtractedFigureCaption[] = [];
  for (const match of html.matchAll(captionRe)) {
    const parsed = parseCaption(stripTags(match[1]), captions.length);
    if (parsed) captions.push(parsed);
  }
  return captions;
}

function extractTitleFromHtml(html: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og?.[1]) return cleanDisplayText(decodeEntities(og[1]));
  const cit = html.match(
    /<meta[^>]+name=["']citation_title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (cit?.[1]) return cleanDisplayText(decodeEntities(cit[1]));
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag?.[1]) {
    const text = cleanDisplayText(decodeEntities(titleTag[1]));
    if (text.length >= 6) return text;
  }
  return null;
}

// ── LaTeXML (arxiv.org/html and ar5iv) ────────────────────────────────
// arXiv's own HTML render and ar5iv both emit LaTeXML: <section class="ltx_section">
// with <h2 class="ltx_title ltx_title_section">, nested <section class="ltx_subsection">
// with <h3 …_subsection>, and so on. The previous parser matched whole
// <section>…</section> blocks with a non-greedy regex, so a section holding
// subsections ended at the first nested </section>: "4 Evaluation" kept its
// preamble and lost 4.4 Results and 4.5 Limitations entirely. This walker
// slices between consecutive headings of any level instead — each heading
// owns the text up to the next one, a parent keeps only its own preamble,
// and nothing is counted twice.

const LATEXML_HEADING_RE =
  /<h([1-6])\b[^>]*class=["'][^"']*\bltx_title_(?:section|subsection|subsubsection|appendix)\b[^"']*["'][^>]*>([\s\S]*?)<\/h\1>/gi;

function extractLatexml(html: string): ExtractedDocument {
  const sections: ExtractedSection[] = [];

  const abstractMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bltx_abstract\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (abstractMatch) {
    const text = stripTags(
      abstractMatch[1].replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i, " "),
    );
    if (text) sections.push({ heading: "Abstract", canonical: "abstract", text: capSection(text) });
  }

  const bibIndex = html.search(/<section\b[^>]*class=["'][^"']*\bltx_bibliography\b/i);
  const bodyEnd = bibIndex >= 0 ? bibIndex : html.length;
  const heads: Array<{ index: number; end: number; heading: string }> = [];
  for (const match of html.matchAll(LATEXML_HEADING_RE)) {
    const index = match.index ?? 0;
    if (index >= bodyEnd) break;
    const heading = oneLine(stripTags(match[2]));
    if (!heading) continue;
    heads.push({ index, end: index + match[0].length, heading });
  }
  for (let i = 0; i < heads.length; i++) {
    const stop = i + 1 < heads.length ? heads[i + 1].index : bodyEnd;
    const text = stripTags(withoutCaptions(html.slice(heads[i].end, stop)));
    if (!text) continue;
    const canonical = canonicalizeHeading(heads[i].heading);
    if (!shouldKeepSection(canonical)) continue;
    sections.push({ heading: heads[i].heading, canonical, text: capSection(text) });
  }

  return {
    title: extractTitleFromHtml(html),
    sections: trimToBudget(withInheritedBuckets(sections)),
    figureCaptions: collectCaptions(
      html,
      /<figcaption\b[^>]*class=["'][^"']*ltx_caption[^"']*["'][^>]*>([\s\S]*?)<\/figcaption>/gi,
    ),
    source: "ar5iv",
  };
}

// ── PubMed Central (PMC) ───────────────────────────────────────────────
// PMC uses JATS-flavored HTML. Body sections are <section class="tsec sec">
// (rendered NXML) with <h2> or <h3> child headings.

function extractPmc(html: string): ExtractedDocument {
  const sections: ExtractedSection[] = [];
  // PMC body sections come in two shapes:
  //   <section id="sec1">...</section>          (new PMC layout)
  //   <section class="sec">...</section>        (older variant)
  // Abstracts are `<section class="abstract" id="abstractN">` — we keep those
  // when they're the only body source.
  const sectionRe =
    /<section\b[^>]*(?:id=["']sec\d+[^"']*["']|class=["'][^"']*\b(?:sec|tsec|abstract)\b[^"']*["'])[^>]*>([\s\S]*?)<\/section>/gi;

  for (const match of html.matchAll(sectionRe)) {
    const inner = match[1];
    // Skip nested sections inside an outer one (we'll catch them on their own
    // iteration of the regex too — pick the heading at this level).
    const headingMatch = inner.match(/<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/i);
    if (!headingMatch) continue;
    const heading = oneLine(stripTags(headingMatch[1]));
    if (!heading) continue;
    const text = stripTags(withoutCaptions(inner.replace(headingMatch[0], " ")));
    if (!text) continue;
    const canonical = canonicalizeHeading(heading);
    if (!shouldKeepSection(canonical)) continue;
    sections.push({ heading, canonical, text: capSection(text) });
  }

  return {
    title: extractTitleFromHtml(html),
    sections: trimToBudget(withInheritedBuckets(sections)),
    // <figcaption> or <div class="caption"> containing <p>Fig N. text</p>
    figureCaptions: collectCaptions(html, /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi),
    source: "pmc",
  };
}

// ── bioRxiv / medRxiv (Highwire Press) ────────────────────────────────
// Highwire templates use <div class="section" id="..."> with <h2 class="...">.

function extractBiorxiv(html: string): ExtractedDocument {
  const sections: ExtractedSection[] = [];
  const sectionRe =
    /<div\b[^>]*class=["'][^"']*\bsection\b[^"']*["'][^>]*>([\s\S]*?)<\/div>(?=\s*<div[^>]*class=["'][^"']*\bsection\b|\s*<\/article|\s*<\/main)/gi;

  // The regex above is best-effort; fall back to a heading-based walker if
  // it produces nothing.
  const found = Array.from(html.matchAll(sectionRe));
  if (found.length > 0) {
    for (const match of found) {
      const inner = match[1];
      const headingMatch = inner.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i);
      if (!headingMatch) continue;
      const heading = oneLine(stripTags(headingMatch[1]));
      if (!heading) continue;
      const text = stripTags(withoutCaptions(inner.replace(headingMatch[0], " ")));
      if (!text) continue;
      const canonical = canonicalizeHeading(heading);
      if (!shouldKeepSection(canonical)) continue;
      sections.push({ heading, canonical, text: capSection(text) });
    }
  } else {
    // Heading-based fallback over the whole article container.
    const articleMatch = html.match(
      /<article\b[^>]*>([\s\S]*?)<\/article>|<main\b[^>]*>([\s\S]*?)<\/main>/i,
    );
    const body = articleMatch ? articleMatch[1] || articleMatch[2] : html;
    sections.push(...walkHeadings(body));
  }

  return {
    title: extractTitleFromHtml(html),
    sections: trimToBudget(withInheritedBuckets(sections)),
    figureCaptions: collectCaptions(
      html,
      /<div\b[^>]*class=["'][^"']*\bfig-caption\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    ),
    source: "biorxiv",
  };
}

// ── Generic fallback ──────────────────────────────────────────────────
// Walks every <h2>/<h3> inside <article>/<main> and groups intervening
// text as that section's body. Last resort — used for OA publishers without
// a dedicated parser.

function walkHeadings(html: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  // Find all heading positions
  const headingRe = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches: Array<{ index: number; end: number; heading: string }> = [];
  for (const match of html.matchAll(headingRe)) {
    const heading = oneLine(stripTags(match[2]));
    if (!heading) continue;
    matches.push({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      heading,
    });
  }
  if (matches.length === 0) {
    const text = stripTags(html);
    if (text) {
      sections.push({
        heading: "Body",
        canonical: "body",
        text: capSection(text),
      });
    }
    return sections;
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const stop = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const slice = html.slice(start, stop);
    const text = stripTags(withoutCaptions(slice));
    if (!text) continue;
    const heading = matches[i].heading;
    const canonical = canonicalizeHeading(heading);
    if (!shouldKeepSection(canonical)) continue;
    sections.push({ heading, canonical, text: capSection(text) });
  }
  return sections;
}

function extractGeneric(html: string): ExtractedDocument {
  const articleMatch = html.match(
    /<article\b[^>]*>([\s\S]*?)<\/article>|<main\b[^>]*>([\s\S]*?)<\/main>/i,
  );
  const body = articleMatch ? articleMatch[1] || articleMatch[2] : html;
  const sections = walkHeadings(body);
  return {
    title: extractTitleFromHtml(html),
    sections: trimToBudget(withInheritedBuckets(sections)),
    figureCaptions: collectCaptions(html, /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi),
    source: "generic-html",
  };
}

// ── Public dispatch ───────────────────────────────────────────────────

export function chooseHtmlExtractor(url: string): (html: string) => ExtractedDocument {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/(^|\.)arxiv\.org$/.test(host)) return extractLatexml;
    if (/(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/.test(host)) return extractPmc;
    if (/(^|\.)biorxiv\.org$/.test(host) || /(^|\.)medrxiv\.org$/.test(host)) {
      return extractBiorxiv;
    }
  } catch {
    // fall through to generic
  }
  return extractGeneric;
}

const PAPER_BODY_BUCKETS = new Set([
  "introduction",
  "methods",
  "results",
  "discussion",
  "conclusion",
  "related_work",
  "limitations",
]);

/**
 * Whether an extracted page plausibly holds the paper, not a stub around it.
 *
 * The old test — 2,500 chars total and one non-abstract section over 800 —
 * was passed by a Zenodo record's landing page (a 1,445-char "Description"
 * plus file listings, licence text and citation snippets), which then served
 * as the paper's "full text". A paper has either a recognisable body section
 * of real length or several long sections; a landing page has one.
 */
export function looksLikeFullText(doc: ExtractedDocument, minBodyChars = 2500): boolean {
  const body = doc.sections.filter((section) => section.canonical !== "abstract");
  const total = body.reduce((sum, section) => sum + section.text.length, 0);
  if (total < minBodyChars) return false;
  const long = body.filter((section) => section.text.length >= 800);
  if (long.some((section) => PAPER_BODY_BUCKETS.has(section.canonical))) return true;
  return long.length >= 2;
}
