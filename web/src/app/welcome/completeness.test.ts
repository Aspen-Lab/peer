import { describe, it, expect } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  STEP_META,
  firstIncompleteStep,
  isStepDone,
  offersSignIn,
  stepIndexFromKey,
  visibleSteps,
} from "./completeness";

function profileWith(patch: Partial<UserProfile>): UserProfile {
  return { ...defaultProfile, ...patch };
}

// A profile saved on a device from before the events and jobs feeds were
// stopped: the fields are gone from the type, but the stored blob can still
// hold them until the store's v8 migration has run.
function legacyProfileWith(legacy: Record<string, unknown>): UserProfile {
  return { ...defaultProfile, ...legacy } as UserProfile;
}

describe("stepIndexFromKey", () => {
  it("resolves the direct walkthrough step and ignores invalid values", () => {
    expect(stepIndexFromKey("ai")).toBe(STEP_META.findIndex((m) => m.key === "ai"));
    expect(stepIndexFromKey("unknown")).toBeNull();
    expect(stepIndexFromKey(null)).toBeNull();
  });

  it("a link to the retired Data step opens the first unfinished step instead", () => {
    expect(stepIndexFromKey("connectors")).toBeNull();
  });
});

describe("STEP_META", () => {
  // OWN-KEY lane 4: Account joined, first. Still no Data step.
  it("has Account then six steps and no Data step (the events and jobs data sources are stopped)", () => {
    expect(STEP_META.map((m) => m.key)).toEqual([
      "account",
      "basics",
      "topics",
      "work",
      "radar",
      "ai",
      "persona",
    ]);
    expect(STEP_META.map((m) => m.label)).not.toContain("Data");
  });
});

describe("isStepDone", () => {
  it("a fresh default profile has every step un-done", () => {
    for (const m of STEP_META) {
      expect(isStepDone(m.key, defaultProfile, false)).toBe(false);
    }
  });

  it("basics: done when the name, stage, or leaning deviates from defaults", () => {
    expect(isStepDone("basics", profileWith({ displayName: "Peter" }), false)).toBe(true);
    expect(isStepDone("basics", profileWith({ careerStage: "Postdoc" }), false)).toBe(true);
    expect(
      isStepDone("basics", profileWith({ industryVsAcademia: "academia" }), false),
    ).toBe(true);
  });

  it("topics: done only with at least one required topic", () => {
    expect(isStepDone("topics", profileWith({ softTopics: ["x"] }), false)).toBe(false);
    expect(
      isStepDone("topics", profileWith({ researchTopics: ["batteries"] }), false),
    ).toBe(true);
  });

  it("topics: only the Papers Required list counts, even on a device that still holds event and job topics", () => {
    expect(
      isStepDone(
        "topics",
        legacyProfileWith({
          eventRequiredTopics: ["battery conferences"],
          jobRequiredTopics: ["battery scientist"],
        }),
        false,
      ),
    ).toBe(false);
    expect(
      isStepDone(
        "topics",
        legacyProfileWith({
          researchTopics: ["batteries"],
          eventRequiredTopics: [],
          eventExploreTopics: [],
          jobRequiredTopics: [],
          jobExploreTopics: [],
        }),
        false,
      ),
    ).toBe(true);
  });

  it("work: any of project/challenges/school/advisor marks it done", () => {
    expect(isStepDone("work", profileWith({ currentProject: "p" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ school: "MIT" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ advisorName: "A" }), false)).toBe(true);
    expect(isStepDone("work", profileWith({ advisorAuthorId: "A5" }), false)).toBe(true);
  });

  it("radar: deviation from any rendered default, or a preferred journal", () => {
    expect(isStepDone("radar", profileWith({ feedFocus: "tight" }), false)).toBe(true);
    expect(isStepDone("radar", profileWith({ paperCount: 5 }), false)).toBe(true);
    expect(
      isStepDone("radar", profileWith({ preferredJournals: ["Nature"] }), false),
    ).toBe(true);
    // feedMethodMode is not rendered by the wizard — must not count.
    expect(
      isStepDone("radar", profileWith({ feedMethodMode: "mustMatch" }), false),
    ).toBe(false);
  });

  // The `ai` step is done when a model will actually run for this reader: their
  // own provider AND key, and a signed-in reader (or no sign-in configured).
  // Peer has no key to lend, so nothing else can complete it.
  it("ai: a signed-in reader needs their own provider AND key", () => {
    expect(isStepDone("ai", profileWith({ feedAiProvider: "openai" }), false, "signed-in")).toBe(false);
    expect(isStepDone("ai", profileWith({ feedAiApiKey: "sk-x" }), false, "signed-in")).toBe(false);
    expect(
      isStepDone(
        "ai",
        profileWith({ feedAiProvider: "openai", feedAiApiKey: "sk-x" }),
        false,
        "signed-in",
      ),
    ).toBe(true);
  });

  it("ai: a signed-in reader with no key is NOT complete — Peer has no model to lend", () => {
    // The step used to be done for any signed-in reader, because "default"
    // meant Peer's own AI. It means reading without a model now.
    expect(isStepDone("ai", defaultProfile, false, "signed-in")).toBe(false);
    // and the other steps are not moved by this either way.
    expect(isStepDone("radar", defaultProfile, false, "signed-in")).toBe(false);
    expect(isStepDone("topics", defaultProfile, false, "signed-in")).toBe(false);
  });

  it("ai: a key does not complete the step for a reader who is not signed in", () => {
    const keyed = profileWith({ feedAiProvider: "openai", feedAiApiKey: "sk-x" });
    // The server refuses a signed-out caller, so no model would run.
    expect(isStepDone("ai", keyed, false)).toBe(false);
    expect(isStepDone("ai", keyed, false, "signed-out")).toBe(false);
    expect(isStepDone("ai", keyed, false, "unknown")).toBe(false);
    // Where sign-in is not configured at all, the server lets the call through.
    expect(isStepDone("ai", keyed, false, "unconfigured")).toBe(true);
  });

  it("persona: driven by the passed-in flag", () => {
    expect(isStepDone("persona", defaultProfile, true)).toBe(true);
  });
});

