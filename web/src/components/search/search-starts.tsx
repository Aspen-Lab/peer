"use client";

// What the search page offers before a word is typed.
//
// Four groups, each a row of queries waiting to be run, drawn from what this
// browser already knows: the reader's own topics, the terms their reading
// shared, the first authors on their shelf, and what they searched before.
// A group with nothing in it is not drawn — a fresh browser sees the field
// and one line about what it takes, and nothing pretending to be history.

import { useMemo, useSyncExternalStore } from "react";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import {
  authorsFromShelf,
  parseRecent,
  RECENT_EVENT,
  RECENT_KEY,
  termsFromReading,
  writeRecent,
  type Start,
} from "@/lib/search/starts";

// localStorage as an external store: the snapshot is the raw string, which
// is equal by value from one read to the next, so the hook does not loop the
// way a freshly parsed array would make it. Parsed once per change below.
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

function Group({
  label,
  starts,
  onPick,
  onClear,
}: {
  label: string;
  starts: Start[];
  onPick: (query: string) => void;
  onClear?: () => void;
}) {
  if (starts.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow inline-flex items-center gap-2 text-text-faint">
          <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
          {label}
        </h2>
        {onClear && (
          <button type="button" onClick={onClear} className="annotation text-text-faint transition-colors hover:text-heading">
            clear
          </button>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-1 gap-y-2">
        {starts.map((s) => (
          <li key={s.query}>
            <button
              type="button"
              onClick={() => onPick(s.query)}
              className="group inline-flex items-baseline gap-2 px-2 py-1 text-body-sm text-text-muted transition-colors hover:bg-bg-secondary/70 hover:text-heading"
            >
              <span>{s.query}</span>
              {typeof s.count === "number" && (
                <span className="annotation tabular-nums text-text-faint">{s.count}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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

  const groups = [
    { label: "Your topics", starts: topics },
    { label: "From your reading", starts: terms },
    { label: "People on your shelf", starts: authors },
  ].filter((g) => g.starts.length > 0);
  const hasRecent = recent.length > 0;

  if (groups.length === 0 && !hasRecent) {
    return (
      <p className="annotation mt-8 text-text-faint">
        A title, an author, a venue or a concept. Two letters is enough to begin.
      </p>
    );
  }

  return (
    <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
      {groups.map((g) => (
        <Group key={g.label} label={g.label} starts={g.starts} onPick={onPick} />
      ))}
      {hasRecent && (
        <Group
          label="You searched"
          starts={recent.map((query) => ({ query }))}
          onPick={onPick}
          onClear={() => writeRecent(window.localStorage, [])}
        />
      )}
    </div>
  );
}
