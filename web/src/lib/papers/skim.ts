// The skim line — the one or two sentences a reader uses to decide whether to
// open a paper.
//
// The feed card used to show `summaryIntro`, which `splitAbstractForBriefing`
// defines as the first one or two sentences of the abstract. For an academic
// abstract that is the motivation, and motivation is near-identical across
// every paper in a field. A live ten-card briefing on protein structure showed:
//
//   "Protein structure prediction remains a grand challenge in computational
//    biology."
//   "Protein structure prediction remains a significant challenge in
//    bioinformatics, directly impacting our understanding of biological
//    processes and drug discovery."
//   "Predicting the 3D structure of a protein from its amino acid sequence
//    remains a grand challenge in computational biology."
//
// Three cards, three ways of saying the field is hard, and nothing about what
// any of the three papers did. Everything that distinguished them sat in
// `summaryResultDiscussion` — the rest of the abstract, which no surface read.
//
// This picks from the whole abstract instead, preferring sentences that carry a
// claim or a result. It is deterministic and calls nothing, so it is the Tier 0
// floor: the briefing reads sensibly with no API key, and a real digest
// sentence still wins when one is available.

/** Openers that describe the field rather than the paper. */
const BOILERPLATE = [
  /\bremains? (?:a|one of) /i,
  /\bis (?:a|one of) the most /i,
  /\bhas (?:emerged|become|attracted|gained|received) /i,
  /\bplays? (?:a|an) (?:important|crucial|key|vital|significant) role/i,
  /\bin recent years\b/i,
  /\bwith the (?:rapid )?(?:development|advent|growth|rise|increase)/i,
  /\bis (?:a|an) (?:grand|significant|major|open|long-standing) (?:challenge|problem)/i,
  /\bhas long been\b/i,
  /\bis of (?:great|growing) (?:interest|importance)/i,
];

/** Phrases that mark the paper's own contribution or finding. */
const CLAIM = [
  /\bwe (?:show|find|demonstrate|prove|observe|report|propose|present|introduce|develop|derive)\b/i,
  /\b(?:this|our) (?:paper|work|study|method|approach|model|framework)\b/i,
  /\bresults? (?:show|indicate|suggest|demonstrate|reveal)\b/i,
  /\b(?:outperform|surpass|exceed|improv|reduc|increas|achiev|reach)\w*\b/i,
  /\bcompared (?:to|with)\b/i,
  /\bstate[- ]of[- ]the[- ]art\b/i,
  /\bwe (?:then |also |further )?(?:evaluate|validate|test|apply|train)\b/i,
];

/**
 * A back-reference to something in an earlier sentence. Lifting such a sentence
 * out of the abstract leaves the reference dangling — "This work explores the
 * application of GNNs to address this challenge" does not say which challenge.
 * Sentences that stand on their own are preferred; one of these still wins over
 * pure boilerplate.
 */
const DANGLING_REFERENCE = [
  /\bthis (?:challenge|problem|issue|task|gap|question|limitation|approach|method|phenomenon)\b/i,
  /\bthese (?:challenges|problems|issues|methods|approaches|limitations)\b/i,
  /\bsuch (?:methods|approaches|systems|models)\b/i,
  /^(?:however|therefore|thus|hence|consequently|to this end|to address this)\b/i,
  /\bthe (?:former|latter)\b/i,
];

/** A concrete quantity is the strongest signal an abstract sentence carries. */
const QUANTITY = /\d+(?:\.\d+)?\s*(?:%|percent|×|x\b|fold\b)|\b\d+(?:\.\d+)?\b/;

/**
 * A quantity with a unit or a comparison attached — the sentence that says how
 * big. `QUANTITY` above accepts any bare number and is right for ranking a
 * whole abstract (a year or a dataset size still marks the sentence that did
 * something); this is the stricter test the reading page uses to pick the one
 * sentence it sets in ink as "the number", and to keep a bare "CASP14" from
 * counting as a result.
 */
