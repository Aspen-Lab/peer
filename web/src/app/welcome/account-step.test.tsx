// OWN-KEY lane 4 — the welcome wizard's Account step and the AI step's
// "Sign in to use your key" block. House pattern (account-section.test.tsx):
// the props-only views render with renderToStaticMarkup, and the wiring that a
// static render cannot click is pinned in the source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import { safeReturnPath } from "@/lib/navigation/return-path";
import {
  ACCOUNT_STEP_RETURN_TO,
  AI_STEP_RETURN_TO,
  AccountStepView,
  CONTINUE_WITHOUT_SIGNING_IN,
  SKIP_SIGN_IN,
  SignInToUseKeyView,
  SkipSignInLabel,
  accountStepCopy,
  type AccountStepViewProps,
} from "./account-step";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

function fakeUser(): User {
  return {
    id: "user-1",
    email: "ada@example.test",
    user_metadata: { name: "Ada Lovelace" },
  } as unknown as User;
}

function renderAccount(overrides: Partial<AccountStepViewProps> = {}): string {
  const props: AccountStepViewProps = {
    auth: "signed-out",
    user: null,
    busy: false,
    onSignInGitHub: () => {},
    onSignInGoogle: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AccountStepView, props));
}

const signInButtons = (html: string) =>
  [...html.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/gs)].map((m) =>
    m[1].replace(/<svg.*?<\/svg>/gs, "").trim(),
  );

describe("AccountStepView — signed out", () => {
  it("shows the two sign-in buttons, GitHub first, the Account section's own buttons", () => {
    const html = renderAccount({ auth: "signed-out" });
    expect(signInButtons(html)).toEqual(["Sign in with GitHub", "Sign in with Google"]);
    expect(html).not.toContain("You are signed in.");
  });

  it("offers the same buttons while the sign-in check is still unknown", () => {
    expect(signInButtons(renderAccount({ auth: "unknown" }))).toEqual([
      "Sign in with GitHub",
      "Sign in with Google",
    ]);
  });

  it("disables both buttons together while one sign-in is starting", () => {
    const html = renderAccount({ busy: true });
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(renderAccount({ busy: false })).not.toContain('disabled=""');
  });
});

// L4-fix (R13, D1): signed in, the step's HEADING says so (accountStepCopy,
// below), so the body no longer repeats "You are signed in." — it shows who.
describe("AccountStepView — signed in", () => {
  it("shows the name, no sign-in button, and does not repeat the heading's sentence", () => {
    const html = renderAccount({ auth: "signed-in", user: fakeUser() });
    expect(html).toContain("Ada Lovelace");
    expect(html).not.toContain("You are signed in.");
    expect(html).not.toContain("Sign in with");
  });

  it("shows the avatar's initial when the provider gave no picture", () => {
    const html = renderAccount({ auth: "signed-in", user: fakeUser() });
    expect(html).toMatch(/<span class="text-caption font-semibold">A<\/span>/);
  });

  it("before the user's name has arrived: no sign-in button, nothing to show yet (the heading already says signed in)", () => {
    const html = renderAccount({ auth: "signed-in", user: null });
    expect(html).toBe("");
  });
});

describe("accountStepCopy — the Account step's heading", () => {
  // R1-fixA item 2 — CHANGED: the signed-in kicker was "Optional".
  // R2-fix item 2 — CHANGED: "settings" became "most settings".
  it("signed in: kicker 'Account', says so, and that the keys stay in this browser", () => {
    expect(accountStepCopy("signed-in")).toEqual({
      kicker: "Account",
      title: "You are signed in.",
      subtitle:
        "Your topics, saved papers and most settings now follow your account. Your API keys stay in this browser.",
    });
  });

  // R2-fix item 2: some settings stay on the device (Deep report, Preferred
  // journals, the AI company choice), so neither subtitle may say they all sync.
  it("says 'most settings' in both subtitles, never 'settings' alone", () => {
    for (const auth of ["signed-in", "signed-out", "unknown"] as const) {
      const { subtitle } = accountStepCopy(auth);
      expect(subtitle).toContain("most settings");
      expect(subtitle).not.toMatch(/(?<!most )settings/);
    }
  });

  it("only a signed-in reader loses the 'Optional' kicker", () => {
    expect(accountStepCopy("signed-in").kicker).not.toBe("Optional");
    expect(accountStepCopy("signed-out").kicker).toBe("Optional");
    expect(accountStepCopy("unknown").kicker).toBe("Optional");
  });

  // R1-fixB item 2 — CHANGED: the title was "Sign in (optional).".
  // R2-fix item 2 — CHANGED: "settings" became "most settings".
  // Round 3 — CHANGED: the subtitle began "Sign in to keep…", repeating the title.
  it("signed out and unknown: kicker 'Optional', title 'Sign in.', and the 'most settings' subtitle", () => {
    const invitation = {
      kicker: "Optional",
      title: "Sign in.",
      subtitle: "Keep your topics, saved papers and most settings on every device, and use your own AI key.",
    };
    expect(accountStepCopy("signed-out")).toEqual(invitation);
    expect(accountStepCopy("unknown")).toEqual(invitation);
  });

  it("the subtitle does not repeat the title: it never starts with 'Sign in'", () => {
    for (const auth of ["signed-out", "unknown", "signed-in"] as const) {
      expect(accountStepCopy(auth).subtitle).not.toMatch(/^sign in/i);
    }
  });

  it("says 'optional' once: in the kicker, never again in the title", () => {
    for (const auth of ["signed-out", "unknown", "signed-in"] as const) {
      expect(accountStepCopy(auth).title).not.toMatch(/optional/i);
    }
  });

  it("never asks a signed-in reader to sign in", () => {
    const copy = accountStepCopy("signed-in");
    expect(`${copy.title} ${copy.subtitle}`).not.toMatch(/sign in/i);
  });
});

