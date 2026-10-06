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
  handleSignOutSubmitCore,
  type AccountSectionViewProps,
  type SignOutSubmitDeps,
  type SignOutGuard,
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
    // read-your-own-source technique used for any claim rendered output alone
    // can't prove. A fast
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

// ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt point 3, widened by §1bt.8
// AMENDMENT (c)) — the interesting decision sequence (flush, decide,
// warn-or-submit, and now the double-submit guard) was pulled out of the
// component wrapper into the exported, DI-only `handleSignOutSubmitCore`
// (below), so it is proven directly with fakes — same convention as
// profile-sync.tsx's `flushBeforeSignOut`/`pullMergeAndPush` — rather than
// only by source text. `handleSignOutSubmit` itself (inside
// `AccountSection`, the hook-wired wrapper) keeps only the thin,
// React-specific glue (preventDefault, busy, building the deps, passing
// the ref) and is still checked by source text, this file's own
// established technique for effectful wrapper code with no DOM harness.
// CHANGED ASSERTIONS below (comment "ACCOUNT-SWITCH (§1bt.8)"): the old
// direct checks for "awaits requestProfileFlush()" and "submits only after
// the flush" inside `handleSignOutSubmit`'s own body no longer apply —
// that sequence now lives in `handleSignOutSubmitCore`, proven by the
// behavioural tests in the next describe block instead; the SAME
// properties (flush before decide, submit only after) are still proven,
// just at the more precise location and with real function calls instead
// of a regex.
describe("AccountSection's handleSignOutSubmit wrapper wiring (§1bt point 3, §1bt.8 AMENDMENT (c)) — source-text check", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "account", "account-section.tsx"),
    "utf8",
  );
  const start = source.indexOf("async function handleSignOutSubmit(event: FormEvent<HTMLFormElement>) {");
  const end = source.indexOf("  return (", start);

  it("markers exist and are in the right order", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.indexOf("export async function handleSignOutSubmitCore(")).toBeGreaterThan(-1);
  });

  const body = source.slice(start, end);

  it("always calls preventDefault() first, before delegating to the guarded core — the plain POST is intercepted unconditionally, not only when already known to be unsynced", () => {
    const preventDefaultIdx = body.indexOf("event.preventDefault()");
    const coreCallIdx = body.indexOf("handleSignOutSubmitCore(");
    expect(preventDefaultIdx).toBeGreaterThan(-1);
    expect(coreCallIdx).toBeGreaterThan(preventDefaultIdx);
  });

  // (ACCOUNT-SWITCH §1bt.8) CHANGED — was "awaits requestProfileFlush()
  // before deciding whether to warn or submit", checking handleSignOutSubmit's
  // own body directly; that sequencing now lives in handleSignOutSubmitCore
  // (proven by real calls in the next describe block). This checks the
  // WRAPPER's own new responsibility instead: it builds requestFlush from
  // the real requestProfileFlush and hands it to the core unchanged.
  it("wires requestFlush to the real requestProfileFlush (not a reimplementation) when calling the core", () => {
    expect(body).toMatch(/requestFlush:\s*requestProfileFlush/);
  });

  // (ACCOUNT-SWITCH §1bt.8) CHANGED — was "submits the real form only AFTER
  // the flush decision", checking a literal form.submit() call site inside
  // handleSignOutSubmit's own body; form.submit() is now inside the
  // onSubmitForm CALLBACK passed to the core, so the ordering guarantee
  // itself is now handleSignOutSubmitCore's own (proven directly below) —
  // this checks the wrapper correctly builds that callback and passes the
  // real guard, not a fresh one created per call (which would defeat the
  // guard across renders).
  it("passes a form.submit()-calling onSubmitForm callback, and the STABLE signOutGuardRef (not a fresh object), to the core", () => {
    expect(body).toMatch(/onSubmitForm:\s*\(\)\s*=>\s*form\.submit\(\)/);
    expect(body).toMatch(/handleSignOutSubmitCore\(\s*\{[\s\S]*?\},\s*signOutGuardRef,?\s*\)/);
  });

  // ACCOUNT-SWITCH (§1bt.8) — added by the manager after the re-check's LOW
  // finding: the round-2 refactor proved the core calls onWarn, but nothing
  // pinned that the WRAPPER's onWarn actually opens the "Stay signed in" /
  // "Sign out anyway" confirmation (a no-op onWarn passed the whole suite).
  it("wires onWarn to open the existing sign-out confirmation (setConfirmingSignOut(true))", () => {
    expect(body).toMatch(/onWarn:\s*\(\)\s*=>\s*setConfirmingSignOut\(true\)/);
  });

  it("(ACCOUNT-SWITCH §1bt.8) sets busy(true) before delegating to the core, and busy(false) in a finally — the VISIBLE half of the double-submit guard, so a stuck flush never leaves the button disabled forever", () => {
    const busyTrueIdx = body.indexOf("setBusy(true)");
    const coreCallIdx = body.indexOf("handleSignOutSubmitCore(");
    const finallyIdx = body.indexOf("finally");
    const busyFalseIdx = body.indexOf("setBusy(false)");
    expect(busyTrueIdx).toBeGreaterThan(-1);
    expect(coreCallIdx).toBeGreaterThan(busyTrueIdx);
    expect(finallyIdx).toBeGreaterThan(coreCallIdx);
    expect(busyFalseIdx).toBeGreaterThan(finallyIdx);
  });
});