describe("firstIncompleteStep", () => {
  it("a fresh profile starts at step 0", () => {
    expect(firstIncompleteStep(defaultProfile, false)).toBe(0);
  });

  it("skips completed leading steps — a finished step is never asked for again", () => {
    const p = profileWith({
      displayName: "Peter",
      authorisedCountries: ["United States"],
      researchTopics: ["solid state battery"],
      currentProject: "electrolyte modelling",
    });
    // basics, topics, work done → open on radar. The work-rights step that
    // used to sit between basics and topics is gone.
    // OWN-KEY lane 4: Account now comes first, so this is asked for a signed-in
    // reader (Account done: radar is index 4) and where sign-in is not
    // configured (no Account step: radar is index 3, as before).
    expect(firstIncompleteStep(p, false, "signed-in")).toBe(4);
    expect(firstIncompleteStep(p, false, "unconfigured")).toBe(3);
    // L4-fix (R13, D3) — CHANGED: this was "a signed-out reader is offered
    // Account first, however much else is done" (index 0). A returning
    // reader now resumes where the wizard opened before Account existed:
    // radar, index 4 of the visible list.
    expect(firstIncompleteStep(p, false, "signed-out")).toBe(4);
  });

  it("a fully set-up profile lands on the last step, not past the end", () => {
    const p = profileWith({
      displayName: "Peter",
      authorisedCountries: ["United States"],
      researchTopics: ["x"],
      school: "MIT",
      feedFocus: "tight",
      feedAiProvider: "openai",
      feedAiApiKey: "sk",
    });
    expect(firstIncompleteStep(p, true, "signed-in")).toBe(STEP_META.length - 1);
  });
});

