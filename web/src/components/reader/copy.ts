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

export const ABSTRACT_FOOTER = "From the abstract · claim and numbers in ink";

/** Under the lifted claim — whose sentence it is. It is chosen from the
 *  abstract's sentences, so it says the abstract whatever else Peer read. */
export const LEAD_CLAIM = "The paper's own claim, from its abstract";

/** The record: the facts that are true with no key and no model. */
export const RECORD = {
  heading: "The record",
  published: "Published",
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
  showMore: (n: number) => `Show ${n} more`,
  showFewer: "Show fewer",
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

export const NOT_FOUND = "Paper not found.";

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