// ACCOUNT-SWITCH (§1bt point 3, §1bt.8 AMENDMENT (c)) — the actual
// flush-then-decide sequence AND the double-submit guard, proven directly
// with fakes (no DOM, no click simulator — a plain async function call).
describe("handleSignOutSubmitCore — flush, decide, and the double-submit guard (§1bt point 3, §1bt.8 AMENDMENT (c))", () => {
  function fakeDeps(overrides: Partial<SignOutSubmitDeps> = {}) {
    let warnCalls = 0;
    let submitCalls = 0;
    const deps: SignOutSubmitDeps = {
      requestFlush: async () => true,
      feedPushFailed: false,
      confirmingSignOut: false,
      onWarn: () => {
        warnCalls += 1;
      },
      onSubmitForm: () => {
        submitCalls += 1;
      },
      ...overrides,
    };
    return { deps, warnCalls: () => warnCalls, submitCalls: () => submitCalls };
  }

  it("nothing unsynced (flush resolves true, feed not failed) → submits immediately, never warns", async () => {
    const { deps, warnCalls, submitCalls } = fakeDeps();
    await handleSignOutSubmitCore(deps, { current: false });
    expect(submitCalls()).toBe(1);
    expect(warnCalls()).toBe(0);
  });

  it("the profile flush fails (resolves false) → warns, does not submit", async () => {
    const { deps, warnCalls, submitCalls } = fakeDeps({ requestFlush: async () => false });
    await handleSignOutSubmitCore(deps, { current: false });
    expect(warnCalls()).toBe(1);
    expect(submitCalls()).toBe(0);
  });

  it("the feed push already failed, independent of the profile flush → warns too", async () => {
    const { deps, warnCalls, submitCalls } = fakeDeps({ feedPushFailed: true });
    await handleSignOutSubmitCore(deps, { current: false });
    expect(warnCalls()).toBe(1);
    expect(submitCalls()).toBe(0);
  });

  // The exact property the round-1 source-text tests used to pin
  // ("submits only after the flush decision"), now proven by a REAL call
  // instead of a regex: requestFlush is awaited to completion before
  // either onWarn or onSubmitForm ever runs.
  it("requestFlush is awaited to completion before either onWarn or onSubmitForm runs", async () => {
    const callOrder: string[] = [];
    const deps: SignOutSubmitDeps = {
      requestFlush: async () => {
        callOrder.push("flush");
        return true;
      },
      feedPushFailed: false,
      confirmingSignOut: false,
      onWarn: () => callOrder.push("warn"),
      onSubmitForm: () => callOrder.push("submit"),
    };
    await handleSignOutSubmitCore(deps, { current: false });
    expect(callOrder).toEqual(["flush", "submit"]);
  });

  // §1bt.8 AMENDMENT (c)'s own required test. MUTATION GUARD (drop the
  // busy/guard check): removing the `if (guard.current) return;` line
  // would let the second call also reach requestFlush, making
  // flushCalls() 2 instead of 1 — this test goes red.
  it("a double submit during the flush → one flush, one POST", async () => {
    let flushCalls = 0;
    let submitCalls = 0;
    let resolveFlush: ((v: boolean) => void) | null = null;
    const deps: SignOutSubmitDeps = {
      requestFlush: () => {
        flushCalls += 1;
        return new Promise<boolean>((resolve) => {
          resolveFlush = resolve;
        });
      },
      feedPushFailed: false,
      confirmingSignOut: false,
      onWarn: () => {},
      onSubmitForm: () => {
        submitCalls += 1;
      },
    };
    const guard: SignOutGuard = { current: false };
    const first = handleSignOutSubmitCore(deps, guard);
    // Arrives while the first call is still awaiting requestFlush.
    const second = handleSignOutSubmitCore(deps, guard);
    expect(flushCalls).toBe(1); // the second call never even reaches requestFlush
    resolveFlush!(true);
    await Promise.all([first, second]);
    expect(flushCalls).toBe(1);
    expect(submitCalls).toBe(1);
  });

  it("the guard resets once an attempt completes, so a LATER, separate click is its own independent attempt (never permanently blocked)", async () => {
    let flushCalls = 0;
    const guard: SignOutGuard = { current: false };
    const deps: SignOutSubmitDeps = {
      requestFlush: async () => {
        flushCalls += 1;
        return true;
      },
      feedPushFailed: false,
      confirmingSignOut: false,
      onWarn: () => {},
      onSubmitForm: () => {},
    };
    await handleSignOutSubmitCore(deps, guard);
    await handleSignOutSubmitCore(deps, guard);
    expect(flushCalls).toBe(2);
    expect(guard.current).toBe(false);
  });
});

describe("the Sign out button is visually disabled while busy (§1bt.8 AMENDMENT (c) — the visible half of the double-submit guard)", () => {
  it("busy=true adds a real disabled attribute to the Sign out button", () => {
    const html = renderAccountView({ busy: true, confirmingSignOut: false });
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Sign out<\/button>/);
  });

  it("busy=false (the default/at-rest state) carries no disabled attribute", () => {
    const html = renderAccountView({ busy: false, confirmingSignOut: false });
    expect(html).not.toContain('disabled=""');
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