export const QUANTITY_STRICT =
  /\d[\d.,]*\s?(%|percent|×|x\b|-?fold\b|pp\b|points?\b|ms\b|s\b|min\b|h\b|nm\b|µm\b|mm\b|cm\b|kg\b|mg\b|dB\b|[GM]?Hz\b|K\b|°C\b|AUC\b|F1\b|BLEU\b|mAP\b)|\bp\s?[<=]\s?0?\.\d+|\d+(\.\d+)?\s?(vs\.?|versus)\s?\d/i;

/**
 * The sentence in the last stretch of an abstract that says why the result
 * matters. Weaker than a claim, so it is only ever the third mark.
 */
const SIGNIFICANCE =
  /\b(suggest|demonstrat|enabl|pave|implication|potential|provid|open|highlight|establish)\w*/i;

const MIN_SENTENCE_CHARS = 40;
const MAX_SKIM_CHARS = 260;
/** Marks that cover more of the abstract than this are not marks any more. */
const MAX_MARKED_FRACTION = 0.6;

/**
 * A period that ends an abbreviation, not a sentence. "Fig. 3 shows 0.5 mm."
 * split at "Fig." used to yield a four-character fragment and a sentence that
 * began "3 shows"; a single initial ("J. Smith") did the same to author names
 * quoted in a results section. Decimals never split — the splitter needs
 * whitespace after the period.
 */
const ABBREVIATION =
  /(?:\b(?:et al|Figs?|Eqs?|vs|i\.e|e\.g|ca|approx|cf|resp|Refs?|Tab|No)|\b[A-Z])\.$/;

/**
 * Split running text into sentences.
 *
 * The OpenAlex reconstruction of an abstract often has no terminal period; it
 * comes back as one sentence, which is what it is. A piece that starts in
 * lower case continues the sentence before it — a period followed by a
 * lower-case word is an abbreviation the list above does not know.
 */
export function splitSentences(text: string): string[] {
  const pieces = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const out: string[] = [];
  for (const piece of pieces) {
    const previous = out[out.length - 1];
    if (previous && (ABBREVIATION.test(previous) || /^[a-z]/.test(piece))) {
      out[out.length - 1] = `${previous} ${piece}`;
    } else {
      out.push(piece);
    }
  }
  return out;
}

/** Field-not-paper openers; exported so the reading never quotes one. */
export function isBoilerplate(sentence: string): boolean {
  return BOILERPLATE.some((re) => re.test(sentence));
}

/**
 * How much a sentence says about the paper itself. Positive is a claim or a
 * result; negative is the field, a dangling reference or a fragment. `index`
 * is the sentence's position in its abstract — pass 0 when ranking sentences
 * pulled from a whole section, where position carries no such signal.
 */
export function scoreSentence(sentence: string, index: number): number {
  let score = 0;
  if (CLAIM.some((re) => re.test(sentence))) score += 3;
  if (QUANTITY.test(sentence)) score += 2;
  if (BOILERPLATE.some((re) => re.test(sentence))) score -= 4;
  // Prefer a sentence that stands on its own, but not so strongly that a
  // dangling reference loses to a sentence about the state of the field.
  if (DANGLING_REFERENCE.some((re) => re.test(sentence))) score -= 1.5;
  // Short sentences are penalised, not excluded — "It matches larger models on
  // CASP15." is 35 characters and is exactly the line a reader wants.
  if (sentence.length < MIN_SENTENCE_CHARS) score -= 1.5;
  // Among equally strong sentences the earlier one is usually the headline
  // claim rather than a caveat or a future-work note.
  score -= index * 0.15;
  return score;
}

function isClaim(sentence: string | undefined): boolean {
  if (!sentence) return false;
  return (
    CLAIM.some((re) => re.test(sentence)) &&
    !BOILERPLATE.some((re) => re.test(sentence))
  );
}

/**
 * Pick the skim line for a paper from its abstract.
 *
 * `intro` and `discussion` are the two halves `rawItemToPaper` already stores
 * on every Paper (`summaryIntro`, `summaryResultDiscussion`). Pass both; this
 * reads the abstract as one piece.
 *
 * Returns null when there is nothing usable, so the caller keeps its own
 * fallback.
 */
