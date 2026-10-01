# EMAIL-TOKEN-REPLAY — B investigation

STATUS: COMPLETE

Item: ABC-JEV-INTEGRATION.md §1as point 4 (deferred as LOW from EMAIL-TOKEN-PRIVACY, guide
docs/jev-abc/EMAIL-TOKEN-PRIVACY-B-20260928T220245Z.md). A digest-address confirmation token issued
BEFORE the reader changed their digest address still confirms when clicked later. Example: reader types
address A, gets a confirmation link, then types address B and confirms B. Later someone clicks the old A
link. Does A become the active address again?

Proposed rule at the time (§1as.4): "reject a token issued before the profile's last digest-address
change."

Role: B — investigator. Read-only on product code; nothing under `web/` was created or edited. Scratch
proof scripts live at `<scratchpad>/probe-import.mjs` and `<scratchpad>/replay-proof.mjs` (session
scratchpad only; never committed, never referenced by product code).

## Reads completed

ABC-JEV-INTEGRATION.md §0–§3 (resume protocol, manager playbook, roles, engineering contract, frozen
acceptance inventory); §1as (EMAIL-TOKEN-PRIVACY — root cause, AES-256-GCM "v2." token design, no dual
legacy-format fallback); §1z (EMAIL-SETTINGS — token TTL/re-use/rate-limit rulings); §1al
(POLISH-1-EMAIL — send-failure copy, unrelated to replay but same files); §1bm (EMAIL-DEST-UX — address
states and destination-sentence copy, already shipped at HEAD); `web/AGENTS.md`. Source:
`web/src/lib/email/confirm-token.ts`, `web/src/app/api/profile/confirm-email/route.ts`,
`web/src/app/api/profile/route.ts` (PUT guard), `web/src/lib/usage/counters.ts` +
`web/supabase/migrations/20260904000000_usage_counters.sql`, `web/supabase/schema.sql` (profiles table +
`touch_updated_at` trigger), `web/src/app/profile/page.tsx` (EmailSettings section, confirm-flow
`useEffect`s), `web/src/lib/email/confirm-token.test.ts` (existing test conventions).

---

## Task 1 — the path, every way an old token still takes effect

### 1.1 Mint → email → click → check → write

**Mint (`POST /api/profile/confirm-email`, `web/src/app/api/profile/confirm-email/route.ts:118-226`).**
Signed-in only (:123-125). Body's `email` is trimmed/lowercased/format-checked (:133-140,
`normalizeEmailAddress`/`isValidEmailFormat` from confirm-token.ts:56-74). The current stored
`digest_email` is read once (`currentDigestEmail`, :93-104, used only here — the GET/click side never
reads it). **Short-circuit (:149-157):** if the candidate equals the account's OAuth email OR the
already-stored `digest_email`, the row is written immediately (`writeConfirmedDigestEmail`, :106-116) —
no token, no email sent. Otherwise: the confirm secret must be configured (:160-171), a 5/day counter is
charged (:173-184, fails closed), then `signConfirmToken(secret, user.id, candidate, now)` mints the token
(:186) and it is emailed inside a confirmation link (:187-200).

**Token contents (`web/src/lib/email/confirm-token.ts:76-150`).** The payload is exactly
`{ uid, email, exp }` (interface at :76-80) — normalized email, unix-seconds expiry `now + 24h`
(`CONFIRM_TOKEN_TTL_MS`, :51). **No issued-at claim, no "what was the address before this request" claim,
no request/session identifier.** It is AES-256-GCM-encrypted (key = HKDF-SHA256 of
`DIGEST_EMAIL_CONFIRM_SECRET`, fixed label `"peer:digest-email-confirm:v2"`, :91,104-113) with a fresh
random IV per call (:141), so two tokens for the same input still differ byte-for-byte, but the GCM tag is
the *only* integrity check — it proves the token wasn't tampered with, not that it is still the "current"
request. **`verifyConfirmToken` (:177-232) is a pure function of `(secret, token, now)`.** It cannot know
anything about the database — by construction it can only check shape, decrypt/auth, and `exp`. Proven in
§1.3 below: this is why the fix cannot live inside this file alone.