describe("SignInToUseKeyView — the AI step's block", () => {
  it("is titled 'Sign in to use your key' and holds the same two buttons", () => {
    const html = renderToStaticMarkup(
      createElement(SignInToUseKeyView, { busy: false, onSignInGitHub: () => {}, onSignInGoogle: () => {} }),
    );
    expect(html).toContain("Sign in to use your key");
    expect(signInButtons(html)).toEqual(["Sign in with GitHub", "Sign in with Google"]);
  });

  it("does not repeat the key fields' own sentence about sign-in (that one lives with the fields)", () => {
    const html = renderToStaticMarkup(
      createElement(SignInToUseKeyView, { busy: false, onSignInGitHub: () => {}, onSignInGoogle: () => {} }),
    );
    expect(html).not.toMatch(/uses your key only while/i);
  });
});

describe("where each sign-in comes back to", () => {
  it("the Account step comes back to itself, and the AI step to the add-a-key address", () => {
    expect(ACCOUNT_STEP_RETURN_TO).toBe("/welcome?step=account");
    expect(AI_STEP_RETURN_TO).toBe(ADD_KEY_HREF);
    expect(AI_STEP_RETURN_TO).toBe("/welcome?step=ai");
  });

  it("both pass the callback's own check, so neither is dropped", () => {
    expect(safeReturnPath(ACCOUNT_STEP_RETURN_TO)).toBe(ACCOUNT_STEP_RETURN_TO);
    expect(safeReturnPath(AI_STEP_RETURN_TO)).toBe(AI_STEP_RETURN_TO);
  });

  it("each wired wrapper hands its own address to both sign-in calls (source)", () => {
    const source = read("src/app/welcome/account-step.tsx");
    expect(source).toContain("void signInWithGitHub(returnTo);");
    expect(source).toContain("void signInWithGoogle(returnTo);");
    const accountStep = source.slice(source.indexOf("export function AccountStep("), source.indexOf("export function SignInToUseKeyView("));
    expect(accountStep).toContain("useSignInReturningTo(ACCOUNT_STEP_RETURN_TO)");
    const keyBlock = source.slice(source.indexOf("export function SignInToUseKey()"));
    expect(keyBlock).toContain("useSignInReturningTo(AI_STEP_RETURN_TO)");
  });

  // R14 — CHANGED: the Profile page's Account section now hands on a checked
  // `return` parameter (a paper's "Sign in" link), and only that; with none it
  // passes undefined, today's sign-in. The decision itself is tested in
  // account-section.test.tsx (signInReturnTo, and the view's props).
  it("the Profile page's Account section passes only the checked ?return= value, never a step of the wizard (source)", () => {
    const source = read("src/components/account/account-section.tsx");
    const wrapper = source.slice(source.indexOf("export function AccountSection("));
    expect(wrapper).toContain('const returnTo = signInReturnTo(searchParams?.get("return"));');
    expect(wrapper).toContain("void signInWithGitHub(to);");
    expect(wrapper).toContain("void signInWithGoogle(to);");
    expect(wrapper).not.toMatch(/ACCOUNT_STEP_RETURN_TO|AI_STEP_RETURN_TO|\/welcome/);
  });
});

