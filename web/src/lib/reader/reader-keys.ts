// The reading page's keys — one table read by both the keyboard layer and the
// help sheet, so the two cannot drift.
//
// The briefing's card keys live in `keyboard.tsx` beside the DOM focus ring
// they drive; this table is the reading surface's, where there is no ring and
// every key acts on the one paper on screen. The layer resolves a key to an
// action name here and calls whatever the page registered under that name;
// with nothing registered (the page has not mounted, or is a deep link that
// chose not to wire `next`) the key is inert and falls through to the global
// keys.

export type ReaderAction =
  | "next"
  | "prev"
  | "save"
  | "skip"
  | "like"
  | "undoOrToggleRead"
  | "open"
  | "copy"
  | "back";

export interface PaperKey {
  /** `KeyboardEvent.key` values; the first is the one the help sheet shows. */
  keys: readonly string[];
  action: ReaderAction;
  label: string;
}

export const PAPER_KEYS: readonly PaperKey[] = [
  { keys: ["j", "]", "ArrowRight"], action: "next", label: "Next paper" },
  { keys: ["k", "[", "ArrowLeft"], action: "prev", label: "Previous paper" },
  { keys: ["s"], action: "save", label: "Save / unsave" },
  { keys: ["x"], action: "skip", label: "Not interested, then next" },
  { keys: ["l"], action: "like", label: "Like — more like this" },
  {
    keys: ["u"],
    action: "undoOrToggleRead",
    label: "Undo a dismiss, else mark unread / read",
  },
  { keys: ["o", "Enter"], action: "open", label: "Open at the source" },
  { keys: ["c"], action: "copy", label: "Copy as Markdown" },
  { keys: ["Escape", "Backspace"], action: "back", label: "Back to the briefing" },
];

export function resolvePaperKey(key: string): ReaderAction | null {
  for (const entry of PAPER_KEYS) {
    if (entry.keys.includes(key)) return entry.action;
  }
  return null;
}

// ── Help sheet ──

// How a `KeyboardEvent.key` reads on a keycap. Letters and brackets are
// themselves; the named keys get the names the rest of the help sheet uses.
const KEY_CAPS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  Escape: "Esc",
  Backspace: "⌫",
};

export function keyCap(key: string): string {
  return KEY_CAPS[key] ?? key;
}

/**
 * The "Reading" group for the help sheet, in the `{ keys, label }` shape the
 * sheet already renders. One row per action, naming its first key — the
 * sheet's own "Paper" group lists `j` without `ArrowDown` for the same reason:
 * the row explains the action, the primary key is enough to find it.
 */
export function readerHelpItems(): { keys: string; label: string }[] {
  return PAPER_KEYS.map((entry) => ({
    keys: keyCap(entry.keys[0]),
    label: entry.label,
  }));
}

// ── Registry ──

export type ReaderActions = Partial<Record<ReaderAction, () => void>>;

let current: ReaderActions | null = null;

/**
 * The page hands over its handlers on mount and takes them back on unmount.
 * Unregistering checks identity, so a stale cleanup (Strict Mode's double
 * mount, or a page unmounting after its successor registered) never clears
 * the live set.
 */
export function registerReaderActions(actions: ReaderActions): () => void {
  current = actions;
  return () => {
    if (current === actions) current = null;
  };
}

export function readerActions(): ReaderActions | null {
  return current;
}
