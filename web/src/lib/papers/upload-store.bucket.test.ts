// upload-store.ts against the Supabase bucket backend (PEER_UPLOAD_BUCKET),
// with an in-memory bucket standing in for Supabase Storage. The disk
// backend has its own tests in upload-store.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => {
  const objects = new Map<string, { bytes: Buffer; createdAt: string }>();
  const api = {
    download: async (name: string) => {
      const hit = objects.get(name);
      return hit
        ? { data: new Blob([new Uint8Array(hit.bytes)]), error: null }
        : { data: null, error: { message: "Object not found", statusCode: "404", status: 400 } };
    },
    upload: async (name: string, body: Buffer) => {
      objects.set(name, { bytes: Buffer.from(body), createdAt: new Date().toISOString() });
      return { data: { path: name }, error: null };
    },
    exists: async (name: string) => ({ data: objects.has(name), error: null }),
    remove: async (names: string[]) => {
      for (const name of names) objects.delete(name);
      return { data: [], error: null };
    },
    // Entries directly under `prefix`: files carry an id, folders do not.
    list: async (prefix: string, options?: { limit?: number; offset?: number }) => {
      const base = prefix ? `${prefix}/` : "";
      const files: { name: string; id: string; created_at: string }[] = [];
      const folders = new Set<string>();
      for (const [name, object] of objects) {
        if (!name.startsWith(base)) continue;
        const rest = name.slice(base.length);
        const slash = rest.indexOf("/");
        if (slash === -1) files.push({ name: rest, id: `id-${name}`, created_at: object.createdAt });
        else folders.add(rest.slice(0, slash));
      }
      const entries = [...[...folders].map((name) => ({ name, id: null, created_at: null })), ...files];
      const offset = options?.offset ?? 0;
      return { data: entries.slice(offset, offset + (options?.limit ?? 100)), error: null };
    },
    createSignedUploadUrl: async (name: string) => ({
      data: { signedUrl: `https://example.supabase.co/upload/${name}?token=t`, token: "t", path: name },
      error: null,
    }),
  };
  return { objects, api };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => bucket.api } }),
}));

