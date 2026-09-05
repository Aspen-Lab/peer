"use client";

// Coachmark tour shown once after the welcome wizard (triggered by `/?tour=1`).
// Spotlights real on-page targets by their `data-tour` attribute, dims the rest,
// and walks through them with Next/Back. Robust to the realities of the feed:
//   • targets that don't exist (e.g. the digest hides itself on Tier 0) are
//     skipped automatically;
//   • the first paper card may still be loading, so that step waits for it.
//
// Non-interactive while open (a transparent backdrop swallows app clicks), but
// never a trap: Esc exits, ← / → / Enter navigate, and Skip is always visible.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface TourStep {
  key: string;
  sel: string;
  title: string;
  body: ReactNode;
  /** Skip the step if the target renders shorter than this (i.e. it's hidden). */
  minHeight?: number;
  /** Poll for the target before giving up (used for the still-loading feed). */
  wait?: boolean;
}

const SPOTLIGHT_PAD = 8;

const STEPS: TourStep[] = [
  {
    key: "search",
    sel: '[data-tour="search"]',
    title: "Search anything",
    body: "Hunt for any paper by hand here — title, author, topic, venue. (Papers today; events and jobs are coming.)",
  },
  {
    key: "ai-tools",
    sel: '[data-tour="ai-tools"]',
    title: "Tune the AI",
    body: "These switches control how hard the AI works: turn on AI search, plug in your own key, enable Deep report, or add Tavily web scouting — all to sharpen the briefing.",
  },
  {
    key: "paper-card",
    sel: '[data-tour="paper-card"]',
    title: "Your papers",
    body: <PaperCardBody />,
    wait: true,
  },
];

function waitFor(sel: string, timeout: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(sel);
    if (existing) return resolve(existing);
    const start = Date.now();
    const obs = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el) {
        obs.disconnect();
        resolve(el);
      } else if (Date.now() - start > timeout) {
        obs.disconnect();
        resolve(null);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      obs.disconnect();
      resolve(document.querySelector(sel));
    }, timeout);
  });
}

