// GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad, rulings §1ai) — this file had
// zero coverage before this item (guide docs/jev-abc/GOOGLE-SIGNIN-B-…md §1).
//
// This repo has no @testing-library/react and no test anywhere simulates a
// click (matching src/app/profile/page.test.tsx's own header note and
// figure-lightbox.test.ts) — presentational-component tests render with
// renderToStaticMarkup and assert on the output HTML. `next/link` is already
// proven safe under renderToStaticMarkup with no router context in this repo
// (src/app/profile/page.test.tsx renders DataSourcesLink, which is a bare
// `<Link>`), so AccountSection's own "What Peer keeps" link needs no special
// handling here either.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { AuthState } from "./use-auth-user";

const mocks = vi.hoisted(() => ({
  authState: { kind: "signed-out" } as AuthState,
}));

vi.mock("./use-auth-user", () => ({
  useAuthUser: () => mocks.authState,
  // Real fallback-chain logic is use-auth-user.test.ts's own subject; this
  // file only needs a stand-in that reads the fields AccountSection actually
  // passes through, so a render-only test doesn't depend on that logic too.
  userName: (user: { email?: string }) => user.email?.split("@")[0] ?? "You",
  userAvatar: () => null,
  signInWithGitHub: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

import {
  AccountSection,
  AccountSectionView,
  hasUnsyncedChanges,
  shouldWarnBeforeSignOut,
  type AccountSectionViewProps,
} from "./account-section";

function render(state: AuthState): string {
  mocks.authState = state;
  return renderToStaticMarkup(createElement(AccountSection));
}

function fakeUser(email: string): User {
  return { id: "user-1", email, user_metadata: {} } as unknown as User;
}

describe("AccountSection — unconfigured / loading (pre-existing self-hosted guard)", () => {
  it("renders nothing when Supabase is not configured", () => {
    expect(render({ kind: "unconfigured" })).toBe("");
  });

  it("renders nothing while the first auth check is still in flight", () => {
    expect(render({ kind: "loading" })).toBe("");
  });
});

describe("AccountSection — signed-out", () => {
  it("shows both sign-in buttons, GitHub before Google in document order", () => {
    const html = render({ kind: "signed-out" });

    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("Sign in with Google");
    expect(html.indexOf("Sign in with GitHub")).toBeLessThan(
      html.indexOf("Sign in with Google"),
    );
  });

  it("updates the signed-out sentence to name both providers", () => {
    const html = render({ kind: "signed-out" });

    expect(html).toMatch(
      /Sign in with GitHub or Google to sync saves and reads across your devices\./,
    );
  });

  it("gives both buttons a real, native accessible name via visible text (no icon-only control)", () => {
    const html = render({ kind: "signed-out" });

    // Each button is `<button type="button">…<svg aria-hidden/>Sign in with X</button>`
    // — matching the existing GitHub button's own pattern exactly (guide §5.2).
    const buttonMatches = [...html.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/gs)];
    expect(buttonMatches.length).toBe(2);
    for (const match of buttonMatches) {
      expect(match[1]).toMatch(/Sign in with (GitHub|Google)/);
    }
    // Both icons are decorative and must not add a second accessible name.
    expect((html.match(/aria-hidden/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("neither button carries a real disabled attribute at rest (busy=false initially)", () => {
    // React's static markup renders a true boolean attribute as `disabled=""`
    // and omits it entirely when false — asserted as the exact attribute, not
    // a bare substring match, because Tailwind's own `disabled:opacity-55`
    // variant classes contain the literal word "disabled" too.
    const html = render({ kind: "signed-out" });
    expect(html).not.toContain('disabled=""');
  });

  it("both sign-in buttons read the SAME `disabled={busy}` expression, not two independent flags", () => {
    // A static render can't click, so it can't observe busy flip to true —
    // this locks down the disabled-attribute SOURCE instead, the same
    // read-your-own-source technique src/components/plan/pro-plan-summary.test.tsx
    // already uses for a claim rendered output alone can't prove. A fast
    // double-click firing two concurrent OAuth redirects (guide §5.2) is
    // exactly what two independently-tracked flags would allow.
    //
    // POLISH-1-SYNC (ABC-JEV-INTEGRATION.md §1al (c)) — the slice markers
    // below were rewritten for the presentational-view split: the ternary
    // now reads on a flat `authKind` prop (was `auth.kind`, read straight
    // off the hook inside one combined component) and its signed-out branch
    // is now followed by a second `user ? (` branch rather than a bare
    // `: (` — the PROPERTY under test (one shared `disabled={busy}`
    // expression) is unchanged, only the source text it's sliced from.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "account", "account-section.tsx"),
      "utf8",
    );
    const signedOutBranch = source.slice(
      source.indexOf('authKind === "signed-out" ? ('),
      source.indexOf(") : user ? ("),
    );
    const disabledExprs = signedOutBranch.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabledExprs).toEqual(["disabled={busy}", "disabled={busy}"]);
  });
});

describe("shouldWarnBeforeSignOut / hasUnsyncedChanges — the P6 decision, pulled out pure (§1al (c))", () => {
  it("warns when there are unsynced changes and no warning is showing yet", () => {
    expect(shouldWarnBeforeSignOut(true, false)).toBe(true);
  });

  it("does not re-arm once the warning is already showing (a second click is 'Sign out anyway', not another warning)", () => {
    expect(shouldWarnBeforeSignOut(true, true)).toBe(false);
  });

  it("never warns when nothing is unsynced", () => {
    expect(shouldWarnBeforeSignOut(false, false)).toBe(false);
    expect(shouldWarnBeforeSignOut(false, true)).toBe(false);
  });

  it("hasUnsyncedChanges is true when EITHER the profile push or the feed push has failed", () => {
    expect(hasUnsyncedChanges(false, false)).toBe(false);
    expect(hasUnsyncedChanges(true, false)).toBe(true);
    expect(hasUnsyncedChanges(false, true)).toBe(true);
    expect(hasUnsyncedChanges(true, true)).toBe(true);
  });
});

// P6 (ABC-JEV-INTEGRATION.md §1aj, ruled at §1al (c)): pressing "Sign out"
// while something hasn't reached the account yet must warn first, inside
// the Account section, instead of silently wiping this device's only copy
// (feed-sync.tsx's resetLocal() on SIGNED_OUT). This repo has no
// @testing-library/react and no test simulates a click (see this file's own
// header note above), so `AccountSectionView` — the presentational half of
// the §1al (c) split, same pattern as `EmailSettingsView` in
// web/src/app/profile/page.tsx — is rendered directly with
// `confirmingSignOut` set by hand, covering both branches the wrapper's
// click handler can switch between.
function renderAccountView(overrides: Partial<AccountSectionViewProps> = {}): string {
  const props: AccountSectionViewProps = {
    authKind: "signed-in",
    user: fakeUser("person@example.test"),
    busy: false,
    confirmingSignOut: false,
    onSignInGitHub: () => {},
    onSignInGoogle: () => {},
    onSignOutSubmit: () => {},
    onStaySignedIn: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AccountSectionView, props));
}

describe("AccountSectionView — P6 sign-out warning, both branches by props (§1al (c))", () => {
  it("nothing unsynced (confirmingSignOut=false): Sign out works exactly as today — one plain form, no warning text", () => {
    const html = renderAccountView({ confirmingSignOut: false });

    expect(html).not.toContain("haven’t reached your account yet");
    expect(html).not.toContain("Stay signed in");
    expect(html).not.toContain("Sign out anyway");
    expect((html.match(/<form/g) ?? []).length).toBe(1);
    expect(html).toMatch(
      /<form[^>]*action="\/auth\/signout"[^>]*method="POST"[^>]*><button type="submit"[^>]*>Sign out<\/button><\/form>/,
    );
  });

  it("a pending warning (confirmingSignOut=true): shows the exact sentence and both buttons instead of the plain Sign out control", () => {
    const html = renderAccountView({ confirmingSignOut: true });

    expect(html).toContain(
      "Some changes on this device haven’t reached your account yet. Signing out removes them from this device.",
    );
    // Still exactly one form — "Sign out anyway" posts to the real
    // endpoint, today's exact mechanism, just reached one click later;
    // "Stay signed in" is a plain button, not a second form.
    expect((html.match(/<form/g) ?? []).length).toBe(1);
    expect(html).toMatch(
      /<form[^>]*action="\/auth\/signout"[^>]*method="POST"[^>]*><button type="submit"[^>]*>Sign out anyway<\/button><\/form>/,
    );
    expect(html).toMatch(/<button type="button"[^>]*>Stay signed in<\/button>/);
  });

  it("the warning is announced (role=alert), not just styled", () => {
    const html = renderAccountView({ confirmingSignOut: true });
    expect(html).toMatch(/role="alert"/);
    expect(renderAccountView({ confirmingSignOut: false })).not.toMatch(/role="alert"/);
  });
});

describe("AccountSection — signed-in (additive only — unchanged by adding Google)", () => {
  it("still renders exactly one avatar, one email line, and one sign-out form", () => {
    const html = render({ kind: "signed-in", user: fakeUser("person@example.test") });

    expect(html).not.toContain("Sign in with GitHub");
    expect(html).not.toContain("Sign in with Google");
    expect(html).toContain("person@example.test");
    expect((html.match(/<form/g) ?? []).length).toBe(1);
    expect(html).toContain("Sign out");
  });
});