**Click (`GET /api/profile/confirm-email`, route.ts:228-267).** Requires a signed-in session
(:232-239 — no session ⇒ redirect `signin_required`, nothing written; this is not a bare anonymous
webhook, see Task 2). Token missing ⇒ `invalid_link` (:241-243). Secret unset ⇒ `unavailable` (:245-248).
`verifyConfirmToken` result not `ok` (malformed/tampered/expired all collapse to one outcome) ⇒
`invalid_link` (:250-255). **`result.uid !== user.id` ⇒ `wrong_account`, and critically the signed-in
user's own `digest_email` is left untouched (:256-260)** — this check is real and correctly scoped; it is
not part of the gap.

**What it writes.** Immediately after the uid check, with nothing in between:
`writeConfirmedDigestEmail(supabase, user.id, result.email)` (:262) — an unconditional upsert
(:106-116) of whatever address the token names. **There is no read of the row's current `digest_email`
anywhere in the GET handler, and no comparison of any kind, before this write.** That absence, not a
bug in the crypto, is the entire defect.

### 1.2 How the profile stores the digest address, and whether anything records "when it last changed"

`profiles.digest_email` is a plain nullable `text` column (`web/supabase/schema.sql:136`, added by an
`alter table` block). The only timestamp on the row is the table-wide `updated_at`
(`schema.sql:18-20`), kept current by a trigger that fires **on any column update whatsoever**
(`touch_updated_at`, `schema.sql:23-35` — display name, research topics, color theme, anything). **It is
not specific to `digest_email` and cannot be used as "when the digest address last changed" without
false-triggering on unrelated edits.** There is no `pending_digest_email` column, no
`digest_email_changed_at` column, no "request id" of any kind. The client-side `pendingAddress` React
state in the Profile page (`web/src/app/profile/page.tsx:1605`, set at :1716 after a successful POST,
cleared at :1654/:1697/:1714/:1721) is **the only place "what's currently pending" is tracked at all, and
it lives only in one browser tab's memory** — it is never sent to, or checked by, the GET handler; a
reload, a different device, or clicking a link that lands in a different tab all lose it. In short: the
whole confirm flow is deliberately stateless server-side (consistent with the EMAIL-SETTINGS and
EMAIL-TOKEN-PRIVACY guides both noting "no schema change" as a design goal) — which is exactly why an old
token has nothing to check itself against.

### 1.3 Every way an old token still takes effect (proven by execution, not just read)

Executed in `<scratchpad>/replay-proof.mjs`, which imports the REAL `confirm-token.ts` directly (Node 24
type-stripped `.ts` import, no compilation step, no product file touched) for every crypto/verify claim,
and — because route.ts's decision logic is inline in a Next.js route handler entangled with a Supabase
client and isn't itself an importable pure function — **ports** that decision logic line-for-line
(`currentRouteDecision_PORT`, mirroring route.ts:228-267 exactly, cited inline in the script) into a plain
function over an in-memory object standing in for the `profiles` row. One hardcoded, obviously-fake
secret (`"scratch-only-fake-secret-do-not-reuse-9f3e"`); no network; no real key. 17/17 checks passed on
the second run (first run had one wrong test *expectation*, corrected in the script itself — see its
inline comment — not a code fix). Full output is reproduced below; re-run with
`node "<scratchpad>/replay-proof.mjs"` from `<scratchpad>/`.

