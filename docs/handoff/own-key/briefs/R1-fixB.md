# Brief R1-fixB — round 1's remaining findings (ruling R18)

Role: **C, the implementer** (lane 4's own C, resumed). Round 1 scored Theme A 85.4 and Theme B 100.0. Three blind readers found the same defects. The CHANGELOG entry, the 375 px label and the signed-in kicker have already landed. This pass fixes the rest.

## Where

- Your worktree is `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane4`, checked out (detached) at the branch tip given in the manager's message. If writes are blocked, enter it with EnterWorktree(path).
- Your files: the root `README.md`; `web/src/app/welcome/account-step.tsx`; `web/src/components/profile/ai-setup.tsx` (`keyHomeText` only); `web/src/components/account/account-section.tsx` (dialog wording only); `web/src/app/profile/page.tsx` (the reset line only); and their tests.

## Rules

The rules are the same as before:
- Commit on the detached HEAD, one commit per item, and never push or branch.
- Every commit carries both trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`.
- Do not start a dev server and do not sign in.
- Tests land with the change.
- No banned wording: no price, paid tier, trial, upgrade, waitlist, donation, sponsorship, "founder", "BYOK" or "Tier N".

Gates per commit, run from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, and `npx vitest run <affected>`. Leave the known baseline failure alone: `jev-setup.test.tsx` "JevScreeningStatus is mounted …".

## Items

1. **README** (repository root; A12 remainder). Bring it in line with the product:
   - The wizard order now starts with an optional Account step.
   - A reader's own model key is used only while they are signed in.
   - "Check key" exists: one short request to the provider, with no number about cost.
   - Signing out removes the keys from this browser, and a dialog says so first.
   - Keys never follow the account.
   - Tavily is removed.

   Keep the README's existing structure and tone. Change only the passages that are now wrong or missing, and do not add marketing. Read every Tavily, own-key and wizard passage in it first.
2. **Account step title** (A5). Signed out, the kicker "Optional" sits above the title "Sign in (optional).", so "optional" appears twice. Make the signed-out and unknown title "Sign in." and keep the kicker "Optional". Signed in stays "Account" / "You are signed in.". Update `accountStepCopy` and its tests.
3. **Profile key paragraph** (A1). "…does not follow your account to another device or browser: there, paste it again." reads clumsily. The signed-in, signed-out and unknown form becomes exactly: "Your key stays in this browser only. Peer passes it on to the provider you choose and never stores it on its server, so it does not follow your account: on another device or browser, paste it again. Signing out removes it from this browser." The unconfigured form stays as it is. Update `keyHomeText` and its tests, plus any profile-page test that pins the old wording.
4. **One word for the place in the sign-out dialog** (A8). The unsynced sentence says "this device" while the key sentences say "this browser". In the dialog, the unsynced sentence becomes "Some changes in this browser haven’t reached your account yet. Signing out removes them from this browser." This applies to both the "unsynced" and the "both" dialogs. Check where else that sentence is pinned (account-section tests; the privacy page does not quote it) and update those pins.
5. **The reset line counts the keys** (A9). With one key, the reset confirmation says "This also removes your API key from this browser."; with two, "… your API keys …". It reads `browserKeyLabels(profile).length`. Test both forms.

## Report back (under ~250 words)

Report the commits (short hash + subject), the tests changed and added, the commands with counts, and the final strings.
