// GET /api/papers/upload/[id]/file — streams the stored PDF back. This is
// both `linkPaper` on the mapped `Paper` record (so "Open the PDF" and the
// reading page's own PDF-link resolution just work with zero special-casing)
// and, indirectly, what `figures/extract.ts`'s upload branch and
// `papers/full-text.ts`'s upload branch read when a caller reaches this
// paper by URL instead of by local file path directly.

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isValidHash16, pdfPath, uploadFileExists } from "@/lib/papers/upload-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidHash16(id) || !uploadFileExists(id)) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  const bytes = await readFile(pdfPath(id));
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${id}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
