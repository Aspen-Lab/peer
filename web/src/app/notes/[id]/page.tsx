"use client";

// One note, open in the editor. Notes live in this browser, so the page is
// drawn once the notes store has been read from it — before that there is
// nothing true to show, not even "not found".

import Link from "next/link";
import { useParams } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { COMMAND } from "@/components/ui/command";
import { useNotesHydrated, useNotesStore } from "@/store/notes";

export default function NotePage() {
  const { id = "" } = useParams<{ id: string }>();
  const ready = useNotesHydrated();
  const note = useNotesStore((s) => s.notes[id]);

  return (
    // The board's width: the note keeps its own measure, and the room around
    // it carries the notes rail and the shelf.
    <PageContainer width="board" rhythm="reader" className="pb-24">
      {!ready ? null : note ? (
        // Keyed by the note: moving to another note starts a fresh editor
        // rather than carrying one note's state into the next.
        <NoteEditor key={note.id} note={note} />
      ) : (
        <EmptyState
          label="Notes"
          title="This note isn't in this browser."
          line="Notes are kept on the device they were written on. Export one as Markdown to carry it somewhere else."
          actions={
            <Link href="/saved" className={COMMAND}>
              ← Saved
            </Link>
          }
        />
      )}
    </PageContainer>
  );
}
