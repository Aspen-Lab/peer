import fs from "node:fs";
import { webSearchOptions } from "@/lib/sources/vertex-search";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PreferenceLedger } from "@/types";
import { buildDailyEventPool } from "./pipeline";
import { scoredEventToEvent } from "./mapper";
import { MIN_SCORE } from "./scoring";
import type { EventsFeedRequest } from "./types";
import { DENY_HOSTS } from "./sources/eventweb";
import { canRunLiveEventsBenchmark } from "./benchmark-live-gate";

interface ProfileSnapshot {
  researchTopics?: string[];
  softTopics?: string[];
  preferredMethods?: string[];
  advisorSeedTexts?: string[];
  preferenceLedger?: PreferenceLedger;
  careerStage?: EventsFeedRequest["careerStage"];
  industryVsAcademia?: EventsFeedRequest["industryVsAcademia"];
  locationPreferences?: string[];
  currentProject?: string;
  tavilyEnabled?: boolean;
  tavilyApiKey?: string;
}

const defaultProfilePath = path.join(
  process.cwd(),
  ".local-data",
  "profile.json",
);
// An override lets an isolated git worktree validate the real local snapshot
// without copying a secret into a path that may not yet be gitignored.
const profilePath =
  process.env.PEER_PROFILE_SNAPSHOT_PATH ?? defaultProfilePath;
const profile = fs.existsSync(profilePath)
  ? (JSON.parse(fs.readFileSync(profilePath, "utf8")) as ProfileSnapshot)
  : undefined;
/**
 * RULING 75 / RULING 76d — **THE GATE MOVES OFF THE TAVILY KEY.**
 *
 * It used to read `Boolean(profile?.tavilyApiKey?.trim())`, and that was wrong
 * the moment Ruling 75 disabled Tavily: the KEY is still on disk, so the gate
 * stayed TRUE and the benchmark kept RUNNING with the web source switched off.
 * Round 28 A found exactly that — a green that was an ABSENCE. The gate now
 * asks the only question that matters: **is there a live search path at all?**
 *
 * Tavily counts only when it is both keyed AND enabled. Gemini counts when the
 * server's Vertex project is reachable — the same credential the LLM path uses,
 * carried into the test process by `vitest.config.ts` (Vitest does not load env
 * files on its own; measured, see that file). With neither, the suite SKIPS
 * rather than passing on an empty pool.
 */
const tavilySearchLive =
  Boolean(profile?.tavilyApiKey?.trim()) && profile?.tavilyEnabled !== false;
const geminiSearchLive = Boolean(process.env.GOOGLE_VERTEX_PROJECT);
const hasLiveSearchPath =
  canRunLiveEventsBenchmark() && (tavilySearchLive || geminiSearchLive);

function hostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isDeniedHost(host: string): boolean {
  return DENY_HOSTS.some(
    (denied) => host === denied || host.endsWith(`.${denied}`),
  );
}

/**
 * A23-03 / RULING 62a / RULING 63b — THE ADJUDICATED PLACE ROWS.
 * (Round 24 C, item 3. These two lists are what replaced the coverage floor;
 * the restatement itself is commented at the assertion site below.)
 *
 * Ruling 62a's four named CONTAMINATION hosts. Each of these pages mentions a
 * city exactly ONCE, in text that is not a venue statement, and the place guard
 * correctly renders NOTHING. **Silence is the CORRECT VALUE for these rows**,
 * and it is asserted as a value rather than tolerated as an absence.
 */
const CONTAMINATION_HOSTS = [
  "flogen.org",
  "storageusa.solarenergyevents.com",
  "nanoge.org",
  "sdle.co.il",
] as const;

