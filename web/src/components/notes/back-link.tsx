"use client";

// P11-06 (the owner's item 3): the notes page's top-left button. "← Saved" to the Saved library, as it always was; but a note
// opened from a paper by "Open your notes" reads "← Back to paper" and goes straight back to that paper, on the tab and at the
// place the reader left (the paper's page puts them back: `useRestoreReaderPlace`). What it says is `backTarget`'s
// (`lib/notes/return-to-paper.ts`); this draws it, and tells the record when the page is left any other way.

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { backTarget, dropPlaceFor, leaseReturn, readRawReturn, type BackTarget } from "@/lib/notes/return-to-paper";

/** The bar's link as it was: the small mono label, no outline. */
const LINK = "eyebrow text-text-faint hover:text-heading";

export function NotesBackLinkView({ target, onLeave }: { target: BackTarget; onLeave?: () => void }) {
  return (
    <Link href={target.href as Route} className={LINK} onClick={onLeave}>
      {`← ${target.label}`}
    </Link>
  );
}

/** Nothing changes the record while the page stands, so there is nothing to subscribe to. */
const subscribe = () => () => {};

export function NotesBackLink({ noteId }: { noteId: string }) {
  // The server (and the first, hydrating render) has no tab storage: "Saved". The browser's answer follows at once.
  const raw = useSyncExternalStore(subscribe, readRawReturn, () => null);
  const target = useMemo(() => backTarget(noteId, raw), [noteId, raw]);
  const [lease] = useState(() => leaseReturn(() => dropPlaceFor(noteId)));
  useEffect(() => {
    lease.mount();
    return () => lease.unmount();
  }, [lease]);
  return <NotesBackLinkView target={target} onLeave={target.fromPaper ? lease.leave : undefined} />;
}
