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

// EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb.1) — the generic "nothing
// new" title/line, named so `no-results` below can reuse it verbatim
// ("(today's words)" — the ruling's own instruction) rather than retyping a
// second copy that could quietly drift from the first.
const NOTHING_NEW_TITLE = "Nothing new for these topics today.";
const NOTHING_NEW_LINE =
  "Peer only sends what is new and relevant. Refresh to look again, or widen your topics.";

/**
 * Nothing to show, and the reasons it can be. `error`/`empty` are the two
 * original reasons; the 4 keys below them are EMPTY-STATE-REASON's honest,
 * server-computed causes for an empty (not failed) response — see
 * `FeedEmptyReasonCode` (feed/types.ts) and `page.tsx`'s `BriefingEmpty`,
 * whose copy lookup falls back to `empty` whenever the server sent no code
 * or one this build doesn't recognize. Only `title`/`line` are needed for
 * these 4: `BriefingEmpty`'s action buttons are wired to the fixed
 * `error`/`empty` entries below regardless of which specific reason is
 * showing (ruling §1bb.6 — "buttons stay wired exactly as today"), so a new
 * code never needs its own button labels.
 */
export const BRIEFING_EMPTY = {
  error: {
    title: "Couldn’t reach the paper sources.",
    line: "Check your connection, then try again.",
    retry: "Try again",
    edit: "Edit topics",
  },
  empty: {
    title: NOTHING_NEW_TITLE,
    line: NOTHING_NEW_LINE,
    refresh: "Refresh",
    widen: "Widen topics",
  },
  "sources-unreachable": {
    title: "Couldn't reach today's paper sources.",
    line: "Refresh to try again.",
  },
  "no-results": {
    title: NOTHING_NEW_TITLE,
    line: NOTHING_NEW_LINE,
  },
  // EMPTY-STATE-REASON fix round (§1bb CORRECTION, after fresh A
  // FAILED_REVIEW, docs/jev-abc/EMPTY-STATE-REASON-A-20260929T122243Z.md
  // HIGH) — this code also covers papers removed by the reader's OWN
  // declared exclusions (combine.ts, before the gate) and by the
  // review-paper filter (after a genuine topic match), so the original
  // "None of today's papers matched your Required topics" could claim a
  // non-match that never actually happened. Reworded to stay true for all
  // three folded causes at once.
  "no-required-match": {
    title: "None of today's papers passed your Required topics and filters.",
    line: "Try a broader Required topic in Profile.",
  },
  // ASSUMPTION (flagged for review — see the EMPTY-STATE-REASON-C checkpoint):
  // §1bb.1 gave only the title sentence for this one code, with no second
  // sentence. The title matches B's guide draft verbatim; nothing in the
  // ruling contradicts B's own drafted next-step line, so it is reused
  // verbatim rather than invented. Not an ESCAPE-CLAUSE case — this is
  // copy wording, not a fact needed to compute a reason code.
  "already-delivered": {
    title: "You're caught up on these topics.",
    line: "Every match for today was already in your feed. Check back after it refreshes, or widen your topics.",
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
