"use client";

// Who is signed in, for the masthead's Profile word and the /profile Account
// section. The state used to live inside the floating sign-in pill and
// nowhere else.
//
// Three honest answers plus a fourth for the first paint: `unconfigured`
// (no Supabase at all — the self-hosted path, and every server render, since
// the client singleton is null there), `loading` (the client has Supabase
// but has not asked it yet), then `signed-out` or `signed-in`. The first
// client render is `loading` and renders the same as `unconfigured` wherever
// this is used, so the server markup and the hydrating client agree.

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import {
  AFTER_SIGN_IN_COOKIE_MAX_AGE_SECONDS,
  AFTER_SIGN_IN_COOKIE_NAME,
  safeReturnPath,
} from "@/lib/navigation/return-path";

export type AuthState =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; user: User };

export function useAuthUser(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!supabase) return { kind: "unconfigured" };
  if (loading) return { kind: "loading" };
  return user ? { kind: "signed-in", user } : { kind: "signed-out" };
}

export function userName(user: User): string {
  return (
    (user.user_metadata?.name as string | undefined) ||
    (user.user_metadata?.user_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "You"
  );
}

export function userAvatar(user: User): string | null {
  return (user.user_metadata?.avatar_url as string | undefined) ?? null;
}

/**
 * Where the callback should send the browser after this sign-in.
 *
 * With a `returnTo` (the welcome wizard passes its own step), a short-lived
 * first-party cookie carries it across the provider's pages; the callback
 * checks it with `safeReturnPath`, follows it and deletes it. It holds a path
 * and nothing secret, so it is readable by the page (not HttpOnly). A value
 * that fails the same check is never written.
 *
 * Without one, a cookie left behind by an earlier, abandoned sign-in (the
 * reader started from the wizard and turned back at the provider) is cleared,
 * so this sign-in lands on `/` exactly as it always has.
 */
function rememberReturnPath(returnTo: string | undefined): void {
  if (typeof document === "undefined") return;
  const path = safeReturnPath(returnTo);
  document.cookie = path
    ? `${AFTER_SIGN_IN_COOKIE_NAME}=${encodeURIComponent(path)}; Max-Age=${AFTER_SIGN_IN_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    : `${AFTER_SIGN_IN_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** GitHub OAuth; the browser leaves for the callback, so nothing to unset.
 *  `returnTo`: where to land after sign-in (see `rememberReturnPath`). */
export async function signInWithGitHub(returnTo?: string): Promise<void> {
  if (!supabase) return;
  rememberReturnPath(returnTo);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: `${origin}/auth/callback` },
  });
}

/**
 * Google OAuth; same shared callback as GitHub. `prompt: "select_account"`
 * asks Google for its account chooser instead of a silent, possibly-wrong
 * auto-pick when the browser is already signed into more than one Google
 * account (documented parameter, values none/consent/select_account:
 * https://developers.google.com/identity/protocols/oauth2/web-server). No
 * `access_type`/`offline` — Peer never calls a Google API again after
 * sign-in, so there is no refresh token to ask for. `returnTo`: as for
 * GitHub, where to land after sign-in.
 */
export async function signInWithGoogle(returnTo?: string): Promise<void> {
  if (!supabase) return;
  rememberReturnPath(returnTo);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });
}
