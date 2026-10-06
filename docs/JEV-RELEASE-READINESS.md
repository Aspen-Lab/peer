# Jev / retrieval campaign — release readiness

**What this document is:** a plain-language explanation of where this project stands,
followed by a precise technical appendix for whoever does the actual switching-on work.

**What this document is not:** proof that anything has been tested with real users, or
that Peer's actual product has been tested with real data. One narrow exception happened
this round: a bounded, budget-capped test that called two outside paper-search services
directly, for comparison only, never through the product itself and never seen by any
real user (see "What has NOT been tested live" below for exactly what it found).
Everything else in this document — every other number, every "it works," and every other
test result — still comes from offline checks only: code read carefully, and run against
fake or recorded data, never real product traffic. Anywhere this document says something
passed a check, it means "passed an offline check," never "proven in the real world,"
unless that one exception is named explicitly.

---

## Part 1 — Plain language

### The big picture

This project is adding a set of new abilities to Peer: better ways to find papers,
a smarter (but paid) AI reviewer called Jev that double-checks whether a paper really
matches what you're working on, a memory system so the dashboard never shows you the
same paper twice, and a way to catch up on papers you missed if you didn't check in for
a few days.

None of this is turned on yet. Every new ability sits behind its own on/off switch,
and every switch defaults to off — meaning Peer behaves exactly as it does today unless
someone deliberately flips a switch. This is deliberate and it is the whole safety
strategy: nothing changes by accident, and anything that does get switched on can be
switched back off without losing anything important.

Think of it like renovating a house room by room while people still live in it. Each
room gets finished, checked, and only then does someone turn the lights on in that room.
Nobody turns on every light in the house at once.

### What changed since the last version of this document

Two big things happened since this document was last written.

