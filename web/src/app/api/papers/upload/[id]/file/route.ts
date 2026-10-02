// GET /api/papers/upload/[id]/file — streams the stored PDF back. This is
// both `linkPaper` on the mapped `Paper` record (so "Open the PDF" and the
// reading page's own PDF-link resolution just work with zero special-casing)
// and, indirectly, what `figures/extract.ts`'s upload branch and
// `papers/full-text.ts`'s upload branch read when a caller reaches this
// paper by URL instead of from its storage directly.

import { NextResponse } from "next/server";
import { isValidHash16, readUploadPdf } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bytes = isValidHash16(id) && (await ownedUpload(id)) ? await readUploadPdf(id) : null;
  if (!bytes) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404, headers: PRIVATE_UPLOAD_HEADERS });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${id}.pdf"`,
      ...PRIVATE_UPLOAD_HEADERS,
      "Content-Security-Policy": "sandbox",
    },
  });
}
