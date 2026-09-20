import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { readUploadMeta, type UploadMeta } from "./upload-store";

export const PRIVATE_UPLOAD_HEADERS = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noarchive",
};
export { UPLOAD_RIGHTS_VERSION } from "./upload-policy";
const LOCAL_COOKIE = "peer-private-uploads";

export function hostedUploadsEnabled(): boolean {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL && !process.env.VERCEL_ENV) return true;
  const root = process.env.PEER_PRIVATE_UPLOAD_DIR;
  // Hosted storage is an explicit operator choice, outside the served app.
  const relative = root ? path.relative(process.cwd(), path.resolve(root)) : "";
  return process.env.PEER_UPLOADS_ENABLED === "true" && !!root && path.isAbsolute(root)
    && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

/** Production always needs an authenticated account. Local development uses
 * a separate HttpOnly browser capability; never a shared "local user". */
export async function uploadOwner(createLocalSession = false): Promise<string | null> {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (configured) {
    try {
      const client = await createClient();
      const { data: { user } } = await client.auth.getUser();
      if (user) return createHash("sha256").update(`account:${user.id}`).digest("hex");
    } catch { return null; }
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || process.env.VERCEL_ENV) return null;
  const jar = await cookies();
  let token = jar.get(LOCAL_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    if (!createLocalSession) return null;
    token = randomUUID();
    jar.set(LOCAL_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: false,
      path: "/", maxAge: 30 * 86400 });
  }
  return createHash("sha256").update(`browser:${token}`).digest("hex");
}

export async function ownedUpload(hash16: string, owner?: string | null): Promise<UploadMeta | null> {
  const key = owner === undefined ? await uploadOwner() : owner;
  if (!key) return null;
  const meta = await readUploadMeta(hash16);
  // Old unowned files cannot safely be assigned to whoever asks first.
  if (!meta?.ownerKey || meta.ownerKey !== key || !meta.expiresAt ||
    !Number.isFinite(Date.parse(meta.expiresAt)) || Date.parse(meta.expiresAt) <= Date.now()) return null;
  return meta;
}

export function sameOriginUploadRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  return (!origin || origin === new URL(req.url).origin)
    && req.headers.get("sec-fetch-site") !== "cross-site";
}
