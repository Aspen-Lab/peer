// P12-61 (§1h.434) — the kept figure cut on the Supabase bucket backend, with an
// in-memory bucket standing in for Supabase Storage (as `upload-store.bucket.test.ts`
// does): written whole under `figure-cuts/<hash16>/`, read back, removed with the
// upload by listing that one folder, and swept by the purge. The bytes are invented.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => {
  const objects = new Map<string, { bytes: Buffer; createdAt: string }>();
  const lists: string[] = [];
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
      lists.push(prefix);
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
  };
  return { objects, lists, api };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => bucket.api } }),
}));

const revision = vi.hoisted(() => ({ value: "4" }));
vi.mock("@/lib/figures/figure-revision", () => ({
  get FIGURE_EXTRACTION_REVISION() {
    return revision.value;
  },
}));

import {
  deleteUpload,
  purgeExpiredUploads,
  readUploadFigureCut,
  removeUploadFigureCuts,
  writeUploadFigureCut,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "./upload-store";

const ALICE = "a".repeat(64);
const ONE = "0123456789abcdef";
const TWO = "fedcba9876543210";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fakePng(fill: number, length = 64): Buffer {
  return Buffer.from([...SIGNATURE, ...new Array<number>(length).fill(fill)]);
}

function meta(hash16: string, overrides: Partial<UploadMeta> = {}): UploadMeta {
  return {
    hash16,
    ownerKey: ALICE,
    expiresAt: "2099-01-01T00:00:00.000Z",
    status: "ready",
    fileName: "paper.pdf",
    title: "An invented upload",
    uploadedAt: "2026-10-27T00:00:00.000Z",
    textStatus: "ok",
    ...overrides,
  };
}

const keysUnder = (prefix: string) => [...bucket.objects.keys()].filter((name) => name.startsWith(prefix)).sort();

beforeEach(() => {
  bucket.objects.clear();
  bucket.lists.length = 0;
  revision.value = "4";
  vi.stubEnv("PEER_UPLOAD_BUCKET", "private-uploads");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("a kept figure cut on the Supabase bucket (P12-61)", () => {
  it("is written whole under figure-cuts/<hash16>/ with no temp object, and read back with its size", async () => {
    const png = fakePng(9, 200);
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png, width: 900, height: 300 });

    const names = keysUnder(`figure-cuts/${ONE}/`);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(new RegExp(`^figure-cuts/${ONE}/p2-[0-9a-f]{16}-r4\\.cut$`));
    const kept = await readUploadFigureCut(ONE, 2, "Figure 3");
    expect(Buffer.compare(kept!.png, png)).toBe(0);
    expect(kept).toMatchObject({ width: 900, height: 300 });
    // Another page, another label, another revision, another upload: all miss.
    expect(await readUploadFigureCut(ONE, 3, "Figure 3")).toBeNull();
    expect(await readUploadFigureCut(ONE, 2, "Figure 4")).toBeNull();
    expect(await readUploadFigureCut(TWO, 2, "Figure 3")).toBeNull();
    revision.value = "5";
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
  });

  it("is removed by deleteUpload by listing only that upload's folder, and another upload's cuts stay", async () => {
    const mine = meta(ONE);
    await writeUploadMeta(ONE, mine);
    await writeUploadPdfIfAbsent(ONE, Buffer.from("%PDF-1.4 p12-61 bucket delete fixture"));
    await writeUploadFigureCut(ONE, 1, "Figure 1", { png: fakePng(1) });
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(2) });
    await writeUploadMeta(TWO, meta(TWO));
    await writeUploadFigureCut(TWO, 1, "Figure 1", { png: fakePng(3) });
    bucket.lists.length = 0;

    await deleteUpload(mine);

    expect(keysUnder(`figure-cuts/${ONE}/`)).toEqual([]);
    expect(keysUnder(`figure-cuts/${TWO}/`)).toHaveLength(1);
    expect(bucket.lists).toContain(`figure-cuts/${ONE}`);
    // The bucket is never listed whole to find an upload's pictures.
    expect(bucket.lists).not.toContain("");
  });

  it("is removed by removeUploadFigureCuts whatever the revision, and removing nothing is not an error", async () => {
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1) });
    revision.value = "5";
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(2) });
    expect(keysUnder(`figure-cuts/${ONE}/`)).toHaveLength(2);

    await removeUploadFigureCuts(ONE);
    await removeUploadFigureCuts(ONE);

    expect(keysUnder(`figure-cuts/${ONE}/`)).toEqual([]);
  });

  it("is swept by the purge: an expired upload's, a gone or blocked upload's, and a live upload's older revisions", async () => {
    const live = "1111111111111111";
    const gone = "2222222222222222";
    const blocked = "3333333333333333";
    const expired = "4444444444444444";
    await writeUploadMeta(live, meta(live));
    await writeUploadMeta(blocked, meta(blocked, { status: "blocked", expiresAt: undefined }));
    await writeUploadMeta(expired, meta(expired, { expiresAt: "2020-01-01T00:00:00.000Z" }));
    for (const hash16 of [live, gone, blocked, expired]) await writeUploadFigureCut(hash16, 1, "Figure 1", { png: fakePng(1) });
    revision.value = "5";
    await writeUploadFigureCut(live, 1, "Figure 1", { png: fakePng(2) });
    await writeUploadFigureCut(live, 4, "Figure 2", { png: fakePng(3) });

    await purgeExpiredUploads();

    expect(keysUnder(`figure-cuts/${gone}/`)).toEqual([]);
    expect(keysUnder(`figure-cuts/${blocked}/`)).toEqual([]);
    expect(keysUnder(`figure-cuts/${expired}/`)).toEqual([]);
    const left = keysUnder(`figure-cuts/${live}/`);
    expect(left).toHaveLength(2);
    expect(left.every((name) => name.endsWith("-r5.cut"))).toBe(true);
  });
});
