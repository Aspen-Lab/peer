import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { jevGainSentence } from "@/lib/decisions/jev-claim";
import {
  JEV_SIGNUP_URL,
  JEV_SIGN_IN_NOTE,
  JevKeyField,
  JevScreeningStatus,
  JevSetup,
  JevSetupView,
  jevScreeningLine,
  jevSignInNote,
} from "./jev-setup";

// The Jev key field and the copy around it, as the Profile page and the welcome
// wizard render them. Optional, honest about what the key turns on and what it
// does not claim: no number for the improvement, no adjective of size, no price.

// An invented string. It is not, and never was, a key.
const KEY = "jev-setup-test-sentinel-not-a-key-0000";

/** The visible text of rendered markup: tags and attributes removed, entities decoded, whitespace collapsed. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

beforeEach(() => {
  useProfileStore.setState({ profile: { ...defaultProfile } });
});

describe("JevKeyField", () => {
  it("is a labelled password input (SecretInput): the key is hidden until the reader shows it", () => {
    const markup = render(createElement(JevKeyField, { value: "", onChange: () => {}, idPrefix: "t" }));

    expect(markup).toMatch(/<label[^>]*for="t-jev-key"[^>]*>Jev API key<\/label>/);
    expect(markup).toMatch(/<input[^>]*id="t-jev-key"[^>]*type="password"/);
    expect(markup).toMatch(/placeholder="Jev API key"/);
    expect(markup).toMatch(/autoComplete="off"|autocomplete="off"/i);
    expect(markup).toContain('aria-label="Show key"');
  });

  it("never renders the key as text: not in the visible text, not in the status line, not in a link", () => {
    const markup = render(createElement(JevKeyField, { value: KEY, onChange: () => {} }));

    expect(visibleText(markup)).not.toContain(KEY);
    expect(visibleText(markup)).toContain("Jev key saved on this device.");
    // The only place the value appears is the password input's own value.
    const withoutInput = markup.replace(/<input[^>]*>/g, "");
    expect(withoutInput).not.toContain(KEY);
    expect(markup).toMatch(/<input[^>]*type="password"[^>]*value="/);
  });

  it("says plainly when there is no key, when it is saved, and when what was pasted cannot be a key", () => {
    const none = visibleText(render(createElement(JevKeyField, { value: "", onChange: () => {} })));
    expect(none).toContain("No Jev key: papers are screened without Jev.");
    expect(none).not.toContain("Jev key saved on this device.");

    const blank = visibleText(render(createElement(JevKeyField, { value: "   ", onChange: () => {} })));
    expect(blank).toContain("No Jev key: papers are screened without Jev.");

    const saved = visibleText(render(createElement(JevKeyField, { value: KEY, onChange: () => {} })));
    expect(saved).toContain("Jev key saved on this device.");

    const spaced = visibleText(render(createElement(JevKeyField, { value: "two words", onChange: () => {} })));
    expect(spaced).toContain("That does not look like a key. It must be one string with no spaces or line breaks.");
    expect(spaced).not.toContain("Jev key saved on this device.");
  });

  it('links to where a reader gets a key: one constant, target _blank, noopener, the button reads "Get a Jev key"', () => {
    // D1: the sign-up page is the owner's to supply; until then the link is the
    // vendor's documentation host.
    expect(JEV_SIGNUP_URL).toBe("https://docs.typesafe.ai/");
    const markup = render(createElement(JevKeyField, { value: "", onChange: () => {} }));
    const link = markup.match(/<a [^>]*>/)?.[0] ?? "";
    expect(link).toContain(`href="${JEV_SIGNUP_URL}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain("noopener");
    expect(link).toContain("noreferrer");
    expect(visibleText(markup)).toContain("Get a Jev key");
  });
});

describe("JevSetup on the Profile page", () => {
  const profileText = () => visibleText(render(createElement(JevSetup, { variant: "profile", idPrefix: "p" })));

  it("says what works with no key, what a key adds, and what it does not claim", () => {
    const text = profileText();

    expect(text).toContain(
      "Without a key, Peer screens each day's papers with fixed scoring: your topics, your project text, how new a paper is and where it was published. That works with no setup.",
    );
    expect(text).toContain("A Jev key adds a second pass.");
    expect(text).toContain("For each of the 50 best candidates Jev answers up to four fixed questions about the paper");
    expect(text).toContain(
      "Peer moves papers up or down on the answers. A paper Jev cannot judge counts as neutral: Jev neither lifts nor lowers it, though papers Jev rates well can move ahead of it. Jev reads English best.",
    );
    // The claim comes from the one place that owns it.
    expect(text).toContain(jevGainSentence());
    expect(text).toContain("How much this improves your list is not yet measured.");
  });

  it("states the money sentence in full and says no more about money", () => {
    const text = profileText();
    expect(text).toContain("Jev bills your own account for what it reads.");
    expect(text).not.toMatch(/\$|cents?\b|¢|per month|a month|\/month|price|cost/i);
  });

  it("says it is optional, when it applies, and where the key lives, without claiming more than the code does", () => {
    const text = profileText();
    expect(text).toContain(
      "Optional. Applies to your next briefing. Peer keeps the key in this browser, never in your account; its server passes the key to Jev while it screens your papers and does not store or log it.",
    );
  });

  it("is the whole story of the Jev key on this page: the field, the status line and the link are in it", () => {
    const text = profileText();
    expect(text).toContain("Jev API key");
    expect(text).toContain("No Jev key: papers are screened without Jev.");
    expect(text).toContain("Get a Jev key");
  });

  it("reads and writes the reader's own key in the profile store, and in no other place", () => {
    // Static rendering shows the store's initial state (server snapshot), so the
    // wiring is pinned in the source: the key field is bound to the profile's
    // `jevApiKey` and its updater, which trims and clears like the model key.
    const source = readFileSync(path.join(process.cwd(), "src/components/profile/jev-setup.tsx"), "utf8");
    expect(source).toContain("s.profile.jevApiKey");
    expect(source).toContain("s.updateJevApiKey");
    expect(source).not.toMatch(/localStorage|sessionStorage|fetch\(|apiFetch/);
  });
});

// What Jev did the last time a briefing was built, in one line under the key.
// One line per status; none when there is nothing to report (no key, no report).
describe("jevScreeningLine - one line per status", () => {
  it("applied: how many papers Jev screened", () => {
    expect(jevScreeningLine({ status: "applied", screened: 50, of: 50 })).toBe(
      "Last briefing: 50 of 50 papers screened by Jev.",
    );
  });

  it("partial: the same sentence with the real count", () => {
    expect(jevScreeningLine({ status: "partial", screened: 31, of: 50 })).toBe(
      "Last briefing: 31 of 50 papers screened by Jev.",
    );
  });

  it("unavailable, nothing answered: Jev did not answer, and the briefing was screened without it", () => {
    expect(jevScreeningLine({ status: "unavailable", screened: 0, of: 50 })).toBe(
      "Jev did not answer; this briefing was screened without it.",
    );
  });

  it("unavailable, too few answered: says how many, and that the briefing was screened without it", () => {
    expect(jevScreeningLine({ status: "unavailable", screened: 20, of: 50 })).toBe(
      "Jev answered only 20 of 50 papers, too few to use; this briefing was screened without it.",
    );
  });

  it("rejected: Jev rejected the key", () => {
    expect(jevScreeningLine({ status: "rejected", screened: 0, of: 50 })).toBe("Jev rejected the key.");
  });

  it("nothing to report: no line", () => {
    expect(jevScreeningLine(null)).toBeNull();
    expect(jevScreeningLine(undefined)).toBeNull();
  });

  it("never states a size or a price, whatever the status", () => {
    for (const report of [
      { status: "applied", screened: 50, of: 50 },
      { status: "partial", screened: 31, of: 50 },
      { status: "unavailable", screened: 0, of: 50 },
      { status: "unavailable", screened: 20, of: 50 },
      { status: "rejected", screened: 0, of: 50 },
    ] as const) {
      expect(jevScreeningLine(report) ?? "").not.toMatch(/%|percent|better|sharper|faster|much|cents?|\$/i);
    }
  });
});

describe("JevScreeningStatus", () => {
  it("renders the line for a report, and nothing at all without one", () => {
    const shown = visibleText(
      render(createElement(JevScreeningStatus, { report: { status: "rejected", screened: 0, of: 50 } })),
    );
    expect(shown).toBe("Jev rejected the key.");
    expect(render(createElement(JevScreeningStatus, { report: null }))).toBe("");
  });

  it("is mounted in the Profile setup, and shown only for a key that is saved (no key, no hint)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/profile/jev-setup.tsx"), "utf8");
    expect(source).toContain("useJevScreeningStore");
    expect(source).toMatch(/usable[\s\S]*JevScreeningStatus|JevScreeningStatus[\s\S]*usable/);
    // The welcome block has no report line: nothing has been screened during onboarding.
    expect(source.match(/<JevScreeningStatus/g)).toHaveLength(1);
    const welcomeBranch = source.slice(
      source.indexOf('if (variant === "welcome") {'),
      source.indexOf("\n  }\n", source.indexOf('if (variant === "welcome") {')),
    );
    expect(welcomeBranch).not.toContain("JevScreeningStatus");
  });
});

describe("JevSetup in the welcome wizard", () => {
  const welcomeText = () => visibleText(render(createElement(JevSetup, { variant: "welcome", idPrefix: "w" })));

  it("is a short, optional block with the field: a kicker, what a key adds, and the claim sentence", () => {
    const text = welcomeText();

    expect(text).toContain("A second screening pass (optional)");
    expect(text).toContain("Without a key, Peer screens each day's papers with fixed scoring");
    expect(text).toContain("A Jev key adds a second pass.");
    expect(text).toContain("How much this improves your list is not yet measured.");
    expect(text).toContain("Jev API key");
    expect(text).toContain("Get a Jev key");
  });

  it("does not repeat the Profile page's longer notes", () => {
    const text = welcomeText();
    expect(text).not.toContain("Peer keeps the key in this browser");
  });
});

describe("what the Jev copy never says", () => {
  // The mandated not-measured sentence ("How much this improves your list is not
  // yet measured.") is pinned word for word by jev-claim.test.ts and contains the
  // word "much" by design; it is taken out before the scans below.
  const all = () =>
    [
      visibleText(render(createElement(JevSetup, { variant: "profile", idPrefix: "a" }))),
      visibleText(render(createElement(JevSetup, { variant: "welcome", idPrefix: "b" }))),
      visibleText(render(createElement(JevKeyField, { value: KEY, onChange: () => {} }))),
      visibleText(render(createElement(JevKeyField, { value: "", onChange: () => {} }))),
      JEV_SIGN_IN_NOTE,
    ]
      .join("\n")
      .split(jevGainSentence())
      .join("");

  it("has no adjective of size or of quality about the result, and no percent sign", () => {
    expect(all()).not.toMatch(/\b(much|far|greatly|sharper|sharp|better|best results|faster|stronger|dramatic\w*|significant\w*|huge|boost\w*|smarter|improved results)\b/i);
    expect(all()).not.toMatch(/%|percent/i);
  });

  it("states no number for the improvement: the only digits are the 50-candidate ceiling", () => {
    const withoutCeiling = all().replace(/For each of the 50 best candidates/g, "For each of the best candidates");
    expect(withoutCeiling).not.toMatch(/\d/);
  });

  it('never says "Tier N" or the bring-your-own-key abbreviation (the UI vocabulary gate)', () => {
    expect(all()).not.toMatch(/Tier [012]|BYOK/);
  });
});

// SF-4. Peer sends the Jev key only for a signed-in reader (or where there is no
// sign-in at all), so a key saved while signed out does nothing until the reader
// signs in. The model-key row says so ("Sign in to turn this on"); the Jev row has
// to say it too, or "Jev key saved on this device." reads as "Jev is on".
describe("the signed-out note", () => {
  it("is exactly one sentence, in plain words", () => {
    expect(JEV_SIGN_IN_NOTE).toBe("Sign in to use it: Jev screens only for a signed-in reader.");
  });

  it("is shown when the reader is signed out and a usable key is saved", () => {
    expect(jevSignInNote("signed-out", KEY)).toBe(JEV_SIGN_IN_NOTE);
    expect(jevSignInNote("signed-out", `  ${KEY}  `)).toBe(JEV_SIGN_IN_NOTE);
  });

  it("is not shown when there is no usable key to talk about", () => {
    expect(jevSignInNote("signed-out", "")).toBeNull();
    expect(jevSignInNote("signed-out", "   ")).toBeNull();
    expect(jevSignInNote("signed-out", "two words")).toBeNull();
  });

  it.each(["signed-in", "unconfigured", "unknown"] as const)(
    "is not shown while the sign-in state is %s, whatever is saved (the key is sent, or it is not yet known)",
    (outcome) => {
      expect(jevSignInNote(outcome, KEY)).toBeNull();
      expect(jevSignInNote(outcome, "")).toBeNull();
    },
  );

  const view = (variant: "profile" | "welcome", authOutcome: "signed-in" | "signed-out" | "unconfigured" | "unknown", jevApiKey: string) =>
    visibleText(
      render(
        createElement(JevSetupView, {
          variant,
          idPrefix: "v",
          jevApiKey,
          onChange: () => {},
          report: null,
          authOutcome,
        }),
      ),
    );

  it("Profile, signed out, key saved: the line is on the page", () => {
    expect(view("profile", "signed-out", KEY)).toContain(JEV_SIGN_IN_NOTE);
  });

  it("Profile, signed in, key saved: no line", () => {
    expect(view("profile", "signed-in", KEY)).not.toContain(JEV_SIGN_IN_NOTE);
    expect(view("profile", "signed-in", KEY)).toContain("Jev key saved on this device.");
  });

  it("Profile, signed out, no key: no line (there is nothing to sign in for)", () => {
    expect(view("profile", "signed-out", "")).not.toContain(JEV_SIGN_IN_NOTE);
  });

  it("Profile, no sign-in configured, or still checking: no line", () => {
    expect(view("profile", "unconfigured", KEY)).not.toContain(JEV_SIGN_IN_NOTE);
    expect(view("profile", "unknown", KEY)).not.toContain(JEV_SIGN_IN_NOTE);
  });

  it("the welcome block says it too, once, because a reader can paste a key there before signing in", () => {
    const text = view("welcome", "signed-out", KEY);
    expect(text).toContain(JEV_SIGN_IN_NOTE);
    expect(text.split(JEV_SIGN_IN_NOTE)).toHaveLength(2);
    expect(view("welcome", "signed-in", KEY)).not.toContain(JEV_SIGN_IN_NOTE);
  });

  it("never prints the key, and the note names no plan, tier or abbreviation", () => {
    const text = view("profile", "signed-out", KEY);
    expect(text).not.toContain(KEY);
    expect(JEV_SIGN_IN_NOTE).not.toMatch(/Tier|BYOK|plan|upgrade|free|paid/i);
  });

  it("reads the same signal the model-key row reads (useSyncGate's authOutcome), in the container", () => {
    // Static rendering shows the stores' initial state, so the wiring is pinned in
    // the source, as the key's own wiring is above.
    const source = readFileSync(path.join(process.cwd(), "src/components/profile/jev-setup.tsx"), "utf8");
    expect(source).toMatch(/useSyncGate\(\(s\) => s\.authOutcome\)/);
    expect(source).toMatch(/authOutcome=\{authOutcome\}/);
    const profilePage = readFileSync(path.join(process.cwd(), "src/app/profile/page.tsx"), "utf8");
    expect(profilePage).toMatch(/useSyncGate\(\(st\) => st\.authOutcome\)/);
  });
});
