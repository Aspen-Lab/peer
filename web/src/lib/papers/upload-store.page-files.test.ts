// P12-61 (§1h.434, part 2) — the page file: the page that holds a figure, cut out of the upload as a PDF of its
// own, kept beside the upload (owner-private, keyed by the upload's hash and the page, no revision), so a later
// cut on that page opens a file of kilobytes. The real store on a temp directory; the PDFs are invented.

import { existsSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { figurePdf } from "@/lib/figures/figure-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-page-files-store-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

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
  readUploadPageFile,
  sha16,
  writeUploadFigureCut,
  writeUploadMeta,
  writeUploadPageFile,
  type UploadMeta,
} from "./upload-store";

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

const OWNER = "a".repeat(64);
const ONE = sha16(Buffer.from("p12-61: page files, first upload"));
const TWO = sha16(Buffer.from("p12-61: page files, second upload"));
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const fakePng = (fill: number) => Buffer.from([...SIGNATURE, ...new Array<number>(64).fill(fill)]);

/** A whole (tiny, invented) PDF; `marker` makes two of them differ. */
const pdf = (marker: string) => figurePdf([{ text: [[marker, 72, 100, 10]] }]);

const folder = (hash16: string) => path.join(uploadDir, "figure-cuts", hash16);
const objects = async (hash16: string) => (await readdir(folder(hash16)).catch(() => [])).sort();

function meta(hash16: string, extra: Partial<UploadMeta> = {}): UploadMeta {
  return {
    hash16,
    ownerKey: OWNER,
    fileName: "paper.pdf",
    title: "An invented upload",
    uploadedAt: "2026-10-28T00:00:00.000Z",
    textStatus: "ok",
    status: "ready",
    revision: 1,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...extra,
  };
}

beforeEach(async () => {
  revision.value = "4";
  await rm(uploadDir, { recursive: true, force: true });
});

describe("a kept page file (P12-61)", () => {
  it("is read back as written, owner-only on the disk, named by its page, with no temp file left", async () => {
    const bytes = pdf("page two");
    expect(await readUploadPageFile(ONE, 2)).toBeNull();

    await writeUploadPageFile(ONE, 2, bytes);

    const kept = await readUploadPageFile(ONE, 2);
    expect(kept).not.toBeNull();
    expect(Buffer.compare(kept!, bytes)).toBe(0);
    expect(await objects(ONE)).toEqual(["p2.pdf"]);
    if (process.platform !== "win32") expect((await stat(path.join(folder(ONE), "p2.pdf"))).mode & 0o777).toBe(0o600);
  });

  it("is keyed by the upload and the page only: another page or upload misses, and a revision change does not", async () => {
    await writeUploadPageFile(ONE, 2, pdf("page two"));
    await writeUploadPageFile(ONE, 3, pdf("page three"));

    expect((await readUploadPageFile(ONE, 3))!.toString("latin1")).toContain("page three");
    expect(await readUploadPageFile(ONE, 4)).toBeNull();
    expect(await readUploadPageFile(TWO, 2)).toBeNull();

    revision.value = "5";
    expect((await readUploadPageFile(ONE, 2))!.toString("latin1")).toContain("page two");
  });

  it("replaces the page file of the same page whole", async () => {
    await writeUploadPageFile(ONE, 2, pdf("first"));
    await writeUploadPageFile(ONE, 2, pdf("second"));
    expect((await readUploadPageFile(ONE, 2))!.toString("latin1")).toContain("second");
    expect(await objects(ONE)).toEqual(["p2.pdf"]);
  });

  it.each([
    ["an empty source", () => new Uint8Array(0)],
    ["bytes that are not a PDF", () => Buffer.from("this is not a PDF but it is long enough to look like a file")],
    ["a PDF cut short before its end marker", () => pdf("cut short").subarray(0, pdf("cut short").byteLength - 80)],
  ])("refuses %s, and keeps nothing", async (_name, make) => {
    await expect(writeUploadPageFile(ONE, 2, make())).rejects.toThrow();
    expect(await objects(ONE)).toEqual([]);
  });

  it.each([0, 1.5, -3])("refuses page %s", async (page) => {
    await expect(writeUploadPageFile(ONE, page, pdf("x"))).rejects.toThrow();
    expect(await readUploadPageFile(ONE, page)).toBeNull();
    expect(await objects(ONE)).toEqual([]);
  });

  it("refuses a hash that is not an upload hash", async () => {
    await expect(writeUploadPageFile("../../etc", 2, pdf("x"))).rejects.toThrow();
    expect(await readUploadPageFile("../../etc", 2)).toBeNull();
  });

  it("misses on an object that was cut short or is not a PDF, and does not throw", async () => {
    await writeUploadPageFile(ONE, 2, pdf("whole"));
    const target = path.join(folder(ONE), "p2.pdf");
    const whole = pdf("whole");
    await writeFile(target, whole.subarray(0, whole.byteLength - 80));
    expect(await readUploadPageFile(ONE, 2)).toBeNull();
    await writeFile(target, "not a pdf at all, only invented words, long enough");
    expect(await readUploadPageFile(ONE, 2)).toBeNull();
    await writeFile(target, "");
    expect(await readUploadPageFile(ONE, 2)).toBeNull();
  });
});

