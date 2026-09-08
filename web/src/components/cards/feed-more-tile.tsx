"use client";

// "See more" tile that sits in the last cell of the dense feed grid.
// Adapts copy based on item count + whether the profile looks under-tuned
// (research_topics is a placeholder like "Whatever" or empty).
//
// Visual differentiation: dashed border, no shadow — reads as an action,
// not content.

import type { Route } from "next";
import Link from "next/link";

interface FeedMoreTileProps {
  itemCount: number;
  topics: string[];
  onRefresh?: () => void;
  isLoading?: boolean;
}

const PLACEHOLDER_TOPICS = new Set([
  "whatever",
  "idk",
  "?",
  "test",
  "anything",
  "stuff",
]);

function looksUnderTuned(topics: string[]): boolean {
  if (topics.length === 0) return true;
  if (topics.length === 1) {
    const t = topics[0]?.trim().toLowerCase() ?? "";
    if (PLACEHOLDER_TOPICS.has(t)) return true;
    if (t.length < 4) return true;
  }
  return false;
}

export function FeedMoreTile({
  itemCount,
  topics,
  onRefresh,
  isLoading = false,
}: FeedMoreTileProps) {
  const underTuned = looksUnderTuned(topics);
  const sparse = itemCount < 4;

  // Three flavors, in priority order:
  // 1. profile is the actual cause → push them to fix it
  // 2. feed is just sparse today → invite a refresh, hint at adding topics
  // 3. feed has plenty → simple "Refresh" affordance
  let title: string;
  let body: string;
  // ABC-freemium 9-05 — `href` is a `Route` on the union member that carries
  // one, so the assignment below is checked rather than the `<Link>` cast.
  let primary: { kind: "link"; label: string; href: Route } | { kind: "button"; label: string };

  if (underTuned) {
    title = "Tune your signals";
    body = topics.length === 0
      ? "Set research topics in your profile so Peer knows what to fetch."
      : `Your only topic is "${topics[0]}". Add real terms (e.g. "transformers", "human-computer interaction") to get richer picks.`;
    primary = { kind: "link", label: "Edit profile", href: "/profile" };
  } else if (sparse) {
    title = "Light today";
    body = "Sources didn't return much for your topics this run. Try a refresh, or add adjacent terms in your profile.";
    primary = { kind: "button", label: isLoading ? "Refreshing…" : "Refresh now" };
  } else {
    title = "More?";
    body = "Pull a fresh batch from arXiv, OpenAlex, and Hacker News.";
    primary = { kind: "button", label: isLoading ? "Refreshing…" : "Refresh" };
  }

  return (
    <div
      className={[
        "group block rounded-xl bg-bg-secondary/30 p-4 animate-fade-in-up",
        "border border-dashed border-text-faint/30",
        "transition-colors duration-200 ease-out",
        "hover:bg-bg-secondary/55 hover:border-accent/40",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="inline-flex items-center text-[9.5px] font-semibold uppercase tracking-[0.16em] px-1.5 py-[3px] rounded text-accent bg-accent-dim/70">
          {underTuned ? "Setup" : "More"}
        </span>
      </div>
      <h3 className="text-body-lg font-semibold text-heading leading-[1.3] tracking-[-0.005em]">
        {title}
      </h3>
      <p
        className="text-meta text-text-muted mt-2.5 leading-[1.55] font-reading"
      >
        {body}
      </p>

      <div className="mt-4 pt-3 border-t border-text-faint/15 flex items-center justify-between">
        <span className="text-micro text-text-faint uppercase tracking-[0.14em]">
          {itemCount} item{itemCount === 1 ? "" : "s"} now
        </span>
        {primary.kind === "link" ? (
          <Link
            href={primary.href}
            className="inline-flex items-center gap-1 text-meta font-medium text-accent hover:text-accent/80 transition-colors active:scale-[0.97]"
          >
            {primary.label}
            <span className="text-caption opacity-80 transition-transform duration-200 ease-out group-hover:translate-x-[2px]">
              →
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1 text-meta font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-50 active:scale-[0.97]"
          >
            {primary.label}
            {!isLoading && (
              <span className="text-caption opacity-80 transition-transform duration-200 ease-out group-hover:rotate-90">
                ↻
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
