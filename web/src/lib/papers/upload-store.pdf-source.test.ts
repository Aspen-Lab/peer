// P12-61 (§1h.434, part 3) — `withUploadPdfSource`: the figure engine opens an upload's PDF through a file
// stream, so the PDF is never held in memory. On the disk the source is the stored file itself; from the
// Supabase bucket it is a private temp file the body is streamed into (never `download()`'s whole Blob), removed
// once the work settles — after success, after the work threw, after the download failed, and when the object is
// not there. An in-memory bucket and a stubbed `fetch` stand in for Supabase; every byte is invented.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync: make } = await import("node:fs");
  const { tmpdir: temp } = await import("node:os");
  const { join } = await import("node:path");
  const dir = make(join(temp(), "peer-pdf-source-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const bucket = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  const calls = { download: 0, signed: 0 };
  const api = {
    download: async (name: string) => {
      calls.download += 1;
      const hit = objects.get(name);
      return hit
        ? { data: new Blob([new Uint8Array(hit)]), error: null }
        : { data: null, error: { message: "Object not found", statusCode: "404", status: 400 } };
    },
    upload: async (name: string, body: Buffer) => {
      objects.set(name, Buffer.from(body));
      return { data: { path: name }, error: null };
    },
    exists: async (name: string) => ({ data: objects.has(name), error: null }),
    remove: async (names: string[]) => {
      for (const name of names) objects.delete(name);
      return { data: [], error: null };
    },
    createSignedUrl: async (name: string) => {
      calls.signed += 1;
      return objects.has(name)
        ? { data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/private/${name}?token=SECRET-TOKEN` }, error: null }
        : { data: null, error: { message: "Object not found", statusCode: "404", status: 400 } };
    },
  };
  return { objects, calls, api };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => bucket.api } }),
}));

import { uploadBackend } from "./upload-backend";
import { pdfPath, sha16, withUploadPdfSource, writeUploadPdfIfAbsent } from "./upload-store";

const HASH = sha16(Buffer.from("p12-61: pdf source"));
const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4 invented bytes "), Buffer.alloc(300_000, 7), Buffer.from("\n%%EOF\n")]);

let scratch = "";
const left = () => readdirSync(scratch);

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "peer-pdf-source-tmp-"));
  vi.stubEnv("TMPDIR", scratch);
  bucket.objects.clear();
  bucket.calls.download = 0;
  bucket.calls.signed = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(scratch, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("withUploadPdfSource on the disk (P12-61)", () => {
  it("hands the stored file itself to the work — no copy, no temp file — and returns what the work returned", async () => {
    await writeUploadPdfIfAbsent(HASH, PDF_BYTES);
    let seen = "";
    const result = await withUploadPdfSource(HASH, async (source) => {
      seen = source.filePath;
      expect(readFileSync(source.filePath).equals(PDF_BYTES)).toBe(true);
      return "worked";
    });
    expect(result).toBe("worked");
    expect(seen).toBe(pdfPath(HASH));
    expect(left()).toEqual([]);
    expect(existsSync(pdfPath(HASH))).toBe(true);
  });

  it("is null, without calling the work, for a PDF that is gone", async () => {
    const work = vi.fn(async () => "never");
    expect(await withUploadPdfSource(sha16(Buffer.from("p12-61: not stored")), work)).toBeNull();
    expect(work).not.toHaveBeenCalled();
  });

  it("lets the work's error through, and leaves the stored file alone", async () => {
    await writeUploadPdfIfAbsent(HASH, PDF_BYTES);
    await expect(withUploadPdfSource(HASH, async () => { throw new Error("work failed"); })).rejects.toThrow("work failed");
    expect(existsSync(pdfPath(HASH))).toBe(true);
  });
});

describe("the disk backend's downloadToFile (P12-61)", () => {
  it("copies the object into an owner-only file, and says false for an object that is not there", async () => {
    await writeUploadPdfIfAbsent(HASH, PDF_BYTES);
    const target = path.join(scratch, "copy.pdf");
    expect(await uploadBackend().downloadToFile(`${HASH}.pdf`, target)).toBe(true);
    expect(readFileSync(target).equals(PDF_BYTES)).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(await uploadBackend().downloadToFile(`${sha16(Buffer.from("p12-61: absent"))}.pdf`, path.join(scratch, "absent.pdf"))).toBe(false);
    expect(existsSync(path.join(scratch, "absent.pdf"))).toBe(false);
  });
});

describe("withUploadPdfSource from the Supabase bucket (P12-61)", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_UPLOAD_BUCKET", "private-uploads");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
    bucket.objects.set(`${HASH}.pdf`, PDF_BYTES);
  });

  function serve(response: () => Response) {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      return response();
    }));
    return fetched;
  }

  it("streams the object into a private temp file the work reads, never through download(), and removes it after success", async () => {
    const fetched = serve(() => new Response(new Uint8Array(PDF_BYTES), { status: 200 }));
    let seen = "";
    let mode = 0;
    let folder = 0;
    const result = await withUploadPdfSource(HASH, async (source) => {
      seen = source.filePath;
      expect(readFileSync(source.filePath).equals(PDF_BYTES)).toBe(true);
      mode = statSync(source.filePath).mode & 0o777;
      folder = statSync(path.dirname(source.filePath)).mode & 0o777;
      expect(left()).toHaveLength(1);
      return 42;
    });

    expect(result).toBe(42);
    expect(fetched).toHaveLength(1);
    expect(bucket.calls.download).toBe(0);
    expect(seen.startsWith(scratch)).toBe(true);
    expect(seen).not.toBe(pdfPath(HASH));
    expect(mode).toBe(0o600);
    expect(folder).toBe(0o700);
    // Gone after success.
    expect(left()).toEqual([]);
    expect(existsSync(seen)).toBe(false);
  });

  it("removes the temp file when the work throws, and lets the error through", async () => {
    serve(() => new Response(new Uint8Array(PDF_BYTES), { status: 200 }));
    let seen = "";
    await expect(
      withUploadPdfSource(HASH, async (source) => {
        seen = source.filePath;
        throw new Error("the engine fell over");
      }),
    ).rejects.toThrow("the engine fell over");
    expect(seen).not.toBe("");
    expect(existsSync(seen)).toBe(false);
    expect(left()).toEqual([]);
  });

  it("removes the temp file when the download fails — an HTTP error, a body that breaks off — without calling the work, and never puts the URL's token in the error", async () => {
    const work = vi.fn(async () => "never");
    serve(() => new Response("upstream trouble", { status: 503 }));
    const failed = await withUploadPdfSource(HASH, work).catch((error: Error) => error);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain("503");
    expect((failed as Error).message).not.toContain("SECRET-TOKEN");
    expect(left()).toEqual([]);

    let sent = 0;
    serve(() => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ === 0) controller.enqueue(new Uint8Array(PDF_BYTES.subarray(0, 1000)));
        else controller.error(new Error("connection reset"));
      },
    }), { status: 200 }));
    await expect(withUploadPdfSource(HASH, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(left()).toEqual([]);
  });

  it("is null, without calling the work and leaving no temp file, for an object that is not there", async () => {
    const work = vi.fn(async () => "never");
    const fetched = serve(() => new Response("nope", { status: 404 }));

    bucket.objects.clear();
    expect(await withUploadPdfSource(HASH, work)).toBeNull();
    expect(fetched).toHaveLength(0);

    // Signed, then gone before the fetch: the storage answers 404 (or its 400 "not found").
    bucket.objects.set(`${HASH}.pdf`, PDF_BYTES);
    expect(await withUploadPdfSource(HASH, work)).toBeNull();
    serve(() => new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 }));
    expect(await withUploadPdfSource(HASH, work)).toBeNull();

    expect(work).not.toHaveBeenCalled();
    expect(left()).toEqual([]);
  });
});
