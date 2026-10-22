// The `behavior` of a scroll the page makes by script (`scrollIntoView`, `scrollTo`).
//
// The stylesheet already keeps smooth scrolling to readers who have not asked for less motion: `html[data-scroll-behavior="smooth"]` stands inside
// `@media (prefers-reduced-motion: no-preference)` (`globals.css`, held by `globals.css.focus-motion.test.ts`), so the scrolls the browser makes —
// an anchor jump, a focus scroll — are instant under "reduce". A script that names `behavior: "smooth"` is a different thing: it asks for the
// animation itself, and the browser gives it whatever the reader has set. So the script asks for it only where the reader has not asked for less
// (BACKLOG-107; C P11-29's unsettled 6).
//
// `"auto"` is the answer under "reduce", not `"instant"`: it leaves the choice to the stylesheet, whose rule is exactly the one above, and it is
// what the briefing's j/k card focus already passes (`keyboard.tsx`, which reads the same query inline).

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * `"auto"` while the reader prefers reduced motion, `"smooth"` otherwise. Read at the moment of the scroll (the setting can change while the page
 * stands). Where there is no window to ask — a server render, a test in plain Node — `"smooth"`, which is what these scrolls were.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  return window.matchMedia(REDUCED_MOTION).matches ? "auto" : "smooth";
}
