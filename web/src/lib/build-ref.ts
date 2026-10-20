// The commit the running build was made from, as seven hex characters — the version line's `c550daa`
// (P11-17a rule 1, §1h.113 (b) O-1).
//
// Twice the owner reported as current a defect main had already fixed, because their server was an old
// build and nothing on screen said which build it was. `next.config.ts` calls `readBuildRef` once, when
// it is evaluated (`next build`, `next dev` start), and puts the answer in its `env` as `PEER_BUILD_REF`,
// so the line names the commit the server was started from, not the one the checkout is on now.
//
// Server-side and config-time only: it runs git. The version line reads the inlined variable and never
// imports this module.

import { execFileSync } from "node:child_process";

/** 7 to 40 hex characters: a short or a full commit hash, and nothing else. */
const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * Seven hex characters, or the empty string. Vercel's commit when the build has one (a malformed one is
 * empty, not passed through and not replaced), else what `git` answers, else nothing. Anything that is
 * not 7 to 40 hex characters is nothing: no message, no ref name, no second line reaches the page.
 */
export function buildRef({ vercelSha, git }: { vercelSha?: string; git: () => string }): string {
  let candidate = vercelSha?.trim() ?? "";
  if (!candidate) {
    try {
      candidate = git().trim();
    } catch {
      return "";
    }
  }
  return COMMIT.test(candidate) ? candidate.slice(0, 7).toLowerCase() : "";
}

/**
 * `buildRef` on the real sources: Vercel's `VERCEL_GIT_COMMIT_SHA`, else `git rev-parse --short=7 HEAD`
 * run from `dir` (the config's own directory) with a short timeout. Nothing else is read from git or the
 * environment, and git's own errors are not printed.
 */
export function readBuildRef(dir: string): string {
  return buildRef({
    vercelSha: process.env.VERCEL_GIT_COMMIT_SHA,
    git: () =>
      execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: dir, timeout: 3000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
  });
}
