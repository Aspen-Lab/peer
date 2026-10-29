"use client";

// P10-16 (B16, the owner's ruling §1h.90 (a)): the formatted-text editing surface, and a field built on it.
//
// `Surface` is what a block being edited is: its source drawn as the formatted text (`lib/notes/wysiwyg.ts`) in a
// `contentEditable` element, and the DOM the reader edits written back to the source on every input. The note editor
// (note-editor.tsx) puts one in each block it is editing and supplies the keys, the menus and the undo around it.
//
// `WysiwygField` is the same surface as a plain text field for a place that is not a note's block list — the sticky
// note's window, which keeps its words as paragraphs and writes them through into the note. It has the keys a note
// block has (⌘/Ctrl B, I, U, E, Shift-H mark the selected words and leave them selected; Z / Shift-Z / Y undo and redo),
// Enter is a line break (a paragraph of the sticky is a line), and what is pasted is its words. The text it holds is
// the stored source, `**` and all; the reader never sees it.

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MutableRefObject } from "react";
import type { Source } from "@/lib/notes/types";
import { authorYear } from "@/lib/notes/cite";
import type { MarkName } from "@/lib/notes/inline";
import {
  getPlainSelection,
  insertMarked,
  marksOpenAt,
  mountInline,
  newHistory,
  padRoot,
  plainOfSource,
  plainOfSourceOffset,
  pressMark,
  readsDifferently,
  recordState,
  setPlainSelection,
  snapshot,
  sourceOfPlain,
  stepBack,
  stepForward,
  treeOf,
  type History,
} from "@/lib/notes/wysiwyg";
import { cn } from "@/lib/cn";
import { markForKey } from "./note-toolbar";

/** What the surface tells its owner after the reader edited it. */
export interface SurfaceEdit {
  /** The block's source, written from the DOM. */
  text: string;
  /** The caret as a source offset, and the selection as visible-character offsets. */
  caret: number;
  from: number;
  to: number;
  /** The browser's `inputType` ("insertText", "deleteContentBackward"...). */
  kind: string;
  /** The character typed, when one was. */
  data: string | null;
  /** What was typed read as a mark and the surface was drawn again: the caret is where the mark closed. */
  closed: boolean;
}

/** What a surface asks of its owner; `id` says which surface (a note has many). */
export interface SurfaceApi {
  register: (id: string, el: HTMLElement | null) => void;
  input: (id: string, edit: SurfaceEdit) => void;
  key: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  paste: (e: ClipboardEvent<HTMLElement>, id: string) => void;
  caret: (id: string, el: HTMLElement) => void;
  blur: (id: string, next?: EventTarget | null) => void;
  /** Text is about to be typed: true when the owner wrote it itself (a mark toggled with nothing selected). */
  typing: (id: string, data: string) => boolean;
}

/**
 * The block being edited: its source drawn as the formatted text (`mountInline`) in a `contentEditable` element, and
 * written back on every input (`snapshot`). The DOM is the truth while the reader types — it is drawn again only when
 * the block's text is not what it last wrote (an edit made by the owner itself: a mark, a pick from a menu, undo),
 * or when what was typed reads as a mark (a pasted `**b**`; the dialect has no escape).
 */
