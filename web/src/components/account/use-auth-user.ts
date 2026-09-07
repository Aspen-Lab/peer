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

/** GitHub OAuth; the browser leaves for the callback, so nothing to unset. */
export async function signInWithGitHub(): Promise<void> {
  if (!supabase) return;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: `${origin}/auth/callback` },
  });
}
