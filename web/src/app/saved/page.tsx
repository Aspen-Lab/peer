"use client";

// Saved: the shelf, and what the reader makes from it.
//
// This page used to be three peer sections — Papers, Events, Jobs — behind a
// kind switcher and a To-do / Done rail. The rail was for job applications and
// event registrations; its own comment admitted papers "have no completion
// action" and were pinned to To-do forever. Events and jobs are no longer
// product surfaces, so what remained was a shelf.
//
// A shelf is where reading turns into writing, so it now holds both:
//   Notes   the reader's own — reading notes on one paper, drafts from
//           several, or anything started blank. Newest first.
//   Papers  what was saved. Each can be taken notes on; "Draft from papers"
//           picks several and starts a related-work section or a paper's
//           outline with them already cited.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import type { Note } from "@/lib/notes/types";
import { useFeedStore } from "@/store/feed";
import { newestFirst, notesCiting, readingNoteFor, useNotesHydrated, useNotesStore } from "@/store/notes";
import { citableFromPaper } from "@/lib/notes/cite";
import { blankNote, outlineDraft, readingNote, relatedWorkDraft } from "@/lib/notes/templates";
import { PaperCard } from "@/components/cards/paper-card";
import { NoteCard } from "@/components/notes/note-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { Band } from "@/components/ui/band";
import { COMMAND } from "@/components/ui/command";
import { cn } from "@/lib/cn";

export type DraftKind = "related" | "outline";

export function SavedPageView({
  savedPapers,
  notes = {},
  notesReady = true,
  onNewNote,
  onDraft,
  onTakeNotes,
}: {
  savedPapers: Paper[];
  notes?: Record<string, Note>;
  /** False until this browser's notes have been read, so "no notes yet" is
   *  never said about notes that are about to appear. */
  notesReady?: boolean;
  onNewNote?: () => void;
  onDraft?: (papers: Paper[], kind: DraftKind) => void;
  onTakeNotes?: (paper: Paper) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const list = newestFirst(notes);
  const pickedPapers = savedPapers.filter((p) => picked.includes(p.id));
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const stop = () => {
    setSelecting(false);
    setPicked([]);
  };

  const counts = [
    savedPapers.length > 0 && `${savedPapers.length} paper${savedPapers.length === 1 ? "" : "s"}`,
    notesReady && list.length > 0 && `${list.length} note${list.length === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <PageContainer>
      <header className="mb-10">
        <h1 className="display-line text-display leading-[1.1] text-heading lg:text-display-lg">Saved</h1>
        {/* A count is a machine fact, not a lede — it was set at 16.5px on a
            measure written for prose, holding one number. */}
        {counts.length > 0 && <p className="annotation text-meta text-text-faint mt-3">{counts.join(" · ")}</p>}
      </header>

      <Band label="Notes" gap="none">
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className={COMMAND} onClick={onNewNote}>
            + New note
          </button>
          {notesReady && list.length === 0 && (
            <span className="annotation text-text-faint">
              Reading notes and drafts land here — kept in this browser, exported as Markdown.
            </span>
          )}
        </div>
        {list.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {list.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </Band>

      <Band label="Papers">
        {savedPapers.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Nothing saved yet."
              line="Tap the bookmark on any paper in your briefing and it will land here."
            />
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                className={COMMAND}
                aria-pressed={selecting}
                onClick={() => (selecting ? stop() : setSelecting(true))}
              >
                Draft from papers
              </button>
              <span className="annotation text-text-faint">
                {selecting
                  ? "Pick the papers to write from, then the kind of draft below."
                  : "Several papers into a related-work section or a paper's outline, already cited."}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              {savedPapers.map((paper) => {
                const on = picked.includes(paper.id);
                const own = notesReady ? readingNoteFor(notes, paper.id) : undefined;
                const citing = notesReady ? notesCiting(notes, paper.id).filter((n) => n.id !== own?.id).length : 0;
                return (
                  <div key={paper.id} className="relative">
                    <div inert={selecting || undefined}>
                      <PaperCard paper={paper} />
                    </div>
                    {selecting ? (
                      // In selection the whole card is the target; the card
                      // underneath is inert, so a click cannot open the paper.
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`Draft from “${paper.title}”`}
                        onClick={() => toggle(paper.id)}
                        className={cn(
                          "absolute inset-0 z-10 flex items-start justify-end p-3 transition-shadow",
                          on
                            ? "shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
                            : "hover:shadow-[inset_0_0_0_1px_var(--color-text-faint)]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-5 w-5 place-items-center",
                            on ? "bg-accent text-bg" : "bg-surface shadow-[inset_0_0_0_1px_var(--color-border-strong)]",
                          )}
                        >
                          {on && (
                            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
                              <path d="M1.5 5.2 4 7.6 8.6 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
                            </svg>
                          )}
                        </span>
                      </button>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button type="button" className={COMMAND} onClick={() => onTakeNotes?.(paper)}>
                          {own ? "Your notes →" : "Take notes"}
                        </button>
                        {citing > 0 && (
                          <span className="annotation text-text-faint">
                            cited in {citing} {citing === 1 ? "note" : "notes"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selecting && (
              <div className="sticky bottom-24 z-20 mt-6 flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3 shadow-card md:bottom-6">
                <span className="annotation text-text-muted tabular-nums" aria-live="polite">
                  {picked.length === 0 ? "None picked yet" : `${picked.length} picked`}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={COMMAND}
                    disabled={picked.length === 0}
                    onClick={() => onDraft?.(pickedPapers, "related")}
                  >
                    Related work
                  </button>
                  <button
                    type="button"
                    className={COMMAND}
                    disabled={picked.length === 0}
                    onClick={() => onDraft?.(pickedPapers, "outline")}
                  >
                    Paper outline
                  </button>
                  <button type="button" className={COMMAND} onClick={stop}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Band>
    </PageContainer>
  );
}

export default function SavedPage() {
  const router = useRouter();
  const savedPapers = useFeedStore((state) => state.savedPapers);
  const notes = useNotesStore((s) => s.notes);
  const notesReady = useNotesHydrated();
  const add = useNotesStore((s) => s.add);

  const open = (note: Note) => {
    add(note);
    router.push(`/notes/${note.id}`);
  };

  return (
    <SavedPageView
      savedPapers={savedPapers}
      notes={notes}
      notesReady={notesReady}
      onNewNote={() => open(blankNote())}
      onDraft={(papers, kind) =>
        open((kind === "related" ? relatedWorkDraft : outlineDraft)(papers.map(citableFromPaper)))
      }
      onTakeNotes={(paper) => {
        const own = readingNoteFor(useNotesStore.getState().notes, paper.id);
        if (own) router.push(`/notes/${own.id}`);
        else open(readingNote(citableFromPaper(paper)));
      }}
    />
  );
}
