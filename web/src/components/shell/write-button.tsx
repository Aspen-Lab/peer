"use client";

// The one action in the masthead, among four words that are places.
//
// A filled action opens a note to write in. An untouched blank note is reused,
// so pressing it twice does not leave an empty note behind.

import { usePathname, useRouter } from "next/navigation";
import { isUntouched } from "@/lib/notes/blocks";
import { blankNote } from "@/lib/notes/templates";
import { newestFirst, useNotesStore } from "@/store/notes";
import { cn } from "@/lib/cn";
import { WriteGlyph } from "@/components/shell/icons";

export function WriteButton() {
  const router = useRouter();
  const add = useNotesStore((s) => s.add);
  const here = usePathname()?.startsWith("/notes/") ?? false;

  const write = () => {
    const blank = newestFirst(useNotesStore.getState().notes).find(isUntouched);
    const note = blank ?? blankNote();
    if (!blank) add(note);
    router.push(`/notes/${note.id}`);
  };

  return (
    <button
      type="button"
      onClick={write}
      aria-current={here ? "page" : undefined}
      title="Write a note"
      className={cn(
        "peer-write inline-flex h-8 items-center gap-1.5 px-3 transition-colors",
        here && "peer-write-current",
      )}
    >
      <WriteGlyph size={15} strokeWidth={1.6} />
      Write
    </button>
  );
}
