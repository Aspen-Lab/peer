import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { buildRef, readBuildRef } from "./build-ref";

// P11-17a rule 1 (§1h.113 (b) O-1): the commit the running build was made from, for the version line. Vercel's own
// variable first, else `git rev-parse --short=7 HEAD` run from the config's directory, else nothing; anything that is not
// 7 to 40 hex characters is nothing. The commits below are invented.

const WEB = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SHA = "c550daa3f1e2d4b5a6978877665544332211aabb";
const fail = (code: string) => () => {
  throw Object.assign(new Error(`spawnSync git ${code}`), { code });
};

describe("buildRef — seven hex characters, or nothing", () => {
  it("takes Vercel's commit first, cut to seven, and does not ask git", () => {
    const git = vi.fn(() => "8d7ea47\n");
    expect(buildRef({ vercelSha: SHA, git })).toBe("c550daa");
    expect(git).not.toHaveBeenCalled();
  });

  it("else asks git for the short HEAD", () => {
    expect(buildRef({ git: () => "8d7ea47\n" })).toBe("8d7ea47");
    expect(buildRef({ vercelSha: "", git: () => "8d7ea47\n" })).toBe("8d7ea47");
  });

  it("cuts a longer answer to seven (git lengthens --short when seven would be ambiguous)", () => {
    expect(buildRef({ git: () => "8d7ea4746\n" })).toBe("8d7ea47");
    expect(buildRef({ git: () => SHA })).toBe("c550daa");
  });

  it("is empty when git fails, times out or is not there", () => {
    expect(buildRef({ git: fail("ENOENT") })).toBe("");
    expect(buildRef({ git: fail("ETIMEDOUT") })).toBe("");
    expect(buildRef({ git: () => { throw new Error("Command failed: git rev-parse — fatal: not a git repository"); } })).toBe("");
  });

  it("is empty for anything that is not 7 to 40 hex characters, from either source", () => {
    const malformed = ["", "   ", "8d7ea4", "8d7ea4z", `${SHA}0`, "fatal: bad revision", "8d7 ea47", "HEAD", "-8d7ea47", "8d7ea47\nsecond line"];
    for (const value of malformed) {
      expect(buildRef({ git: () => value }), JSON.stringify(value)).toBe("");
      if (value.trim()) expect(buildRef({ vercelSha: value, git: () => "8d7ea47" }), JSON.stringify(value)).toBe("");
    }
  });

  it("writes the commit in lower case, the way git does", () => {
    expect(buildRef({ vercelSha: SHA.toUpperCase(), git: fail("ENOENT") })).toBe("c550daa");
  });
});

describe("readBuildRef — the real sources, and only those", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads VERCEL_GIT_COMMIT_SHA first", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
    expect(readBuildRef(WEB)).toBe("c550daa");
  });

  it("is empty outside a repository with no Vercel commit", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const dir = mkdtempSync(path.join(tmpdir(), "p11-17a-no-git-"));
    try {
      expect(readBuildRef(dir)).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("asks git for nothing but the short HEAD, from the directory it is given, with a short timeout, and reads one variable", () => {
    const source = readFileSync(path.join(WEB, "src/lib/build-ref.ts"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(source.match(/process\.env\.\w+/g)).toEqual(["process.env.VERCEL_GIT_COMMIT_SHA"]);
    expect(source).not.toMatch(/process\.env\[|\.\.\.process\.env|Object\.\w+\(process\.env/);
    expect(source).toMatch(/execFileSync\("git", \["rev-parse", "--short=7", "HEAD"\], \{[^}]*\bcwd\b[^}]*\btimeout: \d{3,4}\b[^}]*\}\)/);
    expect(source.match(/execFileSync\(/g)).toHaveLength(1);
  });
});

// The value is fixed when `next.config.ts` is evaluated (`next build`, `next dev` start), which is what tells the owner a
// server is older than main. Read as text, as the other config pins read it: the one import, the one `env` key, and no
// other key changed.
describe("next.config.ts — the build's commit under one name (P11-17a)", () => {
  const config = readFileSync(path.join(WEB, "next.config.ts"), "utf8");

  it("imports readBuildRef and puts its value in env as PEER_BUILD_REF, from the config's own directory", () => {
    expect(config.match(/^import .*$/gm)).toEqual(['import type { NextConfig } from "next";', 'import { readBuildRef } from "./src/lib/build-ref";']);
    expect(config).toMatch(/\n {2}env: \{\n {4}PEER_BUILD_REF: readBuildRef\(__dirname\),\n {2}\},\n/);
  });

  it("changes no other key: the same keys in the same order, env added last, and the same values", () => {
    expect([...config.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])).toEqual([
      "typedRoutes",
      "turbopack",
      "serverExternalPackages",
      "outputFileTracingExcludes",
      "experimental",
      "env",
    ]);
    expect(nextConfig.typedRoutes).toBe(true);
    expect(nextConfig.turbopack).toEqual({ root: WEB });
    expect(nextConfig.serverExternalPackages).toEqual(["mupdf"]);
    expect(nextConfig.outputFileTracingExcludes).toEqual({ "/*": [".tmp*/**"] });
    expect(nextConfig.experimental).toEqual({ proxyClientMaxBodySize: "30mb" });
    expect(Object.keys(nextConfig.env ?? {})).toEqual(["PEER_BUILD_REF"]);
    expect(nextConfig.env?.PEER_BUILD_REF).toMatch(/^(?:[0-9a-f]{7})?$/);
  });
});
