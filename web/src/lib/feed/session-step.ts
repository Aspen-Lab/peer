// What a change in the sign-in session means for the data in this browser.
//
// Two kinds of data live here, and they must be told apart:
//
//   the reader's own   made while signed out — saves, reads, the library.
//                      It belongs to whoever is at this browser and must
//                      survive every reload until they clear site data,
//                      which is what /privacy promises.
//   an account's copy  pulled down from a signed-in account. It must not
//                      outlive that account's session on this browser, or
//                      the next person at a shared machine reads the last
//                      person's shelf.
//
// `syncedUserId` is the mark that tells them apart: it is set when an
// account's data is synced into this browser and cleared by the reset.
//
// The bug this replaces: every page load for a visitor who was not signed in
// ran the sign-out reset, because "no user found at mount" was treated as
// "signed out just now". A signed-out reader's saves vanished on each reload,
// while a genuine sign-out left the reading history behind.

export type SessionStep =
  /** Leave the data alone. */
  | "keep"
  /** A session ended: clear everything an account brought here. */
  | "reset"
  /** Push what is here up to the account, then pull the account down. */
  | "sync"
  /** A different account's copy is here: clear it first, then sync. */
  | "reset-then-sync";

export function sessionStep(input: {
  /**
   * The signed-in user's id; `null` when the session is DEFINITELY absent;
   * `undefined` when it could not be checked — offline, a server error. Those
   * two are never the same: a reader's data is not wiped because the network
   * was down when the page loaded.
   */
  userId: string | null | undefined;
  /** Whose account the local data was last synced from; null when it was
   *  made signed out. */
  syncedUserId: string | null;
  /** The session just ended in this tab (the `SIGNED_OUT` event). */
  signedOut?: boolean;
}): SessionStep {
  if (input.signedOut) return "reset";
  if (input.userId === undefined) return "keep";
  if (input.userId === null) {
    // Nobody is signed in. If the data here came from an account, that
    // session ended while the tab was closed — it goes. If it did not, it is
    // the reader's own and it stays.
    return input.syncedUserId ? "reset" : "keep";
  }
  // Someone is signed in. Another account's copy is never pushed up into
  // theirs.
  if (input.syncedUserId && input.syncedUserId !== input.userId) return "reset-then-sync";
  return "sync";
}