1. **A later token for a different address (the exact scenario in the item).** Mint token for
   `reader-a@example.test` at t0, mint token for `reader-b@example.test` at t0+5min (address still unset
   at both mints). Confirm B first (succeeds, store = B). Click the *old* A token at t0+10min (well inside
   the 24h TTL) → **store silently reverts to A.** Reproduced:
   `store.digest_email after the OLD A link is clicked: a@example.invalid` (script output; the script uses
   `.invalid`-suffixed addresses, equally a non-personal reserved domain — see the note at the end of this
   section on the guide's own prose using `.test` instead).
2. **The account-email short-circuit.** Mint a token for a new address at t0. Before it's clicked, the
   reader falls back to their account email via the short-circuit (route.ts:151, no token involved at
   all — a direct write). Click the old token afterward → **it silently undoes the short-circuit**,
   overwriting the account email back to the old address. Reproduced in the same run.
3. **An address changed back (implied by 1+2 composing):** any sequence of confirmed changes and
   short-circuits between mint and click is irrelevant to the check — because there is no check. The
   *only* thing that stops an old token is its own 24h expiry.
4. **Expiry** — genuinely already correct, not part of the gap. `verifyConfirmToken` rejects 1s after
   `exp`, accepts 1s before it (proven against the real module, both branches). This is the *sole*
   existing bound on the replay window: at most 24h from each individual mint, not 24h from "the last
   real change," and every outstanding token gets its own independent 24h clock.
5. **wrong_account is not part of the gap either** — proven separately: a token minted for one uid is
   refused for a different signed-in uid, and (per the code read in §1.1) that path never touches the
   signed-in user's own row.

Section 3 of the script also builds and executes a **ported prototype of the recommended fix** (extended
payload, same AES-256-GCM/HKDF primitives, no product file touched) and proves it closes cases 1 and 2
above while leaving legitimate re-use, ordinary single confirmation, and re-requesting a superseded
address all working, plus that the new claim is tamper-protected the same way the existing ones are. Full
results carried into Task 3.

Note on addresses used above: the *script* uses `@example.invalid`; this *document*'s prose below uses
`@example.test` per this task's own convention — both are non-personal, reserved-for-documentation
domains (RFC 2606/6761), never a real address.

---

## Task 2 — is this a real risk, and how serious

**Who can make an old link fire.** Two things both have to be true at once: (a) someone opens the old
confirmation email — i.e. has access to the abandoned inbox — **within 24 hours of that specific request**
(not 24 hours after the address was last changed; each mint gets its own clock, so in practice this is
almost always "the same day," since a reader who requests A then B minutes or hours apart has both tokens
alive simultaneously); and (b) the browser that opens the link is **signed in to Peer as that same
account** (route.ts:232-239 redirects to a "sign in, then open the link again" page and writes nothing
otherwise — this is not an anonymous webhook a bot or a mail-security link-scanner can trigger, since
those don't carry the reader's session cookie).

That second condition matters: it rules out the scariest version of this (a stranger who merely gained
read access to an old inbox, with no Peer session, silently flipping someone else's live setting from
outside). What is left is narrower but still real and plausible without any malicious actor at all:

- **Most likely case — self-inflicted.** The reader requests A, doesn't click it, changes their mind
  minutes or hours later and confirms B instead. Later the same day they clean out their inbox (or a
  delayed mail sync finally shows the message, or they simply click the wrong one of two similar-looking
  "Confirm your Peer digest email" messages) and open the old A link — while still signed in, which for a
  personal daily-digest product most readers normally are. Their digest silently goes back to an address
  they had just deliberately moved away from, with **no error, no warning** — the GET handler redirects to
  the exact same `digest_email_confirmed=1` success flag either way (route.ts:266), and the Profile page
  shows the exact same "Confirmed — daily emails will go to …" banner for a stale click as for a fresh one
  (`page.tsx:1651-1654,1563-1567` — it just re-fetches the profile and displays whatever is now stored;
  it has no way to know the click was stale).
- **Narrower, still real case — a shared inbox and a shared/remembered sign-in.** Two people with access
  to the same inbox (a shared family or lab address, a forwarded work alias) where one of them is also
  signed in to the account's Peer session on a shared or unlocked device (e.g. roommates, a lab computer).

**What harm results.** The digest — including whatever the reader typed as their current project and
research interests, since that is exactly what the daily email contains — starts going to an address the
reader had explicitly tried to stop using, silently, with a UI that actively tells them the opposite
("Confirmed — daily emails will go to X" where X is now wrong again). No password, payment, or account
takeover is possible through this path; it is a content-delivery-destination bug, not an
authentication bypass — the attacker (self or other) still needs the account's own signed-in session to
trigger it, and they only get to choose from addresses the account owner themselves previously typed and
requested a link for (never an arbitrary attacker-chosen address, since minting always requires the
attacker to already be signed in as the account, in which case they could simply set the address directly
and would not need this bug at all).

**Plainly:** this is a real, easily-reproduced bug (17/17 execution checks above), but it is **low
severity, not a security breach in the account-takeover or data-exfiltration-to-a-stranger sense** — the
worst realistic outcome is a reader's own daily paper digest quietly going back to an inbox they meant to
retire, for up to 24 hours after each request, until they notice or request a fresh link. It matches the
LOW label the item already carried when deferred at §1as.4. The one thing worth upgrading in that
assessment: because the success UI is *indistinguishable* from a normal confirmation, a reader has no way
to notice this happened except by independently checking which address mail is actually arriving at —
that silence is the main reason to still fix it, not the severity of any single occurrence.

---

## Task 3 — options

All four are evaluated against the exact scenarios proven in Task 1.3. "DB change" means a Supabase
migration the user has to run as their own SQL step, per this project's standing rule that only the user
runs migrations.

### Option (a) — bind the token to the pending address (as literally proposed)

Store "the one pending request" server-side (e.g. new columns `profiles.pending_digest_email` +
something to disambiguate repeat requests for the same address) at mint; at click, reject unless the
token's address still equals that stored pending value; clear it on success.

- **What the reader sees:** an old or superseded link lands on an honest "that request is no longer
  pending — request a new link" message. Because "pending" would be cleared/replaced the moment *any*
  newer request is made (not only once one is *confirmed*), this is actually **stricter** than the item
  asks for: request A, then request B without ever clicking either — under a literal reading, A's link
  would already be dead the instant B was requested, not just once B is confirmed.
- **DB change:** **yes** — new column(s) on `profiles`, a migration, the user's SQL step.
- **Cost:** moderate-high. New write in POST (store pending state), new read+compare+clear in GET,
  more states to reason about and test (concurrent requests from two tabs, repeat requests for the same
  address), and it moves away from this flow's deliberately stateless design (EMAIL-SETTINGS and
  EMAIL-TOKEN-PRIVACY guides both called out "no schema change" as a goal).

