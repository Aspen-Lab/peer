import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ABC-freemium 9-01 · Ruling 21 point 2, Ruling 26 point 4.
 *
 * **The two operator scripts must resolve the Vertex AI Search project through
 * the same single expression the app does, and must fail LOUDLY on the old
 * name.** Until 9-01 they fell back to `GOOGLE_VERTEX_PROJECT` — the *models*
 * project — which made a wrong configuration succeed: the setup script built a
 * real index in the grounding project, the probe billed ~$4 against it, and the
 * app queried nothing, because `vertexSearchProject()`
 * (`src/lib/sources/vertex-search.ts`) reads only
 * `GOOGLE_VERTEX_SEARCH_PROJECT`. No error was printed anywhere. That is the
 * defect this file pins.
 *
 * **This file lives under `src/` on purpose.** Vitest's `include` is
 * `src/**​/*.test.{ts,tsx}` — a test placed next to the scripts under
 * `scripts/` would never run, and the requirement would be green by absence.
 * `assert-byok-production-env.test.ts` is the precedent and says the same.
 *
 * ── COVERAGE BOUNDARY, DECLARED (Ruling 26 point 2) ────────────────────────
 *
 * `setup-vertex-search.mjs` is **spawned** in all three of its project states,
 * including the accepting one: `--dry-run` plus a deliberately unreadable
 * `GOOGLE_APPLICATION_CREDENTIALS` makes it die on credentials the moment it
 * gets past the project gate, so the accepting case costs no network call and
 * creates no cloud resource.
 *
 * `probe-vertex-search-billing.mjs` is spawned **only in its two refusing
 * states, and this exclusion is deliberate**: past its project gate the script
 * spends about **$4 of real money** on billed search requests by design
 * (`PRICE_PER_1000 = 4`, default 1000 queries) and it has no `--dry-run`. Its
 * accepting half is therefore pinned by **reading its source**, not by running
 * it. Both refusing states exit before `new GoogleAuth(...)` is ever
 * constructed, so they are free.
 */

const SCRIPTS = path.join(process.cwd(), "scripts");
const SETUP = path.join(SCRIPTS, "setup-vertex-search.mjs");
const PROBE = path.join(SCRIPTS, "probe-vertex-search-billing.mjs");

/** A recognisable value that must never be echoed back on a refusal path. */
const SENTINEL = "SENTINEL-NOT-A-PROJECT-4c71";

/**
 * A path that cannot exist, so `GoogleAuth` fails on the credential file rather
 * than reaching for the GCE metadata server (which would be a network call with
 * a timeout). This is what makes the accepting case cheap and deterministic.
 */
const UNREADABLE_CREDENTIALS = path.join(
  SCRIPTS,
  "no-such-file-9f3a.credentials.json",
);

/**
 * Run a script with a **controlled** environment, so the developer's own shell
 * or `.env` cannot make a case pass or fail by accident, and no real credential
 * is ever handed to the child.
 */
function runScript(
  script: string,
  env: Record<string, string>,
  args: string[] = [],
): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
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
 * Whitespace-tolerant on purpose: the tree is CRLF on disk and these
 * declarations wrap across lines (Ruling 10 point 2c).
 */
function source(script: string): string {
  return readFileSync(script, "utf8");
}

const SCRIPT_TABLE = [
  { name: "setup-vertex-search.mjs", file: SETUP },
  { name: "probe-vertex-search-billing.mjs", file: PROBE },
] as const;