/**
 * The VENUE-ANCHORED hosts and the city each one must render. Ground truth from
 * round 24 A's live census, where the same city token appears 6–22 times in the
 * page: `Aachen` ×22, `Jakarta` ×22, `Detroit` ×17, `Orlando` ×8, `San Diego` ×6
 * (and in that page's own title). **This wires up Ruling 62a's OWN FALSIFIER —
 * "any correct, current venue lost" — which no assertion in this file covered.**
 *
 * SIX, NOT FIVE, AND C SAYS WHY: round 24 B's design named
 * `thebatteryshowsouth.com` and C's brief named `battery-power.eu`. Both are
 * separately adjudicated correct-and-kept rows, so C locks the UNION rather
 * than choosing. An absent row is skipped, so the extra entry costs nothing and
 * loses no adjudicated ground.
 *
 * MAINTENANCE RULE, stated up front because without it this rots into a
 * nuisance inside three rounds: a conference legitimately moves city between
 * editions. When a named row's correct venue genuinely CHANGES, the expected
 * value is RESTATED here with the round and the reason named — **never deleted,
 * never loosened to "any city"**. That is Ruling 61c's own rule applied to the
 * artefact it created.
 */
const VENUE_ANCHORED_CITY: ReadonlyArray<readonly [string, string]> = [
  ["battery-power.eu", "Aachen"],
  ["ibatterysummit.com", "Jakarta"],
  ["thebatteryshow.com", "Detroit"],
  ["thebatteryshowsouth.com", "Atlanta"],
  ["internationalbatteryseminar.com", "Orlando"],
  ["advancedautobat.com", "San Diego"],
];

