"use client";

// The note editor: blocks, the way Notion and Logseq cut a page, over
// Markdown, the way Obsidian keeps one.
//
// The model is Logseq's: every block is rendered — headings, lists, citations
// as "Rose et al., 2024" — and the one being typed in is the same rendering,
// made editable. P10-16 (the owner's ruling, §1h.90 (a): "what the reader sees,
// and what is exported, is always the final look, like a Word document, never
// the raw code"): a block being edited is a `contentEditable` element drawn from
// its source by `lib/notes/wysiwyg.ts` — bold, italic, underline, highlight, code
// and chips for citations and links, never a `**`, `__`, `==` or backtick — and
// the DOM the reader edits is written back to the same source on every input
// (the stored format, and the `.md` export, are unchanged: Markdown is the
// format). The toolbar and the keys act on the words selected in the formatted
// text and leave them selected. Undo is a stack of sources per block (the
// browser's cannot survive the surface being drawn again). A code block keeps a
// textarea: nothing in it is markup.
//
// What a reader can do, and where it is handled:
//   type            onChange — Markdown at a block's start converts it (`# `,
//                   `- `, `1. `, `[] `, `> `, ``` and `---`); `/` opens the
//                   block menu, `@` or `[[` the citation picker
//   Enter           splits the block; on an empty list item, leaves the list
//   Backspace       at a block's start: a heading or list turns back into
//                   text, an indent comes out, then it joins the block above;
//                   a sticky's heading ("Note N", it carries the paper's anchor)
//                   stays as it is — its number is not editable text (P10-25)
//   ↑ ↓ ← →         cross into the next block from its first or last line
//   Tab             indents (a list nests); Shift-Tab outdents
//   ⌘⇧↑ ⌘⇧↓         moves the block
//   ⌘B ⌘I ⌘E ⌘U     bold, italic, code, underline around the selection (⌘⇧H highlights); the toolbar
//                   above the blocks does the same by button, and turns a block into bullets or numbers
//   ⌘Enter          ticks a to-do; elsewhere, a new block below
//   the handle      drag to move; click for turn-into, duplicate, delete
//
// Saving: the editor owns its copy while open and writes it back to the
// notes store half a second after the last change, and on leaving.

import Link from "next/link";
import { AnchorLink } from "./note-tags";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Block, BlockType, Citable, Note, NoteAnchor, Source } from "@/lib/notes/types";
import {
  block,
  canIndent,
  citedKeys,
  indentBlock,
  isList,
  isTextual,
  listNumber,
  moveBlock,
  nextType,
  parseMarkdown,
  shortcut,
  wordCount,
} from "@/lib/notes/blocks";
import { authorYear, citableFromPaper, keyFor, sourceOf } from "@/lib/notes/cite";
import { carriesPaper, gapAt, readPaperDrag } from "@/lib/notes/drag";
import { plainInline, type MarkName } from "@/lib/notes/inline";
import {
  caretBox,
  caretLines,
  getPlainSelection,
  insertMarked,
  joinSources,
  marksOpenAt,
  pressMark,
  newHistory,
  plainLength,
  plainOfSource,
  plainOfSourceOffset,
  recordState,
  setPlainSelection,
  sourceOfPlain,
  spliceSource,
  splitSource,
  stepBack,
  stepForward,
  treeOf,
  type History,
  type HistoryState,
  type Label,
} from "@/lib/notes/wysiwyg";
import { fileName, reference, toBibtex, toMarkdown } from "@/lib/notes/export";
import { blankNote } from "@/lib/notes/templates";
import { newestFirst, useNotesStore } from "@/store/notes";
import { useFeedStore } from "@/store/feed";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { caretCoords, caretLine, offsetFromPoint } from "./caret";
import { InlineText } from "./inline-text";
import { NoteToolbar, markForKey, typeAfterToggle } from "./note-toolbar";
import { Surface, insertText, type SurfaceEdit } from "./wysiwyg-field";
import { EditorRail, type RailTab } from "./notes-rail";

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };
/** Where the caret goes: a source offset, either end, or a plain (visible-character) range, which stays over the same
 *  words whatever marks now wrap them. */
type Caret = number | "start" | "end" | { plain: number; to?: number };

type Menu =
  | { kind: "slash"; blockId: string; from: number; query: string; index: number }
  | {
      kind: "cite";
      blockId: string;
      from: number;
      /** What was typed to open it, and is replaced by what is picked. */
      trigger: "" | "@" | "[[";
      /** Inline cites `[@key]` into the text; card places a paper card block. */
      mode: "inline" | "card";
      query: string;
      index: number;
    };

type Candidate =
  | { kind: "paper"; group: string; citable: Citable; label: string; detail: string }
  | { kind: "note"; group: string; id: string; label: string; detail: string };

const SLASH: { id: BlockType | "cite"; label: string; hint: string; words: string }[] = [
  { id: "text", label: "Text", hint: "", words: "text paragraph plain" },
  { id: "h1", label: "Heading 1", hint: "#", words: "heading title h1" },
  { id: "h2", label: "Heading 2", hint: "##", words: "heading section h2" },
  { id: "h3", label: "Heading 3", hint: "###", words: "heading subsection h3" },
  { id: "bullet", label: "Bulleted list", hint: "-", words: "bullet list unordered" },
  { id: "numbered", label: "Numbered list", hint: "1.", words: "numbered list ordered" },
  { id: "todo", label: "To-do", hint: "[]", words: "todo task checkbox" },
  { id: "quote", label: "Quote", hint: ">", words: "quote blockquote" },
  { id: "code", label: "Code", hint: "```", words: "code latex math equation" },
  { id: "divider", label: "Divider", hint: "---", words: "divider rule line" },
  { id: "paper", label: "Paper card", hint: "", words: "paper card source" },
  { id: "cite", label: "Cite a paper", hint: "@", words: "cite citation reference" },
];

/** The `drag.id` a paper dragged in from the rail carries. Block ids are
 *  uuids, so no row ever matches it: nothing fades out as though it were
 *  being moved, and only the gap line is drawn. */
const FROM_RAIL = "rail";

const TURN_INTO: BlockType[] = ["text", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "code"];
const TYPE_LABEL: Record<BlockType, string> = {
  text: "Text",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "Bulleted list",
  numbered: "Numbered list",
  todo: "To-do",
  quote: "Quote",
  code: "Code",
  divider: "Divider",
  paper: "Paper card",
};

const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  text: "Write, or type / for blocks and @ to cite",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "List",
  numbered: "List",
  todo: "To-do",
  quote: "Quote",
  code: "Code",
};

/** Each block's words are set in the product's own type: the reading face for
 *  prose (a draft is paper-to-be), the paper's display face for headings,
 *  mono for code. The textarea and the rendered view share the class, so the
 *  switch between them does not move a line. */
function textClass(type: BlockType): string {
  switch (type) {
    case "h1":
      return "paper-line text-display-sm leading-[1.25] text-heading";
    case "h2":
      return "paper-line text-display-xs leading-[1.3] text-heading";
    case "h3":
      return "font-reading font-semibold text-title leading-[1.4] text-heading";
    case "code":
      // 16px on a phone: under that, iOS zooms the page when it is tapped.
      return "font-mono text-body-sm max-sm:text-[16px] leading-[1.65] text-text";
    case "quote":
      return "reading-prose italic text-text-muted";
    default:
      return "reading-prose text-text";
  }
}

function spaceAbove(type: BlockType, first: boolean): string {
  if (first) return "";
  return type === "h1" ? "mt-8" : type === "h2" ? "mt-7" : type === "h3" ? "mt-5" : type === "divider" ? "mt-2" : "";
}

function matches(words: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).every((part) => words.toLowerCase().includes(part));
}

// ── The block row ─────────────────────────────────────────────────────────

interface RowApi {
  register: (id: string, el: HTMLElement | null) => void;
  /** A code block's textarea. */
  change: (e: ChangeEvent<HTMLTextAreaElement>, id: string) => void;
  /** The editing surface was edited: its source (written from the DOM), the visible text, and how it was edited. */
  input: (id: string, edit: SurfaceEdit) => void;
  key: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  paste: (e: ClipboardEvent<HTMLElement>, id: string) => void;
  /** The text to be typed is about to go in: true when the editor wrote it itself (a mark toggled with nothing selected). */
  typing: (id: string, data: string) => boolean;
  /** What a citation key reads as in this note. */
  label: Label;
  caret: (id: string, el: HTMLElement) => void;
  blur: (id: string) => void;
  edit: (id: string, caret: Caret) => void;
  toggle: (id: string) => void;
  addBelow: (id: string) => void;
  handleDown: (e: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  handleMove: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  handleUp: (e: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  handleCancel: () => void;
  noteId: (title: string) => string | null;
  missingNote: (title: string) => void;
  citation: (key: string) => void;
}

interface RowProps {
  block: Block;
  first: boolean;
  number: number;
  editing: boolean;
  sources: Record<string, Source>;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  api: MutableRefObject<RowApi>;
}

function Grip() {
  // Six squares, not six dots: nothing in this interface is round.
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden fill="currentColor">
      {[0, 5].map((x) => [0, 5, 10].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="2.5" height="2.5" />))}
    </svg>
  );
}

