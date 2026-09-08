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
 * `usage/quota-exemptions.test.ts` and `scripts/assert-byok-production-env.test.ts`
 * are the precedents for asserting on file contents rather than on behaviour;
 * this follows their shape.
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
 * `process.env.TAVILY_API_KEY` read planted inside `scripts/setup-vertex-search.mjs`
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
// SCAN 3 — operator search credentials are read in exactly one module
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 3 — every operator search credential is read in one place", () => {
  /**
   * **Widened by 2-04 from Tavily-only to every operator-funded search name.**
   * The gate is no longer about one key: Ruling 5 point 2 puts Brave, Vertex AI
   * Search and Gemini grounding behind the same predicate, so the scan that
   * protects the gate has to cover the same set. A scan that still looked only
   * for `TAVILY_API_KEY` would have reported "0" while three other names were
   * read straight from the environment — which is exactly what happened for a
   * whole round.
   */
  /**
   * **ABC-freemium 5-04 · D2a — THE LOOP IS NO LONGER UNIFORM, and that is the
   * point.** It used to run over `["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"]`
   * with one expectation for both. Under D2a the two names have different
   * answers: Brave is still read, once, inside the gate; Tavily is not read in
   * production source at all. Merging them back into one loop would lose the
   * distinction that matters.
   */
  const OPERATOR_SEARCH_ENV = ["BRAVE_SEARCH_API_KEY"] as const;

  /** The one module allowed to turn an operator search credential into a key. */
  const GATE = "src/lib/search/system-key.ts";

  for (const name of OPERATOR_SEARCH_ENV) {
    it(`reads process.env.${name} only inside the gate`, () => {
      const readers = filesMatching(
        new RegExp(`process\\.env\\.${name}\\b`),
      );
      expect(readers).toEqual([GATE]);
    });
  }

  it("reads process.env.TAVILY_API_KEY NOWHERE in production source", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12).
    //
    // This case was generated by the loop above and asserted `[GATE]`: exactly
    // one reader, `src/lib/search/system-key.ts`. D2a removed that read, so the
    // honest answer is now **none**.
    //
    // **This case IS standing tally 1 of Ruling 12 point 7** — "`process.env.
    // TAVILY_API_KEY` reads anywhere in non-test source: must be 0" — so the
    // tally is enforced by the gate rather than recounted by hand every round.
    // Note what it does NOT say: a reader's OWN Tavily key still works and is
    // still the only way anybody searches. What has no source left is the
    // SERVER's key.
    const readers = filesMatching(/process\.env\.TAVILY_API_KEY\b/);

    expect(readers).toEqual([]);
  });

  it("reads the GOOGLE_VERTEX_ search capability names only where they are gated", () => {
    // These are capabilities rather than keys — "is a project configured" — so
    // they legitimately live in the two search modules that own them. What must
    // NOT happen is a third module calling the availability helpers directly,
    // which is precisely the defect 2-04 fixed in `web-search.ts`, `jobweb.ts`
    // and `eventweb.ts`.
    //
    // ── REWRITTEN, NOT DELETED — ABC-freemium 9-04 (Ruling 26 points 2-3) ────
    //
    // **This case going red is what 9-04 looks like working.** The expectation
    // used to be the single app module, and that was only true because the walk
    // could not see `web/scripts/`. Widening the walk did not introduce two new
    // readers; it revealed two that have been there all along, in the files the
    // owner runs by hand.
    //
    // **Both are legitimate and neither is a spend risk, stated so the next
    // reader does not "tidy" them away:** these two scripts are the operator
    // tools that BUILD and QUERY the Discovery Engine index, so needing to know
    // which project and which app is their entire job. They are not runtime
    // code, they are not imported by anything under `src/`, and — this is the
    // part that matters — 9-01 made them read
    // `GOOGLE_VERTEX_SEARCH_PROJECT` and nothing else, which is the SAME single
    // expression `vertexSearchProject()` uses. Before 9-01 they fell back to
    // `GOOGLE_VERTEX_PROJECT`; that fallback is what this scan would now catch
    // coming back, because the fallback name would appear here as a fourth
    // entry.
    //
    // A FIFTH entry, or either script disappearing, is a change somebody must
    // explain.
    const readers = filesMatching(/process\.env\.GOOGLE_VERTEX_SEARCH_/);
    expect(readers).toEqual([
      "scripts/probe-vertex-search-billing.mjs",
      "scripts/setup-vertex-search.mjs",
      "src/lib/sources/vertex-search.ts",
    ]);
  });

  it("counts which operator scripts read the OLD models-project name, and why (9-01)", () => {
    // ABC-freemium 9-04, guarding 9-01, and written this way ON PURPOSE after a
    // first draft asserted the wrong thing.
    //
    // The tempting assertion is "no script reads `GOOGLE_VERTEX_PROJECT` any
    // more". **It is false, and asserting it would have been a wrong value
    // dressed as a guard.** Both operator scripts still read the old name — to
    // decide whether to PRINT the loud "that is the models project, and it is
    // deliberately not read here" message. Reading a name to explain why you
    // are ignoring it is the opposite of the defect.
    //
    // So the honest contract is the accepted SET, in the shape Ruling 6
    // point 4's structured-source tally already uses: exactly these two, each
    // for that one reason. A third script reading the models project is a new
    // coupling somebody has to justify; either of these two disappearing means
    // the loud message went with it.
    //
    // The contract that the old name never FEEDS the project — the actual
    // fallback — is asserted where it can be proved by running the scripts, in
    // `src/scripts/vertex-search-project.test.ts`. It is deliberately not
    // duplicated here as a weaker source-text copy that could drift from it.
    const legacyReaders = filesMatching(
      /process\.env\.GOOGLE_VERTEX_PROJECT\b/,
    ).filter((file) => file.startsWith("scripts/"));

    expect(legacyReaders).toEqual([
      "scripts/probe-vertex-search-billing.mjs",
      "scripts/setup-vertex-search.mjs",
    ]);
  });

  it("calls the availability helpers only from the gate and their own modules", () => {
    // ABC-freemium 2-04 — the gate is `operatorSearchAvailability()` in
    // `system-key.ts`. Every other caller must go through it, or the
    // entitlement is bypassed by a direct environment read.
    const callers = filesMatching(
      /\bis(Gemini|Vertex)SearchAvailable\s*\(/,
    );
    //
    // ── REWRITTEN, NOT DELETED — 5-04 · D2a (Ruling 12) ──────────────────────
    //
    // The expectation used to lead with `src/lib/search/system-key.ts`. Under
    // D2a `operatorSearchAvailability` answers `false` unconditionally and no
    // longer asks the environment anything, so the gate stopped importing both
    // helpers and only the two modules that OWN them still call them. The scan
    // failing on this change was the scan working: it noticed a caller
    // disappearing, which is the same sensitivity that notices one appearing.
    expect(callers).toEqual([
      "src/lib/sources/gemini-search.ts",
      "src/lib/sources/vertex-search.ts",
    ]);
  });

  it("counts the structured-source key reads that are ACCEPTED outside the gate", () => {
    // Ruling 6 point 4 — Adzuna, JSearch and USAJobs read
    // `request key || operator env key` in the same shape, and they deliberately
    // do NOT join the gate: they are the free structured backbone of the jobs
    // surface and their keys buy free-tier quota rather than per-call billing.
    //
    // **This is A's standing tally, as an assertion.** The number is 3. If it
    // rises, a fourth ungated structured source appeared and the manager needs
    // to rule on it; if one of these ever bills per request, it joins the gate
    // the same round (the ruling's stated threshold).
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
// SCAN 4 — no `resolveProvider()` without a usage context
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 4 — every resolveProvider call carries a context", () => {
  it("has no argument-less resolveProvider() call anywhere", () => {
    // D8 / R-METER-1 — the second argument is what attributes a model call to a
    // user. Round-2 A noted this is now true "by construction" because both
    // figure matchers take a required context; a test is what makes it stay
    // true when the next matcher is written.
    //
    // ── ABC-freemium 3-02 — THIS SCAN IS NOW A BELT WHOSE BRACES ARE THE TYPE ──
    //
    // `resolveProvider`'s second argument became **required and branded**, so
    // `tsc` rejects every shape this regex was looking for, and more besides.
    // The scan is kept rather than deleted for two reasons: a regex survives a
    // signature being loosened back to optional by someone who does not read
    // this file, and the failure message here names the offending file, which a
    // TS2554 at a call site does not.
    //
    // **Its old comment was also wrong in a way worth recording.** It said
    // "calls that pass an override but no context are legal — `tier2-rerank.ts`
    // and `query-gen.ts` are both R-QUOTA-3-exempt paths that still meter". The
    // metering half was true and beside the point: R-SEC-2 is about a caller
    // that skips the *entitlement* check, and a usage row for spend nobody
    // authorised is a receipt, not a guard. Those two callers were safe because
    // of a numeric tier ceiling, not because they metered — and that reason is
    // now written at each of them as a `SpendJustification` the compiler checks.
    const offenders = scannedFiles().filter((file) => {
      const source = code(file);
      // The declaration itself, and the unrelated local helper in
      // `sources/web-search.ts`, both have a parameter list — so a zero-argument
      // CALL is unambiguous.
      return /(?<!function\s)\bresolveProvider\(\s*\)/.test(source);
    });

    expect(offenders.map(relative)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 6 — the entitled-context brand is not quietly re-opened
// ─────────────────────────────────────────────────────────────────────────────

/** The module that owns the brand, and the only place it may be asserted. */
const ENTITLED_CONTEXT_MODULE = "src/lib/security/entitled-context.ts";

describe("scan 6 — nothing re-opens the entitled-context hole (3-02)", () => {
  it("declares no OPTIONAL entitled or provider context anywhere", () => {
    // ABC-freemium 3-02 · Ruling 7 point 3 — **the one attack the brand does
    // not stop on its own.** Round-3 B compiled it: a helper that declares
    // `ctx?: EntitledContext` type-checks perfectly and re-opens the exact hole
    // this item closed, because its callers may then omit it again. A brand
    // proves provenance; it cannot make a parameter mandatory.
    //
    // Optionality is banned in every spelling of it, including the union alias
    // and the `| undefined` form a formatter may produce.
    const offenders = scannedFiles().filter((file) =>
      /\b\w+\?\s*:\s*(EntitledContext|ProviderContext)\b|:\s*(EntitledContext|ProviderContext)\s*\|\s*undefined/.test(
        code(file),
      ),
    );

    expect(offenders.map(relative)).toEqual([]);
  });

  it("keeps the test-only escape hatch out of production code", () => {
    // There is exactly one way to mint a context without an entitlement and it
    // says `unsafe` in its own name so that this scan can be one word long. A
    // production file reaching for it is the brand being talked around rather
    // than satisfied.
    // `entitled-context.ts` is exempt: it DECLARES the hatch, which is how
    // there comes to be exactly one.
    const offenders = scannedFiles()
      .map(relative)
      .filter((file) => file !== ENTITLED_CONTEXT_MODULE)
      .filter((file) =>
        code(path.join(process.cwd(), file)).includes(
          "unsafeEntitledContextForTests",
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("asserts no cast to the brand outside the module that owns it", () => {
    // `as EntitledContext` compiles — TypeScript always allows it, and B
    // measured that rather than assuming otherwise. The win of a brand is that
    // asserting provenance you have not got becomes **greppable**, so this is
    // the grep. `entitled-context.ts` itself is exempt: the two casts inside it
    // are how the brand is applied at all.
    const offenders = scannedFiles()
      .map(relative)
      .filter((file) => file !== ENTITLED_CONTEXT_MODULE)
      .filter((file) =>
        /\bas\s+(EntitledContext|ProviderContext)\b/.test(
          code(path.join(process.cwd(), file)),
        ),
      );

    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 5 — every AI route is behind the shared guard
// ─────────────────────────────────────────────────────────────────────────────

describe("scan 5 — every route that can spend is behind requireEntitledAiRequest", () => {
  const GUARD = "requireEntitledAiRequest";

  /**
   * Routes that may reach a provider or an operator search key WITHOUT calling
   * the guard, each with the reason it is exempt. **A short, justified list —
   * never a convenience list.** Every entry here is a decision someone can
   * argue with, which is the point of writing them down.
   */
  const JUSTIFIED_EXEMPTIONS: Record<string, string> = {
    "src/app/api/jobs/dispatch-digests/route.ts":
      "D9 — the nightly cron runs on CRON_SECRET, not a session; it passes " +
      "systemSearchAllowed: false per enrolled user",
    "src/app/api/digest/test/route.ts":
      "a local-only diagnostic that answers 404 unless canUseLocalServerProvider()",
  };

  function apiRouteFiles(): string[] {
    return scannedFiles()
      .map(relative)
      .filter((file) => /^src\/app\/api\/.*\/route\.ts$/.test(file));
  }

  /** A route "can spend" if it can reach a provider or an operator search key. */
  function canSpend(file: string): boolean {
    const source = code(path.join(process.cwd(), file));
    return (
      /\bresolveProvider\s*\(/.test(source) ||
      /\bGoogleGenAI\b/.test(source) ||
      /systemSearchAllowed/.test(source)
    );
  }

  it("leaves no spending route unguarded and unjustified", () => {
    const unguarded = apiRouteFiles()
      .filter(canSpend)
      .filter((file) => {
        return !code(path.join(process.cwd(), file)).includes(GUARD);
      })
      .filter((file) => !(file in JUSTIFIED_EXEMPTIONS));

    expect(unguarded).toEqual([]);
  });

  it("keeps the exemption list honest — every entry still exists and still cannot spend safely", () => {
    // The staleness check `ui-vocabulary.test.ts` already does for its own list.
    // An exemption for a file that has been deleted or renamed is an exemption
    // nobody notices has stopped applying.
    for (const [file, reason] of Object.entries(JUSTIFIED_EXEMPTIONS)) {
      expect(
        fs.existsSync(path.join(process.cwd(), file)),
        `${file} is exempted for "${reason}" but no longer exists`,
      ).toBe(true);
    }
  });

  it("reports the guarded count, so a DROP is visible rather than silent", () => {
    // A's standing tally as an assertion. Nine routes carry the guard today. A
    // route losing it would otherwise show up only as an absence, and an
    // absence is what nobody notices.
    const guarded = apiRouteFiles().filter((file) =>
      code(path.join(process.cwd(), file)).includes(GUARD),
    );

    expect(guarded).toHaveLength(9);
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
      "scripts/setup-vertex-search.mjs",
      "scripts/probe-vertex-search-billing.mjs",
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
    expect(filesMatching(/process\.env\.BRAVE_SEARCH_API_KEY\b/)).toEqual([
      "src/lib/search/system-key.ts",
    ]);
  });

  it("names the one SHAPE these scans are still blind to, with its census", () => {
    // **A boundary is not only which files — it is which shapes.** Every scan
    // in this file matches a literal `process.env.NAME`. A computed read,
    // `process.env[name]`, is invisible to all of them, and no amount of
    // widening the walk changes that.
    //
    // Rather than leave that as an unstated limit, the sites are enumerated. The
    // census is TWO, both inside `check-provider-models.mjs`, and both are the
    // live provider check reading MODEL keys (`GOOGLE_API_KEY`, `OPENAI_API_KEY`
    // and the BYOK vendors) from its own `keyNames` lists — no search key is
    // reachable through them.
    //
    // A third site, or a site outside that file, is a place a search credential
    // could be read without any scan in this file seeing it. That is a finding
    // for the round it appears in, not a silent pass.
    const computedReaders = scannedFiles()
      .filter((file) => /process\.env\[/.test(code(file)))
      .map(relative)
      .sort();

    expect(computedReaders).toEqual(["scripts/check-provider-models.mjs"]);
  });
});
