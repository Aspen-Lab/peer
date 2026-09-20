"use client";

// The notes rail: every note in this browser, beside the one being written —
// Obsidian's file list, Notion's sidebar. Switching notes is a click, not a
// trip back to the shelf.
//
// It is a rail, not the shell's sidebar: Peer's chrome is the masthead
// (v0.14.0 deleted the app sidebar), and this belongs to the editor the way a
// contents column belongs to a document.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { citedKeys, excerpt } from "@/lib/notes/blocks";
import { blankNote } from "@/lib/notes/templates";
import { newestFirst, useNotesStore } from "@/store/notes";
import { formatTimeAgo } from "@/lib/format";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";

/** Past this many, the rail carries a filter — under it, the eye is faster. */
const FILTER_FROM = 7;

export function NotesRail({
  currentId,
  className,
  onPicked,
}: {
  currentId?: string;
  className?: string;
  /** Closes the rail where it is a panel rather than a column. */
  onPicked?: () => void;
}) {
  const notes = useNotesStore((s) => s.notes);
  const add = useNotesStore((s) => s.add);
  const router = useRouter();
  const [query, setQuery] = useState("");

  const list = useMemo(() => newestFirst(notes), [notes]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => `${n.title} ${excerpt(n, 400)}`.toLowerCase().includes(q));
  }, [list, query]);

  const start = () => {
    const note = blankNote();
    add(note);
    onPicked?.();
    router.push(`/notes/${note.id}`);
  };

  return (
    <nav aria-label="Your notes" className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow text-text-faint tabular-nums">
          Notes{list.length > 0 ? ` · ${list.length}` : ""}
        </p>
        <button type="button" className={COMMAND} onClick={start}>
          + New
        </button>
      </div>

      {list.length >= FILTER_FROM && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          aria-label="Filter notes"
          className="annotation w-full bg-transparent px-2 py-1 text-text shadow-[inset_0_0_0_1px_var(--color-border-strong)] outline-none placeholder:text-text-faint/70 focus:shadow-[inset_0_0_0_1px_var(--color-text-muted)]"
        />
      )}

      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {shown.map((note) => {
          const here = note.id === currentId;
          const edited = formatTimeAgo(note.updatedAt);
          const sources = citedKeys(note).filter((k) => note.sources[k]).length;
          return (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                onClick={onPicked}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "block px-2 py-2 transition-colors",
                  here
                    ? "bg-bg-secondary text-heading shadow-[inset_2px_0_0_0_var(--color-text-muted)]"
                    : "text-text-muted hover:bg-bg-secondary/60 hover:text-heading",
                )}
              >
                <span className="line-clamp-2 block font-reading text-body-sm leading-[1.4]">
                  {note.title.trim() || "Untitled"}
                </span>
                <span className="annotation mt-1 block text-text-faint">
                  {[note.paperId ? "reading notes" : sources > 0 ? `${sources} cited` : null, edited]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="annotation px-2 text-text-faint">
            {query ? `Nothing matches “${query}”` : "Nothing written yet."}
          </li>
        )}
      </ul>
    </nav>
  );
}
