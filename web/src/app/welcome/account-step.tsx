"use client";

// The welcome wizard's sign-in pieces: the body of the Account step, and the
// small "Sign in to use your key" block on the AI step. Both reuse the Account
// section's own two buttons (`SignInButtons`), and both come back to the step
// they were pressed on after sign-in (`returnTo`, carried across the
// provider's pages by a short-lived cookie — see lib/navigation/return-path.ts).
//
// Split like account-section.tsx: the `…View` components take every value as
// a prop and render with plain `renderToStaticMarkup` in tests; the thin
// wrappers below them hold the hooks.

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { AuthOutcome } from "@/components/profile-sync";
import { Avatar, SignInButtons } from "@/components/account/account-section";
import {
  signInWithGitHub,
  signInWithGoogle,
  useAuthUser,
  userName,
} from "@/components/account/use-auth-user";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";

/** Where a sign-in started on the Account step comes back to. */
export const ACCOUNT_STEP_RETURN_TO = "/welcome?step=account";
/** Where a sign-in started on the AI step comes back to: the AI step itself,
 *  the same address every "add a key" link uses. */
export const AI_STEP_RETURN_TO = ADD_KEY_HREF;

export interface SignInHandlers {
  busy: boolean;
  onSignInGitHub: () => void;
  onSignInGoogle: () => void;
}

/** One busy flag for both buttons, and each press comes back to `returnTo`. */
function useSignInReturningTo(returnTo: string): SignInHandlers {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    onSignInGitHub: () => {
      setBusy(true);
      void signInWithGitHub(returnTo);
    },
    onSignInGoogle: () => {
      setBusy(true);
      void signInWithGoogle(returnTo);
    },
  };
}

export interface AccountStepViewProps extends SignInHandlers {
  auth: AuthOutcome;
  /** The signed-in user, once known; the name and avatar wait for it. */
  user: User | null;
}

export interface AccountStepCopy {
  kicker: string;
  title: string;
  subtitle: string;
}

/**
 * The Account step's heading. Signed in — typically right after OAuth brings
 * the reader back to this step — it says so instead of asking them to sign in
 * again (L4-fix, R13 D1), and that the keys are the one thing that does not
 * follow the account. Its kicker is then "Account" (R1-fixA item 2): "Optional"
 * above "You are signed in." read as if being signed in were optional. Signed
 * out or not yet known, the invitation: kicker "Optional", title "Sign in."
 * (R1-fixB item 2: the title was "Sign in (optional).", so "optional" was said
 * twice, once by the kicker right above it).
 */
export function accountStepCopy(auth: AuthOutcome): AccountStepCopy {
  if (auth === "signed-in") {
    return {
      kicker: "Account",
      title: "You are signed in.",
      subtitle:
        "Your topics, saved papers and settings now follow your account. Your API keys stay in this browser.",
    };
  }
  return {
    kicker: "Optional",
    title: "Sign in.",
    subtitle:
      "Sign in to keep your topics, saved papers and settings on every device, and to use your own AI key.",
  };
}

/** The wizard's Next button on the Account step, until the reader signs in:
 *  its words below the `sm` breakpoint, and from `sm` up. */
export const SKIP_SIGN_IN = "Skip sign-in";
export const CONTINUE_WITHOUT_SIGNING_IN = "Continue without signing in";

/**
 * The words on that button (R1-fixA item 1). At 375 px the full label wrapped
 * and left "in" alone on a second line, so below the `sm` breakpoint the
 * button says "Skip sign-in"; from `sm` up it says "Continue without signing
 * in".
 *
 * R2-fix item 1 (WCAG 2.5.3, Label in Name): the words on screen ARE the
 * button's name. No `aria-label` and no `aria-hidden`: CSS hides the span that
 * should not show (`display: none` takes it out of the accessibility tree), so
 * a voice-control user who says "Skip sign-in" on a phone reaches the button.
 */
export function SkipSignInLabel() {
  return (
    <>
      <span className="sm:hidden">{SKIP_SIGN_IN}</span>
      <span className="hidden sm:inline">{CONTINUE_WITHOUT_SIGNING_IN}</span>
    </>
  );
}

/** The Account step's body: who is signed in (the heading already says that
 *  they are), or the two sign-in buttons. */
export function AccountStepView({ auth, user, ...handlers }: AccountStepViewProps) {
  if (auth === "signed-in") {
    if (!user) return null;
    return (
      <div className="flex items-center gap-3">
        <Avatar user={user} size={40} />
        <p className="min-w-0 text-body-sm text-heading font-medium truncate">{userName(user)}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <SignInButtons {...handlers} />
    </div>
  );
}

export function AccountStep({ auth }: { auth: AuthOutcome }) {
  const authUser = useAuthUser();
  const handlers = useSignInReturningTo(ACCOUNT_STEP_RETURN_TO);
  return (
    <AccountStepView
      auth={auth}
      user={authUser.kind === "signed-in" ? authUser.user : null}
      {...handlers}
    />
  );
}

/** The AI step's sign-in block, shown above the key fields to a reader who is
 *  not signed in: a key does nothing until they are. */
export function SignInToUseKeyView(handlers: SignInHandlers) {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-well">
      <p className="text-body-sm font-medium text-heading">Sign in to use your key</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <SignInButtons {...handlers} />
      </div>
    </div>
  );
}

export function SignInToUseKey() {
  const handlers = useSignInReturningTo(AI_STEP_RETURN_TO);
  return <SignInToUseKeyView {...handlers} />;
}
