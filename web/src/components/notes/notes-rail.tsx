"use client";

// The editor's rail: the reader's files, beside the one being written.
//
// Two tabs, because writing from papers needs both at hand:
//   Notes   every note in this browser — open one, rename it, duplicate it,
//           export it, delete it. Obsidian's file list, Notion's sidebar.
//   Papers  the shelf. A paper opens as its RECORD — authors, venue, year,
//           its own abstract, where it lives — and from there it can be cited
//           where the caret is, placed as a card, or opened in full.
//
// The record view is also where a citation in the text leads: clicking
// "(Rose et al., 2024)" while writing shows the paper here instead of
// navigating away from the draft.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import type { Citable, Note, Source } from "@/lib/notes/types";
import { citedKeys, excerpt } from "@/lib/notes/blocks";
import { authorYear, citableFromPaper } from "@/lib/notes/cite";
import { blankNote } from "@/lib/notes/templates";
import { fileName, toMarkdown } from "@/lib/notes/export";
import { newestFirst, readingNoteFor, useNotesStore } from "@/store/notes";
import { useFeedStore } from "@/store/feed";
import { formatTimeAgo } from "@/lib/format";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";

/** Past this many, the rail carries a filter — under it, the eye is faster. */
const FILTER_FROM = 7;

export type RailTab = "notes" | "papers";

export interface RailProps {
  currentId?: string;
  /** The paper whose record is open, by paper id. */
  preview?: string | null;
  onPreview?: (paperId: string | null) => void;
  tab?: RailTab;
  onTab?: (tab: RailTab) => void;
  /** Put `[@key]` where the caret last was. */
  onCite?: (paper: Citable) => void;
  /** Place the paper as a card block. */
  onCard?: (paper: Citable) => void;
  /** The open note's own sources, so a paper cited but no longer saved is
   *  still in the list. */
  sources?: Record<string, Source>;
  className?: string;
  /** Closes the rail where it is a panel rather than a column. */
  onPicked?: () => void;
}

/** What a row says under its title.
 *
 *  It used to say the kind — and four reading notes in a row read "reading
 *  notes · 22h ago · reading notes · 22h ago", which is six words of nothing.
 *  A reading note is about a paper, so it says which paper; any other note
 *  says how much of other people's work is in it. The kind is already in the
 *  title: for a reading note the title IS the paper. */
function noteMeta(note: Note, cites: number): string {
  const about = note.paperId
    ? Object.values(note.sources).find((s) => s.paperId === note.paperId)
    : undefined;
  // `authorYear` falls back to the first words of the title when a record
  // carries no authors — under the title itself that reads as a stutter, so
  // an author-less paper says where it was published instead.
  const first = about
    ? about.authors.length > 0
      ? authorYear(about)
      : [about.venue, about.year].filter(Boolean).join(", ") || null
    : cites > 0
      ? `${cites} cited`
      : null;
  // "22h", not "22h ago": in a column of them the word never varies.
  const edited = formatTimeAgo(note.updatedAt)?.replace(/ ago$/, "") ?? null;
  return [first, edited].filter(Boolean).join(" \u00b7 ");
}

function rowClass(active: boolean): string {
  return cn(
    "block w-full px-2 py-2.5 text-left transition-colors",
    active
      ? "bg-bg-secondary text-heading shadow-[inset_2px_0_0_0_var(--color-text-muted)]"
      : "text-text-muted hover:bg-bg-secondary/60 hover:text-heading",
  );
}

