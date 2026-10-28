# Brief L3-fix — "Check key": the right line for every situation, the page sentence made exact, and the button mounted

Role: **C, the implementer** (lane 3's own C, resumed). Rulings R7 and R12 in `docs/handoff/own-key/ABC-own-key.md` decide everything below; the reviewer's report is `C:\Users\wbc13\AppData\Roaming\Claude\side-session-notes\local_b314d721-360a-472c-99e8-d2d322baa65d\L3-A-20261028T1725Z.md` (read it for evidence and file:line).

## Where

- Worktree `C:\I\Personal\Github - start up project\Peer\.claude\worktrees\own-key-lane3`, now checked out (detached) at the branch tip, which already holds lanes 2, 3 and 4. Your earlier commits are in it as 7b68634f and 14961cb2. `web/node_modules` is a complete install. Enter it with EnterWorktree(path) if the harness blocks writes.
- Yours: `web/src/lib/llm/key-check.ts`(+test), `web/src/app/api/ai/check-key/route.ts`(+test), `web/src/components/profile/key-check.tsx`(+test), the `testConnection` methods in `web/src/lib/llm/providers/{anthropic,openai,qwen,deepseek,gemini}.ts`(+their tests), `web/src/app/privacy/page.tsx` "Your own model key" (+ `page.byok-only.test.tsx`), and ONE mount in `web/src/components/profile/ai-setup.tsx`.
- Not yours: everything else. Lane 1 is editing `store/profile.ts`, `profile-sync.tsx`, `types/index.ts`, `lib/profile/merge.ts`, the feed route and sources.

## Rules

Same as your first brief: commit on the detached HEAD (one commit per numbered item is fine), never push or branch, two trailers on every commit (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`), no dev server, no real provider calls, no new dependency, no banned words in non-comment source (`no-company-model-copy.test.ts`: e.g. "quota", "allowance"), tests land with the change. Gates per commit from `web/`: `npx tsc --noEmit`, `npx eslint <changed>`, `npx vitest run <affected>`; baseline failures you will see and must leave: `privacy/page.standing.test.tsx`, `privacy/page.test.tsx` "a saved upload's record …", `jev-setup.test.tsx` "JevScreeningStatus is mounted …".

## Items

1. **Route words** (`key-check.ts` classifier and `checkProviderKey`): `ok | rejected | no-credit | busy | unreachable | error`.
   - `no-credit` is decided FIRST, before any status switch: `/insufficient_\w+/i`, status 402, `/credit balance is too low/i`, `/\bArrearage\b/`.
   - `rejected` as today (401/403 and the key-refused patterns).
   - `busy` = the provider's own rate limit (429 not already `no-credit`, `RESOURCE_EXHAUSTED`, rate limit, too many requests).
   - `unreachable` = timeout, thrown error, network failure, 5xx.
   - `error` = any other provider answer (e.g. a 400/404 for a model the key cannot use, Gemini's "User location is not supported").
   - `ok` also when the provider answered HTTP 200 with empty text (today `openai.ts`, `qwen.ts`, `deepseek.ts` throw "returned empty content" → wrongly `unreachable`): make each provider's `testConnection` treat an accepted request with an empty answer as `{ ok: true }`, without changing any other call path. Tests on realistic error strings for every branch.
2. **One request means one** (D5): Anthropic's `testConnection` passes the SDK request option `{ maxRetries: 0 }`; confirm every provider's `testConnection` sends exactly one request (Gemini SDK has no retries without `retryOptions`; the fetch providers send one) and pin Anthropic's with a test.
3. **The lines the reader sees** (`key-check.tsx`), exactly:
   - ok → "This key works."
   - rejected → "The provider did not accept this key."
   - no-credit → "This key works, but the provider says its account has no credit left."
   - busy → "The provider is busy right now. Try again in a minute."
   - Peer's own 429 → "Too many checks this hour. Try again later."
   - Peer's own 401, AND the button disabled because the reader is confirmed signed out → "Sign in to check your key." (D3, D6). While the sign-in check has not answered (`unknown`), show nothing extra.
   - unreachable → "Could not reach the provider just now. Try again."
   - error → "The provider answered with an error. Check the key and your account on the provider's site."
   - Keep "Checking…" while waiting, the billing note, and the "never render a 4-character slice of the key" tests.
4. **/privacy, "Your own model key"** (D4): replace the Check key paragraph with, exactly (adjust only if the code makes a word untrue, and say so):
   "If you press Check key, your browser sends the key to Peer's server, which makes one short request to that provider to see whether it accepts the key. Peer keeps neither the key nor the provider's answer. The server writes one log line for the check — the provider, the model, the token counts, how long it took and whether it worked — and never the key or anything you wrote. If you are signed in, the server also counts this account's checks this hour, a number and nothing else, kept so the limit of ten checks an hour can hold."
   Pin it in `page.byok-only.test.tsx` to the `LlmUsage` fields in `web/src/lib/llm/usage-log.ts` (provider, model, path, token counts, latency, ok — no key, no text) and to every provider's `testConnection` going through the logged call. Keep "Last changed 2026-10-28".
5. **Mount**: in `AiKeyFields` (`ai-setup.tsx`), render `<KeyCheck provider={provider} apiKey={apiKey} idPrefix={idPrefix} />` inside the key field's block, after the sign-in note (`KEY_SIGN_IN_NOTE`). It then shows on Profile ("AI provider") and on the Welcome "AI" step. Add a static-render test that the button is present under the key field for a chosen company and absent for "No AI".

## Report back (under ~350 words, never paste a key value)

Commits (short hash + subject), files, tests added, every command with pass/fail counts and which failures are baseline, the final strings, and any deviation with its reason.
