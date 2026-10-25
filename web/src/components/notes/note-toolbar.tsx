"use client";

// P10-09b (review 7.6, B16): the formatting toolbar above a note's blocks — "very like the comment feature in
// Word". It acts on the selection in the block that holds the caret, through the editor's own inline-Markdown
// model: bold `**…**`, italic `*…*`, underline `__…__`, highlight `==…==` and code are marks written around the
// selection (`markEdit`, `lib/notes/inline.ts`), so what is stored is what is exported; bullets, numbering and the
// heading turn the block's type. The keys do the same: ⌘/Ctrl+B bold, I italic, E code, U underline, Shift+H highlight.
//
// Pointer presses do not take focus (mousedown is cancelled), so the textarea keeps its caret and its selection when one
// is pressed. This file is the buttons and the key table; the editor applies them.

import type { BlockType } from "@/lib/notes/types";
import { canIndent } from "@/lib/notes/blocks";
import type { MarkName } from "@/lib/notes/inline";
import { cn } from "@/lib/cn";

type Item =
  | { id: string; kind: "mark"; mark: MarkName; label: string; keys: string; glyph: string; glyphClass?: string }
  | { id: string; kind: "type"; type: BlockType; label: string; keys: string; glyph: string; glyphClass?: string };

/** The buttons, in the order they stand. */
export const TOOLBAR_ITEMS: readonly Item[] = [
  { id: "strong", kind: "mark", mark: "strong", label: "Bold", keys: "Ctrl/⌘ B", glyph: "B", glyphClass: "font-bold" },
  { id: "em", kind: "mark", mark: "em", label: "Italic", keys: "Ctrl/⌘ I", glyph: "I", glyphClass: "italic" },
  { id: "underline", kind: "mark", mark: "underline", label: "Underline", keys: "Ctrl/⌘ U", glyph: "U", glyphClass: "underline underline-offset-[3px]" },
  { id: "mark", kind: "mark", mark: "mark", label: "Highlight", keys: "Ctrl/⌘ Shift H", glyph: "H", glyphClass: "bg-accent/25 px-1" },
  { id: "code", kind: "mark", mark: "code", label: "Code", keys: "Ctrl/⌘ E", glyph: "</>", glyphClass: "font-mono text-meta" },
  { id: "h2", kind: "type", type: "h2", label: "Heading", keys: "", glyph: "H2", glyphClass: "font-semibold" },
  { id: "bullet", kind: "type", type: "bullet", label: "Bulleted list", keys: "- ", glyph: "•" },
  { id: "numbered", kind: "type", type: "numbered", label: "Numbered list", keys: "1. ", glyph: "1." , glyphClass: "font-mono text-meta"},
];

/** The mark a keystroke asks for, if it is one of the toolbar's keys. */
export function markForKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): MarkName | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "h" ? "mark" : null;
  return ({ b: "strong", i: "em", e: "code", u: "underline" } as Record<string, MarkName>)[k] ?? null;
}

/** A list or heading button on a block already of that type turns it back into text. */
export function typeAfterToggle(current: BlockType, target: BlockType): BlockType {
  return current === target ? "text" : target;
}

export function NoteToolbarView({
  active,
  enabled,
  onMark,
  onType,
  onIndent,
  onReturn,
  className,
}: {
  /** The type of the block that holds the caret; null when none does. */
  active: BlockType | null;
  enabled: boolean;
  onMark: (mark: MarkName) => void;
  onType: (type: BlockType) => void;
  onIndent?: (delta: -1 | 1) => void;
  onReturn?: () => void;
  className?: string;
}) {
  return (
    <div role="toolbar" aria-label="Format" aria-keyshortcuts="Alt+F10" title="Alt+F10 moves between Format and editing."
      onKeyDown={(e) => {
        if (e.key === "F10" && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && onReturn) { e.preventDefault(); onReturn(); }
      }} className={cn("flex flex-wrap items-center gap-1", className)}>
      {TOOLBAR_ITEMS.map((item, i) => {
        const disabled = !enabled || (item.kind === "mark" && active === "code" && item.mark !== "code");
        return (
          <span key={item.id} className="contents">
            {i === 5 && <span aria-hidden className="mx-1 h-4 w-px bg-border-strong" />}
            <button
              type="button"
              aria-label={item.label}
              {...(item.kind === "type" ? { "aria-pressed": active === item.type } : {})}
              title={item.keys ? `${item.label} (${item.keys.trim()})` : item.label}
              disabled={disabled}
              // The caret stays in the block: pressing a button must not take focus from the textarea.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (item.kind === "mark" ? onMark(item.mark) : onType(item.type))}
              className={cn(
                "grid h-8 min-w-8 place-items-center px-2 text-body-sm text-text-muted transition-colors",
                "hover:bg-bg-secondary hover:text-heading disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
                item.kind === "type" && active === item.type && "bg-bg-secondary text-heading",
              )}
            >
              <span aria-hidden className={item.glyphClass}>
                {item.glyph}
              </span>
            </button>
          </span>
        );
      })}
      {onIndent && ([-1, 1] as const).map((delta) => (
        <button key={delta} type="button" aria-label={delta === 1 ? "Indent" : "Outdent"}
          title={delta === 1 ? "Indent (Tab)" : "Outdent (Shift+Tab)"} disabled={!enabled || !active || !canIndent(active)}
          onMouseDown={(e) => e.preventDefault()} onClick={() => onIndent(delta)}
          className="grid h-8 min-w-8 place-items-center px-2 text-body-sm text-text-muted hover:bg-bg-secondary hover:text-heading disabled:opacity-40">
          <span aria-hidden>{delta === 1 ? "→" : "←"}</span>
        </button>
      ))}
    </div>
  );
}

export { NoteToolbarView as NoteToolbar };