import {
  attachUpload,
  attachedUploadHash,
  createStagedUpload,
  deleteUpload,
  isOwnStagedUpload,
  listUploadMeta,
  purgeExpiredUploads,
  readStagedUpload,
  readUploadMeta,
  readUploadPdf,
  stagedUploadsAvailable,
  uploadFileExists,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "./upload-store";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const HASH = "0123456789abcdef";

function meta(overrides: Partial<UploadMeta> = {}): UploadMeta {
  return {
    hash16: HASH,
    ownerKey: ALICE,
    expiresAt: "2099-01-01T00:00:00.000Z",
    status: "ready",
    fileName: "paper.pdf",
    title: "A Paper",
    uploadedAt: "2026-10-01T00:00:00.000Z",
    textStatus: "ok",
    ...overrides,
  };
}

beforeEach(() => {
  bucket.objects.clear();
  vi.stubEnv("PEER_UPLOAD_BUCKET", "private-uploads");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("upload-store on the Supabase bucket", () => {
  it("is chosen only when the bucket and both server credentials are set", () => {
    expect(stagedUploadsAvailable()).toBe(true);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(stagedUploadsAvailable()).toBe(false);
  });

  it("stores a PDF and its record in the bucket, and lists it for its owner only", async () => {
    await writeUploadMeta(HASH, meta());
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 bytes"));

    expect(await uploadFileExists(HASH)).toBe(true);
    expect((await readUploadPdf(HASH))?.toString()).toBe("%PDF-1.4 bytes");
    expect((await readUploadMeta(HASH))?.title).toBe("A Paper");
    expect(bucket.objects.has(`owners/${ALICE}/${HASH}`)).toBe(true);
    expect((await listUploadMeta(ALICE)).map((m) => m.hash16)).toEqual([HASH]);
    expect(await listUploadMeta(BOB)).toEqual([]);
  });

  it("never lists another owner's record, even if a marker points at it", async () => {
    await writeUploadMeta(HASH, meta());
    bucket.objects.set(`owners/${BOB}/${HASH}`, { bytes: Buffer.alloc(0), createdAt: new Date().toISOString() });
    expect(await listUploadMeta(BOB)).toEqual([]);
  });

  it("a repeat write of the same bytes leaves the stored PDF alone", async () => {
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 first"));
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 second"));
    expect((await readUploadPdf(HASH))?.toString()).toBe("%PDF-1.4 first");
  });

  it("deleting removes the record, the bytes, the attachment and the owner marker", async () => {
    await writeUploadMeta(HASH, meta({ paperIds: ["arxiv:2401.00001"] }));
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 bytes"));
    await attachUpload(ALICE, "arxiv:2401.00001", HASH);
    expect(await attachedUploadHash(ALICE, "arxiv:2401.00001")).toBe(HASH);

    await deleteUpload(meta({ paperIds: ["arxiv:2401.00001"] }));

    expect(bucket.objects.size).toBe(0);
    expect(await readUploadMeta(HASH)).toBeNull();
    expect(await readUploadPdf(HASH)).toBeNull();
  });

  it("purges an expired upload and leaves a live one", async () => {
    const live = "fedcba9876543210";
    await writeUploadMeta(HASH, meta({ expiresAt: "2000-01-01T00:00:00.000Z" }));
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 old"));
    await writeUploadMeta(live, meta({ hash16: live }));
    await writeUploadPdfIfAbsent(live, Buffer.from("%PDF-1.4 live"));

    await purgeExpiredUploads();

    expect(await readUploadMeta(HASH)).toBeNull();
    expect(await readUploadPdf(HASH)).toBeNull();
    expect(await readUploadPdf(live)).not.toBeNull();
  });
});

describe("staged uploads (the browser puts the PDF in the bucket itself)", () => {
  it("tickets an object inside the owner's own staging folder", async () => {
    const ticket = await createStagedUpload(ALICE);
    expect(ticket.bucket).toBe("private-uploads");
    expect(ticket.path).toMatch(new RegExp(`^incoming/${ALICE}/[0-9a-f-]{36}\\.pdf$`));
    expect(isOwnStagedUpload(ALICE, ticket.path)).toBe(true);
    await expect(createStagedUpload("not-an-owner-key")).rejects.toThrow();
  });

  it("reads a staged PDF back only for its own owner, and only from the staging folder", async () => {
    const ticket = await createStagedUpload(ALICE);
    bucket.objects.set(ticket.path, { bytes: Buffer.from("%PDF-1.4 staged"), createdAt: new Date().toISOString() });
    await writeUploadPdfIfAbsent(HASH, Buffer.from("%PDF-1.4 stored"));

    expect((await readStagedUpload(ALICE, ticket.path))?.toString()).toBe("%PDF-1.4 staged");
    expect(await readStagedUpload(BOB, ticket.path)).toBeNull();
    // Never a stored upload, and never a path that climbs out of the folder.
    expect(await readStagedUpload(ALICE, `${HASH}.pdf`)).toBeNull();
    expect(await readStagedUpload(ALICE, `incoming/${ALICE}/../${BOB}/x.pdf`)).toBeNull();
  });

  it("is never available on the disk backend", async () => {
    vi.stubEnv("PEER_UPLOAD_BUCKET", "");
    expect(stagedUploadsAvailable()).toBe(false);
    expect(await readStagedUpload(ALICE, `incoming/${ALICE}/00000000-0000-0000-0000-000000000000.pdf`)).toBeNull();
  });

  it("purge sweeps a staged PDF abandoned for over a day and keeps a fresh one", async () => {
    const stale = `incoming/${ALICE}/11111111-1111-1111-1111-111111111111.pdf`;
    const fresh = `incoming/${ALICE}/22222222-2222-2222-2222-222222222222.pdf`;
    bucket.objects.set(stale, { bytes: Buffer.from("%PDF-1.4"), createdAt: new Date(Date.now() - 2 * 86400_000).toISOString() });
    bucket.objects.set(fresh, { bytes: Buffer.from("%PDF-1.4"), createdAt: new Date().toISOString() });

    await purgeExpiredUploads();

    expect(bucket.objects.has(stale)).toBe(false);
    expect(bucket.objects.has(fresh)).toBe(true);
  });
});
