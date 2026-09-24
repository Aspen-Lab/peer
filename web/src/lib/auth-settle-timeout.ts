// Shared bounded-fallback timeout for "has the initial Supabase auth check
// settled" signals. Two independent consumers wait on state published by
// ProfileSync (web/src/components/profile-sync.tsx) and each apply their own
// dead-network fallback so a stuck check can only delay, never permanently
// block, their decision:
//   - web/src/components/first-run.tsx's useProfileSettled() (pre-existing;
//     waits on `useSyncGate`'s `settled` — the profile PULL finishing).
//   - web/src/app/page.tsx's auto-load auth-outcome gate (P4-S5b-FIX3; waits
//     on `useSyncGate`'s `authOutcome` — the auth CHECK resolving, which
//     happens no later than `settled` does).
// Extracted here, rather than duplicated as two independent literals, so the
// two can never silently drift apart. The value (4000ms) and first-run.tsx's
// own behaviour are unchanged by this extraction.
export const AUTH_SETTLE_TIMEOUT_MS = 4000;
