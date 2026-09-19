"use client";

// On a paper's page: the reader's notes on it, and the way into them.
// "Take notes" opens the paper's own reading notes — made the first time,
// from its record and abstract — and every other note that cites it is
// listed under, Obsidian's backlinks for a paper.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import { Band } from "@/components/ui/band";
import { COMMAND } from "@/components/ui/command";
import { citableFromPaper } from "@/lib/notes/cite";
import { readingNote } from "@/lib/notes/templates";
import { notesCiting, readingNoteFor, useNotesHydrated, useNotesStore } from "@/store/notes";

export function PaperNotes({ paper }: { paper: Paper }) {
  const router = useRouter();
  const ready = useNotesHydrated();
  const notes = useNotesStore((s) => s.notes);
  const add = useNotesStore((s) => s.add);
  if (!ready) return null;

  const own = readingNoteFor(notes, paper.id);
  const citing = notesCiting(notes, paper.id).filter((n) => n.id !== own?.id);
  const open = () => {
    if (own) {
      router.push(`/notes/${own.id}`);
      return;
    }
    const note = readingNote(citableFromPaper(paper));
    add(note);
    router.push(`/notes/${note.id}`);
  };

  return (
    <Band label="Your notes">
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={COMMAND} onClick={open}>
          {own ? "Open your notes →" : "Take notes"}
        </button>
        {!own && citing.length === 0 && (
          <span className="annotation text-text-faint">Its card, the opening of its abstract, four questions to answer.</span>
        )}
      </div>
      {citing.length > 0 && (
        <ul className="mt-4 space-y-2">
          {citing.map((n) => (
            <li key={n.id} className="flex items-baseline gap-2">
              <span className="annotation text-text-faint">cited in</span>
              <Link href={`/notes/${n.id}`} className="font-reading text-body-sm text-text-muted hover:text-heading">
                {n.title.trim() || "Untitled"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Band>
  );
}
