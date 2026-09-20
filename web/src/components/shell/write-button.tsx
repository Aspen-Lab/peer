"use client";

// The one action in the masthead, among four words that are places.
//
// It is set apart the way the graph tells a term from a topic: outlined at
// rest, filled when it is the state you are in — no hue, because the accent
// is kept for signals. Pressed, it opens a note to write in; an untouched
// blank one is reused, so pressing it twice does not leave an empty note
// behind.

import { usePathname, useRouter } from "next/navigation";
import { isUntouched } from "@/lib/notes/blocks";
import { blankNote } from "@/lib/notes/templates";
import { newestFirst, useNotesStore } from "@/store/notes";
import { cn } from "@/lib/cn";

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
        "eyebrow mr-3 inline-flex h-7 items-center px-2.5 transition-colors",
        here
          ? "bg-heading text-bg"
          : "text-text-muted shadow-[inset_0_0_0_1px_var(--color-border-strong)] hover:bg-heading hover:text-bg hover:shadow-none",
      )}
    >
      Write
    </button>
  );
}
