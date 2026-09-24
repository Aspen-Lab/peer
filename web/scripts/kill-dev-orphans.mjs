#!/usr/bin/env node
/**
 * Kill leftover Next.js/Turbopack dev processes belonging to THIS repo.
 *
 * Why this exists
 * ---------------
 * On Windows, killing the `next dev` parent does not reap its child worker
 * processes (postcss / turbopack build workers under `web/.next/`). They become
 * orphans and sit there consuming CPU and memory. A misconfigured project root
 * once caused every CSS compile to fail and leak one worker each — 762 orphaned
 * node processes accumulated in a single day and made the whole machine laggy.
 *
 * What it matches — and why the build-worker path alone was not enough
 * -------------------------------------------------------------------
 * The original marker was `web/.next`, which ONLY appears in build-worker
 * command lines. A dev server left running overnight survived every cleanup:
 * the process that actually holds port 3000 runs
 * `web/node_modules/next/dist/server/lib/start-server.js`, and the CLI above it
 * runs `web/node_modules/.bin/../next/dist/bin/next`. Neither contains `.next`.
 *
 * That miss was not cosmetic. With the port still held, the launch config's
 * auto-port fallback moves the new server to 3001, and browser storage is keyed
 * by origin — so the developer's locally-saved profile silently disappears.
 *
 * Three shapes are therefore matched, all anchored to this repo's own `web/`
 * directory:
 *   1. build workers      — command line contains `<web>/.next`
 *   2. server + `next` CLI — contains `<web>` AND `next/dist`
 *
 * The `npm run dev` wrapper above them is deliberately NOT matched. It carries
 * no repo path of its own, and npm spawns the CLI through an intermediate
 * shell, so it is not even the direct parent of anything matchable. Verified
 * on Windows: it exits on its own once the CLI below it is gone.
 *
 * Safety
 * ------
 * Every match is anchored to this repository's `web/` path, which can never
 * appear in an editor, Claude Code, an unrelated project, or a shell. Requiring
 * `next/dist` alongside it keeps sibling tooling that also lives under `web/`
 * (vitest, eslint) out of range. It refuses to kill its own PID and its own
 * parent, so the `npm run dev` that invoked it as a `predev` hook is never a
 * target. It never does a blanket "kill all node".
 *
 * Usage:  node scripts/kill-dev-orphans.mjs [--dry-run]
 *         npm run kill-orphans
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
// Only dev-server build workers reference this path.
const buildWorkerMarker = path.join(webDir, ".next");
// Present in both `next dist/bin/next` (the CLI) and
// `next dist/server/lib/start-server.js` (the process holding the port).
const nextRuntimeMarker = path.join("next", "dist");
const dryRun = process.argv.includes("--dry-run");

/** @returns {{pid: number, ppid: number, cmd: string}[]} */
function listNodeProcesses() {
  if (process.platform === "win32") {
    // CSV avoids CommandLine truncation that Format-Table would introduce.
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Select-Object ProcessId,ParentProcessId,CommandLine | " +
      "ConvertTo-Csv -NoTypeInformation";
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return out
      .split(/\r?\n/)
      .slice(1) // drop CSV header
      .map((line) => {
        const m = line.match(/^"(\d+)","(\d+)","?([\s\S]*?)"?$/);
        if (!m) return null;
        return { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? "" };
      })
      .filter((p) => p !== null);
  }

  const out = execFileSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\s\S]*)$/);
      if (!m) return null;
      return { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] };
    })
    .filter((p) => p !== null && p.cmd.includes("node"));
}

let procs;
try {
  procs = listNodeProcesses();
} catch (err) {
  console.error("[kill-dev-orphans] could not list processes:", err.message);
  process.exit(0); // never fail a build/hook because of cleanup
}

/** Never kill this script, and never kill the `npm run` that invoked it. */
function isSelf(p) {
  return p.pid === process.pid || p.pid === process.ppid;
}

const targets = procs.filter(
  (p) =>
    !isSelf(p) &&
    (p.cmd.includes(buildWorkerMarker) ||
      (p.cmd.includes(webDir) && p.cmd.includes(nextRuntimeMarker))),
);

if (targets.length === 0) {
  console.log("[kill-dev-orphans] no leftover dev processes found.");
  process.exit(0);
}

if (dryRun) {
  console.log(`[kill-dev-orphans] would kill ${targets.length} process(es):`);
  for (const t of targets) {
    console.log(`  pid ${t.pid}  ${t.cmd.slice(0, 120)}`);
  }
  process.exit(0);
}

let killed = 0;
for (const t of targets) {
  try {
    process.kill(t.pid, "SIGKILL");
    killed++;
  } catch {
    // already gone, or not ours to kill — ignore
  }
}
console.log(`[kill-dev-orphans] cleaned up ${killed} leftover dev process(es).`);
