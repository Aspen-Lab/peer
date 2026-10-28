# Brief R1-fixA — three director findings from round 1 (Welcome)

Role: **C, the implementer** (lane 4's own C, resumed). Source: the director's round-1 notes (state file §4c). The readers' findings come later in a separate pass.

## Where

- Worktree `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane4`, checked out (detached) at the branch tip 26accd41, which holds every lane, every fix pass and the CHANGELOG entry. Enter it with EnterWorktree(path) if writes are blocked.
- Yours: `web/src/app/welcome/page.tsx`, `web/src/app/welcome/account-step.tsx`, `web/src/components/profile/jev-setup.tsx` (the `welcome` variant only), and their tests.

## Rules

Same as before. Commit on the detached HEAD, one commit per item. Never push or branch. Put both trailers on every commit (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`). Do not start a dev server or sign in. Add no new dependency. Tests land with the change, and no banned wording. Gates per commit, run from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run <affected>`. `jev-setup.test.tsx` "JevScreeningStatus is mounted …" fails on the untouched tree (Windows line endings); leave it.

## Items

1. **"Continue without signing in" fits on a phone.** At 375 px the label wraps, and "in" ends up alone on a second line beside "← Back" (screenshot: `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\R1-pack\welcome-account-375px.jpg`). Make it one line at 375 px. Below the `sm` breakpoint, show "Skip sign-in". From `sm` up, keep "Continue without signing in". Give both the same accessible name: "Continue without signing in". Pin it with a test of the markup (both spans and their breakpoint classes) and of the accessible name.
2. **The signed-in Account step's kicker.** Today a signed-in reader sees "Optional" above "You are signed in.". When signed in, the kicker becomes "Account". Signed out and unknown keep "Optional". Update `accountStepCopy` and its tests.
3. **One sign-in line on the Welcome AI step.** A signed-out reader with a saved Jev key also sees `JEV_SIGN_IN_NOTE` ("Sign in to use it: Jev screens only for a signed-in reader.") under the Jev field. The step already shows the "Sign in to use your key" block with buttons above. In the `welcome` variant only, do not render that note. The Profile variant keeps it. Test both variants.

## Report back (under ~250 words)

Commits (short hash + subject), tests added, commands with counts, and the final strings.
