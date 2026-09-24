"use client";

// The search box, back on the front page — as a way in, not as a mode.
//
// The old box sat here too, and typing two characters into it deleted the
// briefing: the feed and the search fought over one route (see
// app/search/page.tsx for the history). That lesson stands. This box does
// not search in place; Enter carries the words to /search, where the results
// and their filters already live. The brief is never cleared by a keystroke.
//
// It sits at the right of the day strip, on the bars' own line: the strip
// says what today is, the box is where to look for what today is not. Mono,
// hairline, the `/` cap that names its shortcut — the same objects the
// masthead is made of.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kbd } from "@/components/ui/kbd";
import { SEARCH_BOX } from "@/lib/briefing/copy";

/** The search page ignores anything shorter; so does the box. */
const MIN_QUERY = 2;

export function SearchBox({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={`relative flex h-9 w-full sm:w-[280px] items-center rounded-md border border-border-strong bg-surface transition-[border-color,box-shadow] duration-150 ease-snap focus-within:border-text-faint focus-within:shadow-[0_1px_0_var(--color-border-strong)] ${className}`}
    >
      <svg
        className="pointer-events-none ml-3 shrink-0 text-text-faint"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        // The id the `/` key looks for: on this page it focuses the box in
        // place instead of leaving for /search.
        id="peer-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter is handled here as well as by the form: implicit submission
          // is a trusted-event nicety some environments never fire.
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            setQuery("");
            inputRef.current?.blur();
          }
        }}
        placeholder={SEARCH_BOX.placeholder}
        aria-label={SEARCH_BOX.label}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-meta text-text placeholder:text-text-faint outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <Kbd pointerOnly className="mr-1.5">
        /
      </Kbd>
    </form>
  );
}
