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
  SignInToUseKeyView,
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
  it("signed in: says so, and that the keys stay in this browser", () => {
    expect(accountStepCopy("signed-in")).toEqual({
      kicker: "Optional",
      title: "You are signed in.",
      subtitle:
        "Your topics, saved papers and settings now follow your account. Your API keys stay in this browser.",
    });
  });

  it("signed out and unknown: the invitation, unchanged", () => {
    const invitation = {
      kicker: "Optional",
      title: "Sign in (optional).",
      subtitle:
        "Sign in to keep your topics, saved papers and settings on every device, and to use your own AI key.",
    };
    expect(accountStepCopy("signed-out")).toEqual(invitation);
    expect(accountStepCopy("unknown")).toEqual(invitation);
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

  it("labels Next 'Continue without signing in' on the Account step until the reader is signed in", () => {
    expect(flat(page)).toContain(
      '{key === "account" && auth !== "signed-in" ? "Continue without signing in" : "Continue"}',
    );
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
