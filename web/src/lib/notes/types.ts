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
  | "paper";

export interface Block {
  id: string;
  type: BlockType;
  /** Inline Markdown. Empty for a divider and a paper card. */
  text: string;
  /** 0–4: lists and paragraphs nest the way an outline does. */
  indent?: number;
  /** A to-do's state. */
  checked?: boolean;
  /** A paper card's source — a key into the note's `sources`. */
  cite?: string;
  /** A template's prompt, shown only while the block is empty. Never exported. */
  hint?: string;
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
