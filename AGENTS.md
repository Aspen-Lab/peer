# Peer Project Rules

For product, UX, retrieval, ranking, architecture, and output-design work, read and follow:

- `docs/PRODUCT_DIRECTION.md`
- Source of truth: https://hermes-admin-eta.vercel.app/

Hard rule: Peer is a calm daily forecast for career, work, research, and knowledge. Favor precise, portable, user-declared, progressively enhanced information delivery over generic agent-platform complexity.

## Git & PR Workflow Rules

- **Never create a new branch without explicit user approval.** Always confirm the branch name with the user before creating one. Default to committing on whatever branch is currently checked out.
- **PR workflow order:** make changes → commit → push branch → create PR. Only push and open a PR when the user explicitly asks.
- **Always state the current branch** at the start of any coding session so the user knows where changes will land.

## Working Style (owner's standing order, 2026-10-11)

- **Develop tasks in parallel, never one after another.** When a request holds several independent items, run them at the same time as separate subagent A/B/C cycles: one implementer (C) per item in its own detached worktree, an investigator (B) first where the cause is not obvious, a reviewer (A) after, the manager verifying every item's commits and bringing them onto the branch. Group items only by file overlap. Sequential work is the exception and needs a stated reason.

Decision priorities:

- Time efficiency over information volume.
- User-declared intent over guessed preference.
- Tier 0 must remain useful without model keys.
- Tier 1 and Tier 2 may improve quality but must degrade gracefully.
- Source collection, scoring, dedupe, distillation, and output should remain the core pipeline.
- Output should stay portable where possible: Markdown, Obsidian, email, feeds, JSON.
- Feedback should tune future retrieval gradually, not overreact to one signal.
- Deep-dive mode is a feature, not the product identity.
