"use client";

// Sign in and sign out, on the You page — the one place account identity
// lives. The floating "Sign in with GitHub" pill was the highest-contrast
// object on every desktop page for a product whose saves and reads work
// signed-out; the only Sign out was inside that pill's dropdown.
//
// Rendered only when Supabase is configured: a self-hosted Peer has no
// account to speak of and must not reserve a section for one.

import { useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  signInWithGitHub,
  signInWithGoogle,
  useAuthUser,
  userAvatar,
  userName,
} from "./use-auth-user";

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
            Sign in with GitHub or Google to sync saves and reads across your devices.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setBusy(true);
                void signInWithGitHub();
              }}
              disabled={busy}
              className={buttonVariants({ tone: "surface", size: "md" })}
            >
              <GitHubMark />
              Sign in with GitHub
            </button>
            <button
              type="button"
              onClick={() => {
                setBusy(true);
                void signInWithGoogle();
              }}
              disabled={busy}
              className={buttonVariants({ tone: "surface", size: "md" })}
            >
              <GoogleMark />
              Sign in with Google
            </button>
          </div>
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
      {/* The one place a reader is asked to hand over an account is the one
          place the page that says what happens to it has to be reachable. */}
      <p className="mt-4 text-caption text-text-faint">
        <Link
          href="/privacy"
          className="underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors duration-[180ms] ease-expo"
        >
          What Peer keeps
        </Link>
      </p>
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

/**
 * Google's own official multi-colour "G" mark (P6, ABC-JEV-INTEGRATION.md
 * §1ai) — Google's sign-in branding guidelines call for this exact mark,
 * unmodified, on a "Sign in with Google" control, the same way GitHubMark
 * above embeds GitHub's own octocat unmodified. Sized to the same 13x13 box
 * as GitHubMark so the two buttons read as one calm family.
 */
function GoogleMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
