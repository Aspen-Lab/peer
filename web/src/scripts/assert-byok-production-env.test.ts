import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ABC-freemium 1-10 / 1-12 · R-GUARD-1, R-GUARD-2, R-TEST-1.
 *
 * The prebuild guard is the last thing between a misconfigured Vercel project
 * and a silently wrong deployment, and it **had no test at all** — it was
 * referenced only by `package.json`'s `prebuild`.
 *
 * **It is tested by spawning it, not by importing it.** Its whole contract is an
 * exit code and a message on stderr, and the module's top-level body calls
 * `process.exit(1)`; importing it would either kill the test process or test
 * something that is not what `prebuild` runs.
 *
 * **This file lives under `src/` on purpose.** Vitest's `include` is
 * `src/**​/*.test.{ts,tsx}` — a test placed next to the script under `scripts/`
 * would never run, and the requirement would be green by absence.
 */

const SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "assert-byok-production-env.mjs",
);

/** A recognisable value that must never be echoed back (R-GUARD-2). */
const SENTINEL = "SENTINEL-NOT-A-KEY-9f3a";

/**
 * **ABC-freemium 5-03 · D2a (Ruling 12) — `TAVILY_API_KEY` LEFT THIS OBJECT.**
 *
 * It is spread into every single case in this file, which made it far more than
 * a fixture detail: while it sat here AND on the guard's ban list, every
 * forbidden-name case exited 1 because of Tavily rather than because of the name
 * under test, so half of each case's evidence was contaminated. See the
 * explicit list contract below, which now pins both arrays to the guard's own.
 */
const ALL_REQUIRED = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "REQUIRED-NOT-A-KEY",
  // One of the publishable / anon pair (the guard asks for either): the key every
  // `hasSupabaseAuthConfig()` check needs. Without it a deployment builds and then
  // answers 503 on every AI route.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "REQUIRED-PUBLISHABLE-NOT-A-KEY",
};

/** The two spellings of the browser-side Supabase key; the guard wants either one. */
const PUBLISHABLE_OR_ANON = ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

const FORBIDDEN_NAMES = [
  // Owner, 2026-10-06: Peer holds no model key of its own. It used to be
  // EXPECTED on a deployment (warned when absent); it is FORBIDDEN now, and a
  // Vercel project that still has it fails the build.
  "GOOGLE_API_KEY",
  // The Google SDK's other implicit name: a client built without an explicit key
  // reads it (and `GOOGLE_API_KEY`) from the environment. Nothing here builds one
  // that way; the ban is defence in depth.
  "GEMINI_API_KEY",
  "PEER_DIGEST_PROVIDER",
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_SEARCH_PROJECT",
  "GOOGLE_VERTEX_SEARCH_ENGINE_ID",
  "GOOGLE_VERTEX_SEARCH_DATA_STORE_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "DEEPSEEK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  // 5-03 · D2a — came off the required list. The operator funds no search for
  // anyone, so a server Tavily key on a deployment is a spend risk exactly as
  // Brave is, and the build must refuse it.
  "TAVILY_API_KEY",
  // Owner, 2026-10-06 ("cut the company API path"; Jev is now a key the READER
  // brings): `JEV_API_KEY` was ALLOWED and SILENT here (JEV-DIRECT §1aa,
  // manager ruling §1ab P1: the company's Jev key lived in Vercel on purpose).
  // That premise is reversed, so it is FORBIDDEN now, like the model key, and
  // so is the secret of the broker that is deleted with it. The two cases
  // that asserted "allowed and silent" were rewritten, not weakened: see the
  // dedicated cases near the bottom of this file.
  "JEV_API_KEY",
  "PEER_JEV_BROKER_SECRET",
  // The fix round after the branch review (SF-5): the jobs sources used to read
  // `request key || company key`. The reader's own credentials travel in the
  // request now, so a company one on the deployment is a credential nothing may
  // use, and JSearch bills per request.
  "ADZUNA_APP_ID",
  "ADZUNA_APP_KEY",
  "JSEARCH_API_KEY",
  "USAJOBS_API_KEY",
] as const;

/** The job-source subset of the above, which the guard explains with one more line. */
const JOB_SOURCE_NAMES = ["ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JSEARCH_API_KEY", "USAJOBS_API_KEY"] as const;

