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

import { PLAIN_REWRITE_ENABLED } from "@/lib/papers/plain-levels";

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
  | "note"
  | "highlight"
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

/**
 * P11-17a rule 3: `u`'s words, under the "Say it plainly" switch (`plain-levels.ts`). The page's
 * `u` takes a plain rewrite back only while the switch is on, so only then does the row say so.
 * Chosen here, where the table is built: the keyboard layer, the help sheet and the legend still
 * read the one table.
 */
export function undoLabel(plainRewriteEnabled: boolean): string {
  return plainRewriteEnabled
    ? "Undo a plain rewrite or a dismiss, else mark unread / read"
    : "Undo a dismiss, else mark unread / read";
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
  // P11-17a rule 3: the words follow the "Say it plainly" switch (`undoLabel`). Off (the owner's
  // 2026-10-19 switch), `u` takes no rewrite back and the row says "Undo a dismiss, else mark
  // unread / read"; with `PLAIN_REWRITE_ENABLED` true the label is P4-01's above, byte-identical.
  {
    keys: ["u"],
    action: "undoOrToggleRead",
    label: undoLabel(PLAIN_REWRITE_ENABLED),
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
  // P11-13 (rule 3; owner items 5 and 8; ruling §1h.113 (b) O-4): the selection's other two actions, each on the selection the page
  // holds exactly as `e` explains it, each inert with nothing selected (`selectionActions`). Typed into a field, they are letters.
  { keys: ["n"], action: "note", label: "Take notes on the selected passage", short: "notes" },
  { keys: ["h"], action: "highlight", label: "Highlight the selected passage", short: "highlight" },
  // P3-02b (§1h.3): open "Explain this?" on the selected passage, as its button
  // does. Typed into the box's own input, `e` is a letter.
  { keys: ["e"], action: "explain", label: "Explain the selected passage", short: "explain" },
  // P11-17a (BACKLOG-98): `back`, not `briefing` — four characters the foot legend needs at 768 px; the label
  // still says where back goes.
  {
    keys: ["Escape", "Backspace"],
    action: "back",
    label: "Back to the briefing",
    short: "back",
  },
];

/**
 * P1-08 (§1a.6, §1f.19): the keys a page answers to. On a standalone
 * uploaded PDF's page there is no "Not interested, then next" — the reader's
 * own file is not a feed item to dismiss — so `skip` is left out (the page
 * registers no handler for it, and the layer leaves `x` alone). P7-12 (R4):
 * nor is there an "Open the PDF" command — the reader is already on the file's
 * page — so `open` (`o`, Enter) is left out too, and the foot legend does not
 * say `o open`. Every other page, a public paper with an attached PDF
 * included, has the whole table.
 */
export function paperKeysFor({ upload }: { upload: boolean }): readonly PaperKey[] {
  return upload ? PAPER_KEYS.filter((entry) => entry.action !== "skip" && entry.action !== "open") : PAPER_KEYS;
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

/**
 * P11-13 (rule 3): the keys that act on the selection the page holds — `n` takes notes, `h` highlights — as handlers for the
 * registry. `current` is read at the press, not at the registration, so a key always acts on the selection of the moment, and with
 * nothing selected it does nothing. A handler the page does not have leaves its key out (inert): the page passes `highlight` only
 * once it can highlight. `e` is not here: the explain box owns it (`openRef`). Generic over the page's selection type.
 */
export function selectionActions<T>(
  current: () => T | null,
  handlers: { note?: (target: T) => void; highlight?: (target: T) => void },
): Pick<ReaderActions, "note" | "highlight"> {
  const onSelection = (handler: (target: T) => void) => () => {
    const target = current();
    if (target !== null) handler(target);
  };
  return {
    ...(handlers.note ? { note: onSelection(handlers.note) } : {}),
    ...(handlers.highlight ? { highlight: onSelection(handlers.highlight) } : {}),
  };
}
