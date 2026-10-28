# Brief L2-fix — fewer, truer sign-in lines beside the key and on a paper

Role: **C, the implementer** (lane 2's own C, resumed). Ruling R14 in `docs/handoff/own-key/ABC-own-key.md` decides everything below. Reviewer evidence: `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L2-A-20261028T1822Z.md`.

## Where

- Worktree `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane2`, now checked out (detached) at the branch tip, which holds all four lanes and lane 3's fix ("Check key" is mounted inside `AiKeyFields`). Your earlier commits are in it (68163acd, f6cfe7ce, 43e2a404). `web/node_modules` is a complete install. Enter it with EnterWorktree(path) if writes are blocked.
- Yours for this pass: `web/src/components/profile/ai-setup.tsx`, `web/src/components/profile/key-check.tsx` (the signed-out idle line only), `web/src/lib/papers/reading.ts`, `web/src/components/reader/decision-block.tsx`, `web/src/components/reader/copy.ts`, `web/src/lib/navigation/add-key-destination.ts`, `web/src/app/papers/[id]/page.tsx` (the link and its inputs only), `web/src/app/profile/page.tsx` (the "AI provider" row only), and in `web/src/app/welcome/page.tsx` ONLY the `<AiKeyFields … />` call on the "AI" step (lane 4 is editing other parts of that file right now; touch nothing else there). Tests next to each.
- Not yours: `components/account/*`, `lib/navigation/return-path.ts`, `app/auth/*`, `app/welcome/{completeness,summary,account-step}.ts(x)`, `store/*`, `profile-sync.tsx`, `app/privacy/*`.

## Rules

Same as before: commit on the detached HEAD, never push or branch, both trailers on every commit (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`), no dev server, no sign-in, no new dependency, tests land with the change, no banned wording. Gates per commit from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run <affected>`. Baseline failures to leave: `privacy/page.standing.test.tsx`, `privacy/page.test.tsx` "a saved upload's record …", `jev-setup.test.tsx` "JevScreeningStatus is mounted …", `store/reader-panes.test.ts`, `store/reading-prefs.test.ts`, the four `app/papers/[id]/page.{escape,paragraph-guide,partition,plain}.test.ts` files.

## Items

1. **The paper sentence for a reader with a key who is signed out** (A's D5 + director note N2). "Method, caveats and what it means for your project need the full text and you to sign in" suggests signing in brings the method and caveats. For this state only, split it so each need is named with its own cause, e.g. "Abstract only. Method and caveats need the full text. What it means for your project needs you to sign in." (the exact form must follow `keyClause`'s structure for every reading tier: abstract only, sections read, no abstract). Every other state stays word for word.
2. **The link follows the sentence** (A's D1). Show the "Add a key" / "Sign in" link only when the sentence on screen names a key or a sign-in; a sentence that asks for neither (e.g. a fetched PDF with no text) shows no link. This changes the old no-key behaviour too: that is ruled (R14). Test the PDF-no-text case and the ordinary cases.
3. **The paper's "Sign in" comes back to the paper** (A's D2). The link becomes `/profile?return=<encodeURIComponent('/papers/' + encodedPaperId)>`, where `encodedPaperId` is exactly how the paper's own URL encodes its id. Lane 4 is adding the other half right now: `safeReturnPath` accepting `/papers/<one segment>` and the Profile's Account section passing a valid `return` to the sign-in buttons. Keep `SIGN_IN_HREF` as the base and build the link with a small pure helper; test it.
4. **Fewer sign-in lines beside the key** (A's D3 + director note N3 + lane 3's D6).
   - `AiKeyFields` gets an optional prop `signInNote?: boolean` (default `true`). The Welcome "AI" step already has its own "Sign in to use your key" block with buttons, so its `<AiKeyFields …>` call passes `signInNote={false}`.
   - `KeyCheck`'s "Sign in to check your key." shows only after a check came back 401 from Peer (signed out mid-session), not while the button is merely disabled for a confirmed signed-out reader: the reason for the disabled button is the note beside it (Profile) or the block above it (Welcome).
   - Result: Profile, signed out — "Peer uses your key only while you are signed in." and "Sign in under Account at the top of this page."; Welcome, signed out — the block's heading and buttons only. Test both renders.
5. **The Profile paragraph where sign-in does not exist** (A's D4). On a copy with no sign-in configured (`authOutcome === "unconfigured"`), drop the sentences about the account and signing out; keep "Your key stays in this browser only." and the provider sentence. Test both.

## Report back (under ~350 words, never paste a key value)

Commits (short hash + subject), files, tests added, every command with pass/fail counts and which failures are baseline, the final strings for every paper state you changed, and any deviation with its reason.
