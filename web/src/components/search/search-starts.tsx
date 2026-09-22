"use client";

// What the search page offers before a word is typed.
//
// Four plates, each a set of queries waiting to be run, drawn from what this
// browser already knows: the reader's own topics, the terms their reading
// shared, the first authors on their shelf, and what they searched before.
//
// Plates, not lists. The first version set these as bare words under
// eyebrows, and it read as a page that had not been designed — three columns
// of grey type with nothing to hold them. Each group is now a card in the
// product's own frame (the surface, the grain, the registration corners the
// notes and the briefing use), with a glyph naming what kind of thing it
// holds; each start is a chip with its own mark — a paper's subject mark for
// a term, a person for an author, the clock for a past search — and its
// count set in a small square. The same hand as the rest of Peer, so the
// page reads as Peer and not as a form.
//
// A plate with nothing in it is not drawn — a fresh browser sees the field
// and one line about what it takes, and nothing pretending to be history.

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { cardShell } from "@/components/ui/card-shell";
import { TopicMark } from "@/components/cards/topic-mark";
import { topicMarkOf } from "@/lib/papers/topic-mark";
import {
  authorsFromShelf,
  parseRecent,
  RECENT_EVENT,
  RECENT_KEY,
  termsFromReading,
  writeRecent,
  type Start,
} from "@/lib/search/starts";
import { cn } from "@/lib/cn";

// ── localStorage as an external store ──
// The snapshot is the raw string, equal by value from one read to the next,
// so the hook does not loop the way a freshly parsed array would make it.
function subscribeRecent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECENT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RECENT_EVENT, onChange);
  };
}
function rawRecent(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? "";
  } catch {
    return "";
  }
}

// ── Glyphs, on the shell's 24-unit grid ──

const GLYPH = {
  width: 13,
  height: 13,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** What the reader declared: the profile's own sign for a topic. */
function HashGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M4.5 9h15M4.5 15h15M10 3.5 8 20.5M16 3.5l-2 17" />
    </svg>
  );
}

/** A person — the shell's own, at chip size. */
function PersonGlyph() {
  return (
    <svg {...GLYPH}>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
    </svg>
  );
}

/** Time gone by. */
function ClockGlyph() {
  return (
    <svg {...GLYPH}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

/** What the reader's papers were about: an open book. */
function ReadingGlyph() {
  return (
    <svg {...GLYPH}>
      <path d="M12 7.6C10 5.6 7 5.1 4 5.6v12.2c3-.5 6 0 8 2 2-2 5-2.5 8-2V5.6c-3-.5-6 0-8 2z" />
      <path d="M12 7.6v12.2" />
    </svg>
  );
}

// ── The chip ──

function StartChip({
  start,
  mark,
  onPick,
}: {
  start: Start;
  /** The chip's own glyph, at its left. */
  mark: ReactNode;
  onPick: (query: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(start.query)}
      title={`Search “${start.query}”`}
      className={cn(
        "group/chip inline-flex max-w-full items-center gap-2 px-2 py-1.5 text-left text-body-sm text-text-muted",
        "shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-colors",
        "hover:bg-bg-secondary/70 hover:text-heading hover:shadow-[inset_0_0_0_1px_var(--color-text-faint)]",
        "active:bg-bg-secondary",
      )}
    >
      <span className="shrink-0 text-text-faint transition-colors group-hover/chip:text-accent">{mark}</span>
      <span className="truncate">{start.query}</span>
      {typeof start.count === "number" && (
        // The count in its own square: a fact about the chip, not part of
        // its words.
        <span className="ml-1 grid h-5 min-w-5 shrink-0 place-items-center bg-bg-secondary px-1 font-mono text-caption tabular-nums text-text-faint">
          {start.count}
        </span>
      )}
    </button>
  );
}

// ── The plate ──

function StartPlate({
  glyph,
  label,
  starts,
  markOf,
  onPick,
  onClear,
}: {
  glyph: ReactNode;
  label: string;
  starts: Start[];
  /** The mark a chip carries. Defaults to the plate's glyph. */
  markOf?: (start: Start) => ReactNode;
  onPick: (query: string) => void;
  onClear?: () => void;
}) {
  if (starts.length === 0) return null;
  return (
    <section
      aria-label={label}
      className={cn(cardShell({ padding: "md", entrance: "none" }), "cropmarks relative flex flex-col gap-4")}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="eyebrow inline-flex items-center gap-2 text-text-faint">
          <span className="text-text-muted">{glyph}</span>
          {label}
        </h2>
        <span className="flex items-center gap-3">
          <span className="annotation tabular-nums text-text-faint">{starts.length}</span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="annotation text-text-faint underline decoration-border-strong underline-offset-[3px] transition-colors hover:text-heading"
            >
              clear
            </button>
          )}
        </span>
      </header>
      <ul className="flex flex-wrap gap-2">
        {starts.map((s) => (
          <li key={s.query} className="max-w-full">
            <StartChip start={s} mark={markOf ? markOf(s) : glyph} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The page's starts ──

export function SearchStarts({ onPick }: { onPick: (query: string) => void }) {
  const profile = useProfileStore((s) => s.profile);
  const library = useFeedStore((s) => s.library);
  const saved = useFeedStore((s) => s.savedPapers);

  const topics = useMemo<Start[]>(() => {
    const own = [...(profile.researchTopics ?? []), ...(profile.softTopics ?? [])]
      .map((t) => t.trim())
      .filter(Boolean);
    return [...new Set(own)].map((query) => ({ query }));
  }, [profile.researchTopics, profile.softTopics]);

  const terms = useMemo(
    () => termsFromReading(library, saved, topics.map((t) => t.query)),
    [library, saved, topics],
  );
  const authors = useMemo(() => authorsFromShelf(saved), [saved]);

  // This browser's, and the server has none: the server snapshot is empty.
  const raw = useSyncExternalStore(subscribeRecent, rawRecent, () => "");
  const recent = useMemo(() => parseRecent(raw), [raw]);

  const empty = topics.length === 0 && terms.length === 0 && authors.length === 0 && recent.length === 0;
  if (empty) {
    return (
      <p className="annotation mt-8 text-text-faint">
        A title, an author, a venue or a concept. Two letters is enough to begin.
      </p>
    );
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
      <StartPlate glyph={<HashGlyph />} label="Your topics" starts={topics} onPick={onPick} />
      <StartPlate
        glyph={<ReadingGlyph />}
        label="From your reading"
        starts={terms}
        // Each term takes the subject mark a card would take for it, so the
        // chips here and the marks on the briefing are one vocabulary.
        markOf={(s) => {
          const mark = topicMarkOf({ title: s.query });
          return <TopicMark topic={mark.key} label={mark.label} size={13} strokeWidth={1.6} />;
        }}
        onPick={onPick}
      />
      <StartPlate glyph={<PersonGlyph />} label="People on your shelf" starts={authors} onPick={onPick} />
      <StartPlate
        glyph={<ClockGlyph />}
        label="You searched"
        starts={recent.map((query) => ({ query }))}
        onPick={onPick}
        onClear={() => writeRecent(window.localStorage, [])}
      />
    </div>
  );
}
