// Where a private upload's objects physically live. `upload-store.ts` owns
// the naming (`<hash16>.pdf`, `<hash16>.json`, `<sha256>.attachment.json`)
// and every rule about them; this file only knows how to read, write, list
// and remove a named object in one of two places:
//
//   - **disk** — `PEER_PRIVATE_UPLOAD_DIR`, or `web/.local-data/uploads/` in
//     local development. One machine, one directory; what self-hosting and
//     `next dev` have always used.
//   - **supabase** — a private Supabase Storage bucket (`PEER_UPLOAD_BUCKET`),
//     reached only with the server-side service-role key. The one choice
//     that survives a Vercel deployment, where no function instance keeps a
//     file another instance can read, and where none keeps it for long.
//
// The bucket is chosen whenever `PEER_UPLOAD_BUCKET` and the service-role
// credentials are all present — in local development too, so the hosted
// path can be exercised from a developer's machine. Nothing here decides
// whether uploads are *allowed*; `hostedUploadsEnabled()` (upload-access.ts)
// does, and it asks `supabaseUploadStorageConfigured()` below.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UploadObject {
  name: string;
  /** ISO time the object was created, when the backend reports one. */
  createdAt?: string;
}

export interface UploadBackend {
  kind: "disk" | "supabase";
  /** The object's bytes, or null when there is no such object. */
  read(name: string): Promise<Buffer | null>;
  /** Creates or replaces the object. */
  write(name: string, data: Buffer | string, contentType: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  /** Removes each named object; one that is already gone is not an error. */
  remove(names: string[]): Promise<void>;
  /** Objects directly under `prefix` (`""` is the top level); never folders. */
  list(prefix: string): Promise<UploadObject[]>;
  /** Folder names directly under `prefix`. */
  listFolders(prefix: string): Promise<string[]>;
}

// Anchored on a file that is always checked into `web/` — the dev server and
// some test runners start from different working directories (repo root vs.
// `web/`), and `.local-data/uploads` itself is gitignored and may not exist
// yet on a fresh checkout.
function resolveWebRoot(): string {
  const candidates = [process.cwd(), path.join(process.cwd(), "web")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "next.config.ts"))) return candidate;
  }
  return process.cwd();
}

export const UPLOAD_DIR = process.env.PEER_PRIVATE_UPLOAD_DIR || path.join(resolveWebRoot(), ".local-data", "uploads");

function diskPath(name: string): string {
  const resolved = path.resolve(UPLOAD_DIR, name);
  // Every name is built by upload-store.ts from validated hashes; this is the
  // belt to that brace, so no name can ever reach outside the directory.
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new Error("Invalid upload object name");
  return resolved;
}

const diskBackend: UploadBackend = {
  kind: "disk",
  async read(name) {
    try {
      return await readFile(diskPath(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async write(name, data) {
    const target = diskPath(name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { mode: 0o600 });
  },
  async exists(name) {
    return existsSync(diskPath(name));
  },
  async remove(names) {
    for (const name of names) {
      await unlink(diskPath(name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  },
  async list(prefix) {
    const dir = prefix ? diskPath(prefix) : UPLOAD_DIR;
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: UploadObject[] = [];
    for (const name of names) {
      const info = await stat(path.join(dir, name)).catch(() => null);
      if (info?.isFile()) out.push({ name, createdAt: info.birthtime.toISOString() });
    }
    return out;
  },
  async listFolders(prefix) {
    const dir = prefix ? diskPath(prefix) : UPLOAD_DIR;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  },
};

/** The bucket name, when one is configured. */
export function uploadBucket(): string | null {
  return process.env.PEER_UPLOAD_BUCKET?.trim() || null;
}

/** True when private uploads go to the Supabase bucket rather than a disk. */
export function supabaseUploadStorageConfigured(): boolean {
  return !!(uploadBucket() && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Supabase answers a missing object with 400/404 and "not found" wording. */
function isNotFound(error: { message?: string; status?: number; statusCode?: string } | null): boolean {
  if (!error) return false;
  return error.statusCode === "404" || error.status === 404 || /not.?found/i.test(error.message ?? "");
}

function bucketApi() {
  const bucket = uploadBucket();
  if (!bucket) throw new Error("PEER_UPLOAD_BUCKET is not set");
  return createAdminClient().storage.from(bucket);
}

const LIST_PAGE = 1000;

const supabaseBackend: UploadBackend = {
  kind: "supabase",
  async read(name) {
    const { data, error } = await bucketApi().download(name);
    if (error) {
      if (isNotFound(error as { message?: string; status?: number; statusCode?: string })) return null;
      throw error;
    }
    return Buffer.from(await data.arrayBuffer());
  },
  async write(name, data, contentType) {
    const body = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    const { error } = await bucketApi().upload(name, body, { contentType, upsert: true, cacheControl: "0" });
    if (error) throw error;
  },
  async exists(name) {
    // storage-js answers a missing object with `data: false` (and a bare
    // 400/404 "Bad Request" error alongside); any other failure throws.
    const { data } = await bucketApi().exists(name);
    return data === true;
  },
  async remove(names) {
    if (names.length === 0) return;
    const { error } = await bucketApi().remove(names);
    if (error) throw error;
  },
  async list(prefix) {
    const api = bucketApi();
    const out: UploadObject[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await api.list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      for (const entry of data ?? []) {
        // A folder comes back as an entry with no id.
        if (entry.id) out.push({ name: entry.name, createdAt: entry.created_at ?? undefined });
      }
      if (!data || data.length < LIST_PAGE) break;
    }
    return out;
  },
  async listFolders(prefix) {
    const { data, error } = await bucketApi().list(prefix, { limit: LIST_PAGE });
    if (error) throw error;
    return (data ?? []).filter((entry) => !entry.id).map((entry) => entry.name);
  },
};

/** Resolved on every call, so a test (or a changed env) never sees a stale choice. */
export function uploadBackend(): UploadBackend {
  return supabaseUploadStorageConfigured() ? supabaseBackend : diskBackend;
}

/**
 * A one-time URL the reader's browser uses to put a PDF straight into the
 * bucket — a Vercel function will not accept a request body much over 4 MB,
 * and a paper's PDF is often larger. The object lands under `name`, which
 * the caller builds inside the owner's own staging folder; the token is good
 * for that one name only.
 */
export async function createSignedUploadTicket(name: string): Promise<{ bucket: string; path: string; token: string }> {
  const bucket = uploadBucket();
  if (!bucket) throw new Error("PEER_UPLOAD_BUCKET is not set");
  const { data, error } = await bucketApi().createSignedUploadUrl(name);
  if (error) throw error;
  return { bucket, path: data.path, token: data.token };
}
