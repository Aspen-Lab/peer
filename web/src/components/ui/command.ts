// A command in Peer's instrument voice: the mono label, outlined like a term
// chip on the reading graph, taking the accent only when it is the state that
// is set (`aria-pressed`). The graph's readout used it first; the notes use
// the same one rather than a second recipe for the same thing.
export const COMMAND =
  "eyebrow px-2 py-1 text-text-muted shadow-[inset_0_0_0_1px_var(--color-border-strong)] " +
  "hover:text-heading transition-colors disabled:opacity-40 disabled:pointer-events-none " +
  "aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent)]";