describe.skipIf(!hasLiveSearchPath)("events live relevance benchmark", () => {
  it(
    // TITLE RESTATED by round 25 C, item ZERO (Ruling 65 / 68d), because the
    // contract underneath it changed twice and the name had stopped describing
    // it. It read "enriches at least half the pool and resolves the Solid-State
    // Battery Summit": the first half named the city-coverage floor round 24 C
    // restated away under 63b, and the second half named the top-five presence
    // demand this round's item zero restates below. Restating a title is not
    // deleting a test — leaving it would make the name lie about the contract.
    "returns a live pool and locks the adjudicated and flagship rows that are present in it",
    async () => {
      const pool = await buildDailyEventPool({
        topics: profile?.researchTopics ?? [],
        softTopics: profile?.softTopics ?? [],
        methods: profile?.preferredMethods ?? [],
        seedTexts: profile?.advisorSeedTexts ?? [],
        preferenceLedger: profile?.preferenceLedger,
        careerStage: profile?.careerStage,
        industryVsAcademia: profile?.industryVsAcademia,
        locationPreferences: profile?.locationPreferences ?? [],
        currentProject: profile?.currentProject,
        topN: 5,
        aiTier: 0,
        searchConnectors: {
          tavily: {
            enabled: profile?.tavilyEnabled !== false,
            apiKey: profile?.tavilyApiKey,
          },
          // RULING 75 — the request now carries the gemini provider. When the
          // profile disables Tavily the pipeline takes this branch and the live
          // pool comes from Vertex Gemini grounding.
          gemini: { enabled: true },
        },
      });
      const survivors = pool.items;
      const topFive = survivors
        .filter((item) => item.score >= MIN_SCORE)
        .slice(0, 5)
        .map((item) => scoredEventToEvent(item));
      const withCity = survivors.filter((item) => item.place?.city);
      const cityCoverage =
        survivors.length > 0 ? withCity.length / survivors.length : 0;

      console.info(
        "EVENT_BENCHMARK_TOP5",
        topFive.map((item) => ({
          name: item.name,
          host: hostname(item.linkOfficial),
          city: item.place?.city,
          date: item.date,
        })),
      );
      console.info("EVENT_BENCHMARK_CITY_COVERAGE", {
        withCity: withCity.length,
        survivors: survivors.length,
        ratio: cityCoverage,
      });
      // RULING 75 requirement 3 (Ruling 69's measurement-profile pattern). The
      // provider is REPORTED BY THE RUN rather than remembered, so a method line
      // that says `searchProvider: gemini` can be copied from a window that
      // actually took it. The corpus BREAKS at this round: Google's results are
      // not Tavily's, and no cross-provider row comparison is drift.
      console.info("EVENT_BENCHMARK_SEARCH_PROVIDER", {
        // CREDIT MIGRATION — this line used to hard-code `"gemini"`, which
        // silently became a FALSE method line the moment a Vertex AI Search app
        // was configured: the run took `vertex` and the log still said
        // `gemini`. The comment above already demands the provider be reported
        // by the run rather than remembered, so it now reads the same
        // resolution the pipeline itself uses.
        searchProvider:
          tavilySearchLive ? "tavily" : (webSearchOptions(undefined)?.provider ?? "none"),
        eventwebFetched: pool.fetched.eventweb ?? 0,
        eventwebError: pool.errors.eventweb ?? null,
      });

      expect(survivors.length).toBeGreaterThan(0);

      // ══════════════════════════════════════════════════════════════════════
      // RULING 63b's COMMISSIONED RESTATEMENT (round 24 C, item 3).
      // This replaces `expect(cityCoverage).toBeGreaterThanOrEqual(0.5)`.
      // THE LINE IS RESTATED, NOT DELETED — the ratio is still computed and
      // still console.info-ed above as an observability metric; it is simply no
      // longer ASSERTED.
      //
      // WHY: 63b's diagnosis is that this floor and Ruling 62a's place design
      // pull in OPPOSITE directions, and the design is winning. The guard
      // silences a city that is merely MENTIONED, so the better it works the
      // LOWER this ratio goes — 0.4375 in round 23, then 0.333 and 0.286 in
      // round 24, moving AWAY from the floor for the right reason. A red that
      // only means "the guard did its job" carries no information, and Ruling
      // 32 names "this field must not be empty" as the defect itself.
      //
      // **THERE IS DELIBERATELY NO LOWER BOUND ON `withCity`, AND A POOL WITH
      // ZERO CITIES IS A PASS.** That absence is commented here rather than
      // merely left out.
      //
      // WHAT REPLACES IT is a NAMED-ROW VALUE LOCK — the shape this loop has
      // already shipped twice (62c's `careerservices.upenn.edu` admitted
      // control and the SolarPACES regression lock). It measures the VALUE of
      // `place.city` on rows already adjudicated, not how many rows have one.
      //
      // Two candidate quality floors were built and KILLED as provably vacuous
      // before this design was chosen (round 24 B): "a rendered city must not
      // sit on an online-only row" is false by construction, since a row with a
      // city HAS a physical place; and "a rendered city must appear in the row's
      // own location string" is tautological, since `location` is COMPOSED from
      // `place`. There is no non-vacuous LIVE oracle for "venue-anchored" —
      // deciding it requires knowing where the event is, which is the thing
      // being extracted. That property is PROVEN deterministically instead, by
      // the ablation fixtures in
      // `src/lib/opportunities/structured-extract.test.ts`. This benchmark's
      // job is the half only it can do: catching the shipped pipeline
      // REGRESSING on rows we have already adjudicated.
      //
      // LIVE-SAFETY: every named row is SKIPPED when it is not in the pool.
      // Assert on rows PRESENT; never demand presence.
      // ══════════════════════════════════════════════════════════════════════
      let namedRowsExercised = 0;
      for (const host of CONTAMINATION_HOSTS) {
        for (const item of survivors.filter((row) =>
          hostname(row.url).endsWith(host),
        )) {
          namedRowsExercised += 1;
          // The host is prefixed into both sides so a failure names the row.
          expect(`${host} -> ${item.place?.city ?? "(silent)"}`).toBe(
            `${host} -> (silent)`,
          );
        }
      }
      for (const [host, city] of VENUE_ANCHORED_CITY) {
        for (const item of survivors.filter((row) =>
          hostname(row.url).endsWith(host),
        )) {
          namedRowsExercised += 1;
          expect(`${host} -> ${item.place?.city ?? "(silent)"}`).toBe(
            `${host} -> ${city}`,
          );
        }
      }
      // THE LOCK IS ALIVE. This is a floor on TEST EXERCISE, not on FIELD
      // VALUES — it creates no pressure to render a city anywhere, and fails
      // only when this benchmark has quietly stopped testing anything at all.
      // Measured at 5 named rows per pull across round 24 B's five pulls, so a
      // floor of 1 has four rows of headroom. That distinction is why it is not
      // the shape Ruling 32 forbids.
      expect(namedRowsExercised).toBeGreaterThan(0);

      // ══════════════════════════════════════════════════════════════════════
      // RULING 65 / RULING 68d (round 25 C, ITEM ZERO; contract designed by
      // round 25 B, item 3). THE TOP-FIVE PRESENCE ASSERTION, RESTATED IN
      // PLACE — NOT DELETED. It read:
      //
      //   expect(
      //     topFive.some(
      //       (item) =>
      //         hostname(item.linkOfficial).endsWith("cambridgeenertech.com") ||
      //         /solid[-\s]?state battery summit/i.test(item.name),
      //     ),
      //   ).toBe(true);
      //
      // **IT WAS THE THIRD ASSERTION OF THE CLASS 63b AND 64c EACH REMOVED:**
      // it demanded that a SPECIFIC ROW BE PRESENT in a LIVE pool. Its cost was
      // not a standing red but something harder to reason about — an
      // HOUR-TO-HOUR FLAKE. Round 24 C measured it RED; round 25 B measured it
      // GREEN one hour later with nothing changed in between. Ruling 68d names
      // the class and commissions this restatement to retire it.
      //
      // THE NEW CONTRACT — what it MEASURES, ASSERTS and TOLERATES.
      //
      // MEASURES: the named flagship rows — host `cambridgeenertech.com`, or a
      // name matching /solid[-\s]?state battery summit/i — **that are actually
      // PRESENT in `survivors`**. `survivors` rather than `topFive` because
      // only the scored rows still carry `.score`, which is the durable half.
      //
      // ASSERTS, per PRESENT row — three VALUE locks, no presence demand:
      //  (1) `score >= MIN_SCORE`. **THIS IS THE NON-VACUOUS CORE.** The pool
      //      is built `applyFloor: false` at every stage (`lib/events/
      //      pipeline.ts:94, 109, 232`), so a named row genuinely CAN sit in
      //      `survivors` BELOW the floor — this can really fail, and it fails
      //      exactly when the pipeline has started under-scoring the
      //      benchmark's flagship topic. That is the durable half of what the
      //      old line was built to catch, stated with no claim whatever about
      //      pool composition.
      //  (2) its URL is not the conference INDEX page — the page A24-01 drops
      //      by KIND.
      //  (3) its name is not a provider-attribution phrase.
      // (2) and (3) mirror 64c's restated block below, but this matcher reaches
      // rows 64c's does not: 64c filters on the HOST only, while this block
      // also names rows by NAME regex. The row satisfying it today is
      // `10times.com` — a host 64c's block never touches — so they are not
      // duplicates.
      //
      // TOLERATES — commented rather than merely left out, so the next agent
      // does not read the absence as an oversight:
      //  * **ZERO PRESENT ROWS IS A PASS.** Nothing here demands that either
      //    flagship reach the pool, the top five, or any rank.
      //  * Pool composition, ranking position and top-five membership are
      //    asserted NOWHERE. They oscillate hour to hour and this loop now has
      //    two contradictory readings that prove it.
      //  * No city claim is added anywhere — 63b's decision stands untouched.
      //
      // **THE TRAP, NAMED SO IT IS NOT WALKED INTO AGAIN** (Ruling 68d; B's
      // item 3 states it): 63b's `expect(namedRowsExercised).toBeGreaterThan(0)`
      // above is correct IN ITS OWN BLOCK — those rows measured 5–8 per pull.
      // **It must NOT be copied here.** These are the rows that GO ABSENT
      // (`cambridgeenertech.com` was measured NOT OFFERED by round 25 A), so a
      // floor of 1 on them IS the presence demand wearing a counter's clothes.
      // The count is therefore computed, `console.info`-ed, and **asserted on
      // by nothing** — the same disposition 63b gave `cityCoverage` itself.
      //
      // THE RANKING CLAIM the old line partly carried is NOT given a live
      // substitute, and that is a decision rather than an omission: `topFive`
      // is a filtered prefix of an already score-sorted array, so any ordering
      // assertion over it is TAUTOLOGICAL, and any "must reach the top five"
      // claim is a claim about what ELSE the live search returned — the exact
      // fault 63b and 64c both removed. Per 63b's own precedent that property
      // is proven deterministically, in the ablation fixtures, not here.
      // ══════════════════════════════════════════════════════════════════════
      const flagshipRows = survivors.filter(
        (item) =>
          hostname(item.url).endsWith("cambridgeenertech.com") ||
          /solid[-\s]?state battery summit/i.test(item.name),
      );
      console.info("EVENT_BENCHMARK_FLAGSHIP_ROWS", {
        exercised: flagshipRows.length,
        rows: flagshipRows.map((item) => ({
          name: item.name,
          host: hostname(item.url),
          score: item.score,
          atOrAboveFloor: item.score >= MIN_SCORE,
        })),
      });
      for (const item of flagshipRows) {
        const row = `${hostname(item.url)} -> ${item.name}`;
        expect(
          item.score,
          `${row} scored ${item.score}, below MIN_SCORE ${MIN_SCORE}`,
        ).toBeGreaterThanOrEqual(MIN_SCORE);
        // The row is named through the MESSAGE argument, not by decorating the
        // subject string. That is deliberate: this regex is `$`-anchored, and
        // appending a label to the subject would push the anchor past the end
        // of the URL and make the clause unfailable.
        expect(
          item.url,
          `${row} readmitted the conference index page`,
        ).not.toMatch(/\/cet\/conferences\/?(?:[?#].*)?$/);
        expect(
          item.name,
          `${row} is named after a provider attribution`,
        ).not.toMatch(
          /^\s*(?:provided|presented|organised|organized|hosted)\s+by\b/i,
        );
      }
      // ══════════════════════════════════════════════════════════════════════
      // RULING 64c (round 24 C, item 3). THE `Chicago` HARD-ASSERT, RESTATED,
      // NOT DELETED. It read:
      //
      //   const summit =
      //     survivors.find((item) => hostname(item.url).endsWith("cambridgeenertech.com"))
      //     ?? survivors.find((item) =>
      //          /solid[-\s]?state battery summit/i.test(item.name)
      //          && item.place?.city === "Chicago");
      //   expect(summit?.place?.city).toBe("Chicago");
      //
      // **IT ASSERTED THE OLD WORLD TWICE OVER**, and it is the same structural
      // fault Ruling 63b named one assertion above: it demands that a specific
      // city be PRESENT, and it was satisfied by values this round's design
      // removes on purpose.
      //  - Its FIRST arm was satisfied by `cambridgeenertech.com/cet/conferences`
      //    — the conference INDEX page A24-01 now drops by KIND.
      //  - Its FALLBACK demanded a `solid-state battery summit` row already
      //    carrying `Chicago`, and Ruling 62a's place guard rightly SILENCES
      //    that row's city (measured 5 of 5). `Chicago` appeared 4 times in a
      //    29 kB index page — between the guard's live classes (silenced at 1,
      //    kept at 6–22) and NOT a venue statement.
      // So `summit` becomes `undefined` and `expect(undefined).toBe("Chicago")`
      // would fail for the two best possible reasons.
      //
      // THE NEW CONTRACT: **no row anywhere is required to prove a city.** If
      // this host is in the pool at all, its row must be one of the host's
      // DATED EVENT PAGES rather than the index, and it must not be named after
      // a provider-attribution phrase. Absent host, no assertion — same
      // live-safety rule as the value lock above.
      // ══════════════════════════════════════════════════════════════════════
      for (const item of survivors.filter((row) =>
        hostname(row.url).endsWith("cambridgeenertech.com"),
      )) {
        // RULING 70 (round 25 manager; landed round 26 C, item ZERO). This
        // subject used to read `` `${item.url} (index page readmitted?)` ``.
        // The regex is `$`-anchored, so appending a label pushed the anchor
        // past the end of the URL and the clause COULD NEVER FAIL — a
        // decoration wearing a value lock's name, inside the block Ruling 64c
        // commissioned. The row is now named through the MESSAGE argument, the
        // pattern already used by the flagship loop above, and the regex is
        // tested against the RAW url. Negative proof: point this at
        // `https://www.cambridgeenertech.com/cet/conferences` and it goes RED;
        // on an event page (`/cet/conferences/solid-state-batteries`) it is
        // GREEN. Under the old form BOTH were green.
        expect(
          item.url,
          `${hostname(item.url)} -> ${item.name} readmitted the conference index page`,
        ).not.toMatch(/\/cet\/conferences\/?(?:[?#].*)?$/);
        expect(item.name).not.toMatch(
          /^\s*(?:provided|presented|organised|organized|hosted)\s+by\b/i,
        );
      }
      for (const item of topFive) {
        expect(isDeniedHost(hostname(item.linkOfficial))).toBe(false);
      }
    },
    90_000,
  );
});
