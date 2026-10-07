import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { opportunityRequestBody, paperFeedRequestBody } from "@/store/feed";
import type { AuthOutcome } from "@/components/profile-sync";
import { aiAvailability, feedsUseAi, hasUserLlmOverride } from "./ai-tier";

/**
 * RULING 66a / 68a (round 25 C, item 2). **THE ONE PREDICATE, IN EVERY STATE,
 * PLUS THE IDENTITY THAT MAKES THE FIX HOLD.**
 *
 * The defect was never detection or pinning: the dashboard chip and the feeds'
 * `aiTier` were two expressions that never met, so the chip could say "no AI"
 * while a request asked for it. The fix is that both sides call the SAME
 * function. **The load-bearing assertion in this file is the last block: the
 * chip's boolean and the request builders' `aiTier` are computed from one
 * predicate and cannot drift again.**
 *
 * Peer holds no model key of its own, so there are exactly two answers: the
 * reader's own key, or no model. A key only counts for a signed-in reader (or
 * where sign-in is not configured at all), because that is what the server
 * does with the request.
 */

const BYOK: UserProfile = {
  ...defaultProfile,
  feedAiProvider: "openai",
  feedAiApiKey: "  not-a-real-key  ",
};
const NO_KEY: UserProfile = {
  ...defaultProfile,
  feedAiProvider: "default",
  feedAiApiKey: "",
};

const ALL_OUTCOMES: AuthOutcome[] = [
  "signed-in",
  "signed-out",
  "unconfigured",
  "unknown",
];

const ADVISOR_SEEDS = { seedTexts: [], seedWorkIds: [] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aiAvailability — the ONE predicate", () => {
  // ABC-freemium 1-14 · R-ENT-3 — REWRITTEN, NOT DELETED. Every case below used
  // to turn on `process.env.NODE_ENV === "development"`, which Next inlines into
  // the browser bundle: the client decided whether AI was available by asking
  // how it had been built. The runtime does not appear in the predicate at all,
  // and the loop below is what proves it cannot come back.
  it("is the SAME in development and in production", () => {
    for (const env of ["development", "production"] as const) {
      vi.stubEnv("NODE_ENV", env);
      expect(aiAvailability(NO_KEY, "signed-in")).toBe("none");
      expect(aiAvailability(NO_KEY, "signed-out")).toBe("none");
      expect(aiAvailability(BYOK, "signed-in")).toBe("byok");
      expect(aiAvailability(BYOK, "signed-out")).toBe("none");
    }
  });

  it("gives a signed-in reader with their own key that key", () => {
    expect(aiAvailability(BYOK, "signed-in")).toBe("byok");
    expect(feedsUseAi(BYOK, "signed-in")).toBe(true);
    expect(hasUserLlmOverride(BYOK)).toBe(true);
  });

  it("gives a signed-out reader with a key NO model — the chip must match the server", () => {
    // The server answers a signed-out caller with tier 0 (feed) or 401 (digest,
    // report, figure), so "AI on" for this reader was a wrong claim on screen.
    expect(aiAvailability(BYOK, "signed-out")).toBe("none");
    expect(feedsUseAi(BYOK, "signed-out")).toBe(false);
  });

  it("gives a reader no model while the sign-in check has not answered", () => {
    // Refusing a model for a moment costs a re-render; claiming one the server
    // then refuses puts a wrong "AI on" on screen. Fails closed.
    expect(aiAvailability(BYOK, "unknown")).toBe("none");
  });

  it("lets a key through where sign-in is not configured at all (self-hosted, tests)", () => {
    // The server lets the call through as well in that runtime, so the client
    // and the server agree.
    expect(aiAvailability(BYOK, "unconfigured")).toBe("byok");
  });

  it("gives a reader without a key no model, whoever they are — Peer has none to lend", () => {
    // The pre-BYOK-only build answered "system" here for any signed-in reader.
    // There is no such value any more, and signing in must never produce one.
    for (const outcome of ALL_OUTCOMES) {
      expect(aiAvailability(NO_KEY, outcome)).toBe("none");
      expect(feedsUseAi(NO_KEY, outcome)).toBe(false);
    }
    expect(hasUserLlmOverride(NO_KEY)).toBe(false);
  });

  it("is not a key when a provider is chosen but the key is blank", () => {
    for (const outcome of ALL_OUTCOMES) {
      expect(aiAvailability({ ...BYOK, feedAiApiKey: "   " }, outcome)).toBe(
        "none",
      );
      expect(
        aiAvailability({ ...BYOK, feedAiApiKey: undefined }, outcome),
      ).toBe("none");
    }
  });

  it("is not a key when a key is typed but no provider is chosen", () => {
    const orphan: UserProfile = {
      ...BYOK,
      feedAiProvider: "default",
      feedAiApiKey: "not-a-real-key",
    };
    for (const outcome of ALL_OUTCOMES) {
      expect(aiAvailability(orphan, outcome)).toBe("none");
    }
  });
});

