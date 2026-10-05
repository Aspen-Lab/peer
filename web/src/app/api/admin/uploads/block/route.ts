// POST /api/admin/uploads/block — the operator takedown path (9-19, A9-06).
// Handoff §6.2 "删除/封禁" is explicit: an upload's OWNER is not the only
// person who can ever need it gone (a copyright complaint, for instance);
// this is that path, for an operator with the shared `ADMIN_TOKEN` secret —
// never exposed to, or usable by, an ordinary reader.
//
// Env-gated like the purge job (`jobs/purge-uploads/route.ts`), same
// timing-safe bearer pattern: **404 when `ADMIN_TOKEN` is unset**, so an
// unconfigured deployment does not even reveal the route exists, rather
// than a 401 that would.

import { timingSafeEqual } from "node:crypto";
import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  hasOtherReadyDocumentCopy,
  isValidHash16,
  pdfPath,
  readUploadMeta,
  removeUploadDoc,
  writeUploadMeta,
  type UploadMeta,
} from "@/lib/papers/upload-store";

export const dynamic = "force-dynamic";

function authorized(req: Request, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorized(req, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const hash16 = (body as { hash16?: unknown } | null)?.hash16;
  if (typeof hash16 !== "string" || !isValidHash16(hash16)) {
    return NextResponse.json({ error: "hash16 is required and must be a valid upload id." }, { status: 400 });
  }

  const meta = await readUploadMeta(hash16);
  if (!meta) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  // 9-22 (A9-02): same reference-counting rule as the owner-facing DELETE
  // route — an operator takedown of one copy must not silently claim to
  // retract evidence still justified by another live `ready` copy of the
  // same document. This route has no client session to act on the flag
  // itself (the owner's browser is what forgets a ledger entry); returning
  // it keeps the two takedown paths' contracts identical for any future
  // admin tooling that does act on it.
  const retractEvidence = meta.ownerKey
    ? !(await hasOtherReadyDocumentCopy(meta.ownerKey, meta.documentKey, hash16))
    : true;

  // The PDF and, since P0-02, the text Peer read out of it (the
  // `<hash16>.doc.json` sidecar, `upload-store.ts`) are the per-hash16 files
  // an upload leaves on disk; figure extraction still writes nothing into
  // `UPLOAD_DIR` (9-16). Removing both is removing every derived file.
  await unlink(pdfPath(hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await removeUploadDoc(hash16);

  // A minimal record, deliberately smaller than a live `UploadMeta`: kept
  // ONLY so this hash16 can never be re-claimed by a future upload of the
  // same bytes (upload/route.ts refuses outright on `status === "blocked"`)
  // and so an operator has an audit trail (who owned it, which logical
  // document, when). Everything else — title, file name, DOI, page count,
  // rights acceptance, expiry — is dropped, not merely hidden; the
  // preference-ledger evidence is explicitly retracted (`preferenceSignals:
  // []`) rather than left to imply anything. No `expiresAt` means
  // `listUploadMeta` (the owner's own upload list) naturally excludes it,
  // and phase 2 is where the reference-counted retraction across sibling
  // documents gets built — this pass only ever clears this one asset's own
  // signals.
  const minimal: UploadMeta = {
    hash16,
    status: "blocked",
    blockedAt: new Date().toISOString(),
    ownerKey: meta.ownerKey,
    documentKey: meta.documentKey,
    fileName: "",
    title: "",
    uploadedAt: meta.uploadedAt,
    textStatus: "empty",
    preferenceSignals: [],
  };
  await writeUploadMeta(hash16, minimal);

  return NextResponse.json({ blocked: true, hash16, retractEvidence, documentKey: meta.documentKey });
}
