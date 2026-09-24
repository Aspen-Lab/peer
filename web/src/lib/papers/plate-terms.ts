// Terms for the typographic plate — the visual element on a card whose paper
// has no extractable figure.
//
// The source field is `summaryExperimentKeywords`, which `rawItemToPaper` fills
// as `matchedKeywords ∪ item.tags`. Both halves are hostile:
//
//   - `matchedKeywords` ARE the reader's own required topics, so they repeat on
//     every card in the briefing. Set them large on ten cards and the feed
//     becomes ten copies of the reader's own query.
//   - `item.tags` are OpenAlex concepts, which are disambiguated Wikipedia-style
//     and land in the wrong domain often enough to matter — a live briefing on
//     protein structure carried "Representation (politics)" and "Generative
//     grammar".
//
// The same field, rendered without this pass, is what produced the "Why you ·
// protein structure prediction, Protein structure prediction, Protein
// structure" line removed in v0.8.2. Allocation is therefore done ONCE across
// the whole briefing rather than per card.

const MAX_TERMS_PER_CARD = 3;
/** No term may headline more than this many cards in one briefing. */
const MAX_CARDS_PER_TERM = 2;
/** arXiv category codes — "quant-ph", "cs.LG", "physics.chem-ph". Real data,
 *  but a filing code is not a concept, and set at display size it reads as a
 *  leak of the pipeline's internals. */
const CATEGORY_CODE = /^[a-z]+(?:[.-][a-z]{2,}){1,2}$/;

/** A term this short carries nothing set large — "Graph", "Model". */
const MIN_TERM_CHARS = 6;
/** And a term this long cannot be set large: at card width the first line of
 *  the plate holds about this many characters of the display serif, and past
 *  it the composition truncates mid-word. Display type does not truncate, so
 *  the term is dropped instead and the plate falls to its blank. */
const MAX_TERM_CHARS = 24;

/** Concepts whose disambiguation bracket marks them as out-of-domain noise. */
export const OFF_DOMAIN = /\((?:politics|linguistics|psychology|philosophy|music|law|sociology|geology|literature|mathematics education)\)/i;

function normalize(term: string): string {
  return term.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Drop a term that is a substring of one already kept, so
 * "protein structure prediction" suppresses "protein structure". Case- and
 * whitespace-insensitive; the plain Set the old code used caught neither.
 */
function subsumed(candidate: string, kept: string[]): boolean {
  const c = normalize(candidate);
  return kept.some((k) => {
    const n = normalize(k);
    return n === c || n.includes(c) || c.includes(n);
  });
}

export interface PlateTermInput {
  id: string;
  summaryExperimentKeywords: string[];
  /** The paper's own words. A concept that appears nowhere in them is almost
   *  always a mis-disambiguation — OpenAlex put "Generative grammar" on a
   *  protein-folding paper — and a wrong term set at display size is worse
   *  than no term at all. */
  title?: string;
  summaryIntro?: string;
  summaryResultDiscussion?: string;
}

function groundedIn(paper: PlateTermInput): (term: string) => boolean {
  const corpus = normalize(
    [paper.title, paper.summaryIntro, paper.summaryResultDiscussion]
      .filter(Boolean)
      .join(" "),
  );
  // No text to check against — keep the old behaviour rather than blanking the
  // plate.
  if (!corpus) return () => true;
  return (term) => corpus.includes(normalize(term));
}

/**
 * The quality rules every display of a paper's terms shares — the plate's and
 * the library graph's. A term that fails one of these is wrong wherever it is
 * shown. What is NOT here is the plate's own allocation policy (the reader's
 * topics banned, a per-briefing cap), which only makes sense on a card.
 */
function passesTermRules(
  term: string,
  isGrounded: (term: string) => boolean,
  maxChars: number,
): boolean {
  const key = normalize(term);
  if (!key) return false;
  if (OFF_DOMAIN.test(term)) return false;
  if (CATEGORY_CODE.test(key)) return false;
  if (key.length < MIN_TERM_CHARS) return false;
  if (term.length > maxChars) return false;
  return isGrounded(term);
}

/**
 * A paper's own terms that survive the shared rules, in the record's order,
 * with subsumed ones dropped. The reader's topics are NOT removed: a graph of
 * what someone has read is exactly where "this paper carries your topic" is
 * information rather than an echo.
 */
export function cleanTerms(paper: PlateTermInput, max: number, maxChars = 32): string[] {
  const kept: string[] = [];
  const isGrounded = groundedIn(paper);
  for (const raw of paper.summaryExperimentKeywords ?? []) {
    if (kept.length >= max) break;
    const term = raw.trim();
    if (!passesTermRules(term, isGrounded, maxChars)) continue;
    if (subsumed(term, kept)) continue;
    kept.push(term);
  }
  return kept;
}

/** Case- and whitespace-insensitive key a term is compared by. */
export const termKey = normalize;

/**
 * Allocate plate terms across a whole briefing.
 *
 * Returns a map from paper id to the terms that card may set. A card can come
 * back with an empty array — the caller falls back to the venue plate, which
 * is always available.
 */
export function allocatePlateTerms(
  papers: PlateTermInput[],
  readerTopics: string[],
): Record<string, string[]> {
  const banned = new Set(readerTopics.map(normalize).filter(Boolean));
  const usage = new Map<string, number>();
  const out: Record<string, string[]> = {};

  for (const paper of papers) {
    const kept: string[] = [];
    const isGrounded = groundedIn(paper);
    for (const raw of paper.summaryExperimentKeywords ?? []) {
      if (kept.length >= MAX_TERMS_PER_CARD) break;
      const term = raw.trim();
      if (!term) continue;
      const key = normalize(term);

      // The reader's own topic, echoed back.
      if (banned.has(key)) continue;
      // A topic the reader declared, reached by substring — "protein structure"
      // when they asked for "protein structure prediction".
      if ([...banned].some((b) => b.includes(key) || key.includes(b))) continue;
      if (!passesTermRules(term, isGrounded, MAX_TERM_CHARS)) continue;
      if (subsumed(term, kept)) continue;
      if ((usage.get(key) ?? 0) >= MAX_CARDS_PER_TERM) continue;

      kept.push(term);
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
    out[paper.id] = kept;
  }

  return out;
}
