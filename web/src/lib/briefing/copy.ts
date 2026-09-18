// The briefing's fixed words.

export const DAY_STRIP = {
  /** One line saying how to read the strip. A chart that needs a paragraph
   *  is the wrong chart; one that needs no line at all is usually a chart
   *  nobody can read. */
  caption: "Each bar is a paper below, against today's best match",
  /** Only when some of the day has been read — with none read there is
   *  nothing for a key to distinguish. */
  // Every bar is grey; the read ones are the dimmer grey. "Grey is read"
  // described all ten.
  readKey: "The dim ones are read.",
};

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
