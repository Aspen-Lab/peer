"use client";

import Link from "next/link";
import type { Note } from "@/lib/notes/types";
import { citedKeys, excerpt } from "@/lib/notes/blocks";
import { formatTimeAgo } from "@/lib/format";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";

/** A note on the shelf: its title in the paper's face, its opening words,
 *  and what it cites. */
export function NoteCard({ note }: { note: Note }) {
  const text = excerpt(note, 180);
  const sources = citedKeys(note).filter((k) => note.sources[k]).length;
  const edited = formatTimeAgo(note.updatedAt);
  return (
    <Link href={`/notes/${note.id}`} className={cn(cardShell({ padding: "md", entrance: "none" }), "cropmarks relative")}>
      {note.paperId && <p className="eyebrow mb-2 text-text-faint">Reading notes</p>}
      <h3 className="paper-line line-clamp-2 text-title-lg leading-[1.3] text-heading">{note.title.trim() || "Untitled"}</h3>
      {text && <p className="mt-2 line-clamp-3 font-reading text-body-sm leading-[1.55] text-text-muted">{text}</p>}
      <p className="annotation mt-3 text-text-faint tabular-nums">
        {[sources > 0 && `${sources} ${sources === 1 ? "source" : "sources"}`, edited && `edited ${edited}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Link>
  );
}