export function pickSkimSentence(
  intro: string | null | undefined,
  discussion?: string | null,
): string | null {
  const whole = [intro?.trim(), discussion?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!whole) return null;

  const sentences = splitSentences(whole);
  if (sentences.length === 0) return null;
  if (sentences.length === 1) return truncate(sentences[0]);

  let bestIndex = 0;
  let bestScore = -Infinity;
  sentences.forEach((sentence, index) => {
    const score = scoreSentence(sentence, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  // "Our model reaches 94% precision" is the strongest single sentence, but it
  // reads as an orphan without the proposal it belongs to. When the sentence
  // before it states what the paper did, lead with that instead.
  let start = bestIndex;
  if (bestIndex > 0 && isClaim(sentences[bestIndex - 1])) {
    const pair = `${sentences[bestIndex - 1]} ${sentences[bestIndex]}`;
    if (pair.length <= MAX_SKIM_CHARS) start = bestIndex - 1;
  }

  let out = sentences[start];
  for (let i = start + 1; i <= bestIndex; i += 1) {
    out = `${out} ${sentences[i]}`;
  }

  // A claim sentence often needs the one after it to land ("We propose X. It
  // reaches 94% on Y."). Add the follower when there is room.
  const follower = sentences[bestIndex + 1];
  if (follower && out.length + follower.length + 1 <= MAX_SKIM_CHARS) {
    out = `${out} ${follower}`;
  }
  return truncate(out);
}

/**
 * Which sentences of an abstract to set in ink on the reading page: the claim,
 * the number and, when the abstract is long enough to have one, the sentence
 * that says why it matters. Returns indices in ascending order.
 *
 * Nothing is marked in a one- or two-sentence abstract — everything is the
 * claim already. Marks are capped at 60% of the text because an abstract that
 * is mostly ink has no ink; the lowest-scoring mark goes first.
 */
export function pickSkimMarks(sentences: string[]): number[] {
  const n = sentences.length;
  if (n <= 2) return [];

  const scores = sentences.map((sentence, index) => scoreSentence(sentence, index));
  const best = (indices: number[]): number | null => {
    let winner: number | null = null;
    for (const i of indices) {
      if (winner === null || scores[i] > scores[winner]) winner = i;
    }
    return winner;
  };

  // The claim: the best sentence that is about the paper. A boilerplate opener
  // never wins — when every sentence is about the field there is no claim to
  // mark.
  const claim = best(
    sentences.map((_, i) => i).filter((i) => !isBoilerplate(sentences[i])),
  );
  if (claim === null) return [];
  const marks = new Set<number>([claim]);

  // The number: the strongest sentence with a unit or comparison attached.
  const quantity = best(
    sentences
      .map((_, i) => i)
      .filter(
        (i) =>
          i !== claim &&
          scores[i] >= 0 &&
          QUANTITY_STRICT.test(sentences[i]) &&
          !isBoilerplate(sentences[i]),
      ),
  );
  if (quantity !== null) marks.add(quantity);

  // The significance: only from the last 40%, where abstracts put it.
  const tailStart = Math.floor(n * 0.6);
  const significance = best(
    sentences
      .map((_, i) => i)
      .filter(
        (i) =>
          i >= tailStart &&
          !marks.has(i) &&
          scores[i] >= 0 &&
          SIGNIFICANCE.test(sentences[i]) &&
          !isBoilerplate(sentences[i]),
      ),
  );
  if (significance !== null) marks.add(significance);

  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  const marked = () =>
    [...marks].reduce((sum, i) => sum + sentences[i].length, 0);
  while (marks.size > 1 && marked() > total * MAX_MARKED_FRACTION) {
    const lowest = [...marks].reduce((a, b) => (scores[b] < scores[a] ? b : a));
    marks.delete(lowest);
  }

  return [...marks].sort((a, b) => a - b);
}

function truncate(text: string): string {
  if (text.length <= MAX_SKIM_CHARS) return text;
  const cut = text.slice(0, MAX_SKIM_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : MAX_SKIM_CHARS).trimEnd()}…`;
}
