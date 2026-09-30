import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt.8 AMENDMENT (b)) — this name
// must match profile-sync.tsx's SIGN_OUT_COOKIE_NAME exactly; kept as one
// literal in each file (server route vs. browser code can't share a
// module) rather than a shared import, so both sides are grepped together
// whenever this name ever changes.
const SIGNED_OUT_COOKIE_NAME = "peer_signed_out";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const origin = new URL(request.url).origin;
  // ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — a one-time marker, now a
  // short-lived, first-party COOKIE rather than a URL parameter. A URL
  // parameter can be forged, shared, or bookmarked — a link alone could
  // trigger the same clear as a real sign-out (the fresh review's MEDIUM
  // finding). A cookie set here, on THIS response, cannot: only a
  // same-origin Set-Cookie header (this route actually running) can create
  // it. Redirect target goes back to the plain root, no query string.
  const response = NextResponse.redirect(`${origin}/`, { status: 303 });
  response.cookies.set(SIGNED_OUT_COOKIE_NAME, "1", {
    maxAge: 60, // short-lived: this device is expected to read and
    // consume it on its very next load, not carry it around
    path: "/",
    sameSite: "lax",
    // Deliberately NOT httpOnly: profile-sync.tsx reads it from
    // document.cookie on the client — it carries no secret, only "a
    // sign-out just happened," so client-side readability is required,
    // not a risk.
    httpOnly: false,
  });
  return response;
}
