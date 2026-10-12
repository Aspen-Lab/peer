# <ITEM> — B: <the cluster> — reproduce the cause, design the smallest fix

Role: B, the investigator — **read-only on production code**. Model: <worker model>. Worktree of your own, detached from `origin/<branch>`; you commit only your deliverable `<dir>/<ITEM>-B-<UTC timestamp>.md`; never push, never branch. No model, no network, no key value. Prototypes live in the scratchpad, never in the repository.

Read first: the round's deliverable (the defects of this cluster, with their numbers); the files named below; the rulings by number.

## The defects

<Each, with the round's measurement and the unit it was found in.>

## What to return

For each defect: the file and function; the reproduction by execution (a fixture through the function, a route through a test); the classification (bug / spec gap / policy question); the cause with evidence; the smallest fix direction, with the callers and tests at risk; the empty and failure behaviour; the cache and privacy blast radius. Policy questions as a numbered list for the manager. Where two defects share a cause, say so — the manager groups C items by mechanism. Write no production code.
