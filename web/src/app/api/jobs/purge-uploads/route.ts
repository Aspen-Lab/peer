import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeExpiredUploads } from "@/lib/papers/upload-store";
import { PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

export const dynamic = "force-dynamic";

/** Schedule daily on the host that mounts PEER_PRIVATE_UPLOAD_DIR. */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null;
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  if (!expected || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_UPLOAD_HEADERS });
  }
  await purgeExpiredUploads();
  return NextResponse.json({ purged: true }, { headers: PRIVATE_UPLOAD_HEADERS });
}