**This branch now includes all of Peer's newest work from the main line of
development.** Nothing was lost in the process — a careful, independent check re-read
every rule this project depends on after joining the two together, and confirmed all of
them still hold. Joining the two together also meant the first decision below ("who pays
for AI calls") got made: Peer's own infrastructure now covers some AI costs, the same
way the rest of Peer already works. What that costs and risks is explained under that
decision below.

**A spending limit for Peer's own AI use has now been built.** When the two lines of work
were joined together, Peer's built-in AI started covering more of its own costs — good for
you, but it meant there was no overall dollar ceiling on that spending, only a couple of
narrower limits on specific expensive features. That gap is now closed: Peer can now be
told "never spend more than this many dollars in one day," with one limit for everybody
combined and a smaller one for each person, both resetting every night. It is careful about
running out of money by accident — if it ever can't tell how much has been spent so far, it
stops spending rather than guessing and risking a surprise bill. It also needs one more
piece of information before it can actually enforce anything: roughly how much each AI
model it can use actually costs, entered by hand in a simple table. Until that table has at
least some numbers in it, this whole safety feature simply refuses to let the built-in AI
run at all — which is the safe direction to fail in, but worth knowing, since it means this
feature isn't truly "on" until both the switch AND the price table are set up. This new
limit is switched off by default, like every other new ability in this project, and the two
starting dollar amounts are conservative placeholders — you get the final say on the real
numbers before this is relied on for real use.

**A real bug slipped through, and a person caught it — not an automated check.** Right
after joining the two lines of work together, someone opened Peer and looked at the
sample paper list on the home screen, and saw the same paper listed twice — three
separate times, in a list of only ten papers. The cause: some papers are hosted in more
than one place online, and each hosting site hands that paper its own tracking number,
so the system was treating each copy as a totally different paper.

A first fix was written, but it turned out to be too broad — checked by a second,
independent person, it would also have merged some genuinely different papers together
in rare cases. A second, narrower fix went back to comparing tracking numbers, but only
to catch those rare cases, not to block the normal one. It passed its own tests, but the
same kind of second, independent check found a gap anyway: comparing tracking numbers
only works when both papers involved actually have one of the same kind. A paper with no
tracking number at all — which is common, since "no tracking number" is exactly why the
system has to fall back to matching by title and author in the first place — slipped
straight through that gap, and the original mistake could still happen in a new shape.

Two rounds of fixing the same spot and finding a new version of the same problem is this
project's own signal to stop patching and change approach. So a third fix took a
different angle entirely: instead of ever comparing tracking numbers, it now requires
every paper in a suspected group to be checked directly against every OTHER paper in
that group — not just its nearest neighbor — before they're allowed to combine into one.
If even one of those direct checks fails, the whole group stays separate. This closes
the gap without needing a tracking number at all, and it passes its own tests. This
time, the same kind of second, independent check did happen: a different checker built
more than forty fresh test cases of their own, covering shapes of the problem nobody
had tried before, and every single one came back correct. A separate, whole-project
re-check of the finished result, run through the real system rather than a list of
test cases, also confirmed the original three-copies-of-one-paper mistake is gone.

Two honest limits are worth knowing, both accepted on purpose rather than left as
undiscovered bugs. First, a small group of papers where the checks don't all connect
to each other directly is now shown as separate entries rather than guessed into one —
better to show a few too many than to hide one that turns out to be genuinely
different. Second, two truly different papers by the same author, with the exact same
long title, published back to back in two calendar years, can still merge into one;
this is considered rare and low-stakes enough to accept rather than chase further.

**Jev's password changed rooms.** Earlier in this project, the plan was to keep the
smarter AI reviewer's password in its own separate hidden room (a small side service),
away from Peer's main house, as an extra layer of caution. You later decided that was
more setup than it was worth for what it bought: Jev's password now lives in the same
online lockbox (Vercel) as every other AI helper's password, and Peer asks Jev directly
instead of going through that side service. The side service's code is left standing,
switched off, in case it's ever wanted again later — nothing about it was torn out. The
daily spending limits on Jev are exactly the same as before; this change only affects
where the password is kept and how directly Peer reaches Jev, not how much it can spend.

**You can now sign in with Google, not just GitHub.** A second button sits next to the
existing one, wherever signing in already happened. If the email address on your GitHub
account is the same as the one on your Google account, the two are treated as exactly
the same person the moment you use the new button — one saved profile, one reading
history, one set of email settings, automatically, with nothing for you to turn on. If
the two addresses are genuinely different, signing in with the other one today starts a
second, separate account rather than joining the first one — there is no button yet that
lets you say "these are both me" after the fact, and building one is a known, separate
piece of future work, not something this round tried to solve. A one-time setup (a few
minutes, in Google's and your database provider's own dashboards, never inside this
project's own files) is needed before the new button works at all, and a short walk-
through for it, plus the one quick check you can do yourself to confirm the "same person,
one account" behavior actually holds for your own two accounts, was written alongside
this round's other notes.

**Signing in used to silently lose what was already on your device — that is fixed, and
a way to bring back an old backup now exists.** Until now, the very first time someone
signed in, whatever they had already typed into their profile — research interests,
current project, and more — could fail to reach their account at all, and in some cases
could be replaced by whatever the account already held, even if that was nothing. Two
separate causes were found and closed. First, one technical gap meant every save to at
least one real account was silently failing, so nothing that person set ever reached
their profile at all; that is now fixed, though one more small step on the database
side (already asked for) is needed before every field saves with full fidelity. Second,
and for everyone going forward: the moment of signing in now genuinely combines what is
on this device with whatever the account already holds, rather than letting either one
silently overwrite the other. Research topics and saved papers from both sides are kept,
never dropped; if a plain setting like your name or school disagrees between the two,
whichever this device currently shows wins, once, right at sign-in, and ordinary syncing
continues normally after that. Saved papers and reading history now follow the same
"never silently drop something" rule on every sign-in and every sync afterward, not only
the first one. If a save to your account ever fails after that — a connection hiccup,
for instance — you are now told so, in plain words, on your profile page, instead of the
failure staying invisible; nothing on your own device is lost either way while that gets
sorted out. Separately, a quiet "Restore from a backup file" control now sits on the
profile page, for anyone holding an old exported copy of their profile: it brings back
what that file contains without erasing anything added since, and it never uploads a
small number of old, no-longer-used outside-service passwords the file might still
contain.

### What's safe today

Every switch, when off, leaves Peer working exactly like it does right now — this has
been checked for each one individually. A few storage changes (new places to keep data)
have been written and carefully read over, but none of them have actually been applied
to the real database yet. Turning on a storage change is always a separate, deliberate
step from turning on the feature that uses it.

The one place a specific order is already spelled out is the "don't show me the same
paper twice" memory: the storage for it has to be turned on first, and only afterward
does the on/off switch for actually using it get flipped. For every other switch, no one
has written down a required order yet — this document proposes a reasonable one, but you
get the final say on the order when the time comes.

### What needs your decision

When this document was last written, one of six original choices had been made. Since
then, three more got decided (3, 5, and a brand-new one this document calls 7, which
surfaced while researching one of the others and which you then told us to go ahead and
build). That makes four decided out of seven tracked choices, with three still waiting on
you. None of the open ones are technical — they're about risk, cost, and privacy
trade-offs that only you can weigh:

1. **Who pays for AI calls, and how — NOW DECIDED.** You chose to let Peer's own
   infrastructure cover some AI costs under a new shared spending limit, the same way
   the rest of Peer already works, rather than keep the older, stricter rule. What this
   buys you: a few abilities that would otherwise have quietly turned off stay on. What
   it cost, until now: that shared spending limit only actually put a ceiling on two
   specific expensive actions — a full in-depth report, and a costly full rebuild of
   your results. Everything else that calls on an AI — a quick re-ranking of your
   papers, a short summary, a background double-check — was watched and written down, but
   had no overall dollar limit or call-count ceiling of its own. That was the
   single biggest open cost risk in Peer. **It now has a fix, built but not yet turned
   on** (see "What changed" above): an overall daily dollar ceiling that covers every one
   of those AI actions, not just the two big ones, with one number for everybody combined
   and a smaller number per person. Two things about it still need you specifically,
   separate from the "who pays" choice you already made: first, the two starting dollar
   amounts are placeholders — reasonable but not yet checked against what you're actually
   comfortable spending, so confirm or change them before this is relied on for real use;
   second, like every other switch in this document, turning it on is your call, not
   something built automatically because it exists. This same original choice also
   decides whether a backup AI opinion — one that only ever runs quietly in the
   background, never something you see directly — can ever switch on at all, since it's
   built to only spend Peer's own money, never yours; making that part actually able to
   run still needs its own separate wiring work first, including giving it a spending
   limit of its own before it may ever be turned on.
2. **Should email and the in-app dashboard share one "already shown" memory**, or stay
   fully separate, as they do today? Right now if a paper shows up in your email, it can
   still show up on the dashboard too.
3. **Who or what is allowed to trigger the scheduled email digest** (and also a
   "get things ready a bit before you check in" helper, which has now actually been
   built and tested — it just isn't switched on) **on a timer — NOW DECIDED.** You
   already answered this one: the same once-an-hour automatic check that already sends
   the scheduled digest now also runs the "get ready ahead of time" helper and the retry
   described in decision 5 below, as extra steps of that same timer — nothing new to
   schedule separately. A second, independent pass re-checked the work this round and
   confirmed it does what it claims. Three things worth knowing about what that means in
   practice, in plain terms: first, **nothing new runs yet** — this only takes effect
   once the change itself has been looked over and turned on for real, which is still a
   separate yes from you, on top of two more switches (both off by default) that must
   both be turned on before the new helper does anything at all; second, **the clock it
   uses is the world clock, not yours** — until some screen lets a person set their own
   time zone, "shortly before you check in" is worked out as if every single account
   checks in at eight in the morning, world standard time, because that is the one
   time-related number every account actually has today; third, it is built so it can
   never get a day's result ready twice over for the same person — repeating the timer
   early or overlapping two runs by accident costs nothing and breaks nothing. (What the
   EXISTING, already-running hourly check does TODAY, before any of this new helper is
   switched on, is a separate and rather surprising story — see the new note right after
   decision 7 below.)
4. **How much real, paid use of outside search and AI services to authorize**, and for
   what scope, still needs your answer — the one-off comparison test described below
   does not count as that authorization; it was a separate, narrower, already-approved
   exception. **One small piece of this question got answered as a side effect of that
   test, though: one specific paper-search service (OpenAlex) does still work without
   paying for a key** — the test used the free, no-key option throughout, and every
   request it made was accepted; some individual searches still failed to respond in
   time (see below), but never because a key was missing.
5. **Whether a failed digest email should be automatically retried later — NOW DECIDED,
   folded into decision 3's answer above.** A safe, one-time-per-day retry now runs as
   one more step of the same once-an-hour timer described in decision 3, behind its own
   separate switch that is also off by default. Worth knowing plainly: today this piece
   would find nothing to do, for a specific reason explained in full right after decision
   7 below — in short, nobody can turn email delivery on for their own account from the
   app at all right now, so there are no failed emails anywhere waiting to be retried.
   This is ready for the day email delivery itself comes back; it changes nothing about
   email today.
6. **Who reviews and labels the ~200 test papers** used to measure whether the new
   ranking is actually better (a separate, much larger batch than the 40-paper sample
   mentioned below). The rule is: two people who did not write any of Peer's search or
   ranking code, working independently, plus a named tie-breaker for when they disagree.
   We need you to say who those three people are.
7. **Bring back the on-screen controls for email — NOW DECIDED, and built this round.**
   You said yes: build the screen. It's done, pending one more independent check before
   anyone actually uses it. Turning it on, and picking a send time, a time zone, and an
   address, was possible once, then deliberately taken away; it is possible again now,
   the same way it worked before. **Nothing changes for anyone until they personally
   switch it on** — every signed-in reader keeps getting today's quiet in-app update
   only, exactly as now, unless they visit their own profile page and flip their own
   switch. Four things worth knowing plainly:
   - **It is per person, not a company-wide switch.** Each reader decides for themselves,
     from their own profile page. Nobody is opted in by this.
   - **A brand-new "try it" button.** Before turning the daily email on for real, a
     reader can ask for one email right now, to see it land in their inbox. This is
     capped at three tries per person per day, and — a deliberate, cautious choice for a
     brand-new sending feature — if the day's cap were ever unreadable due to a hiccup on
     Peer's side, the button refuses rather than risking an unlimited number of emails
     going out. That is the opposite of how most limits in this app behave (they normally
     let you through rather than block you during a hiccup); this one specifically
     protects against runaway sending.
   - **Choosing a different address than the one you signed in with needs one extra
     step**, on purpose: a confirmation link is emailed to the new address first, and
     nothing is sent there until that link is opened. This stops someone from typing in a
     stranger's address by mistake, or on purpose, and having Peer email them. Your own
     sign-in address never needs this extra step.
   - **The once-a-day promise has an honest caveat, explained in full just below.**

   Sending a real email still needs two simple things set up on this project's side first:
   an account with an outside email-delivery service, and one address to send from. Until
   those are in place, every switch and every button above still works exactly as
   described, but any attempt to actually send says so honestly ("this isn't set up yet")
   instead of silently failing or pretending to have worked.

**What the existing, once-an-hour check already does today, and what "once a day" really
means now that email can be switched on — found while answering decision 3, worth knowing
in full.** Peer already runs an automatic check every hour, and this is not new — none of
the switches described above change it. On 2026-04-27, the on-screen control that let
someone turn their own email on, and choose when and where it went, was deliberately
removed from the app. The code that actually sends that email was not deleted — it was
left in place, switched off, ready to come back later, and decision 7 above is that
switch coming back. Today, that hourly check still quietly builds a fresh, personal daily
update for every signed-in reader by default, every morning at eight o'clock, world
standard time, unless a reader's own profile page says otherwise (which it now can, once
they visit it). For a reader who has not switched email on, that update still only sits
inside the app itself, under a "Past briefings" list on their profile page, exactly as
before.

For a reader who HAS switched email on: the normal, expected case is exactly one email a
day, at whatever hour they picked. The honest exception, worth stating plainly rather than
overselling the guarantee: the check that stops a second email going out the same day is,
today, a soft one — a look-back over the last few hours, not an ironclad lock. Under the
normal once-an-hour schedule this soft check is enough, and nobody sees a duplicate. But
if the automatic check were ever run again by hand on the same day, or if someone changed
their send time partway through a day that had already sent, a second email that same day
is possible, though never more than that — it can't spiral into many. Closing this
honestly-stated gap for good needs one specific, already-written database change to be
put in place and its own separate switch turned on; neither has happened yet, and both
remain this project's own next step, not something a reader needs to do anything about.

### What has NOT been tested live

Almost nothing, with one bounded exception this round. With your permission, a one-off
test made real calls to two of the outside paper-search services Peer plans to use —
Semantic Scholar and OpenAlex — purely to compare them against each other, side by side,
on the same handful of search topics. It cost under three cents, well inside the free
allowance both services offer, and it never touched Peer's actual product, any real
reader, or any of Peer's own data. Jev, the paid AI reviewer, was not part of this test —
it still has zero live calls, of any kind.

Here is what that one test found, in plain terms. First, the two search services barely
agree with each other: for the same search topic, they mostly return different papers,
not the same ones in a different order — so using only one of them, instead of both,
would mean missing a lot of what the other finds. Second, one particular way of searching
OpenAlex — a "meaning-based" search, rather than a plain keyword one — failed to respond
in time fairly often during this test; the plain keyword search on both services worked
every single time. Third, and most important: **this test cannot yet say which service
finds better, more relevant papers** — only that they find different ones. Answering that
needs a person to look at a shuffled, unlabeled sample of the results and judge them
without knowing which service found what, and that labeling has not happened yet; a
40-paper sample for exactly that purpose is ready and waiting on you.

Beyond that one test: no comparison between "old Peer" and "new Peer" has been run on
real papers, through the actual product, for a real reader. No cost number, no accuracy
number, and no speed number for the product itself is a measurement yet — every such
number you may see quoted elsewhere is an estimate, clearly labeled as such, never a
result. The plan for how that fuller testing will eventually happen is in the technical
appendix, but it has not started, and the pass/fail bar for it has not even been set yet.

### A safety net that's already in place

For every new storage the project might add to the database, someone has already
written the "undo" instructions — a script that would remove it again. These undo
scripts are not wired up to run automatically by anything, ever. They exist purely so
that if the project ever needs to back out of a storage change, the instructions are
ready, reviewed, and waiting for a person to run them by hand, after a separate,
explicit decision about what to do with any data that would be lost. Two of the seven
undo scripts would destroy something that cannot be recomputed — one holds a research
interest you typed in yourself, and one exists specifically to remember every paper
you've already been shown, so a promise ("we'll never show you the same paper twice")
isn't quietly broken. Both are marked as needing an exported backup before anyone ever
runs them, and nobody is planning to run any of them without asking you first.

### Two things found while preparing this document

**A storage space that never gets cleaned up.** Peer keeps a private, per-person cache
of paper picks so it doesn't have to redo expensive work on every visit. Nobody has
written a rule for how long to keep that cache around, so today it would simply grow
forever. This isn't a privacy problem — it's private to each person already — but it is
a cost and tidiness problem, and deciding how long to keep it is the kind of call that
needs your sign-off, not something the code should quietly decide by itself. This same
storage space now also holds a second kind of cache, for a handful of experimental
recommendation methods (see the next paragraph), which makes this decision matter more,
not less.

**A few recommendation methods now have the safety net they were waiting for, and it's
been fully checked.** Four of the newer ways Peer can find papers for you (three based
on papers you've liked or saved, one based on topics you seem interested in) used to
have no memory between visits — every single time you open or refresh Peer, they would
redo their work from scratch. That's slow, wasteful, and could run up costs quickly if
switched on. The safety cache that fixes this has now been built, and a second person
who didn't write it has finished checking it: it does what it's supposed to, including
correctly skipping a call — rather than quietly guessing — when its own storage has a
real outage. One small, accepted exception was found and written down, not fixed: a
rare, older, mostly-retired way of loading your dashboard can still let one of these
four make a live call once a day, but even then it can never sneak a brand-new paper
into a list you've already been shown, only refresh something already there. One of the
four — the one based on topics you seem interested in — used to do nothing at all even
if you switched it on, because it had no topics to search with yet; that gap is now
closed too (it reads topics from your own reading history). All four are still switched
off by default — being fully checked isn't the same as being switched on; that's still
its own separate step.

**A minor timing bug — now fixed and double-checked.** If you open Peer in two tabs at
once, or click refresh twice quickly, Peer used to do the expensive work twice instead
of once and reusing the first result. That's fixed now: two tabs, or two fast clicks,
share one answer instead of paying for the work twice. A related, smaller idea — a short
"please wait a bit before refreshing again" pause — has also now been built, as part of
a bigger "get your results ready a little before you sit down to read" feature. Neither
piece is switched on yet, because nothing currently tells either one when it's allowed
to run — that's decision 3 above.

**Two more abilities got built this round, both still switched off.** A backup AI
opinion can now quietly double-check Jev's judgment in the background when Jev itself
sounds unsure, without ever changing what you see. It can't actually run yet, though —
by design, it's only allowed to spend Peer's own money, never yours, and the actual
wiring that would let it spend anything at all still needs to be built (see decision 1
above — the underlying "who pays" question is now decided, but that wiring is separate,
not-yet-started work). Separately, a new way of blending results from Peer's different
search methods into one fair ranking has been built, switched off by default. Whoever
reviewed it found two small accuracy gaps — nothing broken or unsafe, just not as sharp
as it should be — and both are now fixed, with a second, independent person confirming
the fix works. It's still kept switched off on purpose: a planned round of measuring how
well it actually performs against real papers needs to happen first, and that hasn't
started yet.

### Bottom line

Nothing ships itself. Every switch stays off until a person turns it on, in an order
this document proposes but you get to confirm. The riskiest step by far — letting Jev
make real, paid decisions about your papers — sits at the very end of a long chain of
smaller, safer, reversible steps, and needs your explicit go-ahead on cost and scope
before anyone flips it.

---

## Part 2 — Technical appendix

All line numbers and file states below were confirmed by a fresh grep of `web/src` and
`web/supabase/functions` at the time this document was written (2026-09-24). This
codebase has several concurrent writers; re-grep symbol names before relying on an exact
line number in a live edit. All rollout ordering in Section 2 is **PROPOSED** — see that
section's own note.

### 0. Scope and status of this document

- Covers rollout order, rollback (flag-level and SQL-level), the evaluation plan,
  secrets placement, the acceptance-matrix snapshot, and the open user decisions for the
  Jev/retrieval integration campaign (`ABC-JEV-INTEGRATION.md`).
- Originally written by P5-S1 C from `docs/jev-abc/P5-B-20260924T114729Z.md` (the C
  guide) and the binding rulings in `ABC-JEV-INTEGRATION.md` §4's newest entries, which
  override the guide where they differ. Updated by P5-S3 C (this pass, 2026-09-24) to
  fold in everything that landed after P5-S1's fresh independent review: newly-built
  flags (`PEER_RANK_FUSION`, `PEER_JEV_GEMINI_FALLBACK`), a newly-reviewed one
  (`PEER_JEV_SHADOW`), a previously-undocumented one (`OPENALEX_EMAIL`), the now-fixed
  refresh/coalescing bug, the now-built (still fully disconnected) "get results ready
  ahead of time" queue, new pre-flip conditions, and citations switched from line
  numbers to function names because this branch has several concurrent writers and line
  numbers were going stale within the same session.
- Does not itself authorize anything. No flag is flipped, no migration is applied, no
  secret is set, and no SQL in `web/supabase/rollback/` is run as a result of this
  document existing.
- **Updated again by P5-S4 C (this pass, 2026-09-24) — final status update for this
  round.** Since P5-S3: this branch's uncommitted work was locally merged with
  `origin/main` (§0b); a fresh A independently VERIFIED both RRF pre-flip fixes
  (`docs/jev-abc/P2-S6-FIX-A-*`) and the channel-candidate-cache outage-handling
  precondition (`docs/jev-abc/P2-S4cd-A-*`, `docs/jev-abc/P2-S4d-FIX-A-*`); a live smoke
  check of the merged app found a duplicate-paper regression, now fixed once, found too
  wide, and re-fixed (§2b) — **Corrected (was stale): a second fix attempt also failed
  its own independent review, in a new shape, and a third, structural fix followed —
  that fix has since been independently reviewed and VERIFIED
  (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`); see §2b for the full three-round
  account.** USER decision 1 is now resolved, leaving 5 open (§8). This pass upgrades
  acceptance-matrix rows only where a fresh A recorded VERIFIED, never on an
  implementer's own say-so.
- **Updated again by P5-S5 (final status sync, this pass, 2026-09-24).** Since P5-S4:
  the duplicate-paper version rule (§2b) went through one more failed independent
  review (`docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md`, FAILED_REVIEW — the
  narrower, id-based fix still let through chains and hubs where a bridging paper had
  no id at all, or an id of a different kind) before a third, structural rule — every
  paper in a suspected group is checked directly against every other paper in it,
  never comparing ids at all — was implemented and this time independently VERIFIED
  from 41 freshly-built adversarial test cases with zero mismatches
  (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`). A comment-only documentation
  drift the same review found in two unrelated files was fixed and independently
  verified too (`R3-CLEANUP-4`, VERIFIED_OFFLINE_BOUNDED per
  `docs/jev-abc/P4-S9-A-20260924T230835Z.md`). Separately, a full end-of-round
  re-measurement of all 18 acceptance items ran independently in two parts
  (`docs/jev-abc/FINAL-A-P1-20260924T2230Z.md`,
  `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md`) and surfaced one genuine gap this
  document had not yet named: no route let a signed-in reader look back at an
  already-sent day's papers ("archive access"). That was built and independently
  VERIFIED the same round (`docs/jev-abc/P4-S9-A-20260924T230835Z.md`), alongside two
  small factual fixes to this document that same review found. This pass folds all of
  the above into §2b, the acceptance matrix (§6), the gates (§7), and Part 1's
  plain-language account of the duplicate-paper bug. **Overall release gate: NOT
  MET.** Nothing in this campaign has been verified against a real database, a live
  outside AI/search provider, or an actual end-to-end browser run — every result
  anywhere in this document remains an offline-only check, and five of the six user
  decisions (§8) are still open.
- **Updated again by R4-DOCS (Round 4, 2026-09-25).** Since P5-S5, the user made
  several decisions in chat (`ABC-JEV-INTEGRATION.md` §1t): the Round 3 post-merge work
  was committed locally (`e6a42030`, still not pushed); decision #3 (who/what triggers
  the scheduled jobs) resolved to **option A** (§1v) — the trigger piggybacks on the
  existing hourly GitHub Actions workflow rather than a new schedule, which also settles
  decision #5 (email retry); a bounded, $0, internal live evaluation of Semantic
  Scholar vs. OpenAlex was authorized (§1u, "做内部测评"); and a new item — an
  adjustable daily dollar cap on Peer's own company-funded AI spending
  ("SPEND-CAP") — was authorized with a concrete design (§1v R1-R11). Three lanes ran
  this round, each B → C → fresh A: **SPEND-CAP** (§1v rulings; built, independently
  VERIFIED_OFFLINE_BOUNDED, `docs/jev-abc/SPEND-CAP-A-20260925T052950Z.md`, 13/13
  checks, 4 mutations caught and restored); **TRIGGER-A** (§1x rulings P1-P11; the
  prepare-ahead worker and email-retry phase wired to the existing hourly cron;
  independently VERIFIED_OFFLINE_BOUNDED, `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`,
  14 checks incl. a 672-combination lead-time probe and a 9-case cross-timezone probe,
  one finding — F-TRIGGERA-A-01 — accepted as **P7b**, a narrower sibling of P7:
  `buildPool` never reads the rollover pool either, not only never writing to it,
  now with its own protective test); and **LIVE-EVAL-4** (§1w rulings + AMENDMENT; a
  live-call harness against Semantic Scholar and OpenAlex, independently
  VERIFIED_OFFLINE_BOUNDED both before and after a fix for a too-blunt stop rule,
  `docs/jev-abc/LIVE-EVAL-4-A-20260925T052639Z.md` +
  `docs/jev-abc/LIVE-EVAL-4-FIX-A-20260925T055351Z.md` — the first full run stopped at
  call 2 on a real Semantic Scholar 429 with zero comparison data; the amended,
  re-verified run completed all 7 inputs on 46/150 calls, ≈$0.024). Separately, a
  manager fact-check (`ABC-JEV-INTEGRATION.md` §1x) **corrected a wrong claim from
  §1v**: the scheduled daily email is not simply unreachable because nothing writes its
  settings — the app actively removed the on/off control from its screens on
  2026-04-27 while leaving the underlying send code running dormant; the hourly job
  runs for every signed-in reader by default regardless (producing an in-app "Past
  briefings" entry, never an email — see the new Part 1 paragraph) but never emails
  because nothing sets the send channel to email. This pass (R4-DOCS) folds all of the
  above into acceptance rows 4, 12, 13/14/15 (§6), Part 1's plain-language account, and
  §8's open-decisions list (new #7; #3 and #5 marked decided). **Overall release gate:
  still NOT MET** — three of seven tracked user decisions are now resolved (#1, #3, #5),
  four remain open (§8), and nothing in this campaign has been verified against a real
  database or an actual end-to-end browser run; the one live-provider exception (the
  bounded Semantic-Scholar/OpenAlex comparison above) supplies real overlap/reliability
  data but not yet a relevance verdict, and never touched the product itself.

### 0b. The merge with origin/main — local only, not pushed (new this pass, P5-S4)

Since P5-S3, this branch's uncommitted work was snapshotted as three local `wip:`
commits and merged with `origin/main` (`git merge`, not rebase) into one local merge
commit `6f518512` (second parent exactly `origin/main` @ `640c55ec`). **Not pushed, no
PR, no deploy** — authorized by the user in `ABC-JEV-INTEGRATION.md` §1s, which this
section summarizes; §1s is the binding text if the two ever disagree.

**Verified independently, not taken on the merge implementer's word.**
`docs/jev-abc/MERGE-A-20260924T203103Z.md` (VERIFIED_OFFLINE_BOUNDED) re-ran all 4 gates
from scratch on the merge commit (`tsc` 0 errors; `eslint` 0 errors/149 warnings;
`vitest` 4467/4467; `build` succeeded) and independently re-derived — from the merged
source directly, not from any guide's summary — that every one of main's binding rules
survived: every route that reaches an AI model requires proof of who is asking and why
(a `ProviderContext`); exactly 6 routes gate on that proof; a full in-depth ("deep")
report is counted exactly once, with its own regression test that fails if a second
counting point is ever added; a total search failure is reported honestly, never
silently returned as an empty result; the cache that remembers a reader's built paper
list now also accounts for uploaded-paper interests and runs on the right cycle (weekly
for some surfaces, daily for others); and every one of this campaign's own guarantees
(the delivery ledger, the channel cache's outage handling, RRF's flag-off state, the Jev
broker's caps and secret handling, the prepare-job queue staying unwired) still holds.
Five places where the automatic merge tool silently produced something subtly wrong
were found and fixed before anyone signed off (e.g., a check that would have run twice
instead of once; an onboarding message that would have shown twice) — independently
confirmed fixed, and a fresh sweep for more of the same 3 bug patterns found none.

**USER decision 1 is resolved, in main's favour (§1s.2, restated in §8 below).** Main's
company-funded AI rules are kept in place of this branch's own, stricter, keys-only
rule. **The recorded risk is not hypothetical anymore — it is now live, and belongs at
the top of any list for the user:** main's rule caps only two specific expensive
actions — a full in-depth report, and a forced full rebuild of a reader's results — with
**no general spending ceiling** on anything else that reaches a model (ordinary feed
re-ranking, short reports, query generation, figure matching). MERGE-A restates this as
its own NEW FINDING 1, independent of the original UPSTREAM-02 finding that first
surfaced it.

**First-visit product ruling (raised by the merge, decided by the manager, reported to
the user, who may override it):** a visitor who has declared no project, challenge, or
topic at all sees main's starter sample list with its own setup banner — never a screen
that blocks them until they type something. A visitor who has declared even just a
rough project or challenge (not full keywords) always sees their own briefing, never the
generic sample — this preserves the "no dummy-keyword requirement" guarantee (acceptance
item 1) while keeping main's sample-feed behaviour for a truly blank visitor.

**One real bug the merge produced, caught by a human smoke check, not by any of the
4467 automated tests: the duplicate-paper regression.** See §2b for the full account.
**Corrected (was stale):** it took two more rounds and a structural rewrite to close
every shape of the problem, and that final fix has since been independently reviewed
and VERIFIED (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`).

**Process note (not a product issue, included only because the brief for this pass
asked it be recorded if at all):** while smoke-checking the merged app, a preview tool
briefly started a development server in the sibling `peer-followup` worktree instead of
this repository, because it resolved launch configuration from the session's original
project root. No source file was changed by the incident (only that other worktree's
own build cache); it was not killed, to avoid disrupting that other, unrelated session;
this session was corrected to always start this repo's own server explicitly from now
on. Recorded here for completeness, not because it affects anything in this document.

### 1. Flag inventory — fresh grep, P5-S3 session (2026-09-24); re-confirmed post-merge by MERGE-A, not independently re-grepped by P5-S4

Grep commands run: `grep -rnE "process\.env\.(PEER_|OPENALEX_|JEV_)[A-Z0-9_]*" web/src
--include="*.ts" --include="*.tsx"`, a broader token sweep
(`grep -rhoE "\b(PEER|OPENALEX|JEV)_[A-Z0-9_]*\b" web/src --include="*.ts" --include="*.tsx"
| sort -u`) to catch anything the narrower grep would miss, and
`grep -rn "Deno\.env\.get" web/supabase/functions`.

**Citations below are by function name, not line number.** `web/src/lib/feed/pipeline.ts`
in particular is being actively edited by a concurrent writer as this document is
written — this session watched its own line numbers shift between two greps taken
seconds apart. Re-grep the function name if you need an exact line.

| Flag / name | Default when unset | Accepted value | Where read | Status |
|---|---|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Off (today's behavior) | literal `"on"` only | function `dashboardLedgerEnabled()`, `web/src/lib/dashboard/ledger-flag.ts` | Built, code-reviewed offline. **Pre-flip HARD THRESHOLD (new):** if this ever ships turned off in production (the batchless path, which is the real one today), an "unattributed pending delivery" reconcile — merging a not-yet-attributed pending delivery into the right owner's bucket once that owner becomes known within the same visit — must be built first. See §2 Group A1. |
| `PEER_DIGEST_DEDUPE` | Off (old 6-hour window) | literal `"on"` only | function `isDigestDedupeEnabled()`, `web/src/app/api/jobs/dispatch-digests/route.ts` | Built, code-reviewed offline. (Its cited line number has moved twice since this document was first written — this is exactly why it's now cited by function name instead.) |
| `PEER_DASHBOARD_PREPARE` | Off (nothing scheduled or built ahead of time) | literal `"on"` only | function `dashboardPrepareEnabled()`, `web/src/app/api/jobs/prepare-dashboards/route.ts` | TRIGGER-A. Built, code-reviewed offline. Master switch for phases 1+2 (due-selection/enqueue + drain) of the new endpoint below. **Hard-depends on `PEER_DASHBOARD_LEDGER` above, enforced in code, not just documented order:** on with the ledger flag off reports a truthful `"ledger_disabled"` no-op rather than silently wasting a prepare build (protective test in `web/src/app/api/jobs/prepare-dashboards/route.test.ts`). No effect until `.github/workflows/digest-cron.yml`'s new `prepare` job is pushed/merged to main AND this flag is on. |
| `PEER_DIGEST_EMAIL_RETRY` | Off (an unsent claimed email is never revisited sooner than the next daily hour-match) | literal `"on"` only | function `digestEmailRetryEnabled()`, `web/src/app/api/jobs/prepare-dashboards/route.ts` | TRIGGER-A. Built, code-reviewed offline. Gates phase 3 (email retry) of the new endpoint below, in ADDITION to `PEER_DIGEST_DEDUPE` above (no `payload.email` attempt records exist to retry when dedupe's claim path is off — structural no-op without both). Reuses `handleConflictingEmailClaim` (now `web/src/lib/email/digest-retry.ts`, extracted unmodified from dispatch-digests/route.ts) unchanged, so a retried send can never double-send by anything this flag adds. Structurally a no-op today regardless, since nothing in the app can set a profile's digest channel to email/both yet (see the §1x correction above) — turning this on before email delivery itself returns changes nothing observable. |
| `PEER_JEV_BROKER` | Off | literal `"on"` only | function `jevBrokerEnabled()`, `web/src/lib/decisions/broker-client.ts` | Built; nothing calls it in production yet |
| `PEER_JEV_BROKER_URL` | unset | server URL string (secret-adjacent) | function `readJevShadowConfig()`, `web/src/lib/decisions/flag.ts` | Built |
| `PEER_JEV_BROKER_SECRET` | unset | credential string | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: the request handler in `web/supabase/functions/jev-broker/index.ts` | Built |
| `PEER_JEV_PER_USER_DAILY_CAP` | 50/day (constant `DEFAULT_JEV_PER_USER_DAILY_CAP`, `flag.ts`) | integer | Next: function `readJevShadowConfig()`, `flag.ts`; Edge: function `envNumber()`, `jev-broker/index.ts` | Built — **see §4 caution: must be set to the same number on both sides** |
| `PEER_JEV_GLOBAL_DAILY_CAP` | 2000/day (constant `DEFAULT_JEV_GLOBAL_DAILY_CAP`, `flag.ts`) | integer | same as above | Built — same caution |
| `PEER_JEV_SHADOW` | Off | literal `"on"` only | function `jevShadowEnabled()`, `web/src/lib/decisions/flag.ts` | Built. **Now has its own independent fresh review** (it did not, as of the last version of this document) — offline-verified: eligibility gate, cache wiring, and a privacy probe (8 sentinel strings never reach a log line) all checked. **New recommendation:** the feed route sets no explicit `maxDuration` today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, which fits, but the two numbers were never explicitly pinned against each other in code. Set an explicit `maxDuration` on the feed route before turning this on. See §2 Group B7. |
| `PEER_JEV_GEMINI_FALLBACK` | Off | literal `"on"` only | function `geminiFallbackEnabled()`, `web/src/lib/decisions/flag.ts` | **Now built** (was "not built yet" in the prior version of this document). Code-reviewed offline. Structurally inert regardless of this flag's value: nothing anywhere in the codebase mints or injects the company-funded capability this feature requires, so it cannot fire even when "on" — see §2 Group B8 and user decision 1. **New pre-flip condition (SPEND-CAP · R3):** before this path is ever activated, whoever wires it up must (1) add a real `maxTokens` ceiling to its one model call (`decisions/gemini-fallback.ts`'s `runDecisionFallback`, which today sends none — structurally unbounded output, the same shape flagged for the dormant `testConnection` method) and (2) route that call through the company-spend reservation this pass built (it bypasses `meterProvider`/`resolveProvider` entirely today, by construction — it takes an injected capability, never a `resolveProvider()`-returned provider). Neither is done in this pass; recorded so the next round doesn't activate this path without both. |
| `PEER_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP` | 10/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_PER_USER_DAILY_CAP`, `flag.ts`) — **PROPOSED, not sourced from any vendor number** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built. A separate, code-level (not env-configurable) ceiling of at most 5 calls per shadow run also applies — that number is a manager ruling, not a proposed default. |
| `PEER_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP` | 200/day (constant `DEFAULT_JEV_GEMINI_FALLBACK_GLOBAL_DAILY_CAP`, `flag.ts`) — **PROPOSED** | integer | function `readGeminiFallbackConfig()`, `flag.ts` | Built |
| `PEER_RANK_FUSION` | Off | literal `"on"` only | function `rankFusionEnabled()`, `web/src/lib/feed/pipeline.ts` | Built — this is the hybrid-retrieval-ranking (RRF) feature. The flag-off state (nothing changes) is code-reviewed offline. Flag-on found 2 accuracy gaps in review; **both fixes now VERIFIED** by a fresh, independent review (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`, VERIFIED_OFFLINE_BOUNDED — reproduced RED-before/GREEN-after, both required mutations independently re-run, flag-off path re-confirmed byte-identical). **Still ships off in production** — a separate, deliberate gate (the §5 evaluation must inform the production default, per §1p.B(1)), not an unresolved defect. See §2 Group A6. |
| `PEER_CHANNEL_OPENALEX_SEMANTIC` | Off | literal `"on"` only | function `channelOpenAlexSemanticEnabled()`, `pipeline.ts` | Built, code-reviewed offline |
| `PEER_CHANNEL_OPENALEX_TOPIC` | Off | literal `"on"` only | function `channelOpenAlexTopicEnabled()`, `pipeline.ts`; topic ids now resolved by function `topPositiveOpenAlexTopicIds()`, `web/src/lib/preferences/topic-seeds.ts` | No longer a guaranteed no-op — wired to a real source of topic ids (pulled from the reader's own liked/saved papers via the delivery ledger). **Now independently VERIFIED** (`docs/jev-abc/P2-S4cd-A-20260924T152147Z.md`, VERIFIED_OFFLINE_BOUNDED), with one disclosed, accepted, low-severity open item — see §2 Group A4. **Same precondition as the 3 rows below, now also VERIFIED — see §2 Group A4.** |
| `PEER_CHANNEL_S2_RECOMMENDATIONS` | Off | literal `"on"` only | function `channelS2RecommendationsEnabled()`, `web/src/lib/preferences/positive-seeds.ts` | Built, code-reviewed offline. The per-owner daily channel-candidate cache this needs (§2 Group A4) is built and **now independently VERIFIED**, including its outage-handling tri-state (`docs/jev-abc/P2-S4cd-A-20260924T152147Z.md`, `docs/jev-abc/P2-S4d-FIX-A-20260924T164212Z.md`, both VERIFIED_OFFLINE_BOUNDED). The "both-sides" conflict rule (a paper id present in both the positive and negative seed lists is now sent as neither) is implemented and verified. |
| `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY` | Off | literal `"on"` only | function `channelOpenAlexSeedSimilarityEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition, now verified.** |
| `PEER_CHANNEL_POSITIVE_SEED_CITATIONS` | Off | literal `"on"` only | function `channelPositiveSeedCitationsEnabled()`, `positive-seeds.ts` | Same as above. **Same precondition, now verified.** |
| `OPENALEX_API_KEY` | Unset = keyless | server secret | function `openAlexAuthHeaders()` — defined separately in each of 4 files: `sources/openalex.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `affiliation/openalex.ts` | Sent as an `Authorization: Bearer` header, never a URL parameter, at all 4 sites |
| `OPENALEX_EMAIL` | `"peer@example.com"` | any contact-address string — not a secret | module-level constant (commonly named `MAILTO`) at 9 call sites: `api/papers/search/route.ts`, `api/topics/suggest/route.ts`, `affiliation/openalex.ts`, `figures/extract.ts`, `papers/fetch-by-id.ts`, `papers/source-links.ts`, `sources/openalex-semantic.ts`, `sources/openalex-topic.ts`, `sources/openalex.ts` | **New row — was previously undocumented (P5-S1 finding).** Pre-existing behavior, unchanged; only the documentation was missing. |
| `PEER_ENTITLEMENT_MODE` | one-tier (beta) | exactly `"tiered"` restores the free/trial/paid split | function `entitlementMode()`, `entitlement/resolve.ts` | Pre-existing, load-bearing for the Jev broker's entitlement gate |
| `PEER_DEV_ENTITLEMENT` | free + synthesized dev user | local-dev only | function `devEntitlement()`, `entitlement/resolve.ts` | Pre-existing; gated by a runtime check (`isLocalDevRuntime()`), not the production build guard — a stale code comment names the wrong mechanism, harmless |
| `PEER_DIGEST_PROVIDER` | unset | provider id string | function `resolveLocalServerProvider()`, `llm/providers/registry.ts` | Pre-existing, unrelated to this campaign |
| `PEER_REPORT_MODEL_TIER` | "large" | `"small"` switches tier | function `reportModelTier()`, `llm/provider-models.ts` | Pre-existing, unrelated |
| `PEER_FEED_AI_TIER` | 0 | integer | function `feedTierFromEnv()`, `feed/pipeline.ts` | Pre-existing, unrelated |
| `PEER_RUN_LIVE_EVENTS_BENCHMARK` | off | exactly `"1"` | function `canRunLiveEventsBenchmark()`, `events/benchmark-live-gate.ts` | Pre-existing, unrelated; live/opt-in benchmark only |
| `PEER_PROFILE_SNAPSHOT_PATH` | a default fixture path | file path | `events/benchmark.test.ts` — **test-only, not read by any production file** | Pre-existing, unrelated |
| `PEER_PRIVATE_UPLOAD_DIR` | unset | absolute path | function `hostedUploadsEnabled()` and constant `UPLOAD_DIR`, `papers/upload-access.ts` / `papers/upload-store.ts` | Pre-existing, unrelated |
| `PEER_UPLOADS_ENABLED` | `false` | exactly `"true"` | function `hostedUploadsEnabled()`, `papers/upload-access.ts` | Pre-existing, unrelated |
| `JEV_API_KEY` | unset | the real Jev provider credential | **REVERSED this pass (JEV-DIRECT §1aa) — was "Edge only," now Next/Vercel too.** Read in exactly one place on the Next side: `jevDirectConfigured()`/`callJevDirect()`, `web/src/lib/decisions/jev-direct-client.ts` (a repo-wide placement scan enforces this — `spend-scans.test.ts`). Also still readable (dormant) on the Edge side, `jev-broker/index.ts`, unchanged. | Built. Server-only (`import "server-only"`); never `NEXT_PUBLIC_`; the key never reaches a log line, error message, cache key or test fixture (regression-tested, mirroring `jev-client.ts`'s own 3-part leak suite). Optional — Peer without it simply never calls Jev directly (falls back to the broker if configured, else disabled). |
| `PEER_JEV_TRANSPORT` | unset (auto-detect) | exactly `"direct"` or `"broker"`, else treated as unset | function `resolveJevTransport()`, `web/src/lib/decisions/flag.ts` | **New this pass (JEV-DIRECT §1aa).** Auto-detect default: direct when `JEV_API_KEY` is set, else broker when `PEER_JEV_BROKER` is "on" and configured, else disabled. An override can never fabricate its own prerequisite. Exists so an operator can force the dormant broker path back on during an incident without unsetting `JEV_API_KEY` in Vercel (manager ruling §1ab P3). |
| `PEER_RUN_JEV_SMOKE` | Off | exactly `"1"` | function `canRunJevSmoke()`, `web/src/lib/evaluation/jev-smoke/gate.ts` | **New this pass (JEV-DIRECT §1aa point 6).** Built and tested OFFLINE only — gates the opt-in `npm run test:jev-smoke` runner, which makes real Jev calls against fixed synthetic inputs (never a real user's data) up to a hard ceiling of 10. Nobody has run it live this pass; it may only run live after the user states a Jev budget in chat. |

#### 1a. SPEND-CAP knob — removed

The shared AI dollar budget no longer exists: Peer pays for no model call (readers run on
their own keys), so there is no company spend to cap. `PEER_COMPANY_SPEND_CAP`, the
reservation hook, the `company_spend_caps` and `company_model_prices` tables and the
`company_spend:*` counter rows are gone from the code; the tables and the counter rows are
dropped by `web/supabase/migrations/20261007000100_drop_ledger_and_budget.sql` (export
`usage_events` first — the migration's header says how). The SPEND-CAP history elsewhere
in this document is kept as history. See `docs/handoff/byok-only/PLAN.md`.

**Corrections/confirmations versus the prior version of this document:**
`PEER_JEV_SHADOW` now has an independent fresh review (it did not before) — see its row
above. `PEER_JEV_GEMINI_FALLBACK` and `PEER_RANK_FUSION` are both now built, each with
its own independent fresh review of the flag-off state; `PEER_RANK_FUSION`'s flag-on
path additionally has 2 known gaps with fixes in progress (not yet written). The
per-owner daily cache for the four read-time recommendation channels (internal name:
channel-candidate cache, `web/src/lib/opportunities/channel-candidate-cache.ts`) is now
built; its own independent review is in progress, not yet verified — do not treat its
precondition (§2 Group A4) as satisfied until that review lands. `OPENALEX_EMAIL` is
added as its own row (previously undocumented). The stale `PEER_DIGEST_DEDUPE` line
citation is fixed by switching every citation in this table to function names instead
of line numbers, which is now this table's permanent convention.

**Corrections/confirmations versus the prior (P5-S3) version, made this pass (P5-S4):**
`PEER_RANK_FUSION`'s 2 flag-on accuracy gaps are no longer "in progress" — both fixes
landed and were independently VERIFIED (`docs/jev-abc/P2-S6-FIX-A-*`); the flag still
ships off, now solely because of the separate §1p.B(1) evaluation gate, not because
anything is still broken. The per-owner daily channel-candidate cache's independent
review also landed and is now VERIFIED (`docs/jev-abc/P2-S4cd-A-*`,
`docs/jev-abc/P2-S4d-FIX-A-*`) — treat the §2 Group A4 precondition as satisfied. The
3-way-duplicated year/first-author helper P2-S6-FIX-A flagged as a non-blocking
follow-up has an implementation consolidating it into one shared, exported helper
(`docs/jev-abc/DEDUP-FIX2-C-*`, bundled with the version-rule fix in §2b) — itself not
yet independently reviewed, so treat that specific cleanup as done-but-unverified, not
closed. Everything else in this table was re-confirmed, not re-derived from scratch:
this branch's uncommitted work was merged with `origin/main` since P5-S3 (§0b), and a
fresh, independent post-merge review (`docs/jev-abc/MERGE-A-20260924T203103Z.md`)
re-read every function named in this table directly from the merged source and found
all of them unchanged in behavior (some shifted line numbers, which is exactly why this
table cites function names only).

### 2. Rollout runbook — PROPOSED, not sourced

**Everything in this section is a proposal, not an instruction.** Only one flag
(`PEER_DASHBOARD_LEDGER`) has an explicit order written down anywhere in this campaign's
source material; every other ordering below is this document's own reasonable
generalization from that one precedent, built because no cross-flag database dependency
forces any particular order. **The user confirms the actual order at rollout time** — a
manager or implementer should not treat the table below as authorization to proceed.

Every flag in this campaign accepts only the literal string `"on"` — never `"true"`,
`"1"`, or any other truthy-looking value — and defaults to today's exact behavior when
unset.

#### Group A — additive, independent of the Jev broker, lowest blast radius

| # | Flag | Preconditions (ALL must hold) | Stop signal |
|---|---|---|---|
| A1 | `PEER_DASHBOARD_LEDGER` | (1) The dashboard-delivery-ledger migration applied. (2) User has separately authorized applying that migration. **This is the one flag with a sourced order** — flip only after the migration apply is authorized and done. **(3) New HARD THRESHOLD:** if production ever launches with this flag left **off** (the batchless path — today's real, default path), an "unattributed pending delivery" reconcile must be built first: a pending delivery that arrived before the reader's identity was known must be merged into the right owner's bucket once that owner becomes known within the same visit. This is a design requirement, not something already authorized to build. | Any response that serves a freshly-built pool while the ledger can't be read — must fail closed (503), never silently fall back to an unguarded pool. |
| A2 | `PEER_DIGEST_DEDUPE` | The briefing-deliveries-dedupe migration applied. (PROPOSED — modeled on A1, not itself sourced.) | A duplicate send on retry, or an old pre-migration row blocking a legitimate new claim. |
| A3 | `OPENALEX_API_KEY` | User decision 4 (live-call authorization) resolved enough to know whether this is optional or effectively mandatory. Not a rollout flag — a secret whose mere presence changes behavior for every OpenAlex call site. | N/A — low risk either way; the open question is timing, not safety. |
| A4 | The 4 read-time recommendation channels: `PEER_CHANNEL_S2_RECOMMENDATIONS`, `PEER_CHANNEL_OPENALEX_SEED_SIMILARITY`, `PEER_CHANNEL_POSITIVE_SEED_CITATIONS`, `PEER_CHANNEL_OPENALEX_TOPIC` | **Precondition status UPDATED this pass (P5-S4): now VERIFIED.** The per-owner daily channel-candidate cache (design name: P2-S4d) that all four need is built (`web/src/lib/opportunities/channel-candidate-cache.ts`) and its independent review has landed: `docs/jev-abc/P2-S4cd-A-20260924T152147Z.md` (VERIFIED_OFFLINE_BOUNDED for the topic-id resolution, the advisor-citation channel, the cache itself, and the S2 both-sides rule) and `docs/jev-abc/P2-S4d-FIX-A-20260924T164212Z.md` (VERIFIED_OFFLINE_BOUNDED for the specific fix this precondition needed — a genuine storage outage is now correctly told apart from an ordinary first-time miss, so an outage degrades to "skip this channel, say so truthfully" instead of silently fetching live on every request). Reason the precondition existed (manager finding F-M-P2-02, confirmed by direct code read): before this cache, these channels "are never cached... they simply re-run and re-report on every request" — with any of them on, every page open or refresh in the normal (non-ledger) mode fired all enabled channels fresh, unbounded by anything except ordinary request volume. `PEER_CHANNEL_OPENALEX_TOPIC` is no longer a guaranteed no-op (see §1) — it now shares this same precondition, also verified. Also implemented and verified: the "both-sides" conflict rule (a paper id in both the positive and negative seed lists is sent as neither); a related, smaller gap (the same 200-row seed-history window can in theory be exhausted by roughly 200 toggles on one paper) is an ACCEPTED COST, not a blocker — it degrades to fewer seeds, never to a wrong one. **One disclosed, accepted, low-severity open item from the fresh review (not a blocker):** in the older, non-default "frozen batch" delivery mode, a narrow legacy-only code path (batches saved before a since-added storage column existed) can still let the topic channel make one live call per owner per day, bounded by this same cache — but it structurally cannot let a new paper appear inside an already-frozen list, only refresh an already-shown entry's own content. Recorded as an open item, not fixed, because fixing it would either widen an already-legacy-only path or touch a file outside this precondition's own scope. | Any of the four channels observed firing live calls on a simple page reopen once "on," or a genuinely new paper appearing inside an already-frozen batch — either would mean this precondition's own guarantee has broken. |
| A5 | `PEER_CHANNEL_OPENALEX_SEMANTIC` | None beyond code; already code-reviewed offline. | Any live comparison being treated as authoritative before user decision 4. |
| A6 | `PEER_RANK_FUSION` (hybrid retrieval ranking / RRF) | Not part of the original guide — added when the feature was first built. Ships flag-off by design. Before ever turning this on in production: (1) **both pre-flip fixes are now DONE and independently VERIFIED** (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`, VERIFIED_OFFLINE_BOUNDED — both fixes reproduced RED-before/GREEN-after, both required mutations independently re-run, flag-off path re-confirmed byte-identical to today's behavior); (2) the Section 5 evaluation should still inform the production default, per §1p.B(1) — this is the one remaining, deliberate gate, not an unresolved defect. Fixes that landed: (a) the fused-ranking candidates now carry the same publication-year/first-author-surname information the plain de-duplication path uses, so a pair that de-duplication merges into one paper is credited to both search channels in the fused ranking, not silently only one; (b) the fused-ranking result now survives being served from the same-day cache, not only a freshly-built response — a same-day cache read no longer loses that ranking's supporting detail. **Non-blocking follow-up recommendation from the same fresh review:** it flagged the small year/first-author helper as duplicated a third time across three files (non-blocking — the three copies were byte-identical and could not disagree on any input). A later, same-day implementation pass (`docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`, bundled with the version-rule fix in §2b) consolidated all three into one shared, exported helper. **Corrected (was stale):** this consolidation is R3-CLEANUP-3, independently VERIFIED_OFFLINE_BOUNDED (byte-identical to the three old copies it replaced) per `docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md` — confirmed even though that same review round separately FAILED the version-matching logic bundled alongside it; see §2b for that logic's own, later, separately-verified history. | Any user-visible fused ranking before the §1p.B(1) evaluation sign-off; a same-day cache read that silently drops the fused-ranking detail. |

#### Group B — the Jev path (strictly sequential; each step gated on the previous being clean)

| # | Step | Preconditions | Stop signal |
|---|---|---|---|
| B1 | Resolve user decision 1 (company-funded AI option) far enough to know where the database foundation holding the eventual Jev key will live. **SATISFIED this pass (§0b/§8): decision 1 is resolved, in main's favour; the foundation is confirmed a Supabase server-side secret (§1r).** This does not by itself complete any later step — B2 (actually applying the private-decisions migration) is still undone; this campaign still has no real database to apply it to. | — | Designing B2+ around an unresolved foundation choice — no longer applicable; B2 itself remains blocked on the absence of a real database, unrelated to decision 1. |
| B2 | Apply the private-decisions migration. | B1. | Any write path to that table that isn't the service role. |
| B3 | Deploy the Jev broker Edge Function; set its secrets, **including explicit values (not the code defaults) for both daily-cap numbers.** | B1, B2. This is the first time this function will actually run anywhere — no Edge runtime has been available to this campaign at all. | **The two-sided cap mismatch risk:** the Edge side and the Next side each read their own daily-cap numbers independently; nothing in the code forces them to match. **Ruling: set the same number on both sides; if they ever drift, the lower one silently wins** (each side only enforces its own copy). Record the exact numbers used on both sides in the same change. |
| B4 | Set the broker secret as a Next/Vercel server variable (same value as B3). | B3. | A value that differs from the Edge side — every call will fail authentication. |
| B5 | Turn on `PEER_JEV_BROKER`. | B4. Confirm the route wiring that actually calls this path has landed and passed an independent review — otherwise this flag has no observable effect yet, which is safe but proves nothing. | Any caller reaching the broker before that wiring has an independent review. |
| B6 | One bounded, explicitly user-approved-spend smoke test of a real Jev call, end to end. | B5, user decision 4 (scope, volume, budget), and a separately approved spend ceiling. This is the first live verification of anything in this campaign. | Any live call attempted without an explicit, dated, in-chat spend approval naming the ceiling. |
| B7 | Turn on `PEER_JEV_SHADOW`. | B6 passed clean. `PEER_JEV_SHADOW`'s own code now HAS an independent fresh review (this was still outstanding in the prior version of this document — now closed: eligibility gate, cache wiring, and a privacy probe with a planted-leak control all checked offline). **New precondition added this pass:** set an explicit `maxDuration` on the feed route first — it has none today; the platform default is 300 s and the shadow's own worst-case run is ~60 s, comfortably inside that default, but the two numbers were never pinned against each other in code, only reasoned about after the fact. Its own eligibility gate (all of: broker on, signed-in owner matches the cache-scope owner, paid plan, AI tier ≥ 2, a structured intent present, broker URL+secret configured) is a structural filter, not an adjustable rollout percentage — the safe "how many users" number is however many real users currently satisfy every one of those conditions, which should be estimated (read-only) before flipping, since that number IS the blast radius. | Any evidence the shadow hook is awaited by the main request path, or that it fires on a cache hit or a retry. |
| B8 | `PEER_JEV_GEMINI_FALLBACK` (the background-only backup opinion, invisible to the reader, that can weigh in when Jev itself is unsure) | **Now built** (was "not built" in the prior version of this document): its own flag, daily caps, validation, and a hard per-run ceiling of 5 calls are all code-reviewed offline. Structurally inert regardless of rollout step: it only ever runs on an injected, company-funded capability, and nothing anywhere mints or injects one today — so there is no live rollout step to take yet. Unblocking this requires (1) user decision 1 resolved toward the company-funded option, and (2) that capability actually being wired up (a follow-on implementation step, not authorized by decision 1 alone). Its daily-cap numbers are PROPOSED, not sourced from any vendor figure — confirm before any live rollout. **New pre-flip condition (SPEND-CAP · R3):** step (2)'s wiring must also give this call a bounded `maxTokens` (it has none today — unbounded output) and route it through the new company-spend reservation (§1a) — it bypasses that mechanism entirely today by construction. Both conditions are unmet as of this pass. | Any live Gemini call before the capability exists, decision 1 has been made, a `maxTokens` ceiling exists, AND the call is routed through the company-spend reservation. |

#### Group B-direct — the Jev path, direct transport (JEV-DIRECT §1aa) — an alternative to Group B above, not an addition to it

**New this pass.** The user reversed §1r: Jev's key now goes into Vercel like any other provider key, and Peer calls Jev directly — no Supabase Edge Function deploy needed for this path. Much shorter than B1-B8 above because there is no Edge Function to build, secret to double-set, or two-sided cap-mismatch risk (the direct path reads the Next-side caps directly, once, the same numbers B3's caution is about keeping in sync between two sides).

| # | Step | Preconditions | Stop signal |
|---|---|---|---|
| Bd1 | Set `JEV_API_KEY` in Vercel (server env, never `NEXT_PUBLIC_`). | None — an optional key; Peer behaves exactly as before while it is unset. | The key appearing in any log line, error message, cache key or test fixture — regression-tested (mirrors `jev-client.ts`'s own leak suite) but worth a manual spot-check on first real rollout. |
| Bd2 | (Optional) confirm `PEER_JEV_TRANSPORT` — leave unset for auto-detect (direct wins whenever `JEV_API_KEY` is set), or set explicitly if you want the choice spelled out. | Bd1. | Setting it to `"broker"` while intending direct — an override can force the OTHER transport; check it reads `"direct"` or is unset. |
| Bd3 | One bounded, explicitly user-approved-spend smoke test of a real Jev call, end to end, using the opt-in `npm run test:jev-smoke` runner (JEV-DIRECT §1aa point 6). | Bd1, Bd2, and a stated Jev budget in chat — same requirement as Group B's B6, just against the direct path instead of the broker. Cost estimate: on the order of one to two hundredths of a cent for a full 10-call run (Jev's own published price, $0.042/M input tokens, output free). | Any live call attempted without an explicit, dated, in-chat spend approval; any contract mismatch the runner reports (its whole job is making that loud, not assuming success — no real Jev call has ever been made in this whole campaign before this smoke test). |
| Bd4 | Turn on `PEER_JEV_SHADOW`. | Bd3 passed clean. Same eligibility gate as Group B's B7 (signed-in owner matches the cache-scope owner, paid plan, AI tier ≥ 2, a structured intent present) — `resolveJevTransport() !== "disabled"` replaces "broker on" as the one changed condition; the other six are unchanged. Same `maxDuration` recommendation as B7. | Any evidence the shadow hook is awaited by the main request path, or that it fires on a cache hit or a retry — identical risk shape to Group B, since `shadow.ts`'s orchestration is untouched by which transport it dispatches to. |

The broker path (Group B above) stays in the tree, dormant, selectable later via `PEER_JEV_TRANSPORT=broker` plus its own B1-B8 steps — nothing about JEV-DIRECT removes that option, only adds a shorter alternative.

**Known code-level cost bug (F-B-P4S8-01) — now FIXED and independently verified.**
Signed-in users on a cold cache used to not get deduplicated — two tabs, or a fast
double-click of refresh, would independently rebuild the whole paper pool twice,
doubling source fetches and, if the gates above are open, doubling both paid-AI calls
and Jev-shadow schedules. The fix (keying in-flight de-duplication off the pool's own
identifier — owner id plus a hash of the full intent — instead of an internal object
reference) has landed and was independently proven against the real pipeline under true
concurrent requests, both same-owner (coalesces to 1 fetch) and different-owner/different
-intent (never share a flight). This is not itself gated by any flag — it is always on —
but it lowers the real cost of turning any of the flags above on.

**The related "get results ready ahead of time" feature — TRIGGER-A: now reachable, still
off by default.** A 15-minute cooldown between manual refreshes, plus a durable queue that
would let Peer prepare a reader's results shortly before they're expected to check in,
were built and independently code-reviewed offline (see acceptance 13/14/15 in §6):
due-time and retry/backoff math, the cooldown check itself, and a job-queue repository
with both an in-memory and a real-database-backed implementation all exist and pass their
offline tests. User decision 3 was answered — GitHub Actions, the same mechanism the
scheduled digest already uses — and this pass wired the queue to it: a new endpoint
(`GET /api/jobs/prepare-dashboards`, `web/src/app/api/jobs/prepare-dashboards/route.ts`)
now selects due-soon readers, enqueues their prepare job, and drains the queue (bounded to
10 jobs and roughly 200 of the endpoint's 300-second budget per run, so one slow run can
never eat the whole window), and a SECOND, independent job inside the existing
`.github/workflows/digest-cron.yml` calls it every hour alongside the existing digest
dispatch. **Still no effect at all today**, on three separate counts: the workflow change
itself is not yet pushed/merged (a separate explicit yes); the master switch
(`PEER_DASHBOARD_PREPARE`) defaults off; and turning that switch on with the dashboard
ledger switch still off degrades to a truthful no-op rather than wasted work (see the flag
table above). The lead time was raised from the earlier PROPOSED 45 minutes to 90 minutes
this pass — 45 could, and sometimes would, put a "prepared" result minutes AFTER a
reader's expected check-in rather than before it, once GitHub's own once-an-hour timing is
accounted for; 90 guarantees at least 30 minutes of genuine head start in the worst case.
Also fixed this pass: a prepared result is now filed under the same day-key a real visit
would look it up under (previously, for anyone whose expected check-in time crosses a
world-clock midnight relative to their own local day, a prepared result could have been
filed under a day nobody ever reads — latent today only because no account has its own
time zone set yet, see decision 3 above). A cooldown-gated MANUAL "prepare mine sooner"
request (as opposed to the automatic once-an-hour scheduling above) remains deliberately
unwired this pass — item 15 stays Partial for that one path specifically; the retry/backoff
timing itself is still PROPOSED, not sourced from any external requirement; only the
15-minute cooldown length itself is sourced (from the original engineering plan). Proof
that the queue behaves correctly under real concurrent database access (two workers racing
to claim the same job, a crash mid-job, a real retry) still needs an actual database,
which this campaign does not have, and stays blocked regardless of any of the above.

### 2b. Version rule for duplicate-paper detection — new this pass (P5-S4)

**STATUS: VERIFIED_OFFLINE_BOUNDED.** This is the THIRD implementation of this rule
(see the two-round failure history below). A fresh, independent reviewer built 41 of
their own test cases from scratch (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`) —
none reused from the implementer's own or either prior reviewer's checkpoints —
spanning every combination this campaign's brief required (tracking-number shape,
title shape, author shape, year gap, and paper-group shape, including chains, hubs and
cliques) and ran them against the real code: zero mismatches against the ruling
anywhere, no false merges, no false splits beyond the accepted costs stated below.
Both required deliberate breakages of the fix (removing the pairwise check entirely;
loosening "every" to "some") broke exactly the tests they were meant to break,
confirming the tests genuinely exercise the fix rather than passing by coincidence.
Every claim below reflects this independently-confirmed status; see "Independent
review, now complete" below for the full account.

**What triggered this.** After the local merge with `origin/main` (§0b) landed, a
manual smoke check of the running app on the merged code — not any of the 4467
automated tests, all of which stayed green — found the home page's starter sample list
showing the same paper three separate times, each time under a different repository
copy with a different DOI (a common pattern: a hosting site such as Zenodo mints a new
DOI per version of a paper). `docs/jev-abc/MERGE-A-20260924T203103Z.md` independently
confirmed this gap existed in the merged code before any fix and was not caught by the
merge's own from-scratch gate run.

**The rule, as it stands now (third and, independently verified, final form).** Two paper
records are VERSIONS of one work — and merge into one, carrying every version's
DOIs/ids as aliases so none of them can resurface later — only when ALL of: their
titles normalize to exactly equal text, they share a title alias of at least 4 tokens
of length ≥3, their first authors' surnames match, and their publication years are
within ±1 of each other ("directly satisfies the version rule," below). Two records
that meet all four conditions merge even when their DOIs or other ids differ — ids are
never part of this specific test. On top of the four conditions, when three or more
already-clustered GROUPS of records are chained together by these pairwise matches (for
example A matches B, and B matches C, but A and C were never checked against each
other directly), the WHOLE chain is now allowed to merge into one work only if EVERY
record in it, compared against EVERY OTHER record in a different group, ALSO directly
satisfies the same four conditions — not just its immediate neighbor in the chain. If
even one such pairwise comparison fails anywhere in the chain, NONE of the groups in it
merge; every one stays its own separate paper. Ids play no role anywhere in this
decision, direct pair or chain. Both records stay separate whenever first-author
surnames differ, either side has no listed authors, or the shared title is
short/generic (no qualifying title alias).

**Why THREE implementation rounds were needed — this project's own "stop and change
approach" rule fired.** The first attempt
(`docs/jev-abc/DEDUP-FIX-C-20260924T203339Z.md`) simply deleted the old id-conflict
check outright, relying only on the four conditions above. A fresh, independent review
(`docs/jev-abc/DEDUP-FIX-A-20260924T205613Z.md`) reproduced the original bug as fixed,
but FAILED that implementation as too wide, with two concrete adversarial
reproductions: a chain of 3+ papers each only one year apart from its immediate
neighbor could merge its two ENDS despite them never directly satisfying the four
conditions against each other ("transitivity"); and one paper strongly matching two
different candidates by id could pull an otherwise-unrelated third paper into the same
merged group ("hub"). The second attempt
(`docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`) reinstated a narrower version of the
old id-based check: two groups were kept apart only when a specific pair between them
shared an id TYPE (say, both had a DOI) with different values, and that pair did not
itself pass the four conditions. A SECOND fresh independent review
(`docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md`) found this still went wrong whenever
the paper responsible for the chain or hub problem had no id at all, or had an id of a
different kind than the papers it was being compared against — which is the ORDINARY
case for a paper that only ever matches on title and author to begin with (if it had a
matching id, it would already have merged in an earlier, simpler step). Two rounds in a
row failing the same slot in two different shapes is this project's own signal to stop
patching one case at a time; the manager ruled a structural replacement instead (the
"chain must fully agree, not just its neighbors" rule described above), independent of
ids entirely, implemented in this third round
(`docs/jev-abc/DEDUP-FIX3-C-20260924T220641Z.md`).

**Where this rule reaches.** `dedup.ts`, the hybrid-ranking (RRF) clustering in
`pipeline.ts`, and the channel-comparison harness in `channel-comparison.ts` all
import one shared implementation from `feed/paper-identity.ts` rather than keeping three
separate, independently-maintained copies (consolidated as `R3-CLEANUP-3`, VERIFIED
last round — untouched by this round's change). This means dashboard-delivery identity,
de-duplication, and RRF clustering cannot silently disagree about which records are the
same paper.

**What the implementer's account claims, now independently reproduced:** RED before
the fix (13 adversarial-shape tests — the full set from both prior independent
reviews, plus permutation and "false-split guard" coverage — 7 failing exactly as the
structural-rule ruling predicted, all in the shapes the id-based approach could never
see: a chain or hub with no id at all, or with an id of the wrong kind) → GREEN after
(46 of 46 in the two directly-affected files; 564 of 564 across the full focused suite,
which is the prior round's own 554 plus these 10 net-new tests); two required
mutations each broke exactly the tests they were meant to break, with the second one
cleanly isolating only the hub-shaped tests for a structural reason (a chain's groups
only ever have one record each, so "some" and "every" ask the same question there — the
mutation could only show a difference where a group has more than one record, which is
exactly the hub shape). The independent reviewer's own gate run (a cold session, not
copied) reproduced the 564/564 focused and 4481/4481 full counts exactly, `tsc` clean,
`eslint` 0 errors/149 warnings (see §7 for exact numbers); its own separately-built
41-fixture harness then ran both required mutations again from its own scratch code
and got the same qualitative result — every "stays separate" test breaks when the
pairwise check is removed, and only the hub-shaped tests break when "every" is loosened
to "some" — independently confirming the structural explanation above rather than
merely trusting it.

**Independent review, now complete: this third round passed.** Per this campaign's
own rule, nothing implemented by C counts as done until a separate, independent A has
reproduced it from scratch — that has now happened
(`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`, VERIFIED_OFFLINE_BOUNDED). The two
PRIOR rounds' own review cycles are exactly why this document was being this careful:
both times, an implementation that looked complete and gate-clean turned out to have a
real, reproducible gap once an independent reviewer built their own adversarial
fixtures rather than trusting the implementer's own tests. This third round is the
first of the three to come back clean on that same kind of fresh, independently-built
adversarial pass — 41 fixtures, none reused from any prior checkpoint, zero
mismatches. A comment-only documentation drift the same review found in two unrelated
files (stale wording still describing the SECOND round's mechanism as current) has
also been fixed and independently verified (`R3-CLEANUP-4`, VERIFIED_OFFLINE_BOUNDED,
per `docs/jev-abc/P4-S9-A-20260924T230835Z.md`).

**Accepted costs, set by the manager's own ruling, not decided unilaterally by any
implementer — restated for the structural rule, unchanged in substance from the prior
round's own accepted costs:**
- A chain or cluster of papers where even one pairwise comparison between two of its
  records fails now shows every record in it as a SEPARATE, near-duplicate-looking
  entry, rather than guessing which ones truly belong together. This trades a small
  amount of visible near-duplication for never silently deleting a paper that turns out
  to be genuinely different — the same "ambiguous weak component" cost the original
  clustering rule already accepted (§1p.G(3)), now reached by a clearer, id-independent
  rule.
- Two distinct works by the same author, sharing an identical long title, published in
  consecutive calendar years (for example, an annual report or a recurring
  lecture-note series) will still merge under this rule, because as a direct pair (not
  a longer chain) they satisfy the four conditions on their own. Accepted because the
  alternative reintroduces the original visible-duplicate bug, and because Peer's own
  freshness window rarely puts two full years of the same recurring series into one
  day's results anyway.
- "Version merges spanning different calendar years" remains a named, tracked category
  for whoever next reviews retrieval quality, not a silent side effect.

**Independent reviewer's own tallies, from its own fixture set
(`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`):** 8 ambiguous weak components
(chains/hubs correctly kept split) and 1 calendar-year-spanning merge (the accepted
cost above, correctly merged) — both counts are from deliberately constructed test
fixtures, not observed real data. Checked against the 3 real duplicate pairs from the
original smoke check specifically: 0 ambiguous components and 0 calendar-year-spanning
merges — each was a clean, unblocked direct pair, one week apart, the same calendar
year.

**Informational finding from the same review, not a defect in this fix:** an accented
letter and its plain equivalent (for example, a title spelled with "é" versus one
spelled with a plain "e") do not currently normalize to the same text before
comparison — the existing cleanup step turns the accented character into a blank space
rather than converting it to its plain form. Two records for the literal same paper
could therefore fail to link if one source's copy is accented and another's is not.
This sits in a different, pre-existing, unrelated piece of code that this rule did not
touch and does not change — recorded here for whoever next reviews retrieval quality,
not treated as a blocker.

### 3. Rollback

#### 3.1 Flag-off behavior

| Flag | Turning it off | Data left behind |
|---|---|---|
| `PEER_DASHBOARD_LEDGER` | Reverts to pre-ledger exclusion behavior exactly | Ledger tables untouched, become inert (no delete path exists) |
| `PEER_DIGEST_DEDUPE` | Reverts to the old 6-hour-window check | Additive column/index/function harmless, never read by the old path |
| `PEER_JEV_BROKER` | Broker never attempted | No persisted state of its own. **Broker-transport rollback only** — the shadow flag's own eligibility gate now checks `resolveJevTransport() !== "disabled"` (JEV-DIRECT §1aa), which stays reachable via the direct transport if `JEV_API_KEY` is set. To stop the shadow hook entirely during an incident, also unset `JEV_API_KEY` (or turn off `PEER_JEV_SHADOW` — see its own row below, always sufficient regardless of transport). |
| `JEV_API_KEY` (JEV-DIRECT §1aa, new this pass) | Direct transport never attempted. `resolveJevTransport()` re-evaluates: falls back to broker if `PEER_JEV_BROKER` is "on" and configured, else disabled — same shape as the existing `PEER_JEV_BROKER` row, no persisted state of its own. | Nothing — this is a credential, not a feature with its own state. Already-written decision-cache rows and cost-log lines from calls made while it was set stay (regenerable, non-guarantee-bearing, same as the `PEER_JEV_SHADOW` row below). |
| `PEER_JEV_TRANSPORT` (JEV-DIRECT §1aa, new this pass) | Reverts to auto-detect (direct if `JEV_API_KEY` set, else broker if configured, else disabled) — unsetting this alone never disables Jev by itself, it only removes the forced choice. | No persisted state of its own — a plain env read, same shape as `PEER_JEV_BROKER`. |
| `PEER_JEV_SHADOW` | Hook stops being supplied to the pipeline; the visible feed response is unchanged even while on, by construction | Already-written decision-cache rows and cost-log lines stay (regenerable, non-guarantee-bearing) |
| `PEER_JEV_GEMINI_FALLBACK` | Shadow runs Jev only, exactly as if this flag never existed — same construction as `PEER_JEV_SHADOW` above | Any already-written fallback-sourced answers stay (regenerable, non-guarantee-bearing, same as above) |
| The 5 channel flags | Pool-cache entries simply stop including that channel's candidates | No persisted state of their own |
| `PEER_RANK_FUSION` | Reverts to the plain, pre-fusion ranking exactly, by construction | The optional fused-ranking provenance field on a cached pool is simply absent again; old and new cached pools both stay valid either way |

#### 3.2 Rollback SQL — one authored file per migration

**Eight files now exist** at `web/supabase/rollback/*_rollback.sql` (was seven as of the
last version of this document — an 8th migration, `20260925000000_company_spend_budget.sql`
(SPEND-CAP, §1a), landed since, and has its own rollback file), one per file currently in
`web/supabase/migrations/2026092*.sql`, plus `web/supabase/rollback/README.md`
explaining the folder's convention. **None of these eight files is ever applied
automatically by anything** — confirmed by this session's own gate sweep (§7). Each
file's header states, verbatim: it is not a migration and is never applied
automatically; which forward migration it reverses; exactly what it destroys; whether
that data is regenerable or guarantee-bearing; and the drop order (reverse of the
forward migration's own dependency order).

Ranked highest caution first (see the README for the full reasoning):

1. `20260924000000_dashboard_delivery_ledger_rollback.sql` — breaks the "never
   resurfaces" guarantee retroactively for every user; the ledger table has no
   expiry column by design. Never run without an export.
2. `20260922010000_profile_feed_intent_rollback.sql` — destroys user-typed research
   intent, not system-computed state. Never run without an export.
3. `20260924000300_briefing_deliveries_dedupe_rollback.sql` — touches an
   already-applied, already-live production table.
4. `20260922000000_private_paper_pools_rollback.sql`, `20260924000400_private_decisions_rollback.sql`,
   `20260924000500_dashboard_rollover_rollback.sql`, `20260924000600_dashboard_prepare_jobs_rollback.sql`,
   `20260925000000_company_spend_budget_rollback.sql`
   — all five regenerable/cache-or-config-like, still covered by the same "never without a
   backup" rule as a blanket policy. The job-queue table remains lowest-stakes of the eight:
   by design nothing in it is a record of anything that already happened, only a scheduling
   note for work not yet done, and nothing triggers that queue at all yet (§2) — so today
   there is nothing live for this rollback to actually interrupt. The newest one
   (SPEND-CAP's two tables) is regenerable operator configuration only, with one asymmetry
   worth knowing before running it: the price table has no code-level default, so losing it
   while the spend cap is switched on makes the cap MORE restrictive, never less — see that
   file's own SPEND-SAFETY NOTE.

**Open item folded into this document (manager addition):** `private_paper_pools` has no
retention or cleanup policy at all today — rows accumulate indefinitely. This applies
today to its existing per-owner daily paper-pool cache rows, and will also apply, once
built, to a second dataset planned to share the same table (a per-owner daily cache of
the read-time recommendation channels from §2 Group A4, under a distinct key prefix).
Deciding a retention period is itself a separately-approved-retention-plan decision —
i.e., a user decision, adjacent to but not one of the 6 tallied in §8 — and nothing may
delete rows from that table until it is made. See
`20260922000000_private_paper_pools_rollback.sql`'s own header and
`web/supabase/rollback/README.md`'s "Known open item" section for the full detail.

A migration-to-rollback parity test (`web/src/lib/release/rollback-parity.test.ts`)
mechanically checks that every campaign migration has a matching rollback file carrying
the required header phrase, so a future migration added without a rollback design fails
the test suite rather than silently shipping unreviewed. RED confirmed before the
rollback files existed (14 of 15 assertions failed); GREEN confirmed after (15 of 15
passed) — see §7.

### 4. Secrets placement (names only — values are never in this document or any source it draws from)

| Secret | Vercel/Next server env | Supabase Edge secret | Forbidden on Vercel by the BYOK production guard? | `NEXT_PUBLIC_`? |
|---|---|---|---|---|
| `JEV_API_KEY` | **Reversed this pass (JEV-DIRECT §1aa) — was "Never," now Yes.** The user's own decision: simpler setup (one Vercel variable, no Edge deploy) over the key living in a separate hidden room. Read in exactly one Next-side file, `src/lib/decisions/jev-direct-client.ts` — server-only (`import "server-only"`), a repo-wide placement scan enforces this stays true. | Yes — still allowed to live there too (dormant, selectable via `PEER_JEV_TRANSPORT=broker`) | **No, since this pass** (manager ruling §1ab P1: ALLOWED and SILENT — an optional, default-off feature; joins neither the required nor the warn-on-missing list) | Never |
| `PEER_JEV_TRANSPORT` (JEV-DIRECT §1aa, new this pass) | Yes — a plain config value, not a secret | N/A | N/A — not a credential, nothing to forbid | Never |
| `PEER_JEV_BROKER_SECRET` | Yes — Next authenticates its own call to the broker with it | Yes — the broker verifies it | No — correctly absent from the deny-list, Next genuinely needs this one | Never |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | N/A (separate, pre-existing Next-side vars) | Yes — platform-provided | N/A | Never |
| `OPENALEX_API_KEY` | Yes | No | No | Never |
| `PEER_JEV_PER_USER_DAILY_CAP` / `PEER_JEV_GLOBAL_DAILY_CAP` | **Corrected (was self-contradictory — see §1's row above, which was always right):** read on the Next side by function `readJevShadowConfig()`, `web/src/lib/decisions/flag.ts` — the SAME function §1's flag-inventory table cites. The narrower true statement this row used to overstate: `web/src/lib/decisions/broker-client.ts`'s `BrokerClientOptions` receives the two ALREADY-RESOLVED numbers only as plain function parameters — it does not read `process.env` a second time itself. | Yes | N/A — caps, not credentials | Never |
| 12 operator-AI provider names (Google/Anthropic/OpenAI/Qwen/DashScope/DeepSeek families, plus the digest-provider override) | Forbidden in production/preview (BYOK-only policy) | N/A — not part of this campaign | **Yes**, all 12 | Never |

### 5. Evaluation plan

**No dataset, no threshold numbers, and no held-out result exist anywhere in this
campaign as of this writing.** This section describes a plan, not a measurement.

**Dataset:** an independently labeled pilot of about 200 project-paper pairs across
HR/organizational topics, statistics, and a materials-science control group — explicitly
"a pilot, not a universal quality certificate." Tuning and held-out sets must be disjoint
**by project** (if any pair from a project is used for tuning, no pair from that same
project may appear in the held-out set, even a different paper). Label provenance and
adjudication of disagreements must be recorded. Ground truth may never be generated by
the same model being evaluated (rules out using Jev, or any single AI under test, to
label its own evaluation set).

**Labelling protocol (ruled, not left open):** two independent domain labellers plus a
named tie-breaker, none of whom wrote any of Peer's retrieval or ranking code. Who they
are is user decision 6 (§8).

**Three comparison arms**, on the same source snapshot where feasible: (a) unchanged
baseline; (b) hybrid retrieval plus deterministic ranking; (c) hybrid plus Jev. Source
ablations: Semantic-Scholar-only / OpenAlex-only / union, keyword-vs-seed, and counts of
uniquely relevant papers per source — vendor claims may never substitute for these.
Arm (b) needs the hybrid-ranking feature (flag name `PEER_RANK_FUSION`, now built —
see §1/§2 — with its flag-off state code-reviewed offline and, as of this pass (P5-S4),
both pre-flip accuracy fixes landed and independently VERIFIED,
`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`) code-complete and force-enabled for the
pilot's own test traffic only — this does not require or wait for that flag's
production default to flip, which is this evaluation's conclusion, not its
precondition. The two pre-flip fixes have now landed, closing the contamination risk
this paragraph previously flagged. Separately: the duplicate-paper version rule (§2b)
that this arm's own de-duplication step relies on has since been independently
reviewed and VERIFIED (`docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`), closing the
risk this paragraph previously flagged for that rule too — this arm's de-duplication
step no longer needs to be treated as provisional on that account.

**Named metrics, with pinned definitions where the source campaign didn't already fix
one** (pinning is a manager ruling, made before any held-out data exists, changeable only
before a held-out result is seen):

- Recall in the judged candidate set (explicitly not a corpus-wide recall claim).
- Precision@10.
- **Ranking quality = nDCG@10**, computed with graded labels 0/1/2, gain
  <code>2^rel − 1</code>, discount <code>log2(rank + 1)</code>, ideal ordering taken from
  that project's own judged labels, mean over projects with a bootstrap 95% interval.
- False-negative technical-sense cases (the 5 finite adversarial sense categories already
  exist offline; the pilot-scale labeled version does not yet).
- Unknown rate (needs live Jev decisions — blocked on user decision 4).
- New-discovery vs. never-shown-rollover share.
- **Lifetime dashboard duplicate count** = per owner, the number of papers in a served
  dashboard batch whose identity (its canonical key, or any of its known aliases) matches
  a paper in an earlier served batch for the same owner. Target: 0. Measurable only in
  the ledger-mode path (the non-ledger path keeps no server-side delivery record to check
  against).
- Per-active-user cost, cache hits, source failures, p50/p95 readiness.
- **User-level quality breakdown** = every metric above reported per project (and per
  user, when a user has more than one project), each with its sample size — never only a
  single pooled average across everyone.

Report sample counts and uncertainty alongside every number — never only a percentage
uplift.

**Pre-registration rule — currently OPEN, no numbers set:** before any experimental
rollout, the manager must set a quality non-inferiority tolerance and a per-user budget
ceiling from baseline evidence, and record both **before** seeing any held-out result.
Leaving these thresholds unresolved keeps the production gate open, regardless of how
good the code looks. All actual billed experiments additionally need an approved spend
ceiling and safely configured credentials — a user saying "I have a key" is not evidence
that a live call has happened.

**Structural target (quoted in full):** "0/18 unexplained functional gaps, no new
deterministic test regressions, zero observed cross-user leak in adversarial tests, and
independently checked real pipeline cases."

**Metric code lives in a new, dedicated module** (evaluation-only — separate from the
existing channel-comparison harness, which measures overlap/uniqueness between retrieval
channels, a different and narrower thing than the three-arm comparison above). That
module is a different work item (P5-S2), running in parallel with this document.

### 6. Acceptance matrix snapshot (18 items)

Source: the 18-item frozen list in `ABC-JEV-INTEGRATION.md` §3d. Status column reflects
the most recent independent check found on disk as of this writing; a blocked or
in-flight item is never counted as passed. This is a snapshot, not a live query — several
items changed status within the hours before this document was written, and more will
change after it.

| # | Short description | Status | As of / source |
|---|---|---|---|
| 1 | Project/challenge preserved, no dummy-keyword requirement | Passed offline check | 2026-09-24, P1 baseline; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 2 | Domain senses/aliases kept separate (HR conflict, conflict-of-interest text, software conflict, statistical/material meaning) | Passed offline check | 2026-09-24, P1 baseline; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 3 | License ledger and visible attributions; no unapproved dictionary import | **Corrected (was stale — this read as a flat failure; the mechanism itself passes):** the license ledger, source allow-list, and checksum/verification mechanism are independently VERIFIED offline (26/26 tests). Zero real licensed vocabulary is imported — correctly so, since this campaign is explicitly forbidden from fetching one without further user authorization; that is the intended state, not a failure. | 2026-09-24, P1; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 4 | All 5 candidate channels demonstrated; live comparison honestly reported | Partial — the topic-based channel's wiring to a real source of topic ids, the advisor-citation channel, the per-owner daily cache, and the S2 both-sides conflict rule remain independently VERIFIED offline (one disclosed, accepted, low-severity open item — see §2 Group A4). **New this round: the live comparison itself has real data for the first time**, from one internal evaluation authorized by the user (§1u) and run twice. The first full run stopped at call 2 on a genuine Semantic Scholar rate limit (429), producing zero comparison data; the stop rule was amended (§1w AMENDMENT — a single S2 429 now gets a cool-off and one retry, a second blocks only further S2 calls, an OpenAlex 429 still stops everything) and independently re-verified, then re-run once more. That second run completed all 7 inputs on 46 of a 150-call ceiling (≈$0.024 of OpenAlex's free daily allowance; Semantic Scholar is free). Per-channel reliability: the keyword search on both providers and the OpenAlex topic-field channel succeeded on every one of the 7 inputs; the OpenAlex semantic-search channel timed out (not rate-limited) on 3 of 7; the two seed-based channels only had seeds to run on the one synthetic battery-materials profile — the Semantic Scholar seed-recommendation channel succeeded (20 results), the OpenAlex seed-similarity channel timed out both attempts, and 2 of its 3 named seed DOIs resolved (the third: a genuine Semantic Scholar data gap — HTTP 404 — not a rate limit). Semantic Scholar and OpenAlex keyword results overlap very little on every input (0-12 works shared out of 50-108 unique total per input) — a large mutual union gain, meaning most of what either provider finds, the other one doesn't. **Relevance is still NOT MEASURED** — no label has been invented; a 40-row blinded sample (channel names hidden) is ready and was sent to the user to label. This item stays Partial for two reasons: relevance judging hasn't happened yet, and one internal run across 7 inputs is a harness shakedown, not a benchmark. | 2026-09-24, P2 baseline; updated P5-S3 from P2-S4c+d C; updated P5-S4 from P2-S4cd fresh A + P2-S4d-FIX fresh A; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md`; **updated R4-DOCS (Round 4) from `docs/jev-abc/LIVE-EVAL-4-A-20260925T052639Z.md` + `docs/jev-abc/LIVE-EVAL-4-FIX-A-20260925T055351Z.md`** |
| 5 | A zero-literal-match positive result survives every path; exclusions still work | Passed offline check | 2026-09-24, P2; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 6 | Duplicate-paper detection preserves origin and handles edge cases safely | **Corrected (was stale — this read as a failing, in-progress review; it has since passed):** Passed offline check. A live smoke check of the merged code (not any automated test) found 3 duplicated pairs in a real 10-paper list; two narrower, id-based fixes each failed their own independent review in a new shape (first: merged genuinely different papers in rare chain/hub cases; second: still missed chains and hubs where a bridging paper had no id at all, or an id of a different kind). A third, structural fix — checking every paper in a suspected group directly against every other paper in it, never comparing ids at all — closed the whole class and was independently VERIFIED from 41 freshly-built adversarial test cases, zero mismatches found. See §2b for the full three-round account. | 2026-09-24, P2 baseline (offline-only fixtures); regression found and fixed across three rounds (`docs/jev-abc/DEDUP-FIX-C-*`, `DEDUP-FIX-A-*`, `DEDUP-FIX2-C-*`, `DEDUP-FIX2-A-*`, `DEDUP-FIX3-C-*`); independently VERIFIED `docs/jev-abc/DEDUP-FIX3-A-20260924T222925Z.md`; re-confirmed in the end-of-round re-measurement `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 7 | Hybrid ranking (RRF) deterministic, balanced, capped, diverse | Passed offline check — the feature is built; its flag-off state (nothing changes) is independently verified offline; the ranking computation is code-reviewed and its shipped shape is deterministic/capped as designed; the 2 accuracy gaps review found are now both fixed and independently VERIFIED (`docs/jev-abc/P2-S6-FIX-A-20260924T153735Z.md`). Flag stays off in production pending the separate §1p.B(1) evaluation sign-off — a deliberate gate, not an unresolved defect | 2026-09-24, P2 baseline; updated P5-S3 from P2-S6 fresh A; updated P5-S4 from P2-S6-FIX fresh A ("acceptance 7 PASS offline as implemented"); re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 8 | Same public request reuses retrieval; different scopes never collide | **Partial** — the within-process reuse/coalescing mechanism and collision-freedom (including across differing senses, filters, and private scopes) are independently VERIFIED offline; the clause requiring the SAME public request across different users/processes to reuse retrieval needs the shared public retrieval cache, which stays BLOCKED per §1k (built but deliberately unwired) | 2026-09-24, P2; refined by the end-of-round re-measurement and manager reading, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md`, `ABC-JEV-INTEGRATION.md` §4 2026-09-24T22:44:41Z |
| 9 | Personal data fully isolated between users, including adversarial two-user tests | **Blocked** — offline mechanics pass; the real two-user database proof needs a database this campaign does not have | 2026-09-24, P0; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P1-20260924T2230Z.md` |
| 10 | Jev's data format, typed unknowns, score checks, version pinning, fault handling | Passed offline check (no live Jev call has ever been made) | 2026-09-24, P3; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 11 | Unchanged input reuses cache; changed input invalidates only the right layer | **Partial** — the cache-key invalidation rule itself (owner+project+intent+content+provider+model+rubric, no date/clock in the key) is independently VERIFIED offline and is wired into the shadow-decision runner; nothing reaches it live yet because the Jev shadow and broker flags both stay off by default, not because the wiring is incomplete. A separate cache layer for full report content was not independently re-verified this round — open item, not a failure | 2026-09-24, P3; refined by the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 12 | Company keys never reach the client or logs; spend limits are atomic and can't be doubled | **Updated this pass (SPEND-CAP built; still Partial, for a narrower reason than before).** The Jev/broker path itself passes offline: ordered atomic per-user/global daily-call reservation, the company AI key never reaches the client or logs, and the Edge side uses its own separate counter namespace. The general-AI gap this row used to flag ("no dollar or call-count ceiling on ordinary feed re-ranking, short reports, query generation, figure matching") now HAS a built mechanism — an atomic, ordered (per-user then global, mirroring the Jev path's own fix) reservation covering all 9 real company-funded call sites, with settlement to actual usage and its own dedicated, independently-runnable test suite (`company-budget.test.ts`, `metered.test.ts`, `route.test.ts`). **Still Partial, because:** (1) it ships OFF by default (`PEER_COMPANY_SPEND_CAP`, §1a) — today's real, deployed behavior is unchanged until an operator flips it; (2) the two dollar numbers are the code-level defaults ($5.00/$0.50/day), which the user confirmed on 2026-09-27 as the intended ceilings (ABC-JEV-INTEGRATION.md §1ac); (3) **Corrected (was stale — this used to read "it has not been independently reviewed... not something C can self-certify"): a fresh, independent reviewer has since checked it (13 of 13 checks PASS, each with its own evidence — direct code reads, from-scratch probes, and 4 deliberately-broken-then-restored mutations spanning the flag gate, reservation order, settlement accumulation, and null-owner scoping, `docs/jev-abc/SPEND-CAP-A-20260925T052950Z.md`, VERIFIED_OFFLINE_BOUNDED).** What independent review cannot close: like every other item in this campaign, this has only ever run against fake/recorded data — proof against a REAL, live database (the migration actually applied, real concurrent writers, a real outage) stays BLOCKED, because this campaign has no database to test against (§1k), unchanged from every other offline slice; (4) one narrow, disclosed gap remains by manager ruling, not by oversight — one call site (the feed's Tier-2 re-ranking step, plus any other call reached without a signed-in owner attached) counts only against the shared global ceiling, never a specific person's, because threading an owner id that deep risks changing a shared cache key elsewhere in the pipeline; this is accepted as low-risk (sub-cent worst case per call, already bounded by an existing hourly count limit) rather than fixed inline. The Edge Function's own entitlement/tier check is also still absent (accepted cost, §1p.I, unchanged from before). **Activation, in order, still needs:** the migration applied to a real Supabase database (never done by this campaign), at least the required per-model price rows entered by hand (mandatory, no code default), the two dollar ceilings optionally confirmed or changed, and the flag switched on — and before any of that can reach production, this branch's Round 4 work merged to main, which it is not: SPEND-CAP's changes are not yet even committed locally (unlike Round 3's `e6a42030`), per SPEND-CAP-A's own checkpoint. | 2026-09-24 (Jev-path fix verified 11:52 UTC); re-scoped by the end-of-round re-measurement and manager reading, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md`; updated 2026-09-25 by SPEND-CAP's own checkpoint; **independently VERIFIED_OFFLINE_BOUNDED the same day, `docs/jev-abc/SPEND-CAP-A-20260925T052950Z.md`** |
| 13 | A durable delivery queue survives duplicate sends, two workers, crashes, timeouts | Partial, reachability gap now closed — the offline job-queue engine (due-time math, retry/backoff, a memory-backed and a real-database-backed repository, fencing against stale data) is now driven by a new, default-off endpoint (`GET /api/jobs/prepare-dashboards`) called every hour by a second job in the existing digest-cron workflow, gated behind `PEER_DASHBOARD_PREPARE` (also hard-depends on `PEER_DASHBOARD_LEDGER`) — see the flag table above and TRIGGER-A's own checkpoint, `docs/jev-abc/TRIGGER-A-C-20260925T053859Z.md`, now **independently VERIFIED_OFFLINE_BOUNDED** by a fresh A (`docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`, 14 checks incl. a 672-combination lead-time probe, a 9-case cross-timezone date-alignment probe, and 3 restored mutations). Two overlapping runs sharing one durable queue were proven offline to never double-prepare (the worker's own already-prepared short-circuit). **Accepted cost P7b (named this pass):** the same review found that `buildPool` never reads yesterday's rollover pool either, not only never writing to it (the existing P7 accepted cost) — so a prepared batch's candidate pool is always a strict subset of what a same-moment real visit could mint: narrower only, never wider, never re-delivering a paper already shown; now guarded by its own dedicated protective test (`web/src/lib/dashboard/prepare-pool.test.ts`). What remains Partial: proof under REAL concurrent database access (two workers racing for the same job, a crash mid-job) stays blocked — this campaign has no database to test against; the cooldown-gated MANUAL "prepare sooner" path (as opposed to the automatic hourly scheduling) remains deliberately unwired — see item 15 | 2026-09-24, updated P5-S3 from P4-S8b fresh A; reachability closed by TRIGGER-A, `docs/jev-abc/TRIGGER-A-C-20260925T053859Z.md`; **independently VERIFIED_OFFLINE_BOUNDED 2026-09-25, `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`; P7b protective test added by R4-DOCS** |
| 14 | Scheduled feed ready ahead of your reading time; time-zone-safe; honest status | Partial, reachability gap now closed — the time-zone math for the existing scheduled email remains proven correct; the "get results ready ahead of time" engine (see item 13) is now reachable via the same hourly trigger, with the lead time raised from a PROPOSED 45 minutes to 90 (45 could realize a NEGATIVE lead — a result ready minutes after, not before, a reader's expected check-in — once the hourly grid is accounted for; 90 guarantees at least 30 real minutes ahead) and a fix ensuring a prepared result is filed under the exact day-key a real visit will look it up under (previously could disagree once a reader's own time zone differs from the server's, latent today since no account has one set) — this lead-time bound and the date-alignment fix are now **independently VERIFIED** by a fresh A's own from-scratch probes (672 combinations across 7 zones for lead time; 9 cross-timezone cases incl. a real DST transition for date alignment; zero violations either way), `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`. **Trade-off told to the user plainly (P8):** a prepared batch is always built at AI tier 0 (deterministic ranking only, never the paid AI re-ranking, matching main's own rule that a reader who hasn't visited yet must cost nothing beyond fetching sources) — confirmed by the same review, by direct code read, that a later real visit's existing-batch path serves that prepared batch completely unchanged, with no tier comparison anywhere in that path. So a reader entitled to the paid AI re-ranking who opens a day's feed for the first time via a prepared batch sees the plain, non-AI-ranked version for that whole day, not the AI-ranked version a fresh visit-time build would have given them. Still off by default (both the workflow push/merge and the flag are separate, unmade decisions), and still honest either way: a flag-off or ledger-off run reports a truthful no-op reason rather than pretending to have done something | 2026-09-24, updated P5-S3 from P4-S8b fresh A; reachability + lead-time + date-alignment fixes by TRIGGER-A, `docs/jev-abc/TRIGGER-A-C-20260925T053859Z.md`; **independently VERIFIED_OFFLINE_BOUNDED 2026-09-25 (incl. the P8 tier-trade-off record and the P11 date-alignment fix, each with the reviewer's own from-scratch evidence), `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`** |
| 15 | Manual refresh doesn't waste work; cooldowns and budgets work; just opening the app never triggers AI calls | Partial, most of the way closed — opening the app / checking status never triggers an AI call (confirmed, unchanged); the double-work-on-concurrent-refresh bug (see §2) is now fixed and independently proven under real concurrent requests; the SCHEDULER side of the shared prepare-job queue (item 13) is now wired and draining every hour, bounded to 10 jobs and roughly 200 of the endpoint's 300-second budget per run so one slow run can't consume the whole window — the drain ceiling (own dedicated 15-seeded-jobs test: 10 drained then the remaining 5) and the wall-clock guard (own dedicated test, plus mutation-tested — disabling the check made it drain 10 instead of stopping at 2, exactly as expected) are both **independently VERIFIED**, `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`. A manual-refresh cooldown is built and offline-verified but STILL not wired to any live "refresh now" path — a deliberate choice this pass, not an oversight (recorded as POLICY item 5 in TRIGGER-A's own guide): the shared queue's drain side needed no separate code to also serve a future manual path, but building the user-facing trigger itself was left for a later round. This item therefore stays Partial specifically for the manual path; the automatic scheduling half moved from disconnected to reachable-but-off | 2026-09-24, updated P5-S3 from P4-S8a + P4-S8b fresh A's; scheduler-side wiring by TRIGGER-A, `docs/jev-abc/TRIGGER-A-C-20260925T053859Z.md`; **independently VERIFIED_OFFLINE_BOUNDED 2026-09-25, `docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`** |
| 16 | Only never-before-shown papers compete the next day, across ~20 named edge cases | Partial — the core mechanism passes offline with two small, accepted, documented trade-offs. **Corrected (was stale):** the two "signed in with no batch yet" edge cases are no longer being worked on — both are now fixed and independently verified; what remains is one narrow, named, accepted gap with its own hard threshold before any batchless-mode launch (see the `PEER_DASHBOARD_LEDGER` row in §1). **New this pass:** explicit access to a past day's already-sent batch ("archive") is now built and independently offline-verified, sitting behind the same `PEER_DASHBOARD_LEDGER` switch as the rest of this item — it only ever reads a batch that was already sent to that person, in the exact order it was sent, and never re-picks, re-sends, or records anything. It never mints a batch and never marks one as acknowledged. Where in the product a person would actually reach this (a page, a button, a settings entry) is still an open decision, not settled by this pass. | 2026-09-24, P4 baseline; edge-case fix independently VERIFIED (P4-S5b-FIX3, 14:23 UTC); archive access built + offline-verified this pass (P4-S9); independently VERIFIED, `docs/jev-abc/P4-S9-A-20260924T230835Z.md` |
| 17 | Pool and daily-brief size limits respected; brief vs. deep report kept separate; the no-AI-keys mode still works | Passed offline check | 2026-09-24, P4; re-confirmed in the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |
| 18 | Paired quality/cost evidence, multilingual cases, an independent reviewer, a tested rollback, no invented numbers | **Corrected (was stale — labelled "Not started," which undersold real, verified progress): Partial.** The metric instruments themselves — precision/recall/nDCG, a bootstrap confidence interval (with a guard fix independently verified), and a lifetime-duplicate-count auditor reusing the exact same identity check the live exclusion path uses — are built and independently VERIFIED offline. Multilingual handling is confirmed at the underlying data-truncation layer. Rollback files and their 1:1 match with migrations are confirmed. But the actual deliverable — a paired comparison of the three arms on real project data, with real labels — has genuinely not started: no dataset, no labellers named, no pre-registered quality/budget thresholds, and no held-out result exist anywhere in this campaign yet. No fabricated uplift or savings number was found anywhere. | 2026-09-24 — this document; re-scoped by the end-of-round re-measurement, `docs/jev-abc/FINAL-A-P2-20260924T222946Z.md` |

### 7. Gates run this round (`web/`, all times UTC)

- `npx vitest run src/lib/release/rollback-parity.test.ts` before the rollback files
  existed: **14 failed / 1 passed** (RED, as expected — only the directory-sanity canary
  test could pass with nothing on disk yet).
- Same command after all 6 rollback files + README landed: **15 passed / 0 failed**
  (GREEN).
- Full gate results (FULL `vitest run`, `tsc --noEmit`, `lint`) and the
  `rollback`-reference grep sweep are recorded in this item's checkpoint file
  (`docs/jev-abc/P5-S1-C-*.md`) rather than duplicated here, since they reflect the
  state of the whole branch, not only this document's own files, and this branch has
  several other concurrent writers whose own gate counts change independently.
- **P5-S3 re-ran the same gates fresh** from `web/`, 2026-09-24:
  `rollback-parity.test.ts` **17 passed / 0 failed** (now 17, not 15 — the 7th
  migration/rollback pair added since P5-S1); FULL `vitest run` **212 passed | 1 skipped
  test files (213), 4069 passed | 1 skipped tests (4070), 0 failed**; `tsc --noEmit`
  **exit 0, 0 errors**; `npm run lint` **exit 0, 0 errors, 2 warnings** (same
  pre-existing unused-var warnings noted before, unrelated to this campaign). Exact
  counts and commands are in that pass's own checkpoint,
  `docs/jev-abc/P5-S3-C-20260924T153429Z.md`.
- **P5-S4 (this final-status pass) re-ran the same gates fresh** from `web/`, on the
  merge commit `6f518512` with DEDUP-FIX2 C's uncommitted changes on top (the working
  tree at the time of this pass), 2026-09-24T21:49–21:50Z: `rollback-parity.test.ts`
  **17 passed / 0 failed** (unchanged — still 7 migration/rollback pairs, confirmed
  unaffected by the merge); FULL `npx vitest run --exclude "**/benchmark.test.ts"`
  **246 passed test files (246), 4471 passed tests (4471), 0 failed** (run twice for
  exit-code confirmation, byte-identical counts both times, exit 0 both times — matches
  `docs/jev-abc/DEDUP-FIX2-C-20260924T212607Z.md`'s and
  `docs/jev-abc/MERGE-A-20260924T203103Z.md`'s own claimed counts exactly, confirming no
  drift); `npx tsc --noEmit` **exit 0, 0 errors**; `npx eslint .` **exit 0, 0 errors,
  149 warnings** (same pre-existing warnings noted throughout this campaign, unrelated).
  Plain-language mechanical grep on Part 1 (this pass's own additions included) and a
  secrets grep over both target files were also run this pass — exact commands, counts,
  and this pass's own checkpoint: `docs/jev-abc/P5-S4-C-20260924T214335Z.md`.
- **This round's final gate numbers, from the last fresh, independent gate run**
  (`docs/jev-abc/P4-S9-A-20260924T230835Z.md`, 2026-09-24T23:19:32Z–23:21:19Z, from
  `web/`): `npx vitest run --exclude "**/benchmark.test.ts"` **247 passed test files
  (247), 4514 passed tests (4514), 0 failed**; `npx tsc --noEmit` **exit 0, 0
  errors**; `npx eslint .` **exit 0, 0 errors, 149 warnings** (the same pre-existing
  baseline noted throughout this campaign); `npm run build` **exit 0**, with
  `ƒ /api/feed/archive` present in the route table. The manager independently
  re-ran two of these gates once more after that, 2026-09-24T23:23:37Z–23:23:55Z:
  `npx tsc --noEmit` **exit 0**; `npx vitest run` with no exclude flag (so the
  normally-skipped live-events benchmark file is included too) — **247 passed test
  files + 1 skipped, 4514 passed tests + 1 skipped, 0 failed** (the 1 skipped
  file/test is that opt-in live benchmark, which skips itself outside its own
  explicit opt-in flag — not a new gap). **This pass (P5-S5) is doc-only and did not
  itself run any test/build command** — the numbers above are cited from the sources
  named, not re-executed here.
- **SPEND-CAP's own gate sweep**, from `web/`, 2026-09-25T00:20-00:22Z (full detail and
  RED-evidence log in `docs/jev-abc/SPEND-CAP-C-20260925T044800Z.md`): `npx vitest run`
  first hit a transient Windows worker-spawn error (`spawn UNKNOWN`, an OS/process-level
  flake, not a test failure) on two unrelated files; an immediate clean re-run gave **254
  passed test files + 2 skipped (256), 4628 passed tests + 5 skipped (4633), 0 failed,
  exit 0**. This total includes a concurrent writer's own in-flight work (a live-evaluation
  test harness — confirmed via `git status`, not this item's files); SPEND-CAP's own net
  contribution is +1 new test file (`company-budget.test.ts`, 50 passed + 3 skipped — the
  3 are the documented-BLOCKED SQL-constraint check, no live Postgres reachable here) plus
  +11 tests added to two existing files (`metered.test.ts` +6, `route.test.ts` +5), all
  passing. `npx tsc --noEmit` **exit 0, 0 errors**. `npx eslint .` **exit 0, 0 errors, 149
  warnings** - byte-identical to the P5-S4 baseline above; SPEND-CAP added no new warning.
  `npm run build` **exit 0**, same single pre-existing non-fatal Turbopack NFT warning
  (`pdf-text.ts`, unrelated to this item, present before this pass). One real,
  pre-existing-convention test failure was found and fixed during this pass, not silently
  worked around: exporting three identifiers from `decisions/jev-contract.ts` (needed to
  reuse its CJK-aware token-ratio logic, per this item's own design) broke
  `broker-parity.test.ts`, which requires `supabase/functions/jev-broker/jev-contract.ts`
  to stay byte-identical to its source (that Edge Function's real runtime is blocked in
  every environment this campaign has had, so this parity test is its only verification).
  Fixed by mirroring the identical, export-only edit into the copy file - not a deploy, not
  a database touch, just keeping two checked-in source files in sync as the existing
  convention requires.
- **Round 4 final gates** (added by the manager after `docs/jev-abc/R4-DOCS-A-20260925T064252Z.md`
  flagged that this ledger stopped at SPEND-CAP's mid-round sweep; the numbers below are
  copied from the named independent runs, not re-executed for this bullet). Later runs, in
  order, each including every concurrent writer's work on disk at the time:
  LIVE-EVAL-4-FIX C **256 files + 2 skipped, 4662 passed + 5 skipped, 0 failed**
  (`docs/jev-abc/LIVE-EVAL-4-FIX-C-20260925T054542Z.md`); TRIGGER-A C and TRIGGER-A A
  **257 files + 2 skipped, 4685 passed + 5 skipped, 0 failed**, `npm run build` exit 0 with
  `/api/jobs/prepare-dashboards` in the route table (`docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`);
  final, after the P7b protective test: **257 files + 2 skipped (259), 4686 passed + 5 skipped
  (4691), 0 failed; `npx tsc --noEmit` exit 0; `npx eslint .` 0 errors, 149 warnings**
  (independently re-run by `docs/jev-abc/R4-DOCS-A-20260925T064252Z.md`).

### 8. User decisions — 3 still open (#2, #4, #6); #1, #3, #5, #7 now RESOLVED

1. **Company-funded AI option — RESOLVED this pass (§0b/§1s), in main's favour.** The
   user authorized merging `origin/main`, which adopts main's company-funded AI rules
   (every model-reaching route requires a `ProviderContext`; `requireEntitledAiRequest`
   gates 6 routes; deep reports counted once via `consumeDeepReport`) in place of the
   Jev branch's own stricter, keys-only rule. **The recorded risk stood and is restated
   here because it was live, not hypothetical, at the time:** main's rule capped only two
   specific expensive actions — deep reports and forced full rebuilds — with **no general
   LLM spend cap** on anything else that reaches a model (feed re-ranking, short reports,
   query generation, figure matching). This was the single largest open billing
   exposure in the merged system (independently restated as NEW FINDING 1 in
   `docs/jev-abc/MERGE-A-20260924T203103Z.md`). **Now also un-gates (but does not by
   itself complete) the background-only backup opinion**
   (`PEER_JEV_GEMINI_FALLBACK`, §1/§2 Group B8): that feature is built, off, and
   structurally inert until the company-funded capability it depends on is actually
   wired up — a separate, not-yet-started implementation step, not something this
   resolution alone finishes.
   **SPEND-CAP built this pass (§1a) — the general-cap gap above now has a mechanism,
   still needs the user's numbers.** An atomic, ordered, settle-to-actual-usage dollar
   reservation now covers all 9 real company-funded call sites, ships OFF by default
   (`PEER_COMPANY_SPEND_CAP`), and fails closed on any config/counter problem once on.
   One thing still needs the user, not the code (the other is done: on 2026-09-27 the user
   confirmed the two ceilings — $5.00/day total, $0.50/day per signed-in person — which can
   still be edited directly in the Supabase dashboard, no redeploy, §1a): authorize actually flipping the switch, on the same "your explicit
   go-ahead" basis every other flag in this document needs. **Corrected (was stale — this
   used to say independent review was still pending): a fresh, independent reviewer has
   since checked this build and found it correct (13/13 checks, 4 restored mutations,
   `docs/jev-abc/SPEND-CAP-A-20260925T052950Z.md`, VERIFIED_OFFLINE_BOUNDED) — see
   acceptance item 12. That review cannot substitute for the real-database proof (a),
   (b), and the migration itself still need; nothing here is live.**
2. **Cross-channel dedupe policy.** Should email and dashboard delivery share one
   "already shown" record, or stay fully independent as today?
3. **Who/what triggers the scheduled digest send — RESOLVED this pass: option A
   (§1v).** The user chose to extend the existing once-an-hour GitHub Actions workflow
   that already sends the scheduled digest, rather than create a new schedule: the same
   hourly trigger now also runs the already-built "prepare results ahead of time" job
   queue (acceptance 13/14) and retries a failed digest send (acceptance 15, this also
   resolves decision 5 below), as two new, independent jobs. Both pieces exist in code,
   pass their offline tests, and are independently VERIFIED_OFFLINE_BOUNDED
   (`docs/jev-abc/TRIGGER-A-A-20260925T060520Z.md`). **What choosing the mechanism does
   NOT yet do:** the workflow file change itself has not been pushed or merged to the
   production branch, and its own switches (`PEER_DASHBOARD_PREPARE`,
   `PEER_DIGEST_EMAIL_RETRY`) both still default off — turning any of this on for real
   still needs the same explicit go-ahead every other switch in this document needs.
4. **Live call authorization — still open, though part of its scope has now been
   used.** The user separately authorized (§1u, $0/free-tier only) a bounded INTERNAL
   evaluation comparing Semantic Scholar and OpenAlex on this machine; that evaluation
   ran twice (see acceptance item 4) and made real API calls, but this is explicitly NOT
   the same thing as authorizing live calls inside the product for real users, and it did
   not include Jev at all (no key/broker exists yet). What remains genuinely open: exact
   scope, volume, and a real budget for calls made BY the live product (not a one-off
   internal comparison test), for all three of Semantic Scholar, OpenAlex, and Jev.
   **One sub-question is now answered, as a side effect of that evaluation:** OpenAlex's
   keyless path (`OPENALEX_API_KEY` unset) was used throughout and every request was
   accepted — confirmed by both live-eval A's own credential-presence record
   (`openAlexKey: false`) and by the successful keyword/topic call counts in §6 row 4.
   Unblocks acceptance item 4 fully, item 18, and the entire evaluation pilot in §5.
5. **Automatic email-retry sweep — RESOLVED this pass, folded into decision 3's answer
   (§1v).** A safe one-time retry now runs as one more step of the same hourly timer,
   behind its own separate off-by-default switch. **Corrected (was stale — the manager's
   own §1v write-up first claimed nothing writes the digest email settings and that the
   job finds nobody to send to; a fuller, uncapped grep found this wrong, see §1x):**
   today this step finds nothing to retry not because nobody is enrolled — by default
   every signed-in reader is — but because the on-screen control that would switch a
   reader's own delivery channel to email was deliberately removed from the app on
   2026-04-27 (the sending code itself was kept, dormant); see the new decision 7 and
   the matching Part 1 note for the full account.
6. **Who labels the ~200-pair pilot** — two independent domain labellers plus a named
   tie-breaker, none of whom wrote Peer's retrieval or ranking code (§5). **Accurate note
   (R4-DOCS): this is separate from, and much larger than, the 40-row blinded sample from
   this round's own internal live evaluation (item 4/§1u)** — that smaller sample needs
   only the user's own honest labels, not a named independent labeller or tie-breaker;
   it is not a substitute for naming the three people this decision asks for.
7. **Bring back the on-screen controls for email delivery — RESOLVED this pass, built,
   pending A's independent review (item EMAIL-SETTINGS).** A manager fact-check
   (`ABC-JEV-INTEGRATION.md` §1x, correcting an error in §1v) found that the scheduled
   digest job already runs, hourly, for every signed-in reader by default, and already
   produces a real result each morning — but only as an in-app "Past briefings" entry
   (`GET /api/briefings`), never an email, because the screen that used to expose the
   delivery-channel choice (and the send hour and time zone with it) was deliberately
   removed on 2026-04-27. The underlying send code (Resend integration, the cron path)
   was kept, unmodified, dormant. The user then decided, in chat (`ABC-JEV-INTEGRATION.md`
   §1y point 2): build it. B investigated and designed
   (`docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md`), the manager ruled on B's open
   questions (§1z), and C implemented against those rulings
   (`docs/jev-abc/EMAIL-SETTINGS-C-*.md`). Built, in full:
   - A profile-page section (default: nothing changes for anyone until they switch their
     own `digest_channel` to `'both'` and, with it, `digest_frequency` to `'daily'` —
     §1z P5): daily on/off, send hour, the browser's own detected time zone (saved
     automatically, no picker), and one destination address defaulting to the account
     email.
   - A new, stateless, signed (HMAC) confirmation-link flow for any address other than
     the signed-in account's own — no schema change (`src/lib/email/confirm-token.ts`,
     `POST`/`GET /api/profile/confirm-email`). 24h TTL, re-use allowed by design (a
     confirmation link is conventionally multi-use within its expiry, unlike a
     password-reset token — §1z P4).
   - A **required** write-path guard on `PUT /api/profile`: a client-sent `digestEmail`
     is rejected with `400 { error: "digest_email_requires_confirmation" }` unless it
     equals the account email or the value already stored — closing the gap where a
     confirmation *screen* could otherwise be bypassed by a direct write (F4/§2.3).
   - A new "Send test email" button (`POST /api/profile/send-test-email`), aiTier 0,
     never reaching `resolveProvider` — mirrors the existing dev-only `test-digest` route's
     budget precedent, but works in production, targets only the reader's own confirmed
     address, and is capped **3 per user per day**. The confirmation-request send is
     separately capped **5 per user per day** (§1z P3 — a bigger abuse surface, since it
     reaches an arbitrary typed address). **Both new caps fail CLOSED** on an unreadable
     counter store (§1z P1) — the opposite of this codebase's ordinary rate-limit
     convention, deliberately, because these protect the send budget.
   - `DIGEST_EMAIL_CONFIRM_SECRET` (new, independent of `CRON_SECRET` — a different trust
     boundary). Unset: confirming a DIFFERENT address is unavailable with an honest
     message; the signed-in account's own email still works for everything (§1z P6).
   - `RESEND_API_KEY` / `DIGEST_FROM_EMAIL` — already read by `sendDigestEmail()`, now
     finally documented in `web/.env.example` (previously a genuine gap, not new).

   **The once-per-day guarantee itself is UNCHANGED by this item, and still soft off the
   default flag.** `PEER_DIGEST_DEDUPE` stays off; its migration
   (`20260924000300_briefing_deliveries_dedupe.sql`) is authored but not applied to the
   real database. The flag-off path (`dispatch-digests/route.ts`'s 6-hour look-back
   `insert`, no `local_date`, no `ON CONFLICT`) is a check-then-act race, not atomic —
   sufficient under the real hourly-cron schedule (which can only match one
   `digest_hour_local` per day), but a manual/duplicate trigger of the same route, or a
   same-day change to `digest_hour_local`, can produce a second send. The atomic,
   proven-by-test alternative (`claim_briefing_delivery`, exercised by
   `dispatch-digests/route.test.ts`'s true-concurrency case) requires the user to apply
   that migration to production and then set `PEER_DIGEST_DEDUPE=on` — an explicit,
   separate action this item does not take and does not change the status of. See the
   Part 1 account of this same fact in plain words, right after item 7's own list above.

   **Activation steps, in order, once A's review is done:** (1) set `RESEND_API_KEY` and
   `DIGEST_FROM_EMAIL` in the real deployment's environment (a local `web/.env.local` for
   the user's own first test); (2) optionally set `DIGEST_EMAIL_CONFIRM_SECRET` if
   confirming a non-account address is wanted immediately (otherwise add it whenever,
   with zero effect on anything already working); (3) nothing else is required — the
   per-reader switch on the profile page is the only remaining step, and it is each
   reader's own choice, not a global rollout switch.

**Adjacent, not separately tallied in the 7 numbered items above (3 open + #1/#3/#5/#7
resolved):** the `private_paper_pools` retention period (§3.2) is functionally the same
kind of decision (a separately approved retention/backup plan under the campaign's
evaluation-and-release rules) but was raised after the numbered items above were already
counted, so it is recorded here rather than renumbering.
Semantic Scholar's own commercial-use confirmation is treated as folded into decision 4
(both gate "live Semantic Scholar use") and is likewise not separately tallied.
