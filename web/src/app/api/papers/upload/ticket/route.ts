// POST /api/papers/upload/ticket — how the reader's browser should send a PDF.
//
// A Vercel function refuses a request body much over 4 MB, and a paper's PDF
// is often larger. So when uploads live in the private Supabase bucket, this
// answers `{ mode: "direct", bucket, path, token }`: a one-time ticket for the
// browser to put the PDF straight into this owner's own staging folder, after
// which it names `path` to `POST /api/papers/upload` (as the form's `staged`
// field) and that route reads it back and runs every usual check. Without
// the bucket (local development, self-hosting on a disk) the answer is
// `{ mode: "form" }` — send the file in the form, as always.
//
// Same gates as the upload route itself, in the same order: same-origin,
// uploads enabled, an owner. Nothing is stored here; a ticket nobody uses
// leaves nothing behind.

import { NextResponse } from "next/server";
import { hostedUploadsEnabled, PRIVATE_UPLOAD_HEADERS, sameOriginUploadRequest, uploadOwner } from "@/lib/papers/upload-access";
import { createStagedUpload, stagedUploadsAvailable } from "@/lib/papers/upload-store";

export const dynamic = "force-dynamic";

// Mirrors MAX_UPLOAD_BYTES in ../route.ts (a route module cannot export a
// plain constant for another to share).
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  if (!sameOriginUploadRequest(req)) return NextResponse.json({ error: "Cross-site upload refused." }, { status: 403 });
  if (!hostedUploadsEnabled()) return NextResponse.json({ error: "Private PDF storage is not configured on this server." }, { status: 503 });
  const ownerKey = await uploadOwner(true);
  if (!ownerKey) return NextResponse.json({ error: "Sign in to upload a private PDF." }, { status: 401, headers: PRIVATE_UPLOAD_HEADERS });

  const body = await req.json().catch(() => null) as { size?: unknown } | null;
  if (typeof body?.size === "number" && body.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That PDF is larger than 25 MB." }, { status: 413 });
  }

  if (!stagedUploadsAvailable()) {
    return NextResponse.json({ mode: "form" }, { headers: PRIVATE_UPLOAD_HEADERS });
  }
  try {
    const ticket = await createStagedUpload(ownerKey);
    return NextResponse.json({ mode: "direct", ...ticket }, { headers: PRIVATE_UPLOAD_HEADERS });
  } catch (err) {
    console.error("[upload] could not create an upload ticket:", err);
    return NextResponse.json({ error: "Could not start the upload. Try again." }, { status: 500, headers: PRIVATE_UPLOAD_HEADERS });
  }
}
