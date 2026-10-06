// The reading page's fixed words, in one place.
//
// Everything a reader can see on `/papers/[id]` that is not the paper's own
// text comes from a table: the availability sentence from
// `describeAvailability`, the keys from `PAPER_KEYS`, the omissions from
// `omitted` — and the labels below. Nothing here is a status; a status string
// typed in JSX is the thing this page was rebuilt to remove. Sentence case
// throughout; nothing uppercase.

import { displayHeading, type ReadingBlock } from "@/lib/papers/reading";

/** Block headings, sentence case, never doubled. Same words as the Markdown export. */
export const BLOCK_HEADING: Record<Exclude<ReadingBlock, "skim">, string> = {
  findings: "What they found, and how big",
  method: "How it was done",
  caveats: "Where it is thin",
  forYou: "For your project",
  nextStep: "Next step",
};

/**
 * The restored report sections, in the order the old report read them:
 * proposal, results (or a review's contents), a glance, and what else
 * today's briefing holds. Named in this page's voice — sentence case, what
 * Peer did with the paper — not the old title-case labels.
 *
 * S6 (2026-09): "What is new" merged into "What it proposes" (they
 * duplicated each other) and "Why it fits you" was deleted outright.
 */
export const REPORT_HEADING = {
  proposal: "What it proposes",
  review: "What the review covers",
  glance: "At a glance",
  related: "Related from your feed",
} as const;

/** P2-04: verified answers to the reader's own questions. */
export const FOR_YOUR_QUESTIONS = {
  heading: "For your questions",
  answered: "Answered",
  partly: "Partly answered",
  /** P2-04b (§1g.15): the reader's own words end the sentence when they already
   *  end like one ("…recycling?"); a period is added only otherwise. P2-05
   *  item 0: the full-width ？ ！ 。 of a CJK keyboard end one just the same. */
  notAddressed: (question: string) => {
    const asked = question.trim();
    return `This paper does not address: ${asked}${/[?.!？！。]$/.test(asked) ? "" : "."}`;
  },
  /** P2-08b (§1g.21 (2)): the model offered answers and every one failed
   *  verification — Peer's own words, never a claim about the paper. */
  unverified: "Peer could not verify an answer in the paper's own words.",
  readNext: "Read next",
  background: "background",
} as const;

/**
 * P2-09 (§1g.14): why the report on the page is the shorter one, in Peer's
 * voice, when the server says a cap or an outage refused the deep read. Three
 * lines, chosen by `quotaNoticeText` (`quota-notice.tsx`): a spent deep-report
 * or breaker allowance, a spent shared model budget, and — never confused with
 * a spent allowance or budget — a check that could not be made, for any of the
 * three kinds, where nothing was spent (P2-08b, §1g.14 amendment 3).
 */
export const QUOTA = {
  exhausted: "Deep reports are used up for now. This is the shorter report.",
  companyBudget: "Peer's shared model budget is spent for now. This is the shorter report.",
  unavailable:
    "Peer could not check the deep-report allowance just now. This is the shorter report; nothing was spent.",
} as const;

/** Under a block Peer wrote with no sentence of the paper to show for it. */
export const PEERS_READING = "Peer's reading — not a quote";

/** Before a result's novelty line. */
export const WHATS_NEW = "What is new here:";

/** The glance facts. */
export const GLANCE = {
  preprint: "Preprint on arXiv",
  journal: (venue: string) => `Published in ${venue}`,
  code: "Code available",
  match: (score: number) => `${Math.round(score * 100)}% match to your topics`,
  team: (n: number) =>
    n === 1 ? "Solo author" : n <= 3 ? `${n} authors · small team` : n <= 10 ? `${n} authors` : `${n} authors · large team`,
} as const;

export const ABSTRACT_FOOTER = "From the abstract · claim and numbers in ink";

/** Under the lifted claim — whose sentence it is. It is chosen from the
 *  abstract's sentences, so it says the abstract whatever else Peer read. */
export const LEAD_CLAIM = "The paper's own claim, from its abstract";
export const LEAD_CLAIM_LABEL = "The claim";
// 8-03/S25: was "The abstract" (a Band section label). Now the visible text
// of a button that opens/closes the abstract — "Abstract" alone reads right
// in that role. One consumer (paper-words.tsx).
export const ABSTRACT_LABEL = "Abstract";

/** The paper itself, when the extractor reached it. */
export const BODY = {
  heading: "The paper",
  open: "Read it here",
  /** Where the text came from, and how much of it there is. */
  provenance: (sourceLabel: string | undefined, sections: number, words: number) => {
    const size = `${sections} section${sections === 1 ? "" : "s"} \u00b7 ${words.toLocaleString("en-US")} words`;
    return sourceLabel ? `Read from ${sourceLabel} \u00b7 ${size}` : size;
  },
} as const;