export function Surface({
  id,
  text,
  sources,
  api,
  label,
  placeholder,
  className,
  autoFocus = false,
  formatShortcut = false,
}: {
  id: string;
  text: string;
  sources: Record<string, Source>;
  api: MutableRefObject<SurfaceApi>;
  label: string;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
  /** Only the block editor supplies a Format toolbar; plain fields do not. */
  formatShortcut?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** The source the DOM was last drawn from, or last wrote. */
  const drawn = useRef<string | null>(null);
  const composing = useRef(false);
  const cite = (key: string) => (sources[key] ? authorYear(sources[key]) : `@${key}`);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || drawn.current === text) return;
    // drawn again while the reader is in it (the owner changed the text): the same words stay selected, as far as they last
    const held = drawn.current !== null && document.activeElement === el ? getPlainSelection(el) : null;
    drawn.current = text;
    const tree = treeOf(text, cite);
    mountInline(document, el, tree);
    if (held) {
      const total = plainOfSource(text, cite).length;
      setPlainSelection(el, Math.min(held.from, total), Math.min(held.to, total));
    }
  });

  /** The DOM was edited: write it back to the source, and draw it again where the source reads differently. */
  const sync = (kind: string, data: string | null) => {
    const el = ref.current;
    if (!el) return;
    const snap = snapshot(el);
    const sel = getPlainSelection(el) ?? { from: snap.plain.length, to: snap.plain.length };
    let caret = sourceOfPlain(snap.tree, sel.to, "end");
    let { from, to } = sel;
    drawn.current = snap.src;
    const redrawn = !composing.current && readsDifferently(snap.src, snap.plain, cite);
    if (redrawn) {
      // a delimiter typed as characters is a mark now: the surface shows it as one, the caret after what was typed
      const tree = treeOf(snap.src, cite);
      mountInline(document, el, tree);
      from = plainOfSourceOffset(tree, sourceOfPlain(snap.tree, sel.from, "start"));
      to = plainOfSourceOffset(tree, caret);
      setPlainSelection(el, from, to);
      caret = sourceOfPlain(tree, to, "end");
    } else padRoot(document, el);
    api.current.input(id, { text: snap.src, caret, from, to, kind, data, closed: redrawn });
  };
  const syncRef = useRef(sync);
  useLayoutEffect(() => {
    syncRef.current = sync;
  });

  // `beforeinput` and composition are native events (React's onBeforeInput is not the input event)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = (e: Event) => {
      const ev = e as InputEvent;
      if (composing.current) return;
      if (ev.inputType === "insertText" && ev.data && api.current.typing(id, ev.data)) {
        e.preventDefault();
        return;
      }
      // the browser's own undo cannot follow a surface that is drawn again: the owner keeps the steps
      if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") e.preventDefault();
    };
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      syncRef.current("insertCompositionText", null);
    };
    el.addEventListener("beforeinput", before);
    el.addEventListener("compositionstart", start);
    el.addEventListener("compositionend", end);
    return () => {
      el.removeEventListener("beforeinput", before);
      el.removeEventListener("compositionstart", start);
      el.removeEventListener("compositionend", end);
    };
  }, [api, id]);

  useEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    el.focus({ preventScroll: true });
    setPlainSelection(el, plainOfSource(text, cite).length);
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        api.current.register(id, el);
      }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-typeset=""
      data-placeholder={placeholder}
      spellCheck
      onInput={(e) => sync((e.nativeEvent as InputEvent).inputType ?? "", (e.nativeEvent as InputEvent).data ?? null)}
      onKeyDown={(e) => api.current.key(e, id)}
      onPaste={(e) => api.current.paste(e, id)}
      onSelect={(e) => api.current.caret(id, e.currentTarget)}
      onBlur={(e) => api.current.blur(id, e.relatedTarget)}
      aria-keyshortcuts={formatShortcut ? "Alt+F10" : undefined}
      title={formatShortcut ? "Alt+F10 moves between this block and Format." : undefined}
      className={cn(
        className,
        "block min-h-[1lh] w-full whitespace-pre-wrap break-words bg-transparent p-0 outline-none",
        "empty:before:pointer-events-none empty:before:text-text-faint/70 empty:before:content-[attr(data-placeholder)]",
      )}
    />
  );
}

/** Puts `text` at the reader's selection in a surface, replacing what is selected, and tells the surface it was typed
 *  (the `input` event the browser would have sent). */
