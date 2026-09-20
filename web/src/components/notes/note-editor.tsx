"use client";

// The note editor: blocks, the way Notion and Logseq cut a page, over
// Markdown, the way Obsidian keeps one.
//
// The model is Logseq's. Every block is rendered — headings, lists,
// citations as "Rose et al., 2024" — except the one being typed in, which
// shows its Markdown source in a textarea set in the same type, so for plain
// prose the switch is invisible. A textarea per block is the robust choice:
// undo, IME, spellcheck, selection and the phone keyboard are the browser's
// own, and nothing has to be reconciled from contentEditable's DOM.
//
// What a reader can do, and where it is handled:
//   type            onChange — Markdown at a block's start converts it (`# `,
//                   `- `, `1. `, `[] `, `> `, ``` and `---`); `/` opens the
//                   block menu, `@` or `[[` the citation picker
//   Enter           splits the block; on an empty list item, leaves the list
//   Backspace       at a block's start: a heading or list turns back into
//                   text, an indent comes out, then it joins the block above
//   ↑ ↓ ← →         cross into the next block from its first or last line
//   Tab             indents (a list nests); Shift-Tab outdents
//   ⌘⇧↑ ⌘⇧↓         moves the block
//   ⌘B ⌘I ⌘E        bold, italic, code around the selection
//   ⌘Enter          ticks a to-do; elsewhere, a new block below
//   the handle      drag to move; click for turn-into, duplicate, delete
//
// Saving: the editor owns its copy while open and writes it back to the
// notes store half a second after the last change, and on leaving.

