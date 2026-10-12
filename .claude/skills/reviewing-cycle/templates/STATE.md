# <CAMPAIGN NAME> — reviewing-cycle state (the manager's single source of truth)

Branch: `<branch>` · PR: `<url>` · Target: every theme ≥ <N> % in two consecutive rounds · Manager model: <model> · Worker model: <model>

## §0. Resume protocol

1. `git branch --show-current` must print `<branch>`. If not, check it out; never create another branch. `git pull --ff-only` then `git status --short`.
2. Read §1 (whose turn, which item, `STOPPED BECAUSE:`), every ruling in §2, the current round in §4 and the ledger §5. A fresh session is **the manager**, not an implementer.
3. Resume the first unfinished step of the current item; never restart finished work; never redo a VERIFIED item unless a later change invalidates its evidence.
4. After each item, test, role change or stop: append to §4, update the §5 rows, edit §1 in place. Never add a second current-state block.
5. **§1 must always be true.**

## §1. CURRENT STATE

CURRENT ROUND:    <n>
CURRENT ITEM:     <id> — <one line>
HELD BY:          the manager (<model>, session <id>) — the only writer of this file
RUNNING:          <worker> <item> (worktree `<path>`, port <n>) …
LAST PUSH:        <sha> at <UTC>
GATE BASELINE:    <sha> — typecheck <exit>; lint <errors> / <warnings>; tests <files> + <skipped> / <passed> + <skipped>, <failed>; build <exit>
STOPPED BECAUSE:  <one sentence, or "—">

## §2. BINDING rulings (dated, numbered, append-only)

1. **<date UTC> — <title>.** <the ruling, and why>

## §3. The contract every role inherits

- The gates (from `<dir>`): `<typecheck>`; `<lint>`; `<tests>`; `<build>` — separate commands, each exit code recorded.
- Product rules: <the ones every role must keep — nothing fabricated, nothing per-user in shared state, …>
- Git and evidence: one commit per item with the path named on the commit; workers commit on a detached worktree, never push, never branch; never delete a test to pass (re-aimed tests named); every checkpoint records files changed, the gates with counts, before/after, the model it ran on.

## §4. Round log — append only

### Round 1 — <date>

- <UTC> **<what happened> (the manager).** <evidence, numbers, hashes>

## §5. Work ledger — update in place, evidence append only

| id | status / evidence | what | round | verified by | depends on |
|---|---|---|---|---|---|
| R1-01 | RUNNING since <UTC> — C (<model>), worktree `<path>`; `briefs/R1-01.md` | <one line> | 1 | manager | — |

## §6. Backlog

| id | status | what | found by |
|---|---|---|---|
| BACKLOG-01 | OPEN (<UTC>, from <who>) — <size> | <one line, the mechanism and the fix direction> | <item> |
