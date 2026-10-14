"use client";

// On a paper's page: the reader's notes on it, and the way into them.
// "Take notes" opens the paper's own reading notes — made the first time, with
// the paper's title and your sticky notes (P10-09e) — and every other note that cites it is
// listed under, Obsidian's backlinks for a paper.
//
// P7-14 (R9, the owner's review): on the reading page the entry is a button —
// a small tab at the viewport's right edge, and on a phone a row in the command
// stack (`notes-button.tsx`) — not a band at the top of the column. What it does
// is this file's: `openPaperNotes` is the band's old `open()`, unchanged, and
// `usePaperNotes` reads the store the way the band did. The band itself stays
// for the page that stands in for an upload that cannot be opened
// (`UploadFallbackReading`), which has no tabs and no edge to put a tab on.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import type { Citable, Note } from "@/lib/notes/types";
import type { ReadingNoteExtras } from "@/lib/notes/templates";
import { Band } from "@/components/ui/band";
import { COMMAND } from "@/components/ui/command";
import { citableFromPaper } from "@/lib/notes/cite";
import { notesCiting, readingNoteFor, useNotesHydrated, useNotesStore } from "@/store/notes";

/** P2-05, then P10-09e: `questions` (the reader's settled ones, never the gist) and the
 *  report's `forYourQuestions` are still handed in, but the paper's note is the title and
 *  the reader's sticky notes, so they are not placed in it — the answers stand on the
 *  paper's page, under each question. */
interface NotesInputs {
  paper: Paper;
  questions?: readonly string[];
  forYourQuestions?: readonly QuestionAnswers[];
}

/**
 * Open the paper's own notes — made the first time, with the paper's title
 * and your sticky notes (P10-09e; the settled questions and the report's
 * answers stand on the paper's page, not in the note). The router and the store's `ensureReadingNote` are handed in, so this is the whole of
 * what pressing the button does and nothing in it needs a page to run.
 *
 * P10-09c: there is one `ensureReadingNote`, the store's (the template, made once, no navigation); the sticky notes' "Take notes"
 * and this press both call it, so the window and the Saved page's own note are the same note.
 *
 * P10-09b (review 7.2): given `openWindow` (the reading page's edge tab), the note opens as the floating window
 * and nothing navigates; without it (a phone's row, the upload page's band) it goes to `/notes/<id>` as before.
 */
export function openPaperNotes({
  own,
  paper,
  questions,
  forYourQuestions,
  ensure,
  push,
  openWindow,
}: NotesInputs & {
  own: Pick<Note, "id"> | undefined;
  ensure: (paper: Citable, extras?: ReadingNoteExtras) => string;
  push: (href: string) => void;
  openWindow?: () => void;
}): void {
  if (own) {
    if (openWindow) openWindow();
    else push(`/notes/${own.id}`);
    return;
  }
  const id = ensure(citableFromPaper(paper), { questions, forYourQuestions });
  if (openWindow) openWindow();
  else push(`/notes/${id}`);
}

/**
 * The paper's notes, as the page reads them: whether the store has loaded, the paper's own note, the
 * others that cite it, and the press that opens them.
 */
export function usePaperNotes({ paper, questions, forYourQuestions, openWindow }: NotesInputs & { openWindow?: () => void }) {
  const router = useRouter();
  const ready = useNotesHydrated();
  const notes = useNotesStore((s) => s.notes);
  const ensure = useNotesStore((s) => s.ensureReadingNote);

  const own = readingNoteFor(notes, paper.id);
  const citing = notesCiting(notes, paper.id).filter((n) => n.id !== own?.id);
  const open = () =>
    openPaperNotes({ own, paper, questions, forYourQuestions, ensure, push: (href) => router.push(href as Route), openWindow });
  return { ready, own, citing, open };
}

export function PaperNotes({
  paper,
  questions,
  forYourQuestions,
}: {
  paper: Paper;
  questions?: readonly string[];
  forYourQuestions?: readonly QuestionAnswers[];
}) {
  const { ready, own, citing, open } = usePaperNotes({ paper, questions, forYourQuestions });
  if (!ready) return null;

  return (
    <Band label="Your notes">
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={COMMAND} onClick={open}>
          {own ? "Open your notes →" : "Take notes"}
        </button>
        {!own && citing.length === 0 && (
          <span className="annotation text-text-faint">The note holds the paper&apos;s title and your sticky notes.</span>
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