### Option (b) — record "digest address last changed at," reject tokens issued before it

New `profiles.digest_email_changed_at timestamptz`, set (not by the generic `updated_at` trigger — proven
in 1.2 that it's shared by every field) at each of the three places `digest_email` can change: the GET
write (route.ts:262), the POST short-circuit write (route.ts:152), and the PUT echo-write/clear
(`web/src/app/api/profile/route.ts:296-327`). The token would also need an explicit issued-at claim added
to its payload (today's payload only has `exp`; deriving "issued at" as `exp − 24h` works only as long as
the TTL parameter is never varied per call, which is true today but is an implicit, easy-to-break
assumption worth not relying on).

- **What the reader sees:** same honest "your settings changed since that link was sent — request a new
  one" message, but only once a change has actually *completed* — matches the item's originally-proposed
  rule almost exactly.
- **DB change:** **yes** — one new column, a migration, the user's SQL step.
- **Cost:** moderate. One migration + three call sites updated to set it + one payload field added.
  Side benefit beyond this bug: a real "changed at" timestamp could later be surfaced in the UI (e.g.
  "confirmed 3 days ago") — a legitimate reason to pick this option despite the migration if that is
  independently wanted.

### Option (c) — a per-user token version/nonce stored with the pending request

A counter, bumped every time `digest_email` changes, embedded in the token at mint and compared at
verify. **Can be built on the existing `usage_counters` table with no new migration**: it is already a
generic `{key text primary key, value bigint, window_ends_at, updated_at}` store
(`web/supabase/migrations/20260904000000_usage_counters.sql:22-27`) with an atomic
`increment_usage_counter` RPC (:58-77) the codebase already calls from `CounterStore.increment`
(`web/src/lib/usage/counters.ts:70-89`) for unrelated rate limits. A new key pattern like
`digest_confirm_version:<uid>` would just be more rows in a table that already exists — no CREATE TABLE,
no ALTER TABLE.

- **What the reader sees:** same honest stale-link message as (b), once the version has moved.
- **DB change:** **no new table/column**, but it does reuse an unrelated-purpose table (a rate-limit
  counter store) for a security-invalidation nonce — workable, but a repurposing worth naming plainly to
  whoever reviews it.
- **Cost:** moderate. Needs a bump call at the same three write sites as Option (b) (same
  easy-to-forget-a-fourth-site risk — nothing about the design makes a future new write path automatically
  covered), plus one extra store round trip at mint and one at verify. `CounterStore`'s existing interface
  (`increment`/`read`, both already used for numbers) fits a version number without new methods.

### Option (d) — RECOMMENDED: snapshot the address the profile held at mint time, inside the token itself; compare against the live value at verify time

Add one claim to the encrypted payload, `priorEmail` — the `digest_email` the profile held **at the
moment this specific token was minted** (already fetched in POST via `currentDigestEmail`, route.ts:93-104
— so this costs nothing extra at mint). At verify (GET), read the row's *current* `digest_email` (one new
read, symmetric to the one POST already does) and allow the write only if
`current === priorEmail` (nothing has changed since this token was minted) **or**
`current === token's own target address` (this exact token already applied — keeps the existing, deliberate
re-use/idempotence property that mail-gateway link-prefetching depends on, confirm-token.ts:172-175 —
proven preserved in §1.3/script section 3). Anything else (some *other* change happened in between,
confirmed or via the short-circuit) is rejected as stale.

