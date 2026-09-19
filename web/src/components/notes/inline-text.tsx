"use client";

// A block's inline Markdown, rendered. Every run carries `data-inner` — the
// source offset its visible text starts at — so a click can be turned back
// into a caret position in the source (components/notes/caret.ts).

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { parseInline } from "@/lib/notes/inline";
import { authorYear } from "@/lib/notes/cite";
import type { Source } from "@/lib/notes/types";

const LINK =
  "underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-text-muted";

export function InlineText({
  text,
  sources,
  noteId,
  onMissingNote,
}: {
  text: string;
  sources: Record<string, Source>;
  /** The note a `[[Title]]` link names, if there is one in this browser. */
  noteId: (title: string) => string | null;
  /** A link to a note that does not exist yet makes it, the way Obsidian does. */
  onMissingNote: (title: string) => void;
}) {
  const tokens = useMemo(() => parseInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "text":
            return (
              <span key={i} data-inner={t.inner}>
                {t.text}
              </span>
            );
          case "strong":
            return (
              <strong key={i} data-inner={t.inner} className="font-semibold text-heading">
                {t.text}
              </strong>
            );
          case "em":
            return (
              <em key={i} data-inner={t.inner}>
                {t.text}
              </em>
            );
          case "code":
            return (
              <code key={i} data-inner={t.inner} className="font-mono text-[0.86em] bg-bg-secondary/70 px-1">
                {t.text}
              </code>
            );
          case "link":
          case "url":
            return (
              <a key={i} data-inner={t.inner} href={t.href} target="_blank" rel="noreferrer" className={LINK}>
                {t.text}
              </a>
            );
          case "cite":
            // Pandoc's reading of `[@key]`: author and year in parentheses. A
            // key the note holds no source for says so rather than guessing.
            return (
              <span key={i} data-inner={t.to} data-atomic="" className="text-text-muted">
                (
                {t.keys.map((key, j) => {
                  const source = sources[key];
                  return (
                    <Fragment key={key}>
                      {j > 0 && "; "}
                      {source ? (
                        <Link href={`/papers/${source.paperId}`} title={source.title} className={`${LINK} decoration-dotted`}>
                          {authorYear(source)}
                        </Link>
                      ) : (
                        <span title="No paper with this key in this note" className="text-text-faint">
                          @{key}
                        </span>
                      )}
                    </Fragment>
                  );
                })}
                )
              </span>
            );
          case "wiki": {
            const id = noteId(t.target);
            return id ? (
              <Link key={i} data-inner={t.to} data-atomic="" href={`/notes/${id}`} className={LINK}>
                {t.target}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                data-inner={t.to}
                data-atomic=""
                title="No note with this title yet — click to start it"
                onClick={() => onMissingNote(t.target)}
                className={`${LINK} decoration-dashed text-text-muted`}
              >
                {t.target}
              </button>
            );
          }
        }
      })}
    </>
  );
}