const Row = memo(function Row({ block: b, first, number, editing, sources, dragging, dropBefore, dropAfter, api }: RowProps) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const view = useRef<HTMLDivElement | null>(null);
  const cls = textClass(b.type);

  // A code block's textarea grows with its text; never scrolls inside itself.
  useLayoutEffect(() => {
    const el = area.current;
    if (!editing || !el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, b.text, b.type]);

  const textual = isTextual(b.type);
  // A template's prompt stays visible after a leading citation — "(Rose et
  // al., 2024) what it does…" — until the reader's own words arrive.
  const onlyCites = textual && plainInline(b.text, () => "").replace(/[()\s;]/g, "") === "";
  const hint = b.hint && onlyCites ? b.hint : null;

  let content: React.ReactNode;
  if (b.type === "divider") {
    content = (
      <div className="flex h-[1.6rem] items-center" aria-label="Divider">
        <span className="block h-px w-full bg-border-strong" />
      </div>
    );
  } else if (b.type === "paper") {
    const s = b.cite ? sources[b.cite] : undefined;
    content = s ? (
      <div className="cropmarks relative bg-surface shadow-card px-4 py-3">
        <p className="eyebrow text-text-faint">
          {authorYear(s)}
          {s.venue ? ` · ${s.venue}` : ""}
        </p>
        <Link href={`/papers/${s.paperId}`} className="paper-line mt-1 block text-title leading-[1.35] text-heading hover:underline">
          {s.title}
        </Link>
        {s.authors.length > 0 && (
          <p className="annotation mt-1 text-text-faint">
            {s.authors.slice(0, 4).join(", ")}
            {s.authors.length > 4 ? ` +${s.authors.length - 4}` : ""}
          </p>
        )}
      </div>
    ) : (
      <p className="annotation py-2 text-text-faint">A paper card whose source is missing.</p>
    );
  } else if (editing && b.type === "code") {
    content = (
      <textarea
        ref={(el) => {
          area.current = el;
          api.current.register(b.id, el);
        }}
        value={b.text}
        rows={1}
        data-typeset=""
        spellCheck
        placeholder={b.hint ?? PLACEHOLDER[b.type]}
        aria-label={TYPE_LABEL[b.type]}
        onChange={(e) => api.current.change(e, b.id)}
        onKeyDown={(e) => api.current.key(e, b.id)}
        onPaste={(e) => api.current.paste(e, b.id)}
        onSelect={(e) => api.current.caret(b.id, e.currentTarget)}
        onBlur={() => api.current.blur(b.id)}
        className={cn(
          cls,
          "block w-full resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:text-text-faint/70",
          "whitespace-pre",
        )}
      />
    );
  } else if (editing) {
    content = (
      <Surface
        id={b.id}
        text={b.text}
        sources={sources}
        api={api}
        label={TYPE_LABEL[b.type]}
        placeholder={b.hint ?? PLACEHOLDER[b.type] ?? ""}
        className={cn(cls, b.type === "todo" && b.checked && "text-text-faint line-through")}
      />
    );
  } else {
    content = (
      <div
        ref={view}
        onMouseDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("a,button")) return;
          e.preventDefault();
          const at = view.current ? offsetFromPoint(view.current, e.clientX, e.clientY, b.text.length) : b.text.length;
          api.current.edit(b.id, at);
        }}
        className={cn(
          cls,
          "min-h-[1lh] cursor-text whitespace-pre-wrap break-words",
          b.type === "code" && "whitespace-pre overflow-x-auto",
          b.type === "todo" && b.checked && "text-text-faint line-through",
        )}
      >
        {b.type === "code" ? (
          <span data-inner={0}>{b.text}</span>
        ) : (
          <InlineText text={b.text} sources={sources} noteId={api.current.noteId}
            onCitation={api.current.citation} onMissingNote={api.current.missingNote} />
        )}
        {hint && <span className="text-text-faint/70">{b.text.trim() ? ` ${hint}` : hint}</span>}
      </div>
    );
  }

  // The marker a list item carries, centred on its first line.
  const indent = b.indent ?? 0;
  let marker: React.ReactNode = null;
  if (b.type === "bullet") {
    marker = <span className="block h-[5px] w-[5px] bg-text-muted" />;
  } else if (b.type === "numbered") {
    marker = <span className="font-mono text-meta tabular-nums text-text-faint">{number}.</span>;
  } else if (b.type === "h3" && b.anchor) {
    // P10-09a (review 7.1c): a sticky note's heading carries the blue square back to the passage it was taken on.
    marker = <AnchorLink anchor={b.anchor} />;
  } else if (b.type === "todo") {
    marker = (
      <button
        type="button"
        role="checkbox"
        aria-checked={Boolean(b.checked)}
        aria-label={b.checked ? "Done — mark not done" : "Mark done"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => api.current.toggle(b.id)}
        className={cn(
          "grid h-[15px] w-[15px] place-items-center transition-colors",
          b.checked
            ? "bg-text-muted text-bg"
            : "shadow-[inset_0_0_0_1px_var(--color-border-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-text-muted)]",
        )}
      >
        {b.checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <div
      data-row={b.id}
      className={cn("group/row relative flex py-[3px]", spaceAbove(b.type, first))}
      style={dragging ? { opacity: 0.35 } : undefined}
    >
      {dropBefore && <span aria-hidden className="pointer-events-none absolute -top-px left-10 right-0 h-[2px] bg-accent" />}
      {/* The gutter: + adds a block below, the grip drags or opens the block's menu. */}
      <div
        className={cn(
          textClass(b.type === "paper" || b.type === "divider" ? "text" : b.type),
          "flex h-[1lh] w-10 shrink-0 items-center justify-end gap-1 pr-2 transition-opacity",
          editing ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label="Add a block below"
          onClick={() => api.current.addBelow(b.id)}
          className="grid h-5 w-4 place-items-center font-mono text-meta text-text-faint hover:text-heading"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Move this block, or open its menu"
          onPointerDown={(e) => api.current.handleDown(e, b.id)}
          onPointerMove={(e) => api.current.handleMove(e)}
          onPointerUp={(e) => api.current.handleUp(e, b.id)}
          onPointerCancel={() => api.current.handleCancel()}
          className="grid h-5 w-4 cursor-grab touch-none place-items-center text-text-faint hover:text-heading active:cursor-grabbing"
        >
          <Grip />
        </button>
      </div>
      <div className="flex min-w-0 flex-1" style={indent ? { paddingLeft: indent * 24 } : undefined}>
        {marker && <div className={cn(cls, "flex h-[1lh] w-6 shrink-0 items-center")}>{marker}</div>}
        <div
          className={cn(
            "min-w-0 flex-1",
            b.type === "quote" && "border-l-2 border-border-strong pl-4",
            b.type === "code" && "bg-bg-secondary/60 px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-border)]",
          )}
        >
          {content}
        </div>
      </div>
      {dropAfter && <span aria-hidden className="pointer-events-none absolute -bottom-px left-10 right-0 h-[2px] bg-accent" />}
    </div>
  );
});

// ── The editor ────────────────────────────────────────────────────────────

/** P10-25 (X-B5): a sticky note's heading — the `h3` that carries the paper's anchor — keeps its type. The paper reads a
 *  note's tag and mark from exactly such blocks, so a heading turned into text (Backspace at its start, the type menu,
 *  the toolbar, a join) made the tag and the mark vanish. Its words may still be edited (the tag reads the anchor's `n`,
 *  not the words); deleting a sticky is its × in the paper, or the block menu's Delete (which has its own undo). */
export function holdsItsType(b: Pick<Block, "type" | "anchor">): boolean {
  return b.type === "h3" && Boolean(b.anchor);
}

/** P10-25: what a block is besides its words — kept with each step of its undo, so ⌘/Ctrl Z gives back its type and its
 *  anchor, not only its source. */
export interface Shape {
  type: BlockType;
  anchor?: NoteAnchor;
  checked?: boolean;
  indent?: number;
}
type ShapedState = HistoryState & { shape?: Shape };

export function shapeOf(b: Pick<Block, "type" | "anchor" | "checked" | "indent">): Shape {
  return { type: b.type, anchor: b.anchor, checked: b.checked, indent: b.indent };
}

/** The block fields a step back (or forward) writes: all four, so a field the old shape lacked is cleared. */
export function shapePatch(s: Shape | undefined): Partial<Block> {
  return s ? { type: s.type, anchor: s.anchor, checked: s.checked, indent: s.indent } : {};
}

/** P10-25: the history after a block's type changed (its words as `before` and `after` say): a step of its own — the
 *  history's `recordState` folds a change that leaves the words alone into the step before it, which would lose the old
 *  type. A history that is not at `before`'s words starts again from them. `sel` is the caret (plain offsets). */
export function recordShape(
  h: History | undefined,
  before: { text: string; shape: Shape },
  after: { text: string; shape: Shape },
  sel: { from: number; to: number },
): History {
  const base = h && h.states[h.at].text === before.text ? h : newHistory({ text: before.text, ...sel, shape: before.shape } as ShapedState);
  const kept: ShapedState[] = base.states.slice(0, base.at + 1);
  kept[kept.length - 1] = { ...kept[kept.length - 1], ...sel, shape: before.shape };
  kept.push({ text: after.text, ...sel, shape: after.shape });
  const states = kept.length > 200 ? kept.slice(kept.length - 200) : kept;
  return { states, at: states.length - 1, kind: "shape", time: 0 };
}

/** P10-23: the neighbouring textual block in `step`'s direction from index `from`, skipping the hidden block (the notes
 *  page hides a reading note's title block, P10-21): the caret is never sent into a block the reader cannot see. -1 when
 *  there is none (the editor then goes to the title field, or stays). */
export function nearestVisibleTextual(blocks: readonly Block[], from: number, step: 1 | -1, hiddenBlockId?: string | null): number {
  for (let i = from + step; i >= 0 && i < blocks.length; i += step) {
    if (isTextual(blocks[i].type) && blocks[i].id !== hiddenBlockId) return i;
  }
  return -1;
}

/** P10-23: where the first block the reader writes goes when the title field's Enter finds none: after the hidden
 *  block when it stands at the top (so the title block stays the note's first), else at 0. */
export function slotAfterHidden(blocks: readonly Block[], hiddenBlockId?: string | null): number {
  return hiddenBlockId && blocks[0]?.id === hiddenBlockId ? 1 : 0;
}

/** P10-23: the footer's count of words, with the hidden block (the title the page already says once) left out. */
export function visibleWordCount(note: Pick<Note, "blocks" | "sources">, hiddenBlockId?: string | null): number {
  return wordCount(hiddenBlockId ? { ...note, blocks: note.blocks.filter((b) => b.id !== hiddenBlockId) } : note);
}

export function NoteEditor({
  note,
  compact = false,
  onDoc,
  hiddenBlockId = null,
}: {
  note: Note;
  /** P10-09b: the editor as the notes window holds it — the blocks and the toolbar alone, no rail, no page bar, no
   *  title (the window has its own header). Everything about the blocks is the same. */
  compact?: boolean;
  /** The editor's current copy, after each change — for the window's export, which cannot wait for the save. */
  onDoc?: (doc: { title: string; blocks: Block[]; sources: Record<string, Source> }) => void;
  /** P10-23: a block the page does not draw (P10-21's title block, hidden by a rule on its row). The editor still holds
   *  and saves it, but it is out of reach: the caret never moves into it, no key joins text into or out of it, and the
   *  word count leaves it out. The window does not pass one. */
  hiddenBlockId?: string | null;
}) {
  const router = useRouter();
  const saveNote = useNotesStore((s) => s.save);
  const removeNote = useNotesStore((s) => s.remove);
  const addNote = useNotesStore((s) => s.add);
  const allNotes = useNotesStore((s) => s.notes);
  const saved = useFeedStore((s) => s.savedPapers);
  const today = useFeedStore((s) => s.papers);
  const library = useFeedStore((s) => s.library);

  const initial = useRef<Doc>({
    title: note.title,
    blocks: note.blocks.length > 0 ? note.blocks : [block("text")],
    sources: note.sources,
  });
  const [doc, setDoc] = useState<Doc>(initial.current);
  const docRef = useRef(doc);
  /** Every change goes through here, so a handler that reads the doc right
   *  after writing it (a citation's source, then the text that cites it)
   *  reads what it wrote. */
  const commit = useCallback((next: Doc) => {
    docRef.current = next;
    setDoc(next);
  }, []);
  const setBlocks = (blocks: Block[]) => commit({ ...docRef.current, blocks });
  /** What a citation key reads as in the text: the read view's "Rose et al., 2024", or its key. */
  const label: Label = (key) => {
    const source = docRef.current.sources[key];
    return source ? authorYear(source) : `@${key}`;
  };
  const srcOf = (id: string) => docRef.current.blocks.find((x) => x.id === id)?.text ?? "";

  const [editing, setEditing] = useState<string | null>(null);
  /** Each block being edited: its surface (a `contentEditable`), or a code block's textarea. */
  const areas = useRef(new Map<string, HTMLElement>());
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFocus = useRef<{ id: string; caret: Caret } | null>(null);
  /** The caret last seen, as a visible-character offset, which stays true across a change of marks. */
  const lastCaret = useRef<{ id: string; plain: number } | null>(null);
  /** Each block's steps to undo: the source and the selection at each (the browser's undo cannot follow a surface that is drawn again). */
  const histories = useRef(new Map<string, History>());
  /** A mark toggled with nothing selected: the marks the next typed text wears, at the plain offset it was asked at. */
  const pendingMarks = useRef<{ id: string; plain: number; marks: MarkName[] } | null>(null);
  const [menu, setMenuState] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  const setMenu = (m: Menu | null) => {
    menuRef.current = m;
    setMenuState(m);
  };
  const [anchor, setAnchor] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ id: string; top: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** The rail as a panel, where there is no room for it as a column. */
  const [railOpen, setRailOpen] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("notes");
  /** The paper whose record the rail is showing. */
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; gap: number } | null>(null);
  /** The drag in progress, and the gap it would drop into now — read on
   *  release from here, not from state, which can be a move behind. */
  const dragStart = useRef<{
    id: string;
    y: number;
    moved: boolean;
    gap: number;
    rows: { id: string; mid: number }[];
  } | null>(null);
  const [undo, setUndo] = useState<{ block: Block; index: number } | null>(null);
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ── Saving ──
  const dirty = useRef(false);
  useEffect(() => {
    if (doc === initial.current) return;
    dirty.current = true;
    setStatus("saving");
    const t = setTimeout(() => {
      saveNote(note.id, docRef.current);
      dirty.current = false;
      setStatus("saved");
    }, 500);
    return () => clearTimeout(t);
  }, [doc, note.id, saveNote]);
  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      saveNote(note.id, docRef.current);
      dirty.current = false;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [note.id, saveNote]);

  useEffect(() => {
    if (compact) return;
    document.title = `${doc.title.trim() || "Untitled"} · Peer`;
  }, [doc.title, compact]);

  const onDocRef = useRef(onDoc);
  onDocRef.current = onDoc;
  useEffect(() => {
    onDocRef.current?.(doc);
  }, [doc]);

  // ── Focus ──
  // A render is forced even when the block is already the one being edited,
  // so the caret still moves after an edit that changed nothing else.
  const [, setTick] = useState(0);
  const focusBlock = (id: string, caret: Caret) => {
    pendingFocus.current = { id, caret };
    setEditing(id);
    setTick((n) => n + 1);
  };
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) {
      // A block can lose the caret without a blur ever reaching React — a
      // re-render that replaces its textarea drops focus on the floor, and
      // the block would sit showing its Markdown with nothing focused. If
      // nothing at all holds focus, it belongs back here.
      const held = editing ? areas.current.get(editing) : null;
      const active = document.activeElement;
      if (held && (active === null || active === document.body)) held.focus({ preventScroll: true });
      return;
    }
    const el = areas.current.get(want.id);
    if (!el) return;
    pendingFocus.current = null;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLTextAreaElement) {
      const c = want.caret;
      const pos = c === "start" ? 0 : c === "end" ? el.value.length : typeof c === "number" ? Math.min(c, el.value.length) : Math.min(c.plain, el.value.length);
      const to = typeof c === "object" && c.to !== undefined ? Math.min(c.to, el.value.length) : pos;
      el.setSelectionRange(pos, to);
      lastCaret.current = { id: want.id, plain: pos };
    } else {
      const c = want.caret;
      const total = plainLength(el);
      const from =
        c === "start" ? 0 : c === "end" ? total : typeof c === "number" ? plainOfSourceOffset(treeOf(srcOf(want.id), label), c) : Math.min(c.plain, total);
      const to = typeof c === "object" && c.to !== undefined ? Math.min(c.to, total) : from;
      setPlainSelection(el, from, to);
      lastCaret.current = { id: want.id, plain: from };
    }
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 24 || r.top < 72) el.scrollIntoView({ block: "nearest" });
  });

  // A note that was just made opens ready to write in: an empty title first,
  // else the first prompt a template left.
  useEffect(() => {
    const fresh = Date.now() - Date.parse(note.createdAt) < 15_000;
    if (!fresh) return;
    if (!initial.current.title.trim()) {
      titleRef.current?.focus();
      return;
    }
    const firstPrompt = initial.current.blocks.find((b) => b.hint && isTextual(b.type));
    if (firstPrompt) focusBlock(firstPrompt.id, "end");
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const indexOf = (id: string) => docRef.current.blocks.findIndex((b) => b.id === id);
  const nearestTextual = (from: number, step: 1 | -1): number =>
    nearestVisibleTextual(docRef.current.blocks, from, step, hiddenBlockId);
  const patch = (id: string, change: Partial<Block>) => {
    setBlocks(docRef.current.blocks.map((b) => (b.id === id ? { ...b, ...change } : b)));
  };
  const insertAt = (index: number, ...added: Block[]) => {
    const blocks = docRef.current.blocks.slice();
    blocks.splice(index, 0, ...added);
    setBlocks(blocks);
  };

  // ── The citation picker's list ──
  const candidates = useMemo<Candidate[]>(() => {
    if (!menu || menu.kind !== "cite") return [];
    const seen = new Set<string>();
    const out: Candidate[] = [];
    const push = (group: string, c: Citable) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      const source = Object.values(doc.sources).find((s) => s.paperId === c.id);
      out.push({
        kind: "paper",
        group,
        citable: c,
        label: c.title,
        // The reading library keeps no authors; its venue is what it has.
        detail: c.authors.length > 0 ? authorYear(source ?? sourceOf(c, "")) : (c.venue ?? ""),
      });
    };
    for (const key of citedKeys(doc)) {
      const s = doc.sources[key];
      if (s) push("In this note", { id: s.paperId, title: s.title, authors: s.authors, venue: s.venue, publishedDate: s.year ? String(s.year) : undefined, doi: s.doi, url: s.url });
    }
    for (const p of saved) push("Saved", citableFromPaper(p));
    for (const e of Object.values(library ?? {}).sort((a, b) => b.readAt.localeCompare(a.readAt))) {
      push("Read", { id: e.id, title: e.title, authors: [], venue: e.venue });
    }
    for (const p of today) push("Today", citableFromPaper(p));
    if (menu.trigger === "[[") {
      for (const n of newestFirst(allNotes)) {
        if (n.id === note.id) continue;
        out.push({ kind: "note", group: "Notes", id: n.id, label: n.title.trim() || "Untitled", detail: "" });
      }
    }
    return out
      .filter((c) =>
        matches(`${c.label} ${c.detail} ${c.kind === "paper" ? `${c.citable.authors.join(" ")} ${c.citable.venue ?? ""}` : ""}`, menu.query),
      )
      .slice(0, 40);
  }, [menu, doc, saved, library, today, allNotes, note.id]);

  const slashItems = useMemo(
    () => (menu?.kind === "slash" ? SLASH.filter((s) => matches(`${s.label} ${s.words} ${s.id}`, menu.query)) : []),
    [menu],
  );

  // Where the open menu sits: under the caret, or above it near the bottom
  // of the window.
  useLayoutEffect(() => {
    if (!menu) {
      setAnchor(null);
      return;
    }
    const el = areas.current.get(menu.blockId);
    const body = bodyRef.current;
    if (!el || !body) return;
    const c =
      el instanceof HTMLTextAreaElement
        ? caretCoords(el, Math.min(menu.from, el.value.length))
        : caretBox(el, plainOfSourceOffset(treeOf(srcOf(menu.blockId), label), menu.from));
    const er = el.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const top = er.top - br.top + c.top;
    const above = er.top + c.top + c.lineHeight + 300 > window.innerHeight && er.top + c.top > 320;
    setAnchor({
      top: above ? top - 6 : top + c.lineHeight + 6,
      left: Math.max(0, Math.min(er.left - br.left + c.left - 8, br.width - 340)),
      above,
    });
  }, [menu]);

  /** Where the reader's selection is in a block: source offsets (what the store and the menus speak) and visible-character offsets. */
  const selection = (id: string): { start: number; end: number; from: number; to: number; len: number } | null => {
    const el = areas.current.get(id);
    if (!el) return null;
    if (el instanceof HTMLTextAreaElement) return { start: el.selectionStart, end: el.selectionEnd, from: el.selectionStart, to: el.selectionEnd, len: el.value.length };
    const sel = getPlainSelection(el);
    if (!sel) return null;
    const tree = treeOf(srcOf(id), label);
    return { start: sourceOfPlain(tree, sel.from, "start"), end: sourceOfPlain(tree, sel.to, "end"), from: sel.from, to: sel.to, len: plainLength(el) };
  };

  /** One more step to undo in a block: its source and selection, as an edit of `kind`. `was` is the selection before it
   *  (what undo gives back): the words a mark was laid over, else the caret last seen. */
  const remember = (id: string, before: string, text: string, from: number, to: number, kind: "type" | "delete" | "edit", was?: { from: number; to: number }) => {
    const seen = lastCaret.current?.id === id ? lastCaret.current.plain : plainOfSource(before, label).length;
    const start = was ?? { from: seen, to: seen };
    // every step keeps the block's type and anchor with its words (P10-25)
    const shape = shapeOf(docRef.current.blocks.find((x) => x.id === id) ?? { type: "text" });
    let h = histories.current.get(id);
    if (!h || h.states[h.at].text !== before) h = newHistory({ text: before, ...start, shape } as ShapedState);
    const stamped = { text, from, to, shape } as ShapedState;
    histories.current.set(id, recordState(h, stamped, kind, Date.now(), start));
  };

  /** P10-25: a block's type changes — one step of its undo, with the old type and anchor kept. An anchored heading
   *  keeps its type (here, so no path can change it). `was` is the words before the change when they are not the
   *  block's own yet (a Markdown shortcut, typed). */
  const retype = (id: string, change: Partial<Block>, was?: string) => {
    const b = docRef.current.blocks.find((x) => x.id === id);
    if (!b) return;
    if (holdsItsType(b) && change.type !== undefined && change.type !== b.type) return;
    const after = { ...b, ...change };
    const sel = selection(id);
    const at = sel ? { from: sel.from, to: sel.to } : { from: 0, to: 0 };
    const from = { text: was ?? b.text, shape: shapeOf(b) };
    if (after.type !== b.type) histories.current.set(id, recordShape(histories.current.get(id), from, { text: after.text, shape: shapeOf(after) }, at));
    patch(id, change);
  };

  /** One step back (or forward) in a block's history: its source comes back and the words that were selected are selected. */
  const stepHistory = (id: string, forward: boolean) => {
    const b = docRef.current.blocks.find((x) => x.id === id);
    const h = histories.current.get(id);
    if (!b || !h || h.states[h.at].text !== b.text) return;
    const step = forward ? stepForward(h) : stepBack(h);
    if (!step) return;
    histories.current.set(id, step.history);
    pendingMarks.current = null;
    patch(id, { text: step.state.text, ...shapePatch((step.state as ShapedState).shape) });
    focusBlock(id, { plain: step.state.from, to: step.state.to });
  };

  const replaceRange = (id: string, from: number, to: number, text: string, caretAfter?: number) => {
    const el = areas.current.get(id);
    const b = docRef.current.blocks.find((x) => x.id === id);
    if (!b) return;
    // A code block's textarea: through the browser's own editing command, so ⌘Z takes the insertion back.
    if (el instanceof HTMLTextAreaElement && document.activeElement === el) {
      el.setSelectionRange(from, to);
      if (document.execCommand("insertText", false, text)) {
        if (caretAfter !== undefined) el.setSelectionRange(caretAfter, caretAfter);
        return;
      }
    }
    if (b.type === "code") {
      patch(id, { text: b.text.slice(0, from) + text + b.text.slice(to) });
      focusBlock(id, caretAfter ?? from + text.length);
      return;
    }
    // Through the tree: a mark the edit lands in stays whole.
    const next = spliceSource(b.text, from, to, text, label);
    remember(id, b.text, next.text, next.plain, next.plain, "edit");
    patch(id, { text: next.text });
    focusBlock(id, { plain: next.plain });
  };

  /** The toolbar's marks and the keys': mark the words selected in the formatted text (`markEdit`: marks nest, the selection grows to a mark's edges) and leave the same words selected. With nothing selected the mark is toggled for what is typed next. */
  const applyMark = (id: string, mark: MarkName) => {
    const b = docRef.current.blocks.find((x) => x.id === id);
    const el = areas.current.get(id);
    if (!b || !el || b.type === "code" || el instanceof HTMLTextAreaElement) return;
    const sel = getPlainSelection(el);
    if (!sel) return;
    const out = pressMark(b.text, sel, mark, pendingMarks.current?.id === id && pendingMarks.current.plain === sel.from ? pendingMarks.current.marks : null, label);
    if (out.kind === "pending") {
      // nothing selected (or only spaces): the mark is toggled for what is typed next, as in a word processor
      pendingMarks.current = { id, plain: sel.from, marks: out.marks };
      return;
    }
    // an edit that would have left a delimiter unmatched writes nothing
    if (out.kind === "none") return;
    remember(id, b.text, out.text, sel.from, sel.to, "edit", sel);
    patch(id, { text: out.text });
    focusBlock(id, { plain: sel.from, to: sel.to });
  };

  /** Bullets, numbering and the heading turn the block that holds the caret; pressing the same one again turns it back. */
  const applyType = (id: string, type: BlockType) => {
    const b = docRef.current.blocks.find((x) => x.id === id);
    if (!b || !isTextual(b.type) || holdsItsType(b)) return;
    const next = typeAfterToggle(b.type, type);
    const sel = selection(id);
    retype(id, { type: next, checked: undefined, indent: canIndent(next) ? b.indent : undefined });
    focusBlock(id, sel ? { plain: sel.from, to: sel.to } : "end");
  };

  const pick = (choice: number) => {
    const m = menuRef.current;
    if (!m) return;
    const i = indexOf(m.blockId);
    if (i === -1) return setMenu(null);
    const b = docRef.current.blocks[i];
    const caret = selection(m.blockId)?.end ?? b.text.length;
    // The block's text without the trigger and what was typed after it (cut through the tree, so no mark is left open).
    const without = () => (b.type === "code" ? b.text.slice(0, m.from) + b.text.slice(caret) : spliceSource(b.text, m.from, caret, "", label).text);
    if (m.kind === "slash") {
      const item = slashItems[choice];
      if (!item) return setMenu(null);
      setMenu(null);
      const rest = without();
      if (holdsItsType(b) && item.id !== "cite" && item.id !== "paper") {
        // a sticky's heading offers no type (the menu does not open in it); a pick that arrives anyway only takes the "/" back out
        patch(b.id, { text: rest });
        focusBlock(b.id, m.from);
        return;
      }
      if (item.id === "cite" || item.id === "paper") {
        patch(b.id, { text: rest });
        focusBlock(b.id, m.from);
        setMenu({ kind: "cite", blockId: b.id, from: m.from, trigger: "", mode: item.id === "paper" ? "card" : "inline", query: "", index: 0 });
        return;
      }
      const empty = rest.trim() === "";
      if (item.id === "divider") {
        const after = block("text");
        const blocks = docRef.current.blocks.slice();
        if (empty) blocks.splice(i, 1, block("divider"), after);
        else blocks.splice(i, 1, { ...b, text: rest }, block("divider"), after);
        setBlocks(blocks);
        focusBlock(after.id, "start");
        return;
      }
      const type = item.id as BlockType;
      if (empty) {
        retype(b.id, { type, text: rest, checked: undefined, indent: canIndent(type) ? b.indent : undefined });
        focusBlock(b.id, m.from);
      } else {
        const added = block(type);
        const blocks = docRef.current.blocks.slice();
        blocks.splice(i, 1, { ...b, text: rest }, added);
        setBlocks(blocks);
        focusBlock(added.id, "start");
      }
      return;
    }

    const c = candidates[choice];
    if (!c) return setMenu(null);
    setMenu(null);
    if (c.kind === "note") {
      replaceRange(b.id, m.from, caret, `[[${c.label}]]`);
      return;
    }
    const sources = docRef.current.sources;
    const key = keyFor(c.citable, sources);
    if (!sources[key]) commit({ ...docRef.current, sources: { ...sources, [key]: sourceOf(c.citable, key) } });
    if (m.mode === "card") {
      const rest = without();
      const card = block("paper", "", { cite: key });
      const after = block("text");
      const blocks = docRef.current.blocks.slice();
      if (rest.trim() === "") blocks.splice(i, 1, card, after);
      else blocks.splice(i, 1, { ...b, text: rest }, card, after);
      setBlocks(blocks);
      focusBlock(after.id, "start");
      return;
    }
    const next = b.text[caret];
    const inserted = `[@${key}]${next && /[\s.,;:)]/.test(next) ? "" : " "}`;
    replaceRange(b.id, m.from, caret, inserted, m.from + inserted.length);
  };

  // ── Cite from the rail: at the caret last seen, or in a new block ──
  const citeFromRail = (paper: Citable) => {
    const sources = docRef.current.sources;
    const key = keyFor(paper, sources);
    if (!sources[key]) commit({ ...docRef.current, sources: { ...sources, [key]: sourceOf(paper, key) } });
    const at = lastCaret.current;
    const b = at ? docRef.current.blocks.find((x) => x.id === at.id) : undefined;
    if (b && isTextual(b.type) && b.type !== "code") {
      const words = plainOfSource(b.text, label);
      const plain = Math.min(at!.plain, words.length);
      const pos = sourceOfPlain(treeOf(b.text, label), plain, "end");
      const lead = plain > 0 && !/\s/.test(words[plain - 1]) ? " " : "";
      const next = spliceSource(b.text, pos, pos, `${lead}[@${key}] `, label);
      patch(b.id, { text: next.text });
      focusBlock(b.id, { plain: next.plain });
      return;
    }
    const added = block("text", `[@${key}] `);
    insertAt(docRef.current.blocks.length, added);
    focusBlock(added.id, "end");
  };

  /** The paper as a card, after the block last written in. */
  const cardFromRail = (paper: Citable) => {
    const sources = docRef.current.sources;
    const key = keyFor(paper, sources);
    if (!sources[key]) commit({ ...docRef.current, sources: { ...sources, [key]: sourceOf(paper, key) } });
    const at = lastCaret.current ? indexOf(lastCaret.current.id) : -1;
    const where = at === -1 ? docRef.current.blocks.length : at + 1;
    const card = block("paper", "", { cite: key });
    const after = block("text");
    insertAt(where, card, after);
    focusBlock(after.id, "start");
  };

  /** Every row the drop could land between, measured now — a drag from the
   *  rail can start after a block has grown or the page has scrolled. */
  const rowsNow = (): HTMLElement[] =>
    Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);

  /** A paper dragged out of the rail, put down in the gap the line marked.
   *  The card goes exactly there — this gesture says *where*, which is the
   *  whole reason to drag rather than press Card. */
  const dropPaper = (paper: Citable, gap: number) => {
    const sources = docRef.current.sources;
    const key = keyFor(paper, sources);
    if (!sources[key]) commit({ ...docRef.current, sources: { ...sources, [key]: sourceOf(paper, key) } });
    const card = block("paper", "", { cite: key });
    const blocks = docRef.current.blocks;
    const next = blocks[gap];
    // A card dropped at the end has nothing after it to write in, and one
    // dropped above a card or a rule would leave no room between them.
    const room = !next || !isTextual(next.type) ? block("text") : null;
    if (room) insertAt(gap, card, room);
    else insertAt(gap, card);
    focusBlock((room ?? next).id, "start");
  };

  /** A citation in the text opens its paper's record in the rail, rather
   *  than taking the writer out of the draft. */
  const showPaper = (key: string) => {
    const source = docRef.current.sources[key];
    if (!source) return;
    setPreview(source.paperId);
    setRailTab("papers");
    setRailOpen(true);
  };

  /** The block's text is now `text`, the caret at source offset `caret`: Markdown at its start converts the block (`# `, `- `, `---`...), and `/`, `@` or `[[` open a menu. */
  const typed = (id: string, text: string, caret: number, typedOne: boolean) => {
    const i = indexOf(id);
    if (i === -1) return;
    const b = docRef.current.blocks[i];

    if (b.type === "text" && text === "---") {
      const after = block("text");
      const blocks = docRef.current.blocks.slice();
      blocks.splice(i, 1, { ...block("divider"), id: b.id }, after);
      setBlocks(blocks);
      setMenu(null);
      focusBlock(after.id, "start");
      return;
    }
    if (b.type === "text" && typedOne) {
      const s = shortcut(text);
      if (s) {
        retype(id, { type: s.type, text: s.text, checked: s.checked, indent: canIndent(s.type) ? b.indent : undefined }, text);
        setMenu(null);
        focusBlock(id, Math.max(0, caret - (text.length - s.text.length)));
        return;
      }
    }
    patch(id, { text });

    const m = menuRef.current;
    if (typedOne && text[caret - 1] === "/" && (caret === 1 || /\s/.test(text[caret - 2])) && b.type !== "code" && !holdsItsType(b)) {
      setMenu({ kind: "slash", blockId: id, from: caret - 1, query: "", index: 0 });
    } else if (typedOne && text[caret - 1] === "@" && (caret === 1 || /[\s(]/.test(text[caret - 2])) && b.type !== "code") {
      setMenu({ kind: "cite", blockId: id, from: caret - 1, trigger: "@", mode: "inline", query: "", index: 0 });
    } else if (typedOne && text.slice(caret - 2, caret) === "[[" && b.type !== "code") {
      setMenu({ kind: "cite", blockId: id, from: caret - 2, trigger: "[[", mode: "inline", query: "", index: 0 });
    } else if (m && m.blockId === id) {
      const lead = m.kind === "slash" ? 1 : m.trigger.length;
      const opened = m.kind === "slash" ? text[m.from] === "/" : text.slice(m.from, m.from + lead) === m.trigger;
      const query = text.slice(m.from + lead, caret);
      if (!opened || caret < m.from + lead || query.includes("\n") || query.length > (m.kind === "slash" ? 24 : 60)) setMenu(null);
      else setMenu({ ...m, query, index: 0 });
    }
  };

  // ── Row handlers, read through a ref so the rows can stay memoised ──
  const api = useRef<RowApi>(null as unknown as RowApi);
  api.current = {
    register: (id, el) => {
      if (el) areas.current.set(id, el);
      else areas.current.delete(id);
    },

    label,

    caret: (id, el) => {
      if (el instanceof HTMLTextAreaElement) {
        lastCaret.current = { id, plain: el.selectionStart };
        return;
      }
      const sel = getPlainSelection(el);
      if (!sel) return;
      lastCaret.current = { id, plain: sel.from };
      // a toggled mark is for the place it was asked at; the caret moving away drops it
      if (pendingMarks.current && (pendingMarks.current.id !== id || pendingMarks.current.plain !== sel.from || sel.from !== sel.to)) pendingMarks.current = null;
    },

    blur: (id) => {
      setEditing((cur) => (cur === id ? null : cur));
      if (menuRef.current?.blockId === id) setMenu(null);
    },

    edit: (id, caret) => focusBlock(id, caret),

    toggle: (id) => {
      const b = docRef.current.blocks.find((x) => x.id === id);
      if (b) patch(id, { checked: !b.checked || undefined });
    },

    addBelow: (id) => {
      const added = block("text");
      insertAt(indexOf(id) + 1, added);
      focusBlock(added.id, "start");
    },

    noteId: (title) => {
      const t = title.trim().toLowerCase();
      return newestFirst(allNotes).find((n) => n.title.trim().toLowerCase() === t)?.id ?? null;
    },

    citation: showPaper,

    missingNote: (title) => {
      const made = { ...blankNote(), title };
      addNote(made);
      router.push(`/notes/${made.id}`);
    },

    /** A code block's textarea was typed in. */
    change: (e, id) => {
      const el = e.currentTarget;
      typed(id, el.value, el.selectionStart, el.value.length === (docRef.current.blocks.find((x) => x.id === id)?.text.length ?? 0) + 1);
    },

    /** The surface was typed in (or cut, or deleted from): its source is what the DOM now says. */
    input: (id, edit) => {
      const b = docRef.current.blocks.find((x) => x.id === id);
      if (!b) return;
      const typedOne = edit.kind === "insertText" && edit.data !== null && edit.data.length === 1;
      if (edit.text !== b.text) remember(id, b.text, edit.text, edit.from, edit.to, edit.kind.startsWith("delete") ? "delete" : "type");
      typed(id, edit.text, edit.caret, typedOne);
      // A mark the reader just closed by typing its delimiter ends there: what is typed next is outside it (the caret
      // itself can only sit at the end of the text before it).
      if (edit.closed && edit.from === edit.to) pendingMarks.current = { id, plain: edit.to, marks: marksOpenAt(edit.text, edit.to, label) };
    },

    /** Text is about to be typed. After a mark was toggled with nothing selected the editor writes it, wearing the toggled marks. */
    typing: (id, data) => {
      const want = pendingMarks.current;
      if (!want || want.id !== id) return false;
      pendingMarks.current = null;
      const el = areas.current.get(id);
      const b = docRef.current.blocks.find((x) => x.id === id);
      const sel = el && !(el instanceof HTMLTextAreaElement) ? getPlainSelection(el) : null;
      if (!b || !sel || sel.from !== sel.to || sel.from !== want.plain) return false;
      const next = insertMarked(b.text, sel.from, data, want.marks, label);
      remember(id, b.text, next.text, next.plain, next.plain, "type");
      patch(id, { text: next.text });
      // typed text that closes a mark (a delimiter) is read as one: the caret goes where the mark ends, and the text after it is outside
      const words = plainOfSource(b.text, label);
      const closed = plainOfSource(next.text, label) !== words.slice(0, sel.from) + data + words.slice(sel.from);
      const at = closed ? plainOfSourceOffset(treeOf(next.text, label), next.caret) : next.plain;
      focusBlock(id, { plain: at });
      if (closed) pendingMarks.current = { id, plain: at, marks: marksOpenAt(next.text, at, label) };
      return true;
    },

    paste: (e, id) => {
      const el = e.currentTarget;
      const i = indexOf(id);
      const b = docRef.current.blocks[i];
      // A code block's textarea takes the browser's own paste.
      if (!b || el instanceof HTMLTextAreaElement || b.type === "code") return;
      // The surface takes text only: HTML pasted is reduced to its words (the dialect has no escape, so a pasted
      // `**b**` is read as a mark on the next draw, as the same text stored would be).
      e.preventDefault();
      const pasted = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      const parsed = pasted.includes("\n") ? parseMarkdown(pasted) : [];
      if (parsed.length === 0) {
        if (pasted && !document.execCommand("insertText", false, pasted.replace(/\n/g, " "))) insertText(el, pasted.replace(/\n/g, " "));
        return;
      }
      const sel = selection(id);
      const { head: before, tail: after } = splitSource(b.text, sel?.from ?? 0, sel?.to ?? 0, label);
      const blocks = docRef.current.blocks.slice();
      let replaced: Block[];
      if (!before && !after && !holdsItsType(b)) {
        replaced = [{ ...parsed[0], id: b.id }, ...parsed.slice(1)];
      } else {
        const [head, ...tail] = parsed;
        const first = isTextual(head.type) ? { ...b, text: joinSources(before, head.text, label).text } : null;
        replaced = first ? [first, ...tail] : [{ ...b, text: before }, head, ...tail];
      }
      const last = replaced[replaced.length - 1];
      const lastLength = isTextual(last.type) ? plainOfSource(last.text, label).length : 0;
      if (after) {
        if (isTextual(last.type)) replaced[replaced.length - 1] = { ...last, text: joinSources(last.text, after, label).text };
        else replaced.push(block("text", after));
      }
      blocks.splice(i, 1, ...replaced);
      setBlocks(blocks);
      const end = replaced[replaced.length - 1];
      if (isTextual(end.type)) focusBlock(end.id, { plain: isTextual(last.type) ? lastLength : 0 });
    },

    key: (e, id) => {
      // A letter, a digit or a symbol is the browser's to type; the editor reads only the keys that do something else.
      const mod = e.metaKey || e.ctrlKey;
      const menuOpen = menuRef.current?.blockId === id;
      if (!mod && !e.altKey && !menuOpen && e.key.length === 1) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      const el = e.currentTarget;
      const area = el instanceof HTMLTextAreaElement;
      const i = indexOf(id);
      if (i === -1) return;
      const blocks = docRef.current.blocks;
      const b = blocks[i];
      // The selection: source offsets (pos, end), and the visible characters (sel.from, sel.to of sel.len).
      const sel = selection(id);
      if (!sel) return;
      const pos = sel.start;
      const end = sel.end;
      const collapsed = sel.from === sel.to;
      /** A block's visible text; a code block's is its text. */
      const visible = (x: Block) => (x.type === "code" ? x.text : plainOfSource(x.text, label));
      /** Two blocks' text as one, and where they were joined (in visible characters). */
      const joined = (x: Block, y: Block) =>
        x.type === "code" || y.type === "code"
          ? { text: x.text + y.text, plain: x.text.length }
          : joinSources(x.text, y.text, label);

      const m = menuRef.current;
      if (m && m.blockId === id) {
        const count = m.kind === "slash" ? slashItems.length : candidates.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (count > 0) setMenu({ ...m, index: (m.index + (e.key === "ArrowDown" ? 1 : -1) + count) % count });
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (count > 0) pick(m.index);
          else setMenu(null);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setMenu(null);
          return;
        }
      }
      if (e.nativeEvent.isComposing) return;

      // ⌘/Ctrl+Z (Shift+Z, Y): the block's own steps; the browser's cannot follow a surface that is drawn again.
      const letter = e.key.toLowerCase();
      if (!area && mod && !e.altKey && (letter === "z" || letter === "y")) {
        e.preventDefault();
        stepHistory(id, letter === "y" || e.shiftKey);
        return;
      }
      // ⌘/Ctrl+B I E U and ⌘/Ctrl+Shift+H: the toolbar's marks (P10-09b); a code block takes none.
      const mark = markForKey(e);
      if (mark && b.type !== "code") {
        e.preventDefault();
        applyMark(id, mark);
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (b.type === "todo") patch(id, { checked: !b.checked || undefined });
        else api.current.addBelow(id);
        return;
      }
      if ((mod || e.altKey) && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const gap = e.key === "ArrowUp" ? i - 1 : i + 2;
        if (gap < 0 || gap > blocks.length) return;
        // The first visible block does not move above the hidden one, as the first block does not move above the top.
        if (e.key === "ArrowUp" && blocks[i - 1]?.id === hiddenBlockId) return;
        setBlocks(moveBlock(blocks, i, gap));
        focusBlock(id, { plain: sel.from, to: sel.to });
        return;
      }

      switch (e.key) {
        case "Enter": {
          if (b.type === "code") return;
          if (e.shiftKey) {
            // a line break inside the block (the textarea's own Enter did this); the surface writes it as text
            e.preventDefault();
            if (!area) insertText(el, "\n");
            return;
          }
          e.preventDefault();
          if (isList(b.type) && b.text === "") {
            if ((b.indent ?? 0) > 0) setBlocks(indentBlock(blocks, i, -1));
            else retype(id, { type: "text", checked: undefined });
            focusBlock(id, 0);
            return;
          }
          const type = nextType(b.type);
          const indentKept = canIndent(type) ? b.indent : undefined;
          if (sel.from === 0 && collapsed && b.text.length > 0) {
            insertAt(i, block(isList(b.type) ? b.type : "text", "", { indent: indentKept }));
            focusBlock(id, 0);
            return;
          }
          // the words either side of the selection, each with the marks that were around the cut closed on its own side
          const cut = area ? { head: b.text.slice(0, pos), tail: b.text.slice(end) } : splitSource(b.text, sel.from, sel.to, label);
          const added = block(type, cut.tail, { indent: indentKept });
          const next = blocks.slice();
          next.splice(i, 1, { ...b, text: cut.head }, added);
          setBlocks(next);
          focusBlock(added.id, "start");
          return;
        }
        case "Backspace": {
          if (!collapsed || sel.from !== 0) return;
          // A sticky's heading keeps its type, as the note's first block keeps its place: its number is not editable text.
          if (holdsItsType(b)) {
            e.preventDefault();
            return;
          }
          if (b.type !== "text") {
            e.preventDefault();
            retype(id, { type: "text", checked: undefined });
            focusBlock(id, 0);
            return;
          }
          if ((b.indent ?? 0) > 0) {
            e.preventDefault();
            setBlocks(indentBlock(blocks, i, -1));
            focusBlock(id, 0);
            return;
          }
          // The first block, or the first the page draws (the one before it is hidden): nothing to join into.
          if (i === 0 || blocks[i - 1].id === hiddenBlockId) {
            if (!b.text && blocks.filter((x) => x.id !== hiddenBlockId).length === 1) {
              e.preventDefault();
              titleRef.current?.focus();
            } else if (i > 0) e.preventDefault();
            return;
          }
          const prev = blocks[i - 1];
          e.preventDefault();
          if (isTextual(prev.type)) {
            const both = joined(prev, b);
            const next = blocks.slice();
            next.splice(i - 1, 2, { ...prev, text: both.text });
            setBlocks(next);
            focusBlock(prev.id, { plain: both.plain });
          } else if (!b.text) {
            const back = nearestTextual(i, -1);
            setBlocks(blocks.filter((x) => x.id !== id));
            if (back >= 0) focusBlock(blocks[back].id, "end");
            else titleRef.current?.focus();
          }
          return;
        }
        case "Delete": {
          if (!collapsed || sel.to !== sel.len) return;
          const next = blocks[i + 1];
          if (!next || !isTextual(next.type) || next.id === hiddenBlockId) return;
          // A sticky's heading is not joined into the block before it (that would delete it).
          if (holdsItsType(next)) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          const both = joined(b, next);
          setBlocks(blocks.filter((x) => x.id !== next.id).map((x) => (x.id === id ? { ...x, text: both.text } : x)));
          focusBlock(id, { plain: both.plain });
          return;
        }
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          if (e.shiftKey || mod || e.altKey || !collapsed) return;
          const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
          if (e.key === "ArrowLeft" && sel.from !== 0) return;
          if (e.key === "ArrowRight" && sel.to !== sel.len) return;
          const lines = area ? caretLine(el) : caretLines(el);
          if (e.key === "ArrowUp" && !lines.first) return;
          if (e.key === "ArrowDown" && !lines.last) return;
          const target = nearestTextual(i, back ? -1 : 1);
          if (target === -1) {
            if (back) {
              e.preventDefault();
              titleRef.current?.focus();
            }
            return;
          }
          e.preventDefault();
          const t = visible(blocks[target]);
          let caret: Caret;
          if (e.key === "ArrowLeft") caret = "end";
          else if (e.key === "ArrowRight") caret = "start";
          else {
            // Keep the column, within the line the caret arrives on.
            const here = visible(b);
            const col = sel.from - (here.lastIndexOf("\n", sel.from - 1) + 1);
            if (back) {
              const start = t.lastIndexOf("\n") + 1;
              caret = { plain: start + Math.min(col, t.length - start) };
            } else {
              const stop = t.indexOf("\n");
              caret = { plain: Math.min(col, stop === -1 ? t.length : stop) };
            }
          }
          focusBlock(blocks[target].id, caret);
          return;
        }
        case "Tab": {
          e.preventDefault();
          if (b.type === "code" && !e.shiftKey) {
            replaceRange(id, pos, end, "  ");
            return;
          }
          setBlocks(indentBlock(blocks, i, e.shiftKey ? -1 : 1));
          return;
        }
      }
    },

    handleDown: (e, id) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.row!, mid: r.top + r.height / 2 };
      });
      dragStart.current = { id, y: e.clientY, moved: false, gap: -1, rows };
    },

    handleMove: (e) => {
      const d = dragStart.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientY - d.y) < 4) return;
      d.moved = true;
      const at = d.rows.findIndex((r) => e.clientY < r.mid);
      d.gap = at === -1 ? d.rows.length : at;
      setDrag({ id: d.id, gap: d.gap });
    },

    handleCancel: () => {
      dragStart.current = null;
      setDrag(null);
    },

    handleUp: (e, id) => {
      const d = dragStart.current;
      dragStart.current = null;
      if (d?.moved) {
        setDrag(null);
        if (d.gap >= 0) setBlocks(moveBlock(docRef.current.blocks, indexOf(d.id), d.gap));
        return;
      }
      setDrag(null);
      const row = (e.currentTarget.closest("[data-row]") as HTMLElement | null)?.getBoundingClientRect();
      const body = bodyRef.current?.getBoundingClientRect();
      setBlockMenu((open) => (open?.id === id ? null : { id, top: row && body ? row.top - body.top + 26 : 0 }));
    },
  };

  // ── Block menu actions ──
  const blockAction = (id: string, action: "up" | "down" | "duplicate" | "delete" | BlockType) => {
    setBlockMenu(null);
    const i = indexOf(id);
    if (i === -1) return;
    const blocks = docRef.current.blocks;
    const b = blocks[i];
    if (action === "up" || action === "down") {
      const gap = action === "up" ? i - 1 : i + 2;
      if (gap >= 0 && gap <= blocks.length) setBlocks(moveBlock(blocks, i, gap));
    } else if (action === "duplicate") {
      insertAt(i + 1, { ...b, id: block().id });
    } else if (action === "delete") {
      const rest = blocks.filter((x) => x.id !== id);
      setBlocks(rest.length > 0 ? rest : [block("text")]);
      setUndo({ block: b, index: i });
    } else {
      retype(id, { type: action, checked: undefined, indent: canIndent(action) ? b.indent : undefined });
      if (isTextual(action)) focusBlock(id, "end");
    }
  };
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  // ── Title ──
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [doc.title]);

  const titleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" || (e.key === "ArrowDown" && caretLine(e.currentTarget).last)) {
      e.preventDefault();
      const first = nearestTextual(-1, 1);
      if (first >= 0) focusBlock(docRef.current.blocks[first].id, "start");
      else {
        const added = block("text");
        insertAt(slotAfterHidden(docRef.current.blocks, hiddenBlockId), added);
        focusBlock(added.id, "start");
      }
    }
  };

  // ── Export ──
  const current = (): Note => ({ ...note, ...docRef.current, updatedAt: new Date().toISOString() });
  const download = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 2400);
  };
  const exportAs = async (kind: "copy" | "md" | "bib") => {
    setExportOpen(false);
    const n = current();
    if (kind === "copy") {
      try {
        await navigator.clipboard.writeText(toMarkdown(n));
        flash("Copied as Markdown");
      } catch {
        flash("Copy was blocked — try Download");
      }
    } else if (kind === "md") download(toMarkdown(n), fileName(n, "md"), "text/markdown");
    else download(toBibtex(n), fileName(n, "bib"), "application/x-bibtex");
  };

  const deleteNote = () => {
    if (!window.confirm("Delete this note? It is kept only in this browser, so it cannot be brought back.")) return;
    dirty.current = false;
    removeNote(note.id);
    router.push("/saved");
  };

  // ── Derived ──
  const refs = useMemo(() => citedKeys(doc).map((k) => doc.sources[k]).filter((s): s is Source => Boolean(s)), [doc]);
  const words = useMemo(() => visibleWordCount(doc, hiddenBlockId), [doc, hiddenBlockId]);
  const editingBlock = editing ? doc.blocks.find((b) => b.id === editing) : undefined;
  return (
    // Three columns where the window allows: the notes rail, the note, the
    // shelf to cite from. Below that the rail is a panel the bar opens, and
    // the shelf gives way to @.
    <div className={compact ? undefined : "lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12"}>
      {!compact && <aside className="hidden lg:block">
        <div className="sticky top-24 flex max-h-[calc(100vh-8rem)] flex-col">
          <EditorRail
            currentId={note.id}
            preview={preview}
            onPreview={setPreview}
            tab={railTab}
            onTab={setRailTab}
            onCite={citeFromRail}
            onCard={cardFromRail}
            sources={doc.sources}
          />
        </div>
      </aside>}

      <div className="min-w-0">
        {/* The page's own bar: where it lives, that it is kept, and out. */}
        {!compact && <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-10">
          <div className="flex items-center gap-3">
            <Link href="/saved" className="eyebrow text-text-faint hover:text-heading">
              ← Saved
            </Link>
            <button
              type="button"
              className={`${COMMAND} lg:hidden`}
              aria-expanded={railOpen}
              onClick={() => setRailOpen((o) => !o)}
            >
              Notes
            </button>
          </div>
          {railOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-20 cursor-default lg:hidden"
                onClick={() => setRailOpen(false)}
              />
              <div className="absolute left-0 top-full z-30 mt-2 flex max-h-[70vh] w-[min(20rem,calc(100vw-3rem))] flex-col bg-surface p-3 shadow-card lg:hidden">
                <EditorRail
                  currentId={note.id}
                  preview={preview}
                  onPreview={setPreview}
                  tab={railTab}
                  onTab={setRailTab}
                  onCite={(paper) => {
                    citeFromRail(paper);
                    setRailOpen(false);
                  }}
                  onCard={(paper) => {
                    cardFromRail(paper);
                    setRailOpen(false);
                  }}
                  sources={doc.sources}
                  onPicked={() => setRailOpen(false)}
                />
              </div>
            </>
          )}
          <div className="relative flex items-center gap-3">
            <span className="annotation text-text-faint tabular-nums" aria-live="polite">
              {notice ?? `${words} ${words === 1 ? "word" : "words"} · ${status === "saving" ? "saving…" : "kept in this browser"}`}
            </span>
            <button type="button" className={COMMAND} aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>
              Export
            </button>
            {exportOpen && (
              <>
                <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full z-30 mt-2 w-60 bg-surface py-1 shadow-card">
                  {[
                    ["copy", "Copy as Markdown", "Obsidian, Notion, anywhere"],
                    ["md", "Download .md", "citations as [@key], for Pandoc"],
                    ["bib", "Download .bib", "the same keys, for LaTeX"],
                  ].map(([k, label, detail]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => exportAs(k as "copy" | "md" | "bib")}
                      className="block w-full px-3 py-2 text-left hover:bg-bg-secondary/70"
                    >
                      <span className="block text-body-sm text-heading">{label}</span>
                      <span className="annotation block text-text-faint">{detail}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button type="button" className={COMMAND} onClick={deleteNote}>
              Delete
            </button>
          </div>
        </div>}

        <div className={compact ? "max-w-[44rem]" : "mt-8 max-w-[44rem]"}>
          {!compact && <textarea
            ref={titleRef}
            value={doc.title}
            rows={1}
            data-typeset=""
            placeholder="Untitled"
            aria-label="Title"
            onChange={(e) => commit({ ...docRef.current, title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={titleKey}
            className="paper-line block w-full resize-none overflow-hidden bg-transparent pl-10 text-display leading-[1.15] text-heading outline-none placeholder:text-text-faint/60 sm:text-display-lg"
          />}
          {note.paperId && !compact && (
            <p className="eyebrow mt-3 pl-10 text-text-faint">
              Reading notes ·{" "}
              <Link href={`/papers/${note.paperId}`} className="hover:text-heading">
                open the paper →
              </Link>
            </p>
          )}

          {/* P10-09b: the formatting toolbar, above the blocks and in view while the note scrolls under it. */}
          <NoteToolbar
            active={editingBlock?.type ?? null}
            enabled={Boolean(editingBlock && isTextual(editingBlock.type))}
            onMark={(m) => editing && applyMark(editing, m)}
            onType={(t) => editing && applyType(editing, t)}
            className={compact ? "sticky top-0 z-10 bg-surface py-1" : "sticky top-0 z-10 -ml-1 mt-4 bg-bg py-1 md:top-12"}
          />

          <div
            ref={bodyRef}
            // The whole column takes a paper, including the empty band under
            // the last block — that band is where "put it at the end" is.
            onDragOver={(e) => {
              if (!carriesPaper(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDrag({ id: FROM_RAIL, gap: gapAt(rowsNow(), e.clientY) });
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDrag((d) => (d?.id === FROM_RAIL ? null : d));
            }}
            onDrop={(e) => {
              const paper = readPaperDrag(e.dataTransfer);
              setDrag(null);
              if (!paper) return;
              e.preventDefault();
              dropPaper(paper, gapAt(rowsNow(), e.clientY));
            }}
            className="relative mt-2"
          >
            {doc.blocks.map((b, i) => (
              <Row
                key={b.id}
                block={b}
                first={i === 0}
                number={b.type === "numbered" ? listNumber(doc.blocks, i) : 0}
                editing={editing === b.id}
                sources={doc.sources}
                dragging={drag?.id === b.id}
                dropBefore={drag !== null && drag.gap === i && drag.id !== b.id}
                dropAfter={drag !== null && drag.gap === doc.blocks.length && i === doc.blocks.length - 1}
                api={api}
              />
            ))}

            {/* Clicking under the last block writes after it, the way a page
                takes a click below its last line. */}
            <button
              type="button"
              aria-label="Write at the end"
              tabIndex={-1}
              onClick={() => {
                const last = doc.blocks[doc.blocks.length - 1];
                if (last && last.type === "text" && !last.text) focusBlock(last.id, "start");
                else {
                  const added = block("text");
                  insertAt(doc.blocks.length, added);
                  focusBlock(added.id, "start");
                }
              }}
              className="block h-24 w-full cursor-text"
            />

            {menu && anchor && (
              <div
                role="listbox"
                aria-label={menu.kind === "slash" ? "Blocks" : "Cite"}
                onMouseDown={(e) => e.preventDefault()}
                className="absolute z-30 max-h-72 w-[min(21rem,calc(100vw-3rem))] overflow-auto bg-surface py-1 shadow-card"
                style={anchor.above ? { bottom: `calc(100% - ${anchor.top}px)`, left: anchor.left } : { top: anchor.top, left: anchor.left }}
              >
                {menu.kind === "slash" ? (
                  slashItems.length === 0 ? (
                    <p className="annotation px-3 py-2 text-text-faint">No block called “{menu.query}”</p>
                  ) : (
                    slashItems.map((item, j) => (
                      <MenuItem key={item.id} active={j === menu.index} onPick={() => pick(j)}>
                        <span className="text-body-sm text-heading">{item.label}</span>
                        {item.hint && <span className="font-mono text-meta text-text-faint">{item.hint}</span>}
                      </MenuItem>
                    ))
                  )
                ) : candidates.length === 0 ? (
                  <p className="annotation px-3 py-2 text-text-faint">
                    {menu.query ? `Nothing saved, read or in today's briefing matches “${menu.query}”` : "Save or read a paper, and it can be cited here"}
                  </p>
                ) : (
                  candidates.map((c, j) => (
                    <div key={`${c.kind}:${c.kind === "paper" ? c.citable.id : c.id}`}>
                      {(j === 0 || candidates[j - 1].group !== c.group) && (
                        <p className="eyebrow px-3 pb-1 pt-2 text-text-faint">{c.group}</p>
                      )}
                      <MenuItem active={j === menu.index} onPick={() => pick(j)} stacked>
                        <span className="line-clamp-2 font-reading text-body-sm leading-[1.4] text-heading">{c.label}</span>
                        {c.detail && <span className="annotation text-text-faint">{c.detail}</span>}
                      </MenuItem>
                    </div>
                  ))
                )}
              </div>
            )}

            {blockMenu && (
              <>
                <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setBlockMenu(null)} />
                <BlockMenu
                  top={blockMenu.top}
                  block={doc.blocks.find((b) => b.id === blockMenu.id)}
                  onAction={(a) => blockAction(blockMenu.id, a)}
                  onClose={() => setBlockMenu(null)}
                />
              </>
            )}
          </div>

          {undo && (
            <p className="annotation pl-10 text-text-faint" role="status">
              Block deleted ·{" "}
              <button
                type="button"
                className="text-text-muted underline underline-offset-[3px] hover:text-heading"
                onClick={() => {
                  const blocks = docRef.current.blocks.slice();
                  blocks.splice(Math.min(undo.index, blocks.length), 0, undo.block);
                  setBlocks(blocks);
                  setUndo(null);
                }}
              >
                undo
              </button>
            </p>
          )}

          {/* The bibliography writes itself from what is cited, in the order
              it is first cited — the list the export ends with. */}
          {refs.length > 0 && (
            <section className="mt-10 pl-10">
              <p className="eyebrow text-text-faint">References · {refs.length}</p>
              <ol className="mt-3 space-y-2">
                {refs.map((s, i) => (
                  <li key={s.key} className="flex gap-3">
                    <span className="annotation w-5 shrink-0 pt-[3px] text-text-faint tabular-nums">{i + 1}</span>
                    <Link href={`/papers/${s.paperId}`} className="font-reading text-body-sm leading-[1.5] text-text-muted hover:text-heading">
                      {reference(s).replace(/\*/g, "")}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {!compact && <p className="annotation mt-12 pl-10 leading-[1.7] text-text-faint">
            / blocks · @ cite a paper, or drag one in from the rail · [[ link a note · # - 1. [] &gt; ``` --- as you type · Tab nests · ⌘⇧↑↓ moves ·
            ⌘B ⌘I ⌘U ⌘⇧H ⌘E
          </p>}
        </div>
      </div>

    </div>
  );
}

function MenuItem({
  active,
  onPick,
  stacked = false,
  children,
}: {
  active: boolean;
  onPick: () => void;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        "flex w-full gap-3 px-3 py-2 text-left",
        stacked ? "flex-col gap-1" : "items-baseline justify-between",
        active ? "bg-bg-secondary" : "hover:bg-bg-secondary/60",
      )}
    >
      {children}
    </button>
  );
}

function BlockMenu({
  top,
  block: b,
  onAction,
  onClose,
}: {
  top: number;
  block: Block | undefined;
  onAction: (action: "up" | "down" | "duplicate" | "delete" | BlockType) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  if (!b) return null;
  const item = "block w-full px-3 py-2 text-left text-body-sm hover:bg-bg-secondary/70 focus:bg-bg-secondary/70 outline-none";
  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
      className="absolute left-0 z-30 w-56 bg-surface py-1 shadow-card"
      style={{ top }}
    >
      {isTextual(b.type) && !holdsItsType(b) && (
        <>
          <p className="eyebrow px-3 pb-1 pt-2 text-text-faint">Turn into</p>
          {TURN_INTO.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              className={cn(item, t === b.type ? "text-heading" : "text-text-muted")}
              onClick={() => onAction(t)}
            >
              {TYPE_LABEL[t]}
              {t === b.type ? " ·" : ""}
            </button>
          ))}
          <span aria-hidden className="my-1 block h-px bg-border" />
        </>
      )}
      <button type="button" role="menuitem" className={cn(item, "text-text-muted")} onClick={() => onAction("up")}>
        Move up
      </button>
      <button type="button" role="menuitem" className={cn(item, "text-text-muted")} onClick={() => onAction("down")}>
        Move down
      </button>
      <button type="button" role="menuitem" className={cn(item, "text-text-muted")} onClick={() => onAction("duplicate")}>
        Duplicate
      </button>
      <button type="button" role="menuitem" className={cn(item, "text-text-muted hover:text-red")} onClick={() => onAction("delete")}>
        Delete
      </button>
    </div>
  );
}
