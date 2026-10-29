# Brief R2-fix — round 2's findings (ruling R20)

Role: **C, the implementer**, which is lane 4's own C, resumed. Round 2 scored Theme A 97.92 and Theme B 100.0. Theme B has now held for two rounds and is no longer scored. Theme A needs one more round at or above 97.9. This pass fixes what round 2 found.

## Where

- Your worktree is `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane4`, checked out (detached) at the branch tip named in the manager's message. If writes are blocked, enter it with EnterWorktree(path).
- Your files:
  - `web/src/app/welcome/account-step.tsx`
  - `web/src/app/welcome/page.tsx`: the Next button's label and the review list's value cell, nothing else
  - `web/src/components/profile/key-check.tsx`: the "busy" line only
  - their tests

## Rules

These are the same as before:
- Commit on the detached HEAD, one commit per item, and never push or branch.
- Every commit ends with both trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`.
- Do not start a dev server or sign in. Tests land with the change. Use no banned wording; `no-company-model-copy.test.ts` bans "quota" in source.
- Gates for each commit, run from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run <affected>`. The baseline failure to leave alone is `jev-setup.test.tsx` "JevScreeningStatus is mounted …".

## Items

1. **The visible words are the accessible name** (A5; all three readers; WCAG 2.5.3 Label in Name).
   - Below `sm` the Account step's Next shows "Skip sign-in", but its accessible name is always "Continue without signing in", so a voice-control user who says "Skip sign-in" misses it.
   - Remove the `aria-label`. Keep two spans with no `aria-hidden`, and hide the one that should not show with CSS (`sm:hidden` / `hidden sm:inline`). A `display: none` element leaves the accessibility tree, so the name at each width is exactly the words on screen.
   - Re-aim the tests honestly:
     - the markup has no aria-label;
     - neither span is aria-hidden;
     - the breakpoint classes are right;
     - every other step's Next is unchanged.
2. **"Most settings"** (A5, reader 1). Some settings stay on the device: Deep report, Preferred journals and the AI company choice. Change the two Account-step subtitles to:
   - signed out / unknown: "Sign in to keep your topics, saved papers and most settings on every device, and to use your own AI key."
   - signed in: "Your topics, saved papers and most settings now follow your account. Your API keys stay in this browser."

   Update `accountStepCopy` and its tests. The README line that quotes the old subtitle, if any, changes too.
3. **The review row is not cut** (director, at 375 px). The Welcome review list ("What Peer knows so far") truncates its value with an ellipsis. At 375 px the AI row reads "Gemini key saved — sign in t…", which cuts off the instruction. Let the value cell wrap: drop `truncate`/`whitespace-nowrap` and use `break-words`, or `line-clamp-2` only if two lines always fit. A long value then takes a second line. Pin it with a markup test on that cell's classes.
4. **Check key "busy"** (reader 3's note, taken). "The provider is busy right now. Try again in a minute." can mislead when a limit on the key resets later than a minute. Change it to "The provider is turning requests away for now. Try again later." Update `KEY_CHECK_COPY` and its tests. The README or /privacy do not quote this line; check before you finish.

## Report back (under ~250 words)

Give the commits (short hash and subject), the tests changed and added, the commands with their counts, and the final strings.