/**
 * P1-03 (§1f.10): "Before you read" — the question field.
 *
 * P1-09 (user decision §1a.7, ruling §1f.20): the example tags come only from
 * the reader — questions they wrote on earlier papers, and their profile
 * turned into questions by the templates below. The blueprint's generic
 * chips are gone. "Just get the gist" is a reading mode, not an example, and
 * stays as a control of its own.
 */
export const ASK = {
  heading: "Before you read",
  placeholder: "What do you want this paper to answer?",
  hint: "Up to five questions. Peer points you to the sections that mention them.",
  fromEarlier: "From your earlier questions",
  fromProfile: "From your profile",
  /** The profile, asked as questions (`lib/reader/question-examples.ts`). */
  examples: {
    challenge: (phrase: string) => `Does this help with ${phrase}?`,
    project: (phrase: string) => `How does this relate to ${phrase}?`,
    topic: (topic: string) => `What does it say about ${topic}?`,
    method: (method: string) => `Could I use ${method} here?`,
  },
  chips: {
    gist: "Just get the gist",
  },
  line: (n: number) => `Question ${n}`,
  remove: (n: number) => `Remove question ${n}`,
  counter: (n: number) => `${n}/200`,
} as const;

/**
 * P1-04 (§1f.12): the reading map under the question field. The role labels
 * are a reader's names for the section buckets; `body` (a heading Peer could
 * not place) has none.
 */
export const MAP = {
  heading: "Map",
  summary: (sections: number, minutes: number) =>
    `${sections} section${sections === 1 ? "" : "s"} \u00b7 about ${minutes} min`,
  show: "show map",
  hide: "hide map",
  roles: {
    setup: "setup",
    method: "method",
    evidence: "evidence",
    interpretation: "interpretation",
    apparatus: "apparatus",
  },
  page: (page: number) => `p.${page}`,
  minutes: (minutes: number) => `${minutes} min`,
  openLines: (heading: string) => `Show how the paragraphs of ${heading} open`,
  closeLines: (heading: string) => `Hide how the paragraphs of ${heading} open`,
} as const;

/**
 * P1-05 (§1f.13; blueprint §2 boundary 1, §3.3): the route's words. A tier is
 * a suggestion of how to read a section, stated as a fact about the section —
 * "not mentioned", never a verdict on it. `background` is Tier 2's (P2).
 */
export const ROUTE = {
  tiers: {
    read: "read",
    background: "background",
    skim: "skim",
    none: "not mentioned",
  },
  vague: "Ask something more specific and Peer can point you to the right sections.",
  /** P2-04b: the map's fact line for a `background` mark with no Tier 0 hits
   *  (the report named the section as context for an answer; no count to give). */
  backgroundWhy: "background · context for an answer",
  /** The facts behind a tint: the reader's terms the section uses, and how often. */
  mentions: (hits: ReadonlyArray<{ term: string; count: number }>) =>
    `mentions ${hits
      .slice(0, 3)
      .map((hit) => `${hit.term} ×${hit.count}`)
      .join(", ")}`,
  /** The questions that tinted a row: "Q1, Q3". */
  questions: (numbers: readonly number[]) => numbers.map((n) => `Q${n}`).join(", "),
} as const;

/**
 * P3-01 (§1h.1; blueprint §3.5 ⑤ 词): the strip under the map. A term is a
 * button that points at its first use in the paper; its name says so for the
 * reader who cannot see the highlight. The definitions are the paper's own
 * sentences (quoted, attributed) or Peer's, labelled `PEERS_READING`.
 */
export const TERMS = {
  heading: "Terms to know",
  find: (term: string) => `Find ${term} in the paper`,
} as const;

/** The reader's own context for the paper: what they read or kept nearby. */
export const LIBRARY = {
  heading: "In your library",
  none: "Nothing you have read or kept shares its topics yet.",
  topics: "Its topics",
  kind: { read: "Read", saved: "Kept" } as const,
  shares: (topics: string[]) =>
    topics.length === 1 ? `shares ${topics[0]}` : `shares ${topics.slice(0, 2).join(", ")}${topics.length > 2 ? ` +${topics.length - 2}` : ""}`,
} as const;

/** The record: the facts that are true with no key and no model. */
export const RECORD = {
  heading: "The record",
  published: "Published",
  venue: "Venue",
  links: "Links",
  arxiv: "arXiv",
  publisher: "Publisher",
  code: "Code",
  scholar: "Scholar",
} as const;

