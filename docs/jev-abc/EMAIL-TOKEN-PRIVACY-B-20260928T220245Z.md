# EMAIL-TOKEN-PRIVACY — B guide (investigator)

STATUS: COMPLETE

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD `edfd4d55`. Role: B (investigator) per `ABC-JEV-INTEGRATION.md` §2 — no production edits, no live calls, no dev server, no state-changing git. Only file touched: this one. Scratch work (none needed beyond reading) would live at `<scratchpad>/…` — not used this round.

Binding inputs read: `ABC-JEV-INTEGRATION.md` §1 (CURRENT STATE block), §1y point 2 (EMAIL-SETTINGS spec, constraints i–viii — constraint vii: "never log addresses"), §1z (EMAIL-SETTINGS rulings — P4 24h TTL + re-use allowed, P6 secret-unset behaviour, P9 address format), §1al (POLISH-1 rulings, POLISH-1-EMAIL (f)/(g) — honest failure classification, redaction), §5 row `EMAIL-TOKEN-PRIVACY` (the manager's finding) and row `PRE-PUSH-PRIVACY` (confirms `github.com/Aspen-Lab/peer` is now a **public** repo, branch pushed 2026-09-28T21:18Z). Earlier guides read: `docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md` (token design, F1–F8), `docs/jev-abc/POLISH-1-EMAIL-C-20260928T053712Z.md` referenced via its shipped artifact (`send-failure.ts`).

---

## 1. Path enumeration — every place an address can reach a URL, a log, or a reader

Central fact first: the confirmation token (`web/src/lib/email/confirm-token.ts` lines 96–111) is `base64url(JSON.stringify({uid, email, exp})) + "." + base64url(HMAC-SHA256(...))`. Base64 is an *encoding*, not encryption — anyone who has the token (anyone who has the URL) can decode the first segment with zero secret and read `email` in plain text. The HMAC only proves the token wasn't *tampered with*; it does nothing to keep the payload confidential. That token, unchanged, becomes the query string of a real URL at `confirm-email/route.ts` line 187: `` `${originUrlFor(req)}/api/profile/confirm-email?token=${encodeURIComponent(token)}` `` — so the address rides in the URL itself, base64-spelled but trivially reversible.

| # | File:line | What happens | Reaches a reader/log? |
|---|---|---|---|
| P1 | `web/src/lib/email/confirm-token.ts` L96–111 (`signConfirmToken`), L59–63 (payload shape) | Mints the token; `email` is a plain field inside the base64url JSON segment | Not by itself — but everything downstream inherits this |
| P2 | `web/src/app/api/profile/confirm-email/route.ts` L186–187 | Builds `confirmUrl` = origin + path + `?token=<the base64 blob above>` | **The URL that leaks** |
| P3 | `web/src/app/api/profile/confirm-email/route.ts` L191–200 | `sendDigestEmail({ to: candidate, render: { html: renderConfirmEmailHtml({confirmUrl}), ... } })` | Puts the leaking URL into the actual email sent to the reader (necessary — see §2) |
| P4 | `web/src/lib/email/confirm-email-template.ts` L50 (plaintext), L86 (HTML button `href`), L94 ("paste this link" plaintext duplicate inside the HTML body) | The confirm URL is embedded **twice** in the HTML body and once in the plaintext body | Reader's mail client, any corporate link-scanning gateway that prefetches links in incoming mail, the reader's own "sent/received" mail archive — all three see the address-bearing URL, not just Peer's own logs |
| P5 | `web/src/app/api/profile/confirm-email/route.ts` L228–229 (`GET`), `req.nextUrl.searchParams.get("token")` | The reader's browser issues `GET /api/profile/confirm-email?token=<blob>` when the link is clicked | **This is the literal request line that server/CDN/hosting request logs record.** The manager's finding ("visible in the local dev log") is this line — Next's dev server prints the full path+query of every request to its console by default, and Vercel's runtime/access logs behave the same way for the deployed app. No code change can suppress this once the address is *in* the URL; the only fix is to keep it out of the URL in the first place (§3) |
| P6 | `web/src/app/api/profile/confirm-email/route.ts` L74–76 (`profileRedirect`) and its 6 call sites (L238, 242, 247, 254, 259, 264, 266) | Redirect target is always `/profile?digest_email_confirm=<one of: signin_required\|invalid_link\|wrong_account\|unavailable>` or `/profile?digest_email_confirmed=1` | **Checked — clean.** Status keywords only, never the address. `new URL(relative, base)` replaces the whole path+query when the relative reference carries its own query, so nothing from the incoming `?token=...` bleeds into the `Location` header either |
| P7 | `web/src/app/profile/page.tsx` L1567–1568 (comment), L1569–1615 (the `useEffect` reading `digest_email_confirmed`/`digest_email_confirm`) | Client-side handling of the redirect flags | **Checked — clean**, and notably the code's own comment already states the intent: *"never the address itself (constraint vii: never log/expose an email address in a URL)"* — the design intent was right, the token's encoding is what breaks it |
| P8 | `web/src/app/profile/page.tsx` L1623–1661 (`handleAddressSubmit`) | `POST /api/profile/confirm-email` with `{email: candidate}` as a JSON **body** | **Checked — clean.** Never a query string |
| P9 | `web/src/app/api/profile/confirm-email/route.ts` L209–211; `web/src/app/api/profile/send-test-email/route.ts` L221–223 | Both `console.error(...)` calls route through `describeSendFailureForLog`/`redactEmailAddresses` (`web/src/lib/email/send-failure.ts` L56–71: every `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g` substring → `"[email]"`) before printing | **Checked — clean**, this is POLISH-1-EMAIL (g) already shipped and working as designed |
| P10 | `web/src/app/api/profile/send-test-email/route.ts` L230 | `return NextResponse.json({ sent: true, to: normalizedDestination })` | **Checked — not a leak.** This is a response to the signed-in user's own `POST`, echoing back an address *they* already typed/saved. Constraint vii is about exposing an address to a party that shouldn't see it, not about round-tripping a user's own data to themselves |
| P11 | `web/src/app/api/profile/route.ts` (grepped whole file for `console.*` near `digest_email`/`digestEmail`) | No logging calls found. `GET` returns the signed-in owner's own `digestEmail` to themselves (same non-issue as P10); the F4 PUT guard (~L296–325) rejects/strips silently, no log | **Checked — clean** |
| P12 | `web/src/lib/supabase/middleware.ts` (session-refresh middleware, runs on every request) | No request-URL logging of any kind | **Checked — clean** |
| P13 | `web/src/app/error.tsx` L16–18, `web/src/app/global-error.tsx` (whole file) | `error.tsx` does client-side `console.error(error)` in the reader's own browser only; both boundaries render only `error.digest` (Next's opaque crash id), never `error.message` | **Checked — not applicable.** Neither boundary wraps the confirm-email route anyway: that route is an API handler that redirects before any React tree mounts, so no error boundary ever sees it |
| P14 | `web/src/app/layout.tsx` (Vercel Analytics mount) | Analytics instruments rendered pages via a client script | **Checked — not applicable.** The confirm-email `GET` never renders a page (redirects first), so the analytics script never loads for that hit |

