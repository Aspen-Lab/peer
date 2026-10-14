"use client";

// P10-09a (the owner's review 7.1c; rubric B11; ruling §1h.78): the tie between a sticky note and the passage it was
// taken on, in both directions.
//
//   The tag — a small superscript [N] after the passage, like a citation mark, in the label face. Pressing it
//   opens that sticky. It is not selectable (`select-none`): the words of the passage stay the paper's.
//
//   The blue square — at the left of the sticky's text, and of the note's "Note N" heading, a small blue square
//   that scrolls the paper back to the passage, and marks it for a moment. On the reading page that is a scroll
//   (the reading page registers itself as the host, so the paper's text is brought on if the other tab is on show);
//   anywhere else — the notes page — it goes to the paper's page at the paragraph (`#paper-section-1-p2`).

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { stickyTitle } from "@/lib/notes/blocks";
import type { NoteAnchor } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";

/** How long the passage stays marked after the square scrolls to it. */
export const FLASH_MS = 1500;
/** The square's side: at least 12 px. */
export const SQUARE_PX = 14;
/** The blue of the square: one blue that reads on the light and the dark page. */
export const SQUARE_BLUE = "#3b82f6";

const FLASH_CLASSES = ["bg-accent-dim", "outline", "outline-2", "outline-offset-4", "outline-accent", "transition-colors"];

/** The reference tag after a passage: [N], opens sticky N. */
export function NoteTag({ n, id }: { n: number; id: string }) {
  return (
    <sup className="ml-0.5 select-none align-super">
      <button
        type="button"
        aria-label={`Open note ${n}`}
        onClick={() => useWindows.getState().open({ id, kind: "sticky", title: stickyTitle(n) })}
        className="select-none px-px font-mono text-meta leading-none text-text-muted underline-offset-2 hover:text-heading hover:underline"
      >
        {`[${n}]`}
      </button>
    </sup>
  );
}

/** The small blue square, as a button; what it does is the caller's. */
export function AnchorSquare({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Go to the passage"
      title="Go to the passage"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      style={{ width: SQUARE_PX, height: SQUARE_PX, backgroundColor: SQUARE_BLUE }}
      className="inline-block shrink-0 border-0 p-0 align-middle opacity-90 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heading"
    />
  );
}

// ── Going back to the passage ─────────────────────────────────────────────

/** The reading page, while it is mounted: the paper it shows, and how to make sure its text is on show. */
export interface PassageHost {
  paperId: string;
  reveal: (run: () => void) => void;
}

let host: PassageHost | null = null;

/** The reading page registers itself; the returned function takes it off again (identity-guarded). */
export function registerPassageHost(next: PassageHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

function flash(el: Element): void {
  el.classList.add(...FLASH_CLASSES);
  setTimeout(() => el.classList.remove(...FLASH_CLASSES), FLASH_MS);
}

/**
 * Scroll the paper to the sticky's passage and mark it for `FLASH_MS`; when the paper is not on this page, go to
 * its page at the paragraph. The reading page of that paper (registered) first brings the paper's text on show.
 */
export function goToPassage(
  anchor: NoteAnchor,
  env: { doc: Pick<Document, "getElementById">; navigate: (href: string) => void },
): void {
  const run = (): boolean => {
    const el = env.doc.getElementById(anchor.paragraphId);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    flash(el);
    return true;
  };
  if (host && host.paperId === anchor.paperId) {
    host.reveal(() => {
      run();
    });
    return;
  }
  if (!run()) env.navigate(`/papers/${anchor.paperId}#${anchor.paragraphId}`);
}

/** The blue square wired to `goToPassage` — for the note editor's heading, which has no page of its own to ask. */
export function AnchorLink({ anchor }: { anchor: NoteAnchor }) {
  const router = useRouter();
  return <AnchorSquare onClick={() => goToPassage(anchor, { doc: document, navigate: (href) => router.push(href as Route) })} />;
}
