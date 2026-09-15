// GET /api/papers/upload/[id] — the reading page's cold-load/reload path for
// an uploaded paper (`[id]` here is the bare hash16, not the `upload:`-
// prefixed id the rest of the app uses — see `papers/[id]/page.tsx`'s
// `isUploadId` branch, which strips the prefix before calling this route).

import { NextResponse } from "next/server";
import { isValidHash16, readUploadMeta, uploadMetaToPaper } from "@/lib/papers/upload-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidHash16(id)) {
    return NextResponse.json({ error: "Not a valid upload id." }, { status: 400 });
  }

  const meta = await readUploadMeta(id);
  if (!meta) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  return NextResponse.json(uploadMetaToPaper(meta));
}