import Link from "next/link";
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
import type { Block, BlockType, Citable, Note, Source } from "@/lib/notes/types";
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
import { plainInline } from "@/lib/notes/inline";
import { fileName, reference, toBibtex, toMarkdown } from "@/lib/notes/export";
import { blankNote } from "@/lib/notes/templates";
import { newestFirst, useNotesStore } from "@/store/notes";
import { useFeedStore } from "@/store/feed";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";
import { caretCoords, caretLine, offsetFromPoint } from "./caret";
import { InlineText } from "./inline-text";
import { EditorRail, type RailTab } from "./notes-rail";

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };
type Caret = number | "start" | "end";

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
  register: (id: string, el: HTMLTextAreaElement | null) => void;
  change: (e: ChangeEvent<HTMLTextAreaElement>, id: string) => void;
  key: (e: KeyboardEvent<HTMLTextAreaElement>, id: string) => void;
  paste: (e: ClipboardEvent<HTMLTextAreaElement>, id: string) => void;
  caret: (id: string, pos: number) => void;
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

  // Grow with its text; never scroll inside itself.
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
  } else if (editing) {
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
        onSelect={(e) => api.current.caret(b.id, e.currentTarget.selectionStart)}
        onBlur={() => api.current.blur(b.id)}
        className={cn(
          cls,
          "block w-full resize-none overflow-hidden bg-transparent p-0 outline-none placeholder:text-text-faint/70",
          b.type === "code" && "whitespace-pre",
          b.type === "todo" && b.checked && "text-text-faint line-through",
        )}
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

export function NoteEditor({ note }: { note: Note }) {
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

  const [editing, setEditing] = useState<string | null>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFocus = useRef<{ id: string; caret: Caret } | null>(null);
  const lastCaret = useRef<{ id: string; pos: number } | null>(null);
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
    document.title = `${doc.title.trim() || "Untitled"} · Peer`;
  }, [doc.title]);

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
    const pos = want.caret === "start" ? 0 : want.caret === "end" ? el.value.length : Math.min(want.caret, el.value.length);
    el.setSelectionRange(pos, pos);
    lastCaret.current = { id: want.id, pos };
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
  const nearestTextual = (from: number, step: 1 | -1): number => {
    const blocks = docRef.current.blocks;
    for (let i = from + step; i >= 0 && i < blocks.length; i += step) if (isTextual(blocks[i].type)) return i;
    return -1;
  };
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
    const c = caretCoords(el, Math.min(menu.from, el.value.length));
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

  const replaceRange = (id: string, from: number, to: number, text: string, caretAfter?: number) => {
    const el = areas.current.get(id);
    // Through the browser's own editing command where it has one, so ⌘Z
    // takes the insertion back like anything typed.
    if (el && document.activeElement === el) {
      el.setSelectionRange(from, to);
      if (document.execCommand("insertText", false, text)) {
        if (caretAfter !== undefined) el.setSelectionRange(caretAfter, caretAfter);
        return;
      }
    }
    const b = docRef.current.blocks.find((x) => x.id === id);
    if (!b) return;
    patch(id, { text: b.text.slice(0, from) + text + b.text.slice(to) });
    focusBlock(id, caretAfter ?? from + text.length);
  };

  const pick = (choice: number) => {
    const m = menuRef.current;
    if (!m) return;
    const el = areas.current.get(m.blockId);
    const i = indexOf(m.blockId);
    if (i === -1) return setMenu(null);
    const b = docRef.current.blocks[i];
    const caret = el ? el.selectionStart : b.text.length;
    if (m.kind === "slash") {
      const item = slashItems[choice];
      if (!item) return setMenu(null);
      setMenu(null);
      const rest = b.text.slice(0, m.from) + b.text.slice(caret);
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
        patch(b.id, { type, text: rest, checked: undefined, indent: canIndent(type) ? b.indent : undefined });
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
      const rest = b.text.slice(0, m.from) + b.text.slice(caret);
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
      const pos = Math.min(at!.pos, b.text.length);
      const lead = pos > 0 && !/\s/.test(b.text[pos - 1]) ? " " : "";
      const text = `${lead}[@${key}] `;
      patch(b.id, { text: b.text.slice(0, pos) + text + b.text.slice(pos) });
      focusBlock(b.id, pos + text.length);
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

  /** A citation in the text opens its paper's record in the rail, rather
   *  than taking the writer out of the draft. */
  const showPaper = (key: string) => {
    const source = docRef.current.sources[key];
    if (!source) return;
    setPreview(source.paperId);
    setRailTab("papers");
    setRailOpen(true);
  };

  // ── Row handlers, read through a ref so the rows can stay memoised ──
  const api = useRef<RowApi>(null as unknown as RowApi);
  api.current = {
    register: (id, el) => {
      if (el) areas.current.set(id, el);
      else areas.current.delete(id);
    },

    caret: (id, pos) => {
      lastCaret.current = { id, pos };
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

    change: (e, id) => {
      const el = e.currentTarget;
      const text = el.value;
      const caret = el.selectionStart;
      const i = indexOf(id);
      if (i === -1) return;
      const b = docRef.current.blocks[i];
      const typedOne = text.length === b.text.length + 1;

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
          patch(id, { type: s.type, text: s.text, checked: s.checked, indent: canIndent(s.type) ? b.indent : undefined });
          setMenu(null);
          focusBlock(id, Math.max(0, caret - (text.length - s.text.length)));
          return;
        }
      }
      patch(id, { text });

      const m = menuRef.current;
      if (typedOne && text[caret - 1] === "/" && (caret === 1 || /\s/.test(text[caret - 2])) && b.type !== "code") {
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
    },

    paste: (e, id) => {
      const pasted = e.clipboardData.getData("text/plain");
      const i = indexOf(id);
      const b = docRef.current.blocks[i];
      if (!pasted.includes("\n") || !b || b.type === "code") return;
      const parsed = parseMarkdown(pasted);
      if (parsed.length === 0) return;
      e.preventDefault();
      const el = e.currentTarget;
      const before = b.text.slice(0, el.selectionStart);
      const after = b.text.slice(el.selectionEnd);
      const blocks = docRef.current.blocks.slice();
      let replaced: Block[];
      if (!before && !after) {
        replaced = [{ ...parsed[0], id: b.id }, ...parsed.slice(1)];
      } else {
        const [head, ...tail] = parsed;
        const first = isTextual(head.type) ? { ...b, text: before + head.text } : null;
        replaced = first ? [first, ...tail] : [{ ...b, text: before }, head, ...tail];
      }
      const last = replaced[replaced.length - 1];
      const lastLength = isTextual(last.type) ? last.text.length : 0;
      if (after) {
        if (isTextual(last.type)) replaced[replaced.length - 1] = { ...last, text: last.text + after };
        else replaced.push(block("text", after));
      }
      blocks.splice(i, 1, ...replaced);
      setBlocks(blocks);
      const end = replaced[replaced.length - 1];
      if (isTextual(end.type)) focusBlock(end.id, isTextual(last.type) ? lastLength : 0);
    },

    key: (e, id) => {
      const el = e.currentTarget;
      const i = indexOf(id);
      if (i === -1) return;
      const blocks = docRef.current.blocks;
      const b = blocks[i];
      const pos = el.selectionStart;
      const end = el.selectionEnd;
      const collapsed = pos === end;
      const mod = e.metaKey || e.ctrlKey;

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

      if (mod && !e.shiftKey && !e.altKey && ["b", "i", "e"].includes(e.key.toLowerCase()) && b.type !== "code") {
        e.preventDefault();
        const mark = { b: "**", i: "*", e: "`" }[e.key.toLowerCase() as "b" | "i" | "e"];
        const inner = b.text.slice(pos, end);
        replaceRange(id, pos, end, `${mark}${inner}${mark}`, inner ? pos + inner.length + mark.length * 2 : pos + mark.length);
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
        setBlocks(moveBlock(blocks, i, gap));
        focusBlock(id, pos);
        return;
      }

      switch (e.key) {
        case "Enter": {
          if (e.shiftKey || b.type === "code") return;
          e.preventDefault();
          if (isList(b.type) && b.text === "") {
            if ((b.indent ?? 0) > 0) setBlocks(indentBlock(blocks, i, -1));
            else patch(id, { type: "text", checked: undefined });
            focusBlock(id, 0);
            return;
          }
          const type = nextType(b.type);
          const indentKept = canIndent(type) ? b.indent : undefined;
          if (pos === 0 && collapsed && b.text.length > 0) {
            insertAt(i, block(isList(b.type) ? b.type : "text", "", { indent: indentKept }));
            focusBlock(id, 0);
            return;
          }
          const added = block(type, b.text.slice(end), { indent: indentKept });
          const next = blocks.slice();
          next.splice(i, 1, { ...b, text: b.text.slice(0, pos) }, added);
          setBlocks(next);
          focusBlock(added.id, "start");
          return;
        }
        case "Backspace": {
          if (!collapsed || pos !== 0) return;
          if (b.type !== "text") {
            e.preventDefault();
            patch(id, { type: "text", checked: undefined });
            focusBlock(id, 0);
            return;
          }
          if ((b.indent ?? 0) > 0) {
            e.preventDefault();
            setBlocks(indentBlock(blocks, i, -1));
            focusBlock(id, 0);
            return;
          }
          if (i === 0) {
            if (!b.text && blocks.length === 1) {
              e.preventDefault();
              titleRef.current?.focus();
            }
            return;
          }
          const prev = blocks[i - 1];
          e.preventDefault();
          if (isTextual(prev.type)) {
            const next = blocks.slice();
            next.splice(i - 1, 2, { ...prev, text: prev.text + b.text });
            setBlocks(next);
            focusBlock(prev.id, prev.text.length);
          } else if (!b.text) {
            const back = nearestTextual(i, -1);
            setBlocks(blocks.filter((x) => x.id !== id));
            if (back >= 0) focusBlock(blocks[back].id, "end");
            else titleRef.current?.focus();
          }
          return;
        }
        case "Delete": {
          if (!collapsed || pos !== b.text.length) return;
          const next = blocks[i + 1];
          if (!next || !isTextual(next.type)) return;
          e.preventDefault();
          setBlocks(blocks.filter((x) => x.id !== next.id).map((x) => (x.id === id ? { ...x, text: x.text + next.text } : x)));
          focusBlock(id, pos);
          return;
        }
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          if (e.shiftKey || mod || e.altKey || !collapsed) return;
          const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
          if (e.key === "ArrowLeft" && pos !== 0) return;
          if (e.key === "ArrowRight" && pos !== b.text.length) return;
          if (e.key === "ArrowUp" && !caretLine(el).first) return;
          if (e.key === "ArrowDown" && !caretLine(el).last) return;
          const target = nearestTextual(i, back ? -1 : 1);
          if (target === -1) {
            if (back) {
              e.preventDefault();
              titleRef.current?.focus();
            }
            return;
          }
          e.preventDefault();
          const t = blocks[target].text;
          let caret: Caret;
          if (e.key === "ArrowLeft") caret = "end";
          else if (e.key === "ArrowRight") caret = "start";
          else {
            // Keep the column, within the line the caret arrives on.
            const col = pos - (b.text.lastIndexOf("\n", pos - 1) + 1);
            if (back) {
              const start = t.lastIndexOf("\n") + 1;
              caret = start + Math.min(col, t.length - start);
            } else {
              const stop = t.indexOf("\n");
              caret = Math.min(col, stop === -1 ? t.length : stop);
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
      patch(id, { type: action, checked: undefined, indent: canIndent(action) ? b.indent : undefined });
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
        insertAt(0, added);
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
  const words = useMemo(() => wordCount(doc), [doc]);
  return (
    // Three columns where the window allows: the notes rail, the note, the
    // shelf to cite from. Below that the rail is a panel the bar opens, and
    // the shelf gives way to @.
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
      <aside className="hidden lg:block">
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
      </aside>

      <div className="min-w-0">
        {/* The page's own bar: where it lives, that it is kept, and out. */}
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-10">
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
        </div>

        <div className="mt-8 max-w-[44rem]">
          <textarea
            ref={titleRef}
            value={doc.title}
            rows={1}
            data-typeset=""
            placeholder="Untitled"
            aria-label="Title"
            onChange={(e) => commit({ ...docRef.current, title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={titleKey}
            className="paper-line block w-full resize-none overflow-hidden bg-transparent pl-10 text-display leading-[1.15] text-heading outline-none placeholder:text-text-faint/60 sm:text-display-lg"
          />
          {note.paperId && (
            <p className="eyebrow mt-3 pl-10 text-text-faint">
              Reading notes ·{" "}
              <Link href={`/papers/${note.paperId}`} className="hover:text-heading">
                open the paper →
              </Link>
            </p>
          )}

          <div ref={bodyRef} className="relative mt-6">
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

          <p className="annotation mt-12 pl-10 leading-[1.7] text-text-faint">
            / blocks · @ cite a paper · [[ link a note · # - 1. [] &gt; ``` --- as you type · Tab nests · ⌘⇧↑↓ moves ·
            ⌘B ⌘I ⌘E
          </p>
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
      {isTextual(b.type) && (
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