// OWN-KEY lane 4 — the Account step: first, optional, done when signed in, and
// absent where sign-in is not configured. Every index the wizard uses (deep
// links, the resume position) is into the list the reader is shown.
describe("the Account step", () => {
  const keys = (auth: Parameters<typeof visibleSteps>[0]) => visibleSteps(auth).map((m) => m.key);

  it("is first, labelled Account", () => {
    expect(STEP_META[0]).toEqual({ key: "account", label: "Account" });
  });

  it("is shown wherever sign-in exists, including while the check is still unknown", () => {
    for (const auth of ["signed-in", "signed-out", "unknown"] as const) {
      expect(keys(auth)).toEqual(STEP_META.map((m) => m.key));
    }
  });

  it("is left out entirely where sign-in is not configured, the rest in order", () => {
    expect(keys("unconfigured")).toEqual(["basics", "topics", "work", "radar", "ai", "persona"]);
  });

  it("is done only when signed in", () => {
    expect(isStepDone("account", defaultProfile, false, "signed-in")).toBe(true);
    expect(isStepDone("account", defaultProfile, false, "signed-out")).toBe(false);
    expect(isStepDone("account", defaultProfile, false, "unknown")).toBe(false);
    expect(isStepDone("account", defaultProfile, false)).toBe(false);
  });

  it("deep links resolve on the visible list: ?step=account where sign-in exists, nothing where it does not", () => {
    expect(stepIndexFromKey("account", visibleSteps("signed-out"))).toBe(0);
    expect(stepIndexFromKey("ai", visibleSteps("signed-out"))).toBe(5);
    expect(stepIndexFromKey("account", visibleSteps("unconfigured"))).toBeNull();
    expect(stepIndexFromKey("ai", visibleSteps("unconfigured"))).toBe(4);
    expect(stepIndexFromKey("basics", visibleSteps("unconfigured"))).toBe(0);
  });

  it("a new signed-out reader lands on Account first", () => {
    expect(firstIncompleteStep(defaultProfile, false, "signed-out")).toBe(0);
    expect(visibleSteps("signed-out")[firstIncompleteStep(defaultProfile, false, "signed-out")].key).toBe("account");
    // and while the check has not answered, the same place, so nothing jumps.
    expect(firstIncompleteStep(defaultProfile, false, "unknown")).toBe(0);
  });

  it("a new signed-in reader skips it (done) and lands on Basics", () => {
    const steps = visibleSteps("signed-in");
    expect(steps[firstIncompleteStep(defaultProfile, false, "signed-in")].key).toBe("basics");
  });

  it("where sign-in is not configured, a new reader lands on Basics, index 0 of the shorter list", () => {
    expect(firstIncompleteStep(defaultProfile, false, "unconfigured")).toBe(0);
    expect(visibleSteps("unconfigured")[0].key).toBe("basics");
  });

  it("a fully set-up profile still lands on the last visible step, Persona, without sign-in configured", () => {
    const p = profileWith({
      displayName: "Peter",
      researchTopics: ["x"],
      school: "MIT",
      feedFocus: "tight",
      feedAiProvider: "openai",
      feedAiApiKey: "sk",
    });
    const steps = visibleSteps("unconfigured");
    expect(firstIncompleteStep(p, true, "unconfigured")).toBe(steps.length - 1);
    expect(steps[steps.length - 1].key).toBe("persona");
  });

  // L4-fix (R13, D3) — CHANGED: this pinned the defect ("… opens on Account,
  // not Persona"). A returning signed-out reader now resumes where the wizard
  // opened before Account existed, never on Account.
  describe("resuming (R13, D3): Account opens the wizard only for a new reader", () => {
    const full = profileWith({
      displayName: "Peter",
      researchTopics: ["x"],
      school: "MIT",
      feedFocus: "tight",
      feedAiProvider: "openai",
      feedAiApiKey: "sk",
    });
    const keyOf = (p: UserProfile, persona: boolean, auth: "signed-out" | "unknown" | "signed-in") =>
      visibleSteps(auth)[firstIncompleteStep(p, persona, auth)].key;

    /** The rule before Account existed, over the six steps it had. */
    const before = (p: UserProfile, persona: boolean, auth: "signed-out" | "unknown" | "signed-in") => {
      const six = STEP_META.filter((m) => m.key !== "account");
      const j = six.findIndex((m) => !isStepDone(m.key, p, persona, auth));
      return j === -1 ? six[six.length - 1].key : six[j].key;
    };

    it("a returning signed-out reader with everything set up does not open on Account", () => {
      expect(keyOf(full, true, "signed-out")).not.toBe("account");
    });

    it("…and opens where it did before this work: the AI step, the one step a signed-out reader cannot finish (the key waits for sign-in)", () => {
      expect(isStepDone("ai", full, true, "signed-out")).toBe(false);
      expect(keyOf(full, true, "signed-out")).toBe("ai");
      expect(keyOf(full, true, "signed-out")).toBe(before(full, true, "signed-out"));
    });

    it("signed in, the same profile still opens on the last step, Persona", () => {
      expect(firstIncompleteStep(full, true, "signed-in")).toBe(STEP_META.length - 1);
    });

    it("a new reader (nothing done) still starts on Account, signed out or not yet known", () => {
      expect(keyOf(defaultProfile, false, "signed-out")).toBe("account");
      expect(keyOf(defaultProfile, false, "unknown")).toBe("account");
    });

    it("every returning signed-out reader resumes exactly where the wizard opened before Account existed", () => {
      const profiles: Array<[UserProfile, boolean]> = [
        [profileWith({ displayName: "Peter" }), false],
        [profileWith({ researchTopics: ["x"] }), false],
        [profileWith({ displayName: "Peter", researchTopics: ["x"], school: "MIT" }), false],
        [profileWith({ displayName: "Peter", researchTopics: ["x"], school: "MIT", feedFocus: "tight" }), false],
        [full, false],
        [full, true],
        [profileWith({ displayName: "Peter", researchTopics: ["x"], school: "MIT", feedFocus: "tight" }), true],
      ];
      for (const [p, persona] of profiles) {
        for (const auth of ["signed-out", "unknown"] as const) {
          expect(keyOf(p, persona, auth)).toBe(before(p, persona, auth));
          expect(keyOf(p, persona, auth)).not.toBe("account");
        }
      }
    });
  });

  it("offers the sign-in buttons to a reader who is not signed in, on a deployment that has sign-in", () => {
    expect(offersSignIn("signed-out")).toBe(true);
    expect(offersSignIn("unknown")).toBe(true);
    expect(offersSignIn("signed-in")).toBe(false);
    expect(offersSignIn("unconfigured")).toBe(false);
  });
});
