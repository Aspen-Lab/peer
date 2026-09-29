// GET /api/papers/upload-availability — UPLOAD-404 (§1bi.2): the smallest
// signal a Client Component can ask for to know whether uploading a PDF can
// succeed on this server at all right now. Mirrors `hostedUploadsEnabled()`
// (upload-access.ts) exactly — the one place that answer actually lives —
// rather than a `NEXT_PUBLIC_*` build-time flag that could disagree with it.
//
// A sibling of `upload/`, not nested under `upload/[id]/route.ts`'s dynamic
// segment, so there is no static-vs-dynamic path to reason about.
//
// No owner, no cookies, no private data: every caller gets the same answer,
// so this carries none of `PRIVATE_UPLOAD_HEADERS`. `force-dynamic` mirrors
// the existing upload route's own guard against this env-dependent answer
// being statically optimized away at build time.

import { NextResponse } from "next/server";
import { hostedUploadsEnabled } from "@/lib/papers/upload-access";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: hostedUploadsEnabled() });
}