export function EditorRail({
  currentId,
  preview = null,
  onPreview,
  tab = "notes",
  onTab,
  onCite,
  onCard,
  sources = {},
  className,
  onPicked,
}: RailProps) {
  const notes = useNotesStore((s) => s.notes);
  const add = useNotesStore((s) => s.add);
  const saveNote = useNotesStore((s) => s.save);
  const removeNote = useNotesStore((s) => s.remove);
  const saved = useFeedStore((s) => s.savedPapers);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const list = useMemo(() => newestFirst(notes), [notes]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) => `${n.title} ${excerpt(n, 400)}`.toLowerCase().includes(q));
  }, [list, query]);

  /** Every paper this note can reach: the shelf, and whatever it already
   *  cites — a paper taken off the shelf is still in the draft. */
  const papers = useMemo(() => {
    const out: { citable: Citable; paper?: Paper; onShelf: boolean }[] = saved.map((p) => ({
      citable: citableFromPaper(p),
      paper: p,
      onShelf: true,
    }));
    const have = new Set(out.map((x) => x.citable.id));
    for (const s of Object.values(sources)) {
      if (have.has(s.paperId)) continue;
      have.add(s.paperId);
      out.push({
        citable: {
          id: s.paperId,
          title: s.title,
          authors: s.authors,
          venue: s.venue,
          publishedDate: s.year ? String(s.year) : undefined,
          doi: s.doi,
          url: s.url,
        },
        onShelf: false,
      });
    }
    return out;
  }, [saved, sources]);

  const open = papers.find((p) => p.citable.id === preview);

  const start = () => {
    const note = blankNote();
    add(note);
    onPicked?.();
    router.push(`/notes/${note.id}`);
  };

  const download = (note: Note) => {
    const url = URL.createObjectURL(new Blob([toMarkdown(note)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(note, "md");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const duplicate = (note: Note) => {
    const copy = { ...blankNote(), title: note.title ? `${note.title} copy` : "", blocks: note.blocks.map((b) => ({ ...b })), sources: { ...note.sources } };
    add(copy);
    onPicked?.();
    router.push(`/notes/${copy.id}`);
  };

  const remove = (note: Note) => {
    if (!window.confirm(`Delete “${note.title.trim() || "Untitled"}”? It is kept only in this browser.`)) return;
    removeNote(note.id);
    if (note.id === currentId) router.push("/saved");
  };

  // ── The record of one paper ──
  if (open) {
    const { citable: c, paper, onShelf } = open;
    const abstract = paper?.summaryIntro?.trim() || c.abstract?.trim() || "";
    const own = readingNoteFor(notes, c.id);
    const link = c.url ?? (c.doi ? `https://doi.org/${c.doi}` : undefined);
    return (
      <div className={cn("flex min-h-0 flex-col gap-3", className)}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="eyebrow text-text-faint hover:text-heading" onClick={() => onPreview?.(null)}>
            ← Papers
          </button>
          {!onShelf && <span className="annotation text-text-faint">cited, not on the shelf</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <p className="eyebrow text-text-faint">
            {authorYear({ authors: c.authors, year: c.publishedDate ? Number(c.publishedDate.slice(0, 4)) : undefined, title: c.title })}
            {c.venue ? ` · ${c.venue}` : ""}
          </p>
          <p className="paper-line mt-1 text-title leading-[1.3] text-heading">{c.title}</p>
          {c.authors.length > 0 && (
            <p className="annotation mt-2 leading-[1.6] text-text-faint">{c.authors.join(", ")}</p>
          )}
          {abstract && (
            <p className="mt-3 font-reading text-body-sm leading-[1.55] text-text-muted">{abstract}</p>
          )}
          {!abstract && <p className="annotation mt-3 text-text-faint">The record carries no abstract.</p>}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <button type="button" className={COMMAND} onClick={() => onCite?.(c)} disabled={!onCite}>
            Cite
          </button>
          <button type="button" className={COMMAND} onClick={() => onCard?.(c)} disabled={!onCard}>
            Card
          </button>
          <Link href={`/papers/${c.id}`} className={COMMAND} onClick={onPicked}>
            Open →
          </Link>
          {own && (
            <Link href={`/notes/${own.id}`} className={COMMAND} onClick={onPicked}>
              Its notes →
            </Link>
          )}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className={COMMAND}>
              Source ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      {/* The two drawers of the cabinet. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(["notes", "papers"] as RailTab[]).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => onTab?.(name)}
              className={cn(
                "eyebrow px-2 py-1 transition-colors",
                tab === name ? "bg-heading text-bg" : "text-text-faint hover:text-heading",
              )}
            >
              {name === "notes" ? `Notes${list.length > 0 ? ` ${list.length}` : ""}` : `Papers${papers.length > 0 ? ` ${papers.length}` : ""}`}
            </button>
          ))}
        </div>
        {tab === "notes" ? (
          <button type="button" className={COMMAND} onClick={start}>
            + New
          </button>
        ) : (
          <Link href="/saved" className={COMMAND} onClick={onPicked}>
            Shelf →
          </Link>
        )}
      </div>

      {tab === "notes" ? (
        <>
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
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-auto">
            {shown.map((note) => {
              const here = note.id === currentId;
              const cites = citedKeys(note).filter((k) => note.sources[k]).length;
              return (
                <li key={note.id} className="group/row relative">
                  {renaming === note.id ? (
                    <RenameRow
                      title={note.title}
                      onDone={(title) => {
                        if (title !== note.title) saveNote(note.id, { title });
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <>
                      <Link
                        href={`/notes/${note.id}`}
                        onClick={onPicked}
                        aria-current={here ? "page" : undefined}
                        className={rowClass(here)}
                      >
                        <span className="line-clamp-2 pr-6 font-reading text-body-sm leading-[1.4]">
                          {note.title.trim() || "Untitled"}
                        </span>
                        <span className="annotation mt-1 block truncate text-text-faint">
                          {noteMeta(note, cites)}
                        </span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Manage “${note.title.trim() || "Untitled"}”`}
                        aria-expanded={menuFor === note.id}
                        onClick={() => setMenuFor((id) => (id === note.id ? null : note.id))}
                        className={cn(
                          "absolute right-1 top-1 grid h-6 w-6 place-items-center text-text-faint transition-opacity hover:text-heading",
                          menuFor === note.id ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100",
                        )}
                      >
                        <span aria-hidden className="font-mono text-meta leading-none">
                          ···
                        </span>
                      </button>
                      {menuFor === note.id && (
                        <>
                          <button
                            type="button"
                            aria-hidden
                            tabIndex={-1}
                            className="fixed inset-0 z-20 cursor-default"
                            onClick={() => setMenuFor(null)}
                          />
                          <div role="menu" className="absolute right-1 top-7 z-30 w-40 bg-surface py-1 shadow-card">
                            {[
                              ["Rename", () => setRenaming(note.id)],
                              ["Duplicate", () => duplicate(note)],
                              ["Export .md", () => download(note)],
                              ["Delete", () => remove(note)],
                            ].map(([label, run]) => (
                              <button
                                key={label as string}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuFor(null);
                                  (run as () => void)();
                                }}
                                className={cn(
                                  "block w-full px-3 py-2 text-left text-body-sm text-text-muted hover:bg-bg-secondary/70 hover:text-heading",
                                  label === "Delete" && "hover:text-red",
                                )}
                              >
                                {label as string}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="annotation px-2 text-text-faint">
                {query ? `Nothing matches “${query}”` : "Nothing written yet."}
              </li>
            )}
          </ul>
        </>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-auto">
          {papers.map(({ citable: c, onShelf }) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPreview?.(c.id)} className={rowClass(false)}>
                <span className="line-clamp-2 font-reading text-body-sm leading-[1.4]">{c.title}</span>
                <span className="annotation mt-1 block truncate text-text-faint">
                  {[
                    c.authors.length > 0
                      ? authorYear({ authors: c.authors, year: c.publishedDate ? Number(c.publishedDate.slice(0, 4)) : undefined, title: c.title })
                      : c.venue,
                    onShelf ? null : "cited",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
          {papers.length === 0 && (
            <li className="annotation px-2 text-text-faint">
              Nothing saved yet. Bookmark a paper in your briefing and it can be cited here.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function RenameRow({ title, onDone }: { title: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone(title);
        }
      }}
      aria-label="Note title"
      className="w-full bg-transparent px-2 py-2 font-reading text-body-sm text-heading shadow-[inset_0_0_0_1px_var(--color-text-muted)] outline-none"
    />
  );
}
