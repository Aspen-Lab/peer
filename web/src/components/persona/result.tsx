"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AXES, type AxisId, type Persona, type Scores } from "@/lib/persona/axes";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// 8-02/S24: "Back to main" — button.tsx's own cva `size` scale tops out at
// `lg` (h-10/40px), one Ruling-22 guard short of the spec's 44px floor
// (button.tsx is dirty this round — another agent's in-progress feature —
// so no new `size` variant goes in there). `cn`'s tailwind-merge resolves
// the h-11/px-6/text-body-lg override against `lg`'s own h-10/px-5/text-body
// the same way any other conflicting classNames would, so this stays a
// plain additive className on top of the proven, theme-correct accent fill
// rather than a hand-rolled recipe.
const BACK_TO_MAIN = "← Back to main";
const BACK_TO_MAIN_CLASS = cn(
  buttonVariants({ tone: "primary", size: "lg" }),
  "h-11 px-6 text-body-lg hover:scale-125 active:scale-90",
);

interface PersonaResultProps {
  scores: Scores;
  persona: Persona;
  onRestart: () => void;
}

// Convention: drop a portrait at `web/public/persona/<slug>.png` and it
// auto-renders above the title. Slug = persona name, lowercased, leading
// "the " stripped, non-alphanumerics → dashes.
//
//   The Bench Operator       → bench-operator.png
//   The Theoretical Provocateur → theoretical-provocateur.png
//   The Polymath             → polymath.png
//
// If the file is missing, the <img> errors and the component renders null.
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PersonaArt({ name }: { name: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return null;
  const src = `/persona/${nameToSlug(name)}.png`;
  return (
    <figure className="relative">
      {/* Soft cream-on-surface card frames the polygon portrait */}
      <div className="rounded-[28px] bg-gradient-to-b from-[color:var(--color-bg-secondary)]/60 to-[color:var(--color-bg-secondary)]/30 p-6 shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          onError={() => setErrored(true)}
          className="block w-full h-auto object-contain max-h-[420px]"
          loading="eager"
          decoding="async"
        />
      </div>
      <figcaption
        className="eyebrow mt-4 text-center text-text-faint"
      >
        — Profile sketch —
      </figcaption>
    </figure>
  );
}

export function PersonaResult({
  scores,
  persona,
  onRestart,
}: PersonaResultProps) {
  const router = useRouter();

  // 8-02/S24: Esc also goes home on this view. Kept local to this
  // component rather than the shared keyboard.tsx handler (confirmed by
  // reading: keyboard.tsx has no /persona branch today and its Escape path
  // falls through to a no-op when nothing is help-open/typing/focused) —
  // smaller blast radius, no new pathname check in a file every route
  // already depends on. Navigates only; no state is set here.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") router.push("/");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <>
      <Link href="/" aria-label={BACK_TO_MAIN} className={cn(BACK_TO_MAIN_CLASS, "self-start")}>
        {BACK_TO_MAIN}
      </Link>
      <div
        className="grid lg:grid-cols-[minmax(280px,360px)_1fr] gap-10 lg:gap-16 items-start animate-fade-in-up mt-6"
      >
        {/* ── Left: portrait, sticky on desktop ── */}
        <aside className="lg:sticky lg:top-12 self-start">
          <PersonaArt name={persona.name} />
        </aside>

        {/* ── Right: text, axes, retake ── */}
        <div className="flex flex-col gap-10 max-w-[620px]">
          <header className="flex flex-col gap-3">
            <span className="eyebrow text-[color:var(--color-accent)]">
              Your academic persona
            </span>
            <h1
              className="text-display-lg md:text-display-xl font-light text-heading leading-[1.02] tracking-[-0.018em] font-display"
            >
              {persona.name}
            </h1>
            <p
              className="text-title md:text-title-lg text-text-muted leading-[1.55] italic font-reading"
            >
              {persona.tagline}
            </p>
          </header>

          <p
            className="text-body-lg text-text leading-[1.75] font-reading"
          >
            {persona.blurb}
          </p>

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[color:var(--color-border)]" aria-hidden />
              <h2 className="eyebrow text-text-faint">
                Spotted at the conference like
              </h2>
              <span className="h-px flex-1 bg-[color:var(--color-border)]" aria-hidden />
            </div>
            <p
              className="text-body-lg text-text-muted leading-[1.7] italic font-reading"
            >
              {persona.look}
            </p>
          </section>

          <section className="flex flex-col gap-5">
            <h2 className="eyebrow text-text-faint">
              Your axes
            </h2>
            <div className="flex flex-col gap-5">
              {AXES.map((axis) => (
                <AxisBar
                  key={axis.id}
                  id={axis.id}
                  negative={axis.negative}
                  positive={axis.positive}
                  blurb={axis.blurb}
                  score={scores[axis.id]}
                />
              ))}
            </div>
          </section>

          <footer className="flex items-center gap-3 pt-6 border-t border-[color:var(--color-border)]">
            <button
              type="button"
              onClick={onRestart}
              className="h-10 px-5 rounded-full bg-surface shadow-card hover:shadow-card-hover hover:-translate-y-[1px] active:translate-y-0 transition-all duration-200 ease-out text-body-sm text-text"
            >
              Retake quiz
            </button>
            <span className="text-caption text-text-faint italic">
              Saved locally only — not uploaded.
            </span>
          </footer>
        </div>
      </div>
      <div className="flex justify-end mt-10">
        <Link href="/" aria-label={BACK_TO_MAIN} className={BACK_TO_MAIN_CLASS}>
          {BACK_TO_MAIN}
        </Link>
      </div>
    </>
  );
}

interface AxisBarProps {
  id: AxisId;
  negative: string;
  positive: string;
  blurb: string;
  /** Score in [-1, +1]. */
  score: number;
}

function AxisBar({ negative, positive, blurb, score }: AxisBarProps) {
  // Convert [-1, +1] to a marker position in [0, 100]%.
  const pct = ((score + 1) / 2) * 100;
  const isNeg = score < 0;
  const strength = Math.abs(score);
  // Stronger lean → bolder pole label.
  const negStrong = isNeg && strength > 0.33;
  const posStrong = !isNeg && strength > 0.33;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-body-sm">
        <span
          className={[
            "transition-colors",
            negStrong ? "text-heading font-semibold" : "text-text-faint",
          ].join(" ")}
        >
          {negative}
        </span>
        <span
          className={[
            "transition-colors",
            posStrong ? "text-heading font-semibold" : "text-text-faint",
          ].join(" ")}
        >
          {positive}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[color:var(--color-bg-secondary)] overflow-visible">
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-[color:var(--color-border-strong)]"
          style={{ left: "0", right: "0" }}
        />
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3 bg-[color:var(--color-border-strong)]"
          style={{ left: "50%", transform: "translate(-50%, -50%)" }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[color:var(--color-accent)] shadow-card transition-[left] duration-[var(--dur-base)] ease-out"
          style={{ left: `calc(${pct}% - 8px)` }}
          aria-label={`Score ${score.toFixed(2)}`}
        />
      </div>
      <p className="text-meta text-text-faint">{blurb}</p>
    </div>
  );
}
