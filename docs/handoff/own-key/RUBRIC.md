# Rubric — own key on peer.homes

## Themes

- **Theme A — what the reader reads.** Every sentence this work adds or changes is true of the code, plain, in the app's own nouns, and free of forbidden wording.
- **Theme B — what the reader can do.** The flows work end to end on the product's real path, and a key never leaves the browser except inside the request it serves.

## Units

### Theme A (12)

| unit | passes when |
|---|---|
| A1 | Profile "AI provider" row says the key stays in this browser, does not follow the account to another device or browser (and why), must be pasted again there, and is removed on sign-out — once, without repeating the existing paragraph |
| A2 | The model-key fields show "Peer uses your key only while you are signed in." exactly when signed out and the key field is visible |
| A3 | Profile, signed out: the line pointing to Account at the top of the page |
| A4 | Paper page, signed out with a key: the blocks "need you to sign in", the button reads "Sign in"; every other state word-for-word unchanged |
| A5 | Welcome "Account" step: title, subtitle and "Continue without signing in" read plainly; signed-in state names the reader |
| A6 | Welcome "AI" step, signed out: "Sign in to use your key" block, no repeated sentence |
| A7 | Welcome "AI" summary, key saved + signed out: "<Provider> key saved — sign in to use it" |
| A8 | Sign-out dialog: names which keys (provider names only), gives the safety reason, says to paste again later; the unsynced sentence appears when it applies |
| A9 | "Reset profile to defaults" confirmation mentions the keys when there are some |
| A10 | "Check key": button label, the billing note (no number), the four result lines |
| A11 | /privacy "Your own model key": the Check key and does-not-travel sentences are true of the code; "Last changed" updated; `void feedAiApiKey` sentence intact |
| A12 | README and CHANGELOG say what changed (Tavily gone, new controls) in plain words |

### Theme B (11)

| unit | passes when |
|---|---|
| B1 | A signed-out reader meets sign-in in the walkthrough (Account step first; AI step block) and the buttons start GitHub / Google OAuth |
| B2 | After OAuth the reader returns to the wizard step they left (cookie written only with `returnTo`, validated, cleared) |
| B3 | `/auth/callback` accepts only same-site `/welcome` or `/profile` (plus a query) or `/papers/<one encoded id>` return paths, for both the cookie and `next` (the open redirect is closed) — amended by R17, applied late (see R21) |
| B4 | Unconfigured sign-in hides the Account step; `/welcome?step=ai` and the step rail still work |
| B5 | Check key: disabled unless signed in (or unconfigured) with a key; route 401 for a stranger before any provider; 4 outcomes mapped; provider text never echoed; 10 an hour |
| B6 | Sign-out with keys or unsynced changes opens one dialog; Stay signed in / Esc keeps the session; confirm sends the real POST |
| B7 | After a confirmed sign-out the keys are gone from the browser (unchanged behaviour), matching the dialog |
| B8 | A remote profile can neither set nor clear the model provider, the model key or the Jev key |
| B9 | Tavily is gone from the profile, store, sync, sources and feed route; old saved values and backups are stripped; the build guard still bans `TAVILY_API_KEY` |
| B10 | Tier 0 is unchanged: a reader with no key, signed in or out, gets the briefing and no model request |
| B11 | Gates: tsc 0 errors; eslint 0 errors on changed files; vitest failures ⊆ baseline (35) plus none new |

## Costs and formula

A defect costs **1.0** if unusable, **0.5** if misleading, **0.25** if cosmetic. Score per theme = `max(0, 100 × (Σ PASS − Σ costs) / units)`.

## Pass requirements (hold whatever the number says)

1. No key is stored on a server, written to a log, synced, or put in a backup file.
2. No sentence on /privacy or in the app claims something the code does not do.
3. No price, paid tier, trial, upgrade, waitlist, donation or sponsorship wording; no "founder"; no "BYOK" / "Tier N" in rendered text.
4. The build guard is not weakened; no new dependency.
5. Sign-in itself (GitHub / Google buttons on Profile, the OAuth calls, the callback's session exchange) behaves as before.

## Stop line

Target: **97.9** per theme (the owner, 2026-10-28, state file R5: "达标线用 97.9，每个主题连续两轮达到就停。"), i.e. one 0.25 cosmetic defect is tolerated in a 12-unit theme (97.9) and none in an 11-unit theme (97.7 < 97.9). Every theme at or above the target in two consecutive rounds. The loop's end is the manager's measure; the owner's own look is the acceptance above it.

## Scores

| round | commit | Theme A | Theme B | consecutive at target | evidence |
|---|---|---|---|---|---|
| 1 | 4a883c0a | **85.4** (readers 85.4 / 85.4 / 85.4; director 89.58) | **100.0** (readers 100 / 100 / 100; director 97.73) | A 0, B 1 | readers `R1-reader-{1,2,3}-*.md`; pack `R1-pack/`; R17, R18 |
| 2 | e267e1f1 | **97.92** (readers 95.83 / 97.9 / 97.92; director 100, 97.92 after the 375 px re-check) | **100.0** (readers 100 / 100 / 100; director 100) — **stops (R19)** | A 1, B 2 | readers `R2-reader-{1,2,3}-*.md`; pack `R2-pack/`; R19, R20 |
| 3 | c8704b83 | **97.92** (readers 95.83 / 97.92 / 100; director 100) — **stops: second consecutive round (R22)** | stopped (R19) | A 2, B 2 | readers `R3-reader-{1,2,3}-*.md`; pack `R3-pack/`; R21, R22 — **loop ended** |
