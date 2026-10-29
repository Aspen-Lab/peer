"use client";

// Setup, against real papers, one choice at a time.
//
// Peer used to open on a seven-step wizard: a first visitor described their
// research to a form before seeing a single paper, and the one screen that
// shows what the product *is* came last. The wizard still opens once on a
// browser that has never been set up (`FirstRunGate`, P7-16) and the reader can
// skip it; wherever a reader is without having chosen a field, the page is a
// briefing — a sample across a few broad fields (`lib/feed/starter-topics.ts`)
// — and this strip sits above it and turns the sample into the reader's own
// briefing with one tap.
//
// It says the papers below are a sample. Not saying so would be the dishonest
// version of this idea: ten papers that look chosen for you, chosen for nobody.
//
// One choice, not a form. Choosing a field is also what marks onboarding done
// — the reader has told Peer what they work on, which is the only thing the
// wizard actually needed — and `completeOnboarding` promotes it into the
// active search inputs immediately, so the next load is already theirs.
//
// The longer setup and key setup remain available as secondary actions.

import { useState } from "react";
import Link from "next/link";
import { useProfileStore } from "@/store/profile";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { STARTER_TOPICS } from "@/lib/feed/starter-topics";
import { Band } from "@/components/ui/band";
import { IconArrowRight } from "@/components/icons";
import { cn } from "@/lib/cn";
import { STARTER } from "@/lib/briefing/copy";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";

const CHOICE = cn(
  "group/choice inline-flex min-h-10 items-center gap-2 px-3 text-left text-body-sm text-text-muted",
  "bg-bg-secondary/70 transition-colors hover:bg-bg-secondary hover:text-heading",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
);

const ACTION = cn(
  "inline-flex min-h-10 items-center gap-2 text-meta text-text-muted transition-colors",
  "hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
);

export function StarterStrip() {
  const updateTopics = useProfileStore((s) => s.updateTopics);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  // The same read as the key hint row: one source of truth for "has a key".
  const hasKey = useProfileStore((s) => hasUserLlmOverride(s.profile));
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
      <div className="mt-4 grid gap-6 border-b border-border-strong pb-6 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)] lg:gap-12">
        <div>
          <h3 className="text-title-lg font-medium leading-snug text-heading">{STARTER.line}</h3>
          <p className="mt-2 text-body-sm text-text-muted">{STARTER.rest}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5">
            <Link href="/welcome" className={ACTION}>{STARTER.setup}<IconArrowRight size={12} aria-hidden /></Link>
            {hasKey ? null : <Link href={ADD_KEY_HREF} className={ACTION}>{STARTER.addKey}<IconArrowRight size={12} aria-hidden /></Link>}
          </div>
        </div>
        <div>
          <ul aria-label="Choose a field" className="flex flex-wrap gap-2">
            {STARTER_TOPICS.map((topic) => (
              <li key={topic}>
                <button type="button" onClick={() => choose(topic)} className={CHOICE}>
                  <span className="truncate">{topic}</span>
                </button>
              </li>
            ))}
          </ul>
          <form className="mt-4 flex min-h-11 items-stretch border-b border-border-strong focus-within:border-accent" onSubmit={(event) => { event.preventDefault(); choose(typed); }}>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={STARTER.placeholder} aria-label={STARTER.placeholder} className="min-w-0 flex-1 bg-transparent py-2 text-body-sm text-text placeholder:text-text-faint outline-none" />
            <button type="submit" disabled={!ready} aria-label={STARTER.submit} className={cn("inline-flex shrink-0 items-center gap-2 px-2 text-body-sm font-medium transition-colors", ready ? "text-accent hover:text-heading" : "text-text-faint/50 cursor-not-allowed")}>
              {STARTER.submit}<IconArrowRight size={12} aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </Band>
  );
}
