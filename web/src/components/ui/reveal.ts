"use client";

// One observer for a page's approach animations.
//
// The CSS in `globals.css` ("The approach") does the work: an animation on
// every `.rv`, paused by a custom property the host inherits down. All this
// file does is add one class to one element at the right moment.

import { useEffect } from "react";

/**
 * Fire before the block is readable, not when it is.
 *
 * `threshold: 0` is the moment the host's top edge crosses the trigger line,
 * and the POSITIVE bottom `rootMargin` puts that line 15% of a viewport BELOW
 * the fold. On an 800px window that is 120px of head start; the block's top
 * still has to travel to where the eye reads, so a 360ms reveal is finished
 * with room. Without the pre-fire a block trips at the bottom edge and is
 * still moving while it is being read, which is the one thing this must
 * never do.
 */
const ROOT_MARGIN = "0px 0px 15% 0px";
const HOSTS = "[data-motion='reveal'] [data-reveal]:not(.is-in)";

let observer: IntersectionObserver | null = null;

function reveal(el: Element): void {
  el.classList.add("is-in");
}

/**
 * Already on screen when the effect runs: revealed now, not a frame later.
 *
 * The effect runs after paint and IntersectionObserver's first callback is a
 * task after that, so an above-the-fold host would sit at opacity 0 for one
 * to three frames — longer on a phone still hydrating — and the page would
 * open with a hole in it. This is also what keeps the xl spread flip silent:
 * the blocks remount on screen and are revealed in the same tick.
 */
function onScreen(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return box.top < window.innerHeight && box.bottom > 0;
}

/**
 * Arms every un-fired `[data-reveal]` inside a reveal scope.
 *
 * `deps` is whatever changes which blocks exist. A host that has already
 * fired carries `is-in` and is filtered out by the selector, so re-running is
 * free and a revealed block can never be re-hidden.
 */
export function useReveal(deps: unknown[]): void {
  useEffect(() => {
    const hosts = Array.from(document.querySelectorAll(HOSTS));
    // No observer, no approach: the blocks are simply there, which is the
    // page exactly as it shipped before this. The pause must never outlive
    // the thing that can lift it.
    if (typeof IntersectionObserver === "undefined") {
      hosts.forEach(reveal);
      return;
    }
    // What is already on screen is revealed now, dealt in document order
    // 40ms apart (capped at nine, so the tail never passes 360ms) — the one
    // place a stagger is seen, because these are on screen together. A host
    // reached later by scrolling arrives on its own, with no delay.
    let dealt = 0;
    const pending = hosts.filter((host) => {
      if (!onScreen(host)) return true;
      (host as HTMLElement).style.setProperty("--rdl", `${Math.min(dealt, 9) * 40}ms`);
      dealt++;
      reveal(host);
      return false;
    });
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer?.unobserve(entry.target);
        }
      },
      { threshold: 0, rootMargin: ROOT_MARGIN },
    );
    const io = observer;
    pending.forEach((host) => io.observe(host));
    return () => pending.forEach((host) => io.unobserve(host));
    // The caller states its own arrivals; this hook has no opinion on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
