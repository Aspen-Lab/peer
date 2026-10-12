# <ITEM> — C (<size>, <theme>): <one line: the rule this item makes true>

Role: C, the implementer. Model: <worker model> (the manager's model only if the usage limit refuses the worker's). **Work in a detached worktree of your own**: `git -C <repo> fetch origin` then `git -C <repo> worktree add --detach <scratch>/<item>/wt origin/<branch>` (the head must contain this brief), then link or copy `node_modules` as the manager says. Commit in the worktree on its detached HEAD, one commit per step, with the path named on the commit (`git commit -m "…" -- <path>`; a new file first `git add -N -- <path>`); **never push, never create a branch**; never rebase / amend / force-push; never `git checkout -- <file>` / `git restore` / `git reset`; never touch the main checkout or the manager's files. No model, no network beyond what the build itself fetches, no key value. Other workers run at the same time in other files — **touch only the files named below as yours**; if you need another file, stop and say so in the checkpoint's "For the manager". If you need a dev server: port <n> only, with the stub, on an invented input (never the user's).

Yours: `<file>`, `<file>` and their tests. Not yours: `<file>` (<whose>), every other file.

Read first: <the last round's deliverable §…>; <the relevant checkpoints>; <the rulings by number>; <the functions by name>.

## The symptom

<What the round measured, with the numbers; the mechanism as far as it is known.>

## The rules

1. **<Rule, testable.>** <Its measure.>
2. **<Rule.>**
3. Nothing else changes: <the things that must stay as they are>.

## Measure

<Before and after, on an invented input: the numbers to report.>

## Gates and the checkpoint

From `<dir>` after each commit: `<typecheck>` 0; `<lint>` 0 errors / ≤ <n> warnings; the touched tests; the full suite (base at your head: <files> + <skipped> / <passed> + <skipped>; the count may only rise); `<build>` 0. One own mutation per rule on the final tree (the rule disabled → its test red), each restored byte-identical (sha256 before = after). The checkpoint `<dir>/<ITEM>-C-<UTC timestamp>.md`, committed last: the commits (hashes), the rules as built, the tests (named; any re-aimed test named), the gates, the mutations, the measurements, "For the manager".

Attribution lines at the end of every commit message: <as the harness mandates for the worker's own model>.

Hard rules: no push, no branch; never delete or weaken a surviving test; no new dependency; no switch or feature flag; nothing per-user; no key value. If the usage limit refuses a command, stop cleanly with the worktree committed and say where. Report in one paragraph: the commits, the rules, the gate numbers, the test delta, the mutations, the measurements, anything unsettled.