### Two adjacent leaks found that are NOT the token, but are the same constraint (vii) and the same underlying `sendDigestEmail` error text — found while tracing "neighbours" per the task

`send-digest.ts` L97–99 passes Resend's raw `error.message` straight through as `SendDigestResult.error`. EMAIL-SETTINGS-B's own F7 already established that Resend's sandbox-sender validation message **names an email address** (the account-owner's address, in the "you can only send testing emails to your own address" case). POLISH-1-EMAIL (g) fixed this for the two new routes (P9 above) by routing through `send-failure.ts`'s redaction. It was never applied to the two pre-existing digest-sending routes, which still return the raw text:

| # | File:line | What happens |
|---|---|---|
| P15 | `web/src/app/api/jobs/dispatch-digests/route.ts` L417, L476 | `emailsFailed.push({ user_id, error: outcome.error })` / `emailsFailed.push({ user_id, error: result.error ?? "unknown" })` — raw Resend text, unredacted |
| P16 | `web/src/app/api/jobs/dispatch-digests/route.ts` L488–507 | `return NextResponse.json({ ..., emails_failed: emailsFailed })` — the raw text reaches the HTTP response body of this `CRON_SECRET`-gated route |
| P17 | `web/src/app/api/jobs/prepare-dashboards/route.ts` L318, L327, L379, L434 | Same pattern: `failed.push({ user_id, error: outcome.error })` → `report.email_retry = {..., ...retryResult}` → `return NextResponse.json(report)` |
| P18 | `.github/workflows/digest-cron.yml` L31–37 (`dispatch` job) and L89–95 (`prepare` job) | `curl ... -o /tmp/body.json; jq . /tmp/body.json \|\| cat /tmp/body.json` — **prints the full JSON response, including any address-bearing `error` string, into the GitHub Actions run log** |

