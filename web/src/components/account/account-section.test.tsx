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
  browserKeyLabels,
  confirmProfileReset,
  hasUnsyncedChanges,
  shouldWarnBeforeSignOut,
  handleSignOutSubmitCore,
  signOutKeysSentence,
  signOutPrompt,
  type AccountSectionViewProps,
  type ConfirmProfileResetDeps,
  type SignOutPrompt,
  type SignOutSubmitDeps,
  type SignOutGuard,
} from "./account-section";
import { defaultProfile, type UserProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { isAccountSwitch, processConfirmedSignOutCookie } from "@/components/profile-sync";

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
    //
    // OWN-KEY lane 4 — slice markers moved again, because the structure did:
    // the two buttons now live in the exported `SignInButtons` (reused by the
    // welcome wizard's Account and AI steps), and the signed-out branch only
    // renders `<SignInButtons busy={busy} … />`. The PROPERTY is unchanged and
    // still pinned in two halves: inside `SignInButtons` both buttons read the
    // one `disabled={busy}` expression, and the Account section hands it its
    // own single `busy` flag, not a second one.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "account", "account-section.tsx"),
      "utf8",
    );
    const buttonsStart = source.indexOf("export function SignInButtons(");
    expect(buttonsStart).toBeGreaterThan(-1);
    const buttonsBody = source.slice(buttonsStart, source.indexOf("export function Avatar(", buttonsStart));
    const disabledExprs = buttonsBody.match(/disabled=\{[^}]*\}/g) ?? [];
    expect(disabledExprs).toEqual(["disabled={busy}", "disabled={busy}"]);

    const signedOutBranch = source.slice(
      source.indexOf('authKind === "signed-out" ? ('),
      source.indexOf(") : user ? ("),
    );
    expect(signedOutBranch).toMatch(/<SignInButtons busy=\{busy\} onSignInGitHub=\{onSignInGitHub\} onSignInGoogle=\{onSignInGoogle\} \/>/);
    expect(signedOutBranch).not.toMatch(/disabled=/);
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
  // OWN-KEY lane 4 — CHANGED marker, because the structure did: the dialog
  // now also names the keys signing out removes, so onWarn carries WHICH
  // dialog to open ("unsynced" | "keys" | "both") and the wrapper keeps that
  // instead of a bare boolean. The property is the same: the wrapper's onWarn
  // opens the confirmation (a no-op onWarn still fails here), and it now also
  // hands the core this browser's key names.
  it("wires onWarn to open the sign-out confirmation with the prompt the core chose (setPendingSignOut(prompt)), and passes the key names", () => {
    expect(body).toMatch(/onWarn:\s*\(prompt\)\s*=>\s*setPendingSignOut\(prompt\)/);
    expect(body).toMatch(/^\s*keyLabels,\s*$/m);
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

  // OWN-KEY lane 4 — CHANGED: the warning moved from an inline `role="alert"`
  // box into a modal `<dialog>` opened with showModal(). A modal is announced
  // as a dialog when it opens (its name and description, then the focused
  // "Stay signed in"); `alertdialog` is the dialog form of `alert`, and an
  // inner `role="alert"` would only read the same words twice. The property
  // pinned is the same: the warning is announced, not just styled.
  it("the warning is announced (a modal alertdialog with a name and a description), not just styled", () => {
    const html = renderAccountView({ confirmingSignOut: true });
    expect(html).toMatch(/<dialog[^>]*role="alertdialog"/);
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="sign-out-title"[^>]*aria-describedby="sign-out-body"/);
    expect(renderAccountView({ confirmingSignOut: false })).not.toMatch(/role="alert/);
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

// OWN-KEY lane 4 — signing out also removes the reader's model and Jev keys
// from this browser (the local profile is reset), so the sign-out dialog now
// says so before it happens. One dialog covers unsynced changes, keys, or
// both; "none" still signs out at once, exactly as before.
describe("signOutPrompt — what signing out would take", () => {
  it.each([
    [false, [], "none"],
    [true, [], "unsynced"],
    [false, ["Gemini"], "keys"],
    [false, ["Jev"], "keys"],
    [true, ["Gemini", "Jev"], "both"],
  ] as const)("unsynced=%s, keys=%j → %s", (unsynced, keyLabels, expected) => {
    expect(signOutPrompt({ unsynced, keyLabels })).toBe(expected);
  });
});

describe("browserKeyLabels — names of the keys this browser holds, never the keys", () => {
  const withKeys = (patch: Partial<UserProfile>): UserProfile => ({ ...defaultProfile, ...patch });

  it("no key → no label", () => {
    expect(browserKeyLabels(defaultProfile)).toEqual([]);
  });

  it("a model key is named by its provider's short name", () => {
    expect(browserKeyLabels(withKeys({ feedAiProvider: "gemini", feedAiApiKey: "user-owned-key" }))).toEqual(["Gemini"]);
    expect(browserKeyLabels(withKeys({ feedAiProvider: "anthropic", feedAiApiKey: "user-owned-key" }))).toEqual(["Claude"]);
  });

  it("a Jev key is named Jev, after the model key", () => {
    expect(browserKeyLabels(withKeys({ jevApiKey: "jev-test-not-a-key-0000" }))).toEqual(["Jev"]);
    expect(
      browserKeyLabels(withKeys({ feedAiProvider: "openai", feedAiApiKey: "k", jevApiKey: "jev-test-not-a-key-0000" })),
    ).toEqual(["OpenAI", "Jev"]);
  });

  it("asks the same questions as the rest of Peer: a provider with a blank key, a key with no provider, or a malformed Jev value is no key", () => {
    expect(browserKeyLabels(withKeys({ feedAiProvider: "gemini", feedAiApiKey: "   " }))).toEqual([]);
    expect(browserKeyLabels(withKeys({ feedAiProvider: "default", feedAiApiKey: "user-owned-key" }))).toEqual([]);
    expect(browserKeyLabels(withKeys({ jevApiKey: "two words" }))).toEqual([]);
    expect(browserKeyLabels(withKeys({ jevApiKey: "" }))).toEqual([]);
  });
});

describe("signOutKeysSentence", () => {
  it("lists one key, or two joined by 'and'", () => {
    expect(signOutKeysSentence(["Gemini"])).toBe("Signing out removes your Gemini key from this browser.");
    expect(signOutKeysSentence(["Jev"])).toBe("Signing out removes your Jev key from this browser.");
    expect(signOutKeysSentence(["Gemini", "Jev"])).toBe(
      "Signing out removes your Gemini key and your Jev key from this browser.",
    );
  });
});

describe("handleSignOutSubmitCore — keys prompt too (OWN-KEY lane 4)", () => {
  function run(overrides: Partial<SignOutSubmitDeps>) {
    const warned: SignOutPrompt[] = [];
    let submitted = 0;
    const deps: SignOutSubmitDeps = {
      requestFlush: async () => true,
      feedPushFailed: false,
      confirmingSignOut: false,
      onWarn: (prompt) => {
        warned.push(prompt);
      },
      onSubmitForm: () => {
        submitted += 1;
      },
      ...overrides,
    };
    return handleSignOutSubmitCore(deps, { current: false }).then(() => ({ warned, submitted }));
  }

  it("nothing unsynced and no key → submits at once, as before", async () => {
    expect(await run({ keyLabels: [] })).toEqual({ warned: [], submitted: 1 });
    expect(await run({})).toEqual({ warned: [], submitted: 1 });
  });

  it("a key, nothing unsynced → the keys dialog, no submit", async () => {
    expect(await run({ keyLabels: ["Gemini"] })).toEqual({ warned: ["keys"], submitted: 0 });
  });

  it("unsynced only → the unsynced dialog, as before", async () => {
    expect(await run({ requestFlush: async () => false })).toEqual({ warned: ["unsynced"], submitted: 0 });
  });

  it("both → one dialog saying both", async () => {
    expect(await run({ feedPushFailed: true, keyLabels: ["Gemini", "Jev"] })).toEqual({
      warned: ["both"],
      submitted: 0,
    });
  });

  it("still flushes first, and still only once on a double submit", async () => {
    let flushes = 0;
    let release: ((v: boolean) => void) | null = null;
    const deps: SignOutSubmitDeps = {
      requestFlush: () => {
        flushes += 1;
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      },
      feedPushFailed: false,
      confirmingSignOut: false,
      keyLabels: ["Jev"],
      onWarn: () => {},
      onSubmitForm: () => {},
    };
    const guard: SignOutGuard = { current: false };
    const first = handleSignOutSubmitCore(deps, guard);
    const second = handleSignOutSubmitCore(deps, guard);
    expect(flushes).toBe(1);
    release!(true);
    await Promise.all([first, second]);
    expect(flushes).toBe(1);
  });
});

describe("AccountSectionView — the sign-out dialog (OWN-KEY lane 4)", () => {
  const KEYS_SENTENCE = "Signing out removes your Gemini key and your Jev key from this browser.";
  const WHY =
    "Peer keeps keys only in this browser, never on its server. If they stayed after you signed out, the next person to use this browser could run requests on your keys, billed to you.";
  const AGAIN = "When you sign in again, here or on another device, paste them again.";
  const UNSYNCED =
    "Some changes on this device haven’t reached your account yet. Signing out removes them from this device.";

  const dialog = (prompt: Exclude<SignOutPrompt, "none">, labels: string[]) =>
    renderAccountView({ confirmingSignOut: true, signOutPrompt: prompt, signOutKeyLabels: labels });

  it("keys: the title, the three sentences, and 'Sign out and remove keys'", () => {
    const html = dialog("keys", ["Gemini", "Jev"]);
    expect(html).toMatch(/<h2 id="sign-out-title"[^>]*>Sign out and remove your keys\?<\/h2>/);
    expect(html).toContain(`<p>${KEYS_SENTENCE}</p>`);
    expect(html).toContain(WHY);
    expect(html).toContain(AGAIN);
    expect(html).not.toContain(UNSYNCED);
    expect(html).toMatch(
      /<form[^>]*action="\/auth\/signout"[^>]*method="POST"[^>]*><button type="submit"[^>]*>Sign out and remove keys<\/button><\/form>/,
    );
    expect(html).toMatch(/<button type="button"[^>]*>Stay signed in<\/button>/);
    expect(html).not.toContain("Sign out anyway");
  });

  it("one key reads 'your Gemini key'", () => {
    const html = dialog("keys", ["Gemini"]);
    expect(html).toContain("<p>Signing out removes your Gemini key from this browser.</p>");
    expect(html).not.toContain(" and your ");
  });

  it("both: the keys sentences and the unsynced sentence, in one dialog with one form", () => {
    const html = dialog("both", ["Gemini", "Jev"]);
    expect(html).toContain("Sign out and remove your keys?");
    expect(html).toContain(KEYS_SENTENCE);
    expect(html).toContain(UNSYNCED);
    expect((html.match(/<dialog/g) ?? []).length).toBe(1);
    expect((html.match(/<form/g) ?? []).length).toBe(1);
    expect(html).toContain(">Sign out and remove keys</button>");
  });

  it("unsynced only: the original sentence and 'Sign out anyway', no word about keys", () => {
    const html = dialog("unsynced", []);
    expect(html).toContain(UNSYNCED);
    expect(html).toContain(">Sign out anyway</button>");
    expect(html).not.toMatch(/\bkeys?\b/i);
  });

  it("puts 'Stay signed in' first, so the modal's first focus is the safe choice", () => {
    const html = dialog("both", ["Gemini", "Jev"]);
    expect(html.indexOf("Stay signed in")).toBeLessThan(html.indexOf("Sign out and remove keys"));
  });

  it("is a native dialog, closed in the markup until showModal() opens it", () => {
    const html = dialog("keys", ["Jev"]);
    expect(html).toMatch(/<dialog[^>]*role="alertdialog"/);
    expect(html).not.toMatch(/<dialog[^>]*\bopen\b/);
  });

  it("never renders any piece of a key: a 40-character model key and Jev key, through browserKeyLabels, leave no 4-character slice in the markup", () => {
    const MODEL_KEY = "Xq7Wz2Rk9Tm4Vb6Np1Ls8Hd3Jf5Gc0Yt7Ue2Ia9O";
    const JEV_KEY = "Pm3Kw8Zr1Qx6Vn4Bt9Hs2Lc7Jd5Ff0Gy3Ua8Ie1W";
    expect(MODEL_KEY).toHaveLength(40);
    expect(JEV_KEY).toHaveLength(40);
    const profile: UserProfile = {
      ...defaultProfile,
      feedAiProvider: "gemini",
      feedAiApiKey: MODEL_KEY,
      jevApiKey: JEV_KEY,
    };
    const labels = browserKeyLabels(profile);
    expect(labels).toEqual(["Gemini", "Jev"]);
    for (const prompt of ["keys", "both"] as const) {
      const html = dialog(prompt, labels);
      for (const key of [MODEL_KEY, JEV_KEY]) {
        for (let i = 0; i + 4 <= key.length; i++) {
          expect(html).not.toContain(key.slice(i, i + 4));
        }
      }
    }
  });
});

describe("SignOutDialog wiring (source) — Esc stays, focus starts on Stay signed in, a real POST", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "components", "account", "account-section.tsx"),
    "utf8",
  );
  const dialogSource = source.slice(
    source.indexOf("export function SignOutDialog("),
    source.indexOf("export function AccountSection("),
  );

  it("opens with showModal() and focuses Stay signed in", () => {
    expect(dialogSource).toContain("dialog.showModal();");
    expect(dialogSource).toContain("stayRef.current?.focus();");
    expect(dialogSource).toMatch(/ref=\{stayRef\}[\s\S]*?onClick=\{onStaySignedIn\}[\s\S]*?Stay signed in/);
  });

  it("Esc (the dialog's cancel) means stay signed in", () => {
    expect(dialogSource).toMatch(/onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*onStaySignedIn\(\);/);
  });

  it("confirms with the plain form POST, no fetch", () => {
    expect(dialogSource).toContain('<form method="POST" action="/auth/signout">');
    expect(dialogSource).not.toMatch(/fetch\(/);
  });

  it("the wrapper reads key names from the profile store through browserKeyLabels, nothing else of the keys", () => {
    const wrapper = source.slice(source.indexOf("export function AccountSection("));
    expect(wrapper).toContain("useMemo(() => browserKeyLabels(profile), [profile])");
    expect(wrapper).not.toMatch(/feedAiApiKey|jevApiKey/);
  });
});

// OWN-KEY lane 4 (R13, D4) — the sign-out dialog promises the keys go. A
// "Reset profile to defaults" while signed in used to null the recorded owner,
// so a later sign-out skipped the clear and the key stayed (and the next
// account inherited it). Two fixes, each enough on its own: the reset records
// the signed-in account again (confirmProfileReset), and a confirmed sign-out
// always clears the keys (clearDeviceKeys, in processConfirmedSignOutCookie).
describe("confirmProfileReset — signed in ⇒ owner recorded (R13, D4)", () => {
  function run(overrides: Partial<ConfirmProfileResetDeps>) {
    const calls: string[] = [];
    confirmProfileReset({
      logOut: () => calls.push("logOut"),
      setSyncedAccountId: (id) => calls.push(`owner:${id}`),
      authOutcome: "signed-in",
      authUserId: "user-a",
      ...overrides,
    });
    return calls;
  }

  it("signed in: resets, then records the same account again", () => {
    expect(run({})).toEqual(["logOut", "owner:user-a"]);
  });

  it("not signed in, or no id yet: resets and records nobody", () => {
    expect(run({ authOutcome: "signed-out", authUserId: null })).toEqual(["logOut"]);
    expect(run({ authOutcome: "unknown", authUserId: null })).toEqual(["logOut"]);
    expect(run({ authOutcome: "unconfigured", authUserId: null })).toEqual(["logOut"]);
    expect(run({ authOutcome: "signed-in", authUserId: null })).toEqual(["logOut"]);
  });
});

describe("the reviewer's sequence: reset while signed in → paste a key → sign out → the key is gone (R13, D4)", () => {
  const MODEL = "seq-model-key-sentinel-not-a-key-0000000";
  const JEV = "seq-jev-key-sentinel-not-a-key-000000000";

  function pasteKeys() {
    const store = useProfileStore.getState();
    store.updateFeedAiProvider("gemini");
    store.updateFeedAiApiKey(MODEL);
    store.updateJevApiKey(JEV);
    expect(browserKeyLabels(useProfileStore.getState().profile)).toEqual(["Gemini", "Jev"]);
  }

  function signOutAndReload(clearDeviceKeys: () => void) {
    // POST /auth/signout set the cookie; the next load confirms "signed-out".
    processConfirmedSignOutCookie({
      cookiePresent: true,
      authOutcome: "signed-out",
      syncedAccountId: useProfileStore.getState().syncedAccountId,
      logOut: () => useProfileStore.getState().logOut(),
      clearDeviceKeys,
      deleteCookie: () => {},
    });
  }

  function expectNoKey() {
    const { profile } = useProfileStore.getState();
    expect(browserKeyLabels(profile)).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain(MODEL);
    expect(JSON.stringify(profile)).not.toContain(JEV);
  }

  function signedInAsA() {
    useProfileStore.setState({ profile: { ...defaultProfile }, lastSynced: null, syncedAccountId: "user-a" });
  }

  it("with both fixes: the key is gone, and a second account signing in inherits nothing", () => {
    signedInAsA();
    confirmProfileReset({
      logOut: () => useProfileStore.getState().logOut(),
      setSyncedAccountId: useProfileStore.getState().setSyncedAccountId,
      authOutcome: "signed-in",
      authUserId: "user-a",
    });
    expect(useProfileStore.getState().syncedAccountId).toBe("user-a");
    pasteKeys();
    signOutAndReload(() => useProfileStore.getState().clearDeviceKeys());
    expectNoKey();
    // Account B signs in on this browser next (onSession's own step: wipe on
    // a switch): whatever the switch check says, no key is left for B.
    if (isAccountSwitch(useProfileStore.getState().syncedAccountId, "user-b")) {
      useProfileStore.getState().logOut();
    }
    expectNoKey();
  });

  it("the reset fix alone is enough: the owner is recorded, so the full clear runs", () => {
    signedInAsA();
    confirmProfileReset({
      logOut: () => useProfileStore.getState().logOut(),
      setSyncedAccountId: useProfileStore.getState().setSyncedAccountId,
      authOutcome: "signed-in",
      authUserId: "user-a",
    });
    pasteKeys();
    signOutAndReload(() => {}); // as if the key clear were missing
    expectNoKey();
  });

  it("the sign-out fix alone is enough: the old reset (owner nulled) still ends with no key", () => {
    signedInAsA();
    useProfileStore.getState().logOut(); // the reset as it was: the owner is forgotten
    expect(useProfileStore.getState().syncedAccountId).toBeNull();
    pasteKeys();
    signOutAndReload(() => useProfileStore.getState().clearDeviceKeys());
    expectNoKey();
    // and B is not seen as a switch (no owner), which is exactly why the key
    // clear must not wait for one.
    expect(isAccountSwitch(useProfileStore.getState().syncedAccountId, "user-b")).toBe(false);
    expectNoKey();
  });
});
