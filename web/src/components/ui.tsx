"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { chipTones } from "@/components/ui/chip";
import { sectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/cn";

// ── Callout (Notion-style colored info box) ──

type CalloutVariant = "accent" | "warm" | "ghost" | "success";

const CALLOUT_STYLES: Record<CalloutVariant, string> = {
  accent: "bg-accent-dim",
  warm: "bg-bg-secondary/80",
  ghost: "bg-surface shadow-well",
  success: "bg-tag-dim",
};

export function Callout({
  variant = "accent",
  icon,
  title,
  children,
}: {
  variant?: CalloutVariant;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={`rounded-2xl px-5 py-4 font-reading ${CALLOUT_STYLES[variant]}`}
    >
      {(title || icon) && (
        <header
          className={cn(sectionLabel({ size: "caption" }), "flex items-center gap-2 mb-2")}
        >
          {icon}
          {title}
        </header>
      )}
      <div className="text-lead text-text leading-[1.7]">{children}</div>
    </aside>
  );
}

// ── Property strip (Notion DB property panel) ──

export function PropertyStrip({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-3 sm:gap-x-5 sm:gap-y-4 py-4 border-y border-border"
    >
      {children}
    </div>
  );
}

export function Property({
  icon,
  label,
  children,
  accent = false,
}: {
  icon?: ReactNode;
  label: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.14em] text-text-faint mb-1"
      >
        {icon}
        {label}
      </div>
      <div
        className={`text-body font-medium truncate ${
          accent ? "text-accent" : "text-heading"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// ── Pull quote (key sentence, left accent bar) ──

export function PullQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote
      className="relative pl-5 my-6 text-title leading-[1.65] text-heading italic font-reading"
    >
      <span
        className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-accent/80"
        aria-hidden
      />
      {children}
    </blockquote>
  );
}

// ── Signal chip (binary indicator: ✓ available / × missing) ──

export function Signal({
  ok,
  children,
}: {
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-meta h-7 px-3 rounded-full transition-colors ${
        ok
          ? "bg-tag-dim text-tag"
          : "bg-surface/70 text-text-faint"
      }`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {ok ? <path d="M5 12l5 5L20 7" /> : <path d="M18 6 6 18M6 6l12 12" />}
      </svg>
      {children}
    </span>
  );
}

// ── Fact chip (neutral fact with icon, no ok/missing toggle) ──

// Use this when surfacing a property as a labeled fact ("Preprint",
// "23 days ago", "3 authors") — i.e. when the chip is only meaningful
// when the fact is present. Use Signal when ok/missing is itself the signal.

type FactChipTone = "neutral" | "accent" | "tag" | "link" | "muted";

const FACT_CHIP_TONE: Record<FactChipTone, string> = {
  neutral: chipTones.neutral,
  accent: chipTones.accent,
  tag: chipTones.tag,
  link: chipTones.link,
  muted: chipTones.muted,
};

export function FactChip({
  icon,
  children,
  tone = "neutral",
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: FactChipTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-meta h-7 px-3 rounded-full ${FACT_CHIP_TONE[tone]}`}
    >
      {icon && <span className="opacity-90 shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

// ── Section heading ──

export function SectionHeading({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <h2
      className={cn(sectionLabel({ size: "caption", tracking: "wide" }), "mt-14 mb-5 flex items-baseline justify-between")}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span className="text-text-faint/60 tabular-nums">{count}</span>
      )}
    </h2>
  );
}

// ── Inline tag ──

export function Tag({
  children,
  href,
}: {
  children: ReactNode;
  href?: string;
}) {
  const classes =
    "inline-block text-caption text-tag bg-tag-dim px-2 py-[3px] rounded-md tracking-wide transition-colors";
  if (href) {
    return (
      <a
        href={href}
        className={`${classes} hover:text-heading hover:bg-tag-dim/70 active:scale-[0.96]`}
      >
        {children}
      </a>
    );
  }
  return (
    <span className={classes}>
      {children}
    </span>
  );
}

// ── Link chip (pill button for external links) ──

export function LinkChip({
  href,
  label,
  icon,
}: {
  href?: string;
  label: string;
  icon?: ReactNode;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-surface shadow-card text-meta text-text-muted hover:text-heading hover:shadow-card-hover hover:bg-surface-hover transition-[color,background-color,box-shadow] duration-200 ease-out active:scale-[0.96]"
    >
      {icon}
      {label}
      <span className="text-micro opacity-60 transition-transform duration-200 ease-out group-hover:translate-x-[2px] group-hover:-translate-y-[1px]">
        ↗
      </span>
    </a>
  );
}

// ── Action links ──

export function ActionBar({
  onSave,
  onUnsave,
  onDismiss,
  onMore,
  isSaved,
}: {
  onSave?: () => void;
  onUnsave?: () => void;
  onDismiss?: () => void;
  onMore?: () => void;
  isSaved?: boolean;
}) {
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn?.();
  };

  return (
    <div
      className="flex items-center justify-between mt-5 pt-4 border-t border-border"
    >
      <div className="flex items-center gap-1.5">
        {onSave && (
          <button
            type="button"
            onClick={isSaved ? stop(onUnsave) : stop(onSave)}
            aria-pressed={isSaved}
            aria-label={isSaved ? "Remove from saved" : "Save"}
            className={`group/save inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 rounded-full text-meta font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out active:scale-[0.94] ${
              isSaved
                ? "bg-accent text-bg shadow-card hover:bg-accent/90"
                : "bg-bg-secondary/60 shadow-card text-text-muted hover:text-heading hover:bg-surface-hover"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill={isSaved ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-300 ease-out ${
                isSaved ? "scale-100" : "group-hover/save:-translate-y-[1px]"
              }`}
              aria-hidden
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {isSaved ? (
              <>
                Saved
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-70 group-hover/save:opacity-100 transition-opacity duration-150"
                  aria-hidden
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </>
            ) : (
              "Save"
            )}
          </button>
        )}

        {onMore && (
          <button
            type="button"
            onClick={stop(onMore)}
            aria-label="Like — show me more like this"
            title="Like — show me more like this"
            className="group/like inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta text-text-faint hover:text-accent hover:bg-accent-dim transition-colors duration-200 ease-out active:scale-[0.94]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-300 ease-out group-hover/like:-translate-y-[1.5px]"
              aria-hidden
            >
              <path d="M7 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zM7 10l4-7a2 2 0 0 1 2 2v3h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 19H7" />
            </svg>
            Like
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            onClick={stop(onDismiss)}
            aria-label="Dislike — show me less like this"
            title="Dislike — show me less like this"
            className="group/dislike inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-meta text-text-faint hover:text-red hover:bg-red/10 transition-colors duration-200 ease-out active:scale-[0.94]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-300 ease-out group-hover/dislike:translate-y-[1.5px]"
              aria-hidden
            >
              <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
            </svg>
            Dislike
          </button>
        )}
      </div>
    </div>
  );
}

// ── Feedback row: paired Like / Dislike for post-read taste signal ──
// Intentionally symmetric — Tinder-style "tell me more / less of this".

export function FeedbackRow({
  onLike,
  onDislike,
  index,
}: {
  onLike: () => void;
  onDislike: () => void;
  index?: number;
}) {
  return (
    <section
      className="mt-12 pt-6 border-t border-border animate-fade-in-up"
      style={{
        "--i": index,
        } as React.CSSProperties}
    >
      <p className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint mb-3">
        Was this worth your time?
      </p>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onLike}
          aria-label="Like — show me more like this"
          className="group inline-flex items-center gap-2 h-10 px-4 rounded-full bg-surface border border-border-strong text-body-sm text-text-muted hover:text-accent hover:border-accent/40 hover:bg-accent-dim transition-colors duration-200 ease-out active:scale-[0.96]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-300 ease-out group-hover:-translate-y-[2px]"
            aria-hidden
          >
            <path d="M7 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zM7 10l4-7a2 2 0 0 1 2 2v3h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 19H7" />
          </svg>
          More like this
        </button>

        <button
          type="button"
          onClick={onDislike}
          aria-label="Dislike — show me less like this"
          className="group inline-flex items-center gap-2 h-10 px-4 rounded-full bg-surface border border-border-strong text-body-sm text-text-muted hover:text-red hover:border-red/35 hover:bg-red/[0.06] transition-colors duration-200 ease-out active:scale-[0.96]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform duration-300 ease-out group-hover:translate-y-[2px]"
            aria-hidden
          >
            <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
          </svg>
          Less like this
        </button>
      </div>
    </section>
  );
}

// ── Detail section ──

export function DetailSection({
  title,
  children,
  index,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  index?: number;
}) {
  const style =
    index !== undefined
      ? ({ "--i": index } as React.CSSProperties)
      : undefined;
  return (
    <section className="mt-10 animate-fade-in-up" style={style}>
      <h3
        className="text-caption font-semibold uppercase tracking-[0.18em] text-text-faint mb-3"
      >
        {title}
      </h3>
      <div className="text-text leading-relaxed">{children}</div>
    </section>
  );
}

// ── Link row ──

export function LinkRow({ label, href }: { label: string; href?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-1.5 text-link hover:text-link/75 underline decoration-link/25 hover:decoration-link/60 underline-offset-4 transition-all duration-200 ease-out active:scale-[0.97] mr-5 text-body-lg"
    >
      {label}
      <span className="text-micro opacity-60 transition-transform duration-200 ease-out group-hover:translate-x-[2px] group-hover:-translate-y-[2px]">↗</span>
    </a>
  );
}

// ── Empty state ──

export function EmptyState({
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-20 text-center flex flex-col items-center">
      <p
        className="text-heading text-title font-medium tracking-[-0.01em]"
      >
        {title}
      </p>
      <p className="text-text-muted text-body mt-2 leading-relaxed max-w-[40ch]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Loading ──

export function LoadingSkeleton({
  count = 6,
  label = "Brewing your daily briefing",
}: {
  count?: number;
  /** Header line above the cards. Pass null on a page that already shows its
   *  own loading status, so two messages do not stack. */
  label?: string | null;
} = {}) {
  // Mirrors the card that actually renders — a cover card in a three-column
  // masonry: a 16:9 plate on top (every real card has one now), then meta,
  // a serif title of one to three lines, two or three skim lines, an author
  // line. No badge, no score chip, no stripe, no action buttons: those left
  // the real card and a placeholder that still drew them made the load-in a
  // jump cut. Line counts vary per card so the masonry is a masonry before
  // the data arrives.
  const shapes: Array<{ title: string[]; skim: string[]; author: string }> = [
    { title: ["88%", "64%"], skim: ["100%", "94%", "58%"], author: "40%" },
    { title: ["76%", "91%", "42%"], skim: ["98%", "72%"], author: "52%" },
    { title: ["93%"], skim: ["100%", "96%", "70%"], author: "36%" },
    { title: ["82%", "58%"], skim: ["97%", "88%"], author: "46%" },
    { title: ["69%", "95%", "51%"], skim: ["100%", "90%", "63%"], author: "58%" },
    { title: ["90%", "47%"], skim: ["96%", "81%", "44%"], author: "42%" },
  ];
  const cards = Array.from({ length: count }, (_, i) => shapes[i % shapes.length]);

  return (
    <div aria-busy="true" aria-label={label ?? "Loading"}>
      {label && (
        <div className="mx-auto max-w-[820px] flex items-center gap-2 pt-6 sm:pt-8 text-caption text-text-faint tracking-[0.16em] uppercase">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-accent/70 animate-pulse" />
            <span className="absolute inset-0 rounded-full bg-accent/30 motion-safe:animate-ping" />
          </span>
          <span>{label}</span>
        </div>
      )}

      <div className={`${label ? "mt-8" : "mt-2"} columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]`}>
        {cards.map((card, i) => (
          <div
            key={i}
            className="mb-4 break-inside-avoid animate-fade-in-up"
            style={{ "--i": Math.min(i, 9) } as React.CSSProperties}
          >
            <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
              {/* The plate — same slot, same ratio, as the figure or the type it
                  will hold. */}
              <div className="aspect-[16/9] skeleton-shimmer" />
              <div className="px-5 pt-4 pb-4">
                <div className="h-[10px] w-[30%] rounded skeleton-shimmer" />
                <div className="mt-2.5 space-y-1.5">
                  {card.title.map((w, j) => (
                    <div key={j} className="h-[17px] rounded-md skeleton-shimmer" style={{ width: w }} />
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {card.skim.map((w, j) => (
                    <div key={j} className="h-[11px] rounded skeleton-shimmer" style={{ width: w }} />
                  ))}
                </div>
                <div className="mt-4 h-[10px] rounded skeleton-shimmer" style={{ width: card.author }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function Relevance({ score }: { score?: number }) {
  if (!score) return null;
  const pct = Math.max(0, Math.min(1, score));
  const filled = Math.max(1, Math.round(pct * 5));
  return (
    <span
      className="inline-flex items-center gap-[3px] shrink-0 select-none"
      aria-label={`relevance ${Math.round(pct * 100)}%`}
      title={`${Math.round(pct * 100)}% match`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`block w-[5px] h-[5px] rounded-full transition-colors ${
            i < filled ? "bg-accent" : "bg-border-strong/40"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Password-style input with a show/hide toggle, for API keys and other
 * secrets. Hidden by default; the eye button reveals the value in place.
 */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={
          className ??
          "w-full rounded-lg bg-bg-secondary/45 pl-3 pr-10 py-2 text-[12.5px] text-text placeholder:text-text-faint/65 focus:outline-none focus:ring-2 focus:ring-accent/20"
        }
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide key" : "Show key"}
        aria-pressed={visible}
        title={visible ? "Hide key" : "Show key"}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-faint hover:text-heading hover:bg-bg-secondary/60 transition-colors"
      >
        {visible ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