/**
 * Run the guard with a **controlled** environment. Only the few variables Node
 * itself needs are carried over, so the developer's own `.env` or shell cannot
 * make a case pass or fail by accident — and no real credential is ever handed
 * to the child.
 */
function runGuard(env: Record<string, string>): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(process.execPath, [SCRIPT], {
    // Cast because Next's ambient typing makes `NODE_ENV` required on
    // `ProcessEnv`, and deliberately NOT passing it is the point: the child
    // must see only what a case sets.
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      COMSPEC: process.env.COMSPEC ?? "",
      ...env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Read one of the guard's own lists straight out of its source (5-03).
 *
 * Whitespace-tolerant on purpose: the tree is CRLF on disk and the array bodies
 * carry comments (Ruling 10 point 2c). Only double-quoted names are collected,
 * so a name mentioned in a comment cannot be mistaken for a list entry.
 */
const GUARD_LIST_PATTERNS = {
  REQUIRED_ON_VERCEL: /const\s+REQUIRED_ON_VERCEL\s*=\s*\[([\s\S]*?)\]/,
  // A list of groups: ends at `];` so the inner brackets do not cut it short.
  REQUIRED_ONE_OF_ON_VERCEL: /const\s+REQUIRED_ONE_OF_ON_VERCEL\s*=\s*\[([\s\S]*?)\];/,
  FORBIDDEN_ON_VERCEL: /const\s+FORBIDDEN_ON_VERCEL\s*=\s*\[([\s\S]*?)\]/,
} as const;

function guardList(name: keyof typeof GUARD_LIST_PATTERNS): string[] {
  const source = readFileSync(SCRIPT, "utf8");
  const match = GUARD_LIST_PATTERNS[name].exec(source);
  if (!match) throw new Error(`${name} not found in the guard script`);
  return [...match[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

describe("assert-byok-production-env", () => {
  it("states R-GUARD-1's lists explicitly, and the fixtures agree", () => {
    // Two jobs. First, it writes the contract down as a list rather than
    // leaving it implied by which cases happen to be generated: **two**
    // required names, and the model key, `TAVILY_API_KEY` and the rest banned.
    // Second — and this is the one that matters — it pins the fixtures to the
    // guard. Every other case in this file is generated from `ALL_REQUIRED` /
    // `FORBIDDEN_NAMES`, so a fixture that disagreed with the guard would taint
    // every case: each forbidden-name case would exit 1 because of the wrong
    // name rather than because of its own subject. They cannot drift.
    expect(guardList("REQUIRED_ON_VERCEL")).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(guardList("FORBIDDEN_ON_VERCEL")).toContain("GOOGLE_API_KEY");
    expect(guardList("FORBIDDEN_ON_VERCEL")).toContain("TAVILY_API_KEY");
    expect(guardList("REQUIRED_ON_VERCEL")).not.toContain("GOOGLE_API_KEY");
    expect(guardList("REQUIRED_ON_VERCEL")).not.toContain("TAVILY_API_KEY");

    // The publishable key is the third requirement, and it is a pair: either
    // spelling satisfies it (`hasSupabaseAuthConfig()` accepts both).
    expect(guardList("REQUIRED_ONE_OF_ON_VERCEL")).toEqual([...PUBLISHABLE_OR_ANON]);

    expect(Object.keys(ALL_REQUIRED)).toEqual([
      ...guardList("REQUIRED_ON_VERCEL"),
      PUBLISHABLE_OR_ANON[0],
    ]);
    expect([...FORBIDDEN_NAMES]).toEqual(guardList("FORBIDDEN_ON_VERCEL"));
  });

  it("passes a correctly configured Vercel build, in silence", () => {
    const { status, output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED });
    expect(status).toBe(0);
    // There is no "expected" list any more, so a clean build prints nothing: a
    // deployment with no model key is the whole product, not a degraded one.
    expect(output).toBe("");
  });

  it("does nothing at all off Vercel, whatever the environment holds", () => {
    // A developer building locally has every one of these set and must not be
    // blocked. This is why `isVercelBuild` guards the whole body. Includes a
    // developer's own GOOGLE_API_KEY.
    const { status } = runGuard({
      GOOGLE_API_KEY: SENTINEL,
      GOOGLE_VERTEX_PROJECT: "local-project",
      PEER_DIGEST_PROVIDER: "gemini",
      PEER_FEED_AI_TIER: "2",
    });
    expect(status).toBe(0);
  });

  describe("required settings (R-GUARD-1)", () => {
    for (const name of Object.keys(ALL_REQUIRED)) {
      it(`fails the build when ${name} is missing, and names it`, () => {
        const env: Record<string, string> = { VERCEL: "1", ...ALL_REQUIRED };
        delete env[name];

        const { status, output } = runGuard(env);

        expect(status).toBe(1);
        expect(output).toContain(name);
      });
    }

    it("names EVERY missing variable, not just the first", () => {
      // A build that fails four times in a row, each naming one more variable,
      // is four wasted deploys.
      const { output } = runGuard({ VERCEL: "1" });
      for (const name of Object.keys(ALL_REQUIRED)) {
        expect(output).toContain(name);
      }
      expect(output).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    });

    // Added in the fix round after the branch review (N10): `hasSupabaseAuthConfig()`
    // needs the browser-side key as well as the URL. A deployment without it built
    // cleanly and then answered 503 on every AI route.
    it("fails the build when neither the publishable key nor the anon key is set, naming both", () => {
      const env: Record<string, string> = { VERCEL: "1", ...ALL_REQUIRED };
      delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const { status, output } = runGuard(env);

      expect(status).toBe(1);
      for (const name of PUBLISHABLE_OR_ANON) expect(output).toContain(name);
    });

    it("builds with the publishable key alone, and with the anon key alone, in silence", () => {
      const base: Record<string, string> = { VERCEL: "1", ...ALL_REQUIRED };
      delete base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      for (const name of PUBLISHABLE_OR_ANON) {
        const { status, output } = runGuard({ ...base, [name]: "REQUIRED-NOT-A-KEY" });
        expect(status, name).toBe(0);
        expect(output, name).toBe("");
      }
    });

    it("does not count a blank key as the publishable key", () => {
      const base: Record<string, string> = { VERCEL: "1", ...ALL_REQUIRED };
      for (const name of PUBLISHABLE_OR_ANON) base[name] = "   ";

      const { status, output } = runGuard(base);

      expect(status).toBe(1);
      for (const name of PUBLISHABLE_OR_ANON) expect(output).toContain(name);
    });

    it("on a deployment missing only the pair, names the pair and not the two that are set", () => {
      const env: Record<string, string> = { VERCEL: "1", ...ALL_REQUIRED };
      delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      const { output } = runGuard(env);

      expect(output).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(output).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    });
  });

  describe("forbidden settings (R-GUARD-1)", () => {
    for (const name of FORBIDDEN_NAMES) {
      it(`fails the build when ${name} is set, and names it, never its value`, () => {
        const { status, output } = runGuard({
          VERCEL: "1",
          ...ALL_REQUIRED,
          [name]: SENTINEL,
        });

        expect(status).toBe(1);
        expect(output).toContain(name);
        expect(output).not.toContain(SENTINEL);
      });

      it(`builds when ${name} is blank: a blank variable is not a credential`, () => {
        const { status, output } = runGuard({
          VERCEL: "1",
          ...ALL_REQUIRED,
          [name]: "   ",
        });

        expect(status).toBe(0);
        expect(output).toBe("");
      });
    }

    it("with every forbidden name armed at once, names each of them exactly once and prints no value", () => {
      const armed = Object.fromEntries(FORBIDDEN_NAMES.map((name) => [name, SENTINEL]));

      const { status, output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED, ...armed });

      expect(status).toBe(1);
      for (const name of FORBIDDEN_NAMES) {
        // A name that is a prefix of another (JEV_API_KEY is not one, ADZUNA_APP_ID is not one
        // of ADZUNA_APP_KEY) is counted by whole word.
        const occurrences = output.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
        expect(occurrences, name).toHaveLength(1);
      }
      expect(output).not.toContain(SENTINEL);
    });

    it("explains a job-source key in one extra line, and says nothing about them when none is set", () => {
      for (const name of JOB_SOURCE_NAMES) {
        const { output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED, [name]: SENTINEL });
        expect(output, name).toContain("Job-source keys are the reader's too");
      }
      const none = runGuard({ VERCEL: "1", ...ALL_REQUIRED, GOOGLE_API_KEY: SENTINEL }).output;
      expect(none).not.toContain("Job-source");
    });

    it("does not ban a job-source user agent (an address, not a credential) or the other free-tier keys", () => {
      const { status, output } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        USAJOBS_USER_AGENT: "someone-NOT-AN-ADDRESS",
        OPENALEX_API_KEY: SENTINEL,
        SEMANTIC_SCHOLAR_API_KEY: SENTINEL,
        RESEND_API_KEY: SENTINEL,
      });

      expect(status).toBe(0);
      expect(output).toBe("");
    });

    it("fails the build when PEER_FEED_AI_TIER is forced above 0", () => {
      const { status, output } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        PEER_FEED_AI_TIER: "2",
      });

      expect(status).toBe(1);
      expect(output).toContain("PEER_FEED_AI_TIER");
    });

    // ── ABC-freemium 2-04 · Ruling 5 point 2 — the GOOGLE_VERTEX_ prefix ────
    //
    // The explicit list named 4 of the 11 `GOOGLE_VERTEX_` variables the tree
    // reads, so seven could be set on a deployment without the guard saying a
    // word. They all configure the same operator-funded project.
    for (const name of [
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_VERTEX_SEARCH_MIN_RESULTS",
      "GOOGLE_VERTEX_SEARCH_FALLBACK",
      "GOOGLE_VERTEX_SEARCH_SERVING_CONFIG",
      // A name nothing reads today — the prefix bans the FAMILY, so a variable
      // added next round is banned before anyone remembers to list it.
      "GOOGLE_VERTEX_SOMETHING_INVENTED",
    ]) {
      it(`fails the build on ${name}, which is on no explicit list`, () => {
        const { status, output } = runGuard({
          VERCEL: "1",
          ...ALL_REQUIRED,
          [name]: SENTINEL,
        });

        expect(status).toBe(1);
        expect(output).toContain(name);
      });
    }

    it("does NOT fire on a near-miss that merely starts similarly", () => {
      // `GOOGLE_VERTEXES` is a deliberate near-miss on the boundary of the
      // prefix itself.
      const { status } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        GOOGLE_VERTEXES: SENTINEL,
        GOOGLE_VERTEX: SENTINEL,
      });

      expect(status).toBe(0);
    });

    it("names a prefix-matched variable exactly once, not twice", () => {
      // An explicitly-listed name also matches the prefix. The two sources are
      // de-duplicated, so the failure message does not repeat itself.
      const { output } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        GOOGLE_VERTEX_PROJECT: SENTINEL,
      });

      expect(output.split("GOOGLE_VERTEX_PROJECT").length - 1).toBe(1);
    });

    it("bans GOOGLE_API_KEY on EVERY Vercel environment, naming it and never its value", () => {
      // Owner, 2026-10-06: Peer holds no model key. The guard keys on `VERCEL`
      // or `VERCEL_ENV`, so production, preview and development builds are each
      // covered, including a build that sets only `VERCEL_ENV`.
      const targets: Record<string, string>[] = [
        { VERCEL: "1" },
        { VERCEL: "1", VERCEL_ENV: "production" },
        { VERCEL_ENV: "production" },
        { VERCEL_ENV: "preview" },
        { VERCEL_ENV: "development" },
      ];
      for (const target of targets) {
        const { status, output } = runGuard({
          ...target,
          ...ALL_REQUIRED,
          GOOGLE_API_KEY: SENTINEL,
        });

        expect(status, JSON.stringify(target)).toBe(1);
        expect(output, JSON.stringify(target)).toContain("GOOGLE_API_KEY");
        expect(output, JSON.stringify(target)).not.toContain(SENTINEL);
      }
    });

    it("builds when GOOGLE_API_KEY is absent or blank — a blank variable is not a key", () => {
      expect(runGuard({ VERCEL: "1", ...ALL_REQUIRED }).status).toBe(0);
      expect(
        runGuard({ VERCEL: "1", ...ALL_REQUIRED, GOOGLE_API_KEY: "   " }).status,
      ).toBe(0);
    });

    it("tells the deployer what to do: the model key is the reader's, not the deployment's", () => {
      const { output } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        GOOGLE_API_KEY: SENTINEL,
      });

      expect(output).toContain("Remove these operator-funded AI settings from Vercel");
      expect(output).toContain("Peer holds no model key of its own");
    });

    it("bans JEV_API_KEY on EVERY Vercel environment, naming it and never its value (the owner cut the company's Jev key; a reader brings their own)", () => {
      // Rewritten from "no longer bans JEV_API_KEY ... builds cleanly": the
      // owner's decision on 2026-10-06 changed the premise. Jev is a key the
      // reader pastes into their profile; a Jev key on the deployment is a
      // company credential nothing may use.
      const targets: Record<string, string>[] = [
        { VERCEL: "1" },
        { VERCEL: "1", VERCEL_ENV: "production" },
        { VERCEL_ENV: "production" },
        { VERCEL_ENV: "preview" },
        { VERCEL_ENV: "development" },
      ];
      for (const target of targets) {
        const { status, output } = runGuard({ ...target, ...ALL_REQUIRED, JEV_API_KEY: SENTINEL });

        expect(status, JSON.stringify(target)).toBe(1);
        expect(output, JSON.stringify(target)).toContain("JEV_API_KEY");
        expect(output, JSON.stringify(target)).not.toContain(SENTINEL);
      }
    });

    it("builds when JEV_API_KEY is absent or blank — a blank variable is not a key", () => {
      // Rewritten from "stays silent about JEV_API_KEY whether it is set or
      // not": silence is now only the absent and blank cases.
      const absent = runGuard({ VERCEL: "1", ...ALL_REQUIRED });
      const blank = runGuard({ VERCEL: "1", ...ALL_REQUIRED, JEV_API_KEY: "   " });

      expect(absent.status).toBe(0);
      expect(blank.status).toBe(0);
      expect(absent.output).not.toContain("JEV_API_KEY");
      expect(blank.output).not.toContain("JEV_API_KEY");
    });

    it("also bans the secret of the deleted Jev broker, naming it and never its value", () => {
      const { status, output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED, PEER_JEV_BROKER_SECRET: SENTINEL });

      expect(status).toBe(1);
      expect(output).toContain("PEER_JEV_BROKER_SECRET");
      expect(output).not.toContain(SENTINEL);
    });

    it("does not fail a build over the other PEER_JEV_ names: nothing reads them any more, so they are inert", () => {
      const { status, output } = runGuard({
        VERCEL: "1",
        ...ALL_REQUIRED,
        PEER_JEV_SHADOW: "on",
        PEER_JEV_BROKER: "on",
        PEER_JEV_BROKER_URL: "https://example.invalid",
        PEER_JEV_TRANSPORT: "direct",
        PEER_JEV_PER_USER_DAILY_CAP: "50",
        PEER_JEV_GLOBAL_DAILY_CAP: "2000",
        PEER_JEV_GEMINI_FALLBACK: "on",
      });

      expect(status).toBe(0);
      expect(output).toBe("");
    });

    it("tells the deployer that the Jev key is the reader's, not the deployment's", () => {
      const { output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED, JEV_API_KEY: SENTINEL });

      expect(output).toContain("Remove these operator-funded AI settings from Vercel");
      expect(output).toContain("JEV_API_KEY");
      expect(output).toContain("A Jev key is the reader's too");
    });

    it("does not mention Jev when no Jev name is set", () => {
      const { output } = runGuard({ VERCEL: "1", ...ALL_REQUIRED, GOOGLE_API_KEY: SENTINEL });

      expect(output).not.toContain("Jev");
    });
  });

  it("never prints a VALUE (R-GUARD-2)", () => {
    // The message may name variables. The obvious way to write the "missing"
    // half is `Missing: NAME=${env[NAME]}`, which prints an empty string today
    // and a live key the day someone sets a wrong-cased variant.
    const { status, output } = runGuard({
      VERCEL: "1",
      ...ALL_REQUIRED,
      GOOGLE_API_KEY: SENTINEL,
      GOOGLE_VERTEX_PROJECT: SENTINEL,
      ANTHROPIC_API_KEY: SENTINEL,
    });

    expect(status).toBe(1);
    expect(output).toContain("GOOGLE_API_KEY");
    expect(output).toContain("GOOGLE_VERTEX_PROJECT");
    expect(output).not.toContain(SENTINEL);
  });
});
