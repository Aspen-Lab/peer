// A note: the reader's own writing, next to the papers they saved.
//
// Blocks, the way Notion and Logseq cut a page: every paragraph is a unit that
// can be retyped, moved, indented or turned into another kind of block. The
// text of a block is inline Markdown — the way Obsidian keeps a note — so what
// is stored is exactly what is exported, and a block's source is readable
// without Peer.
//
// Papers enter a note as SOURCES: a snapshot of the paper's record under a
// citation key (`rose2024applications`), cited inline as `[@key]` — Pandoc's
// syntax, so an exported draft goes through Pandoc to LaTeX or Word with its
// references intact. The snapshot is taken when the paper is cited, so the
// note still reads the same after the paper leaves the shelf.

export type BlockType =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "divider"
  | "paper"
  | "highlight";

/** P10-09a (ruling §1h.78 (f)): the passage a sticky note was taken on. It rides on the sticky's `h3` block
 *  ("Note N") and is never a block's text, so no export carries it. */
export interface NoteAnchor {
  /** Ordered source provenance of a selection crossing drawable blocks. Never exported. */
  segments?: PassageSegment[];
  paperId: string;
  /** The paper's paragraph, as `paragraphAnchor` writes it (`paper-section-1-p2`). */
  paragraphId: string;
  /** The passage's start, at most 300 characters: what the tag and the blue square stand for. */
  quote: string;
  /** The sticky's number in the paper's note; it never changes. */
  n: number;
  /** P10-09f (review 7.1c): where the words stand in the paragraph — character offsets, `start` inclusive and `end`
   *  exclusive, in the paragraph's text as the body renders it. Both absent when the passage was not found whole in
   *  the paragraph at creation: no mark is drawn then and the tag stands at the paragraph's end. */
  start?: number;
  end?: number;
}

/** P11-07 (owner item 8; ruling §1h.112 D3): the six colours a highlight can wear. The table behind the ids (names, fills)
 *  is `highlight-colours.ts`; a stored id that is not one of these reads as `yellow`. */
export type HighlightColourId = "yellow" | "green" | "blue" | "pink" | "orange" | "ink";

/** One actual drawable range, in document order. Offsets belong to this block alone. */
export interface PassageSegment {
  paragraphId: string;
  quote: string;
  start: number;
  end: number;
  source?: "paper" | "summary" | "answer";
  kind?: "paragraph" | "heading" | "caption";
}

/** P11-07 (B P11-04 §2.2): the words a highlight was made on. It rides on a block of its own (`type: "highlight"`, `text`
 *  empty) in the paper's note — not on a sticky's `anchor` — so a highlight is never numbered, never tagged and never taken
 *  for an empty sticky. Unlike a sticky's quote, `quote` is the WHOLE passage: the highlight's words are its content. */
export interface HighlightSpot {
  /** Additive group representation; legacy records keep their single primary range. */
  segments?: PassageSegment[];
  paperId: string;
  /** The paper's paragraph, as `paragraphAnchor` writes it (`paper-section-1-p2`). */
  paragraphId: string;
  /** The whole selected passage, whitespace collapsed, whatever its length (P11-47: it had a limit of 1,200 characters, the selection's own cap). */
  quote: string;
  /** Where the words stand in the paragraph's text as the body renders it: `start` inclusive, `end` exclusive. Always present:
   *  a highlight whose passage was not found whole is not made. */
  start: number;
  end: number;
  colour: HighlightColourId;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Inline Markdown. Empty for a divider, a paper card and a highlight. */
  text: string;
  /** 0–4: lists and paragraphs nest the way an outline does. */
  indent?: number;
  /** A to-do's state. */
  checked?: boolean;
  /** A paper card's source — a key into the note's `sources`. */
  cite?: string;
  /** A template's prompt, shown only while the block is empty. Never exported. */
  hint?: string;
  /** A sticky note's heading ("Note N") carries the passage it was taken on. Never exported. */
  anchor?: NoteAnchor;
  /** Explicit owner for structured sticky content; old text-only notes need no migration. */
  stickyId?: string;
  /** An explicitly saved empty sticky is intentional, rather than an abandoned draft. */
  stickySaved?: boolean;
  /** P11-07: a highlight's words, their place in the paper and their colour; only on a block of type `highlight`. */
  highlight?: HighlightSpot;
}

export interface Source {
  /** The citation key, as `[@key]` names it. */
  key: string;
  paperId: string;
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  doi?: string;
  url?: string;
}

export interface Note {
  id: string;
  title: string;
  blocks: Block[];
  /** Every paper this note has cited, by key. */
  sources: Record<string, Source>;
  /** Set on a paper's own reading notes — the note its "Take notes" opens. */
  paperId?: string;
  /** How many sticky notes this note has had; the next one is `stickyCount + 1`. */
  stickyCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** What a note can cite: any paper Peer has a record of. The shelf and today's
 *  briefing carry the whole record; the reading library keeps less. */
export interface Citable {
  id: string;
  title: string;
  authors: string[];
  venue?: string;
  publishedDate?: string;
  doi?: string;
  url?: string;
  /** The paper's own abstract, where the record has it. */
  abstract?: string;
}
