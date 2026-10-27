# Peer Project Rules

For product, UX, retrieval, ranking, architecture, and output-design work, read and follow:

- `docs/PRODUCT_DIRECTION.md`
- Source of truth: https://hermes-admin-eta.vercel.app/

Hard rule: Peer is a calm daily forecast for career, work, research, and knowledge. Favor precise, portable, user-declared, progressively enhanced information delivery over generic agent-platform complexity.

## Git & PR Workflow Rules

- **Never create a new branch without explicit user approval.** Always confirm the branch name with the user before creating one. Default to committing on whatever branch is currently checked out.
- **PR workflow order:** make changes → commit → push branch → create PR. Only push and open a PR when the user explicitly asks.
- **Always state the current branch** at the start of any coding session so the user knows where changes will land.

## Commit Attribution (co-ownership agreement, Section 2.3)

The repository history is the owners' record of who contributed what, so every commit names the person behind it.

- A person commits under their own git identity: Baichuan Wang as `peter14531453`; Xiaoyang Wang as `Aspen-Lab` ("Aspen Labs") or `aspen-wang`.
- A commit written by an AI agent (Claude, Codex, or any other) still names the person who directed the work. If the tool can set the git author, the author is that person. If it cannot (a cloud session that always commits as the agent), the message ends with a trailer naming that person, next to the agent's own trailer:
  - Baichuan Wang: `Co-authored-by: peter14531453 <274981268+peter14531453@users.noreply.github.com>`
  - Xiaoyang Wang: `Co-authored-by: Aspen Labs <262296635+Aspen-Lab@users.noreply.github.com>`
- If you do not know who directed the session, ask before committing. Never guess.

## Co-Ownership Agreement Guardrails

Peer is jointly owned under a signed agreement. These hold in every change:

- No price, paid plan, paid tier, trial, upgrade prompt, waitlist for paid features, donation link, or sponsorship link — in the app, the docs, or the changelog. Peer stays free and non-commercial until both owners sign a separate written agreement.
- Never describe either owner as a founder, officer, or employee of a business. Say "owner" or "author".
- Do not merge a contribution from anyone other than the two owners unless its author has agreed to `docs/CLA.md`, and only once that CLA is marked in force.
- Keep `docs/THIRD_PARTY_NOTICES.md` current when adding a dependency, font, image, data set, or adapted code. For npm packages, run `node scripts/third-party-list.mjs --write` from `web/`.

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