export function insertText(el: HTMLElement, text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

const NO_SOURCES: Record<string, Source> = {};

interface FieldCore {
  /** The surface's element. */
  el: HTMLElement | null;
  /** The latest props, which the handlers read when the reader acts. */
  latest: { value: string; onChange: (next: string) => void; label: (key: string) => string };
  follow: (latest: FieldCore["latest"]) => void;
}

/** The field's handlers, made once; they read `core.latest` (the current value, `onChange` and citation labels) when the reader acts. */
function createField(): { core: FieldCore; api: { current: SurfaceApi } } {
  const core: FieldCore = {
    el: null,
    latest: { value: "", onChange: () => {}, label: (key) => key },
    follow: (latest) => {
      core.latest = latest;
    },
  };
  return { core, api: { current: makeFieldApi(core) } };
}

function makeFieldApi(core: FieldCore): SurfaceApi {
  let history: History | null = null;
  let pending: { plain: number; marks: MarkName[] } | null = null;
  let caret = 0;
  const label = (key: string) => core.latest.label(key);

  /** The surface shows `next` in place of its words, the selection over `[from, to)`, and the owner is told. */
  const write = (next: string, from: number, to: number = from) => {
    pending = null;
    core.latest.onChange(next);
    const target = core.el;
    if (target) {
      // drawn at once, so the selection can be put over the words before the owner's re-render
      mountInline(document, target, treeOf(next, label));
      setPlainSelection(target, from, to);
    }
  };

  const remember = (text: string, from: number, to: number, kind: "type" | "delete" | "edit", was?: { from: number; to: number }) => {
    const before = core.latest.value;
    const seen = was ?? { from: caret, to: caret };
    let h = history;
    if (!h || h.states[h.at].text !== before) h = newHistory({ text: before, ...seen });
    history = recordState(h, { text, from, to }, kind, Date.now(), seen);
  };

  return {
    register: (_id, node) => {
      core.el = node;
    },
    input: (_id, edit) => {
      if (edit.text !== core.latest.value) remember(edit.text, edit.from, edit.to, edit.kind.startsWith("delete") ? "delete" : "type");
      core.latest.onChange(edit.text);
      // a mark closed by typing its delimiter ends there: what is typed next is outside it
      if (edit.closed && edit.from === edit.to) pending = { plain: edit.to, marks: marksOpenAt(edit.text, edit.to, label) };
    },
    caret: (_id, node) => {
      const sel = getPlainSelection(node);
      if (!sel) return;
      caret = sel.from;
      if (pending && (pending.plain !== sel.from || sel.from !== sel.to)) pending = null;
    },
    blur: () => {
      pending = null;
    },
    typing: (_id, data) => {
      const want = pending;
      const node = core.el;
      const sel = node ? getPlainSelection(node) : null;
      pending = null;
      if (!want || !sel || sel.from !== sel.to || sel.from !== want.plain) return false;
      const text = core.latest.value;
      const next = insertMarked(text, sel.from, data, want.marks, label);
      const words = plainOfSource(text, label);
      const closed = plainOfSource(next.text, label) !== words.slice(0, sel.from) + data + words.slice(sel.from);
      const at = closed ? plainOfSourceOffset(treeOf(next.text, label), next.caret) : next.plain;
      remember(next.text, at, at, "type");
      write(next.text, at);
      if (closed) pending = { plain: at, marks: marksOpenAt(next.text, at, label) };
      return true;
    },
    paste: (e) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      if (pasted) insertText(e.currentTarget, pasted);
    },
    key: (e) => {
      if (e.nativeEvent.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const node = e.currentTarget;
      const letter = e.key.toLowerCase();
      if (mod && !e.altKey && (letter === "z" || letter === "y")) {
        e.preventDefault();
        const h = history;
        if (!h || h.states[h.at].text !== core.latest.value) return;
        const step = letter === "y" || e.shiftKey ? stepForward(h) : stepBack(h);
        if (!step) return;
        history = step.history;
        write(step.state.text, step.state.from, step.state.to);
        return;
      }
      const mark = markForKey(e);
      if (mark) {
        e.preventDefault();
        const sel = getPlainSelection(node);
        if (!sel) return;
        const out = pressMark(core.latest.value, sel, mark, pending?.plain === sel.from ? pending.marks : null, label);
        if (out.kind === "pending") pending = { plain: sel.from, marks: out.marks };
        else if (out.kind === "edit") {
          remember(out.text, sel.from, sel.to, "edit", sel);
          write(out.text, sel.from, sel.to);
        }
        return;
      }
      // a paragraph of the sticky is a line: Enter is a line break, as the text area it replaces had it
      if (e.key === "Enter" && !mod) {
        e.preventDefault();
        insertText(node, "\n");
      }
    },
  };
}

/**
 * A text field that is the formatted text: `value` is the stored source (paragraphs one per line, `**` and all), the
 * reader sees and edits the words with their marks. ⌘/Ctrl B I U E and Shift-H mark the selected words and leave them
 * selected (with nothing selected the mark is toggled for what is typed next), ⌘/Ctrl Z, Shift-Z and Y step back and
 * forward, Enter is a line break, and pasting inserts the words only.
 */
export function WysiwygField({
  value,
  onChange,
  ariaLabel,
  placeholder = "",
  className,
  autoFocus = false,
  sources = NO_SOURCES,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  sources?: Record<string, Source>;
}) {
  const [field] = useState(createField);
  useLayoutEffect(() => {
    field.core.follow({ value, onChange, label: (key) => (sources[key] ? authorYear(sources[key]) : `@${key}`) });
  });

  return <Surface id="field" text={value} sources={sources} api={field.api} label={ariaLabel} placeholder={placeholder} className={className} autoFocus={autoFocus} />;
}
