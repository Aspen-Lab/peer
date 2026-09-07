import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { opportunityRequestBody, paperFeedRequestBody } from "@/store/feed";
import {
  ANONYMOUS_ENTITLEMENT,
  type Entitlement,
} from "@/lib/entitlement/types";
import {
  aiAvailability,
  aiModeChip,
  feedsUseAi,
  hasUserLlmOverride,
  planChipText,
} from "./ai-tier";

/**
 * RULING 66a / 68a (round 25 C, item 2). **THE CHIP'S PREDICATE, IN BOTH
 * STATES, PLUS THE IDENTITY THAT MAKES THE FIX HOLD.**
 *
 * The defect was never detection or pinning: the dashboard chip rendered from
 * `aiPaperSearchEnabled && canUseAiTools`, and `aiPaperSearchEnabled` is a
 * PAPERS toggle that the job/event request builder never reads. So the chip
 * said `Tier 0` — and its tooltip said "no AI API" — while the feeds sent
 * `aiTier: 2`. Round 25 B proved the pipelines were already running the model
 * on localhost.
 *
 * The fix is that both sides now call the SAME function. **The load-bearing
 * assertion in this file is the last one: the chip's boolean and the request
 * builder's `aiTier` are computed from one predicate and cannot drift again.**
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

/**
 * ABC-freemium 1-14 / 1-16 — the two entitlements that matter here. D1 gives
 * Peer's model to **every signed-in user**, so `plan` is deliberately `free`:
 * if a later change tightens the predicate to `effectivePlan`, these tests go
 * red.
 */
const SIGNED_IN: Entitlement = {
  ...ANONYMOUS_ENTITLEMENT,
  userId: "user-1",
  deepReportsBudget: 5,
};
const SIGNED_OUT: Entitlement = ANONYMOUS_ENTITLEMENT;

const ADVISOR_SEEDS = { seedTexts: [], seedWorkIds: [] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aiAvailability — the ONE predicate", () => {
  // ABC-freemium 1-14 · R-ENT-3 — REWRITTEN, NOT DELETED. Every case below used
  // to turn on `process.env.NODE_ENV === "development"`, which Next inlines into
  // the browser bundle: the client decided whether AI was available by asking
  // how it had been built. The dev override moved server-side to
  // `PEER_DEV_ENTITLEMENT` (R-ENT-5), so the runtime no longer appears here at
  // all — and the pair of assertions below is what proves it cannot come back.
  it("is the SAME in development and in production", () => {
    // The single assertion that would have caught all six deleted flags.
    for (const env of ["development", "production"] as const) {
      vi.stubEnv("NODE_ENV", env);
      expect(aiAvailability(NO_KEY, SIGNED_IN)).toBe("system");
      expect(aiAvailability(NO_KEY, SIGNED_OUT)).toBe("none");
      expect(aiAvailability(BYOK, SIGNED_IN)).toBe("byok");
      expect(aiAvailability(BYOK, SIGNED_OUT)).toBe("byok");
    }
  });

  it("gives a signed-in FREE user Peer's model (D1)", () => {
    // The ceiling is `userId !== null`, never `effectivePlan`. A later round
    // will be tempted to tighten this to `paid`; that would break D1.
    expect(SIGNED_IN.effectivePlan).toBe("free");
    expect(aiAvailability(NO_KEY, SIGNED_IN)).toBe("system");
    expect(feedsUseAi(NO_KEY, SIGNED_IN)).toBe(true);
  });

  it("gives a signed-out reader nothing", () => {
    expect(aiAvailability(NO_KEY, SIGNED_OUT)).toBe("none");
    expect(feedsUseAi(NO_KEY, SIGNED_OUT)).toBe(false);
  });

  it("keeps a BYOK reader on their own key even when entitled", () => {
    // The three cache keys of R-UI-4 depend on this staying distinct from
    // "system": a BYOK report and a Peer-AI report must not share an entry.
    expect(aiAvailability(BYOK, SIGNED_IN)).toBe("byok");
    expect(hasUserLlmOverride(BYOK)).toBe(true);
    expect(hasUserLlmOverride(NO_KEY)).toBe(false);
  });

  it("is not BYOK when a provider is chosen but the key is blank", () => {
    expect(aiAvailability({ ...BYOK, feedAiApiKey: "   " }, SIGNED_OUT)).toBe(
      "none",
    );
    expect(
      aiAvailability({ ...BYOK, feedAiApiKey: undefined }, SIGNED_IN),
    ).toBe("system");
  });
});