describe("a kept page file goes with its upload (P12-61)", () => {
  it("is removed by deleteUpload with the cuts, and another upload's stay", async () => {
    const mine = meta(ONE);
    await writeUploadMeta(ONE, mine);
    await writeUploadPageFile(ONE, 2, pdf("mine"));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1) });
    await writeUploadMeta(TWO, meta(TWO));
    await writeUploadPageFile(TWO, 2, pdf("theirs"));

    await deleteUpload(mine);

    expect(existsSync(folder(ONE))).toBe(false);
    expect(await readUploadPageFile(ONE, 2)).toBeNull();
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
    expect((await readUploadPageFile(TWO, 2))!.toString("latin1")).toContain("theirs");
  });

  it("is removed by the purge with an expired upload, and the folder of an upload that is gone, blocked or deleted", async () => {
    const orphan = sha16(Buffer.from("p12-61: page files orphan"));
    const blocked = sha16(Buffer.from("p12-61: page files blocked"));
    const deleted = sha16(Buffer.from("p12-61: page files deleted"));
    await writeUploadMeta(ONE, meta(ONE, { expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await writeUploadMeta(blocked, meta(blocked, { status: "blocked", expiresAt: undefined }));
    await writeUploadMeta(deleted, meta(deleted, { status: "deleted", expiresAt: undefined }));
    await writeUploadMeta(TWO, meta(TWO));
    for (const hash16 of [ONE, orphan, blocked, deleted, TWO]) await writeUploadPageFile(hash16, 2, pdf(hash16));

    await purgeExpiredUploads();

    for (const gone of [ONE, orphan, blocked, deleted]) expect(existsSync(folder(gone)), gone).toBe(false);
    expect(await readUploadPageFile(TWO, 2)).not.toBeNull();
  });

  it("survives a revision change in a live upload: the purge removes the old cuts and keeps the page files, even when no current cut is left", async () => {
    await writeUploadMeta(ONE, meta(ONE));
    await writeUploadPageFile(ONE, 2, pdf("page two"));
    await writeUploadPageFile(ONE, 3, pdf("page three"));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    revision.value = "5";

    await purgeExpiredUploads();

    expect(await objects(ONE)).toEqual(["p2.pdf", "p3.pdf"]);
    expect(await readUploadPageFile(ONE, 2)).not.toBeNull();
  });

  it("sweeps a leftover temp file beside the page files, and keeps the page files and the current cuts", async () => {
    await writeUploadMeta(ONE, meta(ONE));
    await writeUploadPageFile(ONE, 2, pdf("page two"));
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });
    await writeFile(path.join(folder(ONE), "p9.pdf.leftover.tmp"), "half");

    await purgeExpiredUploads();

    const left = await objects(ONE);
    expect(left).toHaveLength(2);
    expect(left).toContain("p2.pdf");
    expect(left.some((name) => name.endsWith("-r4.cut"))).toBe(true);
  });
});
