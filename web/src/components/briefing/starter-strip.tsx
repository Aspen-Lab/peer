"use client";

// Setup, against real papers, one choice at a time.
//
// Peer used to open on a seven-step wizard: a first visitor described their
// research to a form before seeing a single paper, and the one screen that
// shows what the product *is* came last. The first visit is now a briefing —
// a sample across a few broad fields (`lib/feed/starter-topics.ts`) — and this
// strip sits above it and turns the sample into the reader's own briefing with
// one tap.
//
// It says the papers below are a sample. Not saying so would be the dishonest
// version of this idea: ten papers that look chosen for you, chosen for nobody.
//
// One choice, not a form. Choosing a field is also what marks onboarding done
// — the reader has told Peer what they work on, which is the only thing the
// wizard actually needed — and `completeOnboarding` promotes it into the
// active search inputs immediately, so the next load is already theirs.

import { useState } from "react";
import Link from "next/link";
import { useProfileStore } from "@/store/profile";
import { STARTER_TOPICS } from "@/lib/feed/starter-topics";
import { Band } from "@/components/ui/band";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { STARTER } from "@/lib/briefing/copy";

export function StarterStrip() {
  const updateTopics = useProfileStore((s) => s.updateTopics);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const [typed, setTyped] = useState("");

  const choose = (topic: string) => {
    const clean = topic.trim();
    if (!clean) return;
    updateTopics([clean]);
    // Promotes into `activeSearchInputs` on the spot, so the briefing reloads
    // on this choice rather than at the next local day's day-lock.
    completeOnboarding();
  };

  return (
    <Band label={STARTER.label} className="mt-8">
      <p className="font-sans text-body-lg leading-[1.55] text-text-muted measure-ui mt-4">
        {STARTER.line}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STARTER_TOPICS.map((topic) => (
          <button
            key={topic}
            type="button"
            onClick={() => choose(topic)}
            className={cn(buttonVariants({ tone: "soft", size: "sm" }), "eyebrow")}
          >
            {topic}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          choose(typed);
        }}
      >
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={STARTER.placeholder}
          aria-label={STARTER.placeholder}
          className="min-w-0 flex-1 max-w-[22em] bg-bg-secondary/45 px-3 py-2 font-mono text-meta text-text shadow-well placeholder:text-text-faint/65 focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="submit"
          disabled={typed.trim().length === 0}
          className={cn(buttonVariants({ tone: "primary", size: "sm" }), "eyebrow")}
        >
          {STARTER.submit}
        </button>
      </form>

      <p className="font-mono text-caption text-text-faint mt-3">
        {STARTER.rest}{" "}
        <Link
          href="/welcome"
          className="underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors duration-150 ease-snap"
        >
          {STARTER.restLink}
        </Link>
      </p>
    </Band>
  );
}