This is functionally what Option (a) asks for ("only the currently-relevant request may confirm"),
achieved by reading the one column that is already the authority on "what's current" instead of building
and maintaining a second, parallel piece of state that has to be kept in sync with it by hand at every
write site.

- **What the reader sees:** an old, superseded link lands on a new, honest outcome — proposed flag
  `digest_email_confirm=stale_link`, proposed copy in the same voice as the existing message map
  (`page.tsx:1660-1665`): *"Your email settings changed since that link was sent. Request a new
  confirmation link."* (exact wording is C's to finalize, per the same "page owns the sentence" pattern
  already used for this file's other outcomes).
- **DB change:** **no.** No new table, no new column, no repurposing of an unrelated table.
- **Cost:** low. One new field in an already-small JSON payload that is already accepted at its current
  size (§1as point 5: "ciphertext length: accepted"); one new read in the GET handler; the comparison
  itself is a few lines. No new write-site bookkeeping to maintain — because it reads the live column
  directly, a hypothetical *fourth* future place that changes `digest_email` is automatically covered with
  no extra code, unlike (b)/(c) where a forgotten bump silently reopens the hole for that one path.
- **Proven by execution** (§1.3, script section 3, 17/17 checks): closes both reproduced replay scenarios,
  keeps legitimate same-token re-use working, keeps ordinary single confirmation working, keeps
  re-requesting a previously-superseded address working (a fresh token snapshots the then-current value),
  and the new claim is exactly as tamper-protected as `uid`/`email`/`exp` today (same GCM tag covers the
  whole payload — proven by a bit-flip test).
