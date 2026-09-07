"use client";

// Sign in and sign out, on the You page — the one place account identity
// lives. The floating "Sign in with GitHub" pill was the highest-contrast
// object on every desktop page for a product whose saves and reads work
// signed-out; the only Sign out was inside that pill's dropdown.
//
// Rendered only when Supabase is configured: a self-hosted Peer has no
// account to speak of and must not reserve a section for one.

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { signInWithGitHub, useAuthUser, userAvatar, userName } from "./use-auth-user";

export function AccountSection({ className = "" }: { className?: string }) {
  const auth = useAuthUser();
  const [busy, setBusy] = useState(false);

  if (auth.kind === "unconfigured" || auth.kind === "loading") return null;

  return (
    <section className={className} aria-labelledby="account-heading">
      <h2 id="account-heading" className="text-body-sm font-medium text-heading">
        Account
      </h2>

      {auth.kind === "signed-out" ? (
        <>
          <p className="mt-1 text-meta text-text-muted max-w-[52ch]">
            Sign in with GitHub to sync saves and reads across your devices.
          </p>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void signInWithGitHub();
            }}
            disabled={busy}
            className={`${buttonVariants({ tone: "surface", size: "md" })} mt-4`}
          >
            <GitHubMark />
            Sign in with GitHub
          </button>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <Avatar user={auth.user} size={32} />
          <div className="min-w-0">
            <p className="text-meta text-heading font-medium truncate">{userName(auth.user)}</p>
            {auth.user.email && (
              <p className="text-caption text-text-faint truncate">{auth.user.email}</p>
            )}
          </div>
          <form method="POST" action="/auth/signout" className="ml-auto">
            <button type="submit" className={buttonVariants({ tone: "dangerSoft", size: "sm" })}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

/** The avatar, or the name's initial where GitHub gave none. */
export function Avatar({
  user,
  size,
  className = "",
}: {
  user: Parameters<typeof userName>[0];
  size: number;
  className?: string;
}) {
  const avatar = userAvatar(user);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-accent-dim text-accent overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" width={size} height={size} className="w-full h-full object-cover" />
      ) : (
        <span className="text-caption font-semibold">
          {userName(user)[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </span>
  );
}

function GitHubMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.73.5.75 5.48.75 11.75a11.25 11.25 0 0 0 7.69 10.69c.56.1.76-.24.76-.54v-2.1c-3.13.68-3.79-1.34-3.79-1.34-.51-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.74 2.66 1.23 3.31.94.1-.73.4-1.23.72-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.12 1.16a10.75 10.75 0 0 1 5.68 0c2.17-1.46 3.12-1.16 3.12-1.16.61 1.55.23 2.7.11 2.98.73.79 1.16 1.8 1.16 3.03 0 4.33-2.63 5.26-5.14 5.55.41.35.78 1.04.78 2.1v3.11c0 .3.2.65.77.54A11.26 11.26 0 0 0 23.25 11.75C23.25 5.48 18.27.5 12 .5z" />
    </svg>
  );
}
