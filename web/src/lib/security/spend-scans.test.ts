import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The three standing scans that were still being recomputed by hand.
 *
 * ABC-freemium 2-06 / 5-04 · R-SEC-2, R-SEC-3, R-KEY-3, D2a, D8, D9 · Ruling 2 point 6
 * (the standing tallies A owes every round) · Ruling 4 point 7 · Ruling 6
 * point 4.
 *
 * Two of A's five scans already ship as gate tests —
 * `lib/feed/ui-vocabulary.test.ts` (scan 1) and `lib/env/no-client-dev-flags.test.ts`
 * (scan 2). **Scans 3, 4 and 5 were recounted by hand every round**, which is
 * how a count drifts between agents: round-2 A and round-2 B disagreed about
 * how many harness-driven route suites exist, and B found three
 * `request key || env key` readers that no scan looked for. A number a person
 * recomputes is a number that goes stale between the recomputing.
 *
 * `scripts/assert-byok-production-env.test.ts` is the precedent for asserting on
 * file contents rather than on behaviour; this follows its shape.
 *
 * **These are placement rules, not behaviour**, so they read source text. A
 * placement rule that is only written in prose is a rule that is followed until
 * someone is in a hurry.
 */

/**
 * ── THE COVERAGE BOUNDARY, DECLARED IN THE FILE THAT USES IT ────────────────
 *
 * **ABC-freemium 9-04 · Ruling 26 points 2-3. "Which files did you look at" is
 * part of a scan's RESULT, not a detail of its implementation.**
 *
 * Until 9-04 this walked `src/` only and kept `.tsx?` only, so **every one of
 * these scans was blind to `web/scripts/`** — the operator tooling the owner
 * runs by hand, and exactly where an operator credential would plausibly be
 * read. Round-9 B measured it rather than arguing it: a flagrant
 * `process.env.TAVILY_API_KEY` read planted inside an operator script
 * left the suite at 12 passed, 0 failed, while the identical read in `src/`
 * reddened exactly one case. **A scan that cannot see a directory is not a
 * scan.**
 *
 * That was the third hole of its kind in this loop — a route enumeration that
 * lost `/`, a cross-check that skipped for eight rounds, and this. Hence the
 * standing rule, and hence the `describe` block at the bottom of this file that
 * **asserts the boundary itself**: if `scripts/` ever stops being walked, or
 * `.mjs` stops being read, a case goes red instead of the count quietly
 * becoming a smaller truth.
 */
const ROOTS = [
  { dir: "src", why: "the application itself" },
  {
    dir: "scripts",
    why:
      "operator tooling run by hand against real projects and real money — " +
      "the setup script builds a Discovery Engine index, the billing probe " +
      "spends ~$4 a run, and the prebuild guard decides whether a deployment " +
      "is allowed to proceed",
  },
] as const;

/** `.mjs` is here because `web/scripts/` is written in it. */
const SOURCE_EXTENSION = /\.(tsx?|mjs)$/;

/**
 * Directories skipped, **each with the reason it is skipped** — never a
 * convenience list. Ruling 4 point 7's shape, applied to the widened walk.
 */
const EXCLUDED_DIRECTORIES: Record<string, string> = {
  "test-support":
    "Ruling 4 point 7 — test scaffolding; its one key reference DELETES the " +
    "key rather than reading it",
  __pycache__:
    "compiled Python bytecode under scripts/, not source anybody edits; the " +
    "two .py extractors it caches are not JavaScript and cannot read an env " +
    "name in a shape these scans are written for",
};

/**
 * Every scannable source file under the roots above, excluding tests and the
 * directories named with their reasons.
 *
 * **Renamed from `productionFiles()` in 9-04**, because it no longer returns
 * only production files and a function whose name understates what it walks is
 * the same small lie 9-01 was about.
 */