- **One real transition cost to flag, not a security gap:** this changes the token's JSON shape (adds a
  required field). Any token already in a reader's inbox, minted by the *current* code before this fix
  ships, decrypts fine (same AES-256-GCM/HKDF, same "v2." prefix — proposed here to stay the *same*
  prefix, not bump it) but its plaintext won't have `priorEmail`. The implementer must decide, and this is
  the one open call for the manager: treat a missing/wrong-shaped `priorEmail` as **malformed** (same
  strict-shape discipline `verifyConfirmToken` already applies to `uid`/`email`/`exp`,
  confirm-token.ts:217-225) so any such in-flight token lands on the ordinary honest "invalid/expired,
  request a new one" outcome — never a crash, never a silent bypass of the new check. This mirrors exactly
  how EMAIL-TOKEN-PRIVACY itself handled its own format change (§1as point 2: "no dual-format fallback...
  a legacy link lands on the same honest outcome as any other bad token"), and the exposure window is at
  most the 24h TTL of whatever was already in flight at deploy time.

**Recommendation: Option (d).** It closes the exact hole proven in Task 1.3, needs no migration, costs the
least, and — unlike (b)/(c) — has no per-write-site bookkeeping that a future change could silently forget
to update. Pick (b) instead only if the team independently wants a queryable "digest address last changed"
timestamp in the UI for its own sake; that is a real, separate reason, not a reason tied to closing this
hole.

---

## Task 4 — tests and POLICY list

### Tests the fix needs

Pure token-level (extend `web/src/lib/email/confirm-token.test.ts`'s existing style — see
`<scratchpad>/replay-proof.mjs` §3 for working reference implementations of every case below, already
green):

1. A token's `priorEmail` round-trips through sign/verify like `uid`/`email` do today.
2. A token minted while `digest_email` was empty carries `priorEmail: ""` (or equivalent "never set"
   sentinel — implementer's choice, tested either way).
3. Tamper on the `priorEmail` region of the ciphertext is caught the same way as today's existing
   IV/tag/ciphertext tamper tests (reuse the existing pattern at confirm-token.test.ts:167-198).
4. A token minted before this fix ships (no `priorEmail` in the decrypted JSON) is rejected as
   `malformed` — not a crash, not a silent accept (this is the POLICY item below, once ruled).

Route-level (extend `web/src/app/api/profile/confirm-email/route.test.ts` with a mocked Supabase, the
existing convention in that file):

5. **The exact item scenario:** mint for A, mint for B (address unset before both), confirm B, then click
   A → `stale_link`, `digest_email` still B. (Mutation: delete the new comparison → this test goes red and
   the old A click succeeds instead — proves the test actually exercises the guard, not just its absence.)
6. **The account-email short-circuit variant:** mint for A, short-circuit to the account email, click A →
   `stale_link`, `digest_email` still the account email.
7. Re-use: click the same still-valid token twice → both succeed, second is a no-op write of the same
   value (proves the fix does not regress the deliberate mail-gateway-prefetch re-use property).
8. Ordinary case: one outstanding token, nothing else happened, click it → succeeds (no false positives
   from the new check).
9. Re-request after supersession: mint A, mint B, confirm B, re-request A (fresh token, new `priorEmail`
   snapshot = B), click the fresh A token → succeeds; the *original*, now-doubly-stale A token still
   correctly resolves only as an idempotent no-op if its target already equals the live value, and is
   rejected the moment a third address supersedes it (both sub-cases in the script, section 3).
10. `wrong_account` and `expired` continue to short-circuit *before* the new check ever runs (order
    matters: uid check, then expiry, already covered by existing tests — add one asserting a token that is
    BOTH expired AND would-be-stale still reports `expired`, not `stale_link`, so error precedence stays
    predictable).
11. Malformed/legacy-shaped token (§ point 4 above) → the existing generic `invalid_link` outcome, never a
    500, never a crash — proven with the same `encryptRawForTest`-style helper the existing test file
    already uses for shape-violation cases (confirm-token.test.ts:244-254).

### POLICY list for the manager

1. **Adopt Option (d)** (snapshot-and-compare inside the token, no migration) — or rule for (b)/(c) if a
   queryable "changed at" timestamp is independently wanted for the UI.
2. **New outcome name and copy** for the stale case — proposed `digest_email_confirm=stale_link` /
   *"Your email settings changed since that link was sent. Request a new confirmation link."* C finalizes
   exact wording in the existing message-map voice (page.tsx:1660-1665); A checks it's true in every
   state, per the same standard §1bm point 2 already set for this file's other sentences.
3. **In-flight tokens at deploy** (Task 3, Option (d)'s transition cost): confirm the ruling — missing/
   wrong-shaped `priorEmail` is treated as `malformed` (strict shape check, same discipline as the
   existing `uid`/`email`/`exp` checks), landing on the ordinary honest invalid/expired outcome. No dual-
   format fallback, consistent with the EMAIL-TOKEN-PRIVACY precedent (§1as point 2).
4. **Where the extra GET-time read lives:** `currentDigestEmail` (route.ts:93-104) is currently a
   module-private helper only called from POST; C should reuse/export it for GET rather than duplicate the
   query, so the two reads can't drift apart in shape.
5. **Scope confirmation:** `web/src/lib/email/confirm-token.ts` (payload shape, sign/verify),
   `web/src/app/api/profile/confirm-email/route.ts` (both handlers), their two test files. `PUT
   /api/profile`'s existing digest_email guard (route.ts:296-327) needs no logic change — it already only
   ever writes a value equal to the account email or the already-stored value — but is one of the three
   places "current digest_email" can move, so its write path is in-scope for the tests, not for a code
   change.
6. **Not this item (confirmed unaffected, no new work):** the 24h TTL itself, the 5/day request counter,
   the "no dual legacy format" rule, and the wrong_account check — all read and proven correct as-is in
   Task 1.

---

## Execution log (for the record)

- `<scratchpad>/probe-import.mjs` — capability probe: Node 24.19.0 imports
  `web/src/lib/email/confirm-token.ts` directly via a `pathToFileURL` + dynamic `import()` (a bare
  drive-letter path is not a valid ESM specifier on Windows — first attempt failed with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` and was corrected this way). No product file modified.
- `<scratchpad>/replay-proof.mjs` — the full proof described in Task 1.3/Task 3. Final run: **17 passed, 0
  failed.** (First run: 16/17 — one test's *expectation* was wrong, not the fix; corrected in-script with
  the reasoning left in a comment, per the "prove by execution" requirement rather than asserting the fix
  works without having actually run it both ways.)
- No email sent, no call to peer.homes or any dev server, no real secret read or used anywhere (one
  hardcoded, obviously-fake string in both scripts), `web/.env` and `web/.env.local` never opened.