Why this matters *now*, same as the token: `ABC-JEV-INTEGRATION.md` §5 row `PRE-PUSH-PRIVACY` confirms the repo is now public. A public repo's GitHub Actions run logs are visible to anyone, forever (or until manually deleted), including via the unauthenticated API. `digest-cron.yml`'s `prepare` job is not on `main` yet (its own header: "No effect at all until this file is pushed/merged to main"), but `dispatch` (the `emails_failed` leak, P15/P16) already **is** live — it is the existing, already-merged cron this project runs hourly (state file NOW paragraph: *"Hourly digest dispatch" scheduled run 2026-09-28T20:30:43Z = success*). This is a live, public, permanent log path today, independent of the token fix. See POLICY #4.

---

## 2. Where the pending address lives today, and what gets stored after confirmation

**Between "Confirm" and the click: nowhere, durably.** The design is deliberately stateless (EMAIL-SETTINGS-B §2.2, confirmed unchanged by reading the shipped code):

- The only "storage" of the requested-but-unconfirmed address is the token itself, one-way-sent inside the confirmation email (P3/P4 above). Nothing is written to the database when `POST /api/profile/confirm-email` runs (`confirm-email/route.ts` — the whole handler up to the send is read-only against `profiles`, aside from the rate-limit counter).
- Client-side, `web/src/app/profile/page.tsx` L1537 (`useState<string | null>` `pendingAddress`) mirrors the requested address **only in that one tab's React state** — not the Zustand profile store, not `localStorage`, not re-sent to the server. A page reload silently loses it (a known, accepted rough edge, EMAIL-SETTINGS-B §2.2 point 6).
- This is *why* the token has to be self-describing today: there is no server-side place to look the address up from an opaque reference. That's the exact tension either fix option below has to resolve.

**After a successful confirmation:** `writeConfirmedDigestEmail` (`confirm-email/route.ts` L106–116) upserts straight into `profiles.digest_email` — the same pre-existing schema column (`web/supabase/schema.sql` L122–137, nullable `text`, no format constraint, already part of the base schema per EMAIL-SETTINGS-B F4) that also holds the "account email, auto-confirmed" default and is what `send-test-email` and the real digest cron read as the destination. No separate confirmed-at timestamp, no history — one current value, overwritten each time. This column and its RLS are unchanged by anything in this item; not a new exposure surface.

The "already confirmed" short-circuit (`confirm-email/route.ts` L142–157: candidate equals the account email or the already-stored value) never mints a token and never sends an email at all — entirely unaffected by whichever fix ships.

---

## 3. Design options

### Option A (recommended) — authenticated encryption, keyed from the existing `DIGEST_EMAIL_CONFIRM_SECRET`, no schema change

Replace the base64-JSON-then-HMAC construction with AES-256-GCM (Node's built-in `crypto`, same module `confirm-token.ts` already imports — no new dependency):

```
key   = crypto.hkdfSync("sha256", DIGEST_EMAIL_CONFIRM_SECRET, /*salt*/ "", "peer:digest-email-confirm:v2", 32)
iv    = crypto.randomBytes(12)                       // fresh per token — never reused with the same key
pt    = JSON.stringify({ uid, email: normalized, exp })   // same fields as today
cipher    = crypto.createCipheriv("aes-256-gcm", key, iv)
ct        = Buffer.concat([cipher.update(pt, "utf8"), cipher.final()])
tag       = cipher.getAuthTag()                       // 16 bytes, GCM's built-in integrity check
token = "v2." + base64url(iv) + "." + base64url(Buffer.concat([ct, tag]))
```

Verify: if the token starts with `"v2."`, base64url-decode the two remaining segments, `createDecipheriv("aes-256-gcm", key, iv)`, `setAuthTag(tag)`, `decipher.update()+decipher.final()` inside a try/catch — **any** throw (bad tag = tampered, truncated = malformed) is caught before `JSON.parse` ever runs, exactly preserving today's "verify signature before trusting any claim" discipline (`confirm-token.ts` L117–124's own stated order). Confirm Node's `crypto.hkdfSync` is available in the runtime this Next version ships (check `web/node_modules/next/dist/docs/` per `web/AGENTS.md` — do not assume; a plain `crypto.createHash("sha256").update(secret).digest()` key derivation is an acceptable fallback if `hkdfSync` isn't available or isn't wanted, see POLICY #6).