function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name in EXCLUDED_DIRECTORIES) continue;
        walk(full);
        continue;
      }
      if (!SOURCE_EXTENSION.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  for (const root of ROOTS) walk(path.join(process.cwd(), root.dir));
  return out;
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/**
 * Source with comments removed.
 *
 * **Not a nicety — the first draft of this file failed on its own prose.** These
 * modules document what they used to do ("this used to call
 * `isGeminiSearchAvailable()` directly from the environment"), and a scan that
 * reads comments reports the explanation of a fixed defect as the defect. A
 * source-text rule that cannot tell code from a comment about code gets switched
 * off by whoever next writes a thorough comment, which is the opposite of what
 * it is for.
 */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function filesMatching(pattern: RegExp): string[] {
  return scannedFiles()
    .filter((file) => pattern.test(code(file)))
    .map(relative)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 3 — Peer holds no search credential of its own
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 3 — no operator search credential is read anywhere", () => {
  /**
   * **REWRITTEN, NOT DELETED — the BYOK-only change (scope (b)).** This scan
   * used to assert that every operator-funded search credential (Brave, Vertex
   * AI Search, Gemini grounding) was read in exactly one gated module,
   * `src/lib/search/system-key.ts`. Peer now funds no search for anyone: that
   * module, the two search engines behind it and the two operator scripts that
   * built and billed the Vertex index are deleted, and the only search a reader
   * can run is on a Tavily key they paste in themselves, carried in the request.
   * So the honest answer for every name below is **none**, and a revival is a
   * failing case rather than a quiet addition.
   *
   * The build guard still bans these names on Vercel (a stray value must not
   * mean anything), and it is in this walk: it takes `process.env` as a whole
   * object and checks names against its lists, so it never matches a literal
   * `process.env.NAME` read.
   */
  const OPERATOR_SEARCH_ENV = [
    "TAVILY_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "GOOGLE_VERTEX_SEARCH_PROJECT",
    "GOOGLE_VERTEX_SEARCH_ENGINE_ID",
    "GOOGLE_VERTEX_SEARCH_DATA_STORE_ID",
    "GOOGLE_VERTEX_SEARCH_LOCATION",
    "GOOGLE_VERTEX_SEARCH_COLLECTION",
    "GOOGLE_VERTEX_SEARCH_SERVING_CONFIG",
    "GOOGLE_VERTEX_SEARCH_MIN_RESULTS",
    "GOOGLE_VERTEX_SEARCH_FALLBACK",
  ] as const;

  for (const name of OPERATOR_SEARCH_ENV) {
    it(`reads process.env.${name} NOWHERE in source or scripts`, () => {
      expect(filesMatching(new RegExp(`process\\.env\\.${name}\\b`))).toEqual([]);
    });
  }

  it("reads no GOOGLE_VERTEX_SEARCH_ name at all, whatever the suffix", () => {
    expect(filesMatching(/process\.env\.GOOGLE_VERTEX_SEARCH_/)).toEqual([]);
  });

  it("has no operator script left that reads the models-project name (the two Vertex search scripts are gone)", () => {
    const legacyReaders = filesMatching(
      /process\.env\.GOOGLE_VERTEX_PROJECT\b/,
    ).filter((file) => file.startsWith("scripts/"));

    expect(legacyReaders).toEqual([]);
  });

  it("calls no search-availability helper: there is no operator capability to ask about", () => {
    expect(filesMatching(/\bis(Gemini|Vertex)SearchAvailable\s*\(/)).toEqual([]);
  });

  it("keeps the deleted search modules and operator scripts from coming back", () => {
    for (const file of [
      "src/lib/search/system-key.ts",
      "src/lib/sources/vertex-search.ts",
      "src/lib/sources/gemini-search.ts",
      "src/lib/usage/rebuild-breaker.ts",
      "scripts/setup-vertex-search.mjs",
      "scripts/probe-vertex-search-billing.mjs",
    ]) {
      expect(
        fs.existsSync(path.join(process.cwd(), file)),
        `${file} was deleted with Peer's own search and must not return`,
      ).toBe(false);
    }
  });

  it("names no deleted operator-search symbol in code", () => {
    const revived = filesMatching(
      /\b(resolveSystemSearchKeys|operatorSearchAvailability|isOperatorFundedSearch|searchVertex|searchGemini|consumeForcedRebuild|systemSearchAllowed)\b/,
    );

    expect(revived).toEqual([]);
  });

  it("counts the structured-source key reads that are ACCEPTED outside any gate", () => {
    // Ruling 6 point 4 — Adzuna, JSearch and USAJobs read
    // `request key || operator env key` in the same shape, and they deliberately
    // do NOT join a gate: they are the free structured backbone of the jobs
    // surface and their keys buy free-tier quota rather than per-call billing.
    //
    // **This is A's standing tally, as an assertion.** The number is 3. If it
    // rises, a fourth ungated structured source appeared and the manager needs
    // to rule on it; if one of these ever bills per request, it is cut the same
    // round (the ruling's stated threshold).
    const accepted = filesMatching(
      /process\.env\.(ADZUNA_APP_(ID|KEY)|JSEARCH_API_KEY|USAJOBS_(API_KEY|USER_AGENT))\b/,
    );
    expect(accepted).toEqual([
      "src/lib/jobs/sources/adzuna.ts",
      "src/lib/jobs/sources/jsearch.ts",
      "src/lib/jobs/sources/usajobs.ts",
    ]);
    expect(accepted).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 7 — JEV_API_KEY is read in exactly one place (JEV-DIRECT §1aa)
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 7 — JEV_API_KEY is read in exactly one file (JEV-DIRECT §1aa)", () => {
  /**
   * JEV-DIRECT (§1aa) REVERSES §1r: the user moved the Jev key into Vercel
   * alongside every other provider key, so Peer now calls Jev directly
   * instead of through the (still-present, still-dormant) Supabase broker.
   * Every scan/test that used to assert "JEV_API_KEY is never read anywhere
   * in web/" is rewritten, never deleted (§1aa point 4) — this scan is the
   * POSITIVE half of that old claim: exactly one file reads the key, and it
   * is the expected one. `broker-client.test.ts`'s own structural check
   * ("never references JEV_API_KEY... in its own source") is unaffected and
   * stays green unchanged — the broker path is a different transport and
   * must still never see the raw key.
   */
  const GATE = "src/lib/decisions/jev-direct-client.ts";

  it(`reads process.env.JEV_API_KEY only inside ${GATE}`, () => {
    const readers = filesMatching(/process\.env\.JEV_API_KEY\b/);
    expect(readers).toEqual([GATE]);
  });

  it("the gate module actually exists (a rename would otherwise show up as an empty result, not a failure naming why)", () => {
    expect(fs.existsSync(path.join(process.cwd(), GATE))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 5 — every route that reaches a model is behind the shared guard
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 5 — every route that can reach a model is behind requireAiRequest", () => {
  const GUARD = "requireAiRequest";

  /**
   * Routes that may reach a provider WITHOUT calling the guard, each with the
   * reason it is exempt. **A short, justified list — never a convenience list.**
   * Every entry here is a decision someone can argue with, which is the point of
   * writing them down.
   */
  const JUSTIFIED_EXEMPTIONS: Record<string, string> = {
    "src/app/api/digest/test/route.ts":
      "a local-only diagnostic that answers 404 unless canUseLocalServerProvider(); it reads a developer's own Vertex environment",
  };

  function apiRouteFiles(): string[] {
    return scannedFiles()
      .map(relative)
      .filter((file) => /^src\/app\/api\/.*\/route\.ts$/.test(file));
  }

  /** A route "reaches a model" if it can resolve a provider or build one itself. */
  function reachesModel(file: string): boolean {
    const source = code(path.join(process.cwd(), file));
    return /\bresolveProvider\s*\(/.test(source) || /\bGoogleGenAI\b/.test(source);
  }

  it("leaves no model-reaching route unguarded and unjustified", () => {
    const unguarded = apiRouteFiles()
      .filter(reachesModel)
      .filter((file) => {
        return !code(path.join(process.cwd(), file)).includes(GUARD);
      })
      .filter((file) => !(file in JUSTIFIED_EXEMPTIONS));

    expect(unguarded).toEqual([]);
  });

  it("keeps the exemption list honest — every entry still exists and still reaches a model", () => {
    // The staleness check `ui-vocabulary.test.ts` already does for its own list.
    // An exemption for a file that has been deleted or renamed is an exemption
    // nobody notices has stopped applying.
    for (const [file, reason] of Object.entries(JUSTIFIED_EXEMPTIONS)) {
      expect(
        fs.existsSync(path.join(process.cwd(), file)),
        `${file} is exempted for "${reason}" but no longer exists`,
      ).toBe(true);
      expect(
        reachesModel(file),
        `${file} is exempted but no longer reaches a model`,
      ).toBe(true);
    }
  });

  it("reports the guarded count, so a DROP is visible rather than silent", () => {
    // A's standing tally as an assertion. Five routes carry the guard today:
    // the feed, the digest, the figure resolver, the paper report and the
    // test-digest diagnostic. A route losing it would otherwise show up only as
    // an absence, and an absence is what nobody notices. (The upload route used
    // to be a sixth, for a model-written title; it reaches no model now and has
    // its own sign-in.)
    const guarded = apiRouteFiles().filter((file) =>
      code(path.join(process.cwd(), file)).includes(GUARD),
    );

    expect(guarded).toEqual([
      "src/app/api/digest/route.ts",
      "src/app/api/feed/route.ts",
      "src/app/api/figure/route.ts",
      "src/app/api/papers/report/route.ts",
      "src/app/api/test-digest/route.ts",
    ]);
  });

  it("takes only the reader's override: no resolveProvider call carries a second argument", () => {
    // `resolveProvider(override)` is the whole interface, and `tsc` rejects a
    // second argument. The scan is kept as a belt: it survives the signature
    // being loosened by someone who does not read this file, and its failure
    // message names the offending file, which a TS2554 at a call site does not.
    // Only files that import the registry are looked at: `sources/web-search.ts`
    // has its own, unrelated local `resolveProvider` helper with three
    // parameters. The declaration itself has a parameter list, so a CALL with a
    // comma is unambiguous.
    const offenders = scannedFiles().filter((file) => {
      const source = code(file);
      return (
        /providers\/registry"|\.\/registry"/.test(source) &&
        /(?<!function\s)\bresolveProvider\(\s*[\w.?\s]+(?:\([^()]*\))?\s*,/.test(source)
      );
    });

    expect(offenders.map(relative)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 8 — Peer holds no model key of its own
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 8 — no model key is read from the environment on a reader's path", () => {
  it("reads process.env.GOOGLE_API_KEY NOWHERE in source or scripts", () => {
    // The company's Gemini key used to be read in exactly one place (the
    // registry's system default) and was the default model for every signed-in
    // reader. A reader's own Gemini key arrives in the request and is passed to
    // `createGeminiApiProvider(apiKey)`; the environment has no say. The build
    // guard bans the name on Vercel (`assert-byok-production-env.mjs`), and this
    // is the same rule enforced on the code.
    expect(filesMatching(/process\.env\.GOOGLE_API_KEY\b/)).toEqual([]);
  });

  it("reads the other providers' environment keys only inside their own provider modules", () => {
    // These are a developer's own keys, reachable only through
    // `PEER_DIGEST_PROVIDER` in local development (`canUseLocalServerProvider`),
    // and banned on Vercel by the build guard. Each is read by its own provider
    // module and nowhere else, so no route and no library can quietly resolve a
    // provider from the environment.
    const readers = filesMatching(
      /process\.env\.(ANTHROPIC_API_KEY|OPENAI_API_KEY|QWEN_API_KEY|DASHSCOPE_API_KEY|DEEPSEEK_API_KEY)\b/,
    );

    expect(readers).toEqual([
      "src/lib/llm/providers/anthropic.ts",
      "src/lib/llm/providers/deepseek.ts",
      "src/lib/llm/providers/openai.ts",
      "src/lib/llm/providers/qwen.ts",
    ]);
  });

  it("keeps the deleted brand and the system default from coming back", () => {
    // The compile-time brand ("an entitlement check ran before the operator's
    // money was spent") proved nothing once there was no operator provider, and
    // went with it. Naming them here makes a revival a failing case rather than
    // a quiet addition.
    const revived = filesMatching(
      /\b(entitledContext|EntitledContext|SpendJustification|resolveSystemProvider|unsafeEntitledContextForTests)\b/,
    );

    expect(revived).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE COVERAGE BOUNDARY ITSELF — asserted, not merely documented
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **ABC-freemium 9-04 · Ruling 26 point 2 — the new standing rule, applied to
 * the scan that caused it.**
 *
 * Every scan this loop built has had a hole that made it pass by not looking:
 * a route enumeration that silently lost `/`, a cross-check that skipped for
 * eight rounds because no build ever ran, and these five scans, which could not
 * see `web/scripts/`. Three for three. In all three the count stayed green and
 * the count was the thing being trusted.
 *
 * So the boundary is a RESULT, and these cases assert it. **They are what makes
 * the widening durable**: a future edit that narrows the walk back to `src/`,
 * or drops `.mjs`, or moves the operator scripts somewhere unscanned, turns a
 * case red instead of quietly shrinking what "0 offenders" means.
 */
describe("the scans' coverage boundary (9-04)", () => {
  it("walks BOTH declared roots, and scripts/ is really in the walked set", () => {
    // The single assertion this whole item exists for. If it ever fails, every
    // count in this file has become a smaller truth than it reads as.
    const walked = scannedFiles().map(relative);

    expect(walked.some((file) => file.startsWith("src/"))).toBe(true);
    expect(walked.some((file) => file.startsWith("scripts/"))).toBe(true);
  });

  it("reads .mjs, which is the language web/scripts/ is written in", () => {
    // `.mjs` is not a detail. The old walk kept `.tsx?` only, so even pointing
    // it at `scripts/` would have found nothing — the hole had two halves and
    // closing one would have looked like closing both.
    const walked = scannedFiles().map(relative);
    const scriptFiles = walked.filter((file) => file.startsWith("scripts/"));

    expect(scriptFiles.every((file) => /\.(tsx?|mjs)$/.test(file))).toBe(true);
    expect(scriptFiles.some((file) => file.endsWith(".mjs"))).toBe(true);
  });

  it("has the operator tooling in scope BY NAME, so a move is visible", () => {
    // A rename or a move to an unwalked folder would otherwise show up as an
    // absence, and an absence is what nobody notices — the same reasoning as
    // scan 5's guarded-count case.
    const walked = scannedFiles().map(relative);

    for (const file of [
      "scripts/assert-byok-production-env.mjs",
      "scripts/check-provider-models.mjs",
    ]) {
      expect(walked, `${file} is no longer in the scanned set`).toContain(file);
    }
  });

  it("keeps every exclusion NAMED WITH ITS REASON, and none of them silent", () => {
    // Ruling 26 point 3's shape. An exclusion without a reason is how a scan
    // stops looking somewhere and nobody can tell whether that was a decision.
    for (const [dir, reason] of Object.entries(EXCLUDED_DIRECTORIES)) {
      expect(reason.length, `${dir} is excluded without a reason`).toBeGreaterThan(20);
    }
    for (const root of ROOTS) {
      expect(root.why.length, `root ${root.dir} has no stated purpose`).toBeGreaterThan(10);
    }
    // The excluded names are the two decided ones and no others. Adding a third
    // is a decision, not a tidy-up.
    expect(Object.keys(EXCLUDED_DIRECTORIES).sort()).toEqual([
      "__pycache__",
      "test-support",
    ]);
  });

  it("does NOT exclude the build guard, even though it names banned keys", () => {
    // **Measured, not assumed, and the answer went the other way from the
    // ruling's expectation — so it is written down.**
    //
    // Ruling 26 point 3 anticipated that `assert-byok-production-env.mjs` would
    // have to be excluded because it "names banned variables as data" and would
    // trip a naive scan. It does name them: `TAVILY_API_KEY` and
    // `BRAVE_SEARCH_API_KEY` sit in its FORBIDDEN_ON_VERCEL array, which is the
    // whole point of the guard.
    //
    // **But no exclusion is needed, because these scans match a READ
    // (`process.env.NAME`) and not a mention.** The guard never writes
    // `process.env.TAVILY_API_KEY`; it takes `process.env` as a whole object and
    // checks names against its lists. So the file stays fully in scope, and if
    // somebody ever adds a real key read to it, the scans will say so.
    //
    // **Excluding it would have been the cheaper and worse answer** — it would
    // have created exactly the kind of blind spot this item exists to close, in
    // the single file whose job is refusing credentials.
    const walked = scannedFiles().map(relative);
    expect(walked).toContain("scripts/assert-byok-production-env.mjs");

    // And it is not an offender: it is in scope and it reports clean.
    expect(filesMatching(/process\.env\.TAVILY_API_KEY\b/)).toEqual([]);
    expect(filesMatching(/process\.env\.BRAVE_SEARCH_API_KEY\b/)).toEqual([]);
  });

  it("names the one SHAPE these scans are still blind to, with its census", () => {
    // **A boundary is not only which files — it is which shapes.** Every scan
    // in this file matches a literal `process.env.NAME`. A computed read,
    // `process.env[name]`, is invisible to all of them, and no amount of
    // widening the walk changes that.
    //
    // Rather than leave that as an unstated limit, the sites are enumerated.
    //
    // Two of the census are inside `check-provider-models.mjs`: the live
    // provider check reading MODEL keys (`GOOGLE_API_KEY`, `OPENAI_API_KEY` and
    // the BYOK vendors) from its own `keyNames` lists — no search key is
    // reachable through them.
    //
    // MERGE C (ABC-JEV-INTEGRATION.md §4 Round 3 "MERGE-B-FEED complete"): the
    // Jev integration adds a third, `src/lib/preferences/positive-seeds.ts`'s
    // `flagOn(name)` — read directly, not assumed: it is
    // `process.env[name]?.trim().toLowerCase() === "on"`, a boolean
    // feature-flag reader for Jev's own `PEER_CHANNEL_*` on/off flags
    // (`channelS2RecommendationsEnabled` and its siblings). It returns only a
    // boolean, never the string value, so no key — search, model, or
    // otherwise — is reachable through it either. Genuinely a new site, not
    // silently dropped; genuinely benign, checked rather than assumed.
    //
    // A fourth site, or a site outside these two files, is a place a search
    // credential could be read without any scan in this file seeing it. That
    // is a finding for the round it appears in, not a silent pass.
    const computedReaders = scannedFiles()
      .filter((file) => /process\.env\[/.test(code(file)))
      .map(relative)
      .sort();

    expect(computedReaders).toEqual([
      "scripts/check-provider-models.mjs",
      "src/lib/preferences/positive-seeds.ts",
    ]);
  });
});
