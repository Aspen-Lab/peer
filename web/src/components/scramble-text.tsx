"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Deliberately ASCII-only: every glyph must be a single narrow character.
// A wide glyph (e.g. a CJK ideograph) is ~2x the width of a Latin letter, so
// swapping one in mid-scramble reflows the line and makes the reveal jitter.
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/\\|=+*#%&$?!~^";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REVEAL_DURATION_MS = 600;

/**
 * How a line reveals itself:
 *  - "scramble": characters flicker through random glyphs, then lock in.
 *  - "fade": a soft opacity fade, used when the OS asks for reduced motion.
 *    The reader still sees the report build up, without the rapid character
 *    flashing that the reduce-motion setting exists to suppress.
 */
export type RevealMode = "scramble" | "fade";

/**
 * The single rule for which reveal a reader gets: the OS reduce-motion
 * preference, and nothing else. The pre-pivot version also took an explicit
 * "full" override from a reader setting (`store/ui.ts`'s `revealMotion`);
 * that store is gone and nothing replaces it, so reduced motion is honored
 * unconditionally. Reduced motion never means "no build-up" — it means the
 * gentler fade.
 */
export function resolveRevealMode(systemReducedMotion: boolean): RevealMode {
  return systemReducedMotion ? "fade" : "scramble";
}

interface ScrambleTextProps {
  text: string;
  className?: string;
}

interface Frame {
  target: string;
  value: string;
  settledTargets: ReadonlySet<string>;
}

function initialFrame(text: string) {
  // Deterministic (index-based, not random) so the server-rendered markup and
  // the first client render agree — a random first frame would hydrate-mismatch.
  return Array.from(text, (char, index) =>
    /\s/u.test(char) ? char : GLYPHS[index % GLYPHS.length],
  ).join("");
}

function scrambleFrame(chars: string[], lockedCount: number) {
  return chars
    .map((char, index) => {
      if (index < lockedCount || /\s/u.test(char)) return char;
      return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    })
    .join("");
}

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

export function ScrambleText({ text, className }: ScrambleTextProps) {
  const [frame, setFrame] = useState<Frame>(() => ({
    target: text,
    value: initialFrame(text),
    settledTargets: new Set(),
  }));
  const revealedTargets = useRef(new Set<string>());
  const systemReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  const mode = resolveRevealMode(systemReducedMotion);

  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (mode !== "fade") return;
    // Paint transparent once, then transition in on the next frame.
    const raf = requestAnimationFrame(() => setFaded(true));
    return () => {
      cancelAnimationFrame(raf);
      setFaded(false);
    };
  }, [mode, text]);

  useEffect(() => {
    if (mode !== "scramble") return;
    let raf = 0;

    // Already revealed once — never re-scramble settled text.
    if (revealedTargets.current.has(text)) {
      raf = requestAnimationFrame(() => {
        setFrame((current) => ({
          target: text,
          value: text,
          settledTargets: new Set([...current.settledTargets, text]),
        }));
      });
      return () => cancelAnimationFrame(raf);
    }

    const chars = Array.from(text);
    if (chars.length === 0) {
      revealedTargets.current.add(text);
      return undefined;
    }

    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / REVEAL_DURATION_MS);
      const lockedCount = Math.floor(progress * chars.length);

      if (progress >= 1) {
        revealedTargets.current.add(text);
        setFrame((current) => ({
          target: text,
          value: text,
          settledTargets: new Set([...current.settledTargets, text]),
        }));
        return;
      }

      setFrame((current) => ({
        target: text,
        value: scrambleFrame(chars, lockedCount),
        settledTargets: current.settledTargets,
      }));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, text]);

  if (mode === "fade") {
    return (
      <span
        className={`inline-block transition-opacity duration-500 ease-snap ${
          faded ? "opacity-100" : "opacity-0"
        }${className ? ` ${className}` : ""}`}
      >
        {text}
      </span>
    );
  }

  const hasSettled = frame.settledTargets.has(text);
  const visibleText = hasSettled
    ? text
    : frame.target === text
      ? frame.value
      : initialFrame(text);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{visibleText}</span>
    </span>
  );
}
