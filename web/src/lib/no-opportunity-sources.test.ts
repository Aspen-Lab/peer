import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P9-33 · §1h.60 (the owner's decision §1a.18 (f): "职位和活动的信息不应该被process，
 * 这两个功能（职位，活动）需要被停止").
 *
 * **Jobs and events are stopped and gone; this keeps them gone.** Peer is a
 * paper briefing. `ffa6eded` removed the routes, pages and cards on 2026-09-05
 * and left their engines in the tree: seven job sources and four event sources
 * on ten hosts, two pipelines, the prompts and the page readers. Nothing
 * reached them, and nothing that is compiled and one import away from live
 * guards anything. A flag would not have either — there was no route left to
 * guard — so the code was deleted and this file is the only thing that stays
 * behind: a tree guard, not a switch.
 *
 * What may remain: `lib/jobs/types.ts` and `lib/events/types.ts` (the shapes
 * the pool-cache and the feed store still name; the next change deletes them
 * with their last reader), and the `lib/opportunities/` modules the paper pool
 * and the paper caches share.
 *
 * These are placement rules, so they read the tree. Tests are skipped: a test
 * may name a host to say it must not be called.
 */

const WEB = process.cwd();

function entries(dir: string): string[] {
  const full = path.join(WEB, dir);
  return fs.existsSync(full) ? fs.readdirSync(full).sort() : [];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const full = path.join(WEB, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...sourceFiles(rel));
      continue;
    }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(entry.name)) continue;
    if (/\.test\.(tsx?|mjs)$/.test(entry.name)) continue;
    out.push(rel);
  }
  return out.sort();
}

describe("no job or event source or pipeline is in the tree", () => {
  it("lib/jobs and lib/events hold nothing but types.ts — no sources/, no pipeline.ts, no scorer", () => {
    expect(entries("src/lib/jobs").filter((name) => name !== "types.ts")).toEqual([]);
    expect(entries("src/lib/events").filter((name) => name !== "types.ts")).toEqual([]);
  });

  it("no non-test source or script names the host of a job board or an events feed", () => {
    // The hosts the deleted clients called. Tavily is not here: the paper `web`
    // source shares it. The build guard bans the credential names on Vercel
    // (`assert-byok-production-env.mjs`) and `spend-scans.test.ts` scans for
    // their reads; this is the third rail — the address itself.
    const HOSTS = [
      "jsearch.p.rapidapi.com",
      "himalayas.app",
      "remotive.com",
      "arbeitnow.com",
      "api.adzuna.com",
      "data.usajobs.gov",
      "ccfddl.com",
      "tech-conferences/conference-data",
      "researchseminars.org",
    ];
    const hits: string[] = [];
    for (const file of [...sourceFiles("src"), ...sourceFiles("scripts")]) {
      const text = fs.readFileSync(path.join(WEB, file), "utf8").toLowerCase();
      for (const host of HOSTS) {
        if (text.includes(host)) hits.push(`${file}: ${host}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no package.json script points at a file that is not there (the events benchmark script went with its test)", () => {
    const scripts = JSON.parse(
      fs.readFileSync(path.join(WEB, "package.json"), "utf8"),
    ).scripts as Record<string, string>;
    const missing: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      for (const match of command.matchAll(
        /(?:^|\s)((?:src|scripts)\/\S+|vitest\.\S+\.ts)(?=\s|$)/g,
      )) {
        if (!fs.existsSync(path.join(WEB, match[1]))) {
          missing.push(`${name}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
