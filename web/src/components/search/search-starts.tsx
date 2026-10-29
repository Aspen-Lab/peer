"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { authorsFromShelf, parseRecent, RECENT_EVENT, RECENT_KEY, termsFromReading, writeRecent, type Start } from "@/lib/search/starts";

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

function StartGroup({ label, starts, onPick, onClear }: {
  label: string;
  starts: Start[];
  onPick: (query: string) => void;
  onClear?: () => void;
}) {
  if (!starts.length) return null;
  return <section className="search-start-group" aria-label={label}>
    <div className="search-start-heading"><h2>{label}</h2>{onClear && <button type="button" onClick={onClear}>Clear</button>}</div>
    <ul>{starts.map((start) => <li key={start.query}><button type="button" onClick={() => onPick(start.query)}>{start.query}</button></li>)}</ul>
  </section>;
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
  if (empty) return <p className="search-start-empty">Try a research topic, a paper title, or an author’s name.</p>;

  return <div className="search-starts">
    <StartGroup label="Your topics" starts={topics} onPick={onPick} />
    <StartGroup label="Recent searches" starts={recent.map((query) => ({ query }))} onPick={onPick} onClear={() => writeRecent(window.localStorage, [])} />
    <StartGroup label="From your reading" starts={terms} onPick={onPick} />
    <StartGroup label="Authors in your library" starts={authors} onPick={onPick} />
  </div>;
}