describe("the operator scripts resolve the Vertex AI Search project", () => {
  describe("the project expression matches the app's, in source", () => {
    for (const { name, file } of SCRIPT_TABLE) {
      it(`${name} reads GOOGLE_VERTEX_SEARCH_PROJECT and nothing else`, () => {
        const text = source(file);

        // The exact shape `vertexSearchProject()` uses in
        // `src/lib/sources/vertex-search.ts`.
        expect(text).toMatch(
          /const\s+PROJECT\s*=\s*process\.env\.GOOGLE_VERTEX_SEARCH_PROJECT\?\.trim\(\)\s*;/,
        );

        // And the fallback that caused the defect is gone. `GOOGLE_VERTEX_PROJECT`
        // may still be READ — that is how the loud message knows to fire — but it
        // must never feed `PROJECT`.
        expect(text).not.toMatch(
          /const\s+PROJECT\s*=[\s\S]{0,200}?\|\|[\s\S]{0,80}?process\.env\.GOOGLE_VERTEX_PROJECT/,
        );
      });
    }
  });

  describe("refusing states — spawned, and free of any cloud call", () => {
    for (const { name, file } of SCRIPT_TABLE) {
      it(`${name} exits 1 and names the new variable when nothing is set`, () => {
        const { status, output } = runScript(file, {});

        expect(status).toBe(1);
        expect(output).toContain("GOOGLE_VERTEX_SEARCH_PROJECT");
      });

      it(`${name} exits 1 on the OLD name alone, and says why it was ignored`, () => {
        // THE CASE THAT WOULD HAVE CAUGHT THIS. Before 9-01 this environment
        // was a silent success: the script ran against the models project.
        const { status, output } = runScript(file, {
          GOOGLE_VERTEX_PROJECT: "models-project",
        });

        expect(status).toBe(1);
        expect(output).toContain("GOOGLE_VERTEX_SEARCH_PROJECT");
        // An operator who set the old name must be told it was seen and
        // ignored, or they will simply set it again.
        expect(output).toContain("deliberately NOT read here");
        expect(output).toContain("MODELS project");
        // And that recovery is one line, not a rebuild — the fact that makes
        // failing loudly cheap.
        expect(output).toMatch(/does NOT move and is NOT\s*[\r\n]*\s*rebuilt/);
      });

      it(`${name} never prints the VALUE of the old variable`, () => {
        const { status, output } = runScript(file, {
          GOOGLE_VERTEX_PROJECT: SENTINEL,
        });

        expect(status).toBe(1);
        expect(output).toContain("GOOGLE_VERTEX_PROJECT");
        expect(output).not.toContain(SENTINEL);
      });
    }
  });

  describe("accepting state — setup-vertex-search.mjs, spawned", () => {
    it("gets past the project gate on the new name alone", () => {
      const { output } = runScript(
        SETUP,
        {
          GOOGLE_VERTEX_SEARCH_PROJECT: "search-project",
          // Fails on the credential file, so nothing reaches the network and
          // no Discovery Engine resource is created.
          GOOGLE_APPLICATION_CREDENTIALS: UNREADABLE_CREDENTIALS,
        },
        ["--dry-run"],
      );

      // It got past: the run banner prints the resolved project.
      expect(output).toContain("project: search-project");
      // And it did not refuse.
      expect(output).not.toContain("GOOGLE_VERTEX_SEARCH_PROJECT is not set");
      // The exit is the credential failure, which is what proves it got past
      // rather than that it was skipped.
      expect(output).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    });
  });

  describe("the success message hands out instructions that WORK", () => {
    it("prints BOTH lines isVertexSearchAvailable() needs, not one", () => {
      // The sharpest instance of the defect and the one nobody had named: this
      // is not an error path, it is what the operator sees AFTER the script
      // succeeds. It said "Add this line" and printed the engine id only, so
      // following it to the letter left the provider off.
      const text = source(SETUP);

      expect(text).toMatch(
        /console\.log\(\s*[\s\S]{0,40}?Add BOTH of these lines to web\/\.env\.local/,
      );
      expect(text).toMatch(
        /console\.log\(\s*`GOOGLE_VERTEX_SEARCH_PROJECT=\$\{PROJECT\}`\s*\)\s*;/,
      );
      expect(text).toMatch(
        /console\.log\(\s*`GOOGLE_VERTEX_SEARCH_ENGINE_ID=\$\{ENGINE_ID\}`\s*\)\s*;/,
      );
    });
  });

  describe("the operator document agrees with the scripts", () => {
    // Fixing the scripts and leaving the instructions is the defect moved, not
    // closed (Ruling 26 point 4). `docs/SETUP_vertex_ai_search.md` is the only
    // operator-facing instruction set — nothing links to it and there is no
    // `.env.example` — so it is pinned here rather than left to a reader.
    const DOC = path.join(process.cwd(), "..", "docs", "SETUP_vertex_ai_search.md");

    it("no longer says GOOGLE_VERTEX_PROJECT is the search project's default", () => {
      const text = source(DOC);

      // The table row that told an operator the old name was a working default.
      expect(text).not.toMatch(
        /\|\s*`GOOGLE_VERTEX_SEARCH_PROJECT`\s*\|\s*`GOOGLE_VERTEX_PROJECT`\s*\|/,
      );
      expect(text).toMatch(
        /\|\s*`GOOGLE_VERTEX_SEARCH_PROJECT`\s*\|\s*\*\*none — required\*\*\s*\|/,
      );
    });

    it("no longer says one line turns the provider on", () => {
      const text = source(DOC);

      expect(text).not.toContain("That single line switches all three surfaces");
      expect(text).not.toContain("**Setting this is what turns the provider on.**");
      expect(text).toContain("Both lines are required");
    });

    it("prints the grounding backfill's default the right way round", () => {
      // 8-01(b) flipped `GOOGLE_VERTEX_SEARCH_FALLBACK` from opt-out to opt-in.
      // The doc kept saying the default was `on` and that you set it to `off` —
      // a money control printed backwards, and the money is ~$35/1,000 that the
      // GenAI App Builder credit does not cover.
      const text = source(DOC);
      const row = text
        .split(/\r?\n/)
        .find((line) => line.includes("`GOOGLE_VERTEX_SEARCH_FALLBACK`"));

      expect(row).toBeDefined();
      expect(row).toContain("**off**");
      expect(row).not.toMatch(/\|\s*on\s*\|/);
      expect(row).toContain("arm");
    });
  });
});
