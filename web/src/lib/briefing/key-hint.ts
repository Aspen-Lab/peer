// The "Add a key" row on the home page (P7-16, the owner's R12).
//
// The sample card is the only place the home page used to mention a key, and
// one tap on a field removes the card for good. A reader who tapped, and never
// opened the longer setup, was left with nothing on the page that said a key
// exists. This is the rule for the one line that stays: shown from the moment
// the card is gone until the reader adds a key or sends it away.
//
// The dismissal is one flag in this browser, the way a collapsed section is:
// a per-viewer convenience, not part of the profile, never synced, and nothing
// breaks if the browser will not keep it (a private window): the row then stays
// away for the rest of the visit and may come back on the next one.

/** Where the dismissal lives in this browser. */
export const KEY_HINT_STORAGE_KEY = "peer-key-hint-dismissed";

/** Fired on `window` when the flag is written, so a mounted row can leave at once. */
export const KEY_HINT_EVENT = "peer:key-hint-dismissed";

type ReadableStorage = Pick<Storage, "getItem"> | null | undefined;
type WritableStorage = Pick<Storage, "setItem"> | null | undefined;

// What this visit was told even when the browser would not keep it.
let dismissedThisVisit = false;

/** For tests: forget what this visit was told. */
export function resetKeyHintMemory(): void {
  dismissedThisVisit = false;
}

/** The row is owed while there is no key to add and the reader has not sent it away. */
export function shouldShowKeyHint({
  hasKey,
  dismissed,
}: {
  hasKey: boolean;
  dismissed: boolean;
}): boolean {
  return !hasKey && !dismissed;
}

export function readKeyHintDismissed(storage: ReadableStorage): boolean {
  if (dismissedThisVisit) return true;
  try {
    return storage?.getItem(KEY_HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeKeyHintDismissed(storage: WritableStorage): void {
  dismissedThisVisit = true;
  try {
    storage?.setItem(KEY_HINT_STORAGE_KEY, "1");
  } catch {
    // Blocked or full: the memory flag above holds for this visit.
  }
}
