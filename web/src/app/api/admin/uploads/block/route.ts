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
  isValidHash16,
  pdfPath,
  readUploadMeta,
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

  // The PDF is the only per-hash16 derived content that ever lands on disk
  // for an upload (confirmed 9-16: full-text/figure extraction for
  // `upload:` ids never writes a shared or per-request cache file into
  // `UPLOAD_DIR` — both bypass the shared cache entirely and read the PDF
  // directly on every call). Removing it is removing every derived file.
  await unlink(pdfPath(hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

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

  return NextResponse.json({ blocked: true, hash16 });
}
