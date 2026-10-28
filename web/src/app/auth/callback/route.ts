// OAuth callback — Supabase redirects here after the provider returns.
// Exchanges the `code` for a session cookie, then forwards to a checked path:
// the `next` query param when there is one, else the `peer_after_sign_in`
// cookie the browser set before leaving (see lib/navigation/return-path.ts),
// else `/`. Both go through `safeReturnPath`: `${origin}${next}` with an
// unchecked `next` of `@evil.com` was `https://peer.homes@evil.com`, an open
// redirect. The cookie is deleted on the way out whenever it came in, whether
// the sign-in worked or not, so a stale one can never steer a later sign-in.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AFTER_SIGN_IN_COOKIE_NAME, safeReturnPath } from "@/lib/navigation/return-path";

/** Whether the request carried the return-path cookie at all — read from the
 *  raw header, so a value Next could not decode still counts and is cleared. */
function hasReturnCookie(request: NextRequest): boolean {
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .some((part) => part.trim().startsWith(`${AFTER_SIGN_IN_COOKIE_NAME}=`));
}

async function signInRedirect(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // `request.cookies` hands back the value already URI-decoded once; it is
      // checked exactly as given, never decoded again.
      const next =
        (nextParam !== null
          ? safeReturnPath(nextParam)
          : safeReturnPath(request.cookies.get(AFTER_SIGN_IN_COOKIE_NAME)?.value)) ?? "/";
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}

export async function GET(request: NextRequest) {
  const response = await signInRedirect(request);
  if (hasReturnCookie(request)) {
    // Same Path as the browser set it with, or the browser would keep the
    // original cookie and drop only a differently-scoped copy.
    response.cookies.set(AFTER_SIGN_IN_COOKIE_NAME, "", {
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  }
  return response;
}
