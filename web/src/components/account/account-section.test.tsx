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

import { AccountSection } from "./account-section";

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
    const source = readFileSync(
      join(process.cwd(), "src", "components", "account", "account-section.tsx"),
      "utf8",
    );
    const signedOutBranch = source.slice(
      source.indexOf('auth.kind === "signed-out" ? ('),
      source.indexOf(") : ("),
    );
    const disabledExprs = signedOutBranch.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabledExprs).toEqual(["disabled={busy}", "disabled={busy}"]);
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
