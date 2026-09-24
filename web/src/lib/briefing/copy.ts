// The briefing's fixed words.

/** The setup strip above a sample briefing. */
export const STARTER = {
  label: "A sample, until you say otherwise",
  line: "These are real papers from today, across a few broad fields. Pick the one you work in and this becomes your briefing — everything else is optional.",
  placeholder: "or type your field",
  submit: "Use this",
  rest: "The longer setup — project, methods, sources, your own model key —",
  restLink: "is here.",
};

/** The sync state, said in words at the top right. The refresh control used to
 *  spin its own icon; a loop for a state that has a word for it is ornament,
 *  and the word is also the only one of the four a screen reader could reach. */
export const SYNC = {
  failed: "sync failed",
  syncing: "syncing…",
  /** `formatTimeAgo` returns null under a minute — then it is just synced. */
  synced: (ago: string | null) => (ago ? `synced ${ago}` : "synced"),
  never: "not synced yet",
};

/** Nothing to show, and the two reasons it can be. */
export const BRIEFING_EMPTY = {
  error: {
    title: "Couldn’t reach the paper sources.",
    line: "Check your connection, then try again.",
    retry: "Try again",
    edit: "Edit topics",
  },
  empty: {
    title: "Nothing new for these topics today.",
    line: "Peer only sends what is new and relevant. Refresh to look again, or widen your topics.",
    refresh: "Refresh",
    widen: "Widen topics",
  },
};

export const SEARCH_BOX = {
  /** What the search page searches; the box promises no less and no more. */
  placeholder: "Search all papers…",
  label: "Search papers",
};

export const UPLOAD_BUTTON = {
  label: "Upload a paper PDF",
  /** Server and client rejection reasons are already plain sentences; this
   *  just names the seam so every caller reads the same way. */
  error: (reason: string) => reason,
};