describe("the chip and the feeds cannot disagree again", () => {
  it("computes the chip's boolean and ALL THREE request builders' aiTier from one predicate", () => {
    // **THE ANTI-DRIFT LOCK.** It covers the jobs, events AND papers builders:
    // the papers builder was the one that drifted once, when `store/feed.ts`
    // re-implemented both halves inline with a local `hasUserLlmOverride` that
    // SHADOWED the imported function of the same name.
    //
    // The environment loop proves the answer is the same in both runtimes,
    // because no client code may decide AI availability from `NODE_ENV`
    // (R-ENT-3 as amended).
    for (const env of ["development", "production"] as const) {
      for (const [label, profile] of [
        ["no-key", NO_KEY],
        ["byok", BYOK],
      ] as const) {
        for (const auth of ALL_OUTCOMES) {
          vi.stubEnv("NODE_ENV", env);
          const expected = feedsUseAi(profile, auth) ? 2 : 0;
          const where = `${env}/${label}/${auth}`;

          for (const surface of ["jobs", "events"] as const) {
            const body = opportunityRequestBody(profile, surface, [], auth);
            expect(`${where}/${surface} -> ${body.aiTier}`).toBe(
              `${where}/${surface} -> ${expected}`,
            );
          }

          // The papers builder ANDs its own surface toggle on top, so it is
          // compared with that toggle ON — the question is whether the
          // underlying predicate is the same one, not whether the toggle works.
          const papers = paperFeedRequestBody(
            profile,
            ADVISOR_SEEDS,
            true,
            [],
            auth,
          );
          expect(`${where}/papers -> ${papers.aiTier}`).toBe(
            `${where}/papers -> ${expected}`,
          );
        }
      }
    }
  });

  it("keeps the papers toggle able to turn papers OFF without moving the others", () => {
    // The toggle is a real, separate choice about one surface. Collapsing the
    // predicates must not collapse that too.
    const papers = paperFeedRequestBody(
      BYOK,
      ADVISOR_SEEDS,
      false,
      [],
      "signed-in",
    );
    expect(papers.aiTier).toBe(0);
    expect(opportunityRequestBody(BYOK, "jobs", [], "signed-in").aiTier).toBe(2);
  });

  it("asks for tier 0 and sends no key for a signed-in reader who has not added one", () => {
    // Peer has no model of its own: signing in does not buy a tier.
    const jobs = opportunityRequestBody(NO_KEY, "jobs", [], "signed-in");
    expect(jobs.aiTier).toBe(0);
    expect(jobs.llmOverride).toBeUndefined();
    const papers = paperFeedRequestBody(
      NO_KEY,
      ADVISOR_SEEDS,
      true,
      [],
      "signed-in",
    );
    expect(papers.aiTier).toBe(0);
    expect(papers.llmOverride).toBeUndefined();
  });

  it("sends the reader's own key only when it will be used", () => {
    // Signed in, with a key: tier 2 and the reader's own override.
    const byok = opportunityRequestBody(BYOK, "jobs", [], "signed-in");
    expect(byok.aiTier).toBe(2);
    expect(byok.llmOverride).toEqual({
      provider: "openai",
      apiKey: "not-a-real-key",
    });
    const papers = paperFeedRequestBody(
      BYOK,
      ADVISOR_SEEDS,
      true,
      [],
      "signed-in",
    );
    expect(papers.aiTier).toBe(2);
    expect(papers.llmOverride).toEqual({
      provider: "openai",
      apiKey: "not-a-real-key",
    });

    // Signed out, with a key: tier 0 and the key does not leave the browser.
    for (const auth of ["signed-out", "unknown"] as const) {
      const jobs = opportunityRequestBody(BYOK, "jobs", [], auth);
      expect(jobs.aiTier).toBe(0);
      expect(jobs.llmOverride).toBeUndefined();
      const feed = paperFeedRequestBody(BYOK, ADVISOR_SEEDS, true, [], auth);
      expect(feed.aiTier).toBe(0);
      expect(feed.llmOverride).toBeUndefined();
    }
  });
});