describe("aiModeChip — what the mode chip actually says", () => {
  // ABC-freemium 1-24 · R-UI-1, D6 — REWRITTEN, NOT DELETED. Every assertion
  // below used to pin the literal strings "Tier 2" and "Tier 0", which is the
  // vocabulary D6 removes from every rendered string. The field is renamed
  // `tier` -> `plan` so the compiler finds the one call site rather than
  // leaving a stale word there, and the chip now says TWO things the tier
  // number said neither of: which plan, and whether AI is on.
  const NOW = new Date("2026-09-04T12:00:00.000Z");

  it("says AI is on with the papers toggle OFF — the old bug, still a contract", () => {
    // THE USER'S ORIGINAL REPORT, kept as an assertion. Papers toggle off,
    // model reachable: the chip used to read "Tier 0" and say "no AI API"
    // while the job and event feeds ran on a model.
    const chip = aiModeChip({
      feedsUseAi: true,
      aiSearchActive: false,
      entitlement: SIGNED_IN,
      now: NOW,
    });

    expect(chip.ai).toBe("AI on");
    expect(chip.title).not.toContain("no AI API");
    expect(chip.title).toContain("Job and event search already use AI");
    // The LABEL still reports this button's own pressed state — that half was
    // never wrong, and changing it would be a different lie.
    expect(chip.label).toBe("Auto");
  });

  it("says AI is on with the papers toggle ON", () => {
    const chip = aiModeChip({
      feedsUseAi: true,
      aiSearchActive: true,
      entitlement: SIGNED_IN,
      now: NOW,
    });

    expect(chip.ai).toBe("AI on");
    expect(chip.label).toBe("AI search");
    expect(chip.title).toContain("job and event search use AI too");
  });

  it("says AI is off when no model is reachable, and points at the two ways in", () => {
    const chip = aiModeChip({
      feedsUseAi: false,
      aiSearchActive: false,
      entitlement: SIGNED_OUT,
      now: NOW,
    });

    expect(chip.ai).toBe("AI off");
    expect(chip.label).toBe("Auto");
    expect(chip.title).toBe("Sign in to use Peer's AI, or add your own key.");
  });

  it("renders R-UI-1's three plan strings", () => {
    const plan = (
      effectivePlan: Entitlement["effectivePlan"],
      trialEndsAt: string | null = null,
    ) =>
      aiModeChip({
        feedsUseAi: true,
        aiSearchActive: false,
        entitlement: { effectivePlan, trialEndsAt },
        now: NOW,
      }).plan;

    expect(plan("free")).toBe("Free");
    expect(plan("paid")).toBe("Pro");
    expect(plan("trial", "2026-09-07T12:00:00.000Z")).toBe("Trial · 3 days left");
    expect(plan("trial", "2026-09-05T12:00:00.000Z")).toBe("Trial · 1 day left");
  });

  it("reads Free for a signed-out visitor, never a blank", () => {
    // Signed-out is a KNOWN state whose `effectivePlan` really is "free", so
    // this stays exactly as it was.
    //
    // 7-01 — the comment that used to sit here said "the anonymous entitlement
    // is a real object, so the chip always has a value — there is no empty
    // state to design." The first clause is true; the conclusion was the bug
    // written down. **There is now an empty state**, and it is a different
    // reader: `entitlement === null`, nobody has looked yet. The case below
    // this one is that reader. Conflating them is what put "Free" in front of
    // paying customers.
    expect(
      aiModeChip({
        feedsUseAi: false,
        aiSearchActive: false,
        entitlement: SIGNED_OUT,
        now: NOW,
      }).plan,
    ).toBe("Free");
  });

  it("contains no tier vocabulary in any state", () => {
    for (const feedsUseAi of [true, false]) {
      for (const aiSearchActive of [true, false]) {
        for (const entitlement of [SIGNED_IN, SIGNED_OUT]) {
          const chip = aiModeChip({
            feedsUseAi,
            aiSearchActive,
            entitlement,
            now: NOW,
          });
          const all = `${chip.label} ${chip.plan} ${chip.ai} ${chip.title}`;
          expect(all).not.toMatch(/Tier [012]|BYOK/);
        }
      }
    }
  });

  /**
   * ABC-freemium 7-01 · Ruling 17 point 5 · Ruling 19 point 5.
   *
   * **These cases exist because round-7 B planted the finished fix and the
   * entire gate came back byte-identical to baseline.** Widening a parameter to
   * `| null` breaks no caller that passes an object, and widening a return from
   * `string` to `string | null` breaks no assertion expecting `"Free"` — so
   * every test above stayed green whether the chip was fixed or broken.
   * **A change that reddens nothing is not evidence of safety; it is evidence
   * of an untested surface.**
   */
  describe("the plan is absent while it is unknown (7-01)", () => {
    it("returns null, not 'Free', when nobody has looked yet", () => {
      // The defect, driven at the seam: a PAID reader read "Free" until
      // `GET /api/profile` answered, and "we have not asked" was
      // indistinguishable on screen from "you are on the free plan".
      expect(planChipText(null, NOW)).toBeNull();
      expect(
        aiModeChip({
          feedsUseAi: false,
          aiSearchActive: false,
          entitlement: null,
          now: NOW,
        }).plan,
      ).toBeNull();
    });

    it("returns null on the default clock too, not just an injected one", () => {
      // The guard must sit ahead of every other branch, including the one that
      // reads the trial clock. If it were reordered below the date maths this
      // would throw rather than answer.
      expect(planChipText(null)).toBeNull();
    });

    it("moves ONLY the plan segment — the capability claims are untouched", () => {
      // `allowance.ts` ratifies failing a CAPABILITY closed while ignorant, and
      // the chip's `ai`, `label` and `title` are capability claims. Only the
      // plan asserts a fact about the reader, so only the plan may go absent.
      // Without this, "fix the chip" invites someone to blank all four.
      const unknown = aiModeChip({
        feedsUseAi: false,
        aiSearchActive: false,
        entitlement: null,
        now: NOW,
      });

      expect(unknown.ai).toBe("AI off");
      expect(unknown.label).toBe("Auto");
      expect(unknown.title).toBe("Sign in to use Peer's AI, or add your own key.");
    });

    it("still answers for every KNOWN state, anonymous included", () => {
      // The complement of the case above: absence is for the unknown reader
      // only. A guard that swallowed the anonymous reader too would pass the
      // first case and break R-UI-1.
      expect(planChipText(SIGNED_OUT, NOW)).toBe("Free");
      expect(planChipText({ effectivePlan: "free", trialEndsAt: null }, NOW)).toBe("Free");
      expect(planChipText({ effectivePlan: "paid", trialEndsAt: null }, NOW)).toBe("Pro");
      expect(
        planChipText(
          { effectivePlan: "trial", trialEndsAt: "2026-09-07T12:00:00.000Z" },
          NOW,
        ),
      ).toBe("Trial · 3 days left");
    });

    it("is given the RAW entitlement by the dashboard, never the grants view", () => {
      // **This is the actual fix**, and it is the one thing no behavioural case
      // above can see: `aiModeChip` could be perfect and the page could still
      // hand it `entitlementGrants(entitlement)`, which turns "not known" into
      // "free" by design. Asserted in source because `page.tsx` is a client
      // component with a store graph a suite would have to fake wholesale.
      // Whitespace-tolerant: the tree is CRLF on disk.
      const source = readFileSync(
        join(process.cwd(), "src", "app", "page.tsx"),
        "utf8",
      );
      const call = source.match(/aiModeChip\(\{[\s\S]*?\}\);/);

      expect(call, "the aiModeChip call site moved").not.toBeNull();
      expect(call?.[0]).toMatch(/entitlement\s*,/);
      expect(call?.[0]).not.toMatch(/entitlement\s*:\s*grants/);
    });

    it("renders NO plan span while the plan is unknown — not a blank one", () => {
      // Ruling 17 point 5 forbids blank-substitution by name, so the segment
      // must be absent rather than an empty span holding its width. The other
      // half of the render nobody can drive in a unit test.
      const source = readFileSync(
        join(process.cwd(), "src", "app", "page.tsx"),
        "utf8",
      );

      expect(source).toMatch(
        /aiChip\.plan\s*===\s*null\s*\?\s*null\s*:\s*\(\s*<span/,
      );
    });
  });

  it("never lets the papers toggle move the plan text", () => {
    // The predicate the chip's plan reads must be independent of the papers
    // toggle in BOTH directions. Goes red if a later change points `plan` back
    // at `aiSearchActive`.
    for (const feeds of [true, false]) {
      const on = aiModeChip({
        feedsUseAi: feeds,
        aiSearchActive: true,
        entitlement: SIGNED_IN,
        now: NOW,
      });
      const off = aiModeChip({
        feedsUseAi: feeds,
        aiSearchActive: false,
        entitlement: SIGNED_IN,
        now: NOW,
      });
      expect(`${feeds}: ${on.plan} / ${off.plan}`).toBe(
        `${feeds}: ${on.plan} / ${on.plan}`,
      );
    }
  });
});

describe("the chip and the feeds cannot disagree again", () => {
  it("computes the chip's boolean and ALL THREE request builders' aiTier from one predicate", () => {
    // **THE ANTI-DRIFT LOCK, EXTENDED.** It used to cover the jobs and events
    // builders only, and the papers builder was the one that drifted: round-1 B
    // found `store/feed.ts` re-implementing both halves inline, with a local
    // `hasUserLlmOverride` that SHADOWED the imported function of the same name.
    // Adding `paperFeedRequestBody` here is what would have caught it.
    //
    // The environment loop stays, and now proves the opposite of what it used
    // to: the answer must be the same in both runtimes, because no client code
    // may decide AI availability from `NODE_ENV` any more (R-ENT-3 as amended).
    for (const env of ["development", "production"] as const) {
      for (const [label, profile] of [
        ["no-key", NO_KEY],
        ["byok", BYOK],
      ] as const) {
        for (const [who, entitlement] of [
          ["signed-in", SIGNED_IN],
          ["signed-out", SIGNED_OUT],
        ] as const) {
          vi.stubEnv("NODE_ENV", env);
          const expected = feedsUseAi(profile, entitlement) ? 2 : 0;
          const where = `${env}/${label}/${who}`;

          for (const surface of ["jobs", "events"] as const) {
            const body = opportunityRequestBody(profile, surface, [], entitlement);
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
            entitlement,
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
      NO_KEY,
      ADVISOR_SEEDS,
      false,
      [],
      SIGNED_IN,
    );
    expect(papers.aiTier).toBe(0);
    expect(opportunityRequestBody(NO_KEY, "jobs", [], SIGNED_IN).aiTier).toBe(2);
  });

  it("still sends an override only on the bring-your-own-key path", () => {
    // A signed-in reader on Peer's model: tier 2, but NO key leaves the client.
    const system = opportunityRequestBody(NO_KEY, "jobs", [], SIGNED_IN);
    expect(system.aiTier).toBe(2);
    expect(system.llmOverride).toBeUndefined();
    // BYOK: tier 2 and the reader's own override.
    const byok = opportunityRequestBody(BYOK, "jobs", [], SIGNED_IN);
    expect(byok.aiTier).toBe(2);
    expect(byok.llmOverride).toEqual({
      provider: "openai",
      apiKey: "not-a-real-key",
    });
  });
});
