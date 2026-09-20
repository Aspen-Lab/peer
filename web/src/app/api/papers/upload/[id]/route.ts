// GET /api/papers/upload/[id] — the reading page's cold-load/reload path for
// an uploaded paper (`[id]` here is the bare hash16, not the `upload:`-
// prefixed id the rest of the app uses — see `papers/[id]/page.tsx`'s
// `isUploadId` branch, which strips the prefix before calling this route).

import { NextResponse } from "next/server";
import { isValidHash16, deleteUpload, hasOtherReadyDocumentCopy, uploadMetaToPaper } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS, sameOriginUploadRequest } from "@/lib/papers/upload-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidHash16(id)) {
    return NextResponse.json({ error: "Not a valid upload id." }, { status: 400 });
  }

  const meta = await ownedUpload(id);
  if (!meta) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  return NextResponse.json(uploadMetaToPaper(meta), { headers: PRIVATE_UPLOAD_HEADERS });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginUploadRequest(req)) return NextResponse.json({ error: "Cross-site deletion refused." }, { status: 403 });
  const { id } = await params;
  const meta = isValidHash16(id) ? await ownedUpload(id) : null;
  if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404, headers: PRIVATE_UPLOAD_HEADERS });
  // 9-22 (A9-02): count this owner's OTHER still-live copies of the same
  // logical document BEFORE deleting this one — the exact A9-02 over-erasure
  // repro was deleting one of two same-DOI copies and losing the only
  // preference-ledger evidence for a document the owner still has a live
  // copy of. `meta.ownerKey` is guaranteed set here (ownedUpload only
  // returns a match), but guarded anyway for a mocked/legacy caller shape.
  const retractEvidence = meta.ownerKey
    ? !(await hasOtherReadyDocumentCopy(meta.ownerKey, meta.documentKey, meta.hash16))
    : true;
  await deleteUpload(meta);
  return NextResponse.json({ deleted: true, documentKey: meta.documentKey, retractEvidence }, { headers: PRIVATE_UPLOAD_HEADERS });
}
