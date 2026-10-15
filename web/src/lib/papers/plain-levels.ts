// The three levels of "Say it plainly" (P4-01; blueprint §3.6 ⑥; user decision §1a.5 (b)).
//
// The one list that the browser (the reading-prefs store, the button) and the server (the
// route, the prompt) both read. It sits in a module of its own, with no import, because
// `plain.ts` hashes with Node's crypto module and imports `explain.ts`: a client component
// that took the list from there would drag the server's code into the browser's bundle.
// `plain.ts` re-exports these names, so the server side says `from "./plain"` and the
// browser `from "@/lib/papers/plain-levels"`.

/** High school, undergrad, graduate: the reader's reading level, easiest first. */
export const PLAIN_LEVELS = ["highschool", "undergrad", "graduate"] as const;

export type PlainLevel = (typeof PLAIN_LEVELS)[number];

/** The level a reader has until they choose another. */
export const PLAIN_DEFAULT_LEVEL: PlainLevel = "undergrad";

/** Whether `value` is one of the three levels, spelled exactly. */
export function isPlainLevel(value: unknown): value is PlainLevel {
  return typeof value === "string" && (PLAIN_LEVELS as readonly string[]).includes(value);
}