**Covers every required property:**
- **Expiry** — `exp` stays a field inside the (now-encrypted) JSON payload; checked identically, after decrypt succeeds.
- **Tampering** — GCM's auth tag *is* an integrity/authenticity check, cryptographically at least as strong as today's separate HMAC, verified in the same single `try` that also provides confidentiality. One primitive, not two composed by hand (see POLICY #2 re: the §5 row's "keep HMAC" wording).
- **Replay after success** — unchanged either way: re-use is intentionally allowed today (§1z P4, mail-gateway-prefetch reasoning) and this item isn't asked to change that. Worth flagging regardless of which option ships: `writeConfirmedDigestEmail` unconditionally overwrites `digest_email` with whatever the token says, so clicking an *old*, still-unexpired confirmation link **after** having since confirmed a different address silently reverts `digest_email` back to the older one. Pre-existing behaviour, not introduced by encoding the token differently, not a URL/log privacy issue — flagged because the task asks B to cover replay explicitly. See POLICY #5.
- **Links already sent in the old format** — the legacy 2-part `payload.sig` shape has no `"v2."` prefix, so `verify()` can try the new parse first and fall back to today's exact HMAC-verify code (kept verbatim, temporarily) for anything that doesn't start with `"v2."`. A reader who requested a link shortly before deploy and clicks it after still succeeds, for the rest of that token's original 24h TTL. Recommended: delete the legacy branch in a follow-up cleanup once one full TTL has passed after deploy (POLICY #3).
- **Key rotation** — identical to today: rotating `DIGEST_EMAIL_CONFIRM_SECRET` makes every outstanding token (new-format or legacy) fail to verify; the reader sees "invalid link" and must request a new one. Not a new cost — this is exactly how HMAC-secret rotation already behaves.
- **No address, plain or reversibly encoded, in any URL or log afterward** — the ciphertext is opaque without the key; base64url of encrypted bytes reveals nothing about the plaintext (that's the point of authenticated encryption). Only a very-low-severity residual note: ciphertext length weakly correlates with plaintext length, so an observer could guess *roughly* how long an address is — judged not worth the complexity of padding (POLICY #7).

**Costs:** a genuinely new crypto code path to get right (small — Node's AEAD API is a handful of lines, and the module already does constant-time comparison and base64url elsewhere); a temporary dual-format `verify()`; if `DIGEST_EMAIL_CONFIRM_SECRET` itself were ever exposed, every outstanding token becomes decryptable — but note this is **not a regression**: today's tokens are already fully readable by anyone who merely has the URL, secret or no secret, so Option A is strictly more private than the status quo, never less.

### Option B — server-side storage of the pending address, opaque nonce in the URL, needs a migration

```
Migration (user applies by hand in Supabase, following this item's own established shape — see 20260922010000_profile_feed_intent.sql):
  alter table public.profiles
    add column if not exists pending_digest_email text null,
    add column if not exists pending_digest_email_token_hash text null,
    add column if not exists pending_digest_email_expires_at timestamptz null;

POST: nonce = crypto.randomBytes(32)              // pure randomness — no email-derived bytes at all
      store sha256(nonce) (never the raw nonce) + candidate + expiry against the signed-in user's row
      confirmUrl = `${origin}/api/profile/confirm-email?token=${base64url(nonce)}`

GET:  look up the signed-in session's own row (RLS already scopes this by user_id, same as every other profile read today), compare sha256(received token) to the stored hash with timingSafeEqual, check expiry, write digest_email from the stored pending_digest_email.
```

**Covers the same required properties**, with two concrete differences from Option A:

- **No cryptography needed in the token at all** — the smallest possible trusted-computing-base for the URL itself (a random nonce and a hash comparison). Confidentiality of the address never depends on getting an encryption implementation right.
- **Links already sent in the old format cannot be honored, even in principle** — the pending-row lookup only exists for requests made *after* Option B ships; an old-format token was never associated with a stored row, so there is nothing to look up. Every reader with an unclicked link in their inbox at deploy time gets "invalid link" and must click "resend," full stop — no grace window is possible here, unlike Option A.
- **Deployment risk, given this project's own history:** this campaign's migrations have repeatedly sat unapplied for extended periods with real consequences — `20260924000300_briefing_deliveries_dedupe.sql` is still unapplied weeks after being authored (EMAIL-SETTINGS-B F1), and the unapplied `feed_intent` column caused a live, user-visible failure on *every* profile save until the manager traced it (§1ah). Option B adds a third such dependency to a flow that's about to go live for real readers today. Until applied, the confirm-email routes need the same defensive "column missing" fallback complexity already seen elsewhere in this codebase (e.g. `isMissingFeedIntentColumn` in `send-test-email/route.ts` L103–108) just to fail cleanly instead of 500ing.
- **New RLS surface** — a new table/columns needs its own correct ownership policy (§1c's own binding privacy ruling requires this for personalized data). Getting that wrong would be a new privacy bug introduced by the fix for one.
- **Note on the URL itself:** Option B does *not* remove the token from the URL — it removes *meaning* from it (opaque nonce vs. meaningful ciphertext). Both options equally satisfy "no address in the URL"; the real difference is deployability and what a secret-vs-database compromise each implies, not the URL's contents.

### Recommendation

**Option A.** It ships with zero database dependency (this branch is going live today, per the state file's NOW paragraph, and `DIGEST_EMAIL_CONFIRM_SECRET` is already confirmed set in Vercel), it can still honor confirmation links already sitting in readers' inboxes for one more TTL window, and it changes nothing about the feature's existing behaviour (re-use, multiple outstanding tokens, key-rotation semantics) — only the token's bytes stop being readable without the secret. Option B is the more conservative design in the abstract, but concretely, in *this* codebase, "needs a migration applied by hand" has a demonstrated track record of multi-day delay and live breakage — exactly the outcome this fix should not risk while readers are actively confirming real addresses.

---

## 4. Test plan for C

1. **Round trip.** Sign then verify (new format) returns `{ok:true, uid, email}` matching the input, for a short address and a realistic long one, and for a UUID-shaped `uid`.
2. **Tampered — ciphertext.** Flip one byte inside the ciphertext/tag segment → `verify` returns `{ok:false, reason:"tampered"}` (or equivalent), never throws uncaught, never reaches `JSON.parse`.
3. **Tampered — IV.** Swap the IV for a different valid-length IV, ciphertext/tag unchanged → rejected the same way (GCM's tag check fails).
4. **Malformed.** Truncated token, wrong number of `.`-separated parts, invalid base64url → `{ok:false, reason:"malformed"}`, no decrypt attempted where structurally impossible.
5. **Expired.** Decrypts successfully (proves the ciphertext/tag are valid) but `exp` is in the past under a pinned clock → `{ok:false, reason:"expired"}` — must distinguish this from "tampered" (decrypt succeeded).
6. **Old-format token still works.** A token minted with *today's* shipped `signConfirmToken` (fixture captured from the current code before the change, or generated inline with the legacy algorithm) verifies successfully through the new `verifyConfirmToken` for the remainder of its original 24h window.
7. **Old-format tampered token still rejected.** The dual-format fallback must not accidentally weaken tamper-detection for legacy tokens — flip a byte in a legacy-format token, still rejected.
8. **No address substring in the generated URL — plain or encoded.** Build a real `confirmUrl` for a representative address (e.g. `reader@example.test`) and assert the URL string contains **none** of: the raw address, `encodeURIComponent(address)`, the local-part alone, the domain alone, `Buffer.from(address).toString("base64")`, or `.toString("base64url")`. This catches "we moved the encoding but didn't remove the exposure" regressions, not just today's specific bug.
9. **Nonce/IV uniqueness.** Mint two tokens for two different (uid, email) pairs; assert their IV segments differ (guards against an accidental hardcoded/deterministic IV, which would break GCM's confidentiality guarantee silently).
10. **Logs stay redacted.** Mock `sendDigestEmail` to fail with an error message containing a fake address (e.g. `"only test-owner@example.test may receive test emails"`); spy on `console.error` for both `confirm-email/route.ts` and `send-test-email/route.ts`; assert the captured text contains `"[email]"` and does **not** contain `"@"` or `"example.test"`. (Already covered for these two routes by `send-failure.test.ts` — extend/confirm, don't re-derive.)
11. **Redirect query allow-list.** Every `profileRedirect(...)` call site's query string matches a fixed allow-list of keys (`digest_email_confirm`, `digest_email_confirmed`) and never contains `"@"` — a regression guard, not just a point-in-time check.
12. **If POLICY #4 says yes (fold in the adjacent leaks):** `dispatch-digests/route.ts` and `prepare-dashboards/route.ts`'s `emails_failed`/`failed` entries route through `classifySendFailure`/`describeSendFailureForLog` the same way the two EMAIL-SETTINGS routes already do; a mocked Resend failure containing a fake address never appears verbatim in the JSON response.

### Mutations a later A should run

- Delete/bypass the GCM auth-tag check on decrypt (make a tampered ciphertext decrypt "successfully" into garbage) → tests #2/#3 must go red.
- Skip the `exp` check after a successful decrypt → test #5 must go red.
- Revert one of the two log call sites to print `result.error` raw instead of the redacted description → test #10 must go red.
- In the legacy-fallback branch, skip the HMAC check entirely (treat any non-`"v2."` token as automatically valid) → test #7 must go red.
- Hardcode the IV instead of generating it per call → test #9 must go red.
- Add a stray `email`/`address` key to any `profileRedirect` query string → test #11 must go red.

---

## 5. POLICY — manager decides

1. **Option A vs Option B.** B recommends A (no-migration deployability; can still honor already-sent links; this project's migrations have a demonstrated multi-day-unapplied track record — §1ah, EMAIL-SETTINGS-B F1). Confirm, or choose B and accept that every link already sent before deploy breaks outright.
2. **The §5 ledger row's own wording, "keep HMAC."** Does the manager want a literal second HMAC layer composed alongside encryption (encrypt-then-separately-sign), or is AES-256-GCM's built-in authentication tag — which provides the same tamper-evidence property in one audited primitive — sufficient? B recommends the latter: composing two hand-rolled crypto steps is more likely to be gotten subtly wrong than using one well-known AEAD construction. Confirm which was meant.
3. **Legacy-token grace window (Option A only).** Dual-format `verify()` for one full TTL (24h) after deploy, then delete the legacy branch in a follow-up cleanup — confirm the window, or accept immediate breakage of any in-flight link for simpler code.
4. **Fold the two adjacent leaks (P15–P18: `dispatch-digests`/`prepare-dashboards` returning Resend's raw, possibly address-bearing error text into a JSON response that a GitHub Actions job then prints to a now-public CI log) into this item's C now**, or file as a separate follow-up ledger row. B recommends now — the fix is small and mechanical (reuse the already-shipped `send-failure.ts`), and `dispatch-digests`'s cron is already live and running hourly against the now-public repo today, independent of whether the token fix ships.
5. **Replay-after-success can silently revert `digest_email`** to a stale, previously-superseded address if an old still-unexpired token is clicked again (pre-existing behaviour, found while covering "replay" per the task, not introduced by either option and not itself a URL/log issue). Neither option changes this by default. Option B could trivially also make confirmation single-use (clear the pending row after a successful write) as a side benefit if wanted — not proposed as in-scope for this fix unless the manager asks for it separately.
6. **Key-derivation method for Option A** — `crypto.hkdfSync` with an explicit context string (B's recommendation; verify runtime availability first per `web/AGENTS.md`'s standing instruction to check this Next version's actual docs) vs. a plain `sha256(secret)` (simpler, marginally less rigorous, not insecure here given the secret's entropy). Confirm which.
7. **Ciphertext-length side channel** (Option A; very low severity — token length weakly correlates with email length). B recommends accepting as-is; confirm, or ask for fixed-length padding.

---

## 6. What this guide is not

No production code was changed. No live call was made. No migration was applied or drafted as SQL to run — Option B's migration above is illustrative for the POLICY decision, not a file to apply. No `.env*` file was opened; no secret or real address appears anywhere in this document (`DIGEST_EMAIL_CONFIRM_SECRET` is named only as a variable name, never a value; example addresses are all `@example.test`).
