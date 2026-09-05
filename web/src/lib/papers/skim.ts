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

const MIN_SENTENCE_CHARS = 40;
const MAX_SKIM_CHARS = 260;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function scoreSentence(sentence: string, index: number): number {
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

function truncate(text: string): string {
  if (text.length <= MAX_SKIM_CHARS) return text;
  const cut = text.slice(0, MAX_SKIM_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : MAX_SKIM_CHARS).trimEnd()}…`;
}