describe("welcome page — the Account step and the AI step's block (source)", () => {
  const page = read("src/app/welcome/page.tsx");
  const step = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to));

  // L4-fix (R13, D1) — CHANGED marker: the frame's copy now comes from
  // accountStepCopy(auth) (its own tests above pin every string), so the
  // heading can say "You are signed in." after sign-in.
  it("renders the Account step first, in the wizard's own StepFrame, with the copy for the reader's auth state", () => {
    const account = flat(step('key === "account" && (', 'key === "basics" && ('));
    expect(account).toContain("<StepFrame {...accountStepCopy(auth)}>");
    expect(account).toContain("<AccountStep auth={auth} />");
    expect(page.indexOf('key === "account" && (')).toBeLessThan(page.indexOf('key === "basics" && ('));
  });

  // R1-fixA item 1 — the label is SkipSignInLabel (two spans by breakpoint).
  // R2-fix item 1 — CHANGED: the button no longer carries an aria-label; its
  // words are its name (pinned in the describe below).
  it("labels Next for skipping sign-in on the Account step until the reader is signed in, with no aria-label", () => {
    expect(page).toContain('const skipSignIn = key === "account" && auth !== "signed-in";');
    expect(flat(page)).toContain('{skipSignIn ? <SkipSignInLabel /> : "Continue"}');
    const footer = page.slice(page.indexOf("onClick={next}"), page.indexOf("</footer>"));
    expect(footer).not.toContain("aria-label");
    expect(page).not.toContain("continueButtonName");
  });

  it("puts 'Sign in to use your key' above the key fields, only for a reader it applies to", () => {
    const ai = step('key === "ai" && (', 'key === "persona" && (');
    const block = ai.indexOf("{offersSignIn(auth) && <SignInToUseKey />}");
    expect(block).toBeGreaterThan(-1);
    expect(block).toBeLessThan(ai.indexOf("<AiKeyFields"));
  });

  it("derives the step list, the resume position and deep links from the visible steps", () => {
    expect(page).toContain("const steps = useMemo(() => visibleSteps(auth), [auth]);");
    expect(page).toContain("stepIndexFromKey(requestedStep, steps) ??");
    expect(page).toContain("<StepRail steps={steps}");
    expect(page).not.toContain("STEP_META");
  });

  it("still waits for the profile to settle before choosing a step, so nothing flashes", () => {
    expect(page).toContain("if (settled && autoStart === null) {");
    expect(page).toMatch(/step === null \|\| key === null \?/);
  });
});

// R1-fixA item 1 — at 375 px "Continue without signing in" wrapped and left
// "in" alone on a second line. Below `sm` the button says "Skip sign-in";
// from `sm` up, "Continue without signing in".
// R2-fix item 1 — CHANGED (WCAG 2.5.3, Label in Name): the name used to be an
// aria-label, "Continue without signing in" at every width, so on a phone the
// name did not hold the visible words. Now there is no aria-label and no
// aria-hidden: CSS hides the span that should not show, and `display: none`
// leaves the accessibility tree, so the name at each width is the words on screen.
describe("the Account step's Next button: one line on a phone, and its name is its words", () => {
  /** The button exactly as the wizard builds it. */
  const nextButton = (skipSignIn: boolean) =>
    renderToStaticMarkup(
      createElement(
        "button",
        { type: "button" },
        skipSignIn ? createElement(SkipSignInLabel) : "Continue",
        createElement("span", { "aria-hidden": true }, "→"),
      ),
    );

  /**
   * The accessible name at a width, the way a browser builds it here: no
   * aria-label, so the text, without aria-hidden parts and without the spans
   * Tailwind hides at that width (`hidden` below sm unless `sm:inline`…,
   * `sm:hidden` from sm up).
   */
  const nameAt = (html: string, width: "phone" | "sm") => {
    expect(html).not.toMatch(/aria-label=/);
    const shown = (classes: string) => {
      const tokens = classes.split(/\s+/);
      if (width === "phone") return !tokens.includes("hidden");
      return !tokens.includes("sm:hidden");
    };
    return html
      .replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/gs, "")
      .replace(/<span class="([^"]*)">(.*?)<\/span>/gs, (_m, classes: string, text: string) => (shown(classes) ? text : ""))
      .replace(/<[^>]+>/g, "")
      .trim();
  };

  it("renders 'Skip sign-in' below sm and 'Continue without signing in' from sm up, neither hidden from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(SkipSignInLabel));
    expect(html).toBe(
      '<span class="sm:hidden">Skip sign-in</span>' +
        '<span class="hidden sm:inline">Continue without signing in</span>',
    );
    expect(html).not.toContain("aria-hidden");
    expect(SKIP_SIGN_IN).toBe("Skip sign-in");
    expect(CONTINUE_WITHOUT_SIGNING_IN).toBe("Continue without signing in");
  });

  it("the markup carries no aria-label", () => {
    expect(nextButton(true)).not.toContain("aria-label");
  });

  it("on a phone the name is 'Skip sign-in', the words on screen; from sm up it is 'Continue without signing in'", () => {
    expect(nameAt(nextButton(true), "phone")).toBe("Skip sign-in");
    expect(nameAt(nextButton(true), "sm")).toBe("Continue without signing in");
  });

  it("every other step's Next is unchanged: 'Continue' at every width, no aria-label", () => {
    const html = nextButton(false);
    expect(html).toBe('<button type="button">Continue<span aria-hidden="true">→</span></button>');
    expect(nameAt(html, "phone")).toBe("Continue");
    expect(nameAt(html, "sm")).toBe("Continue");
  });
});
