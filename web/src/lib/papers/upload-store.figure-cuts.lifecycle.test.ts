// P12-61 (§1h.434) — a kept figure cut goes with its upload: `deleteUpload` removes
// it, and the purge removes the cuts of an upload that is gone or taken down and
// the cuts of an older revision. The real store runs on a temp directory (the disk
// backend); the bucket backend has its own file. Every byte here is invented: a
// PNG signature and filler, never a real picture, never a real PDF.

import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-figure-cuts-store-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

// A removal that fails on demand, for the one test that needs a folder that will not go.
const fault = vi.hoisted(() => ({ rm: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) =>
      fault.rm && String(args[0]).includes("figure-cuts") ? Promise.reject(new Error("rm failed")) : actual.rm(...args),
  };
});

// The revision is a getter, so a test can bump it the way a code change does.
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
  sha16,
  writeUploadFigureCut,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "./upload-store";

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

const OWNER = "a".repeat(64);
const ONE = sha16(Buffer.from("p12-61: first invented upload"));
const TWO = sha16(Buffer.from("p12-61: second invented upload"));
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG-shaped byte string: the signature, then `fill` repeated. Never a real image. */
function fakePng(fill: number, length = 64): Buffer {
  return Buffer.from([...SIGNATURE, ...new Array<number>(length).fill(fill)]);
}

const folder = (hash16: string) => path.join(uploadDir, "figure-cuts", hash16);
const objects = async (hash16: string) => (await readdir(folder(hash16)).catch(() => [])).sort();

function meta(hash16: string, extra: Partial<UploadMeta> = {}): UploadMeta {
  return {
    hash16,
    ownerKey: OWNER,
    fileName: "paper.pdf",
    title: "An invented upload",
    uploadedAt: "2026-10-27T00:00:00.000Z",
    textStatus: "ok",
    status: "ready",
    revision: 1,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...extra,
  };
}

beforeEach(async () => {
  revision.value = "4";
  fault.rm = false;
  await rm(uploadDir, { recursive: true, force: true });
});

describe("a kept figure cut goes with its upload (P12-61)", () => {
  it("is removed by deleteUpload with the PDF and the record, and another upload's cuts stay", async () => {
    const mine = meta(ONE);
    await writeUploadMeta(ONE, mine);
    await writeUploadPdfIfAbsent(ONE, Buffer.from("%PDF-1.4 p12-61 delete fixture"));
    await writeUploadFigureCut(ONE, 1, "Figure 1", { png: fakePng(1) });
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(2) });
    await writeUploadMeta(TWO, meta(TWO));
    await writeUploadFigureCut(TWO, 1, "Figure 1", { png: fakePng(3) });

    await deleteUpload(mine);

    expect(existsSync(folder(ONE))).toBe(false);
    expect(await readUploadFigureCut(ONE, 1, "Figure 1")).toBeNull();
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
    expect((await readUploadFigureCut(TWO, 1, "Figure 1"))?.png[8]).toBe(3);
  });

  it("is removed by deleteUpload even for cuts kept under an older revision", async () => {
    const mine = meta(ONE);
    await writeUploadMeta(ONE, mine);
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    revision.value = "5";
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(5) });
    expect(await objects(ONE)).toHaveLength(2);

    await deleteUpload(mine);

    expect(existsSync(folder(ONE))).toBe(false);
  });

  it("still deletes the record and the PDF when the pictures cannot be removed, and the purge removes them once the upload is gone", async () => {
    const mine = meta(ONE);
    await writeUploadMeta(ONE, mine);
    await writeUploadPdfIfAbsent(ONE, Buffer.from("%PDF-1.4 p12-61 delete fixture"));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fault.rm = true;
    try {
      await deleteUpload(mine);
    } finally {
      fault.rm = false;
    }

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(existsSync(path.join(uploadDir, `${ONE}.json`))).toBe(false);
    expect(existsSync(path.join(uploadDir, `${ONE}.pdf`))).toBe(false);
    expect(existsSync(folder(ONE))).toBe(true);

    await purgeExpiredUploads();
    expect(existsSync(folder(ONE))).toBe(false);
  });
});

describe("the purge and the kept figure cuts (P12-61)", () => {
  it("removes an expired upload's cuts with it, and leaves a live upload's current cut alone", async () => {
    const expired = meta(ONE, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await writeUploadMeta(ONE, expired);
    await writeUploadMeta(TWO, meta(TWO));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1) });
    await writeUploadFigureCut(TWO, 2, "Figure 3", { png: fakePng(2) });

    await purgeExpiredUploads();

    expect(existsSync(folder(ONE))).toBe(false);
    expect((await readUploadFigureCut(TWO, 2, "Figure 3"))?.png[8]).toBe(2);
  });

  it("sweeps the folder of an upload that is gone, taken down or deleted", async () => {
    const orphan = sha16(Buffer.from("p12-61: orphan"));
    const blocked = sha16(Buffer.from("p12-61: blocked"));
    const deleted = sha16(Buffer.from("p12-61: deleted"));
    await writeUploadMeta(blocked, meta(blocked, { status: "blocked", expiresAt: undefined }));
    await writeUploadMeta(deleted, meta(deleted, { status: "deleted", expiresAt: undefined }));
    await writeUploadMeta(TWO, meta(TWO));
    for (const hash16 of [orphan, blocked, deleted, TWO]) {
      await writeUploadFigureCut(hash16, 1, "Figure 1", { png: fakePng(1) });
    }

    await purgeExpiredUploads();

    expect(existsSync(folder(orphan))).toBe(false);
    expect(existsSync(folder(blocked))).toBe(false);
    expect(existsSync(folder(deleted))).toBe(false);
    expect(existsSync(folder(TWO))).toBe(true);
  });

  it("sweeps a live upload's cuts of an older revision and any leftover temp file, and keeps the current ones", async () => {
    await writeUploadMeta(ONE, meta(ONE));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    await writeUploadFigureCut(ONE, 3, "Figure 5", { png: fakePng(4) });
    revision.value = "5";
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(5) });
    await writeFile(path.join(folder(ONE), "p9-0000000000000000-r5.cut.leftover.tmp"), "half");
    await writeFile(path.join(folder(ONE), "notes.txt"), "not a cut");
    expect(await objects(ONE)).toHaveLength(5);

    await purgeExpiredUploads();

    const left = await objects(ONE);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/-r5\.cut$/);
    expect((await readUploadFigureCut(ONE, 2, "Figure 3"))?.png[8]).toBe(5);
    expect(await readUploadFigureCut(ONE, 3, "Figure 5")).toBeNull();
  });

  it("removes the folder of a live upload whose cuts are all of an older revision", async () => {
    await writeUploadMeta(ONE, meta(ONE));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    revision.value = "5";

    await purgeExpiredUploads();

    expect(existsSync(folder(ONE))).toBe(false);
    expect(await readFile(path.join(uploadDir, `${ONE}.json`), "utf-8")).toContain(ONE);
  });
});
