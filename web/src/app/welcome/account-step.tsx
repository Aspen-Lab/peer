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

/** The Account step's body: who is signed in, or the two sign-in buttons. */
export function AccountStepView({ auth, user, ...handlers }: AccountStepViewProps) {
  if (auth === "signed-in") {
    return (
      <div className="flex items-center gap-3">
        {user && <Avatar user={user} size={40} />}
        <div className="min-w-0">
          {user && (
            <p className="text-body-sm text-heading font-medium truncate">{userName(user)}</p>
          )}
          <p className="text-meta text-text-muted">You are signed in.</p>
        </div>
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