export function OnboardingTour() {
  const [idx, setIdx] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const startedRef = useRef(false);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const end = useCallback(() => {
    setIdx(-1);
    setRect(null);
  }, []);

  // Move by `dir`, ending the tour if we walk off either end.
  const move = useCallback((dir: number) => {
    setIdx((i) => {
      if (i < 0) return i;
      const n = i + dir;
      if (n < 0) return 0;
      if (n >= STEPS.length) return -1;
      return n;
    });
    setRect(null);
  }, []);

  // Detect ?tour=1 once, then strip it so a refresh doesn't restart the tour.
  useEffect(() => {
    if (startedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tour") !== "1") return;
    startedRef.current = true;
    params.delete("tour");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
    // Defer out of the effect body (start the tour on the next frame) so we're
    // not setting state synchronously during the mount effect.
    const raf = requestAnimationFrame(() => setIdx(0));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Resolve + measure the current step's target. Skips hidden/missing targets.
  useEffect(() => {
    if (idx < 0 || idx >= STEPS.length) return;
    const step = STEPS[idx];
    let cancelled = false;

    const measure = (el: Element) => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        if (step.minHeight && r.height < step.minHeight) {
          move(1);
          return;
        }
        setRect(r);
      }, 280);
    };

    (async () => {
      let el = document.querySelector(step.sel);
      if (!el && step.wait) el = await waitFor(step.sel, 6000);
      if (cancelled) return;
      if (!el) {
        move(1);
        return;
      }
      measure(el);
    })();

    return () => {
      cancelled = true;
    };
  }, [idx, move]);

  // Keep the spotlight glued to the target on scroll / resize.
  useEffect(() => {
    if (idx < 0) return;
    const step = STEPS[idx];
    const onMove = () => {
      const el = document.querySelector(step.sel);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [idx]);

  const isLast = idx === STEPS.length - 1;

  // Keyboard: Esc exits, arrows / Enter navigate.
  useEffect(() => {
    if (idx < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        end();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (isLast) end();
        else move(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, isLast, move, end]);

  // Focus the primary action each time a step lands, for keyboard users.
  useEffect(() => {
    if (rect) nextBtnRef.current?.focus();
  }, [rect, idx]);

  if (idx < 0) return null;

  const step = STEPS[idx];

  // While waiting for a still-loading target, show a calm holding note.
  if (!rect) {
    if (!step.wait) return null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45">
        <div className="rounded-2xl bg-surface shadow-card px-5 py-4 text-body-sm text-text-muted flex items-center gap-3">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden />
          Building your first briefing…
        </div>
      </div>
    );
  }

  // Popover placement: below the target if there's room, else above.
  const placeBelow = rect.bottom + 200 < window.innerHeight;
  const popTop = placeBelow ? rect.bottom + SPOTLIGHT_PAD + 14 : undefined;
  const popBottom = placeBelow ? undefined : window.innerHeight - rect.top + SPOTLIGHT_PAD + 14;
  const POP_W = 340;
  const popLeft = Math.max(
    16,
    Math.min(rect.left + rect.width / 2 - POP_W / 2, window.innerWidth - POP_W - 16),
  );

  return (
    <div className="fixed inset-0 z-[100]" aria-live="polite">
      {/* Transparent click-blocker so the app underneath is non-interactive. */}
      <div className="absolute inset-0" aria-hidden />

      {/* Spotlight — the big box-shadow spread dims everything but this hole. */}
      <div
        aria-hidden
        className="absolute rounded-2xl ring-2 ring-accent/70 transition-all duration-300 ease-out"
        style={{
          top: rect.top - SPOTLIGHT_PAD,
          left: rect.left - SPOTLIGHT_PAD,
          width: rect.width + SPOTLIGHT_PAD * 2,
          height: rect.height + SPOTLIGHT_PAD * 2,
          boxShadow: "0 0 0 9999px rgba(12,12,14,0.58)",
          pointerEvents: "none",
        }}
      />

      {/* Popover */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        className="absolute rounded-2xl bg-surface shadow-card-hover p-5 animate-fade-in-up"
        style={{ top: popTop, bottom: popBottom, left: popLeft, width: POP_W }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-micro font-semibold uppercase tracking-[0.2em] text-accent/90">
            {idx + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={end}
            className="text-caption text-text-faint hover:text-text-muted transition-colors"
          >
            Skip tour
          </button>
        </div>
        <h3 className="text-lead font-semibold text-heading tracking-[-0.01em]">{step.title}</h3>
        <div className="text-body-sm text-text-muted leading-[1.55] mt-1.5">{step.body}</div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={idx === 0}
            className="text-meta text-text-faint hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Back
          </button>
          <button
            ref={nextBtnRef}
            type="button"
            onClick={() => (isLast ? end() : move(1))}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-accent text-white text-body-sm font-medium shadow-card hover:bg-accent/90 transition-colors active:scale-[0.97]"
          >
            {isLast ? "Done" : "Next"}
            {!isLast && <span aria-hidden>→</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// The paper-card step explains the feedback controls using the real icons from
// the card so users recognize them instantly.
function PaperCardBody() {
  return (
    <div className="space-y-2.5">
      <p>This is one of your briefing papers. Teach Peer what you like:</p>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-accent bg-accent-dim/60 shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zM7 10l4-7a2 2 0 0 1 2 2v3h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 19H7" />
            </svg>
          </span>
          <span><strong>Like</strong> — show me more like this.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-red bg-red/10 shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
            </svg>
          </span>
          <span><strong>Not interested</strong> — show me less of this.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-accent bg-accent-dim/60 shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
          </span>
          <span><strong>Save</strong> — a strong signal you love this direction; also keeps the paper to read later.</span>
        </li>
      </ul>
    </div>
  );
}