export const TLDR_LINE =
  "TLDR by Semantic Scholar — machine-written, not the authors' words";

export function skimFooter(basis: "model-abstract" | "model-fulltext"): string {
  return basis === "model-fulltext"
    ? "Peer's skim, from the full text"
    : "Peer's skim, from the abstract";
}

/** "abstract" as itself; a section heading with the § the export also uses. */
export function attribution(where: string): string {
  return where === "abstract" ? "abstract" : `§${displayHeading(where)}`;
}

export function sharedTermsLine(terms: string[]): string {
  return `Shares terms with your project: ${terms.join(", ")}.`;
}

const ANCHOR_CHARS = 100;

export function projectAnchor(basedOn: string): string {
  const text = basedOn.trim();
  return text.length > ANCHOR_CHARS
    ? `Your project: ${text.slice(0, ANCHOR_CHARS)}…`
    : `Your project: ${text}`;
}

export const RAIL = {
  back: "← Briefing",
  position: (index: number, total: number) => `${index + 1} of ${total}`,
};

export const BUTTON = {
  save: "Save",
  saved: "Saved",
  skip: "Skip",
  copy: "Copy",
  addKey: "Add a key",
};

/** The swipe reveal under the plate — the card's own labels. */
export const SWIPE = {
  save: "Save",
  unsave: "Unsave",
  notInterested: "Not interested",
};

export const AUTHORS = {
  showMore: (n: number) => `and ${n} more`,
  showFewer: "fewer",
};

export const NEXT_ROW = {
  next: (index: number, total: number) => `Next · ${index + 1} of ${total}`,
  read: "Read it",
  last: "Back to the briefing",
  deepLink: "Today's briefing",
};

/** The DOI line is a button that copies; its visible text alone does not say so. */
export const DOI = {
  copy: (doi: string) => `Copy DOI ${doi}`,
};

export const TOAST = {
  doi: "DOI copied",
  copied: (words: number) => `Copied · ${words.toLocaleString("en-US")} words`,
};

/** Appended to the availability sentence while the model works. */
export function progressSuffix(stageLabel: string): string {
  return ` — ${stageLabel}…`;
}

/** S19: the fixed label under the relocated progress bar — always this
 * exact string, never the pipeline-stage label `progressSuffix` names. */
export const PROGRESS_LABEL = "loading report...";

export const NOT_FOUND = "Paper not found.";

/**
 * UPLOAD-404 (§1bi): the live copy of an uploaded paper could not be
 * fetched — any cause (expired, wrong owner, purged, a different machine, a
 * synced pointer) — but this reader already has it saved. Cause-agnostic on
 * purpose: the client cannot tell these apart (`ownedUpload` hides which one
 * behind a single 404), and naming one would be a guess this page cannot
 * back up.
 */
export const UPLOAD_UNAVAILABLE_MESSAGE =
  "This PDF is not available here anymore — here is what was saved of it.";

/**
 * UPLOAD-404 (§1bi.8b): a TRANSIENT failure (a 5xx, a dropped connection, a
 * timeout) — never shown for a 404, which is `UPLOAD_UNAVAILABLE_MESSAGE`'s
 * job. Pairs with a Try again control; never used alone with no way to
 * retry (see `UPLOAD_RETRY_EMPTY_MESSAGE` for the no-saved-copy case).
 */
export const UPLOAD_TRANSIENT_MESSAGE =
  "This PDF could not be loaded right now — here is what was saved of it.";

/**
 * UPLOAD-404 (§1bi.8b): the same transient failure as
 * `UPLOAD_TRANSIENT_MESSAGE`, but with no saved copy to show either — never
 * `NOT_FOUND`, which would wrongly claim the paper is permanently gone
 * rather than momentarily unreachable. Also pairs with a Try again control.
 */
export const UPLOAD_RETRY_EMPTY_MESSAGE = "Could not load this paper right now.";

/** UPLOAD-404 (§1bi.8b): the one retry control's label, both places it can
 *  appear (a saved copy shown with a transient sentence, or no content at
 *  all) — same word `BRIEFING_EMPTY.error.retry` already uses on the home
 *  page's own error state, for the same action in the reader's voice. */
export const RETRY_LABEL = "Try again";

/** ≤140 chars under the plate, when the resolver returned a caption. */
export const CAPTION_CHARS = 140;

export function plateCaption(caption: string | null | undefined): string | null {
  const text = caption?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= CAPTION_CHARS) return text;
  // At the character it fell on: "…seed samples (top row), sh…". A caption is
  // prose, and prose breaks at a word.
  const cut = text.slice(0, CAPTION_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > CAPTION_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
