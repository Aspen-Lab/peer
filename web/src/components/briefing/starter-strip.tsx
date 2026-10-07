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
import { cardShell } from "@/components/ui/card-shell";
import { IconArrowRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import { STARTER } from "@/lib/briefing/copy";

/**
 * A field to choose: the same hairline chip as the search page's starts
 * (`search/search-starts.tsx`) — the words in sans, sentence case as the
 * reader would type them, and a mark that takes the accent under a pointer.
 * Here the mark is an arrow at the far edge: a tap here is a commitment, the
 * briefing reloads on it.
 */
const CHOICE = cn(
  "group/choice flex h-10 w-full items-center justify-between gap-3 px-2.5 text-left text-meta text-text-muted sm:px-3 sm:text-body-sm",
  "shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-colors",
  "hover:bg-bg-secondary/70 hover:text-heading hover:shadow-[inset_0_0_0_1px_var(--color-text-faint)]",
  "active:bg-bg-secondary",
);

export function StarterStrip() {
  const updateTopics = useProfileStore((s) => s.updateTopics);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const [typed, setTyped] = useState("");
  const ready = typed.trim().length > 0;

  const choose = (topic: string) => {
    const clean = topic.trim();
    if (!clean) return;
    updateTopics([clean]);
    // Promotes into `activeSearchInputs` on the spot, so the briefing reloads
    // on this choice rather than at the next local day's day-lock.
    completeOnboarding();
  };

  return (
    <Band label={STARTER.label} gap="none">
      {/* One plate, two halves: why on the left, the choice on the right —
          the same framed surface as the graph above it and the cards below.
          It was four loose rows (a sentence, a row of pills, a field with an
          accent block beside it, small print), each its own width, set
          against the left edge of a 1200px board. */}
      <div
        className={cn(
          cardShell({ padding: "md", interactive: false, entrance: "none" }),
          "cropmarks relative mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12",
        )}
      >
        <div className="flex flex-col">
          <p className="font-sans text-body-lg leading-[1.55] text-text measure-ui">{STARTER.line}</p>
          {/* On the bottom edge from lg, level with the field on the right. */}
          <p className="annotation text-text-faint text-pretty mt-4 lg:mt-auto lg:pt-6">
            {STARTER.rest}{" "}
            <Link
              href="/welcome"
              className="underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors "
            >
              {STARTER.restLink}
            </Link>
          </p>
        </div>

        <div>
          {/* An even grid, so the six read as one set: two to a row on a
              phone (at the meta size, with no arrow, so no name is cut),
              three from sm. */}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STARTER_TOPICS.map((topic) => (
              <li key={topic}>
                <button type="button" onClick={() => choose(topic)} className={CHOICE}>
                  <span className="truncate">{topic}</span>
                  <IconArrowRight
                    size={12}
                    className="hidden shrink-0 text-text-faint transition-colors group-hover/choice:text-accent sm:block"
                  />
                </button>
              </li>
            ))}
          </ul>

          {/* The field and its button are one control: the button is the
              field's own end, and it takes the accent only once there is
              something to use — an empty field has nothing to say yes to. */}
          <form
            className="mt-2 flex h-10 [@media(hover:none)]:h-11 items-stretch shadow-[inset_0_0_0_1px_var(--color-border-strong)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--color-text-faint)]"
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
              className="min-w-0 flex-1 bg-transparent px-3 font-mono text-meta text-text placeholder:text-text-faint outline-none"
            />
            {/* On a phone the arrow alone: the field needs the width, and
                the button keeps its name for assistive technology. */}
            <button
              type="submit"
              disabled={!ready}
              aria-label={STARTER.submit}
              className={cn(
                "eyebrow inline-flex shrink-0 items-center gap-2 px-3.5 transition-colors sm:px-4",
                ready
                  ? "bg-accent text-bg hover:bg-accent/90"
                  : "border-l border-border-strong text-text-faint cursor-not-allowed",
              )}
            >
              <span className="hidden sm:inline">{STARTER.submit}</span>
              <IconArrowRight size={12} />
            </button>
          </form>
        </div>
      </div>
    </Band>
  );
}
