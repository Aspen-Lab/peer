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
  | "read"
  | "open"
  | "copy"
  | "back"
  | "ask"
  | "explain";

export interface PaperKey {
  /** `KeyboardEvent.key` values; the first is the one the help sheet shows. */
  keys: readonly string[];
  action: ReaderAction;
  label: string;
  /** One word for the legend along the foot of the page, where the row is
   *  the whole width of the screen and the sentence would not fit. Same
   *  table as the label, so the legend cannot drift from the help sheet
   *  either. */
  short: string;
}

export const PAPER_KEYS: readonly PaperKey[] = [
  { keys: ["j", "]", "ArrowRight"], action: "next", label: "Next paper", short: "next" },
  { keys: ["k", "[", "ArrowLeft"], action: "prev", label: "Previous paper", short: "prev" },
  { keys: ["s"], action: "save", label: "Save / unsave", short: "save" },
  { keys: ["x"], action: "skip", label: "Not interested, then next", short: "skip" },
  { keys: ["l"], action: "like", label: "Like — more like this", short: "like" },
  // P4-01 (§1h.12 (h)): one row. With a plain rewrite showing, `u` takes the latest one back first
  // (the original stands alone again; the rewrite stays kept); only when none shows does it do
  // what it did — undo a dismiss, else mark unread / read.
  {
    keys: ["u"],
    action: "undoOrToggleRead",
    label: "Undo a plain rewrite or a dismiss, else mark unread / read",
    short: "undo",
  },
  // `t` for the text: `r` is the briefing's own key and stays global.
  { keys: ["t"], action: "read", label: "Read the paper here", short: "read" },
  { keys: ["o", "Enter"], action: "open", label: "Open at the source", short: "open" },
  { keys: ["c"], action: "copy", label: "Copy as Markdown", short: "copy" },
  // P1-03 (§1f.10): focus the first empty question line. Typed into the
  // field itself, `q` is a letter — the layer never intercepts a key typed
  // into an input.
  { keys: ["q"], action: "ask", label: "Ask a question about this paper", short: "ask" },
  // P3-02b (§1h.3): open "Explain this?" on the selected passage, as its button
  // does. Typed into the box's own input, `e` is a letter.
  { keys: ["e"], action: "explain", label: "Explain the selected passage", short: "explain" },
  {
    keys: ["Escape", "Backspace"],
    action: "back",
    label: "Back to the briefing",
    short: "briefing",
  },
];

/**
 * P1-08 (§1a.6, §1f.19): the keys a page answers to. On a standalone
 * uploaded PDF's page there is no "Not interested, then next" — the reader's
 * own file is not a feed item to dismiss — so `skip` is left out (the page
 * registers no handler for it, and the layer leaves `x` alone). Every other
 * page, a public paper with an attached PDF included, has the whole table.
 */
export function paperKeysFor({ upload }: { upload: boolean }): readonly PaperKey[] {
  return upload ? PAPER_KEYS.filter((entry) => entry.action !== "skip") : PAPER_KEYS;
}

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
